# How this skill was tested

Realistic requests were run twice by independent assistants (with the skill, without it). Each answer was graded against fixed statements in `evals/evals.json`; results are in `evals/results.json`.

| | With the skill | Without it |
|---|---|---|
| Iteration 1 (4 requests): statements held | 100% | 75% |
| Iteration 2 (5 requests, improved skill): statements held | 100% | 88% |
| Time per answer (mean) | 114 s | 152 s (about 25% slower) |
| Tokens per answer (mean) | 63,000 | 56,000 (about 12% fewer) |

## How to read it honestly
- The assistant without the skill was already strong on plain judgement (it refused to ship on a day-3 p-value and counted each lead once).
- The skill added rigour and consistency: the extra data a repeatedly checked test needs, labelling an exploratory plan, engine-backed verdicts, and a fade warning.
- One request per case, graded by the builder (not blind), so treat the gap as indicative, not proven.

## What the runs taught us (all fixed)
- A script's help text crashed on a percent sign.
- The baseline instruction contradicted the tool.
- The data check ignored the test window.
- Records of real files carried "simulated / demo click" wording.
- The plan tool demanded inputs it did not need.
- A win that faded was not covered.
- The engine could ship on a peak that had since faded; it now holds for a person instead.
