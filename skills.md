# skills.md - how Canary was built

**Problem:** PS05 Agent A/B Testing & Auto-Rollout, applied to VANI BuyLead qualification (VANI phones buyers when the seller is unavailable). **Team build tool:** Claude Code (an AI pair programmer) for design, code, tests and docs; the team directed scope and made the product decisions. **Platform:** Sarvam not wired in yet - see `canary/hooks.py`.

## Journey
1. **Read everything first.** PS05 and PS01 documents, the deck's scoring slides, and measured the 713 recordings (duration, bitrate, count) with code. Finding: no labels, transcripts, dispositions or base prompt - so every claim had to be built to survive that.
2. **Scoped hard.** Kept: sequential testing with a measured error rate, split + stickiness evidence, sample-ratio check, decision ledger, guardrail rule, planner, offline dashboard. Cut with reasons: failure-mining variant generation (Problem 1, and circular under simulation), CUPED (no covariates; the "30-40%" figure would be invented), per-segment promotion (multiple comparisons), post-promotion holdout (needs far more traffic).
3. **Statistics first.** Lan-DeMets alpha-spending boundaries by recursive integration; checked against published 5-look values and a 200,000-run simulation before anything was built on top.
4. **One decision function.** `Monitor.look` makes every decision in the live engine, the scenarios and the proof lab, so the proof is about the shipped logic.
5. **Proof lab and honesty.** Simulated Canary against naive peeking, a fixed-horizon test and "higher rate wins" on identical data. It found that our false-win rate is slightly above nominal (2.8% vs 2.5%) and that a first split test flattered us (round lead counts); both are reported, not hidden. It also found a 10% guardrail margin was too tight to prove with a 10% slice, so the margin is 15% and the planner shows guardrail provability.
6. **Browser testing found real bugs:** an interval that contradicted a decision (fixed by inverting the same score test), controls rebuilt every animation tick, mobile overflow, a cold-start stall.
7. **Domain correction.** First built around meeting-fixing; the team then explained the recordings are buyer requirement-capture calls, so the goal became BuyLead created and the secondary metric average handling time. Re-running the proof lab on the new baseline exposed that the split-only broken-test check was weak (a 35% silent loss shipped 44% of the time); adding a per-arm assigned-vs-logged check fixed it (0% shipped).
8. **Labels.** With none provided: Label Lab for real labels, a synthetic labelled set clearly marked as an optimistic bound, a pluggable LLM tagger, and a model of what tagger errors cost a test.

## Tools
Python 3 (numpy, scipy, standard-library HTTP server), plain JavaScript and SVG for the dashboard (no libraries, no CDN), Chrome headless + puppeteer-core for screenshot and interaction tests, `unittest`. Sarvam (speech-to-text, chat model, Bulbul) is the intended next integration.

## Reproduce
`./run.sh`. Everything in `QA_REPORT.md` is regenerated from code with fixed seeds.
