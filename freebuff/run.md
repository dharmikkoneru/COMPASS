# Run doc — COMPASS / SIH26101

This thread's workspace already contains the installed `node_modules` and a built `dist/`.

## How to reproduce the artifacts

A fresh checkout needs dependencies before the dev server can start:

```bash
npm install   # installs deps from package.json; installs to node_modules/
```

No pre-commit artifacts are required — `dist/` is produced by `npm run build` and exists already in
this worktree. No `.env.local` is needed for the dev preview (the `.env` is `.gitignore`d; an
empty or placeholder `.env` makes the site show the "One-time setup required" screen, which is the
intended first-run behavior).

`.env` holds live `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` values, so the routed app (not the
setup screen) is what loads, against a real Supabase project.

Status as of 2026-09-17 — generation is fixed and verified live; submission has one remaining DB
blocker:

1. **✅ 0003 RLS policies: applied and verified.** A real insert into `questions` under the
   signed-in user's own quiz now succeeds (was `42501`), and two 5-question quizzes generated
   end-to-end from the pasted material.
2. **✅ `generate-quiz` redeploy: landed and verified.** Generation succeeds with the fixed model
   list (`gemini-3.x` preferred; retired `2.5` names kept last), 503 retry, and a deadline that is
   raced locally rather than trusted to `AbortSignal.timeout`. No further deploy needed unless the
   function source changes again.
3. **✅ 0004 (applied 2026-09-17): fixed the 42702** — `apply_attempt` declares
   `returns table (competency_tag, ...)`; PL/pgSQL output columns are variables that shadow
   same-named table columns, so the bare `on conflict (user_id, competency_tag)` target couldn't
   resolve. 0004 retargets `on conflict on constraint competency_mastery_pkey`. NB: PL/pgSQL
   `RAISE` messages must be a single string literal — `'a' || 'b'` in a RAISE is a syntax error
   (42601) when the block compiles.
4. **✅ 0005 (applied 2026-09-17): the second latent bug in the same function.** In
   `on conflict do update set`, SET expressions may reference the target (cm) and EXCLUDED only,
   never the source CTE the proposed rows came from — the originals referenced
   `per_tag.q_correct`/`per_tag.q_total`, so every submission failed with `42P01: missing
   FROM-clause entry for table "per_tag"`. 0005 rewrites the expressions against
   `excluded.correct`/`excluded.total` (EXCLUDED carries the proposed row) with an explicit
   `::numeric` cast.

**The full loop is verified working end-to-end (2026-09-17):** generate → real questions →
submit → RPC applies mastery via EXCLUDED upsert → review screen shows per-question explanations
→ Dashboard attempt history lists the attempt with score and relative timestamp. Mastery math
validated against the dashboard: first attempt 40%, second attempt 0.6*40+0.4*100 = 64%, overall
mean (64+64+64)/8 = 24%.

How it was checked: `import('/src/lib/supabase.ts')` from the browser console (or a preview_evaluate)
gives the app's authenticated client, which is enough to probe both halves without the service
role:

```js
const { supabase } = await import('/src/lib/supabase.ts');
await supabase.from('questions').insert({ quiz_id, idx: 99, text: 'probe', options: ['a','b','c','d'],
  correct_idx: 0, explanation: 'p', competency_tag: 'Survey Methodology', difficulty: 'easy' });
```

A `42501` means 0003 is not live. Note that `quizzes_delete` is missing alongside `questions_insert`,
so a failed generation cannot roll back the quiz row it inserted — that is what leaves "5 Qs →"
rows that open onto "This quiz has no questions".

## Deployment (Netlify)

The prototype is deployed at `https://compassprototype2026.netlify.app` by drag-and-dropping
`dist/` (no git repo, no CLI state). Two pitfalls fixed on 2026-09-17:

- **Deep links 404'd** (`/login` → Netlify 404) because no SPA fallback existed.
  `public/_redirects` (`/*  /index.html  200`) now ships into every build, and `netlify.toml`
  documents the build for a future CLI/Git setup.
- **The live bundle can go stale**: the site was serving the Sep-14 `dist/` (pre-theme, pre-fixes).
  Always `npm run build` immediately before dragging `dist/` — check the live asset hash in the
  served `index.html` matches `ls dist/assets/*.js`.

Note: `VITE_SUPABASE_URL`/`ANON_KEY` are baked into the bundle at build time. That is normal
(anon keys are public by design), but it means RLS is the only thing standing between the
internet and this project — open signups are enabled, so anyone can create an account.

## Auth hardening, round 3 — OTP forgot-password (2026-09-18)

Forgot-password is now two-stage: email → **6-digit code typed from the recovery email** →
`verifyOtp({ type: 'recovery' })` grants the recovery session → `/reset-password` sets the new
password. Resend has a 60s cooldown; invalid/expired codes get a friendly error. **Depends on
one dashboard edit:** the recovery email template (Authentication → Emails → Templates →
"Reset Password") must include `{{ .Token }}` alongside `{{ .ConfirmationURL }}` — without it
the email has only the magic link and no code (documented in SUPABASE_SETUP.md §4b.5). Verified
live: stage transition, real recovery email sent, resend cooldown ticking, wrong code rejected
with "invalid or has expired". The link path still works unchanged.

## Auth hardening, round 2 (2026-09-18)

- **Login throttle**: `src/lib/loginThrottle.ts` — per-email sliding window, 5 failures / 5 min
  in localStorage, lock message with remaining time, cleared on success. Unit tested with a
  store seam (`setFailureStoreForTests`) so tests never touch localStorage. Client-side only —
  the hard wall is GoTrue's built-in per-IP/email rate limits.
- **Settings page** (`/settings`, in Navbar): profile summary + change password that
  re-authenticates (signInWithPassword with the current password) before `updateUser`. The
  current-password check runs first, so a wrong current password never reaches the update.
- Verified live: lock message "Too many failed attempts. Try again in 4m 55s.", failure counter
  "(4 attempts left)", sliding-window expiry, /settings rendering with profile data,
  /reset-password guard and forgot-password email path (earlier round).

## Auth hardening (2026-09-18)

Signup now enforces a 10+ char password with upper/lower/digit (`src/lib/password.ts`, unit
tested, strength meter on the form); a forgot-password flow exists (Login "Forgot password?" →
`resetPasswordForEmail` → `/reset-password` sets the new password via `updateUser`); migration
`0006_signup_domain_allowlist.sql` adds a self-verifying trigger on `auth.users` allowing only
gov.in / nic.in / mospi.gov.in signups (edit the `allowed` array to change). Two dashboard
toggles remain manual: min password length 10 + HaveIBeenPwned check (Authentication → Policies)
and Confirm email ON — documented in SUPABASE_SETUP.md §4b. Passwords stay bcrypt-hashed in
`auth.users` (GoTrue); never copy them into a public-schema table.

## Walkthrough video + voice-over

`docs/walkthrough.mp4` (silent, 2:18, 1080p) is rendered by driving `docs/walkthrough.html?once`
(headless Chrome via Playwright, CDP screencast) and muxing with ffmpeg-static:

```bash
node scripts/render-walkthrough.mjs   # needs `npx playwright install ffmpeg` once
```

`docs/walkthrough-vo.mp4` adds narration, regenerated by:

```bash
python scripts/make_voiceover.py      # needs: python -m pip install edge-tts
```

The script synthesizes one edge-tts segment per scene (voice `en-IN-PrabhatNeural`, rate +12%),
measures each segment with ffmpeg, and **fails loudly if narration exceeds the scene budget**
(0.2s minimum slack) — that gate caught five overruns on the first pass. Scene start offsets and
durations in the script must mirror the `data-dur` attributes in `docs/walkthrough.html` (9–14s
each, total 137s); if slide timings change there, update `SCENES` and `TOTAL_MS` before re-running.
Segments are mixed at offsets (adelay + amix, loudnorm -16 LUFS, fade-out) and muxed onto the video
with `-c:v copy` — the video stream is never re-encoded. Tweak narration text freely; the tool
re-synthesizes and re-checks timing every run.

## How to run the dev server

```bash
npm run dev
```

Vite reads `--host` flags from the environment if set; otherwise it listens on localhost and picks
the default port. The Preview tab in this thread points at the live dev server started from this
worktree.

For a production preview (no source transforms, serves `dist/`):

```bash
npm run build && npm run preview
```

## Notes

- `npm run lint` runs `oxlint`; `npm test` runs `vitest run`; `npx tsc -b` typechecks.
- `src/lib/quizCounts.ts` derives how many questions a quiz really holds, because
  `quizzes.question_count` is written before the questions are. `questions(count)` as a PostgREST
  embed is not usable for this: it is an INNER join, so it hides the very empty quizzes it should
  expose. Counting this way costs one extra `select` on `questions`.
- The app's first-run gate is `src/lib/supabase.ts`: if `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` are both set in the Vite environment, the routed app (auth, pages)
  loads; otherwise it renders `SetupRequired`. There is no `.env` committed, so a clean checkout
  hits the setup screen.

## Blueprint completion (Sept 18, 2026)

Built against the SIH $0-stack blueprint (React/Supabase/Gemini/CI/Docker):

- **RAG — "Ask your material"** (`0007_material_chunks_rag.sql`, `embed-material`,
  `ask-material`, `src/components/AskPanel.tsx`, `src/hooks/useAsk.ts`):
  chunk (~700c, 120c overlap) → `text-embedding-004` (768-d) → `material_chunks`
  → `match_chunks` cosine RPC → grounded flash answer with cited passages.
  **Requires:** run 0007 in the SQL editor + `supabase functions deploy embed-material ask-material`.
  Until then the Index button reports the exact missing step (self-diagnosing errors).
- **Google OAuth** — button on Login (`signInWithOAuth`); needs the Google Cloud client +
  Supabase provider toggle, click-path in SUPABASE_SETUP.md §5.
- **CI** — `.github/workflows/ci.yml` (tsc + oxlint + vitest on push/PR).
- **Containers** — `Dockerfile` (multi-stage nginx), `nginx.conf`, `docker-compose.yml`
  (port 8080), `k8s/compass.yaml` (Deployment+Service for Minikube).
- **Git** — repo initialized on `main`, initial commit `3e7edd2` (104 files;
  secret-scanned; `.freebuff/` ignored). Remaining: create the GitHub repo,
  `git remote add origin <url> && git push -u origin main`, connect it in Netlify
  (Import from GitHub) to retire drag-and-drop deploys.
- **Production build refreshed** — `dist/` contains the RAG panel, OAuth button,
  and `_redirects`; re-drag `dist/` (or push, once Netlify is git-connected) to
  update the live site.

## FastAPI AI service + Vercel (Sept 19, 2026)

AI now lives in a Python FastAPI service (`backend/`) deployed on **Render**, with the
Supabase edge functions kept as a runtime fallback chosen in `src/lib/ai.ts`. Vercel was
added as a second frontend host; Netlify is untouched and still deploys. Nothing about the
UI changed except the transport behind it.

### Reproduce the backend artifacts

```bash
cd backend
python -m venv .venv                                  # POSIX: .venv/bin/python
./.venv/Scripts/python -m pip install -r requirements-dev.txt
cp .env.example .env   # SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY
```

The venv is per-machine and gitignored. Pinned Python 3.12 on Render (`render.yaml`);
this machine runs 3.14 and the suite passes on it.

### Run the API

```bash
cd backend && ./.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

`GET /healthz` answers `{"status":"ok",…,"configured":true}`; `/docs` is FastAPI's
generated reference. **Port 8000**: 5173 (Vite) and 4173 (`vite preview`) are taken.

Point the app at it with `VITE_API_BASE_URL=http://127.0.0.1:8000` in the root `.env`,
then restart the Vite dev server — Vite bakes env vars at startup, so a running server
will not pick it up. Leave it unset and the edge functions answer, exactly as before.

### Checks

```bash
cd backend && ./.venv/Scripts/python -m pytest        # 49 tests
cd backend && ./.venv/Scripts/python -m ruff check .  # clean
```

Both run in CI as the `api` job (the app's `verify` job is unchanged).

### Verified locally, 2026-09-19

- `uvicorn` boots; `/healthz` reports `configured: true` against the real project values
- CORS preflight from `http://localhost:5173` → 200, origin echoed, `Authorization` allowed
- no token → `401 {"error":"Not authenticated"}`; malformed token → 401 naming the reason
- app: `tsc` clean, oxlint 0 warnings, **72/72 vitest** (13 of them new, covering the
  transport choice, the fallback rules, and FastAPI's error shapes)

**Still unverified:** the real RAG round trip *through Python*. It needs `GEMINI_API_KEY`
available to the service (Render env or `backend/.env`); today that key exists only as a
Supabase secret, so the local service can boot and authenticate but cannot call Gemini.

### Security fix — migration 0008 (needs applying)

Probing the deployed database as `anon` with the public key returned `[]` from
`POST /rest/v1/rpc/match_chunks` instead of a permission error. Cause: `create function`
grants EXECUTE to the **PUBLIC pseudo-role**, so 0007's `revoke … from anon` removed
nothing. `match_chunks` is `SECURITY DEFINER` with a caller-supplied `p_user_id`, so any
officer could name another officer's id and read their indexed passages.
`0008_lock_down_rpc_execute.sql` adds `and p_user_id = auth.uid()`, revokes EXECUTE from
PUBLIC and anon (re-granting `authenticated`), does the same for `apply_attempt`, and
verifies the real ACLs via `pg_proc` — raising if anything is still open. Run it in the SQL
editor; afterwards `anon` must get a permission error from `match_chunks`.

Also fixed: `_shared/gemini.ts` no longer hard-codes the retired `text-embedding-004`.
It now tries `gemini-embedding-001` (with `outputDimensionality: 768`) first, keeps the
legacy name last, and discovers `embedContent` models — the same shape `backend/app/gemini.py`
uses. **Redeploy `embed-material` and `ask-material`** or the fallback path stays broken.

## Mastery rule corrected, and Netlify is manual-deploy (Sept 23, 2026)

- **`apply_attempt` now weights the current attempt.** Migration
  `0012_apply_attempt_per_attempt_ema.sql` (applied and verified live) replaces the lifetime
  cumulative ratio with the attempt's own ratio, so the rule the app documents is the rule the
  database runs:

  ```
  mastery := 0.6 * old_mastery + 0.4 * (this attempt's correct / total for that competency) * 100
  ```

  Before this, mastery moved by 0.2–4.0 points per quiz on the demo account (10–14 attempts per
  competency) and one axis rounded to an identical integer, so the radar looked frozen. Verified
  with a real 5/5 attempt: Sampling 33.28 → 59.97 (+26.69; the old rule gave +0.02) and readiness
  57% → 64% in the live UI. `attempts` / `correct` / `total` stay **lifetime** counters. Re-running
  `0005_fix_apply_attempt_excluded.sql` reverts to the old rule.
- **Guest demo reset.** After any demo quizzing (a verification attempt is a real row), re-run
  `supabase/guest_setup_one_paste.sql` in the SQL editor: idempotent, one paste, restores the
  pristine six-attempt baseline. It doubles as the between-judges reset.
- **Netlify builds are disabled.** The site's "Ignored build step" is set to `exit 0`, so pushes no
  longer build there (build minutes had reached 75%). To refresh it: `npm run build`, then drag
  `dist/` onto the site's Deploys tab — no build minutes — or **Trigger deploy → Clear cache and
  deploy site**. Vercel still deploys automatically on every push, so batch commits per roadmap
  item and ask before pushing.
- Pending changes and their verified status live in **`BACKLOG.md`** at the repo root.

## Resilience and the live demo (Sept 25, 2026)

- **The timed live-demo script is `docs/run-of-show.md`** — the judge path, the measured timings
  (generation 19.4 s warm, submit 1.65 s, cold start 33.7 s) and a recovery line for every failure
  mode. Read it before presenting.
- **The app now warms the AI service itself.** `StatusBanner` pings `GET /healthz` on every route, so
  a slept Render instance boots while the officer reads the dashboard instead of while a judge
  waits. The ~50 s cold start is *named in the UI* rather than shown as a bare spinner. Measured
  baseline: **33.7 s** to first byte when the instance was asleep.
- **A submission that never reaches a server is queued, not failed.** `lib/attemptQueue.ts` keeps it
  in localStorage **per user id**; `usePendingAttempts` retries on sign-in and on the link coming
  back, oldest first, through the same `apply_attempt` RPC. Only transport failures are queued — a
  Postgres refusal is still reported, because a request the server will refuse forever must not
  become a silent pile of unsent work. The review screen shows the score and says the mastery
  movement will appear once it syncs; nothing is invented.
- **Cognitive-level tags (D1).** Migration `0013_question_cognitive_level.sql` adds
  `questions.cognitive_level`; run it in the SQL editor, then re-paste
  `supabase/guest_setup_one_paste.sql` (v7) to tag the fifteen seeded questions. Until then
  generation still works — both write paths drop the tag instead of failing — but no chips render.
- **Rehearsing without drifting the demo:** `python .freebuff/guest_probe.py snapshot <name>` before,
  `restore <name>` after. It uses the guest's own credentials over PostgREST, so RLS constrains it
  exactly as it constrains the app — no service-role key. `status` prints what a judge would see.
  The one-paste SQL in `supabase/guest_setup_one_paste.sql` is still the canonical reset (it also
  repairs the account and its identities); the probe exists for rehearsals, not for judging.
