# Picky - Test it, pick it, ship it

A/B testing and auto-rollout for voice agents: the bot finds its own weak spot, fixes it, and proves the fix.

Hackathon problem 5 (Agent A/B Testing & Auto-Rollout) for **VANI**, IndiaMART's buyer-side voice assistant. A buyer calls a seller from the IndiaMART app; if the seller is unavailable the call is redirected to the Help Desk, where VANI confirms the product, collects quantity, specifications, buyer name and city/state, and connects the buyer to a live seller (or promises seller details on WhatsApp).

Picky closes the loop in four steps, on VANI's **real prompt** (Resources/Sarvam Prompt - Buyer Side VANI.docx.pdf) and real recordings:

1. **Find** what could be losing leads, from three independent places: the prompt itself (a lint that finds contradictory ask limits), the real calls (a tagger-free loop scan), and Sarvam's machine labels.
2. **Fix**: one small, reviewable edit. The free candidate is derived from the prompt's own contradictions; Sarvam can draft an alternative from the same evidence. Any edit that contradicts the prompt is rejected automatically.
3. **Pre-check** on simulated buyers (optional and paid: the real prompt is large, see the costs).
4. **Prove and roll out**: the A/B engine tries the edit on a sticky slice of buyers, ships it only if it provably wins, stops it early if it is worse, guards handling time, and logs every decision (with the evidence for the fix) in a tamper-evident record.

## Status, stated plainly (updated when the real prompt and quality matrix arrived)
- **Real:** the real prompt and its lint; the loop scan on the real recordings; 299 real recordings transcribed by Sarvam Saaras and tagged by Sarvam-105B; the statistics in the proof lab.
- **Provisional:** those 299 machine labels were made *before* the real prompt arrived, with an older vocabulary (they include a timeline field and a "did not read details back" issue that the real prompt does not have). One command re-tags the saved transcripts with the real-prompt schema (about Rs 23). A person's 40-call spot-check then measures their accuracy.
- **Simulated, by design:** call *outcomes* inside the A/B test (an injected known difference, so we can check the engine finds it). We cannot claim a real-world lift for any prompt.
- **Not run (credits are limited; each is opt-in with exact costs):** the re-tag, the Sarvam-drafted edit (Rs 0.9), the pre-check on the real prompt (Rs 116 for 12 buyers), the voice arena with the real prompt (Rs 53). The earlier arena audio and pre-screen used a wrong stand-in prompt and are labelled stale.
- **Honest finding:** VANI repeats itself verbatim in only about 1.7% of calls (a lower bound), so the consistency fix is a safety measure and is expected to move conversion by a point at most; proving 1 point takes about 83,000 calls. The tool says so.

## Start here
- **Anyone:** `START_HERE.md` (one page), then open `dist/canary_demo.html` or run `./start.sh` and press **▶ Play** on Overview. How to test with a results file or with voice: `docs/HOW_TO_TEST.md`. What changed (simpler screens, the autopilot, voice): `docs/WHATS_NEW.md`. Leaders' questions (who else does this, why we built it, which tools we reused): `docs/LEADERS_QA.md`. The dashboard follows the PS05 feature spec: a left menu with **Overview, New Experiment (6 steps), Live Experiments (with "Advance 1 day"), History, Suggest A/B Tests, Prompt Library, Decision Log, Settings**, in the Clean Slate theme from the PM's design brief. Five experiments are pre-set and paused on day 2, as in the BRD's demo plan (B wins, B worse, flat, a win in one segment, and a win with longer calls).
- **AI assistants:** `skill/ab-test-decision/SKILL.md` is the same method packaged as a reusable skill (plan a test, check a results file, decide, report honestly). Its scripts need only the standard library, except `decide.py` which uses the engine in this folder.
- **Engineers:** the technical tools (proof lab, label calls, hear it) are one click away under Settings > Tools (`dist/canary_tools.html` offline, `/tools.html` live).

## The second BRD (9 Oct, the final version for build): what it changed
Scrutinised, not copied. **Adopted:** segments (a variable catalog and a segment builder that always shows the rule in plain words; only pre-call variables), the stratified router (blocks of 10 inside each lead-type x firm-type group), the split-health panel with a balance table and segment check, goal cards, whole-week durations (7 to 28 days) with a sticky calculator and a traffic light, the five-item pre-launch checklist, Save Test (draft) and Launch Test (locked), the scheduled start date, the full Overview (tiles, business impact, needs attention, traffic map, scorecard, top suggestion), the 5% holdback after a promotion, a variable catalog in Settings, and the end-of-test two-sided call ("significantly worse: keep A, logged as a loss"). **Adapted:** a segment is built from lists, never typed as code (the plain-English reader was replaced by the builder in the New Experiment overhaul); the LLM-written report is a template written from the numbers; SQLite is both the export (`python -m canary export-db`) and, since 10 Oct, the live history store of the local server (`data/history.db`, see below). **Kept:** our own router, engine and dashboard stack (no Streamlit): it needs no installation and runs offline. **Questioned with numbers (QA_REPORT 5d):** "false winner about 5%" is the two-sided total (2.5% promoted + 2.5% logged as a loss); a 1,000-lead minimum would stop the daily harm check from ever starting at a 10% share in a 7-day test, so the calculator now shows the day it starts; the lead variables do not exist in our data, so they are synthetic and labelled so.

## Scope: what is ours, what is not (checked against the documents)
The PM's split: **before the test** (variants, traffic split, goals and rules locked), **the test itself** (the voice calls: not ours), **after / during** (watch the results, decide, early stop, roll out). Our reading of the documents:
- **Supported:** the PS05 document says "participants will not have live traffic: build a traffic simulator or replay mechanism", its four scored criteria (statistics 30, split 20, promotion and early stop 30, goals and guardrails 20) say nothing about voice quality, the BRD puts real live calls out of scope, and the dashboard spec says "no voice agent is needed for the hackathon".
- **Not covered by that reading:** the event deck (Revised - Final) lists for this problem an LLM evaluator that tags every test call ("accuracy of auto-disposition vs labelled calls" is a success metric) and a test bed of simulated sellers on Sarvam voice agents, and the jury rubric for every team gives 20% to Voice Experience. Which document governs for this problem is a question for the organisers; we do not guess.
- **How the project is built for both:** the engine is the core and works on *results files* (`python -m canary decide`, and the Judge a test tab), which is the PM's model. The voice and tagger layer (Sarvam transcription and tagging, the arena) already exists, costs nothing more unless run, and is kept as an optional source of those files.
- **Still ours even if the voice test is not:** the experiment must be *shown running end to end* (simulated or replayed), and early stop happens *during* the test, so the engine reads results day by day.

## Test it yourself
```bash
python -m canary build            # or ./run.sh for everything (about 20 s)
open dist/canary_demo.html        # fully offline; no internet, no server
```
Then follow `USER_JOURNEY.md`. For the live engine and the labelling page: `python -m canary serve` -> http://127.0.0.1:8765.

## Where the test history is kept
The live server (`python -m canary serve`) saves every test in one SQLite file, `data/history.db` (move it with `CANARY_DB=/path/file.db`): the launched tests, their locked setup, day-by-day results, the hash-chained decision record, and every click (day played, approve, reject, roll back, pause, stop, reset). Every browser on that server sees the same history and it survives a restart. Settings shows the counts and has **Download the database**; `python -m canary history` prints it. A record whose hash chain does not verify is refused, and a launched test can never be changed. Two browsers cannot silently overwrite each other: a save based on an older version is refused and that browser reloads the latest. The database answers only the console on the computer running the server: a request through a tunnel or proxy (ngrok, cloudflared, tailscale), from another computer, or from another web page gets 403, and that browser keeps its state to itself. A browser used before the database existed keeps its drafts, custom metrics and progress when it first connects. The hosted copy (GitHub Pages) and the offline file have no server, so they keep their state in the browser, as before.

Why SQLite and not Postgres: it is built into Python (nothing to install or run), the whole history is one file a judge can open, and our load is a few writes a minute from one server. Postgres is the right choice when several servers write at once, i.e. in production at IndiaMART; the tables are plain SQL, so moving them is a connection change plus a few type tweaks, not a redesign.

**Hear it live :** `./live.sh`. Talk to prompt A and prompt B on real Sarvam voice agents, give a signal after each call, and the result is released only after the number of calls you fix before the test. See `LIVE_CALL_TEST.md`.

## Commands

| Command | What it does | Spends credits? |
|---|---|---|
| `python -m canary fix lint` | the prompt's contradictory ask limits, with quotes and line numbers | no |
| `python -m canary fix loops` | how often VANI repeats itself in the real recordings (no model) | no |
| `python -m canary fix mine` | rank failures from the machine labels by what they cost | no |
| `python -m canary fix candidate` | write the free, prompt-derived candidate edit (`data/proposal.json`) | no |
| `python -m canary fix costs` | exact cost estimate of every paid step | no |
| `python -m canary fix propose [--yes]` | Sarvam drafts an edit from the evidence | only with `--yes` |
| `python -m canary fix prescreen [--yes --personas N]` | simulated buyers hear prompt A and B | only with `--yes` |
| `python -m canary fix agent` | write the two prompts to paste into Sarvam agents | no |
| `python -m canary autolabel retag [--yes --budget N]` | re-tag saved transcripts with the real-prompt schema | only with `--yes` |
| `python -m canary autolabel plan\|run\|status\|queue\|report\|issues` | Sarvam transcription + tagging, budget-capped | only with `run --yes` |
| `python -m canary arena plan\|run [--yes --force]` | voice arena: hear prompt A vs B | only with `--yes` |
| `python -m canary decide FILE --goal ... --share-b 0.3 --baseline ... --window-days ...` | **decide from results files** (A and B, per call or per day): ship, stop, hold for a person, or keep A | no |
| `python -m canary samples` | write six synthetic sample results files to `data/samples/` | no |
| `python -m canary export-db` | every test, version, assignment, call and decision into one SQLite file (`out/canary.db`) | no |
| `python -m canary history` | the live history database (`data/history.db`): every test, its status and outcome, and the latest clicks | no |
| `python -m canary demo\|proof\|build\|qa\|slide\|serve` | scenarios, proof lab, dashboards (`dist/canary_demo.html` and `dist/canary_tools.html`), QA report, slide, live server | no |
| `python -m unittest discover -s tests` | the full suite (fake Sarvam client, no network) | no |

Needs Python 3.10+, numpy, scipy, jinja2 (`requirements.txt`); `pdftotext` (poppler) only to re-extract the prompt from the PDF; `pip install sarvamai` plus `SARVAM_API_KEY` in `.env` only for paid steps. The dashboard needs no network, no CDN, no build step.

## What is in it
- `canary/realprompt.py` - the real prompt: PDF -> one rule per line (`data/base_prompt.md`), the four flows inside it, and a Jinja renderer for a call.
- `canary/promptlint.py` - contradictory ask limits, duplicated blocks, and the gate every edit must pass (no new contradiction).
- `canary/loopscan.py` - tagger-free loop detector over the transcripts.
- `canary/fixloop.py`, `prescreen.py`, `arena.py` - the fix loop, the pre-check, the voice arena (all with exact cost estimates).
- `canary/decide.py`, `samples.py` - the results-file path: read files, check them, count each lead once, replay day by day through the same decision function; synthetic sample files.
- `canary/seqdesign.py`, `engine.py` - alpha-spending boundaries, power, one decision function (`Monitor.look`) used by the live runner and the proof lab.
- `canary/catalog.py` - the variable catalog, segment rules and the strata plan (synthetic lead mix, labelled as such). `canary/export_db.py` - the SQLite export of the BRD's data model.
- `canary/router.py`, `ledger.py`, `simulator.py`, `scenarios.py`, `proof.py`, `baselines.py` - sticky split, hash-chained record, traffic replay, 3 fix scenarios + 7 stress scenarios, thousands of simulated tests against typical approaches.
- `canary/sarvam_pipe.py`, `labels.py`, `evaluator.py` - Sarvam labelling with spend guards, human labels, the schema-2 tagger prompt (`data/evaluator_prompt.md`, `data/dispositions.json`).
- `canary/console.py` - the data behind the dashboard: demo experiments, history, prompt library, suggestions, metric list.
- `web/console/*.js`, `web/console.css`, `web/index.html` - the dashboard that follows the feature spec and the Clean Slate theme (plain JS, hand-drawn SVG, no libraries, works offline; `web/console.js` is generated from the parts). `web/tools.html`, `simple.js`, `app.js`, `style.css` - the earlier technical tools page.

## What the real resources changed (all corrected, none hidden)
| We had assumed | Real prompt / matrix | Consequence |
|---|---|---|
| VANI phones the buyer | "This is NOT an outbound call": an inbound redirect | simulation reframed; old arena/pre-screen marked stale |
| quantity, specification, delivery location, timeline | product, quantity, specification(s), buyer name, city and state | label schema 2; no timeline |
| reading details back is good | the No-Echo rule forbids it | our top "failure" (129 calls) retired; this also withdrew our claim that the PM's "biggest cluster" rule picks the wrong target |
| success = quantity + specification captured | live-seller connection is the top priority; BL Approved / Enriched / Deleted | schema-2 outcomes follow the real dispositions |
| our own issue list | IndiaMART's fatal / non-fatal quality matrix | schema-2 issues are the matrix parameters |

## The PM's suggestions
Loop (propose B from failures, A/B it, ship if it wins): **built** on the real prompt. Sequential testing vs naive peeking: **kept**. Sample-ratio check: **kept and strengthened** (a per-arm assigned-vs-logged check). CUPED: dropped (no pre-call features, so we would invent the 30-40%). Segments as an audience: built (the second BRD asks for it); per-group winners are not used for the decision (multiple comparisons). 5% holdback after a promotion: built (it can only rule out a drop of about 11 points or more at 1,000 leads a day, and says so).

## Data hygiene
Recordings and transcripts are customer data: they went only to the Sarvam platform (the sanctioned platform), never to any other service; transcripts, labels and spend files stay on this machine and are excluded from the repository (`.gitignore`). The real prompt is IndiaMART's internal configuration (not customer data); it is sent to Sarvam only when a paid step is run with `--yes`. Our AI coding assistant never read call content, only counts.
