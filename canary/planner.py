"""Pre-launch planner: can this test finish, and how likely is it to see a real effect?

The dashboard planner is a lookup over this precomputed grid so it works offline and always agrees
with the engine (same code builds the real design).
"""
from __future__ import annotations

import math

from . import seqdesign
from .engine import Config
from .simulator import real_durations
from .stats import norm_cdf

BASELINES = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60]
MDES = [0.02, 0.03, 0.05, 0.07, 0.10]
SHARES = [0.05, 0.10, 0.20, 0.30, 0.50]
FRACTIONS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
K = 40


def plan_one(baseline: float, mde: float, share: float, margin: float = 0.15) -> dict:
    cfg = Config(share_b=share, baseline=baseline, mde=mde, guardrail_margin=margin)
    plan = seqdesign.plan_sample_size(baseline, mde, share, cfg.alpha, cfg.power, K)
    n_max = plan["n_max"]
    cv = float(real_durations().std(ddof=1) / real_durations().mean())
    power_at, guard_at = {}, {}
    for f in FRACTIONS:
        m = max(1, round(K * f))
        ts = [(i + 1) / K for i in range(m - 1)] + [f]
        eff = seqdesign.compute_boundaries(ts, cfg.alpha, "obf", exhaust_last=f < 1)
        power_at[str(f)] = seqdesign.crossing_probability(ts, eff, plan["theta"])
        n = n_max * f
        se = cv * math.sqrt(1 / max(2, share * n) + 1 / max(2, (1 - share) * n))
        guard_at[str(f)] = norm_cdf(margin / se - eff[-1])
    return {"baseline": baseline, "mde": mde, "share": share, "n_max": n_max, "n_fixed": plan["n_fixed"],
            "inflation": plan["inflation"], "n_b_at_max": int(share * n_max), "power_at": power_at,
            "guardrail_proof_at": guard_at}


def grid() -> dict:
    cells = []
    for b in BASELINES:
        for m in MDES:
            if b + m >= 0.95:
                continue
            for s in SHARES:
                cells.append(plan_one(b, m, s))
    return {"baselines": BASELINES, "mdes": MDES, "shares": SHARES, "fractions": FRACTIONS,
            "guardrail_margin": 0.15, "duration_cv": float(real_durations().std(ddof=1) / real_durations().mean()),
            "cells": cells}


def spec_calculator_check(nb_7days: int = 4200, share: float = 0.10, days_for_second: int = 12, alpha: float = 0.05, power: float = 0.80) -> dict:
    """Check the arithmetic of the dashboard spec's calculator example against the standard two-proportion formula.

    The spec says: 'B will get ~4,200 leads in 7 days. It can detect a lift of 1.2 pp or more. To detect 0.8 pp you would need 12 days.'
    Smallest detectable lift scales with 1/sqrt(leads), so the days needed for a smaller lift do not depend on the baseline rate.
    """
    from scipy.stats import norm
    z = norm.ppf(1 - alpha / 2) + norm.ppf(power)
    nA = nb_7days * (1 - share) / share

    def mde(p, nb, na):
        return z * math.sqrt(p * (1 - p) * (1 / nb + 1 / na))

    # which baseline makes the spec's 1.2 pp true?
    lo, hi = 0.001, 0.5
    for _ in range(50):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if mde(mid, nb_7days, nA) < 0.012 else (lo, mid)
    p12 = (lo + hi) / 2
    days_for_08 = 7 * (0.012 / 0.008) ** 2
    mde_12days = 0.012 * math.sqrt(7 / days_for_second)
    return {"b_leads_in_7_days": nb_7days, "baseline_that_gives_1_2pp": round(p12, 4), "mde_at_baseline_45pct_pp": round(mde(0.45, nb_7days, nA) * 100, 2),
            "days_needed_for_0_8pp": round(days_for_08, 1), "mde_after_12_days_pp": round(mde_12days * 100, 2),
            "verdict": (f"The 1.2 pp figure only holds for a baseline near {p12:.1%}; and 0.8 pp needs about {days_for_08:.0f} days, not {days_for_second} "
                        f"({days_for_second} days detects about {mde_12days * 100:.1f} pp), whatever the baseline.")}
