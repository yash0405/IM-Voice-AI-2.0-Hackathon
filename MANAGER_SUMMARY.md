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
| Spec: 6-step wizard, History, Prompt Library, Settings, Overview, model-written summaries | **Screens built later the same day (see the update below).** Model-written summaries are not built: we do not let a language model write the numbers |

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
| The same decision whether results arrive daily or all at once | Test; a flaw here was found and fixed during this session | `python -m unittest discover -s tests` (162 tests at the last count) |
| Spec's rule vs ours | Both keep false wins near 2.5%. Since the second BRD's two-sided end-of-test call was added, both keep a B that is 7 points worse out in about 98% of runs; ours sends about 12% fewer calls to it and promotes a real +7 point win about 15% sooner | `QA_REPORT.md` 5e |
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
| Not built (then) | Email/Slack alerts, model-written summaries (a template writes them from the numbers). Segments and the 5% holdback were built after the second BRD (below) |

Independent check: a separate reviewer opened the finished dashboard in a browser and compared it with the spec and the theme line by line. It found real defects (a new test could not be launched offline; two library versions were identical so their diff was meaningless; guardrail results disagreed between screens; a range showed -100 to +100 points on early days; the Overview counted history samples the library did not). All were fixed and re-tested.

What stayed: the engine, the decision rules, the results-file reader, the skill and the technical tools page (proof lab, label calls, hear it), now under Settings > Tools. Proof: 127 tests passed at that point (162 now, after the second BRD); every screen and the spec's whole demo plan were exercised in a real browser (offline and live).

## Earlier update after the "extraordinary and simple" goal
| What | Why it matters | Proof |
|---|---|---|
| Whole percentages and a plain range on every verdict | Decimals the data cannot support mislead | Visible on every result |
| Honest wording for results files: Picky **advises**, it does not claim to have rolled anything out | We do not control live traffic | Result text |
| Engine rule: a win is **never shipped on a peak that has since faded**; held for a person instead | A novelty effect cannot slip through | Unit test; headline proof numbers unchanged |
| A reusable **skill** (`skill/ab-test-decision/SKILL.md`) | Plug-and-play for any AI assistant or team | 100% vs 88% of graded statements without it; see `skills.md` |
| `START_HERE.md` and `start.sh` (one command) | Five minutes to a first result | Run it |


## Prompt 5 - "A new BRD came: check it, change what it improves, find add-ons"

**Verdict: mostly the same design as ours; five real gaps, all built; three of its numbers corrected.**

| In the new BRD | What we did | Proof |
|---|---|---|
| One winner call at the end, 99.9% daily harm check, lead as the unit | Already ours; now the default | A vs A, 12,000 runs: 2.5% wrongly promoted, 2.2% logged as a loss (the BRD's "about 5%" is these two together), 0.22% stopped early by mistake over the week (0.07% per daily check) |
| Router: shuffled blocks of 10 inside each Hot Lead type x Nature of Business group | **Built** (new router; small groups merge into "Other") | Share error 0.05 pp at 7,000 leads against 0.39 pp for a plain coin flip; A and B mix of lead type differs by about 0.4 pp against 1.5 pp (recomputed after the 8-factor catalog of the New Experiment overhaul: 85 groups, so blocks fill less well than with 16); 0 leads saw both prompts |
| Variable catalog, segment builder, plain-English audience, "out of segment" leads not counted | **Built**; first a rule-based reader, replaced in Prompt 6 by a list-based builder that shows the rule in plain words; in-call variables are refused | Tests; the segment demo counts only matching leads (3,150 of 3,150 re-checked) |
| Split health: chi-square, leads that saw both, balance table by lead type, firm type and city, segment check | **Built** on the Live page and in the final report | Browser test |
| Goal cards (one primary, up to 3 guardrails, x to delete, + Add metric) | **Built** (two guardrail kinds are computable on simulated traffic: call length and early hang-ups) | Browser test |
| Duration 7 to 28 days in whole weeks, a sticky calculator with a green / amber / red light | **Built** | The wizard refuses other lengths; test |
| Pre-launch checklist (5 items), Save Test (draft) and Launch Test (locked), start date | **Built** | Browser test: an overlapping launch is refused |
| Overview: tiles, business impact, live prompt, needs attention, running cards, traffic map, scorecard, top suggestion | **Built** | Browser test |
| 5% of traffic stays on A for 7 days after a promotion | **Built**, with an honest note: at 1,000 leads a day that slice can only rule out a drop of about 11 points or more | Unit test, including a decaying B that raises an alert |
| Decision table row "B significantly worse at the end: keep A, logged as a loss" | **Built** (we had called this "inconclusive") | Unit test |
| Data model in SQLite | **Built as an export**: `python -m canary export-db` | 15 tests; the re-run must reproduce each record exactly |
| Streamlit, an LLM agent for segments, goal suggestions and write-ups | **Not adopted**: our stack needs no installation and runs offline; the same jobs are done by rules and templates, which do not spend credits or invent numbers | stated in the README |

**Three of its numbers we corrected, with facts:** (1) "false winner about 5%" is the total in both directions; only 2.5% would ship. (2) "Daily harm check starts after 1,000 leads per variant": at a 10% share and 1,000 leads a day B reaches 1,000 leads on day 10, so the check would never run in a 7-day test; the calculator now shows the start day and turns amber. (3) Its data assumes lead type, firm type and city exist; our recordings carry none, so those variables are synthetic and labelled.

**Add-ons we made beyond the BRD:** run 1,000 A vs A tests in the browser with one click; the end-of-test loss is separated from an early harm stop; a calculator that works both ways (days needed, and the smallest lift a window can detect) and warns when the daily harm check cannot start; a SQLite export; one slide rewritten to the BRD.

## Prompt 6 - "New Experiment page overhaul" (the master prompt)
**Verdict: built as specified on branch `feature/new-experiment-overhaul`, verified by tests; an independent QA pass found 4 major and 13 minor issues, all fixed or disclosed; full evidence in `EVIDENCE_NEW_EXPERIMENT.md`.**

| Asked | Done | Proof |
|---|---|---|
| Prompt B as one full prompt, diff, variable check, Save keeps B as typed | Built; the patch mode and its badges are gone | browser E2E, zero "patch" words on every screen |
| Audience as a builder over 8 factors, rule in plain words, live leads a day and today's rate | Built; the rule is saved as JSON and shown with "100% of counted leads matched this rule" | E2E; numbers equal plain SQL |
| Goals: primary, guardrails, secondary; custom rate or average metrics; caps 3 and 5 | Built, end to end through the engine | 36 engine tests; a live launch with a custom rate and a custom average |
| Duration recommended from data by one formula, shared with At a glance | Built | 47 unit checks incl. the hand-computed example |

**What we must say plainly:** there is no real lead table yet, so the 30-day history the page reads is a labelled placeholder (call lengths are real); the spec's own worked example (2,100 leads, 14 days) does not follow from its formula (862 leads, 7 days) and we follow the formula; the new 85-group split balances lead mix less well than the old 16 groups (about 0.4 pp vs 0.1 pp at 7,000 leads, still far better than random at 1.5 pp).

## Prompt 7 - "Do the DB integration for the history" (10 Oct)
**Verdict: built on branch `feature/history-db` (not committed, not pushed). The local live server now saves every test in one SQLite file, `data/history.db`; two browsers see the same history and it survives a restart.**

| Asked | Done | Proof |
|---|---|---|
| A database for the history of tests | `canary/store.py`: tests, locked setup, daily results, hash-chained decision record, every click, drafts and settings | 20 new tests (`tests/test_store.py`) |
| Pick the best option; Postgres if it can be used | SQLite: built into Python, one file, nothing to run; Postgres is not installed here, needs a server and a driver, and the hosted copy cannot reach any server | README "Where the test history is kept" |
| Works in the app | Console loads from it on start and saves each change; Settings shows counts and a Download button; `python -m canary history` prints it | browser test: 14 of 14 (two browsers, a restart, a reset) |

**Second check (asked: "is it tested properly?"):** a self-review found 3 real bugs, all fixed with tests: (1) the public ngrok tunnel could read, overwrite or reset the history: the database now answers this computer only (checked through the real tunnel: 403); (2) a stale browser could undo a newer approval: saves now carry a version and a stale one is refused; (3) one old broken test in a browser blocked every save: it is now skipped on its own. An independent reviewer then found 2 major and 6 minor issues (a browser closed during a reset broke on reopening; a browser from before the database could lose its progress; two timing races; a large cache warning; other local web pages could send a reset; odd pasted characters; a deleted file not refilled). All fixed, each with a test, and the reviewer's own reproductions now pass. Two more review passes found smaller, rarer cases (changes made while the server was out of reach, a first save cut off, two tabs of one browser, a rejected test after a reload); all fixed and re-checked with the reviewer's scripts. Hosted copy built and run locally: unchanged.

**Rename (10 Oct):** the product is now **Picky - Test it, pick it, ship it** on every screen, page title, the password page, the slide, the QA report and the docs. The code package keeps its internal name `canary` (the commands stay `python -m canary ...`) so nothing breaks before submission.

**Say plainly:** the hosted copy (GitHub Pages) has no server, so it still keeps state in each browser; the database holds simulated tests only; on the live server "Reset the demo" now clears the database for every browser (the click log keeps a "reset" entry).
