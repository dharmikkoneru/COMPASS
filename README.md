# COMPASS Platform — SIH26101 (MoSPI)

AI-enabled learning platform that **identifies competency gaps**, **recommends personalized
training through the iGOT Karmayogi ecosystem**, and **generates quizzes/MCQs from uploaded
learning materials** to strengthen capacity building in India's Official Statistical System.

## The loop

```
Upload material (PDF/text) ──► Gemini generates competency-tagged MCQs
        │                                   │
        ▼                                   ▼
   Quiz runner  ──────────►  apply_attempt RPC → EMA mastery update
                                            │
                                            ▼
                            Gap engine (deterministic, 60% threshold)
                                            │
                                            ▼
                     iGOT Karmayogi course recommendations (ranked by gap urgency)
```

## Stack

- **React 19 + Vite + TypeScript + Tailwind 4** — SPA
- **Supabase** — auth (email/password), Postgres + RLS, Edge Functions
- **Python + FastAPI** (`backend/`, deployed on Render) — quiz generation and RAG,
  authorised by the officer's own token so RLS still governs every row
- **Google Gemini** — structured-JSON MCQ generation and grounded answers, key server-side only
- **pgvector** — material chunks and cosine similarity search
- **pdfjs-dist** — in-browser PDF text extraction
- **recharts** — competency radar
- **vitest** (109 tests) + **pytest** (49 tests) — gap engine, matcher, AI transport, API contracts

AI runs in two places on purpose. The FastAPI service is the primary; the edge
functions are the fallback if it is asleep or unreachable, chosen at runtime in
`src/lib/ai.ts`. A cold start therefore degrades instead of failing.

## Project layout

```
src/
  lib/            supabase client, AI transport, competency taxonomy, gap engine, igot adapter+matcher, pdf extraction, attempt history
  context/        auth (session + profile)
  hooks/          materials/quizzes, competency profile, attempt history, admin org data
  components/     Navbar, ProtectedRoute, MaterialUploader, QuizRunner, CompetencyRadar, AskPanel
  pages/          Login, Dashboard, Materials, Quiz, Training, Recommendations, Admin, Settings, NotFound
backend/          Python FastAPI AI service (see backend/README.md)
  app/            config, auth (ES256 via JWKS), Postgrest client, gemini, chunking, quiz, rag, routers
  tests/          pytest: chunking, quiz validation, prompt grounding, token verification, API contracts
supabase/
  migrations/0001_init.sql    schema + RLS + profile trigger + apply_attempt RPC
  migrations/0002_fix_relationships.sql  FK + unique-key repair, run after 0001
  migrations/0003_questions_insert_policy.sql  write policies for the quiz generator
  migrations/0007_material_chunks_rag.sql  pgvector RAG: material_chunks + match_chunks RPC
  migrations/0008_lock_down_rpc_execute.sql  revokes PUBLIC execute on the RPCs, pins match_chunks to auth.uid()
  seed.sql                    mock iGOT Karmayogi course catalog
  functions/generate-quiz/    Deno edge function (Gemini, JSON schema, retry across models)
  functions/embed-material/   chunk + embed materials into material_chunks
  functions/ask-material/     grounded Q&A: embed question → match_chunks → cited Gemini answer
  functions/_shared/gemini.ts shared bounded-fetch, budget and model-fallback helpers
render.yaml       Render blueprint for the FastAPI service
vercel.json       Vercel config (SPA deep-link rewrites)
netlify.toml      Netlify config, kept working alongside Vercel
BACKLOG.md        possible changes, decisions and verified state — read before starting work
```

## RAG — "Ask your material"

Upload a material, press **Index for Q&A**, then ask questions on the Materials
page. The pipeline: chunk (~700 chars, overlap) → embeddings (768-d) →
`material_chunks` (pgvector) → cosine `match_chunks` RPC → a grounded Gemini
answer that cites its passages. Answers refuse to go beyond the documents;
every claim shows the passage and similarity it rests on.

Embeddings pin the width to 768 to match the column, because the current model
(`gemini-embedding-001`) is natively 3072-wide and the old
`text-embedding-004` — the one migration 0007 was written for — now 404s for new
API keys. Both implementations try the current family first, keep the legacy
name last, and discover what the key can actually call before giving up.

## Deployment options

| Path | How |
| --- | --- |
| Vercel | `vercel.json` is committed; import the repo and every push deploys. Needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL` |
| Render | `render.yaml` blueprint creates the `compass-api` FastAPI service (see `backend/README.md`) |
| Netlify | `netlify.toml` + `public/_redirects` are committed; connect the repo and every push deploys |
| Docker | `docker compose up --build` → http://localhost:8080 |
| Minikube | `minikube start`, build `compass-web:local` (see k8s/compass.yaml header), `kubectl apply -f k8s/` |

All three hosts deploy from the same GitHub repo. CI (`verify` for the app,
`api` for the service) runs typecheck, lint and tests on every push and PR.

## Setup

See **SUPABASE_SETUP.md** for the full walkthrough. Short version:

1. Create a Supabase project → run the migrations in order in the SQL editor:
   `0001_init.sql`, `0002_fix_relationships.sql`, `0003_questions_insert_policy.sql`,
   `0007_material_chunks_rag.sql` for the Ask panel, then
   `0008_lock_down_rpc_execute.sql` to remove PUBLIC execute from the RPCs
   (all safe to re-run).
2. Run `supabase/seed.sql` (mock iGOT catalog).
3. `cp .env.example .env` and fill in `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
4. Deploy the edge functions:
   `supabase functions deploy generate-quiz embed-material ask-material` then
   `supabase secrets set GEMINI_API_KEY=...`
5. `npm install && npm run dev` — sign up, upload a PDF, generate a quiz, take it,
   watch your dashboard and iGOT recommendations update.
6. Optional: run the Python AI service too (`backend/README.md`) and set
   `VITE_API_BASE_URL` to its URL. Without it the edge functions answer instead.

## Scripts

| Command           | What it does                    |
| ----------------- | ------------------------------- |
| `npm run dev`     | Vite dev server                 |
| `npm run build`   | Typecheck + production build    |
| `npm run lint`    | Oxlint                          |
| `npm test`        | Unit tests (gap engine, matcher, AI transport) |
| `cd backend && `.venv/Scripts/python -m pytest`` | API tests (contracts, token verification) |
| `cd backend && `.venv/Scripts/python -m ruff check .`` | API lint |
