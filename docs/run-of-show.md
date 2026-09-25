# COMPASS — live demo run-of-show (SIH26101)

Measured, not estimated. Every timing below was taken on the deployed Vercel build
(`https://compass-tawny-five.vercel.app`) against the real Supabase project and the real Render
API, on 2026-09-25. `docs/walkthrough.mp4` covers the same ground in 137 s if the venue forbids
live network.

---

## Pre-flight — do this before you walk to the front

1. Open `https://compass-tawny-five.vercel.app` on **the laptop you will present from**, and press
   **⚡ Try as Guest**. It is one click and needs no password — do it early so a first-load problem
   happens now, not on stage.
2. Confirm the dashboard reads **readiness 59% · 4 gaps · top strength Field Ops 82%** and the
   attempt history shows 6 rows. Any other numbers mean a previous session quizzed the account:
   re-run `supabase/guest_setup_one_paste.sql` in Supabase → SQL editor (idempotent, one paste).
3. **Wake the AI service.** On the free tier Render sleeps after ~15 min idle and its first
   request costs **33.7 s** (measured today). The app now pings `/healthz` itself on load, so simply
   leaving the tab open handles it — but if you have been idle, open the Materials page and press
   *Generate AI quiz* once, off-camera, to be certain. A cold start plus a generation is ~55 s; warm
   is ~20 s.
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
| 4 | Materials | "Three MoSPI documents are loaded. Generate a quiz from the CPI manual." Press **Generate AI quiz** on *CPI Data Collection Manual 2025*. | **~20 s warm** |
| 5 | Quiz | "Ask it to write assessment, not recall." Read one question aloud — it is a workplace decision ("a field supervisor allocating quality checks…"), not a definition. | instant |
| 6 | Quiz → submit | Answer all 5, then **Submit & update mastery**. | **1.7 s** (0.46 s profile read + 1.19 s RPC) |
| 7 | **Result screen** | **The money shot.** Per-competency movement with arrows: `63% → 78% ▲`, `82% → 49% ▼`, plus *Overall readiness 59% → 55%*. "Mastery is a 60/40 blend of prior mastery and this attempt — a wrong answer moves it down, honestly." | instant |
| 8 | Result → review | Scroll to **Review & explanations** — every question carries the AI's reasoning about the material. | instant |
| 9 | Dashboard | "The dashboard agrees with what we just saw." Readiness **55%**, history now shows the attempt (`2/5 · 40%`, "1m ago"). | instant |
| 10 | iGOT | "The gap engine is wired to iGOT Karmayogi." Five courses ranked by urgency, with **ENROLLED (35%)** and **IN PROGRESS (60%)** progress. | instant |
| 11 | AI Training | The Assess → Diagnose → Train loop, and the current focus areas. | instant |
| 12 | Architecture slide | 100% Indian, $0 stack: React/Vite · Supabase (Postgres + RLS + Auth) · FastAPI on Render · Gemini. CI runs tsc + oxlint + 142 unit tests on every push. | — |

**Afterwards:** re-run `supabase/guest_setup_one_paste.sql` before the next judge sits down. The
declared attempt is a real row; that is what makes the demo honest and also what makes it drift.

---

## Recovery lines — if something fails, say this

| Symptom | What is happening | What to say while it resolves |
| --- | --- | --- |
| Generation button spins past ~25 s | Render was cold (33.7 s to first byte) or Gemini is busy | "The free-tier API sleeps when idle — it is waking. The app falls back to our Supabase edge functions automatically if it does not answer." |
| A red banner under the nav bar | The link dropped | "Notice what it did: the attempt is saved on this device and submits itself when the network returns. Demo wifi proves the point better than we could." |
| A status strip says *Starting the AI service* | The warm-up ping saw the host booting | "That is the app being honest about the free tier rather than showing a spinner with no explanation." |
| A queue strip says *1 attempt is saved on this device* | A submission was queued offline | Press **Sync now**; the mastery figures update. |
| Radically different mastery numbers | The account was quizzed since the reset | Do not apologise — say the numbers are live, and that **↻ Refresh** re-reads them. |
| Total network failure | No app at all | Play `docs/walkthrough-vo.mp4` (137 s, narrated) — it was recorded from this same build. |

---

## What is deliberately *not* claimed

Say these as constraints, not features: no offline AI generation (generation needs a connection;
read-only screens and queued submissions are what survive), no app-level load balancing (we built
automatic failover, not balancing), no high-capacity servers (free tier sleeps), device requirement
reduced but not removed, no trainer interaction, no digital-skills training. Self-awareness reads
better than a gap a judge discovers.
