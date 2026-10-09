# New Experiment overhaul: evidence report

Branch `feature/new-experiment-overhaul`, baseline commit `3bbe597` (main). Commits: `4f40d8f` (catalog, history, metric catalog), `5fd5bbd` (the page), `b843d4f` (engine, wizard endpoint, docs), `88d03d2` (evidence), then the fixes from the independent QA pass. Nothing pushed.

## How to re-run every check
| What | Command | Result |
|---|---|---|
| Python unit and integration tests (engine, server, validators, SQL check, QA regressions) | `python -m unittest discover -s tests` | Ran 215 tests - OK |
| Pure functions of the page, in node (duration, reverse lift, validators, variables, diff, segments, caps, JS vs SQL) | `python -m unittest tests.test_plan_units` (runs `tests/browser/plan_units.cjs`) | 52 checks, 0 failed |
| Build | `python -m canary build` | `dist/canary_demo.html` written, `node --check web/console.js` clean |
| Browser E2E of every step (offline file) | `node tests/browser/new_experiment_e2e.mjs file://$PWD/dist/canary_demo.html <shots>` | 71 passed, 0 failed, 0 page errors |
| Same, launching through the live engine | `node tests/browser/new_experiment_e2e.mjs http://127.0.0.1:8765/ <shots> live` | 73 passed, 0 failed, 0 page errors |
| The QA pass's UI findings, kept fixed | `node tests/browser/qa_fixes.mjs <url> [live]` | 11 passed offline, 12 live |
| Downstream: custom rate and custom average through the live engine | `node tests/browser/new_experiment_live.mjs http://127.0.0.1:8765/ <shots>` | 17 passed, 0 failed |
| Visible text of every screen and step: no "patch", "lint-derived", banner text | `node tests/browser/visible_words.mjs file://$PWD/dist/canary_demo.html` | zero hits |
| Older browser suites, moved to the new page | `console_brd.mjs`, `console_flow.mjs`, `console_fixes.mjs`, `console_mobile.mjs` | all checks passed; no page errors; no horizontal overflow at 390 px |
| QA report | `python -m canary qa` | `QA_REPORT.md` regenerated |

There is no linter or type-checker in this project (plain JS and Python, no build toolchain); `node --check` (syntax) and the test suites stand in for them.

## Requirements, one by one
Status: PASS (verified, proof linked), PARTIAL (met with a stated limit), N-A. Screenshots are in `docs/evidence/new-experiment/` (`steps/`, `live/`, `scope/`).

### Global rules
| # | Requirement | Status | Proof |
|---|---|---|---|
| G1 | Every number from state and data by one pure function, no hard-coded values | PASS | `durationPlan`, `metricEval`, `audienceVolume`, `baselineFor` in `web/console/05-plan.js`; previews equal plain SQL (plan_units "SQL check" x 8; `test_metrics_overhaul.SqlCheck` x 5) |
| G2 | At a glance reads the same function as Step 5 | PASS | `glance()` and Step 5 both call `wzPlan()` -> `durationPlan`; E2E "At a glance equals Step 5", "Custom length: At a glance shows the same days and smallest improvement" |
| G3 | Table rule: months across, dimensions down | N-A | No table on these screens has a time-by-dimension layout; rule recorded in `CLAUDE.md` |
| G4 | Setup locked at launch (segment, prompt B, metrics, limits) | PASS | `new_experiment_live.mjs` "config: locked at launch ... metrics are inside the locked config"; `test_a_changed_limit_changes_the_hash`; `test_the_live_prompt_a` (prompt A in the hash) |
| G5 | No free-text code; only data columns | PASS | builder and metric form are lists only; `metricCheck`/`metriclib.validate` refuse unknown columns (plan_units "invalid column", `test_only_columns_from_the_data`) |

### Step 2: Prompt B
| # | Requirement | Status | Proof |
|---|---|---|---|
| 2.1 | Toggle, patch cards, "Write my own patch", badges, patch state removed | PASS | E2E "no patch toggle, no patch cards, no patch/lint wording"; `grep -ril patch web/console` = 0 files; `steps/02_step2_same.jpg` |
| 2.2 | Title and helper text | PASS | E2E "Step 2 title", "Step 2 helper text" |
| 2.3 | Collapsed read-only "View current prompt (A)" with its version | PASS | E2E "collapsed by default and read-only when opened", "prompt A shows its version" |
| 2.4 | One large textarea: pre-filled with A, >= 20 rows, monospace, resizable, character count, Reset | PASS | E2E "one large monospace resizable textarea, pre-filled with prompt A", "character count"; Reset button `#w-reset` |
| 2.5 | Side-by-side diff, green added / red removed; identical message | PASS | E2E "identical prompts say so", "side-by-side diff (green added, red removed)"; plan_units diff x 6 (Myers diff: a middle edit plus an end line = 2 added, 1 removed) |
| 2.6 | Variable check: all kept / missing (amber, blocks) / new (amber, blocks) | PASS | E2E "missing and new variables are amber and block Next"; plan_units "variables" x 4; server refuses too (`test_template_variables_must_match_prompt_a`). Note: the real prompt A has no `{{ }}` tags; its 22 variables sit inside `{% %}` tags, so the check scans both (it finds the same 22 names as the engine's Jinja parser) |
| 2.7 | "Need ideas? See Suggest A/B Tests" opens a new view; no cards here | PASS | E2E check of the link (`target=_blank`) and no `[data-create]` on the page |
| 2.8 | Next only when B differs and variables pass | PASS | E2E "Next is disabled while B = A", "fixed prompt enables Next again" |
| 2.9 | Save Test saves B as typed even when checks fail | PASS | E2E "Save Test saves B as typed even when the checks fail" |
| 2.10 | At a glance hidden until Step 3 is filled | PASS | E2E "At a glance: hidden until the audience is set", "shows estimates once the audience is set" |
| 2.11 | Suggest "Create experiment" pre-fills the full prompt B | PASS | E2E "Suggest: pre-fills the full prompt B (A with the suggestion applied)"; plan_units: the browser-built B equals the engine's candidate text byte for byte; `steps/17_suggest_prefill.jpg` |
| 2.12 | Review, History reports, Prompt Library show full prompt B and the diff; no patch wording | PASS | E2E "Review: prompt B diff shown"; live check "Report: ... prompt B with its diff", "Prompt Library: full prompt and diff"; `visible_words.mjs` zero hits |

### Step 3: Audience
| # | Requirement | Status | Proof |
|---|---|---|---|
| 3.1 | Factor catalog as one config (name, column, values), the spec's 8 factors | PASS | `canary/catalog.py`; Settings > Variable catalog |
| 3.2 | Factor not in the data: disabled, "Not in data yet" | PASS (mechanism) | `in_data` from the data's columns; option disabled with that title. All 8 columns exist in the 30-day history, so none is disabled today |
| 3.3 | + Add condition; values multi-select with checkboxes, Select all, search; x remove | PASS | E2E "values multi-select has Select all and a search box", "the search box filters values", "x removes a condition" |
| 3.4 | A factor only once | PASS | E2E "used factors are disabled"; plan_units "a factor can be used only once" |
| 3.5 | AND between rows, OR within; no rows = "All traffic (neutral test)" | PASS | plan_units "matched leads equal a hand count", "no rows = all traffic"; E2E |
| 3.6 | Rule in plain words | PASS | plan_units: the spec's exact example sentence; E2E |
| 3.7 | Live "~ N leads/day · today's rate X% (last 30 days)" | PASS | E2E "live leads/day and today's rate update with the audience"; numbers equal SQL (plan_units "connected leads a day", "BuyLead created rate ... segment") |
| 3.8 | Saved as JSON [{factor, column, values}] | PASS | live check "the segment is saved as [{factor, column, values}]" |
| 3.9 | Shown on Review, Live, History and the report with "100% of counted leads matched this rule" | PASS | E2E Review; live check Live and Report (computed from the engine's re-check of every counted lead, not a fixed string) |

### Step 4: Goals
| # | Requirement | Status | Proof |
|---|---|---|---|
| 4.1 | Three sections in order with helper lines | PASS | E2E "three sections in order" |
| 4.2 | Suggestion banner and its code removed | PASS | E2E; `suggestGoals`, `w-sugg` = 0 hits |
| 4.3 | Defaults: empty primary with placeholder; pre-added call-duration guardrail +10%, removable | PASS | E2E "primary goal starts empty", "one pre-added guardrail" |
| 4.4 | Custom metric form: name, type, numerator/denominator (calls/leads, is/is not/is one of, <= 3), average, direction, live preview, validation, Save metric -> Settings > Metrics | PASS | E2E "custom metric live preview", "Save metric sets the custom metric as the primary goal", "saved to Settings > Metrics", "an Average custom metric previews in seconds"; plan_units validators x 6 |
| 4.5 | + Add metric panel: Add as, tabs, grouped searchable list with formula and today's value, "Already added" | PASS | E2E "Panel: ..." x 6 |
| 4.6 | Custom tab with "Save to metric list" ticked by default | PASS | E2E |
| 4.7 | Guardrail = direction + required limit (% relative / points); Secondary = direction only | PASS | E2E (limit 2 points, 8%); for an average, "points" reads in its own unit (seconds) |
| 4.8 | Cards: name, role, arrow, limit, formula, value, x; click to edit; menu Move | PASS | E2E "Edit: ...", "Move: guardrail -> secondary", "Remove" |
| 4.9 | Caps 3 and 5, disabled with the tooltip | PASS | E2E "guardrail role disabled at 3, with the tooltip"; plan_units caps |

### Step 5: Duration
| # | Requirement | Status | Proof |
|---|---|---|---|
| 5.1 | Recalculates on segment, B share, goal, lift | PASS | E2E x 4 ("recalculates after ...") |
| 5.2 | Recommended (default) / Custom length; plain-English card; improvement presets | PASS | E2E "Recommended: N days", "the plain-English card", "changing the improvement recalculates" |
| 5.3 | Advanced (collapsed): 95%, 500 leads per arm before any decision, read-only baseline | PASS | E2E "Advanced settings collapsed". The engine applies the 500-lead gate to every decision on this path (`test_the_minimum_leads_gate_blocks_the_final_call`) |
| 5.4 | Custom length fields, live reverse line, amber when shorter | PASS | E2E "Custom length: ..." x 3 |
| 5.5 | Formulas: n_B, days, whole weeks, min 7, > 28 message, reverse, average SD, < 200 fallback | PASS | plan_units "duration: ..." x 8, "reverse", "fewer than 200 leads" |
| 5.6 | At a glance shows the same numbers | PASS | E2E x 2 |

### Engine and reports
| # | Requirement | Status | Proof |
|---|---|---|---|
| E1 | Custom rate -> proportion test, average -> mean comparison | PASS | `test_a_custom_rate_primary_promotes`, `test_an_average_primary_promotes`; live check (both) |
| E2 | Guardrails: daily 99.9% harm check; end of test passes only if the top of the 95% range is within the limit | PASS | `test_a_guardrail_breach_stops_b`, `test_a_guardrail_not_proven_holds_b`; live check test 2 was held because shorter calls raised early hang-ups past the 2-point limit |
| E3 | Secondary on Live and the report, "for insight only", never decides | PASS | `test_secondary_metrics_are_reported_and_never_decide`; live check |
| E4 | All metric definitions in the config, locked | PASS | live check; `test_the_metric_list_is_locked_into_the_config` |
| E5 | False wins stay near 2.5% on the new path | PASS | `test_a_vs_a_rarely_promotes`; 1,000-run A/A per primary: 2.1 to 3.3% (engine agent's calibration run) |

### Step 6: Review
| # | Requirement | Status | Proof |
|---|---|---|---|
| 6.1 | Prompt B and diff, segment with the 100% line, metrics with formula and limit, duration, no patch wording | PASS | E2E "Review: ..." x 4; `steps/14_step6_review.jpg` |

## Data checks
| Check | Status | Proof |
|---|---|---|
| Each factor's column exists in the data | PASS for the 30-day history; N-A for real data | All 8 factor columns are in `history.COLUMNS`. **No real lead table was provided and the data connectors (ClickHouse, Call Insights) are not authorised in this session**, so the history is a labelled synthetic placeholder (`canary/history.py`): factors use the catalog's placeholder mix, call lengths are resampled from the 713 real recordings, connect rate and disposition mix are placeholders |
| Preview numbers equal an independent SQL query | PASS | `history.to_sqlite()` then plain SQL: 8 JS checks (`plan_units.cjs`) and 5 Python checks (`SqlCheck`) match exactly |

## Scope proof
`git diff --stat 3bbe597`: 48 files. Page code: `web/console/*.js`, `web/console.css`, the generated `web/console.js`; data and engine: `canary/catalog.py`, `history.py` (new), `metriclib.py` (new), `engine.py`, `simulator.py`, `server.py`, `variants.py`, `console.py`, plus small fallout in `export_db.py`, `proof.py`, `report.py`; tests; build artefacts (`dist/`, `out/`); docs that described the removed features.

Before/after: screenshots of every screen (`docs/evidence/new-experiment/scope/before|after`) and the visible text of every screen diffed line by line (`docs/evidence/new-experiment/text/*.diff`, baseline build of `3bbe597` against this branch):
| Screen | Changed lines | What changed, and why |
|---|---|---|
| Import results | 0 | untouched |
| History | 12 | the segment filter reads the rule in words ("All traffic (neutral test)", "Leads where Legal Status is Proprietorship"); two re-run rows show different numbers (same decisions) because leads are dealt into the new catalog's groups |
| Suggest A/B Tests | 12 | "Proposed patch" -> "Proposed change" six times (the no-"patch" rule) |
| Prompt Library | 5 | origin badges ("lint-derived", "human") removed; "Show the full prompt" added (spec) |
| Decision Log | 10 | the demo tests' audience text in words; the segment test's config hash (its segment is now Legal Status = Proprietorship) |
| Overview | 35 | the five demo tests' day-2 numbers; because of them the day-2 "Watch: B looks worse" alert for the B-worse test no longer shows (it still stops on day 4) |
| Live (3 demo tests) | about 100 each | the balance table lists the new catalog's four balance factors; the audience line in words with the matched-leads sentence; the demo numbers |
| Final report (2 simulated past tests) | about 130 each | new Metrics and Prompt B sections (spec); the audience line; the re-run numbers |
| Final report (results file) | 7 | the Metrics section and "The prompts are not part of a results file" |
| Settings | 74 | the metric list with formulas and today's values (spec); the 8-factor catalog; "before any decision" label |
| New Experiment | all | the spec's subject |

Why the demo numbers moved: the five demo tests and the ten simulated History re-runs deal leads with the stratified router, whose groups come from the factor catalog (85 HL Type x GST NOB groups now, 16 before), so each run is a different random draw. The demo tests keep their outcomes and days (win promoted day 7, worse stopped day 4, flat inconclusive, segment promoted, longer calls held). Two History re-runs had flipped (*The fix does almost nothing* promoted; *More leads, calls much longer* inconclusive); their seeds were re-picked (`console.HISTORY_SEEDS`, the first seed counting up that shows the titled outcome, disclosed in the code) so History again matches its titles and the proof lab's scenario table.

Leftover strings: `patch`, `lint-derived`, `Suggested from your hypothesis`, `Use the suggestion` have **zero hits in the dashboard source** (`web/console/`) and **zero hits in the visible text of every screen and every wizard step** (`visible_words.mjs`). "patch" still appears in backend Python (`variants.apply_patch`, the fix loop) and its data, which this page spec does not cover.

## Independent QA pass: findings and what was done
A separate agent, given the spec and the code but not the builder's conclusions, tried to break the work. Its findings and their status:
| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Major | A metric picked from the "+ Add metric" list always got "lower is better"; the server ignored the page's direction for built-ins | Fixed (the pick no longer re-reads the old select; the server honours the sent direction). E2E + `QaFixes.test_a_built_in_metric_keeps_the_direction_the_page_sends` |
| 2 | Major | The new catalog changed other screens; two History decisions flipped; the evidence called History "identical" | Fixed for the flips (seeds re-picked, disclosed); the remaining changes are listed in the scope table above; `QaFixes.test_history_shows_each_scenario_as_titled` |
| 3 | Major | The injected effect also lowers other dispositions in B | Disclosed (a call ends in one outcome, so they shrink in proportion): simulator docstring and the Step 6 simulator note |
| 4 | Major | Custom length froze leads a day and the improvement | Fixed: data values follow the audience and primary unless the person edits them; a rate's points are never reread as seconds. `qa_fixes.mjs` |
| 5 | Minor | "null points" for an inconclusive average | Fixed (`liftWords`), unit-tested |
| 6 | Minor | Live and report said attempted leads a day, the page connected leads | Fixed: tests from the page show connected leads a day, equal to Step 3 (`qa_fixes.mjs live`) |
| 7 | Minor | A custom metric that duplicates a built-in passed the page's check | Fixed (`metricBody` comparison), unit-tested and in the E2E |
| 8 | Minor | Two names could make the same key and silently replace a metric | Fixed, unit-tested |
| 9 | Minor | Saves silently stopped after about 30 drafts (each held a 170 KB prompt) | Fixed: a prompt is stored once by reference; a full storage is reported |
| 10 | Minor | B's share was changed after Step 4 without saying why; a clone lost its share | Fixed: the reason is shown; clones keep their share |
| 11 | Minor | The "< 200 leads" fallback cannot be reached by a launchable audience | Disclosed: with this history the 2% minimum share already means about 600 connected leads; the note shows in Step 3's preview for smaller (refused) audiences and the function is unit-tested |
| 12 | Minor | Deleted primary shown as another; a guardrail's limit lost on a round-trip move; HL Bucket overlap; CSVs in points for averages | Fixed; `qa_fixes.mjs` |
| 13 | Minor | Settings showed "any number" for dispositions and a raw column name; silent input clamps; the sequential rule's extra data; the offline replay banner | Fixed. Built-in goals now count over connected leads (an explicit definition; the old engine's "analysed leads" were all connected) |
| 14 | Nit | `{{ }}` inside `{# #}` comments; "rise" wording; "matched"; sign of the smallest change for lower-is-better | Fixed |
| 15 | Docs | Three docs still described the removed reader; a premature "QA passed" line | Fixed |
| 16 | Outside the code | An ngrok process publicly tunnels port 8765 (started before this work) | Reported to the user; not stopped without their decision |

## Known gaps, assumptions, side effects
1. **Synthetic 30-day history** (see Data checks). Replacing `history.leads()` with a reader of the real table is the only change needed.
2. **The spec's worked example is inconsistent with its own formula**: 2,140 leads a day, 45%, 10% to B, +5 points gives n_B = 862 and 7 days, not 2,100 and 14 days. The page follows the formula; the unit test asserts the formula.
3. **Reference metric before a primary is chosen**: Step 3's line and At a glance use BuyLead created (the app's default goal, 45%) until a primary is chosen, and say so. The spec's example names Meeting Fixed.
4. **"Points" for an average** reads in the metric's own unit (seconds); a rate's points are percentage points.
5. **Engine vs plan**: the wizard follows the spec's simplified formula; the engine plans with B's own variance. The Live Progress card uses the same `durationPlan`, so both screens agree.
6. **The plain-English audience reader is removed** (the spec replaces the inputs with the builder).
7. **New catalog side effects**: see the scope table. The split proof was recomputed: the mix gap on the blocked factors is about 0.4 pp (plain random about 1.5 pp) at 7,000 leads; at 1,000 leads most of the 85 groups merge into "Other" and blocks gain little.
8. **Offline file**: launching replays a pre-computed run (as before) and does not apply the chosen audience, prompt B or metrics; the banner says so. The live version (`./start.sh`, or the hosted copy) runs the engine.

## Claude Code features
| Feature | Used? | How |
|---|---|---|
| /init (CLAUDE.md) | Equivalent | `CLAUDE.md` written by hand with the scope rule, table rule and single sources of truth (slash commands are typed by the user, not callable by the agent) |
| Plan mode | Skipped | a short plan was given in chat instead, to keep moving |
| Task list (Ctrl+T) | Skipped | no task-list tool in this session; this report is the checklist |
| /rewind, git checkpoints | Used | one commit per logical change on the work branch |
| /simplify | Equivalent | dead code removed by hand; a script listed every helper removed and confirmed none is still called |
| /debug | Not needed | failures were debugged directly (headless browser scripts) |
| /review | Equivalent | an independent QA agent reviewed the work against the spec (findings above) |
| Hooks | Skipped | none configured; settings were not changed |
| Subagents | Used | one agent built the engine path from a written contract; a separate agent did the QA |
