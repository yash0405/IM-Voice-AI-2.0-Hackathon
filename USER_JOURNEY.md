# Test it yourself: the whole journey in 9 short steps (about 15 minutes)

**The one-line story.** VANI's real calls show where leads are lost. Sarvam drafts a fix. Simulated buyers pre-check it. The A/B engine proves it on live traffic and rolls it out, only if it provably wins.

## Open it

```bash
cd "IM Voice AI 2.0 Hackathon/canary"
python -m canary build            # rebuilds the offline page (about 20 s)
```
Open `dist/canary_demo.html` in Chrome. It works with no internet. (For the live version with the labelling page working: `python -m canary serve`, then http://127.0.0.1:8765.)

## The journey

| # | Where | What to do | What you should see |
|---|---|---|---|
| 1 | **Fix the bot**, step 1 *Find* | Read the three rows. | 299 real calls. About **47.5%** end with a usable requirement. The red row, **Ended the call abruptly**, converts **38%** against **57%** without it. The most common problem (**Did not read the details back**) is marked *Common, but these calls do better*: fixing it would recover nothing. This is where we corrected the PM's rule. |
| 2 | step 2 *Fix* | Look at the green line. | Sarvam drafted **one line** for VANI's instructions: *Ask for the next missing requirement detail before ending the call.* It also states its own risk. |
| 3 | step 3 *Pre-check* | Read the two big numbers and the three ticks. Click **Listen to the calls**. | 24 simulated buyers talk to VANI under today's prompt and under the fix. A pass rule, written in code before the run, decides whether the fix may go to a live test. The small print says what this step cannot prove. |
| 4 | **Hear it** | Press play on a buyer, A then B. Open *Read the call*. | The same buyer, two prompts. VANI and the buyers are voiced by Sarvam Bulbul. Each call is scored by the Sarvam tagger. |
| 5 | **Fix the bot**, step 4 *Prove* | Click **The fix works, so it ships** and watch. Press **Skip to the result**. | The needle moves into green and a green card says *rolled out*. A box explains what a fixed-length test would have cost. |
| 6 | same | Go back. Click **The fix backfires** and then **The fix does almost nothing**. | Backfire: the needle turns red and Canary stops early (only about 1,200 buyers ever hear it). Does nothing: *no real difference*, nothing changes. |
| 7 | **Why trust it** | Read the four cards. | When nothing changed, a usual "peek every day" tool crowns a fake winner about **12%** of the time; Canary **2.3%**. When the test itself is broken, a usual tool ships anyway **99%** of the time; Canary **0%**. |
| 8 | **Plan a test** | Change *calls a day*. | Before starting, it tells you whether the test can finish. 600 calls a day is our assumption; put in the real number. |
| 9 | **Label calls** (your 25-minute task) | Do the 40 queued calls: listen, press **Machine is right** or choose the real outcome. | This measures how accurate Sarvam's labels are. Afterwards run `python -m canary autolabel report` to get the accuracy and the corrected conversion rate. |

Extra, for engineers: **Advanced**, then Experiment, then the decision record. Press **Verify chain**, then **Tamper with one entry**, then **Verify chain** again: the chain breaks at the edited entry. The first entry of the fix experiment holds the evidence behind the fix.

## What is real and what is simulated

| Real | Simulated (on purpose) |
|---|---|
| 299 real recordings transcribed by Sarvam Saaras and tagged by Sarvam-105B | The call *outcomes* inside the A/B test (a known injected difference, so we can check the engine finds it) |
| The measured baseline (47.5%) and the failure ranking | The 600 calls a day (an assumption) |
| The one-line edit drafted by Sarvam-105B | The simulated buyers in the pre-check and in *Hear it* |
| The voices and tags in *Hear it* (Sarvam Bulbul and the tagger) | The stand-in base prompt (we were not given the real VANI prompt) |
| The statistics in *Why trust it* (thousands of re-runnable simulations) | |

**Caution to say out loud:** the labels are machine labels until the 40-call spot-check is done, and the real-world lift of the fix is unknown until it runs on live calls. That is exactly what step 4 is for.

## Your three open tasks

1. **Spot-check the 40 queued calls** (Label calls tab, about 25 minutes). It turns "machine labels" into measured accuracy.
2. **Create the Sarvam voice agent(s)** at indus.sarvam.ai: Build, Agents, Create from Scratch. Paste from `data/sarvam_agent_prompt.md` (prompt A and prompt B), test by talking to them, and note the **Agent ID or link** for the submission. This is a dashboard-only step.
3. **Ask the organisers** (a) which BuyLead definition counts (strict 20% or looser 47.5%) and (b) whether the real VANI prompt can be shared. Paste it into `data/base_prompt.md` and re-run `python -m canary fix propose --yes --force`.
