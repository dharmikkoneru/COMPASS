/**
 * Extract a readable message from anything the Supabase client throws.
 *
 * Supabase returns PostgrestError / AuthError *plain objects*, not Error
 * instances. So the common idiom
 *
 *   catch (err) { setError(err instanceof Error ? err.message : 'Generic') }
 *
 * silently discards the real database error — e.g. SQLSTATE 42P10 or a
 * missing-relationship message — and shows a generic string instead. That
 * is how a broken schema reads as "something went wrong" with no clue.
 *
 * Use this helper everywhere instead of an `instanceof Error` check.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err;

  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };

    if (typeof e.message === 'string' && e.message.trim()) {
      // Postgres/PostgREST codes are worth showing: 42P10 and friends point
      // straight at the constraint that is missing.
      const code = typeof e.code === 'string' && e.code ? ` [${e.code}]` : '';
      const hint = typeof e.hint === 'string' && e.hint ? ` — ${e.hint}` : '';
      return `${e.message}${code}${hint}`;
    }
    if (typeof e.details === 'string' && e.details.trim()) return e.details;
  }

  return fallback;
}

/**
 * Supabase platform failures, which never reach the function's own handler and
 * therefore never produce the `{ error }` body the UI reads.
 *
 * A worker that exceeds its compute budget is killed and answers 546 with
 * `{ code: 'WORKER_RESOURCE_LIMIT' }`. Left untranslated that reaches the
 * officer as supabase-js's "non-2xx status code", which is no information at
 * all about a failure that is entirely actionable (try again / ask for fewer
 * questions).
 */
const PLATFORM_ERRORS: Record<string, string> = {
  WORKER_RESOURCE_LIMIT:
    'The quiz generator ran out of its compute budget before the AI answered. Try again, or ask for fewer questions.',
  WORKER_LIMIT:
    'The quiz generator needs more time than the platform allows. Try again, or ask for fewer questions.',
  /** The platform's 150 s request limit, reached when a model call never settles. */
  IDLE_TIMEOUT:
    'The quiz generator waited too long on the AI provider and was stopped at the platform\u2019s 150 s request limit. The model is probably overloaded, so try again in a minute.',
  BOOT_ERROR: 'The quiz generator failed to start — check its dependencies and its GEMINI_API_KEY secret.',
};

/**
 * Like {@link errorMessage}, but for `supabase.functions.invoke`.
 *
 * FunctionsHttpError extends Error, yet its message is always the useless
 * "Edge Function returned a non-2xx status code". The function's own JSON body
 * — the one that says *why* — sits on `context`, an unread Response. Read it
 * so the real reason reaches the UI instead of a shrug.
 */
export async function functionErrorMessage(err: unknown, fallback: string): Promise<string> {
  if (err && typeof err === 'object' && 'context' in err) {
    const context = (err as { context?: unknown }).context;
    if (context instanceof Response) {
      const status = context.status;
      let body: unknown = null;
      try {
        body = await context.clone().json();
      } catch {
        // Body already consumed, or not JSON — the status is all we have.
      }

      const payload = (body ?? {}) as { error?: unknown; code?: unknown; message?: unknown };
      if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;

      const detail =
        typeof payload.message === 'string' && payload.message.trim() ? payload.message.trim() : '';
      if (typeof payload.code === 'string' && payload.code) {
        const known = PLATFORM_ERRORS[payload.code];
        return known
          ? [known, detail].filter(Boolean).join(' — ')
          : [`The quiz generator failed with ${payload.code}`, detail].filter(Boolean).join(' — ');
      }

      if (status >= 400) {
        return `The quiz generator returned HTTP ${status} without an error message. Check its logs in the Supabase dashboard.`;
      }
    }
  }
  // supabase-js surfaces "Function not deployed" failures as this vague
  // network-ish sentence; name the actual cause and the fix.
  const raw = errorMessage(err, '');
  if (/failed to send a request to the edge function/i.test(raw)) {
    return `${raw} — usually the function is not deployed yet. Run: supabase functions deploy <name>`;
  }
  return raw || fallback;
}
