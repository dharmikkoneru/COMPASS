import { describe, expect, it } from 'vitest';
import { errorMessage, functionErrorMessage } from './errors';

describe('errorMessage', () => {
  it('keeps the message of a real Error', () => {
    expect(errorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('reads PostgrestError-style plain objects, which are not Error instances', () => {
    const postgrest = {
      code: '42P10',
      message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
      details: null,
      hint: null,
    };
    expect(errorMessage(postgrest, 'fallback')).toContain('ON CONFLICT specification');
    // The code is what points at the missing constraint, so it must survive.
    expect(errorMessage(postgrest, 'fallback')).toContain('42P10');
  });

  it('appends a hint when one is present', () => {
    const err = { message: 'permission denied', code: '42501', hint: 'check RLS policies' };
    expect(errorMessage(err, 'fallback')).toBe('permission denied [42501] — check RLS policies');
  });

  it('falls back for values that carry no message', () => {
    expect(errorMessage(null, 'fallback')).toBe('fallback');
    expect(errorMessage(undefined, 'fallback')).toBe('fallback');
    expect(errorMessage({}, 'fallback')).toBe('fallback');
    expect(errorMessage({ message: '   ' }, 'fallback')).toBe('fallback');
  });

  it('accepts a plain string', () => {
    expect(errorMessage('went wrong', 'fallback')).toBe('went wrong');
  });
});

describe('functionErrorMessage', () => {
  /** Shape of supabase-js's FunctionsHttpError. */
  function functionsHttpError(body: unknown, status = 500): Error {
    const err = new Error('Edge Function returned a non-2xx status code');
    Object.assign(err, {
      context: new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    return err;
  }

  it('surfaces the function body instead of the generic supabase-js message', async () => {
    const err = functionsHttpError({ error: 'GEMINI_API_KEY secret is not set' });
    await expect(functionErrorMessage(err, 'fallback')).resolves.toBe(
      'GEMINI_API_KEY secret is not set',
    );
  });

  it('keeps multi-line diagnostics intact', async () => {
    const err = functionsHttpError({ error: 'No Gemini model could generate the quiz.\nTried: a, b' });
    await expect(functionErrorMessage(err, 'fallback')).resolves.toContain('Tried: a, b');
  });

  it('translates a platform worker kill (546) instead of leaking the status code', async () => {
    // What the platform returns when it kills the isolate: the function's own
    // handler never runs, so there is no `error` field to read.
    const err = functionsHttpError(
      {
        code: 'WORKER_RESOURCE_LIMIT',
        message: 'Function failed due to not having enough compute resources (please check logs)',
      },
      546,
    );
    const message = await functionErrorMessage(err, 'fallback');
    expect(message).toContain('ran out of its compute budget');
    expect(message).toContain('not having enough compute resources');
  });

  it('translates the 150 s idle kill, which no handler can report itself', async () => {
    const err = functionsHttpError(
      { code: 'IDLE_TIMEOUT', message: 'Request idle timeout limit (150s) reached' },
      546,
    );
    const message = await functionErrorMessage(err, 'fallback');
    expect(message).toContain('150 s request limit');
    expect(message).toContain('try again in a minute');
  });

  it('names an unrecognised platform code rather than hiding it', async () => {
    const err = functionsHttpError({ code: 'SOMETHING_NEW' }, 500);
    await expect(functionErrorMessage(err, 'fallback')).resolves.toContain('SOMETHING_NEW');
  });

  it('reports the HTTP status when the body carries no explanation', async () => {
    const err = functionsHttpError('plain text, not an object', 504);
    await expect(functionErrorMessage(err, 'fallback')).resolves.toContain('HTTP 504');
  });

  it('falls back when there is no readable context', async () => {
    await expect(
      functionErrorMessage(new Error('Edge Function returned a non-2xx status code'), 'fallback'),
    ).resolves.toBe('Edge Function returned a non-2xx status code');
    await expect(functionErrorMessage({ context: 'not a Response' }, 'fallback')).resolves.toBe(
      'fallback',
    );
    await expect(functionErrorMessage(null, 'fallback')).resolves.toBe('fallback');
  });
});
