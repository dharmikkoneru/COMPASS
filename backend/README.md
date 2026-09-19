# COMPASS API — FastAPI AI service

The Python half of COMPASS. It owns **AI only**: quiz generation and
retrieval-augmented answers over the officer's own uploaded materials.

Data, authentication and storage stay in Supabase. This service holds **no
service-role key** — every database call is made with the officer's own access
token, so Row Level Security applies here exactly as it does in the browser. If
this service has a bug, it still cannot read someone else's rows.

It is the **primary** AI backend. The equivalent Supabase edge functions
(`generate-quiz`, `embed-material`, `ask-material`) stay deployed as a fallback:
if this service is asleep or unreachable, the frontend retries there instead of
failing. See `src/lib/ai.ts`.

## Endpoints

| Route | Body | Returns |
| --- | --- | --- |
| `POST /api/ai/generate-quiz` | `{materialId, difficulty, count}` | the `quizzes` row (with its questions stored) |
| `POST /api/ai/embed-material` | `{materialId}` | `{materialId, chunks, dims}` |
| `POST /api/ai/ask-material` | `{question, materialId?}` | `{answer, sources[], model}` |
| `GET /api/ai/models` | — | which Gemini models this key can call |
| `GET /healthz` | — | liveness, and whether the env vars are present |

All AI routes require `Authorization: Bearer <Supabase access token>`. Failures
answer `{"error": "…"}` with a non-2xx status — the same shape the edge functions
use, so the frontend renders it as a sentence either way.

`GET /api/ai/models` exists because Google retires Gemini models on a rolling
basis. When generation breaks, this route answers "why" in one request.

## Run it locally

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # POSIX: .venv/bin/python
cp .env.example .env        # then fill in the three values
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

- `http://127.0.0.1:8000/healthz` — should report `"configured": true`
- `http://127.0.0.1:8000/docs` — FastAPI's generated API docs

Point the frontend at it by setting `VITE_API_BASE_URL=http://127.0.0.1:8000` in
the repository-root `.env` and restarting the Vite dev server (Vite bakes env
vars at startup).

### Tests and lint

```bash
cd backend
.venv/Scripts/python -m pytest      # 49 tests, no network, no secrets
.venv/Scripts/python -m ruff check .
```

The suite fakes PostgREST and Gemini, and **generates its own ES256 key pair**
to exercise token verification — which is why it needs no credentials and runs
in CI. CI runs both jobs on every push (`verify` for the React app, `api` for
this service).

## Deploy on Render

`render.yaml` is committed at the repository root:

1. Render dashboard → **New → Blueprint** → pick this repository
2. Render reads `render.yaml`, creates the `compass-api` web service, and
   redeploys it on every push to `main`
3. Add the three secrets when prompted (they are marked `sync: false`, so they
   live in the dashboard, never in git):
   - `SUPABASE_URL` — same project as the frontend
   - `SUPABASE_ANON_KEY` — the public anon key
   - `GEMINI_API_KEY` — the same key already set as a Supabase function secret
4. Copy the service URL into the frontend's `VITE_API_BASE_URL` (Vercel/Netlify
   environment variables, and the root `.env` locally)

Add the deployed frontend origin to `ALLOWED_ORIGINS` (comma-separated) or the
browser will block the calls. The Netlify origin is listed by default so both
hosts keep working during the transition.

**Free instances sleep after ~15 minutes idle and take ~50 s to wake.** The
frontend treats that as "use the edge functions instead", so a cold start
degrades rather than fails — and never in front of judges.

## Design notes

- **Configuration is lazy.** Nothing is required at import time, so `/healthz`
  and the test suite work with no credentials. A missing variable is reported by
  name when a route needs it (`app/errors.py`), not as a `KeyError` in a log.
- **Auth is asymmetric-only.** This project signs logins with ES256 and
  publishes the public keys at `/.well-known/jwks.json`, so verification needs
  no shared secret (`app/auth.py`). A rotated key is picked up by retrying once
  on failure; a token from a different project is refused on `iss`.
- **Tokens are forwarded, never replaced.** `app/supabase.py` is a deliberately
  narrow PostgREST client — six calls, no vendor SDK — so RLS stays the single
  authority and the exact status codes the UI's messages depend on stay visible.
- **Models are discovered, not assumed.** Both generation and embeddings try the
  current family first, keep legacy names last, and fall back to ListModels
  (`app/gemini.py`). Failures name every model tried and why.
- **Embeddings are width-checked.** `material_chunks.embedding` is `vector(768)`;
  a model returning 3072 values is caught before it is stored.
- **Prompts are byte-identical to the edge functions** (`app/quiz.py`,
  `app/rag.py`), so the two backends cannot disagree about the contract — long
  lines there are prompt text, and ruff is configured to leave them alone.
- **Every request shares one wall-clock budget** (`DEADLINE_SECONDS`, 100 s).
  Both implementations learned the hard way that an unbounded model call ends in
  a platform kill with no diagnostics.
