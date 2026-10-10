"""Statistics for the live listening test: a handful of real calls, judged by exact tests.

The simulator and results-file engine need hundreds or thousands of calls and use sequential z-type tests. A live demo has 10 to 50
calls per prompt, where those approximations are not safe, so this module uses the exact version:

  * Fisher's exact test for "is B's good-call rate different from A's" (never exceeds the error rate you set, at any sample size);
  * the same score interval the engine shows (stats.score_diff_ci). It excludes 0 exactly when the pooled score test crosses the
    bar, so a win has to pass BOTH tests and the shown range can never contradict the verdict (disagreement is called "borderline");
  * a pre-test table that enumerates every possible outcome, so the number of calls is chosen knowing what it can and cannot detect,
    and the chance of a false win when the prompts are identical is computed, not assumed.

Nothing here is random: every number is an exact sum over the binomial outcomes, re-runnable by anyone.
"""
from __future__ import annotations

import math
from functools import lru_cache
from statistics import median

from scipy import stats as sps

from .stats import norm_ppf, pooled_z, score_diff_ci

MAX_EXACT_N = 60                       # exact enumeration cap per arm: (n+1)^2 tables, a few seconds at most


def fisher_p(x_a: int, n_a: int, x_b: int, n_b: int) -> float:
    """Two-sided Fisher exact p-value: the chance of a gap at least this large by luck alone if the prompts were truly equal."""
    if n_a <= 0 or n_b <= 0:
        return 1.0
    return float(sps.fisher_exact([[x_a, n_a - x_a], [x_b, n_b - x_b]], alternative="two-sided")[1])


def crit_for(alpha: float) -> float:
    return norm_ppf(1 - alpha / 2)


def call_for_counts(x_a: int, n_a: int, x_b: int, n_b: int, alpha: float) -> str:
    """b_better | a_better | borderline | no_difference. A win needs the exact test AND the score test to agree."""
    if n_a <= 0 or n_b <= 0:
        return "no_difference"
    p = fisher_p(x_a, n_a, x_b, n_b)
    z = pooled_z(x_a, n_a, x_b, n_b)
    exact_sig, score_sig = p < alpha, abs(z) >= crit_for(alpha)
    d = x_b / n_b - x_a / n_a
    if exact_sig and score_sig and d != 0:
        return "b_better" if d > 0 else "a_better"
    if exact_sig or score_sig:
        return "borderline"
    return "no_difference"


@lru_cache(maxsize=64)
def _region(n_a: int, n_b: int, alpha: float) -> tuple:
    """Verdict for every possible outcome (x_a, x_b): +1 B wins, -1 A wins, 0 no call. Exact, cached."""
    out = []
    for xa in range(n_a + 1):
        row = []
        for xb in range(n_b + 1):
            c = call_for_counts(xa, n_a, xb, n_b, alpha)
            row.append(1 if c == "b_better" else -1 if c == "a_better" else 0)
        out.append(tuple(row))
    return tuple(out)


def _pmf(n: int, p: float) -> list[float]:
    return [float(sps.binom.pmf(k, n, p)) for k in range(n + 1)]


def chance_of_call(n_a: int, n_b: int, p_a: float, p_b: float, alpha: float) -> dict:
    """Exact probabilities of each call for TRUE rates p_a and p_b. Needs n <= MAX_EXACT_N per arm."""
    if max(n_a, n_b) > MAX_EXACT_N:
        raise ValueError(f"exact enumeration is limited to {MAX_EXACT_N} calls per prompt")
    reg, pa, pb = _region(n_a, n_b, alpha), _pmf(n_a, p_a), _pmf(n_b, p_b)
    b_win = a_win = 0.0
    for xa in range(n_a + 1):
        for xb in range(n_b + 1):
            v = reg[xa][xb]
            if v:
                w = pa[xa] * pb[xb]
                if v > 0:
                    b_win += w
                else:
                    a_win += w
    return {"b_wins": b_win, "a_wins": a_win, "no_call": max(0.0, 1 - b_win - a_win)}


def _normal_power(n: int, p_a: float, p_b: float, alpha: float) -> float:
    """Large-sample power (used above the exact cap); slightly optimistic, so callers say 'about'."""
    se = math.sqrt(p_a * (1 - p_a) / n + p_b * (1 - p_b) / n)
    if se == 0:
        return 0.0
    z = abs(p_b - p_a) / se
    c = crit_for(alpha)
    return float(sps.norm.cdf(z - c) + sps.norm.cdf(-z - c))


def power(n: int, p_a: float, p_b: float, alpha: float) -> float:
    if n <= MAX_EXACT_N:
        r = chance_of_call(n, n, p_a, p_b, alpha)
        return r["b_wins"] if p_b > p_a else r["a_wins"]
    return _normal_power(n, p_a, p_b, alpha)


def detectable_gap(n: int, alpha: float, centre: float = 0.5, target: float = 0.8) -> float | None:
    """Smallest real gap (in rate, e.g. 0.4 = 40 points) that B wins `target` of the time, with rates centred on `centre`
    (A = centre - gap/2, B = centre + gap/2). None if even a gap of 90 points is not enough."""
    for g in [i / 100 for i in range(5, 91)]:
        lo, hi = centre - g / 2, centre + g / 2
        if lo < 0.01:
            lo, hi = 0.01, 0.01 + g
        if hi > 0.99:
            lo, hi = 0.99 - g, 0.99
        if power(n, lo, hi, alpha) >= target:
            return g
    return None


def false_win_rate(n: int, alpha: float, rates=(0.2, 0.35, 0.5, 0.65, 0.8)) -> dict:
    """If the prompts are truly identical, how often does the rule still call a winner? Worst case over several common rates."""
    worst = {"rate": None, "wrong_call": 0.0, "b_wins": 0.0}
    for p in rates:
        if n <= MAX_EXACT_N:
            r = chance_of_call(n, n, p, p, alpha)
            wrong, bw = r["b_wins"] + r["a_wins"], r["b_wins"]
        else:
            wrong, bw = alpha, alpha / 2
        if wrong > worst["wrong_call"]:
            worst = {"rate": p, "wrong_call": wrong, "b_wins": bw}
    return worst


def plan_table(counts=(5, 8, 10, 15, 20, 30, 40, 50), alpha: float = 0.10) -> list[dict]:
    """What each choice of 'calls per prompt' can and cannot do, for the setup screen."""
    rows = []
    for n in counts:
        g = detectable_gap(n, alpha)
        fw = false_win_rate(n, alpha)
        rows.append({"n": n, "total": 2 * n, "detectable_gap": g, "false_win": fw["b_wins"], "false_call": fw["wrong_call"]})
    return rows


def more_calls(x_a: int, n_a: int, x_b: int, n_b: int, alpha: float, target: float = 0.8, cap: int = 400) -> int | None:
    """About how many calls PER PROMPT a new test would need to confirm a gap like the one seen, with `target` chance of catching it.

    Rates are pulled half a call toward the middle first, so 0 of 3 or 3 of 3 does not look like a certain 0% or 100%. Small tests are
    searched with the exact power (the same rule that decides the verdict), larger ones with the large-sample formula (then 'about').
    Always more than the current test had; None if the gap seen is under 5 points (too small to matter)."""
    pa, pb = (x_a + 0.5) / (n_a + 1), (x_b + 0.5) / (n_b + 1)
    g = abs(pb - pa)
    if g < 0.05:
        return None
    need = (crit_for(alpha) + norm_ppf(target)) ** 2 * (pa * (1 - pa) + pb * (1 - pb)) / (g * g)
    n = max(int(math.ceil(need)), max(n_a, n_b) + 1, 3)
    while n <= MAX_EXACT_N and power(n, min(pa, pb), max(pa, pb), alpha) < target:
        n = int(math.ceil(n * 1.15)) + 1
    return min(n, cap)


def summarise(calls: list[dict], arm: str) -> dict:
    """Counts for one prompt from its finished calls (each with good, fatal, duration_s)."""
    rows = [c for c in calls if c.get("arm") == arm and c.get("status") == "done"]
    n = len(rows)
    durs = [float(c["duration_s"]) for c in rows if c.get("duration_s") is not None]
    return {"arm": arm, "n": n, "good": sum(1 for c in rows if c.get("good")), "fatal": sum(1 for c in rows if c.get("fatal")),
            "median_s": round(median(durs), 1) if durs else None, "mean_s": round(sum(durs) / len(durs), 1) if durs else None}


def judge(a: dict, b: dict, alpha: float, duration_margin: float = 0.15, fatal_margin: float = 0.15) -> dict:
    """The release decision from the two arms' counts (a and b are `summarise` outputs). Pure function of its inputs."""
    n_a, n_b, x_a, x_b = a["n"], b["n"], a["good"], b["good"]
    d, lo, hi = score_diff_ci(x_a, n_a, x_b, n_b, crit_for(alpha))
    p = fisher_p(x_a, n_a, x_b, n_b)
    call = call_for_counts(x_a, n_a, x_b, n_b, alpha)

    guards = []
    if a["median_s"] and b["median_s"]:
        ratio = b["median_s"] / a["median_s"] - 1
        guards.append({"key": "duration", "name": "Call length", "limit": f"B's typical call no more than {duration_margin:.0%} longer than A's",
                       "value": f"{ratio:+.0%}", "breach": ratio > duration_margin})
    fa, fb = (a["fatal"] / n_a if n_a else 0.0), (b["fatal"] / n_b if n_b else 0.0)
    guards.append({"key": "fatal", "name": "Fatal problems", "limit": f"B's fatal-problem rate no more than {fatal_margin:.0%} points above A's (and at least 2 more calls)",
                   "value": f"{(fb - fa) * 100:+.0f} points ({b['fatal']} vs {a['fatal']} fatal calls)", "breach": (fb - fa) >= fatal_margin and (b["fatal"] - a["fatal"]) >= 2})
    breached = [g for g in guards if g["breach"]]

    if call == "a_better":
        verdict = "STOP_HARM"
    elif call == "b_better":
        verdict = "HOLD_FOR_APPROVAL" if breached else "PROMOTE"
    else:
        verdict = "INCONCLUSIVE"
    more = None
    if verdict == "INCONCLUSIVE" and n_a and n_b:
        more = more_calls(x_a, n_a, x_b, n_b, alpha)
    return {"verdict": verdict, "call": call, "alpha": alpha, "p_value": p, "diff": d, "lo": lo, "hi": hi,
            "rate_a": x_a / n_a if n_a else None, "rate_b": x_b / n_b if n_b else None,
            "guards": guards, "guard_breached": [g["key"] for g in breached], "more_calls_per_prompt": more,
            "a": a, "b": b}
