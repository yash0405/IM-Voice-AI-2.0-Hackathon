---
name: ab-test-decision
description: Decides whether to ship, stop, hold or keep a change after an A/B test, and plans tests that can actually finish. Use it whenever someone has results for a control (A) and a candidate (B) - a new bot or agent prompt, voice or chat flow, model, message, feature or setting - and asks "did B win?", "is it safe to roll out?", "is this significant?", "can we stop early?", "how long should the test run?", "how much traffic does B need?", or shares a results file or dashboard numbers from a split test. Also use it when a manager wants to act on early numbers, when a test looks too good or too flat, or when someone wants a plain-language verdict on a test. Reads messy per-call or per-day result files, counts each lead once, checks the split and the data, applies pre-registered sequential rules with guardrails such as call length, and writes an honest verdict with ranges. Never runs the test itself and never decides from a plan read off the results.
license: MIT
compatibility: Python 3.10+. check_results.py and plan_test.py use only the standard library. decide.py needs numpy and scipy and the Picky engine (the repository root, or the folder named by CANARY_HOME).
metadata:
  version: "1.1"
  domain: experimentation
  built-for: Picky, PS05 Agent A/B Testing and Auto-Rollout (IndiaMART Voice AI Hackathon 2.0)
---

# A/B test decision

Turn "here are the results of A and B" into a verdict a non-statistician can act on: **ship**, **stop**, **hold for a person**, **keep A**, or **keep waiting**. The test itself ran somewhere else; this skill judges its results and, before a test, checks that it can finish.

## Quick start
Planning a test: `decision-tools/plan_test.py`. Checking a results file: `decision-tools/check_results.py`. Deciding: `decision-tools/decide.py` (needs the plan: goal, baseline, share to B, window). Then write the verdict in the report shape below. The rest of this file says how to do each step well.

## Why the process matters (read once)

Most wrong A/B decisions come from four habits, not from hard maths. The workflow below exists to remove them:

1. **Looking early and stopping on a good day.** Checking a plain p-value every day and acting the first time it dips under 0.05 gives a wrong call in roughly 1 test in 4 (about 1 in 9 a false winner) even when nothing changed. Early looks are fine only with boundaries built for repeated looks.
2. **Reading the plan off the results.** If the expected rate, split and test length are chosen after seeing data, the verdict bends toward the data. Fix the plan first.
3. **Counting calls instead of leads.** A caller who phones three times is one lead. Counting calls makes the result look surer than it is.
4. **Trusting a broken test.** If B did not get the share of leads that was configured, or calls are missing from the log, the comparison is meaningless however good the numbers look.

A verdict is also a claim about the world. State how sure you are, give ranges instead of single figures, and say plainly when the data cannot tell.

## Workflow

The scripts live in the repository's `decision-tools/` folder; paths below are relative to the repository root. Copy this checklist and tick it off:

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
Run `decision-tools/plan_test.py` (standard library only):

```
python decision-tools/plan_test.py --baseline 0.40 --mde 0.03 --share-b 0.5 --per-day 800 --days 14
```
Give the answer both as leads and as days. If the window cannot reach the needed leads, say so before anyone waits two weeks, and offer the three fixes: run longer, send B more traffic (up to 50%), or aim for a bigger lift. A 10% slice needs about 2.8 times the leads of a 50/50 split.

### 3. Data check
Run `decision-tools/check_results.py` on the file (accepted layouts are under "Results file formats" below):

```
python decision-tools/check_results.py results.csv --goal buylead_created --share-b 0.3 --window-days 14
```
Resolve problems before deciding: split mismatch (stop: the test is broken), leads served both prompts, repeated call ids, missing outcomes, unknown variant names. Report what was left out; never repair data silently. The single-look comparison it prints is for orientation only.

It prints the date range, flags dates that look wrong (later than today, or calls after the planned window, which the engine leaves out), and compares the first half of the period with the second. A lift that shrinks a lot (for example +12 points then +6) can be a novelty effect or luck: say so, give both numbers, and recommend shipping with monitoring rather than promising the headline figure.

### 4. Decide
Run the engine, with the plan flags (required):

```
python decision-tools/decide.py results.csv --goal buylead_created --share-b 0.3 --baseline 0.45 --mde 0.05 --window-days 14
```
Useful variants: `--leads-per-day N` if the test's expected volume is known (otherwise it is estimated from the file), `--through-day N` for a test still running (results up to day N), `--a A.csv --b B.csv` for separate files, `--guard-name early_hangup --guard-below-s 15` for a rate guardrail, `--rule final_look` for one winner call at the end plus a strict daily harm check. If the engine is not installed, say so; do not improvise a "p < 0.05" verdict for a running test. At the planned end of a finished test a single-look comparison (`check_results.py`) is acceptable, labelled as single-look.

If the engine stops early (for example PROMOTE on day 8 of 14) and you have the whole period, also read the full window: `--rule final_look` or `check_results.py`. Report both.

Outcomes and what to do (the rules behind each are under "Decision rules in detail" below):

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
Lead with the verdict in one sentence, then the evidence, in plain words. Use this shape (worked examples are under "Report examples" below):

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
Read "Pitfalls" below when the user shows interim results, when the split is off, when a metric was added or redefined after the test started, when many metrics are being checked at once, or when the data comes from a tagger or a bot's own labels.

## Decision rules in detail
Before the test starts, the plan fixes two lines on a score called z (how many standard errors B is ahead of or behind A): a **win line** that is very high early and relaxes to about 2 by the end, and a lower **harm line**, so a clearly worse B is stopped sooner than a better B is promoted (losing calls costs more than waiting). The lines are built for repeated looks, so checking daily does not inflate false winners: the false-win rate stays near the 2.5% one-sided budget. The price is about 6% more data than one look at the end.

| Outcome | Rule |
|---|---|
| HALT_SRM | Checked first. B's share of leads differs from the configured share (p < 0.001), or calls go missing from the log more in one arm. Nothing else is trusted. |
| (waiting) | Fewer than 50 leads in an arm: no decision yet. |
| STOP_HARM | z reaches the harm line. With the `final_look` rule, also when B is significantly worse (95%, two-sided) on the last day: keep A, logged as a loss. |
| STOP_GUARDRAIL | A guardrail's worsening is clearly beyond its limit. |
| PROMOTE | z reaches the win line and every guardrail is proven inside its limit. |
| HOLD_FOR_APPROVAL | B won but a guardrail is not proven or cannot be evaluated (missing, unusable or constant values), or the evidence faded back below the line by the end (never shipped on a peak), or approval is set to manual. Callers are unaffected while a person decides. |
| INCONCLUSIVE | The window ended and no line was crossed. Keep A; say how many more leads would settle it. |
| CONTINUE | No line crossed yet, or the win line was crossed and a guardrail is still being proven. |

**Defaults.** Error budget 2.5% one-sided (a 95% two-sided test), power 80% for the planned lift. Duration guardrail: not more than 15% longer (a 10% limit on a 10% traffic slice is too tight to prove and rejects real wins by noise). Rate guardrails (early hang-ups, fatal calls): not more than 2 points worse unless the user says otherwise. Each lead counts once, in the arm that served its first call.

**Two rule sets.** `sequential` (default) may promote or stop at any daily look: early answers, strong protection from harm. `final_look` makes one winner call at the end plus a strict daily harm check (99.9% bar): simpler to explain, never promotes early. On identical simulated traffic both keep false wins near 2.5% and both keep a 7-point-worse B out in about 98% of runs; sequential sends about 11% fewer calls to that B and promotes a real +7-point win about 15% sooner.

**Before any decision:** the plan was given up front; the split check passed; results up to day d use only calls made up to day d (so reading daily or all at once gives the same verdict); leads beyond the planned maximum are not used.

## Results file formats
- **Per call (preferred):** one row per call. CSV, TSV, semicolon or pipe separated, JSON list, `{"rows": [...]}` or JSON lines. Column names are matched flexibly (case and punctuation ignored).

| Meaning | Accepted names | Needed? |
|---|---|---|
| Lead / caller | lead_id, lead, glid, buyer_id, customer_id, user_id, phone, mobile | Strongly. Without it every call is its own lead and repeat callers are over-counted. |
| Prompt that served the call | variant, arm, group, bucket, prompt_version, prompt (values A/B, control/test, baseline/candidate, 0/1, v1/v2) | Yes, or send A and B as two files |
| Outcome | disposition, call_outcome, outcome, result, label, status | Yes, unless there is a 0/1 goal column |
| 0/1 goal | goal_hit, converted, goal, success | Alternative to the outcome column; if the user names goal dispositions, those win |
| Call length (s) | duration_s, duration, aht, handling_time | For the call-length guardrail |
| When | timestamp, call_time, start_time, created_at, date (+ time) | For day-by-day reading; zone offsets become UTC; without it the file is read in order in up to 40 steps |
| Call id | call_id, session_id, id | Removes repeated rows |
| Connected | connected, answered | Only if the goal is "per connected lead" |

- **Two files:** `--a A.csv --b B.csv` (engine) or list the two files (`check_results.py`); no variant column needed.
- **Daily summary:** one row per day and prompt: `date` (or day number), `variant`, `leads`, `goal_count`, optionally `mean_duration`, `sd_duration`, `guard_count`. Duplicates are refused. A summary cannot show whether a lead saw both prompts, so say so in the caveats.
- **Dropped and reported:** repeated call ids, rows with no readable outcome, unknown variant values, unusable durations, calls after the window. **Refused with a plain message:** a goal that matches nothing (usually a typo), a text guardrail column, impossible counts, a missing plan, results for only one prompt. An unusable duration column means the call-length guardrail cannot be evaluated, so a win is held for a person.

## Pitfalls
- **Peeking.** "Day 3, p = 0.03, ship it." With daily looks a plain test crowns a false winner about 11% of the time and a false loser another 11%, so about 1 test in 4 gets a wrong call. Say: "A lead this early is mostly luck; B has not crossed the day-3 line. Keep collecting." Show the real state with `decide.py --through-day 3`.
- **A broken split.** B got 36% when 30% was configured, or the log and the router disagree on counts. The test did not run as designed: fix tracking and rerun; never "adjust".
- **Calls instead of leads.** Repeat callers make results look surer. One lead, one count; with no lead id, say the interval is too narrow by an unknown amount.
- **Changing the plan or metric after seeing data.** It lets any result be bent into a win. Treat it as a new test and say what changed.
- **Many metrics.** One "significant" metric out of ten is expected by chance. One primary goal up front; the rest are guardrails or are reported only.
- **The system labels its own outcomes.** A new prompt can change how outcomes are recorded, not what happened. Ask for independent grading of a random sample and call the result provisional until then.
- **Timing.** Day-of-week and novelty effects skew early days: keep at least a full week and do not extrapolate a lift from a short window.
- **Simulated data** proves the engine finds a known injected difference; it says nothing about a real prompt. Label it and never quote a simulated lift as a result.
- **Inconclusive is a result.** The test could not tell; it does not mean the change is useless. Say how many more leads would settle it.

## Report examples
Rounding: whole percentages for rates, one decimal for lifts (unless there are tens of thousands of leads), always a range with a lift. For a planning question, give the need in leads and in days, whether it fits, the chance of spotting the lift in the window, how many leads see the unproven prompt (10% of 11,200 is about 1,100 against 50% about 5,600), and the three fixes: longer, more traffic to B, a bigger lift.

Figures below are real engine output on the synthetic files in `data/samples/` (baseline 45%, 30% to B, 14 days).
- **Ship.** Verdict: ship B, it beat A with every safety check passing. Evidence: A 44% (n=1,431) vs B 51% (n=581); B minus A about +6 points, range +1 to +11. Safety: B got 29% of leads (configured 30%); call length within the limit. Does not tell you: the data is synthetic. Next: ship with a one-click rollback and recheck in a week.
- **Hold.** Verdict: hold, B wins but its calls run about 21% longer against a 15% limit. Evidence: A 43% vs B 53%; about +10 points, range +5 to +15. Next: a person decides whether the extra conversions are worth longer calls; either choice is logged; callers are unaffected meanwhile.
- **Inconclusive.** Verdict: keep A, no evidence of a difference. Evidence: A 45% vs B 42%; about -3 points, range -8 to +2. The test could detect 7 points, so any real lift is smaller; detecting 3.5 points would need about 6,000 more leads (about 3 weeks). Next: decide whether a lift that small matters before waiting.

Words to avoid: "proven", "guaranteed", "will increase conversions by X", "no difference" (for inconclusive), "statistically significant" without saying how many looks were taken, a p-value from an interim look.

## Bundled scripts
- `decision-tools/plan_test.py`: sample size, days, smallest detectable lift (stdlib).
- `decision-tools/check_results.py`: data check plus single-look comparison (stdlib).
- `decision-tools/decide.py`: the sequential engine verdict (numpy, scipy, Picky).

This is the method Picky's engine and dashboard are built on, packaged so any assistant can apply it to a results file. In 5 test requests it held 100% of its checks against 88% for an assistant without it, mostly through rigour: the data check, an exploratory-plan label, engine-backed verdicts and a fade warning.
