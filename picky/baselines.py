"""'Typical' approaches we compare against, run on exactly the same simulated data.

naive_peek     - what most dashboards do: check a two-sided z-test (p<0.05) at every look and
                 act the first time it fires (promote on +, stop on -). No correction.
fixed_horizon  - textbook one-look z-test at the planned sample size. Valid, but no early stop,
                 so a harmful B keeps running to the end of the window.
higher_rate    - no test at all: ship B if its observed rate is higher when the window ends.
"""
from __future__ import annotations

from .stats import pooled_z


def naive_peek(c, min_per_arm: int = 50):
    if c.nA < min_per_arm or c.nB < min_per_arm:
        return None
    z = pooled_z(c.xA, c.nA, c.xB, c.nB)
    if z >= 1.96:
        return "PROMOTE"
    if z <= -1.96:
        return "STOP_HARM"
    return None


def fixed_horizon_decision(c):
    return "PROMOTE" if pooled_z(c.xA, c.nA, c.xB, c.nB) >= 1.96 else "NO_SHIP"


def higher_rate_decision(c):
    if c.nA == 0 or c.nB == 0:
        return "NO_SHIP"
    return "PROMOTE" if c.xB / c.nB > c.xA / c.nA else "NO_SHIP"
