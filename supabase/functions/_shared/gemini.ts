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
// text-embedding-004: 768 dimensions, matches material_chunks.embedding.
// Embedding models are far more stable than generation models, but the
// call stays bounded like everything else.

export const EMBED_MODEL = 'text-embedding-004';
export const EMBED_DIMENSIONS = 768;

/** Embed a batch of texts. Returns vectors in the same order as the input. */
export async function embedTexts(
  apiKey: string,
  texts: string[],
  budget: Budget,
): Promise<number[][]> {
  const res = await fetchWithin(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text }] },
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

/** Embed one text (the officer's question). */
export async function embedOne(
  apiKey: string,
  text: string,
  budget: Budget,
): Promise<number[]> {
  const [vec] = await embedTexts(apiKey, [text], budget);
  return vec;
}
