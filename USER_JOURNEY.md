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
| 1 | **Overview** | Read the cards, then press **Advance all running tests 1 day (demo)** twice. Press **Run 1,000 A vs A tests now**. | Four tiles (running, waiting for approval, harm alerts, completed this month), business impact, the live prompt, what needs attention, five running tests (segment chips, leads collected against needed, a grey interim lift), the traffic map, recent decisions, a scorecard, the top suggestion, and the **A vs A check**: with identical prompts about 2.5% are wrongly promoted (about 5% look different either way, as the BRD says), against about 8% for a plain daily p < 0.05. The button runs 1,000 such tests in your browser. |
| 2 | **Live Experiments** | Open *Ask for any single detail at most twice*. Press **Advance 1 day (demo)** until day 7. | Header with status, config version and actions (Pause, Stop, Approve, Reject, Rollback); the banner *Results up to yesterday. Final winner call on day 7*; tiles with both rates and 95% ranges, the lift with its range and a pass or fail per guardrail; the daily trend with shaded ranges; the harm monitor (one row per day: is B clearly worse?); *Leads still needed*; the decision table with the row that applied highlighted; and **Split health**: configured against achieved share by lead, call and day, a chi-square p-value, leads that saw both prompts (0), a balance table of A against B by lead type, firm type and city, and a segment check. On day 7 it is **promoted**. A promoted test then shows a **holdback** card: 5% of leads stay on A for 7 days. |
| 3 | same | Open *Make the ask limits agree* and advance. | Stopped early by the harm check on day 4, with a harm alert in the record. |
| 3b | same | Open *Proprietors: ask for any detail at most twice* and advance to the end. | An audience of one segment: the header shows the exact rule (NOB = Proprietor, 45% of traffic); Split health shows the mix balanced inside each group and that every counted lead matches the rule while out-of-segment leads kept today's prompt. |
| 4 | same | Open *Warmer opening line* and advance to day 7. | **Inconclusive, keep A**, with "already enough data to detect 7 points; 3,000-odd more leads to detect smaller ones". |
| 5 | same | Open *Offer the seller details on WhatsApp earlier* and advance to day 7. Press **Approve**. | **Held for approval**: B wins but calls run about 13% longer against a 10% limit. Nothing changes for callers meanwhile. Approve (or Reject) is added to the record; press **Verify record in this browser**: chain intact. |
| 6 | **Prompt Library** | Open it. | The approved win is now the next version (v2 if nothing else was promoted), live; v1 is the real prompt as received. Side-by-side diff against the previous version. Press **Rollback**: it is logged and v1 is live again. |
| 7 | **Decision Log** | Open it; filter by *Promoted*. | Every event with time, reason and numbers: started, harm alert, stopped, promoted, approved, rolled back. Export CSV. |
| 8 | **History** | Open it; filter *Stopped*; press a row; press **Clone**. | A frozen one-page report (numbers, decision, plain-words summary, safety checks, trend); a one-line learning you can save; Clone re-opens New Experiment prefilled. |
| 9 | **Suggest A/B Tests** | Open it. | Ideas from five sources with their evidence, proposed patch, target metric, expected effect, days needed and priority (impact x ease). The weak-segments idea says plainly that it cannot be generated (the lead variables are synthetic, so a weak segment would be invented). **Create experiment** pre-fills the wizard. |
| 10 | **New Experiment** | Walk the six steps. In step 2 choose a patch and read the side-by-side diff. In step 3 type *Mumbai proprietors on UA and PNS leads* and press **Read it**. In step 4 remove and add a guardrail card. In step 5 watch the sticky calculator. In step 6 read the checklist, press **Save Test**, then **Launch Test**. | Name your test; a patch or a full prompt with a template-variable check; the audience as an exact rule with its share of traffic and how the split is dealt; goal cards; share, expected lift and whole-week days (7 to 28) with a green, amber or red light (the Mumbai segment is red: *Segment too small*); a five-item pre-launch checklist. Launch (live version) runs the engine and locks the setup with a version ID. Offline, launch replays the closest pre-computed run under your name and says so; your plan fields are not applied. Step 2 also has *Write my own patch* (add, replace or remove a line of the base prompt, with a diff and the variable check) and a read-only view of the base prompt. |
| 11 | **Overview** > **Import results files** (live version) | Pick the synthetic sample *B wins, calls longer*, tick the success outcome, press **Decide**. | The test ran elsewhere; Canary reads its results, lists anything odd in the file, and decides. |
| 12 | **Settings** | Open it. | The variable catalog (what each variable means, its values, and whether it is known before the call), the metric list (goals and guardrails), defaults for new tests, approval mode, the overlap warning, links to the technical tools (proof tables, label calls, hear it) and a reset. |

## What is real and what is simulated

| Real | Simulated or assumed (on purpose) |
|---|---|
| VANI's real prompt, and the lint of it | The call *outcomes* inside the A/B test (a known injected difference, so we can check the engine finds it) |
| The loop scan on the real recordings (no AI) | The 1,000 leads a day, the 45% baseline, the planned lift, and the lead variables (lead type, firm type, city: the recordings carry none) |
| 299 real recordings transcribed and tagged by Sarvam (provisional labels) | The simulated buyers (not run on the real prompt) |
| The statistics in *Why trust it* (thousands of re-runnable simulations) | The opening message and call variables of any simulated VANI call |

**Say out loud:** the labels are provisional until the re-tag and your spot-check, and the real-world lift of the fix is unknown until it runs on live calls. That is what step 4 is for.

## Your open tasks
1. **Approve (or not) the paid steps**, cheapest first: re-tag (Rs 23), Sarvam draft (Rs 0.9). Pre-check (Rs 116) and voice arena (Rs 53) are optional. Check your balance at the Sarvam dashboard before any of them.
2. **Spot-check about 40 calls** (Label calls tab, about 25 minutes), after the re-tag.
3. **Create the Sarvam voice agent(s)** at indus.sarvam.ai (Build, Agents, Create from Scratch), pasting from `data/sarvam_agent_A.md` and `data/sarvam_agent_B.md` (see `data/sarvam_agent_prompt.md`). Note the **Agent ID or link** for the submission. This is dashboard-only and costs nothing here.
4. **Ask the organisers** which BuyLead definition counts, and what the real `initial_message` and call variables look like.
5. **Still unanswered:** the deck says all build work must happen on Oct 9-10 and pre-built solutions are disqualified; some of this was built earlier. Please confirm with the organisers.
