"""Traffic simulator / replay.

How outcomes are generated (stated on the slide too):
  * Leads arrive at a fixed daily rate; a share of calls are repeat calls from a known lead.
  * Each first call converts with probability true_a (arm A) or true_b (arm B). The difference
    true_b - true_a is the KNOWN effect we inject, so we can check the engine finds it.
  * Call duration is RESAMPLED from the 713 real recordings we were given (header-measured),
    multiplied by dur_mult_b for arm B.
  * log_drop_b models an instrumentation bug: non-converting B calls go missing from the log
    with that probability.
Randomness is pre-drawn per call number, so a run is reproducible from (config, seed).

TrafficSim serves the original single-goal path. HistorySim (below) serves tests launched with a metric list: it replays whole lead outcomes
(attempts, connection, call length, disposition) from the 30-day history, so every metric of the list can be counted from real-shaped call rows.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np

DATA = Path(__file__).resolve().parent.parent / "data"


def real_durations() -> np.ndarray:
    rows = json.loads((DATA / "call_durations.json").read_text())
    return np.array([r["duration_s"] for r in rows], dtype=float)


@dataclass
class Scenario:
    key: str
    title: str
    story: str
    expect: str
    true_a: float
    true_b: float
    seed: int
    dur_mult_b: float = 1.0
    log_drop_b: float = 0.0
    repeat_rate: float = 0.12
    event_a: float = 0.0        # optional rate guardrail (e.g. fatal calls): true rate in arm A ...
    event_b: float = 0.0        # ... and in arm B
    cfg: dict = field(default_factory=dict)


class TrafficSim:
    def __init__(self, sc: Scenario):
        self.sc = sc
        self.durs = real_durations()

    def calls_per_day(self, cfg) -> float:
        return cfg.leads_per_day / (1.0 - self.sc.repeat_rate)

    def calls(self, cfg, design):
        sc = self.sc
        rng = np.random.default_rng(sc.seed)
        m = int(3 * max(design.capacity, cfg.window_days * cfg.leads_per_day) / (1.0 - sc.repeat_rate)) + 2000       # all traffic, not just the segment
        self._u_out = rng.random(m)
        self._dur = rng.choice(self.durs, size=m)
        self._u_drop = rng.random(m)
        u_rep = rng.random(m)
        u_pick = rng.random(m)
        self._u_evt = rng.random(m)       # drawn last, so adding it leaves every earlier stream (and every earlier result) unchanged
        n_leads = 0
        for i in range(m):
            if n_leads > 0 and u_rep[i] < sc.repeat_rate:
                lead = f"L{int(u_pick[i] * n_leads):07d}"
                yield {"i": i, "lead": lead, "repeat": True}
            else:
                lead = f"L{n_leads:07d}"
                n_leads += 1
                yield {"i": i, "lead": lead, "repeat": False}

    def observe(self, arm: str, call: dict):
        sc, i = self.sc, call["i"]
        p = sc.true_a if arm == "A" else sc.true_b
        converted = 1 if self._u_out[i] < p else 0
        dur = float(self._dur[i]) * (sc.dur_mult_b if arm == "B" else 1.0)
        logged = not (arm == "B" and not converted and self._u_drop[i] < sc.log_drop_b)
        return logged, converted, dur

    def event(self, arm: str, call: dict) -> int:
        """1 if this call has the guardrail event (a fatal call, an early hang-up ...). Used only when a rate guardrail is configured."""
        p = self.sc.event_a if arm == "A" else self.sc.event_b
        return 1 if self._u_evt[call["i"]] < p else 0


# ---------------------------------------------------------------------------- replaying the 30-day history (the metrics path)

def _key(defn: dict) -> str:
    return json.dumps(defn, sort_keys=True, separators=(",", ":"))


def outcome_rows(outcome: tuple, factors: dict) -> list:
    """The call rows of one lead: one per attempt (history.lead_calls' columns, without ids). `outcome` = (attempts, call_duration, disposition)."""
    from .history import EARLY_HANGUP_S, NO_CONNECT
    attempts, dur, disp = outcome
    rows = []
    for st in attempts:
        if st == "Answered":
            rows.append({**factors, "call_status": st, "connected": "1", "call_duration": dur, "disposition": disp, "early_hangup": "Yes" if dur < EARLY_HANGUP_S else "No"})
        else:
            rows.append({**factors, "call_status": st, "connected": "0", "call_duration": 0, "disposition": NO_CONNECT, "early_hangup": "No"})
    return rows


@lru_cache(maxsize=1)
def _pool() -> tuple:
    """The history's lead outcomes (not their factors), their own factors (for metric conditions on a factor), and the short answered calls."""
    from . import catalog, history
    L = history.leads()
    outs = tuple((x["attempts"], x["call_duration"], x["disposition"]) for x in L)
    facs = tuple({n: x[n] for n in catalog.PRE_CALL} for x in L)
    shorts = tuple(x["call_duration"] for x in L if x["connected"] and x["call_duration"] < history.EARLY_HANGUP_S)
    return outs, facs, shorts


@lru_cache(maxsize=32)
def _pool_contrib(def_key: str) -> tuple:
    """(numerator, denominator) every history lead adds to a metric."""
    from . import metriclib
    defn = json.loads(def_key)
    outs, facs, _ = _pool()
    pairs = [metriclib.contrib(defn, outcome_rows(o, f)) for o, f in zip(outs, facs)]
    return tuple(p[0] for p in pairs), tuple(p[1] for p in pairs)


def _uses(defn: dict, cols: tuple, where_only: bool = False) -> bool:
    conds = list(defn.get("where") or [])
    for side in ("num", "den"):
        conds += (defn.get(side) or {}).get("where") or []
    return (not where_only and defn.get("col") in cols) or any(c.get("col") in cols for c in conds)


_TRUTH: dict = {}


class HistorySim:
    """Traffic that replays lead outcomes drawn from the 30-day history (canary/history.py): attempts, connection, the answered call's length
    and its disposition. A lead's FACTORS always come from catalog.lead_vars(lead id), as in TrafficSim, so routing and segments are unchanged.
    The call stream (first calls, sticky repeat calls that are not analysed, calls a day) is TrafficSim's; every random number is drawn in
    advance per call number, so a run is reproducible from the seed.

    Effects are injected into B only:
      * effect_rel on the PRIMARY metric, relative: E_B[primary] = R_A x (1 + effect_rel).
          rate: history leads are classed S (counted in the denominator and the numerator), F (denominator only) and N (not in the
                denominator). A draws a lead uniformly. B draws an N lead as often as A does, otherwise S with probability q and F with 1 - q,
                q solved in closed form from the pool means so that the EXPECTED ratio is exactly the target (for call-level rates too).
          average: B's values of the metric's column on the calls it counts are multiplied by (1 + effect_rel).
      * dur_mult_b: B's answered calls are that much longer (early hang-up recomputed).
      * hang_extra (absolute): with that probability a B answered call is replaced by a short one (under the early hang-up cut-off,
        resampled from the history's short answered calls).
    `sc.true_a` / `sc.true_b` are the analytic expectations of the primary in A and B.
    Side effect, stated plainly: a call ends in ONE disposition, so a B with more goal leads has proportionally fewer of every other
    disposition among the leads it counts (for example "B wins +15%" on BuyLead created lowers Callback Fixed by about 12% relative).
    A guardrail or secondary metric built on another disposition will therefore move in B even though only the primary was targeted.
    Limitation: a metric condition on a lead FACTOR is classed on the history lead's own factors, so an effect on such a metric is approximate.
    """

    def __init__(self, primary: dict, effect_rel: float = 0.0, seed: int = 7, dur_mult_b: float = 1.0, hang_extra: float = 0.0, repeat_rate: float = 0.12):
        from .history import EARLY_HANGUP_S
        if not -1 < effect_rel:
            raise ValueError("the simulated effect must be above -100%")
        if not dur_mult_b > 0 or not 0 <= hang_extra < 1:
            raise ValueError("dur_mult must be above 0 and the extra early hang-up share between 0 and 1")
        self.primary, self.effect_rel, self.seed = primary, float(effect_rel), int(seed)
        self.dur_mult_b, self.hang_extra, self.repeat_rate = float(dur_mult_b), float(hang_extra), float(repeat_rate)
        self.early_s = EARLY_HANGUP_S
        self.outs, self.facs, self.shorts = _pool()
        nums, dens = _pool_contrib(_key(primary))
        M = len(self.outs)
        tot_d = sum(dens)
        if tot_d <= 0:
            raise ValueError(f"{primary.get('name', 'the primary metric')}: nothing in the 30-day history is counted in its denominator")
        self.r_a = sum(nums) / tot_d
        self.rate = primary["type"] == "rate"
        self.avg_effect = (not self.rate) and self.effect_rel != 0
        self.b_changes = self.avg_effect or self.dur_mult_b != 1 or self.hang_extra > 0
        target = self.r_a * (1 + self.effect_rel)
        if self.rate:
            self.N = [i for i in range(M) if dens[i] <= 0]
            self.S = [i for i in range(M) if dens[i] > 0 and nums[i] > 0]
            self.F = [i for i in range(M) if dens[i] > 0 and nums[i] <= 0]
            pN = len(self.N) / M
            mean = lambda xs, idx: sum(xs[i] for i in idx) / len(idx) if idx else 0.0
            mnN, mnS, mdS, mdF = mean(nums, self.N), mean(nums, self.S), mean(dens, self.S), mean(dens, self.F)
            a, b, c, d = pN * mnN, (1 - pN) * mnS, (1 - pN) * mdF, (1 - pN) * (mdS - mdF)
            self.pN = pN
            self.q0 = len(self.S) / max(1, len(self.S) + len(self.F))
            if self.effect_rel == 0:
                q = self.q0
            elif not self.S or not self.F or abs(b - target * d) < 1e-15:
                q = float("nan")
            else:
                q = (target * c - a) / (b - target * d)                # (a + q b) / (c + q d) = target
            if not (-1e-12 <= q <= 1 + 1e-12):
                raise ValueError("B's simulated value is out of reach: choose a smaller effect")
            self.q = min(max(q, 0.0), 1.0)
            self._w = {"N": 1 / M, "S": (1 - pN) * self.q / max(1, len(self.S)), "F": (1 - pN) * (1 - self.q) / max(1, len(self.F))}
        true_b = target
        tracked = ("call_duration", "early_hangup")
        if _uses(primary, tracked) and (self.dur_mult_b != 1 or self.hang_extra > 0 or (self.avg_effect and _uses(primary, tracked, where_only=True))):
            true_b = self._expected_b()                                 # the duration changes reach the primary: its exact expectation in B
        from types import SimpleNamespace
        self.sc = SimpleNamespace(key="history", true_a=self.r_a, true_b=true_b, seed=self.seed, effect_rel=self.effect_rel,
                                  dur_mult_b=self.dur_mult_b, hang_extra=self.hang_extra, repeat_rate=self.repeat_rate)

    # ---- B's calls
    def _b_rows(self, outcome: tuple, factors: dict, hang_dur) -> list:
        rows = outcome_rows(outcome, factors)
        if not self.b_changes:
            return rows
        for r in rows:
            if r["call_status"] == "Answered":
                dd = hang_dur if hang_dur is not None else r["call_duration"] * self.dur_mult_b
                r["call_duration"] = dd
                r["early_hangup"] = "Yes" if dd < self.early_s else "No"
        if self.avg_effect:
            from .metriclib import _match
            col, f = self.primary["col"], 1 + self.effect_rel
            for r in rows:
                if _match(self.primary["where"], r):
                    r[col] = r[col] * f
            for r in rows:
                if r["call_status"] == "Answered":
                    r["early_hangup"] = "Yes" if r["call_duration"] < self.early_s else "No"
        return rows

    def _expected_b(self) -> float:
        """E_B[numerator] / E_B[denominator] over B's draw, with the hang-up branch in expectation (every value enters linearly, so the mean
        short call stands for all of them)."""
        key = (_key(self.primary), self.effect_rel, self.dur_mult_b, self.hang_extra)
        if key in _TRUTH:
            return _TRUTH[key]
        from .metriclib import contrib
        nums, dens = _pool_contrib(_key(self.primary))
        M = len(self.outs)
        if self.rate:
            w = [0.0] * M
            for cls in ("N", "S", "F"):
                for i in getattr(self, cls):
                    w[i] = self._w[cls]
        else:
            w = [1 / M] * M
        ms = sum(self.shorts) / len(self.shorts) if self.shorts else 0.0
        en = ed = 0.0
        for i, o in enumerate(self.outs):
            if not w[i]:
                continue
            if o[0][-1] != "Answered":
                n_, d_ = nums[i], dens[i]
            else:
                n_, d_ = contrib(self.primary, self._b_rows(o, self.facs[i], None))
                if self.hang_extra > 0:
                    n1, d1 = contrib(self.primary, self._b_rows(o, self.facs[i], ms))
                    n_, d_ = (1 - self.hang_extra) * n_ + self.hang_extra * n1, (1 - self.hang_extra) * d_ + self.hang_extra * d1
            en += w[i] * n_
            ed += w[i] * d_
        _TRUTH[key] = en / ed if ed else None
        return _TRUTH[key]

    # ---- the engine's interface
    def calls_per_day(self, cfg) -> float:
        return cfg.leads_per_day / (1.0 - self.repeat_rate)

    def calls(self, cfg, design):
        rng = np.random.default_rng(self.seed)
        m = int(3 * max(design.capacity, cfg.window_days * cfg.leads_per_day) / (1.0 - self.repeat_rate)) + 2000       # all traffic, not just the segment
        u_rep = rng.random(m).tolist()
        u_pick = rng.random(m).tolist()
        self._u_idx = rng.random(m).tolist()
        self._u_cls = rng.random(m).tolist()
        self._u_hang = rng.random(m).tolist()
        self._u_short = rng.random(m).tolist()
        n_leads = 0
        r = self.repeat_rate
        for i in range(m):
            if n_leads > 0 and u_rep[i] < r:
                yield {"i": i, "lead": f"L{int(u_pick[i] * n_leads):07d}", "repeat": True}
            else:
                lead = f"L{n_leads:07d}"
                n_leads += 1
                yield {"i": i, "lead": lead, "repeat": False}

    def draw(self, arm: str, i: int) -> int:
        """Which history lead's outcome call number i replays."""
        u = self._u_idx[i]
        if not self.rate:
            return int(u * len(self.outs))
        q = self.q if arm == "B" else self.q0
        v = self._u_cls[i]
        cls = self.N if v < self.pN else self.S if v < self.pN + (1 - self.pN) * q else self.F
        if not cls:
            return int(u * len(self.outs))
        return cls[int(u * len(cls))]

    def observe_rows(self, arm: str, call: dict) -> list:
        """The call rows of the lead's analysed first call: every metric column plus the lead's own factors."""
        i = call["i"]
        o = self.outs[self.draw(arm, i)]
        factors = call.get("attrs") or catalog_lead_vars(call["lead"])
        if arm == "B" and self.b_changes:
            hang = None
            if self.hang_extra > 0 and o[0][-1] == "Answered" and self._u_hang[i] < self.hang_extra and self.shorts:
                hang = self.shorts[int(self._u_short[i] * len(self.shorts))]
            return self._b_rows(o, factors, hang)
        return outcome_rows(o, factors)


def catalog_lead_vars(lead: str) -> dict:
    from .catalog import lead_vars
    return lead_vars(lead)
