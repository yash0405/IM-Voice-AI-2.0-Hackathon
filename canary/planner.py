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
