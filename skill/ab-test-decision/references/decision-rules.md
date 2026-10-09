# Decision rules in plain words

Contents: the idea · the outcomes · defaults · two rule sets · guardrails · what is checked before any decision

## The idea
Before the test starts, the plan fixes two lines on a score called z (how many standard errors B is ahead of or behind A):
- a **win line** that is very high early in the test and relaxes to about 2 by the end, and
- a **harm line** that is lower, so a clearly worse B is stopped sooner than a better B is promoted. Losing calls costs more than waiting.

Because the lines are built for repeated looks, checking every day does not inflate false winners: the false-win rate stays near the 2.5% (one-sided) error budget. The price is about 6% more data than a single look at the end would need.

## The outcomes
| Outcome | Rule |
|---|---|
| HALT_SRM | Checked first. The share of leads in B differs from the configured share (p < 0.001), or calls assigned to one arm go missing from the log more than the other. Nothing else is trusted. |
| (waiting) | Fewer than 50 leads in an arm: no decision yet. |
| STOP_HARM | z reaches the harm line. |
| STOP_GUARDRAIL | A guardrail's worsening is clearly beyond its limit (it crosses the harm line). |
| PROMOTE | z reaches the win line and every guardrail is proven inside its limit (upper end of its range under the limit). |
| HOLD_FOR_APPROVAL | z reached the win line but the window ended with a guardrail not proven, or the evidence faded back below the line by the end (it is never shipped on a peak). Also: a guardrail is not proven (range reaches past the limit) or could not be evaluated (missing, unusable or constant values). Also used when approval mode is manual. Callers are unaffected while a person decides. |
| INCONCLUSIVE | The window ended and no line was crossed. Keep A. The result says how many more leads would settle it. |
| CONTINUE | A running test with no line crossed yet, or the win line was crossed but a guardrail is still being proven. The crossing is remembered; the win is only shipped if the evidence is still above the line when the guardrail is proven. |

## Defaults and why
- Error budget 2.5% one-sided (a 95% two-sided test), power 80% for the planned lift.
- Duration guardrail: not more than 15% longer. A 10% limit on a 10% traffic slice is too tight to prove: it would reject real wins by noise alone. Use 10% only with large samples.
- Rate guardrail (early hang-ups, fatal calls): not more than 2 points worse, unless the user gives another limit.
- Each lead counts once, in the arm that served its first call; later calls of the same arm count toward its outcome.

## Two rule sets
- **sequential** (default): may promote or stop at any daily look; good when you want early answers and strong protection from harm.
- **final_look**: one winner call at the end of the window, plus a strict daily harm check (99.9% bar). Simpler to explain, never promotes early, and catches a clearly worse B less often. Measured on identical simulated traffic (14 days, 300 leads a day, 30% to B): a 7-point harm was stopped in 98% of runs by sequential and 89% by final_look; a real +7-point win was promoted at a median of about 3,560 leads versus 4,200. False wins were close to 2.5% for both.

## Before any decision
1. The plan was given up front (baseline, share, window, smallest lift).
2. The split check passed and there is no unexplained loss of calls.
3. Results up to day d use only calls made up to day d, so a test read daily and read all at once gives the same verdict.
4. Leads beyond the planned maximum are not used (to use more data, plan for a smaller lift).
