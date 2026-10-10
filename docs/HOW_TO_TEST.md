# How to test Picky

Online, with nothing to install: https://yash0405.github.io/IM-Voice-AI-2.0-Hackathon/ (open to everyone; the first load takes about a minute). Or run it on your computer:

## Start it

| How | Command | What you get |
|---|---|---|
| No install | Double-click `dist/canary_demo.html` | Every screen works offline. Launching a new test replays the closest pre-computed run. |
| Full | `./start.sh` → http://127.0.0.1:8765 | The engine runs your exact setup, files can be imported, and history is saved in `data/history.db`. |
| Team server | `./live.sh` → http://127.0.0.1:8790 | The same app as Full, on port 8790. |

## 1. The one-minute demo (no files, no voice)

1. **Overview** → press **▶ Play**. Six demo tests run day by day until each one is settled:
   - *Ask for any single detail at most twice*: B wins and is **promoted**. 5% of callers stay on A for a week as a check.
   - *Make the ask limits agree*: B is worse and is **stopped early**, on day 4.
   - *Warmer opening line*: **no clear winner**, so A stays.
   - *Proprietors only*: B wins **for that segment only**.
   - *WhatsApp details earlier*: B wins but calls run 12% longer, so it **waits for a yes**. Nobody answers, so after 2 days the **autopilot keeps A**.
   - *Promise details right after the call*: B wins, then slips after rollout. The **autopilot rolls it back**.
2. Open **All experiments** (running, draft and finished tests in one list; filter by status, date, metric, audience or source) and click any row. You get the verdict, a day-by-day strip (green means no harm that day) and the chart. Press **Verify record**: it should show "Chain intact".
3. Open the **Decision Log**: every action is listed with its reason, including "Picky autopilot".
4. Optional: **Settings** → **Reset the demo** first (a reset also restores the switches). Then, in **Settings** → Autopilot, switch off "Roll back by itself" and press Play again on Overview. The slipping win now shows up under **Needs attention** for a person instead.

## 2. Test with a results file (the "doc" way)

1. Run `./start.sh`, then **Overview** → **Import results**.
2. Choose a file: CSV, TSV or JSON, with one row per call. Columns: `lead_id`, `variant` (A or B), `disposition`, `timestamp`, `duration_s`. For a quick try, use one of the ready files in `data/samples/` (for example `results_b_wins.csv`), or pick a sample from the list on the screen.
3. Tick which outcomes count as success. BuyLead-like outcomes are ticked for you.
4. Fill in the plan: today's success rate, B's share of traffic and the test length. In a real test, write these down before the test starts.
5. Press **Decide**. The final report shows the verdict, the numbers with their ranges and the safety checks.

## Automated checks (for the team)

```bash
python -m unittest discover -s tests -q                      # 331 Python tests (5 more with: pip install statsmodels pandas; pip install --no-deps gbstats)
node tests/browser/autopilot_journey.mjs "file://$PWD/dist/canary_demo.html"   # 34 checks: Play, autopilot, record, wizard, phone width
```
