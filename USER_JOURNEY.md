# Test it yourself: the whole journey in 12 short steps (about 20 minutes)

**The one-line story.** VANI's real prompt and real calls show where a change could help. A small edit is derived and checked. The A/B engine proves it on live traffic and rolls it out, only if it provably wins.

## Open it
```bash
cd "IM Voice AI 2.0 Hackathon/canary"
python -m canary build            # rebuilds the offline page (about 20 s)
python -m canary decide data/samples/results_b_wins.csv --goal buylead_created --share-b 0.3 --baseline 0.45 --mde 0.07 --window-days 14   # a decision from a file, in the terminal
```
Open `dist/canary_demo.html` in Chrome (or run `./start.sh`). It works with no internet. A one-page version of this tour is in `START_HERE.md`; the app opens on a **Start** page with four plain choices. (Live version with the labelling page: `python -m canary serve`, then http://127.0.0.1:8765.)

## The journey

| # | Where | What to do | What you should see |
|---|---|---|---|
| 1 | **Suggest a change**, step 1 *Find* | Read the three cards. | **Card 1:** VANI's real prompt (25,193 words) gives different ask limits for the same thing: buyer name 2 vs 3, product confirmation 4 vs 5, enrichment slots 2 vs 3, each with line numbers. IndiaMART's quality matrix grades asking more than 1+2 times as a fatal "looping" failure. **Card 2:** only about **1.7%** of 234 real calls with speech have VANI repeat itself 3+ times (a lower bound), so expect a safety gain, not a conversion jump. **Card 3:** 47.5% captured quantity and specification (provisional), and **our own corrected mistake**: the tagger flagged "did not read details back" on 129 calls, which the real prompt forbids. |
| 2 | step 2 *Fix* | Read the red and green lines. | One edit, 3 lines changed in a 2,330-line prompt, with the changed words highlighted. A **prompt lint** line says contradictions 3 → 0, none added. A Sarvam-drafted alternative would cost about Rs 0.9 (not run). |
| 3 | step 3 *Pre-check* | Read the cost table. | **Not run on the real prompt, on purpose:** 24 simulated calls would cost about Rs 116 because the prompt is about 22,000 tokens per turn. Every paid step is listed with its cost and command. |
| 4 | step 4 *Prove* | Read the table of lifts, then click **The fix works, so it ships** and press **Skip to the result**. | To be sure of a 3-point lift: 9,228 calls (about 15 days at 600 a day). A 1-point lift would need about 83,000 calls. The needle goes green after about 6,000 calls, about 35% sooner than a fixed-length test. |
| 5 | same | Go back. Click **The fix backfires**, then **The fix does almost nothing**. | Backfire: stopped early (about 1,600 buyers ever hear it). Does nothing: *no real difference*, nothing changes. |
| 6 | **Judge a test** (the PM's model: the voice test ran elsewhere, files come to us) | Click **B wins**, then **Skip to the result**. | A decision from a results file: ship, with the numbers, the data notes (for example "the plan was complete on day 7; later leads not needed") and a line *Record checked in your browser just now: chain intact*. Click **Roll back**: the rollback is logged and the chain still verifies. |
| 7 | same | Go back. Click **B wins, but calls run longer**, then press **Approve** (then **Undo**, then **Reject**). | A clear win with a safety check not proven is **held for a person**: callers are unaffected meanwhile, each click is added to the tamper-evident record and the chain re-verifies. |
| 8 | same | Click **No real difference**, and **A messy export**. | The first says what would settle it ("already enough data to detect 7 points; 5,952 more leads, about 20 days, to detect 3.5"). The second lists what was found in the file: repeated call ids, unknown variant names, leads served both prompts. Nothing is repaired silently. |
| 9 | **Hear it** | Read the banner. | The six recorded calls used our earlier **stand-in prompt** (wrong about VANI). They show Sarvam's voices, not VANI's behaviour; the banner says how to record them again with the real prompt (about Rs 53). |
| 10 | **Why trust it** | Read the four cards. | When nothing changed, a usual "peek every day" tool crowns a fake winner about **12%** of the time; Canary **2.3%**. When the test itself is broken, a usual tool ships anyway **99%** of the time; Canary **0%**. |
| 11 | **Plan a test** | Change *calls a day*. | Before starting, it tells you whether the test can finish. 600 calls a day is our assumption; put in the real number. |
| 12 | **Label calls** (your 25-minute task) | Best after the re-tag. Spot-check the queued calls. | This measures how accurate Sarvam's labels are. Afterwards run `python -m canary autolabel report`. |

Extra, for engineers: **Advanced**, then Experiment, then the decision record. Press **Verify chain**, then **Tamper with one entry**, then **Verify chain** again: the chain breaks at the edited entry. The first entry of the fix experiment holds the evidence behind the fix (prompt lint result, hashes).

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
