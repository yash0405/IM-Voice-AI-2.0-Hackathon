#!/usr/bin/env python3
"""Can this A/B test give a clear answer? Sample size, days needed, and the smallest lift the window can detect.

Standard library only. Single-look normal approximation for two proportions; a test that is checked repeatedly with the sequential
rules needs about 6% more data than this (measured for 40 looks), so the output adds that margin.

Example:
  python plan_test.py --baseline 0.40 --mde 0.03 --share-b 0.5 --per-day 800 --days 14
"""
import argparse
import json
import math
import sys
from statistics import NormalDist

SEQ_MARGIN = 1.06    # extra data a sequentially monitored test needs versus one look at the end (measured, 40 looks)


def n_total(p_a, mde, share_b, alpha, power, direction):
    """Total leads (both arms) to detect p_b = p_a +/- mde with one-sided alpha and the given power."""
    nd = NormalDist()
    p_b = p_a + mde if direction == "higher" else p_a - mde
    z = nd.inv_cdf(1 - alpha) + nd.inv_cdf(power)
    var = p_a * (1 - p_a) / (1 - share_b) + p_b * (1 - p_b) / share_b
    return z * z * var / (mde * mde)


def mde_for(n, p_a, share_b, alpha, power, direction):
    """Smallest lift detectable with n total leads (solved by bisection; the variance depends on the lift)."""
    lo, hi = 1e-5, (1 - p_a - 1e-4) if direction == "higher" else (p_a - 1e-4)
    if hi <= lo:
        return None
    for _ in range(60):
        mid = (lo + hi) / 2
        if n_total(p_a, mid, share_b, alpha, power, direction) > n:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def plan(baseline, mde, share_b, per_day=None, days=None, alpha=0.025, power=0.8, direction="higher"):
    if not 0 < baseline < 1:
        raise ValueError("baseline must be a rate between 0 and 1 (for example 0.40)")
    if not 0 < share_b <= 0.5:
        raise ValueError("share-b is the smaller test slice: between 0 and 0.5")
    if mde <= 0 or (direction == "higher" and baseline + mde >= 1) or (direction == "lower" and baseline - mde <= 0):
        raise ValueError("mde must be a positive lift that keeps the rate between 0 and 1")
    need = n_total(baseline, mde, share_b, alpha, power, direction) * SEQ_MARGIN
    if not per_day:
        return {"leads_needed_total": math.ceil(need), "leads_needed_in_b": math.ceil(need * share_b), "alpha_one_sided": alpha, "power_target": power,
                "assumes": "per-lead counting, one look-equivalent plus a 6% margin for repeated checking"}
    days = days or 14
    have = per_day * days
    days_needed = need / per_day
    achievable = mde_for(have / SEQ_MARGIN, baseline, share_b, alpha, power, direction)
    # power at the planned lift with what the window gives
    nd = NormalDist()
    p_b = baseline + mde if direction == "higher" else baseline - mde
    var = baseline * (1 - baseline) / (1 - share_b) + p_b * (1 - p_b) / share_b
    drift = mde * math.sqrt(have / SEQ_MARGIN / var)
    power_in_window = nd.cdf(drift - nd.inv_cdf(1 - alpha))
    return {"leads_needed_total": math.ceil(need), "leads_needed_in_b": math.ceil(need * share_b), "days_needed": round(days_needed, 1),
            "leads_in_window": int(have), "fits_window": have >= need, "power_at_planned_lift_in_window": round(power_in_window, 3),
            "smallest_lift_window_can_detect": None if achievable is None else round(achievable, 4), "alpha_one_sided": alpha, "power_target": power,
            "assumes": "per-lead counting, one look-equivalent plus a 6% margin for repeated checking"}


def main():
    ap = argparse.ArgumentParser(description=__doc__.replace("%", "%%"), formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--baseline", type=float, required=True, help="expected goal rate under A, e.g. 0.40")
    ap.add_argument("--mde", type=float, required=True, help="smallest lift worth detecting, as a rate difference, e.g. 0.03 = 3 points")
    ap.add_argument("--share-b", type=float, required=True, help="share of traffic sent to B (0 to 0.5), e.g. 0.1")
    ap.add_argument("--per-day", type=float, help="new leads (not calls) per day entering the test; without it only the leads needed are printed")
    ap.add_argument("--days", type=float, help="test length in days (needs --per-day to check the fit)")
    ap.add_argument("--direction", choices=["higher", "lower"], default="higher", help="which way is better for the goal")
    ap.add_argument("--power", type=float, default=0.8)
    ap.add_argument("--alpha", type=float, default=0.025, help="one-sided error budget (0.025 means a 95 percent two-sided test)")
    ap.add_argument("--json", action="store_true", help="print JSON only")
    a = ap.parse_args()
    try:
        r = plan(a.baseline, a.mde, a.share_b, a.per_day, a.days, a.alpha, a.power, a.direction)
    except ValueError as e:
        sys.exit(f"cannot plan: {e}")
    if a.json:
        print(json.dumps(r, indent=1))
        return
    if "fits_window" not in r:
        print(f"A {a.mde * 100:g}-point lift from {a.baseline:.0%} needs about {r['leads_needed_total']:,} leads ({r['leads_needed_in_b']:,} in B). Add --per-day to see how many days that is.")
        return
    ok = "YES" if r["fits_window"] else "NO"
    print(f"Can the {a.days:g}-day window give a clear answer for a {a.mde * 100:g}-point lift from {a.baseline:.0%}?  {ok}")
    print(f"  needs about {r['leads_needed_total']:,} leads ({r['leads_needed_in_b']:,} in B) = {r['days_needed']} days at {a.per_day:g} leads/day; the window has {r['leads_in_window']:,}")
    print(f"  chance of spotting the planned lift in this window: {r['power_at_planned_lift_in_window']:.0%} (target {a.power:.0%})")
    if r["smallest_lift_window_can_detect"] is not None:
        print(f"  smallest lift this window can reliably detect: about {r['smallest_lift_window_can_detect'] * 100:.1f} points")
    if r["fits_window"] and r["days_needed"] > 0.85 * a.days:
        print(f"  thin margin: it needs {r['days_needed']} of {a.days:g} days, so a small drop in volume would break it")
    if not r["fits_window"]:
        print("  options: run longer, send B more traffic (up to 50%), or accept that only a bigger lift can be proven")


if __name__ == "__main__":
    main()
