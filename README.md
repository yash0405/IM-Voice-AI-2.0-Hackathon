# Canary - the bot finds its own weak spot, fixes it, and proves the fix

Hackathon problem 5 (Agent A/B Testing & Auto-Rollout) for **VANI**, IndiaMART's buyer-side voice assistant. A buyer calls a seller from the IndiaMART app; if the seller is unavailable the call is redirected to the Help Desk, where VANI confirms the product, collects quantity, specifications, buyer name and city/state, and connects the buyer to a live seller (or promises seller details on WhatsApp).

Canary closes the loop in four steps, on VANI's **real prompt** (Resources/Sarvam Prompt - Buyer Side VANI.docx.pdf) and real recordings:

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
- **Anyone:** `START_HERE.md` (one page), then open `dist/canary_demo.html` or run `./start.sh`. The app opens on a **Start** page with four plain choices: judge a test's results, check whether a test can finish, suggest a change worth testing, and why to trust it.
- **AI assistants:** `skill/ab-test-decision/SKILL.md` is the same method packaged as a reusable skill (plan a test, check a results file, decide, report honestly). Its scripts need only the standard library, except `decide.py` which uses the engine in this folder.

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
| `python -m canary demo\|proof\|build\|qa\|slide\|serve` | scenarios, proof lab, dashboard, QA report, slide, live server | no |
| `python -m unittest discover -s tests` | 116 tests (fake Sarvam client, no network) | no |

Needs Python 3.10+, numpy, scipy, jinja2 (`requirements.txt`); `pdftotext` (poppler) only to re-extract the prompt from the PDF; `pip install sarvamai` plus `SARVAM_API_KEY` in `.env` only for paid steps. The dashboard needs no network, no CDN, no build step.

## What is in it
- `canary/realprompt.py` - the real prompt: PDF -> one rule per line (`data/base_prompt.md`), the four flows inside it, and a Jinja renderer for a call.
- `canary/promptlint.py` - contradictory ask limits, duplicated blocks, and the gate every edit must pass (no new contradiction).
- `canary/loopscan.py` - tagger-free loop detector over the transcripts.
- `canary/fixloop.py`, `prescreen.py`, `arena.py` - the fix loop, the pre-check, the voice arena (all with exact cost estimates).
- `canary/decide.py`, `samples.py` - the results-file path: read files, check them, count each lead once, replay day by day through the same decision function; synthetic sample files.
- `canary/seqdesign.py`, `engine.py` - alpha-spending boundaries, power, one decision function (`Monitor.look`) used by the live runner and the proof lab.
- `canary/router.py`, `ledger.py`, `simulator.py`, `scenarios.py`, `proof.py`, `baselines.py` - sticky split, hash-chained record, traffic replay, 3 fix scenarios + 6 stress scenarios, thousands of simulated tests against typical approaches.
- `canary/sarvam_pipe.py`, `labels.py`, `evaluator.py` - Sarvam labelling with spend guards, human labels, the schema-2 tagger prompt (`data/evaluator_prompt.md`, `data/dispositions.json`).
- `web/` - the dashboard (plain JS, hand-drawn SVG, light/dark, keyboard friendly).

## What the real resources changed (all corrected, none hidden)
| We had assumed | Real prompt / matrix | Consequence |
|---|---|---|
| VANI phones the buyer | "This is NOT an outbound call": an inbound redirect | simulation reframed; old arena/pre-screen marked stale |
| quantity, specification, delivery location, timeline | product, quantity, specification(s), buyer name, city and state | label schema 2; no timeline |
| reading details back is good | the No-Echo rule forbids it | our top "failure" (129 calls) retired; this also withdrew our claim that the PM's "biggest cluster" rule picks the wrong target |
| success = quantity + specification captured | live-seller connection is the top priority; BL Approved / Enriched / Deleted | schema-2 outcomes follow the real dispositions |
| our own issue list | IndiaMART's fatal / non-fatal quality matrix | schema-2 issues are the matrix parameters |

## The PM's suggestions
Loop (propose B from failures, A/B it, ship if it wins): **built** on the real prompt. Sequential testing vs naive peeking: **kept**. Sample-ratio check: **kept and strengthened** (a per-arm assigned-vs-logged check). CUPED: dropped (no pre-call features, so we would invent the 30-40%). Segment promotion: dropped (multiple comparisons). 5% holdout: first extension (about 80 days to see a 4-point fade at 600 calls a day).

## Data hygiene
Recordings and transcripts are customer data: they went only to the Sarvam platform (the sanctioned platform), never to any other service; transcripts, labels and spend files stay on this machine and are excluded from the repository (`.gitignore`). The real prompt is IndiaMART's internal configuration (not customer data); it is sent to Sarvam only when a paid step is run with `--yes`. Our AI coding assistant never read call content, only counts.
