// ═══════════════════════════════════════════════════════════════
// COMPASS — shared Gemini helpers for Edge Functions (Deno)
//
// Extracted from the hardened generate-quiz pattern: wall-clock
// budgets (the platform's ~150 s worker limit kills silently past
// that), bounded fetches, and a model fallback list, because Google
// retires Gemini models on a rolling basis and a hard-coded name
// 404s for new keys.
// ═══════════════════════════════════════════════════════════════

/** Wall-clock budget for one invocation, under the ~150 s worker limit. */
export const DEADLINE_MS = 100_000;
/** Time kept aside for the database writes that follow the model call. */
export const WRITE_RESERVE_MS = 12_000;
/** Never start a model call with less time left than this. */
export const MIN_ATTEMPT_MS = 8_000;
/** Cap on a single request, so one hung socket cannot eat the whole budget. */
export const MAX_REQUEST_MS = 60_000;
/** Statuses worth retrying on the same model. */
export const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
/** Pause before retrying a transient failure, if the budget can spare it. */
export const RETRY_DELAY_MS = 1_500;

export interface Budget {
  deadline: number;
}

export const newBudget = (): Budget => ({ deadline: Date.now() + DEADLINE_MS });
export const left = (budget: Budget) => budget.deadline - Date.now();
export const secs = (ms: number) => `${Math.max(0, Math.round(ms / 1000))}s`;

export const clip = (s: string, n = 240) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * fetch() bounded by our own wall clock rather than the socket's good
 * manners. AbortSignal.timeout alone cannot rescue a connect that never
 * settles: the timer fires, the fetch promise stays pending. Racing a
 * second timer means the budget holds however the socket misbehaves.
 */
export async function fetchWithin(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
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

// ── Embeddings ────────────────────────────────────────────────────
// material_chunks.embedding is vector(768), so whatever model answers must
// produce exactly 768 values — checked, never assumed.
//
// This used to be a single hard-coded name (text-embedding-004). That model
// now 404s for new API keys, exactly the way the generation models did, and
// the failure looked like "Chunk search failed" somewhere else entirely. Same
// medicine as the generation path: try the current family first, keep the
// legacy name last, and discover what this key can actually call before
// giving up.

export const EMBED_DIMENSIONS = 768;

interface EmbedCandidate {
  name: string;
  /** True when the model must be told the width, e.g. gemini-embedding-001. */
  explicitDimensions: boolean;
}

/**
 * gemini-embedding-001 is current and natively 3072-wide, so the width has to
 * be requested explicitly. text-embedding-004 is 768-wide natively — what
 * migration 0007 was written for — but it is the fallback now, not the default.
 */
const CURATED_EMBED_MODELS: EmbedCandidate[] = [
  { name: 'gemini-embedding-001', explicitDimensions: true },
  { name: 'text-embedding-004', explicitDimensions: false },
];

/** Anything else this key can embed with, after the curated names fail. */
async function discoveredEmbedModels(apiKey: string, budget: Budget): Promise<EmbedCandidate[]> {
  try {
    const res = await fetchWithin(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${apiKey}`,
      {},
      Math.min(Math.max(left(budget), 1000), MAX_REQUEST_MS),
    );
    if (!res.ok) return [];
    const body = (await res.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };
    return (body.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('embedContent'))
      .map((m) => String(m.name ?? '').replace(/^models\//, ''))
      .filter((name) => name.includes('embedding'))
      .filter((name) => !CURATED_EMBED_MODELS.some((c) => c.name === name))
      .map((name) => ({
        name,
        explicitDimensions: !name.startsWith('text-embedding'),
      }));
  } catch {
    // Discovery is best effort; the curated names and their errors still report.
    return [];
  }
}

async function embedBatch(
  apiKey: string,
  candidate: EmbedCandidate,
  texts: string[],
  budget: Budget,
): Promise<number[][]> {
  const res = await fetchWithin(
    `https://generativelanguage.googleapis.com/v1beta/models/${candidate.name}:batchEmbedContents?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${candidate.name}`,
          content: { parts: [{ text }] },
          ...(candidate.explicitDimensions ? { outputDimensionality: EMBED_DIMENSIONS } : {}),
        })),
      }),
    },
    Math.min(Math.max(left(budget), 1000), MAX_REQUEST_MS),
  );
  if (!res.ok) {
    throw new Error(`Embedding HTTP ${res.status}: ${clip(await res.text())}`);
  }
  const body = (await res.json()) as { embeddings?: Array<{ values?: number[] }> };
  const vectors = (body.embeddings ?? []).map((e) => e.values ?? []);
  if (vectors.length !== texts.length) {
    throw new Error(`Embedding returned ${vectors.length} vectors for ${texts.length} texts`);
  }
  for (const v of vectors) {
    if (v.length !== EMBED_DIMENSIONS) {
      throw new Error(`Embedding returned ${v.length} dimensions, expected ${EMBED_DIMENSIONS}`);
    }
  }
  return vectors;
}

/** Embed a batch of texts. Returns vectors in the same order as the input. */
export async function embedTexts(
  apiKey: string,
  texts: string[],
  budget: Budget,
): Promise<number[][]> {
  const failures: string[] = [];
  const candidates = [
    ...CURATED_EMBED_MODELS,
    ...(await discoveredEmbedModels(apiKey, budget)),
  ];

  for (const candidate of candidates) {
    try {
      return await embedBatch(apiKey, candidate, texts, budget);
    } catch (err) {
      failures.push(`${candidate.name}: ${errorText(err)}`);
    }
  }

  throw new Error(`No Gemini embedding model could embed the text.\n${failures.join('\n')}`);
}

/** Embed one text (the officer's question). */
export async function embedOne(
  apiKey: string,
  text: string,
  budget: Budget,
): Promise<number[]> {
  const [vec] = await embedTexts(apiKey, [text], budget);
  return vec;
}
