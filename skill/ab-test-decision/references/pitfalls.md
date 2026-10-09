# Pitfalls and how to explain them

Contents: peeking · broken split · counting calls · changing the plan · many metrics · the system labels itself · novelty and timing · simulated data

## Peeking (acting on interim numbers)
Symptom: "day 3, p = 0.03, B is ahead, let's ship." Why it fails: with daily looks a plain test calls a false winner in about 11% of no-difference tests and a false loser in another 11%, so about 1 test in 4 gets a wrong call. Say: "A lead this early is mostly luck. The decision lines for day 3 are much higher than 1.96; B has not crossed them. Keep collecting, or use the engine's daily boundaries." Run `decide.py --through-day 3` to show the actual state.

## A broken split
Symptom: B got 36% of leads when 30% was configured, or call counts differ between the log and the router. Cause: assignment bugs, logging that drops calls only in one arm, filters applied unevenly. Say: "The test did not run the way it was designed, so the comparison cannot be trusted. Fix tracking and rerun." Do not "adjust" for it.

## Counting calls instead of leads
Repeat callers make results look surer. One lead, one count. If there is no lead id, say the interval is too narrow by an unknown amount.

## Changing the plan or the metric after seeing data
Moving the goal definition, the guardrail limit, the window or the baseline after looking lets any result be bent into a win. If they changed it, treat it as a new test and say what changed. The engine records what the goal and guardrail mean and a fingerprint of the files in its record.

## Many metrics at once
If ten metrics are checked and one is "significant", that is expected by chance. Pick one primary goal up front; everything else is a guardrail or is reported, not used to ship.

## The system labels its own outcomes
Some bots set their own disposition (for example approving a lead the moment a product is confirmed). A new prompt can then change how outcomes are recorded rather than what happened. Ask for independent grading of a random sample (a person or a separate model) and report agreement; until then call the result provisional.

## Timing effects
Day-of-week patterns and novelty can skew the first days. Keep at least a full week when the plan allows; do not extrapolate a lift from a short window.

## Simulated or synthetic data
A simulation proves the engine finds a known injected difference; it says nothing about a real prompt. Always label it, and never quote a simulated lift as a result.

## Inconclusive is a result
It means the test could not tell, not that the change is useless. Report how many more leads would settle it, and whether that is practical.
