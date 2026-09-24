# COMPASS — backlog and working state

Running list of **possible changes, decisions and verified facts**, so a future session can pick up
without re-deriving anything. **Read this before starting work.** Operational procedures (how to run,
deploy, reset the demo, re-render the video) live in `freebuff/run.md` — this file is the
"what's next / what's known" list.

Last updated: **2026-09-24**, after the roadmap batch B0–B2 + blueprint item 4 (C1) was verified live.

Legend: **Done** · **Queued** (decided, next up) · **Ready** (decided, not started) ·
**Proposed** (needs a decision) · **Don't claim** (out of scope on purpose)

---

## A. Verified today — the "competency map doesn't update" fix

**Migration 0012** — `supabase/migrations/0012_apply_attempt_per_attempt_ema.sql`.
**Applied to the live database and verified end to end**; committed with the 2026-09-24 batch.

- **The bug:** `apply_attempt` weighted the **lifetime cumulative ratio**
  (`(cm.correct+new)/(cm.total+new)`). On the demo account — 10–14 attempts per competency — a quiz
  moved mastery by 0.2–4.0 points, and one axis rounded to an *identical* integer, so the radar,
  gap chips and readiness all looked frozen. It also disagreed with `src/lib/forecast.ts`, which
  derives its implied-level / plateau / threshold algebra from `m_n = 0.6·m_{n-1} + 0.4·s_n`
  (per-attempt score) — the forecast panel was projecting from a formula the DB wasn't running.
- **The fix:** `mastery := 0.6·old + 0.4·(this attempt's correct/total)·100`. Return columns are
  unchanged, so the 0008 grants survive; re-running `0005` reverts it.
- **Evidence (one real perfect attempt, 5/5 on the seeded CPI quiz):**
  Sampling **33.28 → 59.97** (+26.69; the old rule gave **+0.02**), Data Quality & Validation
  68.13 → 80.88, Field Ops 71.70 → 83.02, Survey Methodology 77.91 → 86.75 — every value exactly
  `0.6·old + 40`.
- **Live UI agreed** (Vercel, guest session): readiness **57% → 64%**, top strength 78% → **87%**,
  Sampling's forecast verdict flipped from *Plateau* to *Catching up*.

⚠️ **The verification attempt is real.** The guest account now has an extra 5/5 at the top of its
history. Re-run `supabase/guest_setup_one_paste.sql` to restore the pristine six-attempt baseline —
it is idempotent and doubles as the between-judges reset.

---

## B. Delivered 2026-09-24 — the queued batch, verified live

- **B0 · The EMA twin now matches the database.** `gapEngine.masteryFromCumulative(old, correct,
  total)` became `masteryFromAttempt(oldMastery, attemptPercent)`, and its docstring names migration
  0012 — until now the TypeScript rule still averaged the *lifetime cumulative* ratio while the
  database had moved to the per-attempt one, so the two "twins" disagreed. Tests updated, including
  a regression case using the demo account's real Sampling numbers. `Training.tsx`'s caption said
  "cumulative performance" and now says "the score of the attempt you just took".
- **B1 · Result screen shows the movement.** `QuizRunner` used to discard the rows `apply_attempt`
  returns (`void data;`). It now snapshots the profile *before* submitting (one extra read — the
  network trace shows the `GET competency_mastery` immediately before the RPC `POST`), then renders
  `Overall readiness 54% → 62%` plus `Sampling 76% → 86% ▲` per competency, with ▼ for a drop and a
  grey dash for no change; exact values live in each row's tooltip.
  **Verified live on the guest session with a 5/5 attempt.** From the result screen:
  readiness 54 → 62, Survey Mgmt 52 → 71, Data Quality 49 → 69, Field Ops 50 → 70,
  Sampling 76 → 86 — every after-value exactly `0.6·old + 40`. The dashboard then agreed:
  readiness **62%**, gaps **6 → 3**, top strength Sampling **86%**. Console clean throughout.
  A failed pre-submission snapshot degrades honestly: the readiness line is omitted rather than
  claiming `0% → 62%`.
- **B2 · A gap can no longer read as the bar.** New `displayMastery()` in `lib/competencies.ts`
  (unit-tested, 4 cases) renders 59.97 as `59`, so a chip can no longer sit next to
  `below 60% mastery` while reading `60%`. Applied to the Dashboard (gap chips + top strength),
  AI Training, and the forecast panel.
- Also in the batch: removed the last lint warning (a dead `startTime` in
  `scripts/record-walkthrough.js`), so `npm run lint` is now `0 warnings, 0 errors`.

---

## C. Blueprint roadmap (SIH) — what's left

- **C1 · Scenario-based assessment questions (blueprint item 4) — DONE 2026-09-24.** Both
  generators now issue one scenario contract: `backend/app/quiz.py::build_prompt` and
  `supabase/functions/generate-quiz/index.ts::buildPrompt` (checked line-for-line after normalising
  each language's interpolation syntax — the only structural difference is the pre-existing tag-list
  line, and both interpolate the same `", "`-joined quoted list). Every question must be a workplace
  situation with a decision to make, grounded in the material, with distractors that are plausible
  officer mistakes and no definitional recall. **No schema change and no migration** — the scenario
  lives in `text`, and `explanation` now says which part of the material justifies the action and
  why the tempting wrong option fails. The backend test's assertions (count, material text,
  `"hard"`, every tag) still pass, verified by importing `app.quiz` directly because pytest is not
  installed in this environment. **Not yet exercised against the live model** — it costs a Gemini
  call, so the next real generation is the first scenario-style quiz. If questions come back
  definitional, the prompt text is the lever.
- Done earlier: item 1 forecast panel · item 2 guest access · item 3 admin user directory.

---

## D. Deck claims the code doesn't back — build or reword

- **D1 · Bloom / cognitive-level tagging.** Slide 4 claims every question is tagged
  Recall / Application / Analysis. There is **no such field** anywhere — questions carry
  `competency_tag` and `easy|medium|hard` only. Either add `cognitive_level` to both generators
  plus a chip on the review screen, or reword the slide.
- **D2 · NSSTA human-in-the-loop review.** Slide 4 claims trainers review and approve AI questions
  before they go live. There is **no approval state and no review UI**. Either build a minimal
  `draft → approved` flag with a review queue reusing the admin page, or mark it "planned".

---

## E. The iGOT disadvantages — honest sizing (asked and answered 2026-09-23)

| iGOT disadvantage | Can COMPASS solve it? |
| --- | --- |
| Content overload / finding relevant courses | **Yes — already the product.** Gap engine + ranked recommendations. |
| Technical issues / server problems | **Largely yes — already built** (see below). |
| Internet dependency | **About half.** Buildable: PWA-lite offline (E1). AI always needs network. |
| Digital skills required | **No** — only lowered entry bar (guest one-click, plain UI). |
| Limited personal interaction | **No** — self-serve by design; D2 is process, not learner contact. |
| Device requirement | **No** — browser-only and responsive; barrier reduced, requirement unchanged. |

**Server-problem mitigations already true:** backup servers (dual AI runtime with automatic
failover in `src/lib/ai.ts`), monitoring (`/healthz` + Render health checks + CI), regular
maintenance (CI gates, idempotent migrations), cloud scaling (managed Supabase + Render autoscale).
**Still open:** load balancing is provider-managed only (we built failover, not balancing);
high-capacity servers (free tier sleeps after ~15 min idle, ~50 s cold start).

- **E1 · PWA-lite offline tolerance** *(Ready — largest item)*. Service worker caching the app
  shell, opened materials readable offline, a generated quiz completable offline with the attempt
  queued and submitted on reconnect, honestly labelled in the UI. Half-solves internet dependency.
- **E2 · Cold-start killer** *(Ready — small)*. Fire-and-forget warmup ping to the API when the app
  opens, plus a visible "AI service waking — fallback ready" state instead of a silent ~50 s stall.
- **E3 · External uptime ping** *(Proposed)*. A scheduled ping of `/healthz` would make the
  "24/7 monitoring" line literally true.

---

## F. Demo & ops housekeeping

- **F1 · Guest baseline reset — now overdue.** Re-run `supabase/guest_setup_one_paste.sql`
  whenever the demo has been quizzed into a different state. The guest account currently has **8
  attempts instead of the seeded 6**, because two of my verifications submitted real quizzes (the
  0012 check and the B1 result-screen check, both 5/5). One paste, no edits; PART 3.0 deletes any
  attempt outside the seeded six and re-asserts mastery.
- **F2 · Netlify is manual-deploy only.** The user set the "Ignored build step" to `exit 0`, so git
  pushes no longer build there. To refresh it: build locally, then **drag `dist/`** onto the site's
  Deploys tab (no build minutes) or **Trigger deploy → Clear cache and deploy site**. Netlify build
  minutes reached **75%** before this — hence the rule: **batch commits per roadmap item, and ask
  before pushing.**
- **F3 · AI transport differs per host.** Vercel → the Render FastAPI service; Netlify → the
  Supabase edge functions. Both work, but a decision would be good (set `VITE_API_BASE_URL` on
  Netlify too, or keep the edge functions as the fallback path).
- **F4 · Untracked files.** `COMPASS_final.pptx` plus five `.pre-*` backups, and
  `supabase/migrations/0012_*.sql`, are all untracked. Decide: commit the final deck and the
  migration, delete the backups, or keep the deck out of the repo.
- **F5 · Deck edits need tooling.** `python-pptx` is **not** installed on this machine (the earlier
  deck edits left no script behind). A programmatic deck edit needs a throwaway local venv, or the
  deck gets edited in PowerPoint by hand.

---

## G. Don't claim (honesty guard for judges)

Do not present these as solved, anywhere in the deck or docs: device independence, digital-skills
training, trainer/mentor interaction, offline AI generation, app-level load balancing, or
high-capacity servers. State them as acknowledged constraints — self-awareness reads better than a
gap a judge discovers.
