# Reporting

Contents: the template · rounding · three worked examples · wording to avoid

## Template
```
**Verdict:** <ship / stop / hold / keep A / keep waiting> - <one-line reason>
**Evidence:** A <rate> (n=<leads>) vs B <rate> (n=<leads>); B minus A = <lift> points, range <low> to <high>
**Safety checks:** <split check, guardrails, data notes>
**What this does not tell you:** <simulated or provisional data, short window, anything left out>
**Next step:** <ship with rollback / rerun with N more leads / person approves or rejects>
```

## Answering a planning question
Give the requirement as leads and as days at the stated volume, whether it fits, the chance of spotting the planned lift in the window, and how many leads see the unproven prompt (for example 10% of 11,200 = about 1,100 against 50% = about 5,600). Offer the three fixes: longer, more traffic to B, a bigger lift. Name the assumptions (95% confidence, 80% power, 6% margin for repeated checking, steady volume).

## Rounding
Whole percentages for rates, one decimal for lifts, unless there are tens of thousands of leads. Always a range with a lift. Never more digits than the range supports.

## Worked examples
(Figures are real engine output on the synthetic sample files in `data/samples/`, planned at baseline 45%, 30% to B, 14 days.)

**Ship.** Verdict: ship B - it beat A with every safety check passing. Evidence: A 44% (n=1,431) vs B 51% (n=581); B minus A about +6 points, range +1 to +11. Safety: B got 29% of leads (configured 30%); call length within the limit. Does not tell you: the data is synthetic. Next: ship with a one-click rollback and recheck in a week.

**Hold.** Verdict: hold - B wins, but its calls run about 21% longer and the limit is 15%. Evidence: A 43% vs B 53%; B minus A about +10 points, range +5 to +15. Safety: call length not proven inside the limit (upper end +30%). Next: a person decides whether the extra conversions are worth longer calls; either choice is logged. Nothing changes for callers meanwhile.

**Inconclusive.** Verdict: keep A - no evidence of a difference. Evidence: A 45% vs B 42%; B minus A about -3 points, range -8 to +2. The test had enough leads to detect 7 points, so any real lift is smaller than that; detecting 3.5 points would need about 6,000 more leads (about 3 weeks). Next: decide whether a lift that small matters before waiting.

## Wording to avoid
"Proven", "guaranteed", "will increase conversions by X", "no difference" (for inconclusive), "statistically significant" without saying how many looks were taken, quoting a p-value from an interim look.
