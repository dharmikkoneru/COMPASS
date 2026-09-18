# Supabase Setup Guide (COMPASS / SIH26101)

Time: ~10 minutes. Everything below runs on the Supabase **free tier**.

## 1. Create the project

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Pick any name (e.g. `compass-sih`), a strong DB password, and a region near you
   (e.g. `ap-south-1` for India).
3. Wait for provisioning to finish.

## 2. Create the schema

Open **SQL Editor** in the Supabase dashboard and run the migration files **in order**:
`0001_init.sql`, then `0002_fix_relationships.sql`, then `0003_questions_insert_policy.sql`.
Each one is idempotent, so re-running any of them is safe.

- tables: `profiles, materials, quizzes, questions, attempts, competency_mastery, igot_courses, recommendations`
- RLS policies on every table
- the `handle_new_user` trigger that provisions a profile on signup
- the `apply_attempt` RPC that records attempts and updates mastery (EMA)

**If your project already has the schema from an earlier version of `0001_init.sql`**,
run the later files only. They repair what earlier migrations shipped incomplete:

| Migration | Repairs | Symptom without it |
| --- | --- | --- |
| `0002_fix_relationships.sql` | the `competency_mastery → profiles` foreign key, and the `recommendations (user_id, course_id)` unique key | admin heatmap and iGOT recommendations fail with HTTP 400 |
| `0003_questions_insert_policy.sql` | the missing `INSERT` policy on `questions` (and `DELETE` on `quizzes`) | quiz generation fails after writing an empty quiz row |

Then paste and run `supabase/seed.sql` to load the 15-course mock iGOT Karmayogi catalog.

## 3. Environment variables

**Project Settings → API** — copy the **Project URL** and the **anon public** key, then:

```bash
cp .env.example .env
# edit .env:
#   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
#   VITE_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
```

(If you use the Supabase CLI you can instead run `npx supabase link --project-ref YOUR_REF`
and `npx supabase gen keys` — but the dashboard copy-paste is fine.)

## 4. Auth settings

**Authentication → Providers → Email**: enabled by default. For a smooth demo either:

- turn **Confirm email** off (Authentication → Sign In / Providers), **or**
- keep confirmation on and click the confirmation link manually.

Signup metadata (`full_name`, `department`, `designation`) is captured by the login page and
stored by the `handle_new_user` trigger.

## 4b. Security hardening (recommended before sharing the link)

The database stores passwords securely already — Supabase Auth (GoTrue) keeps bcrypt hashes in
`auth.users.encrypted_password` inside the same Postgres database, in a schema no API key or RLS
policy can read. Never copy passwords into a public-schema table. What to turn on:

1. **Minimum password length** — Authentication → Policies (or Settings → Auth):
   set **Minimum password length = 10**. The signup form already enforces 10+ chars with upper,
   lower and a number (`src/lib/password.ts`); this makes the server agree.
2. **Leaked-password protection** — same page: enable **"Check for leaked passwords"
   (HaveIBeenPwned).** Signups and password changes with known-breached passwords are rejected.
3. **Confirm email** — Authentication → Sign In / Providers: keep **"Confirm email" ON** so only
   reachable inboxes become accounts. The signup screen already handles the "check your email"
   path.
4. **Restrict email domains** — run `supabase/migrations/0006_signup_domain_allowlist.sql` in the
   SQL editor (self-verifying, safe to re-run). It adds a trigger on `auth.users` that only allows
   `@gov.in`, `@nic.in`, `@mospi.gov.in` addresses (edit the `allowed` array inside to adjust).
   Dashboard domain restriction and this trigger do the same job; the trigger also covers direct
   API signups.
5. **Forgot password (6-digit code)** — the app's "Forgot password?" flow sends a recovery
   email, then lets the officer type the **6-digit code from the email** (`verifyOtp` type
   `recovery` → session → new password). One toggle makes the email contain the code:
   **Authentication → Emails → Templates → "Reset Password"** — the default template only has
   `{{ .ConfirmationURL }}` (link). Add `{{ .Token }}` so it shows both, e.g.:

   ```html
   <p>Your COMPASS reset code is <strong>{{ .Token }}</strong>.</p>
   <p>Or click <a href="{{ .ConfirmationURL }}">reset my password</a>.</p>
   ```

   The code expires in 60 minutes; the link keeps working for officers who prefer clicking.
   If emails don't arrive, set up SMTP under **Project Settings → Authentication → SMTP**.

> ⚠️ **Don't store passwords in your own table.** A `passwords` table in `public` would be one
> misconfigured RLS policy away from exposing every officer's credentials to anyone holding the
> public anon key. Credential storage, hashing, reset and rate-limiting are GoTrue's job and it
> does them well.

## 5. Deploy the Gemini edge function

```bash
npm install -g supabase      # if the CLI isn't installed
supabase login
supabase functions deploy generate-quiz --project-ref YOUR_PROJECT_REF
supabase functions deploy embed-material --project-ref YOUR_PROJECT_REF
supabase functions deploy ask-material --project-ref YOUR_PROJECT_REF
supabase secrets set GEMINI_API_KEY=YOUR_KEY --project-ref YOUR_PROJECT_REF
```

Get a free Gemini API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
The key is stored server-side in Supabase secrets — it is **never** bundled into the frontend.

> No CLI? You can also deploy via the dashboard: **Edge Functions → Create →**
> paste `supabase/functions/generate-quiz/index.ts` → deploy, then add the secret under
> **Edge Functions → Secrets**. Do the same for `embed-material` and `ask-material`
> (their sources live in `supabase/functions/<name>/index.ts`).

### RAG — "Ask your material" (one-time setup)

1. Run `supabase/migrations/0007_material_chunks_rag.sql` in the SQL editor
   (installs pgvector, creates `material_chunks` + the `match_chunks` search RPC — self-verifying, safe to re-run).
2. Deploy the two functions listed above.
3. On the Materials page, press **Index for Q&A** on a material, then ask it questions.

### Google sign-in (optional, ~5 minutes)

1. [console.cloud.google.com](https://console.cloud.google.com) → create/select a project →
   **APIs & Services → OAuth consent screen** (External, fill the bare minimum) →
   **Credentials → Create credentials → OAuth client ID → Web application**.
2. Add these **Authorized redirect URIs** on the Google client:
   `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
   `http://localhost:5173/**` is *not* needed — Supabase brokers the flow.
3. Supabase dashboard → **Authentication → Providers → Google**: enable, paste the
   client ID + client secret, save.
4. Also add your deployed origin (e.g. `https://compassprototype2026.netlify.app`)
   under **Authentication → URL Configuration → Redirect URLs**.
5. The login page's **Sign in with Google** button now works; profiles are
   auto-provisioned by the same trigger as email signups.

> **Editing the function on disk does nothing until you redeploy it.** After any change to
> `index.ts`, run `supabase functions deploy generate-quiz`, or paste the new file into the
> dashboard editor and deploy again.

### Troubleshooting: "No Gemini model could generate the quiz"

Google retires Gemini models on a rolling basis — `gemini-1.5-flash` and `gemini-2.0-flash`
both return `404 … is not found for API version v1beta` today. The function therefore tries a
curated list of current models and then asks `/v1beta/models` which models your key can
actually call with `generateContent`, so a retired name is skipped automatically.

The Materials page shows the edge function's own error text, including a reason per model
tried. Reading it:

- `HTTP 404 … is not found for API version v1beta` — that model is retired; the function has
already moved on to the next one.
- `ListModels failed: HTTP 400/403` — the API key itself is rejected (wrong, revoked, or not
a Gemini key).
- `RESOURCE_EXHAUSTED` / `HTTP 429` — the key's free-tier quota is spent.

## 6. Make yourself an admin

Sign up in the app first, then in **SQL Editor**:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

The Admin nav item and org heatmap appear for admin accounts. Officers sign up normally and
immediately get their personal gap radar.

## 7. Demo walkthrough (what to show judges)

1. **Sign up** a new officer (name/department captured → profile auto-provisioned).
2. **Materials → Upload PDF** (any NSO/MoSPI training circular with a text layer) — text is
   extracted in-browser and stored.
3. **Generate AI quiz** (5–10 questions) — Gemini returns structured MCQs, each tagged with
   one of the 8 statistical competencies.
4. **Take the quiz** — submit → `apply_attempt` updates mastery via the explainable EMA rule.
5. **Dashboard** — readiness %, competency radar, red/amber gap chips.
6. **iGOT Karmayogi page** — courses ranked by gap urgency, one-click enroll, progress bar.
7. **Admin (as admin)** — org heatmap by department: where to spend training budget.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Missing VITE_SUPABASE_URL` on startup | Create `.env` from `.env.example` and restart `npm run dev`. |
| Quiz generation says 404 | Edge function not deployed, or wrong function name — see step 5. |
| Quiz generation says 401 | You're signed out, or the anon key in `.env` is stale. |
| Quiz generation mentions "row-level security policy" | Run `supabase/migrations/0003_questions_insert_policy.sql` — the `questions` table needs its write policy. |
| Materials list shows a quiz with `n Qs` that opens to "This quiz has no questions" | Generation failed mid-write before `0003` was applied. Delete the empty quiz row (or the material) and regenerate. |
| "GEMINI_API_KEY secret is not set" | `supabase secrets set GEMINI_API_KEY=...` (step 5). |
| PDF extraction says not enough text | The PDF is a scan without a text layer — paste the text instead. |
| Admin page says admin only | Run the role update SQL in step 6. |
| Recommendations list is empty | Take a quiz first — recommendations are gap-driven. |
