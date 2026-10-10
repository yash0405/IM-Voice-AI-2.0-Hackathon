---
name: ab-test-decision
description: Decides whether to ship, stop, hold or keep a change after an A/B test, and plans tests that can actually finish. Use it whenever someone has results for a control (A) and a candidate (B) - a new bot or agent prompt, voice or chat flow, model, message, feature or setting - and asks "did B win?", "is it safe to roll out?", "is this significant?", "can we stop early?", "how long should the test run?", "how much traffic does B need?", or shares a results file or dashboard numbers from a split test. Also use it when a manager wants to act on early numbers, when a test looks too good or too flat, or when someone wants a plain-language verdict on a test. Reads messy per-call or per-day result files, counts each lead once, checks the split and the data, applies pre-registered sequential rules with guardrails such as call length, and writes an honest verdict with ranges. Never runs the test itself and never decides from a plan read off the results.
license: MIT
compatibility: Python 3.10+. check_results.py and plan_test.py use only the standard library. decide.py needs numpy and scipy and the Picky engine (the repository root this skill lives in, or the folder named by CANARY_HOME).
metadata:
  version: "1.1"
  domain: experimentation
  built-for: Picky, PS05 Agent A/B Testing and Auto-Rollout (IndiaMART Voice AI Hackathon 2.0)
---

# A/B test decision

Turn "here are the results of A and B" into a verdict a non-statistician can act on: **ship**, **stop**, **hold for a person**, **keep A**, or **keep waiting**. The test itself ran somewhere else; this skill judges its results and, before a test, checks that it can finish.

## Quick start
Planning a test: `scripts/plan_test.py`. Checking a results file: `scripts/check_results.py`. Deciding: `scripts/decide.py` (needs the plan: goal, baseline, share to B, window). Then write the verdict in the report shape below. The rest of this file says how to do each step well.

## Why the process matters (read once)

Most wrong A/B decisions come from four habits, not from hard maths. The workflow below exists to remove them:

1. **Looking early and stopping on a good day.** Checking a plain p-value every day and acting the first time it dips under 0.05 gives a wrong call in roughly 1 test in 4 (about 1 in 9 a false winner) even when nothing changed. Early looks are fine only with boundaries built for repeated looks.
2. **Reading the plan off the results.** If the expected rate, split and test length are chosen after seeing data, the verdict bends toward the data. Fix the plan first.
3. **Counting calls instead of leads.** A caller who phones three times is one lead. Counting calls makes the result look surer than it is.
4. **Trusting a broken test.** If B did not get the share of leads that was configured, or calls are missing from the log, the comparison is meaningless however good the numbers look.

A verdict is also a claim about the world. State how sure you are, give ranges instead of single figures, and say plainly when the data cannot tell.

## Workflow

Paths below are relative to this skill's folder. Copy this checklist and tick it off:

```
- [ ] 1. Pin down the plan (ask for what is missing, never infer it from results)
- [ ] 2. Plan check: can this test finish? (before data, or when a window is too short)
- [ ] 3. Data check: is the file trustworthy?
- [ ] 4. Decide: run the engine
- [ ] 5. Report: verdict, evidence, range, caveats, next step
```

### 1. Pin down the plan
Get these five things from the user. They fix the decision boundaries, so they must come from the test design and not from the results:

| Item | Example | If missing |
|---|---|---|
| Goal and what counts as success | `buylead_created`, "meeting fixed" | Ask. List the dispositions in the file to help them choose. |
| Expected rate under A (baseline) | 0.45 | Ask. If they truly do not know, read A's observed rate from `check_results.py`, pass it as `--baseline`, and say the verdict is exploratory (the plan was not fixed in advance). `decide.py` will not run without it. |
| Share of traffic sent to B | 0.30 | Ask. It is needed for the split check. |
| Smallest lift worth detecting | 0.05 (5 points) | Default 0.05, stated as a default. |
| Test length in days | 14 | Ask. |
| Leads per day (new leads, not calls) | 800 | Ask; if unknown, estimate from the file and label it an assumption. Needed to turn leads into days. |

Also ask which way is better for the goal, and any **guardrail** (a metric that must not get worse: call length, early hang-ups, fatal-call share) with its tolerated change. Default for call length: not more than 15% longer.

### 2. Plan check
Run `scripts/plan_test.py` (standard library only):

```
python scripts/plan_test.py --baseline 0.40 --mde 0.03 --share-b 0.5 --per-day 800 --days 14
```
Give the answer both as leads and as days. If the window cannot reach the needed leads, say so before anyone waits two weeks, and offer the three fixes: run longer, send B more traffic (up to 50%), or aim for a bigger lift. A 10% slice needs about 2.8 times the leads of a 50/50 split.

### 3. Data check
Run `scripts/check_results.py` on the file (see `references/file-formats.md` for accepted layouts):

```
python scripts/check_results.py results.csv --goal buylead_created --share-b 0.3 --window-days 14
```
Resolve problems before deciding: split mismatch (stop: the test is broken), leads served both prompts, repeated call ids, missing outcomes, unknown variant names. Report what was left out; never repair data silently. The single-look comparison it prints is for orientation only.

It prints the date range, flags dates that look wrong (later than today, or calls after the planned window, which the engine leaves out), and compares the first half of the period with the second. A lift that shrinks a lot (for example +12 points then +6) can be a novelty effect or luck: say so, give both numbers, and recommend shipping with monitoring rather than promising the headline figure.

### 4. Decide
Run the engine, with the plan flags (required):

```
python scripts/decide.py results.csv --goal buylead_created --share-b 0.3 --baseline 0.45 --mde 0.05 --window-days 14
```
Useful variants: `--leads-per-day N` if the test's expected volume is known (otherwise it is estimated from the file), `--through-day N` for a test still running (results up to day N), `--a A.csv --b B.csv` for separate files, `--guard-name early_hangup --guard-below-s 15` for a rate guardrail, `--rule final_look` for one winner call at the end plus a strict daily harm check. If the engine is not installed, say so; do not improvise a "p < 0.05" verdict for a running test. At the planned end of a finished test a single-look comparison (`check_results.py`) is acceptable, labelled as single-look.

If the engine stops early (for example PROMOTE on day 8 of 14) and you have the whole period, also read the full window: `--rule final_look` or `check_results.py`. Report both.

Outcomes and what to do (details in `references/decision-rules.md`):

| Outcome | Meaning | Action |
|---|---|---|
| PROMOTE | B clearly better and every guardrail proven | Ship B; keep a rollback path. If the lift faded over the period (the data check warns) or the test was smaller than planned, ship with monitoring and quote the low end of the range |
| STOP_HARM | B clearly worse | Stop B, send everyone to A |
| STOP_GUARDRAIL | B breaks a guardrail | Stop B even if the goal improved |
| HOLD_FOR_APPROVAL | B wins but a guardrail is not proven or could not be evaluated | Nothing ships; a person decides; log the choice |
| INCONCLUSIVE | Window ended, no evidence either way | Keep A; report how many more leads would settle it |
| CONTINUE | Test still running: no line crossed yet, or the win line was crossed and the engine is waiting for a guardrail to be proven | Keep collecting; do not act on interim numbers |
| HALT_SRM | The test is broken (split or logging) | Fix tracking, rerun; trust nothing |

### 5. Report
Lead with the verdict in one sentence, then the evidence, in plain words. Use this shape (`references/reporting.md` has worked examples):

```
**Verdict:** <ship / stop / hold / keep A / keep waiting> - <one-line reason>
**Evidence:** A <rate> (n=<leads>) vs B <rate> (n=<leads>); B minus A = <lift> points, range <low> to <high>
**Safety checks:** <guardrails and split check results>
**What this does not tell you:** <caveats: simulated data, provisional labels, short window, data left out>
**Next step:** <ship with rollback / rerun with X more leads / ask a person to approve>
```

## Honesty rules (these protect the reader)
- Give a range with every lift. Round rates to whole percentages unless there are tens of thousands of leads; a decimal point of precision the data cannot support misleads.
- Say "no evidence of a difference" for inconclusive results, never "no difference". Absence of evidence is not evidence of absence.
- Say where outcomes come from. If the data is simulated, synthetic or labelled by a model that has not been checked by a person, say so in the caveats; do not present it as measured real-world lift.
- If the system under test labels its own outcomes (a bot that records its own disposition), warn that prompt B could change the labelling and not the result; ask for independent grading of a sample.
- If the test was smaller than the plan needed for the target lift (check with `plan_test.py`), a win probably overstates the gain: say the headline figure is flattering and quote the low end of the range as the safer expectation.
- If the engine decided early but the whole file is available, report both: what the pre-registered rule said and what the full period shows (including any fade).
- Never promise a lift. A verdict says "the evidence supports shipping", not "this will increase conversions by X".
- A guardrail that cannot be evaluated is not a pass. Hold instead of shipping.

## Limits (say so when they apply)
- Two variants and a yes/no goal (a lead converts or not). For more than two variants, a numeric goal such as revenue, or a test that was not randomised, say this skill does not cover it and what would be needed; do not force the numbers through.
- Needs a lead id to count leads once. Without one, say the intervals are too narrow by an unknown amount.
- Judges results; never changes live traffic. Shipping, stopping and rollback are done by the team.

## Common traps
Read `references/pitfalls.md` when the user shows interim results, when the split is off, when a metric was added or redefined after the test started, when many metrics are being checked at once, or when the data comes from a tagger or a bot's own labels.

## Where this method comes from
This is the method Picky's engine and dashboard are built on, packaged so any assistant can apply it to a results file without the dashboard. It was built in stages, and each stage is why a rule above exists:
1. Statistics first: alpha-spending boundaries (Lan-DeMets), checked against published values and by simulation, one decision function for everything.
2. Proof against naive methods: simulated A vs A and known-effect tests, so the error rates quoted in the reports are measured, not asserted.
3. Corrections over defence: when new documents contradicted early assumptions, the work was fixed and the claim withdrawn. The same habit is in the honesty rules above.
4. Testing found real flaws (a plan read off the data, a win that faded, an unevaluable guardrail), which is why steps 1 and 3 and the guardrail rule are strict.

How well it works, measured, is in `references/validation.md`.

## Bundled resources
- `scripts/plan_test.py`: sample size, days, smallest detectable lift (stdlib).
- `scripts/check_results.py`: data check plus single-look comparison (stdlib).
- `scripts/decide.py`: the sequential engine verdict (numpy, scipy, Picky).
- `references/decision-rules.md`: the rules in plain words, defaults, rule sets.
- `references/file-formats.md`: accepted columns and layouts, what gets dropped.
- `references/pitfalls.md`: the traps above, with how to explain them.
- `references/reporting.md`: report templates and example wording for managers.
- `references/validation.md`: how the skill was tested against an assistant without it, and what the runs taught us.
- `evals/`: the test requests (`evals.json`), their sample files, graded results, and the trigger tests for the description.
