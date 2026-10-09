# Canary - the bot finds its own weak spot, fixes it, and proves the fix

Hackathon problem 5 (Agent A/B Testing & Auto-Rollout) for **VANI BuyLead qualification**: when a seller is unavailable VANI phones the buyer to capture Quantity, Specification, Delivery location and Timeline so the lead is not lost.

Canary closes the loop in four steps, on VANI's real calls:

1. **Find** what is really losing BuyLeads: Sarvam transcribes and tags real recordings; failures are ranked by what they *cost*, not by how often they occur.
2. **Fix**: Sarvam's language model drafts one small, reviewable prompt edit aimed at that failure.
3. **Pre-check**: simulated buyers (played by Sarvam's model, voiced by Sarvam Bulbul) hear today's prompt and the fix; a pass rule fixed in code before the run keeps a clearly worse edit away from real buyers.
4. **Prove and roll out**: the A/B engine tries the edit on a sticky slice of buyers, ships it only if it provably wins, stops it early if it is worse, guards average handling time, and logs every decision (including the evidence for the fix) in a tamper-evident record.

**Status, stated plainly.**
- Built and tested (54 tests): engine, simulator, proof lab, dashboard, Label Lab, Sarvam labelling pipeline, fix loop, pre-screen, voice arena.
- **Real:** the call labels (299 recordings transcribed by Sarvam Saaras and tagged by Sarvam-105B), the measured baseline, the failure ranking, the drafted edit, the voice arena audio, the proof-lab statistics.
- **Simulated, by design:** call *outcomes* in the A/B test (an injected known difference, so we can check the engine finds it). We cannot claim a real-world lift for any prompt.
- **Not yet verified:** the labels are machine labels. A person spot-checks 40 calls (Label calls tab) to measure their accuracy. The base prompt is a stand-in (the real VANI prompt was not provided); the Sarvam voice agents are created in the dashboard (`data/sarvam_agent_prompt.md`).

## Test it yourself in 10 minutes

```bash
python -m canary build            # or ./run.sh for everything
open dist/canary_demo.html        # fully offline; needs no internet, no server
```
Then follow `USER_JOURNEY.md` (eight short steps). For the live engine and the labelling page: `python -m canary serve` -> http://127.0.0.1:8765.

## Commands

| Command | What it does | Spends credits? |
|---|---|---|
| `python -m canary demo` | run all scenarios in the terminal | no |
| `python -m canary proof` | Monte Carlo proof lab, writes `out/proof.json` | no |
| `python -m canary build` / `qa` / `slide` | dashboard, `QA_REPORT.md`, one slide | no |
| `python -m canary fix mine` | rank the real failures by what they cost | no |
| `python -m canary fix propose [--yes --force]` | Sarvam drafts the prompt edit (about Rs 0.05) | only with `--yes` |
| `python -m canary fix prescreen [--yes --budget N]` | 24 simulated buyers x 2 prompts (about Rs 10) | only with `--yes` |
| `python -m canary fix agent` | write the two prompts to paste into Sarvam agents | no |
| `python -m canary arena plan\|run [--yes]` | voice arena: hear prompt A vs B | only with `--yes` |
| `python -m canary autolabel plan\|run\|status\|queue\|report\|issues` | Sarvam transcription + tagging, budget-capped | only with `run --yes` |
| `python -m canary serve` | live engine + Label Lab | no |
| `python -m unittest discover -s tests` | 54 tests (fake Sarvam client, no network) | no |

Needs Python 3.10+, numpy, scipy (`requirements.txt`) and, for Sarvam, `pip install sarvamai` plus `SARVAM_API_KEY` in `.env` (never printed or committed). The dashboard needs no network, no CDN, no build step.

## What is in it

- `canary/seqdesign.py` - alpha-spending boundaries, power and sample size (validated against published values and by simulation).
- `canary/engine.py` - config, design, **one decision function** (`Monitor.look`) used by the live runner and by the proof lab.
- `canary/router.py`, `ledger.py` - sticky assignment (hash or balanced) and the hash-chained decision log the browser re-verifies.
- `canary/simulator.py`, `scenarios.py` - traffic replay with a known difference; 3 fix scenarios (built from the measured baseline and the AI-drafted edit) plus 6 stress scenarios.
- `canary/proof.py`, `baselines.py` - thousands of simulated tests, Canary vs typical approaches on identical data.
- `canary/sarvam_pipe.py` - Sarvam transcription + tagging with spend guards; `labels.py`, `evaluator.py` - human labels and tagger scoring.
- `canary/fixloop.py`, `prescreen.py`, `arena.py` - failure mining, the Sarvam-drafted edit, the pre-check, the voice arena.
- `web/` - the dashboard (plain JS, hand-drawn SVG, light/dark, keyboard friendly).

## The fix loop and what we changed from the PM's version

The PM proposed: read the failed calls, cluster them, draft an edit for the top cluster, A/B it, ship if it wins. We built that, with corrections:

- **Top cluster by count is the wrong rule.** On the real labels the largest group among failed calls is "did not read the details back" (51 calls), but calls with it convert *better* (60% vs 45%): it is common in good calls too. Ranking by the conversion gap picks "ended the call abruptly" (38% vs 57%, about 3.9 BuyLeads per 100 calls at most). `python -m canary fix mine` prints the table; QA_REPORT.md section 6d explains it.
- **Mining only proposes.** The gap is an association between two machine labels. Whether the edit helps is decided by the live test, never by the mining.
- **The edit is constrained and validated**: at most two added lines and one removed line, anchored to existing prompt lines, no digits or quotes (so no call details leak into a prompt), one retry, then refuse.
- **Dropped, with reasons** (QA_REPORT.md, DEMO_SCRIPT.md): CUPED (no pre-call features, so we would be inventing the 30-40%), per-segment auto-promotion (multiple-comparison trap at these sample sizes), a 5% holdout (about 30 calls a day at 600 a day cannot see a fading win in time; the first extension).
- **Kept:** sequential testing against naive peeking, the sample-ratio check (strengthened with a per-arm assigned-vs-logged check), and the evidence trail.

## Auto-labelling with Sarvam (credit-safe)

```bash
echo 'SARVAM_API_KEY=your-key' > .env                 # once
python -m canary autolabel plan --n 100 --diarize     # FREE: shows the cost
python -m canary autolabel run  --n 100 --budget 95 --diarize --yes
python -m canary autolabel queue                      # ~40 calls for a person to spot-check
python -m canary autolabel report                     # BuyLead rates, field capture, bot issues (free)
```
Why `--diarize` (Rs 45/h instead of Rs 30/h): without speaker separation the tagger cannot tell the bot from the buyer. Safeguards (tested with a fake client): nothing is spent without `--yes`; a hard rupee budget; one fixed random order so any prefix is a fair sample; every transcript and label is cached, so nothing is paid for twice; failures are recorded and never retried automatically; no transcript text is ever printed. Pricing used: Saaras batch Rs 30/hour of audio, Sarvam-105B Rs 29.28 / 73.20 per million tokens in/out, Bulbul Rs 3 per 1,000 characters (sarvam.ai/api-pricing).

## Data hygiene

The recordings are customer data. Audio and transcripts go only to the Sarvam platform (the sanctioned platform for this hackathon), never to any other service. Transcripts, labels and spend files stay on this machine (`.gitignore` excludes them). `data/call_durations.json` holds only call index and duration. Keep `data/labels.jsonl` and `data/transcripts*` inside the premises.
