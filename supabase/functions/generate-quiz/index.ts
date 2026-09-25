// ═══════════════════════════════════════════════════════════════
// COMPASS — generate-quiz Edge Function (Supabase / Deno)
//
// Generates MCQ quizzes from uploaded learning material using Google
// Gemini with a strict JSON response schema. The GEMINI_API_KEY lives
// only in Supabase secrets — never in the client bundle.
//
// Deploy:
//   supabase functions deploy generate-quiz
//   supabase secrets set GEMINI_API_KEY=your_key
//
// Contract (POST, JSON):
//   req : { materialId: string, difficulty: 'easy'|'medium'|'hard', count: number }
//   res : Quiz row (supabase.public.quizzes) as JSON
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Cognitive demand, Bloom-style, kept identical to
// backend/app/quiz.py::COGNITIVE_LEVELS and migration 0013's check constraint —
// an unlisted value would be refused by the database.
const COGNITIVE_LEVELS = ['Recall', 'Application', 'Analysis'];

const COMPETENCY_TAGS = [
  'Survey Methodology',
  'Sampling Techniques',
  'Data Collection & Field Ops',
  'Data Quality & Validation',
  'Statistical Computing',
  'Data Indexing & Storage',
  'Official Statistics & Indicators',
  'Data Governance & Privacy',
];

// Google retires Gemini models on a rolling basis: 1.5 and 2.0 answer 404, and
// 2.5 now 404s for *new* API keys — "This model models/gemini-2.5-flash is no
// longer available to new users", naming gemini-3.6-flash as the replacement.
// So the current family goes first, the legacy names stay last (older keys are
// still served them), and anything else this key can call comes from
// listGenerateContentModels.
const PREFERRED_MODELS = [
  'gemini-3.6-flash', // Google's own migration target for gemini-2.5-flash
  'gemini-3.5-flash-lite', // ...and for gemini-2.5-flash-lite
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

/**
 * Wall-clock budget for one invocation, deliberately under the platform's
 * ~150 s worker limit. Past that limit Supabase kills the isolate and the
 * caller gets a bare 546 WORKER_RESOURCE_LIMIT with no diagnostics whatsoever
 * — no stack, no message, nothing to debug with. Stopping on our own terms
 * turns that silent death into an error that says what was tried.
 */
const DEADLINE_MS = 100_000;
/** Time kept aside for the two database writes that follow the model call. */
const WRITE_RESERVE_MS = 12_000;
/** Never start a model call with less time left than this. */
const MIN_ATTEMPT_MS = 8_000;
/** Cap on a single request, so one hung socket cannot eat the whole budget. */
const MAX_REQUEST_MS = 60_000;
/** Never try more than this many models — keep a hopeless key from hammering the API. */
const MAX_MODEL_ATTEMPTS = 6;
/**
 * Statuses worth retrying on the same model. Gemini answers 503 UNAVAILABLE
 * ("currently experiencing high demand… try again later") in bursts that clear
 * within seconds; treating that as fatal made a working model look broken and
 * burned the fallback list on noise.
 */
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
/** Pause before retrying a transient failure, if the budget can spare it. */
const RETRY_DELAY_MS = 1_500;

interface GeminiModel {
  name?: string;
  supportedGenerationMethods?: string[];
}

const clip = (s: string, n = 240) => (s.length > n ? `${s.slice(0, n)}…` : s);

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A wall-clock deadline shared by everything that happens in one invocation. */
interface Budget {
  deadline: number;
}

const left = (budget: Budget) => budget.deadline - Date.now();
const secs = (ms: number) => `${Math.max(0, Math.round(ms / 1000))}s`;

/**
 * fetch() bounded by our own wall clock rather than the socket's good manners.
 *
 * AbortSignal.timeout aborts the request, but it cannot rescue a connect that
 * never settles: the timer fires, the fetch promise stays pending, and the
 * invocation runs on until the platform reaps it. That was measured, not
 * theorised — a build whose deadline was 100 s still died at 150 s with
 * IDLE_TIMEOUT. Racing a timer of our own means the budget holds however the
 * socket misbehaves, which is the whole point of having one.
 */
async function fetchWithin(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), ms);
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        giveUp = setTimeout(
          () => reject(new Error(`sent no response within ${secs(ms)}`)),
          ms + 250,
        );
      }),
    ]);
  } finally {
    clearTimeout(abort);
    if (giveUp !== undefined) clearTimeout(giveUp);
  }
}

/**
 * Request config for one generateContent call.
 *
 * Gemini 2.5 Flash thinks before it answers, and the minutes that can consume
 * are exactly what ran this function past the platform's worker limit (a real
 * failure: 151 s, then a 546 with no body). A thinking budget of 0 disables
 * that; the pro models reject 0, so only the flash family is touched.
 *
 * The guard stays version-specific rather than covering every flash model:
 * whether 3.x accepts this field is unverified, and a rejected field is a 400
 * that would read as a broken model instead of a bad request.
 */
function generationConfig(model: string, temperature: number): Record<string, unknown> {
  const config: Record<string, unknown> = {
    responseMimeType: 'application/json',
    responseSchema,
    temperature,
  };
  if (/^gemini-2\.5/.test(model) && !model.includes('pro')) {
    config.thinkingConfig = { thinkingBudget: 0 };
  }
  return config;
}

const responseSchema = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    difficulty: { type: 'STRING', enum: ['easy', 'medium', 'hard'] },
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          options: { type: 'ARRAY', items: { type: 'STRING' } },
          correct_idx: { type: 'INTEGER' },
          explanation: { type: 'STRING' },
          competency_tag: { type: 'STRING', enum: COMPETENCY_TAGS },
          difficulty: { type: 'STRING', enum: ['easy', 'medium', 'hard'] },
          cognitive_level: { type: 'STRING', enum: COGNITIVE_LEVELS },
        },
        required: [
          'text',
          'options',
          'correct_idx',
          'explanation',
          'competency_tag',
          'difficulty',
          'cognitive_level',
        ],
      },
    },
  },
  required: ['title', 'difficulty', 'questions'],
};

// Kept byte-identical to backend/app/quiz.py::build_prompt. The two backends
// must produce the same kind of question, and pyproject.toml exempts both files
// from the line-length rule for exactly this reason — reflowing one side would
// quietly change the contract.
//
// The scenario framing is the point of the assessment: an officer is asked what
// to do in a situation grounded in the material, not to recite a definition.
// The scenario lives in `text` and `explanation` justifies the action; the one
// added field is `cognitive_level`, which migration 0013 stores.
function buildPrompt(materialText: string, difficulty: string, count: number): string {
  return `You are an assessment designer for India's Ministry of Statistics and Programme Implementation (MoSPI).

Create exactly ${count} multiple-choice questions from the LEARNING MATERIAL below.

Every question must be a SCENARIO: a short workplace situation an officer would actually face, followed by a decision to make.

Scenario rules (this is what the assessment measures):
- Open with a concrete situation — a field team reports a problem, a supervisor questions submitted data, an estimate looks wrong, a release deadline slips, a questionnaire comes back incomplete.
- Ask what the officer should do, check, decide or conclude — or which reading of the situation is correct.
- The situation and the correct action must both come from the material. Use its actual methods, definitions and figures; invent no procedure, number or policy it does not state.
- No definitional or recall questions ("What is X?", "Which of the following is a dimension of…"). Test what the officer does with the knowledge, not recital of it.
- Wrong options must be plausible mistakes an officer could make — the wrong method applied, a validation step skipped, an indicator misread — never filler.

Rules:
- Every question must be answerable strictly from the material. Do not invent facts.
- Each question has exactly 4 options and exactly one correct option (correct_idx is 0-based).
- Tag each question with the single most relevant competency from this list:
  ${COMPETENCY_TAGS.map((t) => `"${t}"`).join(', ')}
- Overall difficulty target: "${difficulty}". Individual question difficulty must also be one of easy/medium/hard.
- Tag each question with the cognitive level it actually demands:
  "Recall" when the material states the rule or figure and the officer must recognise it,
  "Application" when a fact from the material has to be applied to a situation other than the one it was stated in, or
  "Analysis" when the officer must compare parts of the material, diagnose a cause, or infer a conclusion.
  Be strict: most scenario questions are "Application", and "Analysis" is earned only when more than one part of the material has to be weighed.
- Include a one-paragraph explanation: which part of the material justifies the correct action, and why the most tempting wrong option fails.
- Write in clear professional English suitable for serving officers.
- Give the quiz a short descriptive title mentioning the material's topic.

Return ONLY JSON matching the provided schema.

LEARNING MATERIAL:
"""
${materialText}
"""`;
}

type CognitiveLevel = 'Recall' | 'Application' | 'Analysis';

interface GenQuestion {
  text: string;
  options: string[];
  correct_idx: number;
  explanation: string;
  competency_tag: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** Null when the model supplied no usable level — the UI shows no chip then. */
  cognitive_level: CognitiveLevel | null;
}

interface PostgrestLikeError {
  message?: string;
  code?: string;
}

/**
 * Make a failed write actionable for whoever reads it on the Materials page.
 *
 * PostgREST failures are plain objects, not Errors, so `err instanceof Error ?
 * err.message : 'Unexpected error'` threw away the one sentence that explains
 * the problem — which is exactly how a missing RLS policy read as "Unexpected
 * error". Accepts anything, and names the migration behind an RLS refusal.
 */
/**
 * True when PostgREST refused a write because this database has no such column.
 *
 * PGRST204 is PostgREST's schema cache refusing it, 42703 is Postgres itself —
 * both are what an unapplied migration looks like to a deploy that shipped the
 * code first. The message has to name the column too, because the code alone
 * does not say which one was missing.
 */
function isUnknownColumn(err: PostgrestLikeError, column: string): boolean {
  const message = err.message ?? '';
  if (!message.toLowerCase().includes(column.toLowerCase())) return false;
  return (
    err.code === 'PGRST204' || err.code === '42703' || /schema cache|does not exist/i.test(message)
  );
}

/** A copy of a row with the cognitive level removed (the pre-0013 shape). */
function withoutCognitiveLevel(row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row };
  delete copy.cognitive_level;
  return copy;
}

function writeErrorMessage(err: unknown): string {
  const plain = (err ?? {}) as PostgrestLikeError;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : (plain.message ?? 'unknown database error');

  if (plain.code === '42501' || /row-level security/i.test(message)) {
    return `${message} — the database is missing a policy from supabase/migrations (see 0003_questions_insert_policy.sql).`;
  }
  return message;
}

/**
 * The canonical level name, or null when the model supplied no usable one.
 *
 * Case-insensitive because a model occasionally ignores an enum's spelling
 * while still answering correctly; dropping "application" as unknown would hide
 * a tag that is right. Null is the honest answer for anything else — the UI
 * shows no chip rather than inventing a level for the question.
 */
function normalizeCognitiveLevel(value: unknown): CognitiveLevel | null {
  const text = String(value ?? '').trim().toLowerCase();
  return COGNITIVE_LEVELS.find((level) => level.toLowerCase() === text) ?? null;
}

function validateQuestions(questions: unknown, count: number): GenQuestion[] {
  if (!Array.isArray(questions)) throw new Error('AI returned no questions array');
  const valid: GenQuestion[] = [];
  for (const q of questions) {
    const options = Array.isArray(q.options) ? q.options.map(String) : [];
    const correct = Number(q.correct_idx);
    const tag = String(q.competency_tag);
    if (q.text && options.length === 4 && correct >= 0 && correct < 4 && q.explanation) {
      valid.push({
        text: String(q.text),
        options,
        correct_idx: correct,
        explanation: String(q.explanation),
        competency_tag: COMPETENCY_TAGS.includes(tag) ? tag : COMPETENCY_TAGS[0],
        difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
        cognitive_level: normalizeCognitiveLevel(q.cognitive_level),
      });
    }
    if (valid.length >= count) break;
  }
  if (valid.length === 0) throw new Error('AI returned no valid questions');
  return valid;
}

/**
 * Model names this key can call with generateContent, best first.
 * Newest version wins, then stable over preview, then flash over pro.
 */
async function listGenerateContentModels(apiKey: string, budget: Budget): Promise<string[]> {
  const res = await fetchWithin(
    `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${apiKey}`,
    {},
    Math.min(Math.max(left(budget), 1000), MAX_REQUEST_MS),
  );
  if (!res.ok) throw new Error(`ListModels HTTP ${res.status}: ${clip(await res.text())}`);

  const body = (await res.json()) as { models?: GeminiModel[] };
  const version = (name: string) => {
    const m = /^gemini-(\d+(?:\.\d+)?)/.exec(name);
    return m ? Number(m[1]) : 0;
  };
  const unstable = (name: string) => /(preview|exp|experimental|thinking)/.test(name);

  return (body.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => String(m.name ?? '').replace(/^models\//, ''))
    .filter((name) => name.startsWith('gemini') && !/(embedding|aqa|image|tts|learnlm)/.test(name))
    .sort(
      (a, b) =>
        version(b) - version(a) ||
        Number(unstable(a)) - Number(unstable(b)) ||
        Number(!a.includes('flash')) - Number(!b.includes('flash')) ||
        a.length - b.length,
    );
}

interface GeneratedQuiz {
  title: string;
  difficulty: string;
  questions: GenQuestion[];
}

/**
 * Ask Gemini for the quiz, inside a wall-clock budget.
 *
 * The budget is the point: a slow key plus a fallback list is enough work to
 * trip the platform's ~150 s worker limit, and that failure mode (546, empty
 * body) is undebuggable from the client. Running out of time here instead
 * produces an ordinary error that names the models and their reasons.
 */
async function callGemini(apiKey: string, prompt: string, budget: Budget): Promise<GeneratedQuiz> {
  // Keep every model's failure. Reporting only the last one hides the model
  // that failed for the more interesting reason.
  const failures: string[] = [];
  const tried: string[] = [];

  const attemptModel = async (model: string): Promise<GeneratedQuiz | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = left(budget);
      if (remaining < MIN_ATTEMPT_MS) {
        failures.push(`${model}: not tried, only ${secs(remaining)} of the budget left`);
        return null;
      }
      if (attempt === 0) tried.push(model);

      let res: Response;
      try {
        res = await fetchWithin(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: generationConfig(model, attempt === 0 ? 0.4 : 0.8),
            }),
          },
          Math.min(Math.max(remaining - WRITE_RESERVE_MS, 1000), MAX_REQUEST_MS),
        );
      } catch (err) {
        // Timeout or network failure. Retrying a hung endpoint rarely helps,
        // and the budget is finite — move on.
        failures.push(`${model}: request did not complete (${errorText(err)})`);
        return null;
      }

      if (!res.ok) {
        const detail = await res.text();
        failures.push(`${model}: HTTP ${res.status} ${clip(detail)}`);
        // A 404/403 will not improve on retry; an overloaded or rate-limited
        // endpoint often does, so wait out the burst and try this model once
        // more before giving up on it.
        if (!TRANSIENT_STATUS.has(res.status) || left(budget) < MIN_ATTEMPT_MS + RETRY_DELAY_MS) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }

      const body = await res.json();
      const text: string | undefined = body?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        failures.push(`${model}: response contained no candidate text`);
        continue; // transient — retry this model once
      }
      try {
        return JSON.parse(text) as GeneratedQuiz;
      } catch (parseErr) {
        failures.push(`${model}: returned invalid JSON (${errorText(parseErr)})`);
      }
    }
    return null;
  };

  const tryModels = async (models: string[]): Promise<GeneratedQuiz | null> => {
    for (const model of models) {
      const quiz = await attemptModel(model);
      if (quiz) return quiz;
    }
    return null;
  };

  // Curated names first. Discovery costs a round trip that the common case does
  // not need, so it waits until every known name has failed.
  const answer = await tryModels(PREFERRED_MODELS.slice(0, MAX_MODEL_ATTEMPTS));
  if (answer) return answer;

  // Discovery is best effort: if ListModels itself fails, the curated names and
  // their errors are still reported.
  let discoveryError: string | null = null;
  try {
    const discovered = await listGenerateContentModels(apiKey, budget);
    const fallback = await tryModels(
      discovered.filter((m) => !PREFERRED_MODELS.includes(m)).slice(0, MAX_MODEL_ATTEMPTS),
    );
    if (fallback) return fallback;
  } catch (err) {
    discoveryError = errorText(err);
  }

  throw new Error(
    [
      'No Gemini model could generate the quiz.',
      discoveryError ? `ListModels failed: ${discoveryError}` : null,
      tried.length ? `Tried: ${tried.join(', ')}` : null,
      left(budget) < MIN_ATTEMPT_MS
        ? `Out of time: stopped after ${secs(DEADLINE_MS - left(budget))} to stay under the platform's worker limit. Try again, or ask for fewer questions.`
        : null,
      ...failures,
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  const budget: Budget = { deadline: Date.now() + DEADLINE_MS };

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const { materialId, difficulty, count } = await req.json();
    const n = Math.min(Math.max(Number(count) || 5, 1), 15);
    const diff = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';

    // RLS ensures the caller only sees their own material.
    const { data: material, error: mErr } = await supabase
      .from('materials')
      .select('id, title, raw_text')
      .eq('id', materialId)
      .single();
    if (mErr) {
      // PGRST116 = single() matched no row. Anything else (a permission or
      // schema error) deserves to be shown rather than relabelled "not found".
      const notFound = mErr.code === 'PGRST116' || !material;
      return new Response(
        JSON.stringify({
          error: notFound
            ? 'Material not found'
            : `Could not load the material: ${writeErrorMessage(mErr)}`,
        }),
        {
          status: notFound ? 404 : 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        },
      );
    }
    if (!material) {
      return new Response(JSON.stringify({ error: 'Material not found' }), {
        status: 404,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY secret is not set' }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const prompt = buildPrompt(material.raw_text, diff, n);
    const generated = await callGemini(apiKey, prompt, budget);
    const questions = validateQuestions(generated.questions, n);

    const { data: quiz, error: quizErr } = await supabase
      .from('quizzes')
      .insert({
        material_id: material.id,
        created_by: auth.user.id,
        title: String(generated.title || material.title).slice(0, 120),
        difficulty: ['easy', 'medium', 'hard'].includes(generated.difficulty)
          ? generated.difficulty
          : diff,
        question_count: questions.length,
      })
      .select()
      .single();
    if (quizErr) throw new Error(writeErrorMessage(quizErr));

    const rows = questions.map((q, i) => ({
      quiz_id: quiz.id,
      idx: i,
      text: q.text,
      options: q.options,
      correct_idx: q.correct_idx,
      explanation: q.explanation,
      competency_tag: q.competency_tag,
      difficulty: q.difficulty,
      cognitive_level: q.cognitive_level,
    }));

    // The deploy that adds cognitive_level and the migration that creates the
    // column are separate events, and the code reaches production first. If the
    // column is not there yet, storing the questions untagged is a far smaller
    // failure than losing a generation the officer waited a minute for — and an
    // untagged question just shows no chip, like every pre-0013 row.
    let inserted = await supabase.from('questions').insert(rows);
    if (inserted.error && isUnknownColumn(inserted.error, 'cognitive_level')) {
      inserted = await supabase.from('questions').insert(rows.map(withoutCognitiveLevel));
    }
    const qErr = inserted.error;
    if (qErr) {
      // The quiz row is already committed. Leaving it behind gives the officer an
      // empty quiz on the Materials page ("5 Qs →" opening to "This quiz has no
      // questions"), so roll it back before reporting the failure. Best effort:
      // if the delete is refused too, the original error is still the useful one.
      const { error: rollbackErr } = await supabase.from('quizzes').delete().eq('id', quiz.id);
      throw new Error(
        rollbackErr
          ? `${writeErrorMessage(qErr)} (the empty quiz row ${quiz.id} could not be rolled back: ${rollbackErr.message})`
          : writeErrorMessage(qErr),
      );
    }

    return new Response(JSON.stringify(quiz), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: writeErrorMessage(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
