// ═══════════════════════════════════════════════════════════════
// COMPASS — ask-material Edge Function (Supabase / Deno)
//
// "Ask your material": embeds the officer's question, retrieves the
// most similar chunks of their own indexed materials, and answers
// with Gemini strictly grounded in those chunks. Returns the answer
// plus the cited snippets so the officer can check the source.
//
// Deploy:
//   supabase functions deploy ask-material
//   (uses the same GEMINI_API_KEY secret as generate-quiz)
//
// Contract (POST, JSON):
//   req : { question: string, materialId?: string }
//         materialId absent → search across all of the officer's
//         indexed materials.
//   res : { answer, sources: [{ materialTitle, chunkIndex, content,
//                             similarity }], model }
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  clip,
  embedOne,
  errorText,
  fetchWithin,
  left,
  MAX_REQUEST_MS,
  MIN_ATTEMPT_MS,
  newBudget,
  WRITE_RESERVE_MS,
} from '../_shared/gemini.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_QUESTION = 500;
const TOP_K = 5;

const PREFERRED_MODELS = [
  'gemini-3.6-flash', // Google's migration target for gemini-2.5-flash
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

function buildPrompt(question: string, contexts: string[]): string {
  return `You are a research assistant for officers at India's Ministry of Statistics and Programme Implementation (MoSPI).

Answer the QUESTION using ONLY the CONTEXT passages below, which come from the officer's own uploaded training materials.

Rules:
- If the context does not contain the answer, say exactly: "I could not find this in your materials." — and suggest what kind of document might cover it.
- Cite which passage(s) support the answer, like [Source 1], [Source 2].
- Be concise: 2-5 sentences unless a list is genuinely needed.
- Do not invent facts, numbers, or policy names.

CONTEXT:
${contexts.map((c, i) => `[Source ${i + 1}]\n${c}`).join('\n\n')}

QUESTION: ${question}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function callGemini(
  apiKey: string,
  prompt: string,
  budget: { deadline: number },
): Promise<{ answer: string; model: string }> {
  const failures: string[] = [];
  for (const model of PREFERRED_MODELS) {
    const remaining = left(budget);
    if (remaining < MIN_ATTEMPT_MS) {
      failures.push(`${model}: not tried, time budget exhausted`);
      continue;
    }
    let res: Response;
    try {
      res = await fetchWithin(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2 },
          }),
        },
        Math.min(Math.max(remaining - WRITE_RESERVE_MS, 1000), MAX_REQUEST_MS),
      );
    } catch (err) {
      failures.push(`${model}: ${errorText(err)}`);
      continue;
    }
    if (!res.ok) {
      failures.push(`${model}: HTTP ${res.status} ${clip(await res.text())}`);
      continue;
    }
    const body = await res.json();
    const text: string | undefined = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return { answer: text.trim(), model };
    failures.push(`${model}: empty candidate text`);
  }
  throw new Error(
    `No Gemini model could answer.\n${failures.join('\n')}`,
  );
}

interface ChunkRow {
  chunk_id: string;
  material_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const budget = newBudget();
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return json({ error: 'Not authenticated' }, 401);

    const { question, materialId } = await req.json();
    const q = typeof question === 'string' ? question.trim() : '';
    if (!q) return json({ error: 'Ask a question first' }, 400);
    if (q.length > MAX_QUESTION) {
      return json({ error: `Keep the question under ${MAX_QUESTION} characters` }, 400);
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return json({ error: 'GEMINI_API_KEY secret is not set' }, 500);

    // 1. Embed the question.
    const queryVector = await embedOne(apiKey, q, budget);

    // 2. Cosine search over the officer's own chunks (RLS + explicit filter).
    const { data: matches, error: matchErr } = await supabase.rpc('match_chunks', {
      query_embedding: queryVector,
      p_user_id: auth.user.id,
      match_count: TOP_K,
      p_material_id: materialId ?? null,
    });
    if (matchErr) {
      return json(
        {
          error:
            `Chunk search failed (is migration 0007 applied, and was this material indexed?): ${matchErr.message}`,
        },
        400,
      );
    }

    const rows = (matches ?? []) as ChunkRow[];
    if (rows.length === 0) {
      return json(
        {
          answer:
            'I could not find this in your materials. (No indexed passages matched — try indexing the material first with the "Re-index" button, or ask about something the documents cover.)',
          sources: [],
          model: 'none',
        },
        200,
      );
    }

    // 3. Grounded answer. Material titles make the sources readable.
    const { data: mats } = await supabase
      .from('materials')
      .select('id, title')
      .in('id', [...new Set(rows.map((r) => r.material_id))]);
    const titleOf = (id: string) =>
      (mats ?? []).find((m) => m.id === id)?.title ?? 'Untitled material';

    const prompt = buildPrompt(
      q,
      rows.map((r) => r.content),
    );
    const { answer, model } = await callGemini(apiKey, prompt, budget);

    return json({
      answer,
      model,
      sources: rows.map((r) => ({
        materialTitle: titleOf(r.material_id),
        chunkIndex: r.chunk_index,
        content: r.content,
        similarity: Number(r.similarity.toFixed(3)),
      })),
    });
  } catch (err) {
    return json({ error: errorText(err) }, 500);
  }
});
