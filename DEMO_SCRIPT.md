# Canary - 5-minute demo script and hard questions

Open `dist/canary_demo.html` (works with no internet). Live engine and labelling page: `python -m canary serve`, then http://127.0.0.1:8765. One slide: `dist/one_slide.html`. A step-by-step walkthrough for you: `USER_JOURNEY.md`.

**One sentence.** The bot finds its own weak spot from real calls, Sarvam drafts a fix, simulated buyers pre-check it, and the A/B engine proves it on live traffic and rolls it out only if it provably wins.

**Say this first (the business context).** VANI phones a *buyer* when the seller is unavailable, to verify intent and capture Quantity, Specification, Delivery location and Timeline, so the lead is not lost. A prompt change that lowers BuyLead conversion or stretches handling time costs real leads. Today a change reaches every buyer on gut feel.

## The 5 minutes (everything is on the first tab, "Fix the bot")

**0:00 - The problem (25 s).** "A prompt edit can quietly cost leads and a good edit can't be proven. So we closed the loop: find the weak spot, fix it, prove the fix, roll it out."

**0:25 - Step 1, Find (55 s).** "Sarvam transcribed and tagged **299 real VANI calls**. About **47.5%** end with a usable requirement, inside the 35-60% benchmark. Now look at the three biggest problems. The most common, *did not read the details back*, is in nearly half the calls, but those calls convert **better**, 60% against 45%. Fixing it would recover nothing. A tool that just fixes the biggest cluster would pick it, which is also what our PM's version of the loop would do. Canary compares calls that convert with calls that don't, and picks *ended the call abruptly*: **38% against 57%**. That's the leak, worth up to about four extra BuyLeads in every hundred calls."

**1:20 - Step 2, Fix (30 s).** "Sarvam's language model read those 61 calls and drafted one line for VANI's instructions: *ask for the next missing requirement detail before ending the call*. It flags its own risk. A person can edit or reject it. The edit is constrained: one or two lines, anchored to the existing prompt, no numbers or quotes from calls."

**1:50 - Step 3, Pre-check and Hear it (50 s).** "Before any real buyer hears it, 24 simulated buyers, shy, busy, sceptical, English-only, talk to VANI under both prompts. The pass rule was fixed in code before the run." Click *Listen to the calls* and play 15 seconds of one buyer, A then B. "Voices are Sarvam Bulbul; each call is scored by the same Sarvam tagger. We are honest about what this is: a smoke test. It stops a clearly worse edit; it cannot prove a gain."

**2:40 - Step 4, Prove it (85 s).** "To be sure of a 4-point lift Canary needs about 5,200 calls, around 9 days at 600 calls a day." Click **The fix works, so it ships**: the needle crosses into green after about 3,600 calls, 30% sooner than a fixed-length test, with the false-win rate still controlled. Click **The fix backfires**: stopped early, about 1,200 buyers ever hear it where a fixed test would have used about 2,600. Click **The fix does almost nothing**: "we cannot tell, nothing ships." Read the *Why this matters* box.

**4:05 - Why trust it (35 s).** "When nothing really changed, a tool that checks every day crowns a fake winner **12%** of the time. Canary: **2.3%**. When call tracking silently loses calls, usual tools ship the change **99%** of the time. Canary: **0%**. Same data, same random seeds, one command re-runs it."

**4:40 - Close (20 s).** "Every step, including the evidence behind the fix, goes into a tamper-evident record. The A/B outcomes are simulated with a known answer; the labels, the ranking, the fix and the voices are real. Next: run it on live Sarvam voice agents."

Technical judges: the **Advanced** tab has the decision record (Verify chain, Tamper with one entry), the proof tables and split accuracy.

## What the PM suggested, and what we did

| PM's idea | Verdict |
|---|---|
| The system proposes variant B from failed calls | **Built, and corrected.** "Top cluster among failed calls" picks the wrong problem (see step 1). We rank by the conversion gap. Mining only proposes; the live test decides. |
| Sequential testing vs naive peeking | **Kept.** Alpha-spending; shown against naive peeking by simulation. |
| Sample-ratio mismatch check | **Kept and strengthened.** The share-only check was weak at a 45% baseline (a 35% silent loss shipped 44% of the time). We added a per-arm assigned-vs-logged check: now it halts 100% and ships 0%. |
| CUPED variance reduction | **Dropped.** It needs pre-call features that predict a one-shot yes/no outcome; the "30-40% fewer calls" depends on that correlation (about 0.6) and we have no such features, so we would be inventing the number. |
| Segment-level promotion | **Dropped for promotion** (multiple-comparison trap at these sample sizes). Segments stay a reporting view. |
| 5% post-promotion holdout | **First extension, not built.** With a 5% holdout at 600 calls a day (30 a day), seeing a fade of 4 points takes about 80 days; the same engine can run it with a larger holdout. |

## Hard questions, and answers that hold up

**Isn't "one line" a trivial fix?** The PM asked for a small edit on purpose: small edits are testable. The value is the loop and the proof. The edit is a hypothesis; the test is the judge, and it can say no (see "backfires" and "does almost nothing").

**Your labels are machine labels. Are they right?** Not measured yet. A person blind-checks 40 calls; the tool then reports the tagger's accuracy and corrects the conversion rate for its errors. Until then every real-data number is labelled "machine labels". The Proof Lab shows what a noisy tagger costs in calls.

**Association is not causation.** Correct, and the page says so. The gap between two machine labels generates the hypothesis; only the live test establishes cause. The p-value for the chosen failure is 0.009 unadjusted. Across the three failures big enough to be eligible it is about 0.027 after a Bonferroni correction. Across all nine it would not pass, which is one more reason the engine, not the mining, decides.

**The pre-check passed 24 of 24 in both arms. Is it meaningful?** Only as a safety net. Simulated buyers are cooperative, so it cannot show a gain; it can catch an edit that makes the bot clearly worse or longer. We say that on the screen. The proof of an improvement is the live test.

**The base prompt is a stand-in.** Yes: we were not given the real VANI prompt. Paste it into `data/base_prompt.md` and re-run `python -m canary fix propose --yes --force` (about Rs 0.05). The mining uses the real calls and does not depend on it.

**Which BuyLead definition counts?** We report both: 47.5% when quantity and specification were captured, 20% when location or timeline are also needed. The looser one matches the stated 35-60% benchmark. We have asked the organisers; the pipeline switches with one line.

**Why alpha-spending, not mSPRT or Bayesian?** Fixed window and planned looks: spending gives a maximum sample size, a power calculation, and explicit harm and futility rules. We show the false-win rate by simulation instead of asserting it.

**Is the false-win rate really at budget?** At the default setting 2.3% against a 2.5% budget. Across the robustness grid the worst cell is about 3%, because the test uses a normal approximation. We report the worst cell. Naive peeking is about 5x over.

**Outcomes are simulated. What does a win prove?** That the engine finds a known injected difference, controls false wins, stops harm and logs correctly. It does not prove a real prompt is better. The baseline (47.5%) and the failure's size are measured; the 600 calls a day are an assumption (change it in Plan a test).

**Multiple metrics, a multiplicity problem?** Promotion needs primary superiority AND guardrail non-inferiority (intersection-union), so no alpha splitting; a guardrail breach has its own harm boundary.

**What about repeat callers?** Repeat calls are routed to the same arm (a coin-flip router would switch 17.6% of them) but only the first call per lead is analysed.

**What stops a bad edit from auto-shipping?** Five gates: the constrained edit format, the pre-check, the harm boundary, the handling-time guardrail, and the broken-test halt. `approval: manual` adds a person before any rollout.

**Customer data?** Audio and transcripts went only to the Sarvam platform. Transcripts, labels and spend files stay on the machine and are excluded from the repository. Our AI coding assistant never read call content: only counts and shapes.

**How does this plug into Sarvam?** Speech-to-text (Saaras) and the chat model (Sarvam-105B) are already used for labelling and drafting; Bulbul for the voices. Voice agents are created in the dashboard (`data/sarvam_agent_prompt.md`); promotion would flip the production prompt, which needs the platform's agent-update API, and we have not verified that exists.

**Cost?** The whole real-data run used about Rs 314 of Sarvam credits: 299 calls transcribed and tagged (about Rs 262), the voice arena and the 48-call pre-screen (about Rs 52, of which about Rs 26 was a first pass we threw away after finding that the simulated VANI was not being told the buyer's name and product), and the fix draft itself (about 5 paise). Every paid step is budget-capped, cached and needs `--yes`.
