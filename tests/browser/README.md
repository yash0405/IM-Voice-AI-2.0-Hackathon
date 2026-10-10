# Browser tests (optional)

They drive the real dashboard in headless Chrome: every screen, the spec's demo plan (advance each test day by day, approve a held one, roll back), the wizard, the file import and phone widths.

```bash
npm install puppeteer-core                     # once; Chrome is expected at /usr/bin/google-chrome
node tests/browser/console_flow.mjs  "file://$PWD/dist/canary_demo.html"     # offline page
node tests/browser/console_mobile.mjs "file://$PWD/dist/canary_demo.html"
./start.sh                                                                  # then, with the live server on port 8801: python -m canary serve --port 8801
node tests/browser/console_live.mjs                                          # new experiment, pasted prompt, file import
node tests/browser/store_e2e.mjs "$(command -v python3)"                       # history database: two browsers, a restart, a reset (starts its own server on port 8797, throw-away database)
```
Screenshots go to `/tmp/canary_shots`. The Python tests (`python -m unittest discover -s tests`) do not need any of this.

`live_flow.mjs` tests the "Live call test" screen inside the console (port chosen automatically) against `mock_sarvam.mjs`, a stand-in for Sarvam's voice runtime that follows the SDK source: `npm install puppeteer-core ws; PY=/path/to/python node tests/browser/live_flow.mjs`. Screenshots go to `$SHOTS` (default `/tmp/canary_live_shots`).
