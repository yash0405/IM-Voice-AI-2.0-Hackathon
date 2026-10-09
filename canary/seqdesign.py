"""Group-sequential design: alpha-spending boundaries, power and sample size.

Why this method: the test has a fixed window and we want to look at the data as often
as we like. Lan-DeMets alpha-spending lets us pay for those looks in advance, so the
overall false-promotion rate stays at alpha no matter how often we peek.

Everything here is a one-sided test on a standardized statistic Z_k observed at
information fractions t_1 < ... < t_K <= 1. Under H0, S_k = Z_k * sqrt(t_k) is a
Brownian motion, so the boundary at look k is found by propagating the density of S
through the continuation region (Armitage-McPherson-Rowe recursive integration).
"""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np
from scipy.signal import fftconvolve
from scipy.stats import norm

GRID_H = 0.004          # grid step on the S scale
GRID_L = 10.0           # S is tracked on [-L, L]


def spend_obf(alpha: float, t: float) -> float:
    """O'Brien-Fleming-type spending: almost nothing early, most of alpha at the end."""
    if t <= 0:
        return 0.0
    if t >= 1:
        return alpha
    return float(2.0 * (1.0 - norm.cdf(norm.ppf(1.0 - alpha / 2.0) / math.sqrt(t))))


def spend_pocock(alpha: float, t: float) -> float:
    """Pocock-type spending: spends alpha more evenly, so it can stop earlier."""
    if t <= 0:
        return 0.0
    if t >= 1:
        return alpha
    return float(alpha * math.log(1.0 + (math.e - 1.0) * t))


SPENDING = {"obf": spend_obf, "pocock": spend_pocock}


def _grid():
    s = np.arange(-GRID_L, GRID_L + GRID_H / 2, GRID_H)
    return s


def _kernel(dt: float, drift: float):
    """Gaussian increment kernel for S over an information gap dt (mean drift*dt)."""
    sd = math.sqrt(dt)
    half = int(math.ceil(8 * sd / GRID_H))
    x = np.arange(-half, half + 1) * GRID_H
    k = norm.pdf(x, loc=drift * dt, scale=sd) * GRID_H
    return k, half


def _propagate(f: np.ndarray, dt: float, drift: float) -> np.ndarray:
    k, half = _kernel(dt, drift)
    out = fftconvolve(f, k, mode="full")
    out = out[half:half + len(f)]
    return np.clip(out, 0.0, None)


def compute_boundaries(ts, alpha: float, spending: str = "obf", exhaust_last: bool = False):
    """Return critical values c_k (on the Z scale) for one-sided looks at fractions ts.

    ts must be increasing and <= 1. The cumulative probability of ever crossing under H0
    equals spend(t_K). With exhaust_last=True the final look spends all remaining alpha,
    which is valid when the end of the window is fixed in advance (it ends at t_K < 1).
    """
    spend = SPENDING[spending]
    s = _grid()
    f = np.zeros_like(s)
    f[len(s) // 2] = 1.0  # point mass at S=0, t=0
    t_prev = 0.0
    spent_prev = 0.0
    bounds = []
    for i, t in enumerate(ts):
        f = _propagate(f, t - t_prev, 0.0)
        last = exhaust_last and i == len(ts) - 1
        target = (alpha if last else spend(alpha, t)) - spent_prev
        # tail mass above b: solve by cumulative sum from the right
        tail = np.cumsum(f[::-1])[::-1]  # tail[i] = P(S >= s[i])
        if target <= 1e-15:
            b = s[-1]
        else:
            idx = int(np.argmax(tail <= target))
            if idx == 0:
                b = s[0]
            else:
                # linear interpolation between idx-1 (tail > target) and idx (tail <= target)
                hi, lo = tail[idx - 1], tail[idx]
                frac = (hi - target) / (hi - lo) if hi > lo else 0.0
                b = s[idx - 1] + frac * GRID_H
        f[s > b] = 0.0
        bounds.append(float(b / math.sqrt(t)))
        spent_prev = alpha if last else spend(alpha, t)
        t_prev = t
    return bounds


def crossing_probability(ts, bounds, drift: float) -> float:
    """P(Z_k >= bounds[k] for some k) when the drift of S is `drift` per unit information."""
    s = _grid()
    f = np.zeros_like(s)
    f[len(s) // 2] = 1.0
    t_prev = 0.0
    total = 0.0
    for t, c in zip(ts, bounds):
        f = _propagate(f, t - t_prev, drift)
        b = c * math.sqrt(t)
        total += float(f[s >= b].sum())
        f[s >= b] = 0.0
        t_prev = t
    return total


def drift_for_power(ts, bounds, power: float = 0.8) -> float:
    """Drift theta (value of E[Z] at t=1) giving the requested power."""
    lo, hi = 0.0, 8.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if crossing_probability(ts, bounds, mid) < power:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


@lru_cache(maxsize=32)
def _design_theta(alpha: float, power: float, looks: int, spending: str):
    ts = [(k + 1) / looks for k in range(looks)]
    bounds = compute_boundaries(ts, alpha, spending)
    return drift_for_power(ts, bounds, power)


def plan_sample_size(p_a: float, mde: float, share_b: float, alpha: float = 0.025,
                     power: float = 0.8, looks: int = 40, spending: str = "obf"):
    """Maximum total calls for a sequential test to detect +mde with the given power.

    Returns dict with n_max (total calls), n_fixed (single-look equivalent), and the drift.
    """
    p_b = min(max(p_a + mde, 1e-6), 1 - 1e-6)
    theta = _design_theta(alpha, power, looks, spending)
    var_unit = p_a * (1 - p_a) / (1 - share_b) + p_b * (1 - p_b) / share_b
    n_max = (theta / abs(mde)) ** 2 * var_unit
    theta_fixed = norm.ppf(1 - alpha) + norm.ppf(power)
    n_fixed = (theta_fixed / abs(mde)) ** 2 * var_unit
    return {"n_max": int(math.ceil(n_max)), "n_fixed": int(math.ceil(n_fixed)),
            "theta": theta, "inflation": float(n_max / n_fixed)}


@lru_cache(maxsize=64)
def cached_boundaries(ts_key: tuple, alpha: float, spending: str):
    return tuple(compute_boundaries(list(ts_key), alpha, spending))
