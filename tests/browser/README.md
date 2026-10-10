# Browser tests (optional)

They drive the real dashboard in headless Chrome. Chrome is expected at `/usr/bin/google-chrome`; install the driver once with `npm install puppeteer-core`.

```bash
node tests/browser/autopilot_journey.mjs "file://$PWD/dist/canary_demo.html"   # Play, autopilot, record, wizard, phone widths
node tests/browser/all_experiments.mjs  "file://$PWD/dist/canary_demo.html"   # All experiments list, filters, a test's page, drafts
node tests/browser/console_mobile.mjs   "file://$PWD/dist/canary_demo.html"   # phone widths
node tests/browser/new_experiment_e2e.mjs "file://$PWD/dist/canary_demo.html" /tmp/shots # the 6-step New Experiment wizard
node tests/browser/plan_units.cjs                                               # duration and metric maths (no browser)
node tests/browser/store_e2e.mjs "$(command -v python3)"                        # history database: two browsers, a restart, a reset (own server, port 8797)
python -m canary serve --port 8853 & node tests/browser/file_metrics.mjs http://127.0.0.1:8853/   # custom metrics from the data file's columns
```
The Python tests (`python -m unittest discover -s tests`) do not need any of this.
