# Working rules for this repo

## Scope rule (New Experiment overhaul, branch `feature/new-experiment-overhaul`)
- Change only what the New Experiment spec lists: Step 2 (full prompt B only), Step 3 (segment builder), Step 4 (goals, guardrails, secondary metrics, custom metrics), Step 5 (duration), Step 6 (review), and the places the spec names downstream (Live page, History and the final report, Prompt Library, Suggest A/B Tests "Create experiment", Settings > Metrics).
- Nothing else on any page or step changes. Prove it with `git diff --stat 3bbe597` (the baseline commit) and before/after screenshots.
- The setup is locked at launch: segment, prompt B, metrics and limits are part of the locked config (its hash).
- No free-text code anywhere: only columns from the data can be picked.

## Table formatting rule (reports and UI tables)
- Months on the horizontal axis (column heads); dimensions such as vertical, RD, vintage on the vertical axis (rows).

## Single source of truth
- Factor catalog: `picky/catalog.py` (display name, data column, allowed values). The router, segment builder, balance check and the dashboard all read it (the dashboard through the bundle).
- Metric catalog: `picky/metriclib.py` (built-in metric definitions); custom metrics are saved in Settings > Metrics and use the same definition format.
- Duration and stat function: `durationPlan` in `web/console/05-plan.js`. Step 5 and the "At a glance" panel both call it. No hard-coded numbers: every number shown comes from state and data.
- Test history (launched tests, their state, every click, the decision record): `picky/store.py`, one SQLite file `data/history.db` written by the live server. The browser's localStorage is only a cache there; the hosted copy and the offline file keep state in the browser.
- The 30-day history the previews use: `picky/history.py` (a labelled synthetic placeholder: no real lead table was provided). Replace it with the real table and nothing else changes.

## House rules
- Never spend Sarvam credits; never read call audio or transcript content; customer data stays on this machine.
- Do not push. Commit only on the work branch. Do not tunnel the local server.
- Tests: `python -m unittest discover -s tests -q` (no pytest). Node unit tests: `node tests/browser/plan_units.cjs`.
- Rebuild after UI edits: `python -m picky build` (assembles `web/console.js` from `web/console/*.js` and writes `dist/`).
