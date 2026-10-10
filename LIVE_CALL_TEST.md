# Live call test: hear prompt A and prompt B, let your signals decide

It is **a screen of the Picky console** (menu entry "Live call test", right after Live Experiments) and runs on its own port (**8790**): the same console as the main one on 8765 (same menu, theme and screens), plus this feature. Branch: `feature/live-call-test`, which already contains everything from `main` up to the New Experiment overhaul.

**What it does, in plain words.** You talk to two real Sarvam voice agents: A (today's prompt) and B (today's prompt plus the patch). After each call you press one button: *good call* or *not good* (plus a tick if something fatal happened). Before the first call you fix **how many finished calls each prompt needs**. Until that number is reached the page shows no result at all, so nobody can stop early on a lucky streak. When the last call is signalled, the result appears by itself: winner, loser, or "no clear winner", with the numbers and the reasons.

## Run it

```bash
./live.sh                      # sets itself up, opens http://127.0.0.1:8790 (the whole console; click "Live call test")
# or: python -m canary live --port 8790
```

Put these in `.env` (the key never leaves your computer; the page never sees it):

```
SARVAM_VOICE_API_KEY=...       # indus.sarvam.ai > Settings > API Key   (NOT the dashboard.sarvam.ai model key)
```

The organisation id, workspace id and the two agent ids are typed into the page (step 2) and saved in `data/live/connection.json` (not committed). **Check connection** asks Sarvam for a call link for each agent without placing a call, so you know the key, ids and committed versions work before the demo.

## Set up the two agents on Sarvam (once, about 5 minutes)

The page (step 1) lets you download the exact prompt text for A and B. **Why this text:** it is the real inbound prompt, filled in for a demo call about stainless steel pipes (`product_name` and `bot_name` are replaced because a fresh agent has no such variables). Both prompts get the same fill-in, so only the patch differs.

| Route | Steps |
|---|---|
| Dashboard | indus.sarvam.ai > Build > Agents > Create from Scratch. Paste prompt A into *Instructions*, **commit**, then paste prompt B and commit again (version 2). One agent with two committed versions is best: same voice, language and settings. A draft cannot be called, only a committed version. Give the agent the same greeting, Hindi, and one Bulbul voice. |
| Claude + Sarvam MCP | `claude mcp add --transport http sarvam-voice-agents https://mcp.sarvam.ai/voice-agents`, sign in once in the browser, then ask: *"create an agent whose instructions are the file vani_prompt_A.md, commit it, then set the instructions to vani_prompt_B.md and commit again as version 2"* (the two files are the page's download buttons). Sarvam's server can create, clone, configure and commit agents (docs.sarvam.ai/conversations/mcp). |

**Known gap, same for A and B:** the real prompt calls tools that exist only in IndiaMART's own setup (`ast_buy_confirmed_tool`, `requested_another_product_tool`, `update_ast_buy_variables_by_city_tool`) and sets variables (`call_outcome`, `buyer_disposition`, ...). A demo agent will not have them, so the model may mention or skip them. Add them as mock tools / variables if you want it cleaner (Sarvam: Build > Tools > Mocking a tool). It affects both prompts equally; it does not change the comparison, but it can change how natural the call sounds.

## The demo, step by step (about 10 to 12 minutes for 5 calls per prompt, i.e. 10 calls)

1. **Step 1:** pick the patch. The page shows exactly which words changed.
2. **Step 3, the threshold:** choose calls per prompt. The blue box says what that number can and cannot catch (table below). Leave *Blind* on.
3. **Lock** the test. From now on nothing about the plan can change.
4. **Call:** press *Start next call*. The page tells you which line (Line 1 / Line 2) and gives the buyer a story to act out. The same story is used for both prompts of a pair, so A and B meet the same kind of buyer. Talk. Press *End call*.
5. **Signal:** *Yes: good call* / *No*, tick *fatal problem* if needed. Repeat.
6. After the last call the verdict page opens: result, the reveal of which line was which prompt, the guardrails, every call's transcript, and the proof it was fair.

A call that fails (no sound, dropped) is **voided** with a reason; it does not count and the same prompt is called again, so the order stays balanced.

## What the number of calls can and cannot show (exact, computed by `canary/livestats.py`)

Confidence 90%, exact tests, true rates near 50%. "Detects" = a real gap that B wins 8 times in 10.

| Finished calls per prompt | Total | Real gap it can reliably detect | Chance B is wrongly declared the winner if A = B |
|---|---|---|---|
| 5 | 10 | about 84 points | 1.1% |
| 10 | 20 | about 60 points | 2.1% |
| 20 | 40 | about 44 points | 2.6% |
| 30 | 60 | about 36 points | 2.7% |
| 50 | 100 | about 28 points | 3.3% |

So a live listening test is good for **obvious** differences (a patch that breaks or clearly fixes something). It cannot prove a small gain such as +3 points; that needs the main console and real traffic (hundreds to thousands of calls). The page says this on the setup screen and again on an inconclusive result.

## How the result is decided

- **Win** needs both Fisher's exact test (never exceeds the error rate at any size) and the score test the main engine uses to agree. If only one is significant the result is called *borderline*, never a win.
- **Guardrails** (fixed before the test): B's typical call no more than 15% longer than A's; B's fatal-problem rate no more than 15 points above A's (and at least 2 more calls). A breach turns a win into *hold for approval*. A guardrail can never create a win.
- **Verdicts:** PROMOTE, HOLD_FOR_APPROVAL, STOP_HARM, INCONCLUSIVE: the same words as the main engine.
- **If inconclusive** the page says about how many calls per prompt a NEW test would need (exact search, not a rule of thumb) or that the gap is too small to matter. Adding calls to a finished test is not offered: that would break the fairness the threshold exists for.

## Fairness features

| Feature | What it protects against |
|---|---|
| Threshold locked before call 1 | stopping when it looks good |
| Result and totals hidden until the threshold | peeking, which inflates false wins |
| Secret balanced order (one A and one B in every pair, shuffled); its fingerprint is logged before call 1 and the order is revealed at the end | favouring one prompt, choosing who gets which call |
| Same buyer story for both calls of a pair | A meeting easier buyers than B |
| Blind mode (Line 1 / Line 2) | listeners hoping for the patch to win. A fairness aid, not security: the ids are in the saved files |
| Tamper-evident log (hash chain, same as the rest of Picky) | changing a signal afterwards. Evident, not proof against someone who rewrites the whole file |
| Results CSV only after release | leaking results through the export |

## Safety of the key

On its own the server only answers the browser on this computer (requests addressed to `localhost`, not relayed by a tunnel or proxy); POSTs must come from the page itself (Origin and JSON checks); the one Sarvam call it makes is the documented "signed URL" request for the two configured agents; the browser then talks to Sarvam's voice servers with that short-lived link. Calls cost Sarvam credits (check your balance first; a 10-call demo is roughly 10 to 15 minutes of voice).

### Sharing it with the team (ngrok, or a hosted copy)

A tunnel such as ngrok shows the server a public host name, so without this step every visitor gets `403 this server only answers requests addressed to localhost`. That refusal is deliberate (it stops other web pages from reaching a server that holds a key). To let the team in, set a team password (8+ characters) when you start it:

Put one line in the `.env` file that already holds the Sarvam key (the hackathon folder's `.env`, git-ignored): `CANARY_PASSWORD=choose-a-team-password` (no spaces or quotes). Or set it just for one run:

```bash
CANARY_PASSWORD='choose-a-team-password' python -m canary live --port 8790
ngrok http 8790                      # share the https link and the password
```

- Visitors are asked for the password by their browser (any user name). Your own browser on `http://127.0.0.1:8790` is not asked and sees everything, as before.
- A visitor sees the same console plus this screen, as in the hosted copy: Label Lab, call audio, transcripts, labels and the history database stay on this computer (404). Their history stays in their own browser.
- Anyone with the password can start billable Sarvam calls through your key. Share the password only with the team and stop the server when the session is over.
- ngrok's free plan shows each visitor a one-time "Visit Site" page first. That is ngrok's, not Picky's.
- Listening beyond this computer (`--host 0.0.0.0`, or a hosted service) is refused unless `CANARY_PASSWORD` is set. On a host such as Render use `python -m canary live --host 0.0.0.0 --port $PORT` with `CANARY_PASSWORD` and `SARVAM_VOICE_API_KEY` as environment variables; `/healthz` answers without a password for the platform's health check.
- `tests/browser/tunnel_access.mjs` checks a running public link end to end (password wall, every screen, local data not reachable).

## What was tested, and what was not

| Tested | How |
|---|---|
| Statistics: exact power, false-win never above the error rate (enumeration), interval agrees with verdict, guardrails | 9 unit tests |
| Rules: locked result, balanced pairs, void re-issue, blind no-leak, log tamper detection, CSV, key never in any response, proxy refuses unknown agents, foreign Host/Origin refused, the console still works through the live server and the normal server does not show the screen | 26 unit tests (`tests/test_livecall.py`) |
| The real Sarvam browser SDK (v0.0.42, MIT, vendored in `web/live/vendor`), fake microphone, 6 calls in headless Chrome inside the console, menu intact, locked-until-release, verdict, reveal, CSV, phone width | `tests/browser/live_flow.mjs` against `tests/browser/mock_sarvam.mjs` |
| **NOT tested: a call to real Sarvam.** No Voice Agents API key exists on this machine (the key here is the model-API key; Sarvam's voice endpoint answers it with "Invalid API key format"). The mock follows the SDK's own source, so the proxy path, signed-URL step, WebSocket handshake and event handling are exercised, but Sarvam's real server may differ in small ways (for example the exact shape of transcript events). | Do **Check connection**, then one practice call, before the demo. If anything is off, switch to *Talk somewhere else, log it here*: the same test, threshold and result work with calls made on Sarvam's own test page or a phone number. |
| Recording playback ("listen") after the result uses Sarvam's recordings API; its response shape is undocumented, so it is best effort and falls back to the interaction id for Sarvam > Monitor > Call Logs. | untested |

Pre-existing and unrelated: four tests of main (`test_console.ConsoleData`, `test_export_db` x2, `test_metrics_overhaul.QaFixes`) fail in a fresh checkout because they need git-ignored label data; they fail identically on a pristine copy of `main`. Everything else passes.

## Where things are

| File | Purpose |
|---|---|
| `canary/livestats.py` | exact tests, power table, verdict |
| `canary/livecall.py` | the test: plan, secret order, calls, signals, release, log, CSV |
| `canary/liveserver.py` | the normal console server plus the live-call routes (port 8790) and the key-holding proxy |
| `web/console/80-livecall.js` | the console screen (setup, run, result). It switches itself on only when the page is served by `python -m canary live`; on the normal server, the offline file and the hosted app it does nothing and the menu is unchanged |
| `web/live/livecall.css` | the few styles the console does not already have; everything else uses the console's own components |
| `web/live/vendor/` | the vendored Sarvam browser SDK (loaded the first time a call starts) |
| `data/live/` | saved tests (git-ignored) |
