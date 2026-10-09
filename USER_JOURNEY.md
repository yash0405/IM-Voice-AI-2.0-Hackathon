# Test it yourself: the whole journey in 12 short steps (about 20 minutes)

**The one-line story.** VANI's real prompt and real calls show where a change could help. A small edit is derived and checked. The A/B engine proves it on live traffic and rolls it out, only if it provably wins.

## Open it
```bash
cd "IM Voice AI 2.0 Hackathon/canary"
./start.sh                      # sets itself up, builds, opens http://127.0.0.1:8765 (live engine)
```
Or just open `dist/canary_demo.html` in Chrome: no internet needed, every screen works except launching a brand-new experiment and reading your own files (those run the engine). A one-page version of this tour is in `START_HERE.md`.

## The journey (the feature spec's loop: suggest, set up, watch, decide, learn)

| # | Screen | What to do | What you should see |
|---|---|---|---|
| 1 | **Overview** | Read the cards, then press **Advance all running tests 1 day (demo)** twice. | Totals (tests run, promoted, stopped, inconclusive), four running tests each with day X of 7, current lift and a status (on track, harm alert, ready to decide), the production prompt (v1), recent decisions, and an **A vs A check**: with identical prompts a winner is wrongly declared about 2.6% of the time (budget 2.5%) against 11% for a plain daily p < 0.05. |
| 2 | **Live Experiments** | Open *Ask for any single detail at most twice*. Press **Advance 1 day (demo)** until day 7. | Header with status, config version and actions (Pause, Stop, Approve, Reject, Rollback); the banner *Results up to yesterday. Final winner call on day 7*; tiles with both rates and 95% ranges, the lift with its range and a pass or fail per guardrail; the daily trend with shaded ranges; the harm monitor (one row per day: is B clearly worse?); the split panel (configured against achieved share by lead and by call, a chi-square p-value, leads that saw both prompts: 0); *Leads still needed*; the decision table with the row that applied highlighted. On day 7 it is **promoted**. |
| 3 | same | Open *Make the ask limits agree* and advance. | Stopped early by the harm check on day 4, with a harm alert in the record. |
| 4 | same | Open *Warmer opening line* and advance to day 7. | **Inconclusive, keep A**, with "already enough data to detect 7 points; 3,000-odd more leads to detect smaller ones". |
| 5 | same | Open *Offer the seller details on WhatsApp earlier* and advance to day 7. Press **Approve**. | **Held for approval**: B wins but calls run about 13% longer against a 10% limit. Nothing changes for callers meanwhile. Approve (or Reject) is added to the record; press **Verify record in this browser**: chain intact. |
| 6 | **Prompt Library** | Open it. | The approved win is now the next version (v2 if nothing else was promoted), live; v1 is the real prompt as received. Side-by-side diff against the previous version. Press **Rollback**: it is logged and v1 is live again. |
| 7 | **Decision Log** | Open it; filter by *Promoted*. | Every event with time, reason and numbers: started, harm alert, stopped, promoted, approved, rolled back. Export CSV. |
| 8 | **History** | Open it; filter *Stopped*; press a row; press **Clone**. | A frozen one-page report (numbers, decision, plain-words summary, safety checks, trend); a one-line learning you can save; Clone re-opens New Experiment prefilled. |
| 9 | **Suggest A/B Tests** | Open it. | Ideas from five sources with their evidence, proposed patch, target metric, expected effect, days needed and priority (impact x ease). The segment idea says plainly that it cannot be generated (no segment data). **Create experiment** pre-fills the wizard. |
| 10 | **New Experiment** | Walk the six steps. In step 2 choose a patch and read the side-by-side diff; try *Full prompt* and *Start from the base prompt*; in step 5 watch the live calculator. | Name your test; a patch or a full prompt with a template-variable check; share and leads per day; goal and guardrails; days, confidence and the decision rule; review. Launch (live version) runs the engine and locks the setup with a version ID. Offline, launch replays the closest pre-computed run under your name and says so; your plan fields are not applied. Step 2 also has *Write my own patch* (add, replace or remove a line of the base prompt, with a diff and the variable check) and a read-only view of the base prompt. |
| 11 | **Overview** > **Import results files** (live version) | Pick the synthetic sample *B wins, calls longer*, tick the success outcome, press **Decide**. | The test ran elsewhere; Canary reads its results, lists anything odd in the file, and decides. |
| 12 | **Settings** | Open it. | The metric list (goals and guardrails), defaults for new tests, approval mode, the overlap warning, links to the technical tools (proof tables, label calls, hear it) and a reset. |

## What is real and what is simulated

| Real | Simulated or assumed (on purpose) |
|---|---|
| VANI's real prompt, and the lint of it | The call *outcomes* inside the A/B test (a known injected difference, so we can check the engine finds it) |
| The loop scan on the real recordings (no AI) | The 600 calls a day; the 3-point planned lift |
| 299 real recordings transcribed and tagged by Sarvam (provisional labels) | The simulated buyers (not run on the real prompt) |
| The statistics in *Why trust it* (thousands of re-runnable simulations) | The opening message and call variables of any simulated VANI call |

**Say out loud:** the labels are provisional until the re-tag and your spot-check, and the real-world lift of the fix is unknown until it runs on live calls. That is what step 4 is for.

## Your open tasks
1. **Approve (or not) the paid steps**, cheapest first: re-tag (Rs 23), Sarvam draft (Rs 0.9). Pre-check (Rs 116) and voice arena (Rs 53) are optional. Check your balance at the Sarvam dashboard before any of them.
2. **Spot-check about 40 calls** (Label calls tab, about 25 minutes), after the re-tag.
3. **Create the Sarvam voice agent(s)** at indus.sarvam.ai (Build, Agents, Create from Scratch), pasting from `data/sarvam_agent_A.md` and `data/sarvam_agent_B.md` (see `data/sarvam_agent_prompt.md`). Note the **Agent ID or link** for the submission. This is dashboard-only and costs nothing here.
4. **Ask the organisers** which BuyLead definition counts, and what the real `initial_message` and call variables look like.
5. **Still unanswered:** the deck says all build work must happen on Oct 9-10 and pre-built solutions are disqualified; some of this was built earlier. Please confirm with the organisers.
