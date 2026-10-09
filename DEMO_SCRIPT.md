# Canary - 5-minute demo script and hard questions

Open `dist/canary_demo.html` (works with no internet). Live engine (new experiments, your own files) and the labelling page: `./start.sh`, then http://127.0.0.1:8765. One slide: `dist/one_slide.html`. A step-by-step walkthrough: `USER_JOURNEY.md`.

**One sentence.** We read VANI's real prompt with code, found where it contradicts itself, derived a small fix that is checked not to add contradictions, and let the A/B engine prove it on live traffic and roll it out only if it provably wins.

**Say this first.** A buyer calls a seller on IndiaMART; the seller is unavailable; the call is redirected to VANI, which confirms the product, collects quantity, specifications, name and city, and connects the buyer to a live seller. Today a prompt change reaches every buyer on judgement alone.

## The 5 minutes (the feature spec's own demo plan: set up in advance, then "Advance 1 day")

**0:00 - The problem (25 s).** "A prompt edit can quietly cost leads, and a good edit can't be proven. Canary tries a change on a slice, and ships it only if it wins. The voice test runs elsewhere; Canary judges its results." Open **Overview**: four tests are already set up, paused on day 2.

**0:25 - Watch results build (75 s).** Press **Advance all running tests 1 day (demo)** and open **Live Experiments**. "Results up to yesterday. Final winner call on day 7. Both rates with 95% ranges, the lift with its range, the call-length guardrail, a daily harm monitor, and the split panel: configured against achieved share, a chi-square check, and zero leads that saw both prompts." Keep advancing.

**1:40 - Three outcomes (80 s).** "B wins: promoted on day 7. B worse: stopped on day 4 by the daily harm check and its leads go back to A. Flat: inconclusive, keep A, and it says how many more leads would settle it. We do not force a winner."

**3:00 - A win with a catch (45 s).** Open *Offer the seller details on WhatsApp earlier*: "more BuyLeads, but calls 13% longer against a 10% limit. Not shipped and not thrown away: held for a person." Press **Approve**. "The click is in the **Decision Log**; the record re-verifies in the browser. It is now a new version in the **Prompt Library**; **Rollback** is one click, also logged."

**3:45 - Why trust it (45 s).** Back on **Overview**, the **A vs A check**: "with two identical prompts a winner is wrongly declared 2.6% of the time, against 11% for a plain p < 0.05 checked daily. We also measured the spec's one-look rule against ours on identical traffic: both keep false wins near 2.5%; the one-look rule catches a clearly worse B 89% of the time, ours 98%. It is a setting."

**4:30 - Results from outside (30 s).** "The voice test is not ours. **Import results files**: Canary checks the data, counts each lead once, lists anything odd, and decides." (Live version.) Or show **History**, which already holds six decisions made from sample result files.

**5:00 - Close (15 s).** "Setup is locked with a version ID, every decision is in a tamper-evident record, and every demo result is simulated with a known answer: it shows the engine decides correctly, not that a real prompt is better."

Technical judges: **Settings** > Tools opens the proof lab, with every number re-runnable. **Suggest A/B Tests** shows the evidence-based ideas, including the fix loop on VANI's real prompt.

## What the PM suggested, and what we did

| PM's idea | Verdict |
|---|---|
| The system proposes variant B from failed calls | **Built** on the real prompt: evidence from the prompt lint, a tagger-free loop scan and machine labels; a free candidate or a Sarvam draft; an automatic gate against new contradictions; the A/B engine decides. Our earlier claim that "fix the biggest cluster" picks the wrong target rested on a tagger mistake and is **withdrawn**; the re-tag will retest it. |
| Sequential testing vs naive peeking | **Kept.** Alpha-spending; shown against naive peeking by simulation. |
| Sample-ratio mismatch check | **Kept and strengthened.** The share-only check was weak at a 45% baseline (a 35% silent loss shipped 44% of the time). A per-arm assigned-vs-logged check now halts 100% and ships 0%. |
| CUPED | **Dropped.** It needs pre-call features that predict a one-shot yes/no outcome; the "30-40% fewer calls" depends on a correlation of about 0.6 that we cannot show, so we would be inventing the number. |
| Segment-level promotion | **Dropped for promotion** (multiple-comparison trap at these sample sizes). |
| 5% post-promotion holdout | **First extension.** At 600 calls a day a 5% holdout is 30 calls a day; seeing a 4-point fade takes about 80 days. |

## Hard questions, and answers that hold up

**Is running the voice test your job?** No, and the documents agree for this problem: PS05 says there is no live traffic and asks for a simulator or replay, its four scored criteria are statistics, split, promotion and early stop, and goals and guardrails; the BRD puts real live calls out of scope; the spec says no voice agent is needed. We still have to show the experiment running end to end, so it runs on simulated or replayed results, and the engine also judges results files from outside. The event deck additionally lists an LLM evaluator tagging test calls and a Sarvam voice test bed; we built that layer too and keep it optional; which document governs for this problem is a question for the organisers that is still open.

**What if the files you get have different columns?** The reader matches common names (lead_id/GLID, variant/control/test, disposition/outcome, duration/AHT, timestamp), accepts CSV, TSV, JSON and daily summaries, prints every assumption, and refuses with a plain message when the goal or the variant is unclear. We never repair data silently.

**Why "hold for approval" instead of stop or ship?** A win whose guardrail is not proven is valuable and uncertain. Holding it keeps callers unaffected, keeps the evidence, and puts the decision with a person; either answer is logged and the record still verifies. A guardrail that is clearly broken still stops the test.

**The BRD and the dashboard spec describe different rules. Which is right?** Both are valid and we run either (a setting). On identical simulated traffic both keep false wins near 2.5%; the spec's single end-of-test look never promotes early and catches a clearly worse B less often (89% vs 98% at -7 points); ours promotes about 15% sooner and protects better at a slightly higher false-stop rate. The numbers are in the QA report.

**Isn't this fix trivial, and will it even help?** It is deliberately small: small edits are testable. We say up front that it is a consistency fix, that verbatim loops are rare in the real calls, and that a one-point effect needs about 83,000 calls to prove on conversion. The tool's job is to tell you that, to ship only what provably helps, and to stop what hurts. It can say no.

**Why did you change your story?** Because the real prompt arrived and contradicted four of our assumptions: the call is inbound, there is no timeline, reading values back is forbidden, and live-seller connection is the top priority. We rebuilt the labels schema, retired a false failure, marked the old audio stale and re-derived the fix. Saying so is part of the product: it never claims more than it has measured.

**Your labels are machine labels made before the real prompt. Are they right?** Not measured yet, and provisional until the re-tag (about Rs 23) and a 40-call human check. We say so on every real-data number. The earlier tagger demonstrably over-flagged.

**Association is not causation.** Correct. Mining only proposes; only the live test establishes cause. The ranking is a hypothesis generator, and its first row ("ended the call abruptly") is probably inflated by correct early closes, which the re-tag will retest.

**Why no pre-check, no voice demo with the real prompt?** Cost. The rendered prompt is about 22,000 tokens, sent on every turn: 24 simulated calls cost about Rs 116 and the voice arena about Rs 53, against Rs 314 already spent on labelling. Both are one command with a budget cap when approved. The recorded audio we have used the earlier stand-in prompt, so it is labelled as voices only.

**What does the pre-check prove when it runs?** Only that an edit does no obvious harm. Simulated buyers are far more cooperative than real ones, so it cannot show a gain. The proof is the live test.

**Which BuyLead definition counts?** The real dispositions are BL Approved / BL Enriched / BL Deleted. The 47.5% we quote is a proxy for the earlier labels (quantity and specification captured); the real rate comes from the re-tag. We have asked the organisers.

**Fatal-call rate?** IndiaMART's matrix grades it, and it is the natural second guardrail. The engine guards handling time today; a fatal-rate guardrail is the next extension and the re-tag produces the data for it.

**Why alpha-spending, not mSPRT or Bayesian?** Fixed window and planned looks: spending gives a maximum sample size, a power calculation, and explicit harm and futility rules. We show the false-win rate by simulation instead of asserting it. At the default setting it is 2.3% against a 2.5% budget; the worst cell in the robustness grid is about 3% (normal approximation), which we report.

**Outcomes are simulated. What does a win prove?** That the engine finds a known injected difference, controls false wins, stops harm and logs correctly. It does not prove a real prompt is better. The baseline is measured (provisional); the 600 calls a day and the 3-point planned lift are assumptions you can change in Plan a test.

**What stops a bad edit auto-shipping?** Five gates: the lint check (no new contradiction), the optional pre-check, the harm boundary, the handling-time guardrail, and the broken-test halt. `approval: manual` adds a person before any rollout.

**What about repeat callers?** Repeat calls go to the same arm (a coin-flip router would switch 17.6% of them) and only the first call per lead is analysed.

**Customer data and the prompt?** Audio and transcripts went only to the Sarvam platform. Transcripts, labels and spend files stay on this machine and are excluded from the repository. The prompt is IndiaMART's internal configuration; it is sent to Sarvam only in a paid step run with `--yes`. Our AI coding assistant never read call content: only counts and shapes.

**How does this plug into Sarvam?** Saaras for transcripts, Sarvam-105B for tagging and drafting, Bulbul for voices. Voice agents are created in the dashboard (`data/sarvam_agent_A.md` and `_B.md`: the real inbound prompt, rendered). Promotion would flip the production prompt, which needs the platform's agent-update API; we have not verified that exists.

**Cost so far?** About Rs 314 of Sarvam credits: 299 calls transcribed and tagged (about Rs 262), the earlier voice arena and pre-screen (about Rs 52, now stale, which we have disclosed). Since the real prompt arrived, nothing has been spent.
