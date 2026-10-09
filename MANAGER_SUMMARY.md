# Manager summary (9 Oct 2026)

Written for: the team lead and the non-technical teammate. Plain words; every number can be re-run (`QA_REPORT.md`).

## Prompt 1 - "The PM says the voice test is not our job. Is that right? Is the PM correct?"

**Verdict: right for the problem document, incomplete for the event deck.**

| What the PM said | What the documents say | Verdict |
|---|---|---|
| We do not run the voice test | PS05: "participants will not have live traffic: build a simulator or replay". BRD: real live calls out of scope. Dashboard spec: "no voice agent is needed for the hackathon". The four scored criteria (statistics 30, split 20, promotion and early stop 30, goals 20) say nothing about voice | **Right** |
| Files with metrics for A and B will be given; our job is to decide | Matches the "replay" idea. But nobody has told us the file format | **Right, format unknown** |
| Ours: platform before the test, rollout and early stop after | PS05 sections 3.1-3.7 are exactly these | **Right** |
| (Not said) the voice side is worth nothing | The event deck lists for this problem an LLM that tags every test call ("accuracy of auto-disposition" is a success metric) and a Sarvam voice test bed; the jury rubric gives every team 20% for Voice Experience | **Not covered** |
| (Not said) we need not run anything | We must still *show* the experiment running end to end (deliverables 1 and 2), and early stop happens *during* the test | **Needs care** |

**What we did, without being greedy:** the engine is the core and now works on results files, which is the PM's model. The voice and tagging layer already exists, costs nothing unless run, and stays optional. **Open question for the organisers (not yet asked):** which document governs for this problem, and what the metric files look like.

## Prompt 2 - "Check the two new documents and work"

**The two documents:** the *A/B Testing Dashboard Feature Spec* (from the PM) and the *Clean Slate* design theme.

| From the documents | What we did |
|---|---|
| Spec: a win with a broken guardrail is "held for approval" | **Built.** Nothing ships and nothing is thrown away; a person approves or rejects; both clicks are saved in the tamper-evident record |
| BRD and spec: an inconclusive result says how much more data is needed | **Built.** For example "5,952 more leads (about 20 days) to detect 3.5 points" |
| Spec: config locked and versioned; rollback is one click | **Built** (version, parent, lock check; rollback saved in the record) |
| Spec: "Advance 1 day" | **Built** (+1 day button) |
| Spec: a second guardrail (early hang-ups) | **Built** (optional, any rate) |
| Spec: one winner call at the end with a strict daily harm check | **Built as a setting, and measured against ours** (below). The BRD and the spec disagree with each other; we did not pick one blindly |
| Theme: Clean Slate colours | **Applied** (light mode). The theme's navy fails the colour-blind check for chart lines, so navy is used for text and the chart pair is a checked navy-blue pair |
| Spec: 6-step wizard, History, Prompt Library, Settings, Overview, model-written summaries | **Not built.** Their data exists; the screens do not. We do not let a language model write the numbers |

**Two things in the spec we questioned, with facts**
- The spec's calculator example is inconsistent: detecting 0.8 points needs about 16 days, not 12.
- "A plain daily test picks a false winner 20 to 25% of the time": measured, it is 11% false winner plus 12% false stop (23% wrong in either direction).

## Prompt 3 - "Is the PM's definition of our work correct?"

**Yes, with three refinements.** (1) Early stop is not only after the test: it happens during it, so the engine reads results day by day. (2) "Define the metrics" means a goal, which direction is better, guardrails with limits, and what happens when they conflict; all are in the setup and in the record. (3) The engine must be demonstrated on simulated or replayed results, not only described.

## Prompt 4 (earlier today) - the BRD

Scrutinised; its good ideas were adopted (hold for approval, "more leads needed", versioning) and two of its claims were corrected with numbers (the 0.5-point split target is not reachable with pure hashing; a 5% holdout for a week sees only large fades). Details in memory and `QA_REPORT.md`.

## Why it is good, with proof (proper QA)

| Claim | Evidence | Re-run |
|---|---|---|
| A decision from a file is as safe as one from the simulator | 571 files with no real difference: a winner was wrongly crowned 2.6% of the time (95% range 1.5-4.3%, budget 2.5%) | `python -m canary proof` |
| It finds real effects | +7 points promoted in 77% of 285 files (range 72-82%, designed power 80%); a 10-point harm stopped in 96.5% | same |
| The same decision whether results arrive daily or all at once | Test; a flaw here was found and fixed during this session | `python -m unittest discover -s tests` (114 tests) |
| Spec's rule vs ours | Both keep false wins near 2.5%. A clearly worse B (7 points) is stopped 98% (ours) vs 89% (spec); a real +7 point win is promoted about 15% sooner by ours | `QA_REPORT.md` 5d |
| An independent reviewer tried to break the file reader | It found real problems, for example a missing duration could let a win ship unguarded, and "results up to day 5" could use later calls. All decision-affecting ones are fixed, each with a test | 17 new tests |
| Bad files are not hidden | Repeated call ids, unknown variants, missing outcomes, leads served both prompts are all listed | sample "A messy export" |
| Edits to the record are detected | Hash chain re-checked in the browser after each click; an edited entry is caught. It is *tamper-evident*, not tamper-proof: a full rewrite is caught only if the head hash was written down elsewhere | dashboard |
| Nothing regressed | Every earlier scenario gives the same decision as before; headline proof numbers unchanged; identical numbers on a second run | verified |
| A bug we did not cause but found | The Proof page crashed because it assumed old base rates; fixed | browser test |

## What is not proven, and what we need from you
- All A/B outcomes are simulated or synthetic. We do **not** claim any real prompt is better.
- The machine labels of the real calls are still unchecked by a person and were made before the real prompt arrived (re-tag about Rs 23, then a 40-call check).
- No Sarvam credits were used in this work (spend total still Rs 313.82).
- **Decisions needed:** (1) ask the organisers the two questions above; (2) get a sample of the PM's metric files; (3) approve or decline the paid steps; (4) still unanswered: the deck rule that all build work happens on 9-10 Oct, so today's earlier work may need to be shown as built in the event.

## Update: the dashboard now follows the feature spec and the Clean Slate theme
You said the UI was different from the spec and theme. It was: it used its own screens. It has been rebuilt.

| In the feature spec | In the dashboard |
|---|---|
| Left menu: Overview, New Experiment, Live Experiments, History, Suggest A/B Tests, Prompt Library, Decision Log, Settings | **Built**, exactly these eight |
| Overview: running tests (name, day X of Y, current lift, status), production prompt, totals | **Built**, plus an "A vs A check" card |
| New Experiment, 6 steps, locked with a version ID; patch or full prompt with side-by-side diff and a template-variable check; live calculator; simulation presets B wins / B worse / flat | **Built** (the optional "Try it" chat box is shown switched off: it uses paid credits) |
| Live page: header with Pause, Stop, Approve, Rollback; "results up to yesterday" banner; number tiles; daily trend with ranges; harm monitor; split panel; progress; **Advance 1 day**; decision table | **Built**, every part |
| Demo plan: three experiments set up and paused on day 2 (B wins, B worse, flat) | **Built**, plus the BRD's bonus fourth (a win held for approval because calls run longer) |
| History with filters, frozen report, Clone, learning tag, CSV export | **Built** |
| Prompt Library with diff against the previous version, production pointer, one-click logged rollback | **Built** |
| Decision Log of every event | **Built**, with filters and CSV |
| Settings: metric list, defaults, approval mode, overlap warning | **Built** |
| Suggest A/B Tests: five idea sources, expected effect, days needed, priority, one-click start | **Built**; the "weak segments" idea says plainly it cannot be generated (no segment data), and ideas come from our own evidence, not a language model |
| Theme: Clean Slate colours, Inter font, 8-12 px corners, no shadows, header + filters + KPI cards + charts + tables, accessible status (word and symbol, never colour alone) | **Applied**. Inter is used if installed, otherwise a clean system font (offline) |
| Not built | Email/Slack alerts, the post-promotion 5% holdback, model-written summaries (a template writes them from the numbers), segments |

Independent check: a separate reviewer opened the finished dashboard in a browser and compared it with the spec and the theme line by line. It found real defects (a new test could not be launched offline; two library versions were identical so their diff was meaningless; guardrail results disagreed between screens; a range showed -100 to +100 points on early days; the Overview counted history samples the library did not). All were fixed and re-tested.

What stayed: the engine, the decision rules, the results-file reader, the skill and the technical tools page (proof lab, label calls, hear it), now under Settings > Tools. Proof: 127 tests pass; every screen and the spec's whole demo plan were exercised in a real browser (offline and live).

## Earlier update after the "extraordinary and simple" goal
| What | Why it matters | Proof |
|---|---|---|
| Whole percentages and a plain range on every verdict | Decimals the data cannot support mislead | Visible on every result |
| Honest wording for results files: Canary **advises**, it does not claim to have rolled anything out | We do not control live traffic | Result text |
| Engine rule: a win is **never shipped on a peak that has since faded**; held for a person instead | A novelty effect cannot slip through | Unit test; headline proof numbers unchanged |
| A reusable **skill** (`skill/ab-test-decision/SKILL.md`) | Plug-and-play for any AI assistant or team | 100% vs 88% of graded statements without it; see `skills.md` |
| `START_HERE.md` and `start.sh` (one command) | Five minutes to a first result | Run it |
