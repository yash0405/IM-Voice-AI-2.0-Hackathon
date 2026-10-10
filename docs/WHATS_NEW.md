# What changed on `feature/declutter` (Oct 10)

The core is unchanged: a fair sticky split, a setup locked before launch, peeking-safe decisions, guardrails, holdback and a hash-chained record. The menu and the six-step New Experiment are also unchanged. What changed is how much each screen asks people to read, how often a person is needed, and the voice part.

## 1. Each screen: a visual first, details one click away

Same demo state, measured on the offline build (`docs/evidence/declutter/`, before = `main` 105245d):

| Screen | Before (words) | After (words) | What is up front now |
|---|---|---|---|
| Overview | 815 | 365 | Autopilot line, 4 tiles, running tests with A and B bars (grey until decided), live prompt and impact, scorecard bar, the A vs A proof as a chart |
| Live Experiments | 1,259 | 480 | Verdict line, a day strip (green = no harm that day), 4 tiles, chart, split health in 3 ticks |
| New Experiment, review step | 1,584 | 282 | Summary, the 6 checks as ticks, Launch. The diff and the demo settings are folded. |
| Final report | 1,778 | 296 | Decision, plain words, numbers, chart, safety checks |
| Settings | 970 | 338 | Autopilot switches and defaults; the metric list and variable catalog are folded |
| Suggest A/B Tests | 619 | 347 | Idea cards: title, one line of evidence, 3 chips, one button |

Nothing was deleted. Every spec element is still on its screen, behind a ▸ section or an ⓘ hover note.

## 2. Where a person is no longer needed

| Before | After |
|---|---|
| A held win (it broke a guardrail) waited for a person indefinitely | A person is still asked, but **if nobody answers in 2 days, the autopilot keeps A**, the safe choice |
| After a promotion, a person had to read the holdback table and roll back | **The autopilot rolls back by itself** on a holdback alert |
| The main goal had to be chosen before Next would work | It defaults to **BuyLead created**, and an idea brings its own goal |
| An idea had to be retyped into the wizard | **Ready ideas** on step 1 fill all six steps, prompt B included |
| Every test needed "Advance 1 day" clicked, one at a time | **Next day / ▶ Play** moves every test, holdback and answer window together. In real use the days pass on their own. |

Both autopilot actions are pre-chained by the engine into the tamper-evident record, exactly like a person's click, and they verify. The two switches are under **Settings → Autopilot**. For results files Picky only advises, so the autopilot never acts on them.

## 3. Voice: added only where the PS05 deck scores it

| Deck item | What it is | Status |
|---|---|---|
| Voice Experience (20% of the jury score); "Agent ID / live link on Sarvam" | **Live call test**: talk to prompt A and prompt B on Sarvam voice agents, give a signal after each call, with the call count fixed before call 1 | Built; works end to end against a mock of Sarvam. **Needs your Voice Agents key** (below). |
| "Accuracy of auto-disposition vs labelled calls" | **Grade calls with Sarvam**: after the result, Sarvam's model tags each call and the page shows how often it agrees with your signals | Built and unit-tested with a fake client. Uses the model key already in `.env`, about ₹0.25 per call, only when you press it. |
| "Test on simulated sellers built with Sarvam voice agents" | Sarvam **Tests**: a simulated buyer and an AI judge run the same scenario on version A and version B | Not built. **Needs the Voice Agents key**; recommended next. |
| Reading dashboards aloud, or a voice assistant for the console | — | Not added: it is not scored and it removes no work |

## 4. Standard tools instead of our own code

Chart.js (charts), jsdiff (the prompt diff) and the browser's Web Crypto (SHA-256 for the record check) replaced our hand-written versions. The full list and the reasons are in `docs/LEADERS_QA.md` §4.

## 5. Needed from you (Sarvam), marked here and nowhere else

| What | Where | Unlocks |
|---|---|---|
| `SARVAM_VOICE_API_KEY=...` in `.env` | indus.sarvam.ai → Settings → API Key. This is a different key from the `SARVAM_API_KEY` model key already there. | Live voice calls; later, Tests and real rollout |
| One agent with 2 committed versions (A = v1, B = v2), plus the org, workspace and agent ids | indus.sarvam.ai → Build → Agents (paste from the Download buttons) | Live voice calls; the submission's "Agent ID / live link" |
| Optional: a deployment id | Sarvam → Deploy | Real automatic rollout (the other session's adapter) |

Measured fit: the agent prompt (the inbound flow of the real prompt) is about 16,000–22,000 tokens, which fits within the 32K context of Sarvam's voice model.

## 6. Proof

Commands and counts at the time of writing:

| Check | Result |
|---|---|
| Python: `python -m unittest discover -s tests -q` | 304 tests pass. 5 statistics cross-checks are skipped without statsmodels and gbstats, and pass with them. |
| `tests/browser/autopilot_journey.mjs` | 33 / 33 offline and against the live engine |
| `new_experiment_e2e` / `new_experiment_live` / `console_brd` / `qa_fixes` / `store_e2e` / `live_flow` | 71/71, 17/17, all, 11/11, 31/31, all |

`console_flow`, `console_mobile`, `console_fixes` and `visible_words` also pass. Browser checks that read text now inside a fold or hover note open the fold, or read the note, before checking the same content.

## 7. Product feedback round (Oct 10, afternoon)

| Change | Where |
|---|---|
| **Live Experiments and History are one tab, All experiments** (`#/experiments`). One filter bar (search, status, date range, primary metric, audience, source), status chips with counts, sortable columns, 20 rows a page, CSV of the filtered list. Filters and sort are in the URL. Old links (`#/live`, `#/history`) redirect. A row opens the test's page with "← All experiments"; a finished test opens on its **Final report** (decision, numbers, plain words, Clone); a draft opens New Experiment with the draft loaded. | `web/console/35-experiments.js` |
| **One way to move time:** Next day (every running test), Play and Skip to the end. The per-test "Advance 1 day" buttons and the "Waiting for approval" tile are gone (approvals stay in Needs attention and the Decision Log). Next day says "Day advanced for 6 running tests." | Overview, All experiments |
| **Duration step** on an even 2-column grid: label, control, helper text; chips and explanation full width; stacks on narrow screens. | New Experiment step 5 |
| **Primary goal editable until launch:** ⋯ on the primary card (Edit, Change goal); a saved custom metric asks "Update the saved metric too, or only this test?"; every section of the review step has Edit. | New Experiment steps 4 and 6 |
| **Custom metrics from the real data files:** every CSV/XLSX in `Resources/` is scanned (types from the first 1,000 rows: number, category, date, ID, text); the Column picker lists them by file with a search box and type tags; operators follow the type; Rate, Average and Sum; the preview is measured on the file by the local server (aggregates only, the file stays on this machine); Rescan in Settings > Metric list. | `canary/filecatalog.py`, `web/console/45-filecols.js` |

Limits, stated plainly: a test's outcomes are still simulated, and the simulation knows only call duration and call status, so a file metric can be **launched** only when it uses `lead_call_duration` and `lead_call_status` (both PM examples do); other columns can be built, previewed and saved. A sum is reported only (it grows with traffic, so it cannot decide a test). Built-in metrics still run on the synthetic 30-day history. Columns from two files cannot be mixed in one metric yet.
