# Results file formats

Contents: per-call files · two-file layout · daily summaries · what is dropped or refused

## Per-call (preferred)
One row per call. CSV, TSV, semicolon or pipe separated, JSON list, `{"rows": [...]}` or JSON lines. Column names are matched flexibly (case and punctuation ignored):

| Meaning | Accepted names (first match wins) | Needed? |
|---|---|---|
| Lead / caller | lead_id, lead, glid, buyer_id, customer_id, user_id, phone, mobile | Strongly. Without it every call is its own lead and repeat callers are over-counted. |
| Prompt that served the call | variant, arm, group, bucket, prompt_version, prompt | Yes (or send A and B as two files). Values: A/B, control/test, baseline/candidate, 0/1, v1/v2. |
| Outcome | disposition, call_outcome, outcome, result, label, status | Yes, unless there is a 0/1 goal column. |
| 0/1 goal | goal_hit, converted, goal, success | Alternative to the outcome column. If the user names goal dispositions, those win and the 0/1 column is ignored (and the file says so). |
| Call length (seconds) | duration_s, duration, aht, handling_time | For the call-length guardrail. |
| When | timestamp, call_time, start_time, created_at, date (+ time) | For day-by-day reading. Zone offsets are converted to UTC. Without it the file is read in file order in up to 40 steps. |
| Call id | call_id, session_id, id | Removes repeated rows. |
| Connected | connected, answered | Only if the goal is "per connected lead". |

## Two files
Use `--a A.csv --b B.csv` (engine) or list the two files (check_results.py); no variant column is needed.

## Daily summary
One row per day and prompt: `date` (or day number), `variant`, `leads`, `goal_count`, optionally `mean_duration`, `sd_duration`, and `guard_count` for a rate guardrail. One row per day and prompt exactly; duplicates are refused. A summary cannot show whether any lead saw both prompts, and a day that overshoots the planned maximum cannot be cut, so say so in the caveats.

## What is dropped or refused
Dropped and reported: repeated call ids, rows with no readable outcome, unknown variant values, unusable durations (negative, not a number, longer than a day), calls after the window. Refused with a plain message: a goal that matches nothing in the file (usually a typo), a guardrail column holding text, counts that are negative or larger than the lead count, a missing plan, results for only one prompt. If the duration column exists but is unusable the call-length guardrail cannot be evaluated, and a win is held for a person instead of shipped.
