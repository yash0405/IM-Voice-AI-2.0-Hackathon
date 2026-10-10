# Limitless Voice: Picky

**Team Limitless Voice:** Yash Gupta · Sakshi Sehajpal · Munquab Anwer
**Problem statement:** 5. Agent A/B Testing & Auto-Rollout
**Live app (open to everyone, nothing to install):** https://yash0405.github.io/IM-Voice-AI-2.0-Hackathon/
**Demo video:** *(link to be added)*

## Short pitch
Picky tests any change to VANI on a small, sticky slice of calls, decides with pre-registered statistics (false winners held to 2.5%), stops a worse version early, and rolls out only the winner, logging every decision in a tamper-evident record.

## Try it in 2 minutes
1. Open the live app. The first load takes about a minute, because the real Python engine downloads and runs inside your browser.
2. On **Overview**, press **▶ Play**. Six demo tests run day by day until each one is settled:
   - one B wins and is promoted, with 5% of callers kept on A for a week as a check;
   - one B is worse and is stopped early;
   - one test ends with no clear winner;
   - one B wins for a single segment only;
   - one B wins with longer calls, waits for a person's yes, and the autopilot keeps A when nobody answers;
   - one B slips after rollout and the autopilot rolls it back.
3. Open **All experiments** and click any test to see its verdict, day-by-day chart, split health and decision record (**Verify record** re-checks the hash chain).
4. Press **New experiment** and build a test in 6 steps: prompt B, audience, goal and guardrails (including custom metrics from the real call-data columns), duration, then review and launch.

## Approach note
**Data used**
- VANI's real buyer-side prompt (77 pages, about 25,000 words) and IndiaMART's call-quality matrix (fatal and non-fatal parameters).
- 713 real call recordings (13.85 h). Sarvam Saaras transcribed 299 of them with speaker separation, and Sarvam-105B tagged each one against the quality matrix.
- The Hot Lead disposition table (`data_hotlead_disposition_dtl`, 29,591 calls over 30 days). It gives real baselines for planning (answer rate, call duration, meeting fixed) and the columns for custom metrics. The HL Bucket rule (Top 3 = SCHD, OLP, OLPR, PAM, PNCHF, PANF, PUT, NVGT, TF, UATF; Rest = NUR, PIM, UA, PUA, ENQR, PNSM, PNSR) is set in one place, `canary/catalog.py`.
- There is no live traffic in the hackathon, so call outcomes inside a test are simulated with a known injected difference. We can therefore check that the engine finds the truth.

**Design (before, during, and after a test)**
1. **Before.** A 6-step setup:
   - prompt B as a full edit with a diff and a variable check;
   - an audience built from lists, never typed code (HL Type, HL Bucket, GST Nature of Business, Vertical, Legal Status and more);
   - a primary goal, guardrails and secondary metrics;
   - a duration calculator that plans from the real baseline.

   At launch the whole setup is locked and hashed, so it cannot be changed quietly mid-test.
2. **Split.** A sticky router: a repeat caller always hears the same prompt. Shuffled blocks inside each HL Type × GST Nature of Business group keep the B share and the lead mix on target.
3. **During.**
   - The engine reads results day by day.
   - A strict daily harm check stops a clearly worse B early.
   - A split check and a per-prompt "assigned vs logged" check halt a broken test.
   - Guardrails (call duration, early hang-ups) veto a win that hurts the call.
   - A win with a guardrail at its limit is held for a person to approve.
4. **After.**
   - One pre-registered winner call at the end (the BRD's rule). A sequential alpha-spending rule (Lan-DeMets) is available as a setting.
   - The winner is promoted automatically, with 5% of callers held back on A for a week, and rolled back if it slips.
   - An inconclusive test says how many more leads would settle it.
5. **Record.** Every decision, click and number goes to a hash-chained decision log and a SQLite history.
6. **Finding what to test.**
   - A free prompt lint finds contradictory ask limits in the real prompt.
   - A loop scan of the real calls needs no model.
   - Sarvam's labels rank failures by cost.
   - **Suggest A/B Tests** turns these into ready experiments.

**Expected outputs delivered**
- A traffic splitter.
- An experiment engine with automatic promotion and early stop.
- Goal and guardrail metrics, including custom metrics.
- A dashboard: Overview, New Experiment, All experiments, Suggest A/B Tests, Prompt Library, Decision Log and Settings.
- A results-file path (`python -m canary decide`) for real exports.
- A proof lab and a QA report regenerated from code.
- A reusable skill (`skill/ab-test-decision/SKILL.md`).

## Impact on success metrics
All numbers below are re-runnable from code with fixed seeds. They are taken from [docs/QA_REPORT.md](docs/QA_REPORT.md).

| PS05 metric (weight) | Result | How it was measured |
|---|---|---|
| Statistical validity (30%) | False winner **2.50%** (95% range 2.23–2.80%) against a 2.5% target. Naive daily peeking gives **12.2%**. | 12,000 simulated A vs A tests (identical prompts), BRD default rule |
| Split accuracy (20%) | Mean error of the B share is **0.10 pp** at 1,000 leads and a 10% share (100% of runs within ±0.5 pp). A plain coin flip gives 0.81 pp. **0** repeat callers switched prompt; a coin flip switches 17.6%. | Router simulation over repeated assignments |
| Promotion and early stop (30%) | **7 of 7** stress scenarios reach the right decision, and re-runs are identical: promote, stop for harm, inconclusive, the peeking trap, a broken log halted, a guardrail veto, and hold for approval. A 10 pp worse B is stopped in **95.9%** of runs with **55%** less exposure than a fixed-length test. A real winner is promoted with **26%** fewer calls. | Proof lab, 4,000 simulated tests per case |
| Primary and secondary metrics (20%) | A B that wins on leads but makes calls 30% longer ships **0%** of the time (naive peeking ships it 90%). Custom metrics are built from the real data columns and preview on the real file. | Proof lab; builder checked against `dtl table data.csv` |

**Expected benefit for VANI, buyers and sellers at scale**
- **VANI team.** Any prompt change can be tested on a small share of calls, with a calculator that says up front how long the test will take. Only proven winners ship, and rollback is one click.
- **Buyers.** Fewer buyers hear a worse prompt: harmful versions are stopped early with about half the exposure, and a slipping winner is rolled back.
- **Sellers.** Changes that help (more answered calls, more meetings fixed, more leads passed on) reach every call sooner. Changes that only look good are not shipped: the false winner rate stays at 2.5% instead of 12%.
- **Honest limits.**
  - Outcomes inside a test are simulated, so we claim no real-world lift for any prompt.
  - The machine labels are provisional until a person spot-checks them.
  - Verbatim loops are rare in the real calls (about 1.7%), so the prompt-consistency fix we propose is a safety change.

## Run it locally
```bash
./start.sh                 # sets up a venv, then opens http://127.0.0.1:8765 (the full app; history saved in data/history.db)
open dist/canary_demo.html # or: the offline single-file demo, no server needed
./run.sh                   # everything: tests, proof lab, dashboard, QA report, one-slide summary
```
Needs Python 3.10+ (`requirements.txt`: numpy, scipy, jinja2). Paid Sarvam steps need `pip install sarvamai` and `SARVAM_API_KEY` in `.env`. Each paid step is opt-in (`--yes`) and costed in advance (`python -m canary fix costs`). How to test each feature: [docs/HOW_TO_TEST.md](docs/HOW_TO_TEST.md).

## Repository layout
| Path | What it is |
|---|---|
| `canary/` | The engine (Python package): router, sequential and final-look decision rules, guardrails, ledger, simulator, proof lab, results-file reader, Sarvam labelling, prompt lint, data-file catalog, servers |
| `web/` | The dashboard: plain JS parts in `web/console/*.js`, assembled into `web/console.js`; `console.css` |
| `data/` | The real prompt (rule per line), the quality-matrix schema, sample results files, call durations |
| `dist/` | Prebuilt offline demo (`canary_demo.html`), engineer tools, the one-slide summary |
| `out/` | Generated data the dashboard reads (`console_bundle.json`, proof results) |
| `deploy/` | Builds the hosted app for GitHub Pages (`.github/workflows/pages.yml` redeploys on every push to `main`) |
| `tests/` | Python unit tests (`python -m unittest discover -s tests`) and browser tests (`tests/browser/`) |
| `docs/` | QA report, demo script, how to test, integration notes, labelling guide, leaders' Q&A |
| `skill/`, `skills.md` | The reusable A/B decision skill, and how the project was built |

## Commands
| Command | What it does | Spends credits? |
|---|---|---|
| `python -m canary decide FILE --goal ... --share-b 0.3 --baseline ... --window-days ...` | Decide from a results file: ship, stop, hold for a person, or keep A | no |
| `python -m canary proof` / `qa` | Proof lab (thousands of simulated tests) / write `docs/QA_REPORT.md` | no |
| `python -m canary build` / `serve` / `live --port 8790` | Build the dashboards / local server on 8765 / the team server on 8790 | no |
| `python -m canary fix lint` / `loops` / `candidate` / `costs` | Prompt contradictions / repeats in real calls / free candidate edit / cost of each paid step | no |
| `python -m canary fix propose --yes` / `prescreen --yes` | A Sarvam-drafted edit / simulated buyers hear A and B | yes, capped |
| `python -m canary autolabel run --yes` | Sarvam transcription and tagging | yes, capped |
| `python -m canary history` / `export-db` | The live history database / a SQLite export of every test | no |

## Data hygiene
Recordings and transcripts are customer data. They went only to the Sarvam platform, and they stay on the team's machine with labels and spend files, all excluded from this repository (`.gitignore`). The hosted app contains no call recordings, transcripts or call rows. Of the call-data file it uses only the column names and category values.
