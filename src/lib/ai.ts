/**
 * COMPASS — AI transport.
 *
 * All AI lives behind one function, {@link invokeAi}, because the same three
 * capabilities are implemented twice: by the Python FastAPI service on Render
 * (`backend/`, the primary) and by the Supabase edge functions (the fallback).
 * Callers name the capability; this module decides who answers.
 *
 * Why a fallback at all: Render's free tier sleeps, so a cold start would hang
 * the demo at exactly the wrong moment. A cold or unreachable API degrades to
 * the edge functions instead of failing in front of judges. The fallback is
 * deliberately narrow — see {@link UNAVAILABLE_STATUS} — because a *handled*
 * 400/500 from FastAPI is a real diagnosis worth surfacing, not something to
 * paper over by quietly asking someone else.
 *
 * Configure with:
 *   VITE_API_BASE_URL   FastAPI origin, e.g. https://compass-api.onrender.com
 *                       Unset → the edge functions answer, exactly as before.
 *   VITE_AI_FALLBACK    'false' disables the edge-function fallback entirely
 *                       (useful when testing the API in isolation).
 */

import { supabase } from './supabase';

export type AiCapability = 'generate-quiz' | 'embed-material' | 'ask-material';

/** Which implementation answered the last call. Handy for diagnostics. */
export type AiTransport = 'fastapi' | 'edge';

interface AiTransportConfig {
  /** Normalised FastAPI origin, or null when the API is not configured. */
  baseUrl: string | null;
  fallbackEnabled: boolean;
}

let cachedConfig: AiTransportConfig | null = null;
let lastTransport: AiTransport | null = null;

export function resetAiTransportForTests(): void {
  cachedConfig = null;
  lastTransport = null;
}

/** Read once, then cached: `import.meta.env` cannot change while the app runs. */
export function aiTransportConfig(): AiTransportConfig {
  if (cachedConfig) return cachedConfig;
  const rawBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  const rawFallback = (import.meta.env.VITE_AI_FALLBACK as string | undefined)?.trim();
  cachedConfig = {
    baseUrl: rawBase ? rawBase.replace(/\/+$/, '') : null,
    // Opt-out only: any other value (including unset) means fallback on.
    fallbackEnabled: rawFallback?.toLowerCase() !== 'false',
  };
  return cachedConfig;
}

export const lastAiTransport = (): AiTransport | null => lastTransport;

/**
 * A failure raised by the FastAPI service.
 *
 * `unavailable` marks gateway/transport statuses — the service never got to
 * run, so trying the edge function is worthwhile. Every other status means the
 * service answered and explained itself, and that explanation is the best
 * thing the officer can be told.
 */
export class AiApiError extends Error {
  readonly status: number;
  readonly unavailable: boolean;

  constructor(message: string, status: number, unavailable: boolean) {
    super(message);
    this.name = 'AiApiError';
    this.status = status;
    this.unavailable = unavailable;
  }
}

/**
 * Statuses that mean "the service is not there", not "the service said no".
 * 502/503/504 are what Render and its proxy return for a sleeping or
 * restarting instance. 408/425/429 are transient by definition.
 */
const UNAVAILABLE_STATUS = new Set([408, 425, 429, 502, 503, 504]);

/**
 * Pull the readable reason out of a FastAPI error response.
 *
 * FastAPI's own validation failures put an array of `{loc, msg}` objects on
 * `detail`; our handlers use `{error}`. Either way the officer should read a
 * sentence, never a status code with nothing behind it.
 */
async function readApiError(res: Response): Promise<string> {
  try {
    const body = (await res.clone().json()) as { error?: unknown; detail?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) return body.error;
    if (typeof body.detail === 'string' && body.detail.trim()) return body.detail;
    if (Array.isArray(body.detail)) {
      const parts = body.detail
        .map((d) => {
          const entry = d as { msg?: unknown; loc?: unknown };
          const where = Array.isArray(entry.loc) ? entry.loc.slice(1).join('.') : '';
          const what = typeof entry.msg === 'string' ? entry.msg : '';
          return [where, what].filter(Boolean).join(' ');
        })
        .filter(Boolean);
      if (parts.length) return `The COMPASS API rejected the request: ${parts.join('; ')}`;
    }
  } catch {
    // Not JSON, or the body was consumed — the status is all we have.
  }
  return `The COMPASS API returned HTTP ${res.status} without an error message. Check its logs on Render.`;
}

async function callFastApi<T>(capability: AiCapability, body: Record<string, unknown>): Promise<T> {
  const base = aiTransportConfig().baseUrl as string;

  // The officer's own token, not a service key: RLS still decides what the
  // Python service may read and write.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new AiApiError('You are signed out — sign in again to use the AI features.', 401, false);
  }

  let res: Response;
  try {
    res = await fetch(`${base}/api/ai/${capability}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // fetch only rejects on a transport failure: DNS, TLS, CORS, a sleeping
    // host, or a socket that never settles.
    const detail = err instanceof Error ? err.message : String(err);
    throw new AiApiError(
      `Could not reach the COMPASS API at ${base} (${detail}). It may be starting up.`,
      0,
      true,
    );
  }

  if (!res.ok) {
    throw new AiApiError(
      await readApiError(res),
      res.status,
      UNAVAILABLE_STATUS.has(res.status),
    );
  }

  return (await res.json()) as T;
}

async function callEdge<T>(capability: AiCapability, body: Record<string, unknown>): Promise<T> {
  // Errors here are supabase-js objects carrying their own `context` Response;
  // `functionErrorMessage` in ./errors reads them for the UI.
  const { data, error } = await supabase.functions.invoke(capability, { body });
  if (error) throw error;
  return data as T;
}

/**
 * Run one AI capability. Resolves with the response body — the contracts are
 * identical on both transports, so callers never know who answered.
 */
export async function invokeAi<T>(
  capability: AiCapability,
  body: Record<string, unknown>,
): Promise<T> {
  const { baseUrl, fallbackEnabled } = aiTransportConfig();

  if (!baseUrl) {
    lastTransport = 'edge';
    return callEdge<T>(capability, body);
  }

  try {
    const data = await callFastApi<T>(capability, body);
    lastTransport = 'fastapi';
    return data;
  } catch (err) {
    if (!(err instanceof AiApiError) || !err.unavailable || !fallbackEnabled) {
      lastTransport = 'fastapi';
      throw err;
    }
    console.warn(
      `COMPASS API unavailable (${err.message}) — retrying on the Supabase edge function.`,
    );
    lastTransport = 'edge';
    return callEdge<T>(capability, body);
  }
}
