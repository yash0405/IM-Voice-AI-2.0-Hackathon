# Picky - Test it, pick it, ship it: 5-minute demo script and hard questions

Run `./live.sh` and open http://127.0.0.1:8790 (the whole console plus **Live call test**). `dist/canary_demo.html` works offline for everything except the voice screen. One slide: `dist/one_slide.html`.

**One sentence.** Picky tries a change to VANI's prompt on a small, fair share of real calls, decides with statistics that peeking cannot fool, and ships or rolls back by itself, so a person only steps in when a business trade-off needs a yes.

**Say this first.** A buyer calls a seller on IndiaMART; the seller is unavailable; the call is redirected to VANI, which confirms the product, collects quantity, specifications, name and city, and connects the buyer to a live seller. Today a prompt change reaches every buyer on judgement alone.

## The 5 to 6 minutes

Before recording: **Settings → Reset the demo** (six tests on day 2). In Sarvam, have the agent with version 1 (prompt A) and version 2 (prompt B) open in a second tab.

**0:00 - The problem (30 s).** **Overview**. "A prompt edit can quietly cut leads, and a good edit can never be proven. Picky splits callers fairly between today's prompt (A) and the new one (B) and decides once, by rules locked before the test." Point at the **Autopilot** line: stops a worse B the same day, ships a winner with a 5% double-check, rolls back if B slips, keeps A if a held win gets no answer.

**0:30 - Set up a test (75 s).** **New Experiment**. Step 1: click the ready idea *Cap every question at two asks*: "it fills all six steps, prompt B included." Step 2: the red/green diff and "all template variables kept". Step 3: leave it on all leads (or **+ Add condition** Legal Status is Proprietorship). Step 4: BuyLead created is already the goal, call duration is a guardrail. Step 5: the arithmetic as a line: leads a day → 30% to B → leads B needs → days. Step 6: "all 6 checks pass" → **Launch Test**: "the setup is locked with a version ID."

**1:45 - Watch it decide (75 s).** **Overview → ▶ Play**. While it runs: "B wins: promoted on day 7. B worse: stopped on day 4 by the daily harm check. Flat: no clear winner, so A stays. Proprietors: wins for that segment only." Open **Live Experiments**: the day strip ("green = no harm that day, the flag is the final call"), A and B with ranges on hover, the chart, **Split health**: "the split matches the plan, nobody heard both prompts."

**3:00 - The autopilot (45 s).** *Promise the seller's details right after the call*: "it won the test, then slipped after rollout; the 5% holdback caught it and the autopilot rolled it back with no person involved." Press **Verify record**: chain intact. *WhatsApp details earlier*: "a win with 12% longer calls needs a yes; nobody answered in 2 days, so the autopilot kept A, the safe choice." **Decision Log**: both actions, signed "Picky autopilot".

**3:45 - Hear it (60 s).** **Live call test**: the patch, the threshold fixed before call 1 ("5 per prompt: catches a big gap; a false winner 1.1% of the time"), **Lock**. Make one call (in this page, or in Sarvam's test panel and logged here with "Talk somewhere else, log it here"), give the signal: "the result stays locked until every prompt has its 5 calls, so nobody stops on a lucky streak." Show a released result: the winner or "no clear winner", the reveal of which line was which prompt, and **Grade calls with Sarvam**: how often Sarvam's own tag agrees with ours (the deck's auto-disposition accuracy).

**4:45 - Why trust it (40 s).** **Overview**, the chart: "with B secretly identical to A, Picky wrongly ships 2.5%; checking p < 0.05 every day ships 8.3%." Press **Run 1,000 A vs A tests now**: the same in your browser, in a second. Our statistics match statsmodels and GrowthBook's engine; the charts, the diff and the record check use standard tools (Chart.js, jsdiff, Web Crypto).

**5:25 - Close (20 s).** "Locked setup, tamper-evident record, and every result simulated with a known answer: it shows the engine decides correctly, not that a real prompt is better. What it needs to go live on Sarvam: one API call to switch the deployment's version."

Technical judges: every number is re-runnable (`python -m unittest discover -s tests`, 304 tests; browser suites in `tests/browser/`); `python -m canary export-db` writes every test to one SQLite file.

## What the PM suggested, and what we did

| PM's idea | Verdict |
|---|---|
| The system proposes variant B from failed calls | **Built** on the real prompt: evidence from the prompt lint, a tagger-free loop scan and machine labels; a free candidate or a Sarvam draft; an automatic gate against new contradictions; the A/B engine decides. Our earlier claim that "fix the biggest cluster" picks the wrong target rested on a tagger mistake and is **withdrawn**; the re-tag will retest it. |
| Sequential testing vs naive peeking | **Kept.** Alpha-spending; shown against naive peeking by simulation. |
| Sample-ratio mismatch check | **Kept and strengthened.** The share-only check was weak at a 45% baseline (a 35% silent loss shipped 44% of the time). A per-arm assigned-vs-logged check now halts 100% and ships 0%. |
| CUPED | **Dropped.** It needs pre-call features that predict a one-shot yes/no outcome; the "30-40% fewer calls" depends on a correlation of about 0.6 that we cannot show, so we would be inventing the number. |
| Segment-level promotion | **Segments as an audience: built** (the second BRD asks for it). **Per-group winners: not used for the decision** (multiple-comparison trap at these sample sizes); per-group numbers are shown for insight only. |
| 5% post-promotion holdout | **Built** (the second BRD asks for it): 5% of leads stay on A for 7 days after a promotion. At 1,000 leads a day that slice can only rule out a drop of about 11 points or more, so it is a safety net, not a re-proof; the card says so. |

## Hard questions, and answers that hold up

**Is running the voice test your job?** No, and the documents agree for this problem: PS05 says there is no live traffic and asks for a simulator or replay, its four scored criteria are statistics, split, promotion and early stop, and goals and guardrails; the BRD puts real live calls out of scope; the spec says no voice agent is needed. We still have to show the experiment running end to end, so it runs on simulated or replayed results, and the engine also judges results files from outside. The event deck additionally lists an LLM evaluator tagging test calls and a Sarvam voice test bed; we built that layer too and keep it optional; which document governs for this problem is a question for the organisers that is still open.

**What if the files you get have different columns?** The reader matches common names (lead_id/GLID, variant/control/test, disposition/outcome, duration/AHT, timestamp), accepts CSV, TSV, JSON and daily summaries, prints every assumption, and refuses with a plain message when the goal or the variant is unclear. We never repair data silently.

**Why "hold for approval" instead of stop or ship?** A win whose guardrail is not proven is valuable and uncertain. Holding it keeps callers unaffected, keeps the evidence, and puts the decision with a person; either answer is logged and the record still verifies. A guardrail that is clearly broken still stops the test.

**The BRD and the dashboard spec describe different rules. Which is right?** Both are valid and we run either (a setting). On identical simulated traffic both keep false wins near 2.5%. The second BRD's rule (one winner call, a two-sided call on the last day, a strict daily harm check) is now the default and keeps a B that is 7 points worse out in about 98% of runs, as ours does; ours sends about 12% fewer calls to that B and promotes a real winner about 15% sooner. The numbers are in the QA report (5d, 5e).

**Isn't this fix trivial, and will it even help?** It is deliberately small: small edits are testable. We say up front that it is a consistency fix, that verbatim loops are rare in the real calls, and that a one-point effect needs about 83,000 calls to prove on conversion. The tool's job is to tell you that, to ship only what provably helps, and to stop what hurts. It can say no.

**Why did you change your story?** Because the real prompt arrived and contradicted four of our assumptions: the call is inbound, there is no timeline, reading values back is forbidden, and live-seller connection is the top priority. We rebuilt the labels schema, retired a false failure, marked the old audio stale and re-derived the fix. Saying so is part of the product: it never claims more than it has measured.

**Your labels are machine labels made before the real prompt. Are they right?** Not measured yet, and provisional until the re-tag (about Rs 23) and a 40-call human check. We say so on every real-data number. The earlier tagger demonstrably over-flagged.

**Association is not causation.** Correct. Mining only proposes; only the live test establishes cause. The ranking is a hypothesis generator, and its first row ("ended the call abruptly") is probably inflated by correct early closes, which the re-tag will retest.

**Why no pre-check, no voice demo with the real prompt?** Cost. The rendered prompt is about 22,000 tokens, sent on every turn: 24 simulated calls cost about Rs 116 and the voice arena about Rs 53, against Rs 314 already spent on labelling. Both are one command with a budget cap when approved. The recorded audio we have used the earlier stand-in prompt, so it is labelled as voices only.

**What does the pre-check prove when it runs?** Only that an edit does no obvious harm. Simulated buyers are far more cooperative than real ones, so it cannot show a gain. The proof is the live test.

**Which BuyLead definition counts?** The real dispositions are BL Approved / BL Enriched / BL Deleted. The 47.5% we quote is a proxy for the earlier labels (quantity and specification captured); the real rate comes from the re-tag. We have asked the organisers.

**Fatal-call rate?** IndiaMART's matrix grades it, and it is the natural second guardrail. The engine guards handling time today; a fatal-rate guardrail is the next extension and the re-tag produces the data for it.

**Why alpha-spending, not mSPRT or Bayesian?** Fixed window and planned looks: spending gives a maximum sample size, a power calculation, and explicit harm and futility rules. We show the false-win rate by simulation instead of asserting it. At the new default (one winner call) it is 2.5% against a 2.5% budget; the worst cell in the robustness grid is about 3% (normal approximation), which we report.

**Outcomes are simulated. What does a win prove?** That the engine finds a known injected difference, controls false wins, stops harm and logs correctly. It does not prove a real prompt is better. The baseline is measured (provisional); the 1,000 leads a day, the 45% baseline and the planned lift are assumptions you can change in Settings.

**What stops a bad edit auto-shipping?** Five gates: the lint check (no new contradiction), the optional pre-check, the harm boundary, the handling-time guardrail, and the broken-test halt. `approval: manual` adds a person before any rollout.

**What about repeat callers?** Repeat calls go to the same arm (a coin-flip router would switch 17.6% of them) and only the first call per lead is analysed.

**Where do the lead factors (HL Type, Legal Status, Vertical...) and the 30-day history come from?** The recordings carry none, so the catalog uses the New Experiment spec's factors and values with a placeholder mix, and the 30-day history is a labelled synthetic placeholder (call lengths resampled from the 713 real recordings); every screen that shows them says so. It affects only who is eligible and how the split is checked, never an outcome. With real lead data the catalog is replaced and nothing else changes.

**Does a language model read the segment?** No: the audience is built from lists (a factor, then its values), never typed, and the rule is shown in plain words as you build it. An earlier plain-English reader was replaced by this builder in the New Experiment overhaul.

**The BRD says false winners about 5%. You show 2.5%?** The BRD's 5% is the two-sided 95% test: about 5% of identical-prompt tests look different, half in B's favour. We report both: 2.5% wrongly promoted and about 2.2% logged as a loss (nothing ships). Counting only wrong shipments, 2.5% is the right target.

**Customer data and the prompt?** Audio and transcripts went only to the Sarvam platform. Transcripts, labels and spend files stay on this machine and are excluded from the repository. The prompt is IndiaMART's internal configuration; it is sent to Sarvam only in a paid step run with `--yes`. Our AI coding assistant never read call content: only counts and shapes.

**How does this plug into Sarvam?** Saaras for transcripts, Sarvam-105B for tagging and drafting, Bulbul for voices. Voice agents are created in the dashboard (`data/sarvam_agent_A.md` and `_B.md`: the real inbound prompt, rendered). Promotion would flip the production prompt, which needs the platform's agent-update API; we have not verified that exists.

**Cost so far?** About Rs 314 of Sarvam credits: 299 calls transcribed and tagged (about Rs 262), the earlier voice arena and pre-screen (about Rs 52, now stale, which we have disclosed). Since the real prompt arrived, nothing has been spent.
