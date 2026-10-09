# Where Canary plugs into the production bot

Nothing here is wired to a live bot (no live traffic exists for the hackathon). This note says exactly where the module sits and what each side must provide, so the integration is a small job and not a guess.

## The picture
```
lead arrives ──> ROUTER (this module) ──> prompt version id ──> voice bot loads that prompt ──> call
                    │  1 read the lead's pre-call variables                         │
                    │  2 segment rule? no match -> production prompt, "out of segment", not counted
                    │  3 lead already assigned? reuse it (sticky)                  ▼
                    │  4 new: find its group (Hot Lead type x Nature of Business)   outcome + call length
                    │  5 deal from shuffled blocks inside the group                 written to the call log
                    └─ 6 save the assignment, return the version id                        │
                                                                                          ▼
                              daily job: results so far ──> ENGINE ──> harm check, split health, (last day) winner call
                                                                          │
                              decision: promote / hold / stop / keep A ──> production pointer, routing change, decision log
```

## What the bot side provides
1. **Before each call:** call `route(lead_id, lead_variables, experiment)` and load the prompt version it returns. In code: `StratifiedRouter.assign(lead_id, attrs)` (`canary/router.py`) plus `catalog.matches(segment, attrs)` for the segment check. The router is deterministic given the stored assignments, so two servers that share the assignment store agree; the older `hash` mode needs no store at all.
2. **After each call:** write one row to the call log: `lead_id, timestamp, connected, disposition, duration, variant, in_segment`. The engine counts each lead once (its first call) and ignores repeat calls for the decision.
3. **A way to serve a chosen prompt version per call.** On the Sarvam voice-agent platform an agent has draft, committed and deployed versions and a session can pin a version (from the platform documentation; we have **not** tested it, because no voice-agent key was available). If a per-call version is not possible, the fallback is two committed agents (A and B) and the router picks which agent to dial.

## What Canary provides
- `python -m canary decide FILE ...` reads such a call log (CSV, TSV, JSON, daily summaries), checks it, and returns the same record as a simulated run. It advises; it does not change live traffic.
- The production pointer and the 5% holdback are recorded in the decision log (`promotion`, `routing_changed`); making them take effect needs the platform's agent-update API, which we have not verified exists.
- `python -m canary export-db` writes the BRD's data model (experiments, versions, assignments, calls, daily results, decision log) to one SQLite file for audit.

## What must be true for the numbers to mean anything
- The lead ID is stable across a lead's calls (the recordings given to us carry no lead ID: to confirm with the organisers; the fallback in the BRD is the phone number).
- The pre-call variables are available before the call. In the demo they are synthetic (see `canary/catalog.py`); with real data, replace the catalog and nothing else changes.
- Dispositions are tagged the same way under A and B. The bot writes its own disposition, so a prompt that changes the tagging would bias the result: use human-checked dispositions where available (the README lists this as a limitation).
