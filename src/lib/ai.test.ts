import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The transport's whole job is choosing between two backends, so the tests are
 * about *which* one answers and *when* the fallback is allowed to hide a
 * failure. The Supabase client is mocked; `fetch` is stubbed per test.
 */

const getSession = vi.fn();
const invoke = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => getSession(...args) },
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));

import {
  AiApiError,
  aiServiceStatus,
  aiTransportConfig,
  invokeAi,
  lastAiTransport,
  resetAiTransportForTests,
  subscribeAiServiceStatus,
  warmAiService,
} from './ai';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const signedIn = () =>
  getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } } });

describe('aiTransportConfig', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetAiTransportForTests();
  });

  it('has no base URL until VITE_API_BASE_URL is set', () => {
    expect(aiTransportConfig()).toEqual({ baseUrl: null, fallbackEnabled: true });
  });

  it('strips trailing slashes so paths never double up', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com//');
    expect(aiTransportConfig().baseUrl).toBe('https://compass-api.onrender.com');
  });

  it('only disables the fallback on an explicit "false"', () => {
    vi.stubEnv('VITE_AI_FALLBACK', 'FALSE');
    expect(aiTransportConfig().fallbackEnabled).toBe(false);
    resetAiTransportForTests();
    vi.stubEnv('VITE_AI_FALLBACK', '');
    expect(aiTransportConfig().fallbackEnabled).toBe(true);
  });
});

describe('invokeAi', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.unstubAllEnvs();
    resetAiTransportForTests();
    getSession.mockReset();
    invoke.mockReset();
    signedIn();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  it('uses the edge function when no API is configured', async () => {
    invoke.mockResolvedValue({ data: { answer: 'from deno' }, error: null });

    await expect(invokeAi('ask-material', { question: 'hi' })).resolves.toEqual({
      answer: 'from deno',
    });
    expect(invoke).toHaveBeenCalledWith('ask-material', { body: { question: 'hi' } });
    expect(lastAiTransport()).toBe('edge');
  });

  it('posts to the API with the officer token, and never calls the edge function', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ answer: 'from python', sources: [], model: 'gemini-3.6-flash' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await invokeAi<{ answer: string }>('ask-material', { question: 'hi', materialId: 'm1' });

    expect(result.answer).toBe('from python');
    expect(lastAiTransport()).toBe('fastapi');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://compass-api.onrender.com/api/ai/ask-material');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-123');
    expect(init.body).toBe(JSON.stringify({ question: 'hi', materialId: 'm1' }));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('surfaces a handled 400 from the API instead of quietly falling back', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Ask a question first' }, 400)));

    await expect(invokeAi('ask-material', {})).rejects.toThrow('Ask a question first');
    // A real answer from the API is a diagnosis, not an outage.
    expect(invoke).not.toHaveBeenCalled();
  });

  it('keeps a multi-line API diagnosis intact', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ error: 'No Gemini model could answer.\nTried: a, b' }, 500)),
    );

    await expect(invokeAi('generate-quiz', {})).rejects.toThrow(/Tried: a, b/);
  });

  it('reads FastAPI validation errors, which arrive as a detail array', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json({ detail: [{ loc: ['body', 'count'], msg: 'must be at least 1' }] }, 422),
      ),
    );

    await expect(invokeAi('generate-quiz', { count: 0 })).rejects.toThrow(
      'The COMPASS API rejected the request: count must be at least 1',
    );
  });

  it('falls back to the edge function when the API is unreachable', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    invoke.mockResolvedValue({ data: { answer: 'from deno' }, error: null });

    await expect(invokeAi('ask-material', { question: 'hi' })).resolves.toEqual({
      answer: 'from deno',
    });
    expect(lastAiTransport()).toBe('edge');
  });

  it('falls back on a cold-start 503', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    invoke.mockResolvedValue({ data: { answer: 'from deno' }, error: null });

    await expect(invokeAi('ask-material', {})).resolves.toEqual({ answer: 'from deno' });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('does not fall back when VITE_AI_FALLBACK=false', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    vi.stubEnv('VITE_AI_FALLBACK', 'false');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));

    await expect(invokeAi('ask-material', {})).rejects.toBeInstanceOf(AiApiError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refuses to call the API without a session', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    getSession.mockResolvedValue({ data: { session: null } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(invokeAi('ask-material', {})).rejects.toThrow('You are signed out');
    expect(fetchMock).not.toHaveBeenCalled();
    // Signing in again is the fix; there is nothing the edge function can do.
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reports the edge function’s own failure when both transports fail', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    invoke.mockResolvedValue({ data: null, error: { message: 'GEMINI_API_KEY secret is not set' } });

    await expect(invokeAi('ask-material', {})).rejects.toEqual({
      message: 'GEMINI_API_KEY secret is not set',
    });
    expect(lastAiTransport()).toBe('edge');
  });

  it('records an unreachable API so the banner can say so', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    invoke.mockResolvedValue({ data: { answer: 'from deno' }, error: null });

    await invokeAi('ask-material', {});
    expect(aiServiceStatus()).toBe('unreachable');
  });

  it('records a gateway 503 as still starting, not as a diagnosis', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    invoke.mockResolvedValue({ data: { answer: 'from deno' }, error: null });

    await invokeAi('ask-material', {});
    expect(aiServiceStatus()).toBe('waking');
  });

  it('records a handled 400 as awake, because it answered', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Ask a question first' }, 400)));

    await expect(invokeAi('ask-material', {})).rejects.toThrow('Ask a question first');
    expect(aiServiceStatus()).toBe('awake');
  });
});

describe('warmAiService', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetAiTransportForTests();
    getSession.mockReset();
    invoke.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('never probes when no API is configured — the edge functions never sleep', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(warmAiService()).resolves.toBe('edge');
    expect(aiServiceStatus()).toBe('edge');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls an answering service awake', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    const fetchMock = vi.fn().mockResolvedValue(json({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(warmAiService()).resolves.toBe('awake');
    expect(aiServiceStatus()).toBe('awake');
    expect(fetchMock.mock.calls[0][0]).toBe('https://compass-api.onrender.com/healthz');
  });

  it('calls a still-booting container waking, and never abandons the probe', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    let finish: (res: Response) => void = () => {};
    const booting = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(booting));

    // The 2.5 s wait is what a cold Render instance looks like: no reply yet.
    await expect(warmAiService({ timeoutMs: 10 })).resolves.toBe('waking');
    expect(aiServiceStatus()).toBe('waking');

    // Cutting the request short would abort the very boot it exists to start,
    // so the promise stays open and the status follows it when it lands.
    finish(json({ status: 'ok' }));
    for (let i = 0; i < 20 && aiServiceStatus() !== 'awake'; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(aiServiceStatus()).toBe('awake');
  });

  it('retries once before declaring a refused host unreachable', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(warmAiService()).resolves.toBe('unreachable');
    // A just-restarted instance refuses connections for a few seconds.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(aiServiceStatus()).toBe('unreachable');
  });

  it('notifies subscribers only when the status actually changes', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://compass-api.onrender.com');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ status: 'ok' })));
    const seen: string[] = [];
    const unsubscribe = subscribeAiServiceStatus((s) => seen.push(s));

    await warmAiService();
    await warmAiService();
    unsubscribe();
    await warmAiService();

    expect(seen).toEqual(['awake']);
    expect(aiServiceStatus()).toBe('awake');
  });
});
