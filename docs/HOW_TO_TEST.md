# How to test Picky

Three ways to test it, from quickest to most complete. Each takes a few minutes.

## Start it

| How | Command | What you get |
|---|---|---|
| No install | Double-click `dist/canary_demo.html` | Every screen works offline. Launching a new test replays the closest pre-computed run. |
| Full | `./start.sh` → http://127.0.0.1:8765 | The engine runs your exact setup, files can be imported, and history is saved in `data/history.db`. |
| With voice | `./live.sh` → http://127.0.0.1:8790 | Everything in Full, plus **Live call test** in the menu. |

## 1. The one-minute demo (no files, no voice)

1. **Overview** → press **▶ Play**. Six demo tests run day by day until each one is settled:
   - *Ask for any single detail at most twice*: B wins and is **promoted**. 5% of callers stay on A for a week as a check.
   - *Make the ask limits agree*: B is worse and is **stopped early**, on day 4.
   - *Warmer opening line*: **no clear winner**, so A stays.
   - *Proprietors only*: B wins **for that segment only**.
   - *WhatsApp details earlier*: B wins but calls run 12% longer, so it **waits for a yes**. Nobody answers, so after 2 days the **autopilot keeps A**.
   - *Promise details right after the call*: B wins, then slips after rollout. The **autopilot rolls it back**.
2. Open **Live Experiments** and pick any test. You get the verdict, a day-by-day strip (green means no harm that day) and the chart. Press **Verify record**: it should show "Chain intact".
3. Open the **Decision Log**: every action is listed with its reason, including "Picky autopilot".
4. Optional: **Settings** → **Reset the demo** first (a reset also restores the switches). Then, in **Settings** → Autopilot, switch off "Roll back by itself" and press Play again on Overview. The slipping win now shows up under **Needs attention** for a person instead.

## 2. Test with a results file (the "doc" way)

1. Run `./start.sh`, then **Overview** → **Import results**.
2. Choose a file: CSV, TSV or JSON, with one row per call. Columns: `lead_id`, `variant` (A or B), `disposition`, `timestamp`, `duration_s`. For a quick try, use one of the ready files in `data/samples/` (for example `results_b_wins.csv`), or pick a sample from the list on the screen.
3. Tick which outcomes count as success. BuyLead-like outcomes are ticked for you.
4. Fill in the plan: today's success rate, B's share of traffic and the test length. In a real test, write these down before the test starts.
5. Press **Decide**. The final report shows the verdict, the numbers with their ranges and the safety checks.

## 3. Test with voice (the "voice" way)

**Needed from Sarvam, once:**
- A **Voice Agents API key**. Create it at indus.sarvam.ai → Settings → API Key, and add a line `SARVAM_VOICE_API_KEY=...` to `.env`. The `SARVAM_API_KEY` already in `.env` is the model key: it works for speech-to-text, the chat model and grading, but **not** for voice calls.
- **One agent with two committed versions**: version 1 = prompt A, version 2 = prompt B.

**Steps:**
1. Run `./live.sh` and open **Live call test**.
2. **Step 1:** pick the patch, then press **Download prompt A** and **Download prompt B**.
3. On indus.sarvam.ai → Build → Agents → Create from Scratch:
   - paste prompt A into Instructions and **commit** (this is version 1);
   - paste prompt B and **commit** again (version 2);
   - use the same voice, Hindi and the same greeting for both.
4. **Step 2:** enter the organisation id, workspace id, agent id, and versions 1 and 2. Press **Check connection**; it places no call.
5. **Step 3:** choose the number of calls per prompt (5 for a quick demo, 10 is better). Keep **Blind** on. Press **Lock**.
6. Press **Start next call** and play the buyer, using the story shown on screen. Press **End**, then **Yes / No**, and tick **fatal** if something fatal happened. Repeat.
7. After the last call the result appears by itself: the winner or "no clear winner", which line was which prompt, the guardrails, and every transcript.
8. Optional: press **Grade calls with Sarvam** (about ₹0.25 per call, capped at ₹10). It shows how often Sarvam's tag agrees with your signals.

**No Voice key yet?** On Step 6, choose "Talk somewhere else, log it here". Talk to the agents in Sarvam's own test panel and log each call on this page. The result works the same way.

**Cost:** voice agents cost ₹3.50 a minute (Sarvam's published price). Ten calls of about 1.5 minutes come to about ₹53, and grading them about ₹2.5. Nothing is spent until you press a call or grade button.

## Automated checks (for the team)

```bash
python -m unittest discover -s tests -q                      # 300 Python tests (5 more with: pip install statsmodels pandas; pip install --no-deps gbstats)
node tests/browser/autopilot_journey.mjs "file://$PWD/dist/canary_demo.html"   # 33 checks: Play, autopilot, record, wizard, phone width
PY=python node tests/browser/live_flow.mjs                    # the voice screen against a mock Sarvam (no key, no credits)
```
