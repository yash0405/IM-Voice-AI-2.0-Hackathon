"""Small, dependency-free statistics helpers (pure math, hot-path safe)."""
from __future__ import annotations

import math
from statistics import NormalDist

_N = NormalDist()


def norm_cdf(x: float) -> float:
    return 0.5 * math.erfc(-x / math.sqrt(2.0))


def norm_ppf(p: float) -> float:
    return _N.inv_cdf(p)


def pooled_z(x_a: int, n_a: int, x_b: int, n_b: int) -> float:
    """Score z for (rate_B - rate_A) using the pooled variance (well calibrated under H0)."""
    if n_a <= 0 or n_b <= 0:
        return 0.0
    p = (x_a + x_b) / (n_a + n_b)
    var = p * (1 - p) * (1.0 / n_a + 1.0 / n_b)
    if var <= 0:
        return 0.0
    return (x_b / n_b - x_a / n_a) / math.sqrt(var)


def diff_ci(x_a: int, n_a: int, x_b: int, n_b: int, crit: float):
    """Wald interval for rate_B - rate_A at +/- crit standard errors (unpooled)."""
    if n_a <= 0 or n_b <= 0:
        return (float("nan"), float("nan"), float("nan"))
    pa, pb = x_a / n_a, x_b / n_b
    se = math.sqrt(pa * (1 - pa) / n_a + pb * (1 - pb) / n_b)
    d = pb - pa
    return (d, d - crit * se, d + crit * se)


def wilson(x: int, n: int, z: float = 1.96):
    """Wilson score interval for a proportion."""
    if n <= 0:
        return (float("nan"), float("nan"))
    p = x / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0.0, centre - half), min(1.0, centre + half))


def srm_pvalue(n_a: int, n_b: int, share_b: float) -> float:
    """Sample-ratio-mismatch p-value: is the observed B share consistent with the configured one?"""
    n = n_a + n_b
    if n <= 0:
        return 1.0
    sd = math.sqrt(n * share_b * (1 - share_b))
    if sd == 0:
        return 1.0
    z = (n_b - n * share_b) / sd
    return math.erfc(abs(z) / math.sqrt(2.0))


def binom_ci(k: int, n: int, conf: float = 0.95):
    """Exact (Clopper-Pearson) interval via the beta quantile; falls back to Wilson."""
    try:
        from scipy.stats import beta
    except Exception:  # pragma: no cover
        return wilson(k, n)
    a = (1 - conf) / 2
    lo = 0.0 if k == 0 else float(beta.ppf(a, k, n - k + 1))
    hi = 1.0 if k == n else float(beta.ppf(1 - a, k + 1, n - k))
    return (lo, hi)


def ratio_effect(sum_a, sumsq_a, n_a, sum_b, sumsq_b, n_b):
    """Relative change in a mean (B vs A) with a delta-method standard error.

    Returns (r_minus_1, se, mean_a, mean_b). Used for the secondary metric (call duration).
    """
    if n_a < 2 or n_b < 2:
        return (0.0, float("inf"), 0.0, 0.0)
    ma, mb = sum_a / n_a, sum_b / n_b
    va = max(sumsq_a / n_a - ma * ma, 0.0) * n_a / (n_a - 1)
    vb = max(sumsq_b / n_b - mb * mb, 0.0) * n_b / (n_b - 1)
    if ma <= 0 or mb <= 0:
        return (0.0, float("inf"), ma, mb)
    r = mb / ma
    se = r * math.sqrt(vb / (n_b * mb * mb) + va / (n_a * ma * ma))
    return (r - 1.0, se, ma, mb)


def cohen_kappa(a: list, b: list) -> float:
    """Cohen's kappa for two label lists of equal length."""
    n = len(a)
    if n == 0:
        return float("nan")
    labels = sorted(set(a) | set(b))
    po = sum(1 for x, y in zip(a, b) if x == y) / n
    pe = sum((a.count(l) / n) * (b.count(l) / n) for l in labels)
    return 1.0 if pe == 1 else (po - pe) / (1 - pe)


def _restricted_pa(x_a, n_a, x_b, n_b, delta):
    """Maximum-likelihood rate of A when B is constrained to be exactly `delta` higher."""
    lo, hi = max(0.0, -delta) + 1e-12, min(1.0, 1.0 - delta) - 1e-12
    if lo >= hi:
        return None
    for _ in range(45):
        p = (lo + hi) / 2
        g = x_b / (p + delta) - (n_b - x_b) / (1 - p - delta) + x_a / p - (n_a - x_a) / (1 - p)
        if g > 0:
            lo = p
        else:
            hi = p
    return (lo + hi) / 2


def _score_z(x_a, n_a, x_b, n_b, delta):
    pa = _restricted_pa(x_a, n_a, x_b, n_b, delta)
    if pa is None:
        return float("inf") if delta < 0 else float("-inf")
    pb = pa + delta
    var = pa * (1 - pa) / n_a + pb * (1 - pb) / n_b
    return ((x_b / n_b - x_a / n_a) - delta) / math.sqrt(var) if var > 0 else 0.0


def score_diff_ci(x_a, n_a, x_b, n_b, crit):
    """Interval for rate_B - rate_A that inverts the SAME score test the engine decides with.

    delta is outside the interval exactly when |score z(delta)| >= crit, so the interval excludes 0
    precisely when `pooled_z` crosses `crit`; the dashboard can never show an interval that contradicts a decision.
    """
    if n_a <= 0 or n_b <= 0:
        return (float("nan"),) * 3
    d = x_b / n_b - x_a / n_a
    if crit > 25:
        return (d, -1.0, 1.0)
    lo_b, hi_b = -0.999, d
    for _ in range(32):
        m = (lo_b + hi_b) / 2
        if _score_z(x_a, n_a, x_b, n_b, m) > crit:
            lo_b = m
        else:
            hi_b = m
    lower = (lo_b + hi_b) / 2
    lo_b, hi_b = d, 0.999
    for _ in range(32):
        m = (lo_b + hi_b) / 2
        if _score_z(x_a, n_a, x_b, n_b, m) < -crit:
            hi_b = m
        else:
            lo_b = m
    upper = (lo_b + hi_b) / 2
    return (d, lower, upper)


def loss_pvalue(assigned_a: int, logged_a: int, assigned_b: int, logged_b: int) -> float:
    """Logging-completeness check: do calls assigned to B go missing from the log at a different rate than A?

    The router knows exactly how many first calls it assigned to each arm, so this is far more sensitive than
    comparing logged counts alone (which can only see the loss as a small change in the split).
    """
    if assigned_a <= 0 or assigned_b <= 0:
        return 1.0
    la, lb = assigned_a - logged_a, assigned_b - logged_b
    p = (la + lb) / (assigned_a + assigned_b)
    var = p * (1 - p) * (1.0 / assigned_a + 1.0 / assigned_b)
    if var <= 0:
        return 1.0
    z = (lb / assigned_b - la / assigned_a) / math.sqrt(var)
    return math.erfc(abs(z) / math.sqrt(2.0))
