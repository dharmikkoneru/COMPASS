# COMPASS — live demo run-of-show (SIH26101)

Measured, not estimated. Every timing below was taken on the deployed Vercel build
(`https://compass-tawny-five.vercel.app`) against the real Supabase project and the real Render
API, on 2026-09-25. `docs/walkthrough.mp4` covers the same ground in 137 s if the venue forbids
live network.

**Re-probed 2026-09-28 on the same build** (see *Timings drift* below): the cold start was
unchanged at **33.3 s** to `/healthz`, and a real browser generation took **35.1 s** rather than the
19.4 s measured in September. Nothing in our code changed between the two — Google was answering
`503 high demand` for the generation model that morning.

---

## Pre-flight — do this before you walk to the front

1. Open `https://compass-tawny-five.vercel.app` on **the laptop you will present from**, and press
   **⚡ Try as Guest**. It is one click and needs no password — do it early so a first-load problem
   happens now, not on stage.
2. Confirm the dashboard reads **readiness 59% · 4 gaps · top strength Field Ops 82%** and the
   attempt history shows 6 rows. Any other numbers mean a previous session quizzed the account:
   re-run `supabase/guest_setup_one_paste.sql` in Supabase → SQL editor (idempotent, one paste).
3. **Wake the AI service.** On the free tier Render sleeps after ~15 min idle and its first
   request costs **33.3–33.7 s** (measured on two separate days, so this is the host, not the
   weather). The app now pings `/healthz` itself on load, so simply leaving the tab open handles it —
   but if you have been idle, open the Materials page and press *Generate AI quiz* once, off-camera,
   to be certain. Budget **~20 s warm when the model is responsive and ~35 s when it is busy**, and
   ~70 s for the day's first (cold) generation — the model, not the host, is the variable.
4. Leave the browser zoom at 100% and the window wide enough that the radar and the gap chips are
   both visible.

**Known-good numbers to expect:** readiness 59%, gaps 4, readiness forecast 59% → 62% (+3) in ~4
weeks at ~1.5 quiz/week.

---

## The walkthrough

| # | Screen | Say / do | Measured |
| --- | --- | --- | --- |
| 1 | Login | "One click, no password — judges should be assessing, not registering." Press **Try as Guest**. | < 2 s |
| 2 | Dashboard | "This officer's competency profile, computed from their own attempts." Point at readiness **59%**, **4** gaps, top strength **Field Ops 82%**, then the 8-axis radar — inside the 60% ring is a gap. | instant |
| 3 | Dashboard → forecast | "It also projects: at this pace, 59% → 62% in four weeks, and it names how many quizzes close each gap. Deterministic — no black box." | instant |
| 4 | Materials | "Three MoSPI documents are loaded. Generate a quiz from the CPI manual." Press **Generate AI quiz** on *CPI Data Collection Manual 2025*. | **~20–35 s warm** |
| 5 | Quiz | "It asks what you would *do*, not what a term means." Read one aloud — "a field supervisor is reviewing the workload for the month…" — then point at the three chips and **read whatever they say**. The mix moves run to run: four measured generations gave `4 Recall + 1 Application`, `3 Recall + 2 Application` and `4 Application + 1 Analysis`. Promise the **tag**, never a distribution. | instant |
| 6 | Quiz → submit | Answer all 5, then **Submit & update mastery**. | **1.7 s** (0.46 s profile read + 1.19 s RPC) |
| 7 | **Result screen** | **The money shot.** Per-competency movement with arrows: `63% → 78% ▲`, `82% → 49% ▼`, plus *Overall readiness 59% → 55%*. "Mastery is a 60/40 blend of prior mastery and this attempt — a wrong answer moves it down, honestly." | instant |
| 8 | Result → review | Scroll to **Review & explanations** — every question carries the AI's reasoning about the material. | instant |
| 9 | Dashboard | "The dashboard agrees with what we just saw." Readiness **55%**, history now shows the attempt (`2/5 · 40%`, "1m ago"). | instant |
| 10 | iGOT | "The gap engine is wired to iGOT Karmayogi." Five courses ranked by urgency, with **ENROLLED (35%)** and **IN PROGRESS (60%)** progress. | instant |
| 11 | AI Training | The Assess → Diagnose → Train loop, and the current focus areas. | instant |
| 12 | Architecture slide | 100% Indian, $0 stack: React/Vite · Supabase (Postgres + RLS + Auth) · FastAPI on Render · Gemini. CI runs tsc + oxlint + **147** frontend tests and ruff + pytest for the API's **63** — **210** in total, on every push. | — |

**Afterwards:** re-run `supabase/guest_setup_one_paste.sql` before the next judge sits down. The
declared attempt is a real row; that is what makes the demo honest and also what makes it drift. (A
rehearsal you want to keep off the record does not need the SQL editor at all:
`python .freebuff/guest_probe.py snapshot <name>` before and `… restore <name>` after, which rolls
the account back to the byte. Verified 2026-09-28 — three quizzes generated during a live probe, all
three removed, every seeded value identical.)

---

## Timings drift — read the generation row as a floor, not a promise

September's numbers are real and so are September 28th's; they differ because generation waits on
Google, not on us. On 2026-09-28 the *same build, same material, same 5-medium request* took
**35.1 s** in the browser (measured from the page's own `performance` entries) and **43.2 s** through
the API directly, against 19.4 s in September. The cause was visible in the response of the fallback
path called minutes later: `gemini-3.6-flash → HTTP 503 … experiencing high demand`, retried across
models. The **host** timings are the stable half — `/healthz` answered in 33.3 s cold and 0.95 s warm
on the same day.

The fallback path is not a second opinion on speed: called directly it answered in **24.2 s**
(pre-redeploy) and **30.8 s** (post-redeploy), but when Google is busy it can spend its entire ~92 s
budget and return a 500. That is the design — the app tries it *after* the primary refuses.

So: say **"about twenty seconds, up to forty if the model is busy"**, and let the Materials screen's
own seconds counter and the status strip carry the explanation. That is what they are for.

---

## Recovery lines — if something fails, say this

| Symptom | What is happening | What to say while it resolves |
| --- | --- | --- |
| Generation button spins past ~45 s | Render was cold (33.3 s to first byte) or Gemini is busy (503s mean the generator walks its model list) | "The free-tier API sleeps when idle, and the model retries rather than giving up — it is waking. If it does not answer we fall back to our Supabase edge functions automatically." |
| A red banner under the nav bar | The link dropped | "Notice what it did: the attempt is saved on this device and submits itself when the network returns. Demo wifi proves the point better than we could." |
| A status strip says *Starting the AI service* | The warm-up ping saw the host booting | "That is the app being honest about the free tier rather than showing a spinner with no explanation." |
| A queue strip says *1 attempt is saved on this device* | A submission was queued offline | Press **Sync now**; the mastery figures update. |
| A generated question shows no level chip | The model returned a level the schema did not accept, so the generator **stored the question untagged rather than lose it** | "The depth tag is optional by design — we keep the question and drop the label instead of failing the generation. The competency tag is still there." |
| Radically different mastery numbers | The account was quizzed since the reset | Do not apologise — say the numbers are live, and that **↻ Refresh** re-reads them. |
| Total network failure | No app at all | Play `docs/walkthrough-vo.mp4` (137 s, narrated) — it was recorded from this same build. |

---

## What is deliberately *not* claimed

Say these as constraints, not features: no offline AI generation (generation needs a connection;
read-only screens and queued submissions are what survive), no app-level load balancing (we built
automatic failover, not balancing), no high-capacity servers (free tier sleeps), device requirement
reduced but not removed, no trainer interaction, no digital-skills training. Self-awareness reads
better than a gap a judge discovers.
