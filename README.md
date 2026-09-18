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
- **Supabase** — auth (email/password), Postgres + RLS, Edge Function
- **Google Gemini** (`gemini-2.0-flash`) — structured-JSON MCQ generation, key server-side only
- **pdfjs-dist** — in-browser PDF text extraction
- **recharts** — competency radar
- **vitest** — unit tests for the gap engine and recommendation matcher

## Project layout

```
src/
  lib/            supabase client, competency taxonomy, gap engine, igot adapter+matcher, pdf extraction, attempt history
  context/        auth (session + profile)
  hooks/          materials/quizzes, competency profile, attempt history, admin org data
  components/     Navbar, ProtectedRoute, MaterialUploader, QuizRunner, CompetencyRadar
  pages/          Login, Dashboard, Materials, Quiz, Training, Recommendations, Admin, NotFound
supabase/
  migrations/0001_init.sql    schema + RLS + profile trigger + apply_attempt RPC
  migrations/0002_fix_relationships.sql  FK + unique-key repair, run after 0001
  migrations/0003_questions_insert_policy.sql  write policies for the quiz generator
  migrations/0007_material_chunks_rag.sql  pgvector RAG: material_chunks + match_chunks RPC
  seed.sql                    mock iGOT Karmayogi course catalog
  functions/generate-quiz/    Deno edge function (Gemini, JSON schema, retry across models)
  functions/embed-material/   chunk + embed materials into material_chunks (text-embedding-004)
  functions/ask-material/     grounded Q&A: embed question → match_chunks → cited Gemini answer
  functions/_shared/gemini.ts shared bounded-fetch + budget helpers for the functions
```

## RAG — "Ask your material"

Upload a material, press **Index for Q&A**, then ask questions on the Materials
page. The pipeline: chunk (~700 chars, overlap) → `text-embedding-004` (768-d) →
`material_chunks` (pgvector) → cosine `match_chunks` RPC → `gemini-flash`
grounded answer that cites its passages. Answers refuse to go beyond the
documents; every claim shows the passage and similarity it rests on.

## Deployment options

| Path | How |
| --- | --- |
| Netlify | `netlify.toml` + `public/_redirects` are committed; connect the repo and every push deploys |
| Docker | `docker compose up --build` → http://localhost:8080 |
| Minikube | `minikube start`, build `compass-web:local` (see k8s/compass.yaml header), `kubectl apply -f k8s/` |

CI (`.github/workflows/ci.yml`) runs typecheck + lint + tests on every push/PR.

## Setup

See **SUPABASE_SETUP.md** for the full walkthrough. Short version:

1. Create a Supabase project → run the migrations in order in the SQL editor:
   `0001_init.sql`, `0002_fix_relationships.sql`, `0003_questions_insert_policy.sql`,
   then `0007_material_chunks_rag.sql` for the Ask panel (safe to re-run).
2. Run `supabase/seed.sql` (mock iGOT catalog).
3. `cp .env.example .env` and fill in `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
4. Deploy the edge functions:
   `supabase functions deploy generate-quiz embed-material ask-material` then
   `supabase secrets set GEMINI_API_KEY=...`
5. `npm install && npm run dev` — sign up, upload a PDF, generate a quiz, take it,
   watch your dashboard and iGOT recommendations update.

## Scripts

| Command           | What it does                    |
| ----------------- | ------------------------------- |
| `npm run dev`     | Vite dev server                 |
| `npm run build`   | Typecheck + production build    |
| `npm run lint`    | Oxlint                          |
| `npm test`        | Unit tests (gap engine, matcher) |
