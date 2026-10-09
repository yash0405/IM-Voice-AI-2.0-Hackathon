# BRD traceability: every requirement of the second BRD (9 Oct), where it lives, and how it is proven

Status words: **Built** (as the BRD says), **Adapted** (same job, different means, reason given), **Not adopted** (reason given). Every number is re-runnable (`python -m canary proof`, `python -m canary qa`, `python -m unittest discover -s tests`).

## Problems P1 to P10
| # | The BRD's problem | Status | Where | Proof |
|---|---|---|---|---|
| P1 | Prompt changes go to all traffic at once | Built | router gives B a configured slice; promotion only by the engine or an approval | QA_REPORT 5; Live page |
| P2 | No fair way to split | Built | `router.py` sticky by lead; stratified blocks | 0 leads saw both prompts in every run; QA_REPORT 5d |
| P3 | Test groups can be skewed | Built | `StratifiedRouter`: blocks of 10 inside each HL Type x GST Nature of Business group; balance table | mix gap about 0.4 pp vs 1.5 pp for plain random (7,000 leads, 30% to B); with 85 groups, small tests merge most groups into "Other" and gain little (QA_REPORT 5d) |
| P4 | No way to target a segment | Built | `catalog.py`, wizard step 3 (a segment builder: factor, values; AND between rows, OR within), the rule in plain words | `tests/test_brd2.py`, `tests/test_plan_units.py`, `new_experiment_e2e.mjs` |
| P5 | No agreed goal for "better" | Built | goal cards: one primary, up to 3 guardrails | wizard step 4 |
| P6 | Test length is guessed | Built | calculator, whole weeks 7 to 28, green / amber / red | wizard refuses other lengths (test) |
| P7 | Good changes are not rolled out quickly | Built | auto-promotion on the decision day, optional approval | scenario 1 |
| P8 | Bad changes are not caught quickly | Built | daily 99.9% harm check; leads go back to A | scenario 2 (stopped on day 4 of 7) |
| P9 | No record of what was tested and why | Built | hash-chained decision record, Decision Log, `export-db` (SQLite) | chain re-verified in the browser; 15 export tests |
| P10 | No live traffic | Built | simulator with an injected effect; replay of a results file | scenarios 1 to 4; decisions from files |

## Goals and success measures (judging weights)
| Goal (weight) | Target in the BRD | Measured |
|---|---|---|
| Pick winners correctly (30%) | A = B over 1,000+ runs: false winner about 5% | 12,000 runs: 2.50% wrongly promoted, 2.22% logged as a loss, 4.73% look different either way. The BRD's "5%" is the two-sided total; only 2.5% would ship. The dashboard button runs 1,000 such tests live in the browser |
| Split traffic accurately (20%) | within +/-0.5 pp; 0 leads see both; same lead mix | share error 0.04 to 0.05 pp at 7,000 leads (0.10 pp at 1,000 leads, 10% share), every run within +/-0.5 pp; 0 leads saw both; mix gap about 0.4 pp on the two blocked factors (plain random about 1.5 pp) |
| Promote and stop on time (30%) | all demo scenarios end in the right decision, logged with reason, numbers, time | the five demo tests end as designed (promote, stop on day 4, inconclusive, held, promote in a segment); each decision is in the record |
| Primary and guardrail goals (20%) | any disposition as primary; duration and early hang-ups as guardrails | metric list in Settings; both guardrails computed on simulated traffic; fatal-call guardrail on result files |
| Easy to use | a non-technical user can set up, save and launch | six-step wizard with a calculator, checklist, Save Test and Launch Test |

## Scope
| In scope | Status | Note |
|---|---|---|
| Variable catalog and segment builder | Built | catalog is synthetic (the recordings carry no lead attributes), labelled on every screen that shows it |
| A/B router in front of the bot: segment check, stratified sticky split | Built | out-of-segment leads keep today's prompt and are counted separately, not analysed |
| Call simulator on historical data, advanced one day at a time | Adapted | durations are resampled from the 713 real recordings; outcomes are generated from an injected known effect (no outcome data was provided) |
| Goal cards, duration calculator, pre-launch checklist, Save Test, Launch Test | Built | |
| Daily harm check, end-of-test winner call, auto-promotion with optional approval | Built | |
| Dashboard: Overview, New Experiment, Live Experiment (Split health), History, Suggest A/B Tests, Prompt Library, Decision Log, Settings | Built | the eight screens |

## Key decisions
| Decision | Status | Note |
|---|---|---|
| Winner call once at the end, two-proportion z-test, 95%, 80% power | Built (default rule) | `rule_set = final_look`; the sequential rule stays as a setting |
| Early stop: daily harm check only, 99.9% one-sided | Built | one addition: on the last day the call is two-sided, so a B significantly worse at 95% is kept out and logged as a loss (the BRD's decision table row) |
| Unit of analysis: lead; sticky by lead ID | Built | |
| Split stratified by Hot Lead type and Nature of Business | Built | small groups merge into "Other" |
| Only pre-call variables in a segment | Built | in-call variables are refused with a reason |
| Exactly one primary, up to 3 guardrails | Built | this build computes two guardrail kinds on simulated traffic |
| Duration 7 to 28 days, whole weeks | Built | |
| Simulated effect injected into B's input, never the result | Built | |
| Promotion automatic by default; approval switch; both logged | Built | |
| Voice agent not built; integration point shown | Built | Prompt Library banner and `INTEGRATION.md` |
| Bayesian methods not used | Kept | |
| Min leads per variant 1,000 before the harm check | Built, with a warning | at a 10% share the check would start on day 10 of a 7-day test; the calculator shows the start day and turns amber. The end-of-test call is not held back by this gate |

## Implementation modules
| Module | Status | Where |
|---|---|---|
| 0 Variable catalog | Built | `catalog.py`, Settings |
| 1 Experiment setup, statuses Draft to Stopped, locked versions | Built | `Config` (hash, version, parent), wizard, Save Test / Launch Test / Scheduled |
| 2 Router (segment check, sticky, stratified, shuffled blocks of 10) | Built | `router.py` |
| 3 Call simulator, Advance 1 day, seeded | Built | `simulator.py`, Live page |
| 4 Metrics and goal cards | Built | `console.metrics()`, wizard step 4 |
| 5 Stats engine: calculator, daily harm and split health, end-of-test call | Built | `engine.py`, `seqdesign.py`, `stats.py`, calculator in the wizard |
| 6 Decision and rollout: table, holdback, rollback, report | Built | `engine.act_on_decision`, `holdback_week`, final report. The write-up is a template from the numbers, not a language model |

## Dashboard screens
| Screen | Status | Notes |
|---|---|---|
| Overview | Built | tiles, business impact (simulated; also shows the low end of the 95% range), live prompt, needs attention, running cards (lift grey until the final call), traffic map, recent decisions, scorecard, top suggestion |
| New Experiment | Built | six steps, sticky calculator, "Try it" chat shown switched off (it spends credits) |
| Live Experiment | Built | header actions, banner, tiles, trend, harm monitor, Split health (by lead, call, day; chi-square; both = 0; balance table; segment check), progress, Advance 1 day, holdback |
| History | Built | filters by decision, metric and segment; CSV; clone; learning tag; frozen report with segment rule and achieved lead mix |
| Suggest A/B Tests | Adapted | cards with hypothesis, proposed change, metric, effect, days, priority ("Create experiment" opens the full prompt B); ideas come from the prompt lint, call scans and past tests; the weak-segment idea is disabled (synthetic lead data would make it up); no language model |
| Prompt Library, Decision Log, Settings | Built | Settings also holds the variable catalog and the overlap warning |

## Tech stack and data model
| BRD | Status | Reason |
|---|---|---|
| Streamlit | Not adopted | our dashboard is plain HTML and JavaScript: no installation, runs offline as one file |
| Python, pandas, scipy | Adapted | Python, numpy, scipy (pandas not needed) |
| SQLite | Adapted | `python -m canary export-db` writes all eleven tables of the BRD's data model; the live store is JSON plus a hash-chained ledger |
| LLM agent (segments, goal cards, suggestions, write-ups) | Not adopted | a rule-based reader shows the exact rule; templates write the summaries; no credits are spent and no number is invented |

## Deliverables and demo
Scenarios 1 to 4, the A vs A proof, the split evidence, the working dashboard including a segmented test, and the one slide are all in place: `DEMO_SCRIPT.md` follows the BRD's demo run; the slide is `dist/one_slide.html`.

## Build phases and risks
Phases 0 to 3 are done; Phase 4: Suggest A/B Tests and the 5% holdback are done; LLM report summaries and the "Try it" chat are not (credits); Phase 5: scenarios seeded, one slide done, integration note in `INTEGRATION.md`. Risks: a small segment needing over 28 days (the calculator warns: *Segment too small. Widen the segment or raise the B share.*), strata too small for blocks (merged into "Other"), the agent misreading a segment (the exact rule is always shown), the bot tagging its own dispositions (flagged in the README limitations), day-of-week patterns (whole weeks).

## Open items the BRD leaves to the organisers
Whether a simulator with an injected effect is acceptable, the format of the base prompt, the final weights, and whether a stable lead ID exists in the real data (the recordings carry none).
