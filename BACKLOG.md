# COMPASS — backlog and working state

Running list of **possible changes, decisions and verified facts**, so a future session can pick up
without re-deriving anything. **Read this before starting work.** Operational procedures (how to run,
deploy, reset the demo, re-render the video) live in `freebuff/run.md` — this file is the
"what's next / what's known" list.

Last updated: **2026-09-25**, after the resilience batch (section I), the cognitive-level tagging the
slide used to only claim (D1, now built) and the human-review claim it now honestly marks as planned
(D2). Pushed in one batch: Vercel and Render redeploy from git, Netlify stays manual.

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

## D. Deck claims the code didn't back — both resolved 2026-09-25

- **D1 · Bloom / cognitive-level tagging — BUILT** (the slide is now true, so it was not reworded).
  Migration `0013_question_cognitive_level.sql` adds `questions.cognitive_level text` with a check
  constraint for `Recall | Application | Analysis`; `COGNITIVE_LEVELS` is declared in
  `backend/app/quiz.py`, in the edge function, and in `src/lib/cognitive.ts`, and all three lists
  match the constraint. Both generators now require the field in their response schema and ask for
  it in the prompt — **and the two prompts are still byte-identical**, which is now *verified*
  rather than eyeballed (`.freebuff/check_quiz_contract.py`, see the caveat in §I). The UI shows a
  chip while answering and in the review list, with a tooltip explaining what each level means.
  Deliberate honesty rules: a misspelled level (`"analysis"`) is normalised, but an unrecognised one
  (`"Evaluation"`) becomes **null, never a guess**, and a null level renders **no chip** — which is
  also the state of every pre-0013 row.
- **D2 · NSSTA human-in-the-loop review — REWORDED as planned**, not built. Slide 4's heading now
  reads "Expert Approval Workflow (Roadmap)", its body opens "Planned next:", and the summary line
  reads "keeps a person, not the model, in control once that step ships". There is still no approval
  state and no review UI — do not claim one on stage.

**D1 verified live, 2026-09-25** — the user ran `0013` and the v7 reset, and all three layers were
confirmed afterwards:

- **The database:** `15/15` seeded questions carry `cognitive_level`, all `Recall`, which is what they
  honestly are.
- **The UI:** the deployed Vercel build renders the chip on the seeded quiz — `Recall`, uppercased by
  CSS, with the tooltip *"The material states this rule or figure — the question checks it was
  recognised."*
- **A real generation through the deployed Render API:** `HTTP 200 in 32.1s`, three questions tagged
  `{Recall: 2, Application: 1}` — **not all the same level**, so the tag discriminates rather than
  defaulting — and all three scenario-shaped, this time from the Data Quality material rather than
  the CPI one (a third independent confirmation of C1, across a different document). The verification
  quiz was deleted afterwards: guest back to `3/3/15/6`, 8 mastery rows and 5 recommendations
  unchanged.

**If a fresh quiz comes back with every level NULL**, that is a stale Render deploy rather than a code
bug — the tolerant write drops the tag whenever the column is absent. `.freebuff/verify_generation_levels.py`
makes that distinction explicitly and cleans up after itself.

**Deck edit method (F5 said this needed a venv — it does not):** `.freebuff/reword_slide4.py` unzips
`COMPASS_final.pptx`, rewrites the run text in `ppt/slides/slide4.xml`, and copies every other member
across byte-for-byte — verified afterwards that slides 1/2/3/5/6 are hash-identical and the archive
still opens. Backup: `COMPASS_final.pre-d2-reword.pptx`. **Nobody has looked at slide 4 in PowerPoint
since**: the new sentence is a little longer than the one it replaced, so check it for overflow. The
`Team ID-` field on slide 1 is still blank — the user is filling that in themselves.

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

- **E1 · PWA-lite offline tolerance** *(Partly done 2026-09-25 — see section I)*. Built: attempts
  **queued** on the device when a submission never reaches a server, with an honest review screen
  and a status strip that retries on reconnect. **Still open:** a service worker caching the app
  shell, and opened materials readable offline — so a *reload* with no network still fails. The AI
  half is impossible by design and stays out of any claim.
- **E2 · Cold-start killer** *(Done 2026-09-25 — see section I)*. The app pings `/healthz` on load
  and names the cold start in the UI instead of leaving a bare spinner. Measured cold start to work
  against: **33.7 s**, so a cold first generation costs ~55 s against ~20 s warm.
- **E3 · External uptime ping** *(Proposed)*. A scheduled ping of `/healthz` would make the
  "24/7 monitoring" line literally true.

---

## F. Demo & ops housekeeping

- **F1 · Guest baseline reset — now genuinely one-paste (v6).** Re-run
  `supabase/guest_setup_one_paste.sql` whenever the demo has been quizzed into a different state.
  Verified back to pristine on 2026-09-24: materials 3 · quizzes 3 · questions 15 · attempts 6
  (scores 5,3,4,3,5,4; newest 97 h old) · mastery 8 (82/78/70/63/55/50/42/35) · recommendations 5.
  Two things the script could NOT do before today's fixes: v5 deletes the guest's own quizzes and
  materials outside the seeded set (its inserts are `ON CONFLICT DO NOTHING`, which only ever adds —
  the account had drifted to 6 quizzes / 14 attempts), and **v6 prunes recommendations** outside the
  five seeded courses before re-asserting them (demo enrolments had grown it to 12). Both deletes
  cascade or are guest-owned; nothing belonging to a real officer is touched.
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
  migration, delete the backups, or keep the deck out of the repo.- **F5 · Deck edits need tooling.** `python-pptx` is **not** installed on this machine (the earlier
  deck edits left no script behind). A programmatic deck edit needs a throwaway local venv, or the
deck gets edited in PowerPoint by hand. (The deck's XML can be *read* with the standard library —
  `zipfile` + a regex over `ppt/slides/slideN.xml` — which is how F6 was confirmed.)
- **F6 · The title slide's Team ID is blank.** Slide 1 reads `Team ID-` with nothing after it, in the
  photo *and* in the file. **Needs the team's actual ID** — only the team can supply it. The other
  four fields (Problem Statement ID SIH26101, Theme Smart Education, PS Category Software, Team Name
  Build Horizon) are correct and match the official slide.
- **F7 · Run-of-show + a rehearsal tool that leaves no trace.** `docs/run-of-show.md` is the timed
  live-demo script with measured numbers and recovery lines. `.freebuff/guest_probe.py`
  (`status`/`snapshot`/`restore`) checkpoints and rolls back the guest account over PostgREST using
  the guest's own credentials — so a rehearsal no longer drifts the demo (verified: restored to
  3/3/15/6/8-mastery/5-recommendations exactly). It is gitignored; promote it to `scripts/` if
  rehearsals become routine.

---

## I. Resilience batch — queue, warm-up, status strip (2026-09-25)

Built for the "venue wifi fails mid-demo" risk. **In the tree and green; NOT pushed**, so none of it
is on the deployed hosts yet.

- **Attempts survive a dead network.** `src/lib/attemptQueue.ts` keeps failed submissions in
  localStorage **per user id** (the shared guest account must never see a real officer's unsent
  work), capped at 20, drop-oldest. `src/hooks/usePendingAttempts.ts` flushes them oldest-first
  through the **same `apply_attempt` RPC** as the online path, so a synced attempt is
  indistinguishable from one that never left the device. `QuizRunner` queues only genuine transport
  failures (`isOfflineError`) — a Postgres refusal is still shown as an error, because queueing
  something the server will refuse forever turns one clear error into a silent pile of unsent work.
  The review screen then shows the real score with **no invented mastery movement**, plus "will
  submit itself when you are back online".
- **`src/components/StatusBanner.tsx`** renders nothing when all is well, and otherwise says offline
  / syncing / synced / *AI service starting (≈1 min)* / *API not responding, using the backup path*.
  It is also what warms the API (the one component mounted on every route).
- **`src/lib/ai.ts` gained a service status** (`unknown|edge|waking|awake|unreachable`), a
  `subscribeAiServiceStatus` store, and `warmAiService()`. Two decisions worth keeping: the probe is
  **never aborted** (the open request is what boots a sleeping container, so cutting it at 2.5 s can
  stop the very boot it exists to start), and real call outcomes fold back into the status, so the
  banner stays true even if the warm-up was stale.
- **Generation UX:** `Materials.tsx` keeps the failed request and offers **Try again** unchanged, and
  counts seconds, explaining a long wait by whether the service was waking. `useMaterials` now owns
  `generatingSince` — the timestamp belongs where the transition happens.
- **Tests:** **142/142** (`connectivity.test.ts`, `attemptQueue.test.ts`, and five new
  `warmAiService` cases). `tsc -b` clean, oxlint **0 warnings 0 errors** — the four new warnings the
  first draft produced were all real `setState`-in-effect smells, fixed by deriving (`showSynced`
  from `syncedCount`), by `useSyncExternalStore` (`useOnline`), and by a render clock (`GeneratingNote`).
- **Bug the tests caught:** `navigator.onLine` is `undefined` in a non-browser environment, so
  `browserIsOnline()` returned `undefined` instead of a boolean. Now only an explicit `=== false`
  counts as offline.
- **Correction worth keeping: the backend suite DOES run here.** Earlier notes said `pytest` was
  missing — that was the *global* interpreter. `backend/.venv/Scripts/python.exe -m pytest -q` runs
  the real 63-test suite, and `./.venv/Scripts/python.exe -m ruff check .` is clean. Run both from
  `backend/` before believing anything about the API; do not rely on "CI will catch it".
  (`.freebuff/check_quiz_contract.py` is still useful for one thing CI cannot do: it proves the Python
  and TypeScript prompts are byte-identical after substituting each language's interpolation.)
- **The tolerant write is verified against the real PostgREST, not just a fake.** The deploy lands
  before migration 0013, so `insert_questions` has to recognise the refusal. A live probe of the
  actual database returned exactly what the code expects — HTTP 400, `code: PGRST204`, message
  `Could not find the 'cognitive_level' column of 'questions' in the schema cache` — and the question
  count on the seeded quiz was **5 before and 5 after**, so the probe itself wrote nothing.
  `backend/tests/test_api.py` now also proves the retry stores the same questions untagged (nothing
  else lost, no rollback) **and** that a refusal for any other reason is still reported once and
  rolled back rather than retried.

### Browser verification, 2026-09-25 — the new code, driven for real

Unit tests cannot show that the queue is reachable from the UI or that the banner reacts to a
failure, so the whole cycle was driven in a real browser against the local dev server:

- `window.fetch` was patched to reject **only** `rpc/apply_attempt`, with `TypeError: Failed to
  fetch` (Chrome's own wording). Submitting then produced **no red error**: the review screen showed
  the score, the amber *"saved on this device and will submit itself"* line, *"Mastery movement will
  appear here once the attempt syncs."*, and a link reading *Back to dashboard* — and
  `compass.pendingAttempts.<user_id>` appeared in localStorage.
- The status strip rendered **"1 attempt is saved on this device and will sync automatically."** with
  a **Sync now** button.
- Restoring `fetch` and pressing **Sync now** submitted the attempt **for real** (a `0/5` row did
  appear in the database), removed the storage key, and switched the strip to **"1 saved attempt
  synced — your mastery is updated."** So the flush is the same RPC on the same data, not a lookalike.
- Dispatching a genuine `offline` event swapped in the red strip (*"You're offline. Screens you have
  already opened keep working…"*), and `online` cleared it — the `useSyncExternalStore` wiring is
  live, not merely correct on paper.
- The account was restored to the pristine baseline again afterwards (3/3/15/6 · 8 mastery rows · 5
  recommendations, every value unchanged).

### Dress rehearsal, 2026-09-25 — measured on the deployed build

The judge path was walked end to end on `https://compass-tawny-five.vercel.app` as the guest, with
the account snapshotted first and **restored to the exact pristine baseline afterwards** (3 materials
· 3 quizzes · 15 questions · 6 attempts · 8 mastery rows · 5 recommendations — verified identical).

- Guest entry is **one click**, no password. Dashboard read 59% / 4 gaps / Field Ops 82% / 6 attempts.
- **Generation: 19.4 s** warm, served by the **Render FastAPI** path (`POST
  https://compass-api-fm5s.onrender.com/api/ai/generate-quiz → 200`, CORS preflight 200 — section H
gates hold). New quiz landed as *"Consumer Price Index Field Operations and Quality Control"* with 5
  stored questions.
- **Blueprint item 4 holds on the deployed build:** the fresh question was a workplace decision
  ("a field supervisor… what proportion of the submitted schedules must the supervisor verify?"),
  not a definition — a second independent confirmation of C1.
- **Submission: 463 ms** for the pre-submission profile read + **1.19 s** for `apply_attempt`. Result
  screen showed `63%→78% ▲`, `82%→49% ▼`, `42%→25% ▼`, `50%→70% ▲`, `55%→33% ▼` and readiness
  **59% → 55%** — every value exactly `0.6·old + 0.4·(ratio·100)`; the dashboard then agreed (55%,
  4 gaps, the attempt at the top of the history).
- iGOT rendered 5 gap-ranked courses including **ENROLLED 35%** and **IN PROGRESS 60%**. Console clean.
- **The one real stall:** a slept Render instance costs **33.7 s** to first byte, so the day's first
  generation is ~55 s. That is exactly what the batched warm-up fixes — after the next push.
- A timed **run-of-show with these numbers and recovery lines is in `docs/run-of-show.md`**.
- Tool used: `.freebuff/guest_probe.py` (gitignored) — `status` / `snapshot <name>` / `restore
  <name>` over PostgREST with the guest's own credentials, so a rehearsal can no longer leave the
demo drifted. Worth promoting to `scripts/` if rehearsals become routine.

---

## H. Live-deployment blockers found 2026-09-24 (post-push verification)

Shipping `03692a3` surfaced more than the prompt check: **AI generation is broken on every live
host, for three independent reasons.** Verified end to end, not inferred.

1. **CORS: Render rejects the real Vercel origin.** Preflight for
   `Origin: https://compass-tawny-five.vercel.app` answers **400** with no
   `access-control-allow-origin`. `render.yaml` pinned `ALLOWED_ORIGINS` to localhost + Netlify
   with a comment saying "add the Vercel URL once the project exists" — never done. **Fixed in the
   repo** (`render.yaml` + the `config.py` default). In the browser this is invisible as CORS: the
   OPTIONS fails, the POST becomes `net::ERR_FAILED`, and the app reads that as "API unreachable"
   and falls back to the edge functions.
2. **Render cannot fetch the project's signing keys.** Every authenticated endpoint answers
   `Not authenticated: could not fetch the project's signing keys ([Errno -2] Name or service not
   known)` — a DNS failure on the Render side, i.e. `SUPABASE_URL` there is a placeholder or typo.
   `configured: true` only proves the variable is non-empty. **Needs the user** (Render →
   Environment). The error now names the exact JWKS URL it tried, so this is diagnosable from the
   response alone instead of needing the dashboard.
3. **The edge-function fallback fails too.** The deployed `generate-quiz` is stale (its tried-model
   list starts with `gemini-2.5-flash`, which the repo replaced with `gemini-3.6-flash`), and
   Google answered `404 … no longer available to new users` for the 2.5 family and
   `503 … experiencing high demand` for 3.6/3.7/3.8. The 404s are ours to fix (redeploy the
   function); the 503s are transient and clear on retry.

**Dangerous interaction to remember:** fixing (1) alone makes the live site *worse*. Today the CORS
failure pushes every call to the edge fallback; once Render is reachable, its auth failure returns
**401**, and `UNAVAILABLE_STATUS = {408, 425, 429, 502, 503, 504}` means a 401 does **not** fall
back — so AI fails hard. Fix `SUPABASE_URL` first, or at the same time.

**Still unverified:** whether the new scenario prompt produces scenario questions. Both paths to
that answer are blocked by the above (Render by auth, the edge function by the stale deploy), so
the prompt is verified only as code — its assertions pass, and both generators carry identical
text. First real generation after the two fixes is the test.

**Cheaper alternative worth considering (this is F3):** unset `VITE_API_BASE_URL` on Vercel so the
site uses the edge functions, exactly as Netlify already does. That removes Render from the demo
path entirely — one env var, no CORS, no JWKS — at the cost of the "FastAPI backend" claim being
unused during judging.

---

## G. Don't claim (honesty guard for judges)

Do not present these as solved, anywhere in the deck or docs: device independence, digital-skills
training, trainer/mentor interaction, offline AI generation, app-level load balancing, or
high-capacity servers. State them as acknowledged constraints — self-awareness reads better than a
gap a judge discovers.
