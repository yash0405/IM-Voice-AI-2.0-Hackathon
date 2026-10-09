"""The A/B engine: config, design, decision rules and the end-to-end experiment runner.

`Monitor.look` is the single decision function. The live runner, the scenario demos and the
Monte Carlo proof lab all call it, so what we prove is exactly what ships.
"""
from __future__ import annotations

import hashlib
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta

from . import catalog, seqdesign
from .ledger import Ledger, canonical, verify
from .router import Router, StratifiedRouter
from .stats import loss_pvalue, norm_cdf, pooled_z, ratio_effect, score_diff_ci, srm_pvalue
from .variants import describe_pair, load_base

# ---------------------------------------------------------------------------- config


@dataclass
class Config:
    exp_id: str = "exp-001"
    name: str = "Make the ask limits agree with each other"
    agent: str = "VANI BuyLead qualification agent"
    variant_b: str = "reconcile_limits"
    share_b: float = 0.10
    assignment: str = "balanced"        # balanced | hash | stratified (the BRD's router: shuffled blocks inside each Hot Lead type x Nature of Business group)
    salt: str = "s1"
    start: str = "2026-10-12T09:00:00"
    window_days: int = 14
    leads_per_day: int = 600
    # primary goal (a disposition) and what counts as better
    primary_goal: str = "buylead_created"
    primary_direction: str = "higher"   # higher | lower
    baseline: float = 0.45              # planning assumption for the primary rate (stated benchmark 35-60%)
    mde: float = 0.07                   # smallest absolute lift worth detecting
    # secondary metric: guardrail (can veto) or goal (reported only)
    secondary_metric: str = "duration_s"   # average handling time
    secondary_role: str = "guardrail"   # guardrail | goal | none
    secondary_worse_when: str = "higher"  # which direction hurts: higher | lower
    guardrail_margin: float = 0.15      # relative worsening tolerated
    # statistics
    alpha: float = 0.025                # one-sided = 95% two-sided confidence
    alpha_harm: float = 0.025
    power: float = 0.80
    n_looks: int = 40
    min_per_arm: int = 50
    srm_alpha: float = 0.001
    srm_min_n: int = 300
    loss_check: bool = True             # also compare assigned vs logged calls per arm
    approval: str = "auto"              # auto | manual
    # decision rule set: "sequential" = early promote and early stop on alpha-spending boundaries (default);
    # "final_look" = ONE winner call at the end of the window plus a strict daily harm check (the dashboard spec's rule)
    rule_set: str = "sequential"
    alpha_harm_daily: float = 0.001     # final_look only: one-sided error budget of each daily harm check (99.9%)
    # optional second guardrail on a RATE (for example the share of fatal calls or early hang-ups)
    guard_rate: str = ""                # name of the event ("" = none)
    guard_rate_margin: float = 0.02     # tolerated absolute worsening (0.02 = 2 percentage points)
    guard_rate_worse_when: str = "higher"
    # versioning: the config is locked when the test starts; any change is a new version that points at its parent
    version: int = 1
    parent_hash: str = ""
    # what the goal and the guardrails MEAN (which dispositions count, which column, what threshold): part of the locked config
    goal_definition: str = ""
    guard_definition: str = ""
    # audience: None = every lead (a neutral test). Otherwise a list of rules [{"factor", "column", "values"}] on pre-call factors only (catalog.py;
    # the earlier {"rules": [{"var", "values"}]} form is still read). `leads_per_day` is ALL traffic; the leads that match the segment are `eligible_per_day`.
    segment: list | dict | None = None
    # after a promotion a small slice stays on the old prompt for a while, to confirm the gain holds (the BRD's 5% for 7 days)
    holdback_share: float = 0.05
    holdback_days: int = 7
    # ---- the metrics path (tests launched from the New Experiment wizard). None = the original single-goal path above.
    # [{"role": "primary" | "guardrail" | "secondary", "def": <metriclib definition>, "limit": {"value", "kind": "rel" | "pts"} | None}]
    # One primary decides; guardrails can stop or hold B; secondary metrics are reported only. When set, primary_goal / primary_direction /
    # primary_type follow the primary and the original guardrail fields are off.
    metrics: list | None = None
    primary_type: str = "rate"          # rate | average (of the primary)
    primary_sd: float = 0.0             # averages only: standard deviation of one unit (one call or one lead) on the last 30 days
    primary_units_per_lead: float = 1.0  # units the primary's denominator counts per analysed lead (connected leads, calls ...), from the 30-day history
    variant_a: str = ""                 # "" = the production prompt in data/; else the key of the live prompt A pasted in the wizard (variants.RUNTIME)

    def __post_init__(self):
        if self.metrics:
            prim = [m for m in self.metrics if isinstance(m, dict) and m.get("role") == "primary" and isinstance(m.get("def"), dict)]
            if len(prim) == 1:
                p = prim[0]["def"]
                self.primary_goal = str(p.get("key", self.primary_goal))
                self.primary_direction = p.get("direction", self.primary_direction)
                self.primary_type = p.get("type", self.primary_type)
                self.secondary_role = "none"
                self.guard_rate = ""

    def as_dict(self):
        d = asdict(self)
        if self.metrics is None:                   # the original path: the fields added for the metric list are left out while they hold their default,
            for k, v in _LATER_DEFAULTS.items():   # so every earlier config (and its registered hash) stays exactly as it was
                if k in d and d[k] == v:
                    d.pop(k)
        return d

    @property
    def eligible_per_day(self) -> float:
        return self.leads_per_day * catalog.segment_share(self.segment)

    def hash(self) -> str:
        return hashlib.sha256(canonical(self.as_dict()).encode()).hexdigest()[:12]

    def new_version(self, **changes) -> "Config":
        """A locked config is never edited. A change is a NEW version that points at the one it came from."""
        return Config(**{**self.as_dict(), **changes, "version": self.version + 1, "parent_hash": self.hash()}).validate()

    def validate(self):
        errs = []
        if not 0 < self.share_b <= 0.5:
            errs.append("share_b must be between 0 and 0.5 (the test slice is the smaller share)")
        if self.metrics is not None:
            errs += check_metrics(self.metrics)
        if self.primary_type not in ("rate", "average"):
            errs.append("primary_type must be rate or average")
        if self.primary_type == "average":
            if not self.baseline > 0:
                errs.append("the primary's current average (baseline) must be above 0")
            if not self.mde > 0:
                errs.append("the improvement to detect must be above 0 (in the metric's own units)")
            if not self.primary_sd > 0:
                errs.append("the primary's spread (primary_sd) must be above 0: it comes from the last 30 days of data")
        else:
            if not 0 < self.baseline < 1 or not 0 < self.mde < 1:
                errs.append("baseline and mde must be probabilities")
            if self.primary_direction == "higher" and self.baseline + self.mde >= 1:
                errs.append("baseline + mde must stay below 1")
        if not self.primary_units_per_lead > 0:
            errs.append("primary_units_per_lead must be above 0")
        if self.assignment in ("balanced", "stratified") and abs(self.share_b * 100 - round(self.share_b * 100)) > 1e-6:
            errs.append("the B share must be a whole percent when leads are dealt in blocks (a block cannot hold a fraction of a lead); use the hash assignment for other shares")
        if self.assignment not in ("balanced", "hash", "stratified"):
            errs.append("assignment must be balanced, hash or stratified")
        if self.segment:
            try:
                catalog.validate_segment(self.segment)
            except ValueError as e:
                errs.append(str(e))
            if self.assignment != "stratified":
                errs.append("a segmented test needs assignment 'stratified' (the router has to read the lead's variables)")
        if self.secondary_role not in ("guardrail", "goal", "none"):
            errs.append("secondary_role must be guardrail, goal or none")
        if self.approval not in ("auto", "manual"):
            errs.append("approval must be auto or manual")
        if self.primary_direction not in ("higher", "lower"):
            errs.append("primary_direction must be higher or lower")
        if self.secondary_worse_when not in ("higher", "lower"):
            errs.append("secondary_worse_when must be higher or lower")
        if self.primary_direction == "lower" and self.baseline - self.mde <= 0:
            errs.append("baseline minus mde must stay above 0 when lower is better")
        if self.window_days < 1 or self.leads_per_day < 1:
            errs.append("window_days and leads_per_day must be at least 1")
        try:
            datetime.fromisoformat(self.start)
        except (TypeError, ValueError):
            errs.append("start must be an ISO date-time such as 2026-10-12T09:00:00")
        if self.rule_set not in ("sequential", "final_look"):
            errs.append("rule_set must be sequential or final_look")
        if self.guard_rate_worse_when not in ("higher", "lower"):
            errs.append("guard_rate_worse_when must be higher or lower")
        if not 0 <= self.holdback_share < 0.5 or self.holdback_days < 0:
            errs.append("holdback_share must be between 0 and 50% and holdback_days must not be negative")
        if self.guard_rate and not 0 < self.guard_rate_margin < 1:
            errs.append("guard_rate_margin must be a fraction between 0 and 1")
        if errs:
            raise ValueError("; ".join(errs))
        return self


_LATER_DEFAULTS = {"metrics": None, "primary_type": "rate", "primary_sd": 0.0, "primary_units_per_lead": 1.0, "variant_a": ""}
ROLES = ("primary", "guardrail", "secondary")
MAX_GUARDRAILS, MAX_SECONDARY = 3, 5


def check_metrics(metrics) -> list:
    """Plain messages for a locked metric list that cannot be run (empty list = fine)."""
    if not isinstance(metrics, list) or not metrics:
        return ["metrics must be a list with one primary metric"]
    errs = []
    roles = [m.get("role") if isinstance(m, dict) else None for m in metrics]
    if any(r not in ROLES for r in roles):
        errs.append("each metric's role must be primary, guardrail or secondary")
    if roles.count("primary") != 1:
        errs.append("choose exactly one primary metric (it decides the test)")
    if roles.count("guardrail") > MAX_GUARDRAILS:
        errs.append(f"at most {MAX_GUARDRAILS} guardrails")
    if roles.count("secondary") > MAX_SECONDARY:
        errs.append(f"at most {MAX_SECONDARY} secondary metrics")
    keys = []
    for m in metrics:
        if not isinstance(m, dict):
            continue
        d = m.get("def")
        if not isinstance(d, dict) or not d.get("key") or not d.get("name"):
            errs.append("each metric needs a definition with a key and a name")
            continue
        keys.append(d["key"])
        if d.get("type") not in ("rate", "average"):
            errs.append(f"{d['name']}: the type must be rate or average")
        elif d["type"] == "rate" and not (isinstance(d.get("num"), dict) and isinstance(d.get("den"), dict)):
            errs.append(f"{d['name']}: a rate needs a numerator and a denominator")
        elif d["type"] == "average" and not d.get("col"):
            errs.append(f"{d['name']}: an average needs a column")
        if d.get("direction") not in ("higher", "lower"):
            errs.append(f"{d['name']}: direction must be higher or lower")
        lim = m.get("limit")
        if m.get("role") == "guardrail":
            if not isinstance(lim, dict) or lim.get("kind") not in ("rel", "pts"):
                errs.append(f"guardrail {d['name']}: set a limit, relative (%) or absolute (points or the metric's units)")
            else:
                try:
                    v = float(lim.get("value"))
                except (TypeError, ValueError):
                    v = float("nan")
                if not (v > 0 and math.isfinite(v)):
                    errs.append(f"guardrail {d['name']}: the limit must be above 0")
    if len(set(keys)) != len(keys):
        errs.append("a metric is used twice: each metric can have one role only")
    return errs


def metric_unit(defn: dict) -> str:
    """The unit an average is in (the column's unit in the data, e.g. 's'); '' for rates and unit-less columns."""
    if defn.get("type") != "average":
        return ""
    from . import history
    return history.COL.get(defn.get("col"), {}).get("unit", "")


# ---------------------------------------------------------------------------- design


@dataclass
class Design:
    n_max: int
    look_every: int
    capacity: int
    look_n: list           # analysed calls at each look
    ts: list               # information fractions
    eff: list              # efficacy critical values (Z scale); NEVER_Z means "cannot promote at this look"
    harm: list             # harm critical values (Z scale)
    theta: float
    inflation: float
    n_fixed: int
    power_in_window: float
    will_finish: bool
    duration_cv: float = 0.0
    guardrail_proof_prob: float = 1.0
    rule_set: str = "sequential"
    harm_g: list | None = None   # bar for a guardrail breach at each look (None = same as `harm`); the one-look rule keeps it strict on the last day too

    def summary(self) -> dict:
        d = {k: v for k, v in self.__dict__.items()}
        return d


FINAL_FLOOR = 50   # one-look rule: fewest leads per arm for which the end-of-test call is made at all
NEVER_Z = 99.0     # a boundary this high can never be crossed: used where a rule set does not allow a promotion yet


def primary_plan(cfg: Config, mde: float | None = None) -> dict:
    """Sample size for the primary (total over both arms): n_fixed (one look), n_max (the sequential rule's horizon), theta and the inflation.

    Rate: the existing two-proportion planning (seqdesign), baseline and mde absolute. Average: n_fixed = (z_a + z_b)^2 sd^2 (1/s + 1/(1-s)) / mde^2,
    and n_max = n_fixed x the same inflation the sequential boundaries need for a rate ((theta / theta_fixed)^2).
    On the metrics path the plan counts the primary's own units (connected leads, answered calls ...); it is turned into analysed leads with
    `primary_units_per_lead` (1.0 on the original path, so nothing changes there)."""
    mde = cfg.mde if mde is None else mde
    sign = 1 if cfg.primary_direction == "higher" else -1
    if cfg.primary_type == "average":
        theta = seqdesign._design_theta(cfg.alpha, cfg.power, cfg.n_looks, "obf")
        theta_fixed = float(seqdesign.norm.ppf(1 - cfg.alpha) + seqdesign.norm.ppf(cfg.power))
        s = cfg.share_b
        n_fixed = theta_fixed ** 2 * cfg.primary_sd ** 2 * (1 / s + 1 / (1 - s)) / mde ** 2
        infl = (theta / theta_fixed) ** 2
        plan = {"n_fixed": n_fixed, "n_max": n_fixed * infl, "theta": theta, "inflation": infl}
    else:
        plan = dict(seqdesign.plan_sample_size(cfg.baseline, sign * mde, cfg.share_b, cfg.alpha, cfg.power, cfg.n_looks))
        if not cfg.metrics:
            return plan
    u = cfg.primary_units_per_lead
    plan["n_fixed"] = int(math.ceil(plan["n_fixed"] / u))
    plan["n_max"] = int(math.ceil(plan["n_max"] / u))
    return plan


def build_design(cfg: Config, look_n: list | None = None, planned_final: int | None = None, n_horizon: int | None = None) -> Design:
    """The pre-registered design. `look_n` lets a results-file run use the real look times (end of each day) instead of
    equally spaced ones; the alpha-spending boundaries are recomputed for exactly those times. `n_horizon` replaces the planned maximum
    (used when a results file holds more leads than the plan asked for)."""
    cfg.validate()
    plan = primary_plan(cfg)
    elig = cfg.eligible_per_day
    capacity = planned_final or int(round(cfg.window_days * elig))
    if cfg.rule_set == "final_look":
        # one winner call at the end of the window (day `window_days`); a strict harm check at every look in between
        final_n = capacity
        if look_n is None:
            look_n = [max(1, round(elig * (k + 1))) for k in range(cfg.window_days)]
            look_n[-1] = final_n
        look_n = [n for n in look_n if n < final_n] + [final_n]
        K = len(look_n)
        ts = [n / final_n for n in look_n]
        eff = [NEVER_Z] * (K - 1) + [float(seqdesign.norm.ppf(1 - cfg.alpha))]
        harm = [float(seqdesign.norm.ppf(1 - cfg.alpha_harm_daily))] * K
        harm_g = list(harm)
        harm[-1] = float(seqdesign.norm.ppf(1 - cfg.alpha))     # the end-of-test call is two-sided: a B significantly WORSE at 95% is kept out and logged as a loss
        theta = (seqdesign.norm.ppf(1 - cfg.alpha) + seqdesign.norm.ppf(cfg.power)) * math.sqrt(final_n / plan["n_fixed"])
        power_in_window = float(norm_cdf(theta - eff[-1]))
        n_max, look_every, inflation, will_finish = final_n, max(1, round(final_n / K)), 1.0, final_n >= plan["n_fixed"]
        theta = float(theta)
    else:
        harm_g = None
        n_max = n_horizon or plan["n_max"]
        look_every = max(1, math.ceil(n_max / cfg.n_looks))
        final_n = min(n_max, capacity)
        if look_n is None:
            look_n = []
            k = 1
            while k * look_every < final_n:
                look_n.append(k * look_every)
                k += 1
        look_n = [n for n in look_n if n < final_n] + [final_n]
        ts = [n / n_max for n in look_n]
        truncated = final_n < n_max
        eff = seqdesign.compute_boundaries(ts, cfg.alpha, "obf", exhaust_last=truncated)
        harm = seqdesign.compute_boundaries(ts, cfg.alpha_harm, "pocock", exhaust_last=truncated)
        power_in_window = seqdesign.crossing_probability(ts, eff, plan["theta"])
        theta, inflation, will_finish = plan["theta"], float(plan["n_max"] / plan["n_fixed"]), not truncated
    # on the metrics path the guardrails come from the metric list; there is no planned proof probability for them (1.0, as for no guardrail)
    # how likely is the guardrail to be PROVEN non-inferior at the last look if B changes nothing?
    cv, gp = 0.0, 1.0
    if cfg.secondary_role == "guardrail":
        from .simulator import real_durations
        dd = real_durations()
        cv = float(dd.std(ddof=1) / dd.mean())
        n_b = max(2.0, cfg.share_b * final_n)
        se = cv * math.sqrt(1.0 / n_b + 1.0 / max(2.0, final_n - n_b))
        gp = float(norm_cdf(cfg.guardrail_margin / se - eff[-1]))
    return Design(n_max=n_max, look_every=look_every, capacity=capacity, look_n=look_n, ts=ts,
                  eff=eff, harm=harm, theta=theta, inflation=inflation,
                  n_fixed=plan["n_fixed"], power_in_window=power_in_window, will_finish=will_finish,
                  duration_cv=cv, guardrail_proof_prob=gp, rule_set=cfg.rule_set, harm_g=harm_g)


# ---------------------------------------------------------------------------- monitor


class Counts:
    __slots__ = ("nA", "xA", "nB", "xB", "sA", "qA", "sB", "qB", "aA", "aB", "gA", "gB", "acc")

    def __init__(self):
        self.nA = self.xA = self.nB = self.xB = 0
        self.sA = self.qA = self.sB = self.qB = 0.0
        self.aA = self.aB = 0   # assigned first calls (before any logging loss)
        self.gA = self.gB = 0   # events of the optional rate guardrail (e.g. fatal calls) among analysed calls
        self.acc = None         # metrics path: {"A": [metriclib.Acc per metric], "B": [...]}, in the order of cfg.metrics


TERMINAL = {"PROMOTE", "STOP_HARM", "STOP_GUARDRAIL", "HALT_SRM", "INCONCLUSIVE", "HOLD_FOR_APPROVAL"}


def rate_guard(cfg: Config, c: Counts, ce: float):
    """Worsening of a rate guardrail (B minus A, absolute) with a Wald standard error.

    Variances use (x+0.5)/(n+1) so that a rate of exactly 0 in both arms does not look like a proof of safety.
    """
    if not cfg.guard_rate or c.nA < 2 or c.nB < 2:
        return None
    pa, pb = c.gA / c.nA, c.gB / c.nB
    qa, qb = (c.gA + 0.5) / (c.nA + 1), (c.gB + 0.5) / (c.nB + 1)
    se = math.sqrt(qa * (1 - qa) / c.nA + qb * (1 - qb) / c.nB)
    diff = pb - pa
    worse = diff if cfg.guard_rate_worse_when == "higher" else -diff
    return {"name": cfg.guard_rate, "rate_a": pa, "rate_b": pb, "worse": worse, "se": se, "margin": cfg.guard_rate_margin,
            "z_breach": (worse - cfg.guard_rate_margin) / se, "upper": worse + ce * se, "lower": worse - ce * se}


class Monitor:
    """Evaluates the pre-registered decision rule at each look."""

    def __init__(self, cfg: Config, design: Design):
        self.cfg, self.d = cfg, design
        self.sgn = 1 if cfg.primary_direction == "higher" else -1
        self.eff_at = None
        self.eff_z = None
        self.use_g = cfg.secondary_role == "guardrail"
        self.mp = bool(cfg.metrics)                 # the metrics path: the locked metric list decides (see Config.metrics)
        self.goal = cfg.primary_goal
        if self.mp:
            ms = cfg.metrics
            self.pi = next(i for i, m in enumerate(ms) if m["role"] == "primary")
            self.gi = [i for i, m in enumerate(ms) if m["role"] == "guardrail"]
            self.si = [i for i, m in enumerate(ms) if m["role"] == "secondary"]
            p = ms[self.pi]["def"]
            self.goal = p["name"]                   # reasons name metrics by their name
            self.lead_rate = p["type"] == "rate" and p["num"]["unit"] == "leads" and p["den"]["unit"] == "leads"
            self.use_g = False

    # ---- the metrics path
    def _pair(self, c: Counts, i: int):
        a, b = c.acc["A"][i], c.acc["B"][i]
        return a, b, a.value, b.value, a.var(), b.var()

    def _primary_z(self, c: Counts) -> float:
        a, b, ra, rb, va, vb = self._pair(c, self.pi)
        if self.lead_rate:                          # a lead-level proportion: the BRD's two-proportion z-test on whole counts
            return self.sgn * pooled_z(int(round(a.sn)), int(round(a.sd)), int(round(b.sn)), int(round(b.sd)))
        if None in (ra, rb, va, vb) or va + vb <= 0:
            return 0.0
        return self.sgn * (rb - ra) / math.sqrt(va + vb)

    def _guard(self, c: Counts, i: int, ce: float):
        """One guardrail of the metric list: how much worse B is (relative or absolute), with its standard error. None = no data to judge it."""
        m = self.cfg.metrics[i]
        dfn, lim = m["def"], m["limit"]
        a, b, ra, rb, va, vb = self._pair(c, i)
        if None in (ra, rb, va, vb):
            return None
        bad = 1 if dfn["direction"] == "lower" else -1          # +1: a rise is bad
        if lim["kind"] == "rel":
            if not ra > 0:
                return None
            worse = bad * (rb / ra - 1)
            se = math.sqrt(vb / ra ** 2 + rb ** 2 * va / ra ** 4)
            margin = float(lim["value"]) / 100
        else:
            worse = bad * (rb - ra)
            se = math.sqrt(va + vb)
            margin = float(lim["value"]) / 100 if dfn["type"] == "rate" else float(lim["value"])
        if not (se > 0 and math.isfinite(se)):
            return None
        return {"key": dfn["key"], "name": dfn["name"], "kind": lim["kind"], "type": dfn["type"], "unit": metric_unit(dfn), "rate_a": ra, "rate_b": rb,
                "worse": worse, "se": se, "margin": margin, "z_breach": (worse - margin) / se, "upper": worse + ce * se, "lower": worse - ce * se}

    def _metric_rows(self, c: Counts, gx: dict) -> list:
        out = []
        for i in [self.pi] + self.gi + self.si:
            m = self.cfg.metrics[i]
            dfn = m["def"]
            a, b, ra, rb, va, vb = self._pair(c, i)
            diff = rb - ra if None not in (ra, rb) else None
            se = math.sqrt(va + vb) if None not in (va, vb) else None
            r = {"key": dfn["key"], "name": dfn["name"], "role": m["role"], "type": dfn["type"], "direction": dfn["direction"], "unit": metric_unit(dfn),
                 "A": {"value": ra, "num": a.sn, "den": a.sd, "n": a.n, "se": _sqrt(va)}, "B": {"value": rb, "num": b.sn, "den": b.sd, "n": b.n, "se": _sqrt(vb)},
                 "diff": diff, "se": se, "lo": diff - 1.96 * se if diff is not None and se is not None else None,
                 "hi": diff + 1.96 * se if diff is not None and se is not None else None, "rel": (rb / ra - 1) if (ra and rb is not None) else None}
            if m["role"] == "guardrail":
                x = gx.get(i)
                r.update(limit=m["limit"], worse=x["worse"] if x else None, worse_se=x["se"] if x else None, z_breach=x["z_breach"] if x else None,
                         upper=x["upper"] if x else None, lower=x["lower"] if x else None, margin=x["margin"] if x else None)
            out.append(r)
        return out

    def look(self, k: int, c: Counts, final: bool, want_row: bool = False):
        cfg, d = self.cfg, self.d
        ce, ch, t = d.eff[k], d.harm[k], d.ts[k]
        chg = d.harm_g[k] if d.harm_g else ch          # guardrail-breach bar
        # the minimum-leads gate holds back the daily harm check; the one-look rule's final call only needs enough leads for the normal approximation.
        # On the metrics path the gate holds back every decision, the final call included.
        floor = cfg.min_per_arm if self.mp else (min(cfg.min_per_arm, FINAL_FLOOR) if (final and cfg.rule_set == "final_look") else cfg.min_per_arm)
        n = c.nA + c.nB
        p_srm = srm_pvalue(c.nA, c.nB, cfg.share_b)
        p_loss = loss_pvalue(c.aA, c.nA, c.aB, c.nB) if (cfg.loss_check and (c.aA + c.aB) >= cfg.srm_min_n) else 1.0
        g = g2 = None
        unavailable, gx = [], {}
        if self.mp:
            z = self._primary_z(c)
            for i in self.gi:
                gx[i] = self._guard(c, i, ce)
            guards = [(x, x["name"], x["margin"], x["kind"]) for x in (gx[i] for i in self.gi) if x is not None]
            unavailable = [(None, cfg.metrics[i]["def"]["name"], None, "unavailable") for i in self.gi if gx[i] is None]
        else:
            z = self.sgn * pooled_z(c.xA, c.nA, c.xB, c.nB)
            if self.use_g and c.nA > 1 and c.nB > 1:
                r, se, ma, mb = ratio_effect(c.sA, c.qA, c.nA, c.sB, c.qB, c.nB)
                worse = r if cfg.secondary_worse_when == "higher" else -r
                if se > 0 and math.isfinite(se):
                    g = {"rel_change": r, "worse": worse, "se": se, "mean_a": ma, "mean_b": mb,
                         "z_breach": (worse - cfg.guardrail_margin) / se,
                         "upper": worse + ce * se, "lower": worse - ce * se}
            g2 = rate_guard(cfg, c, ce)
            guards = [(g, cfg.secondary_metric, cfg.guardrail_margin, "relative"), (g2, cfg.guard_rate, cfg.guard_rate_margin, "points")]
            guards = [(x, nm, mg, kd) for x, nm, mg, kd in guards if x is not None]
        goal = self.goal
        kind, reason, cause = "CONTINUE", "collecting data", None
        if cfg.loss_check and (c.aA + c.aB) >= cfg.srm_min_n and p_loss < cfg.srm_alpha:
            kind = "HALT_SRM"
            reason = (f"calls are going missing from the log unevenly: {1 - c.nA / max(1, c.aA):.1%} of A's calls vs "
                      f"{1 - c.nB / max(1, c.aB):.1%} of B's (p={p_loss:.1e} < {cfg.srm_alpha}); results cannot be trusted")
        elif n >= cfg.srm_min_n and p_srm < cfg.srm_alpha:
            kind = "HALT_SRM"
            reason = (f"sample-ratio mismatch: logged B share {c.nB / n:.1%} vs configured {cfg.share_b:.1%} "
                      f"(p={p_srm:.1e} < {cfg.srm_alpha}); results cannot be trusted")
        elif c.nA < floor or c.nB < floor:
            if final:
                kind, reason = "INCONCLUSIVE", f"fewer than {floor} leads in an arm at the end of the window"
            else:
                reason = f"waiting for {floor} leads per arm before any decision"
        else:
            breach = next(((x, nm, mg, kd) for x, nm, mg, kd in guards if x["z_breach"] >= chg), None)
            if z <= -ch:
                kind = "STOP_HARM"
                if final and cfg.rule_set == "final_look":
                    cause = "loss_at_end"
                    reason = (f"at the final call B is significantly worse than A on {goal}: z={z:.2f}, past the end-of-test line -{ch:.2f} "
                              f"(95% two-sided); keep A, logged as a loss")
                else:
                    reason = f"B is clearly worse on {goal}: z={z:.2f} crossed the harm boundary -{ch:.2f}"
            elif breach is not None:
                x, nm, mg, kd = breach
                kind = "STOP_GUARDRAIL"
                if self.mp:
                    reason = (f"guardrail breached: {nm} is {_gtxt(x, 'worse')} worse (tolerated {_glim(x)}), "
                              f"z={x['z_breach']:.2f} crossed {chg:.2f}")
                elif kd == "relative":
                    reason = (f"guardrail breached: {nm} is {x['worse']:+.1%} worse (tolerated {mg:+.0%}), "
                              f"z={x['z_breach']:.2f} crossed {chg:.2f}")
                else:
                    reason = (f"guardrail breached: {nm} is {x['worse'] * 100:+.1f} points worse (tolerated {mg * 100:+.0f}), "
                              f"z={x['z_breach']:.2f} crossed {chg:.2f}")
            else:
                if z >= ce and self.eff_at is None:
                    self.eff_at, self.eff_z = k, z
                unproven = [(x, nm, mg, kd) for x, nm, mg, kd in guards if not x["upper"] < mg]
                if self.use_g and g is None:      # asked for, but the data cannot show it (no spread, no durations): never promote on that
                    unproven.insert(0, (None, cfg.secondary_metric, cfg.guardrail_margin, "unavailable"))
                unproven = unavailable + unproven     # metrics path: a guardrail with no data cannot be proven
                if self.eff_at is not None:
                    if z < ce:
                        # the win line was crossed earlier, but the evidence has since faded back below it: do not ship on a peak
                        if final:
                            kind = "HOLD_FOR_APPROVAL"
                            cause = "evidence_faded"
                            reason = (f"B crossed the win line at look {self.eff_at + 1} (z={self.eff_z:.2f}) but the evidence faded: z is now {z:.2f}, "
                                      f"below the {ce:.2f} needed at the end; held for a person to approve or reject")
                        else:
                            reason = f"the win line was crossed at look {self.eff_at + 1}, but the evidence is now weaker (z={z:.2f} < {ce:.2f}); waiting"
                    elif not unproven:
                        kind = "PROMOTE"
                        reason = (f"B beats A on {goal} at the final call: z={z:.2f}, needed {ce:.2f}" if cfg.rule_set == "final_look"
                                  else f"B beats A on {goal}: z={self.eff_z:.2f} crossed the efficacy boundary")
                        if self.eff_at != k and cfg.rule_set != "final_look":
                            reason += f" at look {self.eff_at + 1} (z={z:.2f} now, still above the {ce:.2f} line)"
                        for x, nm, mg, kd in guards:
                            if self.mp:
                                reason += f"; guardrail {nm} proven within {_glim(x)}"
                            else:
                                reason += f"; guardrail {nm} proven within {mg:+.0%}" if kd == "relative" else f"; guardrail {nm} proven within {mg * 100:+.0f} points"
                    elif final:
                        kind = "HOLD_FOR_APPROVAL"
                        x, nm, mg, kd = unproven[0]
                        if x is None:
                            reason = (f"B won on {goal} but the guardrail {nm} could not be evaluated from the data supplied "
                                      f"(missing, unusable or constant values); held for a person to approve or reject")
                        elif self.mp:
                            reason = (f"B won on {goal} but the guardrail {nm} was not proven within {_glim(x)} ({_gtxt(x, 'worse')} worse, upper bound "
                                      f"{_gtxt(x, 'upper')}); held for a person to approve or reject")
                        else:
                            shown = (f"{x['worse']:+.1%} worse, upper bound {x['upper']:+.1%}" if kd == "relative"
                                     else f"{x['worse'] * 100:+.1f} points worse, upper bound {x['upper'] * 100:+.1f}")
                            lim = f"{mg:+.0%}" if kd == "relative" else f"{mg * 100:+.0f} points"
                            reason = (f"B won on {goal} but the guardrail {nm} was not proven within {lim} ({shown}); "
                                      f"held for a person to approve or reject")
                    else:
                        reason = "efficacy shown; waiting for the guardrail to be proven"
                elif final:
                    kind = "INCONCLUSIVE"
                    reason = (f"window ended without evidence either way (z={z:.2f}, needed {ce:.2f}); "
                              f"no change shipped")
        dec = {"kind": kind, "reason": reason, "terminal": kind in TERMINAL, "cause": cause}
        if not want_row:
            return dec
        if self.mp:
            return dec, self._row_mp(k, c, z, ce, ch, chg, t, n, p_srm, p_loss, gx, dec)
        d_, lo_rci, hi_rci = score_diff_ci(c.xA, c.nA, c.xB, c.nB, ce)
        _, lo95, hi95 = score_diff_ci(c.xA, c.nA, c.xB, c.nB, 1.96)
        row = {"k": k, "n": n, "t": round(t, 5), "nA": c.nA, "xA": c.xA, "nB": c.nB, "xB": c.xB,
               "rateA": c.xA / c.nA if c.nA else None, "rateB": c.xB / c.nB if c.nB else None,
               "diff": d_, "rci": [lo_rci, hi_rci], "ci95": [lo95, hi95],
               "z": z, "eff": ce, "harm": ch, "harm_g": chg, "naive_cross": (abs(z) >= 1.96 and n >= 2 * cfg.min_per_arm),
               "p_srm": min(p_srm, p_loss), "p_loss": p_loss, "assignedB": c.aB / (c.aA + c.aB) if (c.aA + c.aB) else None,
               "loggedB": c.nB / n if n else None, "guardrail": g, "guardrail2": g2, "decision": dec["kind"]}
        return dec, row

    def _row_mp(self, k, c, z, ce, ch, chg, t, n, p_srm, p_loss, gx, dec) -> dict:
        cfg = self.cfg
        a, b, ra, rb, va, vb = self._pair(c, self.pi)
        if self.lead_rate:
            xA, dA, xB, dB = int(round(a.sn)), int(round(a.sd)), int(round(b.sn)), int(round(b.sd))
            d_, lo_rci, hi_rci = score_diff_ci(xA, dA, xB, dB, ce)
            _, lo95, hi95 = score_diff_ci(xA, dA, xB, dB, 1.96)
        else:
            xA, dA, xB, dB = a.sn, a.sd, b.sn, b.sd
            d_ = rb - ra if None not in (ra, rb) else None
            se = math.sqrt(va + vb) if None not in (va, vb) else None
            if d_ is None or se is None:
                lo_rci = hi_rci = lo95 = hi95 = None
            elif cfg.primary_type == "rate" and ce > 25:
                lo_rci, hi_rci, lo95, hi95 = -1.0, 1.0, d_ - 1.96 * se, d_ + 1.96 * se      # no promotion possible at this look: the same open range score_diff_ci gives
            else:
                lo_rci, hi_rci, lo95, hi95 = d_ - ce * se, d_ + ce * se, d_ - 1.96 * se, d_ + 1.96 * se
        return {"k": k, "n": n, "t": round(t, 5), "nA": c.nA, "xA": xA, "dA": dA, "nB": c.nB, "xB": xB, "dB": dB,
                "rateA": ra, "rateB": rb, "seA": _sqrt(va), "seB": _sqrt(vb), "diff": d_, "rci": [lo_rci, hi_rci], "ci95": [lo95, hi95],
                "z": z, "eff": ce, "harm": ch, "harm_g": chg, "naive_cross": (abs(z) >= 1.96 and n >= 2 * cfg.min_per_arm),
                "p_srm": min(p_srm, p_loss), "p_loss": p_loss, "assignedB": c.aB / (c.aA + c.aB) if (c.aA + c.aB) else None,
                "loggedB": c.nB / n if n else None, "guardrail": None, "guardrail2": None, "metrics": self._metric_rows(c, gx), "decision": dec["kind"]}


def _sqrt(v):
    return math.sqrt(v) if v is not None and v >= 0 else None


def _gnum(x: dict, v: float) -> str:
    if x["kind"] == "rel":
        return f"{v:+.1%}"
    if x["type"] == "rate":
        return f"{v * 100:+.1f} points"
    return f"{v:+.1f}" + (f" {x['unit']}" if x["unit"] else "")


def _gtxt(x: dict, key: str) -> str:
    """A guardrail value (worse / upper) in its own terms: % for a relative limit, points for a rate, the metric's units for an average."""
    return _gnum(x, x[key])


def _glim(x: dict) -> str:
    mg = x["margin"]
    if x["kind"] == "rel":
        return f"+{mg * 100:g}%"
    if x["type"] == "rate":
        return f"+{mg * 100:g} points"
    return f"+{mg:g}" + (f" {x['unit']}" if x["unit"] else "")


# ---------------------------------------------------------------------------- runner


def _iso(start: datetime, seconds: float) -> str:
    return (start + timedelta(seconds=seconds)).isoformat(timespec="seconds")


def run_experiment(cfg: Config, sim, design: Design | None = None, capture: dict | None = None) -> dict:
    """Run one experiment end to end against a traffic simulator. Fully deterministic.

    `capture`, if given, is filled with the per-lead rows the record does not keep (they would bloat every stored result):
    capture["assignments"] = [{lead_id, stratum, variant, assigned_at}], capture["calls"] = [{call_id, lead_id, time, in_segment, variant, converted, duration_s, repeat}].

    The metrics path (cfg.metrics set) needs a simulator with `observe_rows(arm, call)` (simulator.HistorySim): each analysed lead's call rows are
    counted into every metric of the list (metriclib.contrib), per arm. `converted` in the capture is then 1 when the lead adds to the primary's
    numerator, and `duration_s` is the answered call's length."""
    cfg.validate()
    d = design or build_design(cfg)
    start = datetime.fromisoformat(cfg.start)
    secs_per_call = 86400.0 / sim.calls_per_day(cfg)
    clock_state = {"i": 0}
    ledger = Ledger(lambda: _iso(start, clock_state["i"] * secs_per_call))
    variants = describe_pair(cfg.variant_b, cfg.variant_a)
    base_hash = variants["A"]["hash"]                    # the production prompt before the test (the live prompt A when the wizard supplied one)
    seg = catalog.validate_segment(cfg.segment)
    strat_plan = catalog.plan_strata(cfg.window_days * cfg.eligible_per_day, seg) if cfg.assignment == "stratified" else None
    router = (StratifiedRouter(cfg.exp_id, cfg.share_b, cfg.salt, strat_plan["merged"]) if cfg.assignment == "stratified"
              else Router(cfg.exp_id, cfg.share_b, cfg.salt, cfg.assignment))
    track_vars = cfg.assignment == "stratified"          # lead variables are read only where the router (or a segment) needs them
    oos_leads = set()
    mon = Monitor(cfg, d)
    c = Counts()
    mp = bool(cfg.metrics)
    if mp:
        if not hasattr(sim, "observe_rows"):
            raise ValueError("a test with a metric list needs a simulator that produces call rows (simulator.HistorySim)")
        from . import metriclib
        mdefs = [m["def"] for m in cfg.metrics]
        pi = next(i for i, m in enumerate(cfg.metrics) if m["role"] == "primary")
        c.acc = {"A": [metriclib.Acc() for _ in mdefs], "B": [metriclib.Acc() for _ in mdefs]}
    created = {
        "exp_id": cfg.exp_id, "config_hash": cfg.hash(), "config": cfg.as_dict(),
        "variant_A": variants["A"]["hash"], "variant_B": variants["B"]["hash"],
        "variant_B_origin": variants["B"]["origin"], "production_before": base_hash,
        "config_version": cfg.version, "parent_config_hash": cfg.parent_hash or None, "config_locked": True,
        "design": {"n_max": d.n_max, "looks": len(d.look_n), "alpha": cfg.alpha, "alpha_harm": cfg.alpha_harm,
                   "rule_set": cfg.rule_set, "spending": _spending(cfg), "power": cfg.power, "mde": cfg.mde}}
    if track_vars:
        created["audience"] = {"rule": catalog.describe(seg), "share_of_traffic": round(catalog.segment_share(seg), 4), "eligible_per_day": round(cfg.eligible_per_day, 1),
                               "strata": [r["label"] for r in strat_plan["strata"]], "merged": strat_plan["merged"], "block": router.size}
    if variants["B"].get("evidence"):
        created["variant_B_evidence"] = variants["B"]["evidence"]       # why the system proposed this edit (AI-mined variants only)
    ledger.append("experiment_created", created)
    ledger.append("routing_changed", {"A": 1 - cfg.share_b, "B": cfg.share_b, "reason": "experiment started"})

    looks, k = [], 0
    decision = None
    final_row = None
    calls = routed = 0                    # calls = every call the simulator produced; routed = those inside the segment (the ones the router saw)
    for call in sim.calls(cfg, d):
        calls += 1
        clock_state["i"] = call["i"]
        attrs = catalog.lead_vars(call["lead"]) if track_vars else None
        if seg and not catalog.matches(seg, attrs):
            oos_leads.add(call["lead"])   # not in the segment: gets the production prompt, is not counted ("out of segment")
            if capture is not None:
                capture.setdefault("calls", []).append({"call_id": call["i"], "lead_id": call["lead"], "time": _iso(start, call["i"] * secs_per_call), "in_segment": False,
                                                        "variant": "A", "converted": None, "duration_s": None, "repeat": call["repeat"]})
            continue
        routed += 1
        new_lead = call["lead"] not in router.ledger
        arm = router.assign(call["lead"], attrs)
        if capture is not None and new_lead:
            capture.setdefault("assignments", []).append({"lead_id": call["lead"], "stratum": getattr(router, "stratum_of", {}).get(call["lead"]), "variant": arm,
                                                          "assigned_at": _iso(start, call["i"] * secs_per_call)})
        if call["repeat"]:
            if capture is not None:
                capture.setdefault("calls", []).append({"call_id": call["i"], "lead_id": call["lead"], "time": _iso(start, call["i"] * secs_per_call), "in_segment": True,
                                                        "variant": arm, "converted": None, "duration_s": None, "repeat": True})
            continue                      # repeat calls are routed sticky but not analysed twice
        if arm == "A":
            c.aA += 1
        else:
            c.aB += 1
        if mp:
            if attrs is not None:
                call["attrs"] = attrs                  # the lead's factors, already read: the simulator puts them on the call rows
            rows = sim.observe_rows(arm, call)          # None = the lead's calls never reached the log
            cont = [metriclib.contrib(m, rows) for m in mdefs] if rows is not None else None
            if capture is not None:
                ans = next((r["call_duration"] for r in rows if r["call_status"] == "Answered"), None) if rows is not None else None
                capture.setdefault("calls", []).append({"call_id": call["i"], "lead_id": call["lead"], "time": _iso(start, call["i"] * secs_per_call), "in_segment": True,
                                                        "variant": arm, "converted": (1 if cont[pi][0] > 0 else 0) if rows is not None else None,
                                                        "duration_s": round(float(ans), 2) if ans is not None else None, "repeat": False})
            if rows is None:
                continue
            accs = c.acc[arm]
            for acc, (nu, de) in zip(accs, cont):
                acc.add(nu, de)
            if arm == "A":
                c.nA += 1; c.xA = accs[pi].sn
            else:
                c.nB += 1; c.xB = accs[pi].sn
        else:
            logged, converted, dur = sim.observe(arm, call)
            if capture is not None:
                capture.setdefault("calls", []).append({"call_id": call["i"], "lead_id": call["lead"], "time": _iso(start, call["i"] * secs_per_call), "in_segment": True,
                                                        "variant": arm, "converted": int(converted) if logged else None, "duration_s": round(dur, 2) if logged else None, "repeat": False})
            if not logged:
                continue
            ev = sim.event(arm, call) if cfg.guard_rate else 0
            if arm == "A":
                c.nA += 1; c.xA += converted; c.sA += dur; c.qA += dur * dur; c.gA += ev
            else:
                c.nB += 1; c.xB += converted; c.sB += dur; c.qB += dur * dur; c.gB += ev
        n = c.nA + c.nB
        if n == d.look_n[k]:
            final = k == len(d.look_n) - 1
            dec, row = mon.look(k, c, final, want_row=True)
            looks.append(row)
            row["time"] = _iso(start, call["i"] * secs_per_call)
            row["day"] = (k + 1) if cfg.rule_set == "final_look" else int(call["i"] * secs_per_call // 86400) + 1      # final_look looks are daily by design
            row["exposedB"] = router.calls["B"]
            row["calls"] = routed                     # every routed call so far, repeats included (the split panel shows the split by call as well as by lead)
            if track_vars:
                row["mix"] = {n: {v: list(ab) for v, ab in m.items()} for n, m in router.mix.items()}       # A vs B by lead type, firm type and city, up to this look
                row["mix_p"] = mix_pvalues(router.mix)
                row["oos"] = len(oos_leads)
            ledger.append("look", {"k": k, "n": n, "z": round(row["z"], 4), "bound_eff": round(row["eff"], 4),
                                   "bound_harm": round(row["harm"], 4), "rateA": row["rateA"], "rateB": row["rateB"],
                                   "p_srm": row["p_srm"], "decision": dec["kind"]})
            if dec["terminal"]:
                decision, final_row = dec, row
                break
            k += 1
    if decision is None:   # traffic ended before the planned final look (should not happen)
        decision = {"kind": "INCONCLUSIVE", "reason": "traffic ended before the final look", "terminal": True}
        final_row = looks[-1] if looks else None

    # ---- act on the decision
    decision, routing, production_after, hold_cause = act_on_decision(cfg, ledger, decision, final_row, base_hash, variants["B"]["hash"], len(looks))
    kind = decision["kind"]

    ok, _ = verify(ledger.entries)
    sticky = _stickiness(router, sim, cfg)
    seg_check = None
    if track_vars:
        bad = sum(1 for lead in router.ledger if seg and not catalog.matches(seg, catalog.lead_vars(lead)))       # re-read every counted lead's variables
        seg_check = {"rule": catalog.describe(seg), "counted_leads": len(router.ledger), "matching": len(router.ledger) - bad, "out_of_segment_leads": len(oos_leads),
                     "share_of_traffic": catalog.segment_share(seg), "eligible_per_day": cfg.eligible_per_day, "strata": strat_plan["strata"], "merged": strat_plan["merged"]}
    tails = decision_tails(ledger.entries, kind, hold_cause, base_hash, variants["B"]["hash"], looks[-1]["time"] if looks else cfg.start, holdback=cfg.holdback_share, holdback_days=cfg.holdback_days, scope_rule=catalog.describe(cfg.segment) if cfg.segment else "", autopilot=True)
    result = {
        "kind": kind, "reason": decision["reason"], "hold_cause": hold_cause, "cause": decision.get("cause"), "at_look": len(looks), "of_looks": len(d.look_n),
        "calls_analysed": final_row["n"] if final_row else 0, "n_max": d.n_max,
        "routing_after": routing, "production_before": base_hash, "production_after": production_after,
        "exposed_b_calls": router.calls["B"], "time": looks[-1]["time"] if looks else cfg.start,
        "split": router.split_report(), "stickiness": sticky,
    }
    if seg_check:
        result["segment_check"] = seg_check
    if kind == "INCONCLUSIVE" and final_row:
        result["more_leads"] = more_leads(cfg, d, final_row, cfg.eligible_per_day)
    rec = {"config": cfg.as_dict(), "config_hash": cfg.hash(), "design": d.summary(), "variants": variants,
           "looks": looks, "result": result, "ledger": ledger.entries, "ledger_head": ledger.head,
           "ledger_ok": ok, "calls_simulated": calls, "calls_read": calls, "tails": tails}
    sc = getattr(sim, "sc", None)
    proportion = not mp or cfg.primary_type == "rate"     # the holdback week is a proportion check: not run for an average primary
    if kind in ("PROMOTE", "HOLD_FOR_APPROVAL") and sc is not None and cfg.holdback_days > 0 and cfg.holdback_share > 0 and proportion:
        rec["holdback"] = holdback_week(cfg, sc.true_a, sc.true_b, sc.seed, getattr(sc, "true_b_after", None))   # starts when B is promoted (for a held test: when a person approves)
    autopilot_rollback(rec)
    return rec


def holdback_week(cfg: Config, true_a: float, true_b: float, seed: int, true_b_after: float | None = None) -> dict:
    """The week after a promotion: B is the production prompt, but `holdback_share` of leads stay on A so a regression would show.

    It replays the same simulated world forward with fresh random draws (the injected truth carries on; `true_b_after` lets a test make B decay).
    A small slice cannot re-prove the gain: it can only catch a B that has turned clearly worse, and `detectable_drop_pp` says how big that drop must be.
    """
    import numpy as np
    from .stats import norm_ppf
    per_day = max(1, int(round(cfg.eligible_per_day * cfg.primary_units_per_lead)))
    rng = np.random.default_rng(seed + 7919)
    bar = norm_ppf(1 - cfg.alpha_harm_daily)
    nA = xA = nB = xB = 0
    rows, alert_day = [], None
    for day in range(1, cfg.holdback_days + 1):
        tb = true_b if (true_b_after is None or day <= 1) else true_b_after
        a = int(rng.binomial(per_day, cfg.holdback_share))
        b = per_day - a
        nA += a; xA += int(rng.binomial(a, true_a)); nB += b; xB += int(rng.binomial(b, tb))
        z = pooled_z(xA, nA, xB, nB) if nA and nB else 0.0
        d, lo, hi = score_diff_ci(xA, nA, xB, nB, 1.96) if nA and nB else (0.0, -1.0, 1.0)
        alert = z <= -bar
        alert_day = alert_day or (day if alert else None)
        rows.append({"day": day, "nA": nA, "xA": xA, "nB": nB, "xB": xB, "rateA": xA / nA if nA else None, "rateB": xB / nB if nB else None,
                     "diff": d, "ci95": [lo, hi], "z": z, "bar": bar, "alert": alert})
    n_a_end, n_b_end = rows[-1]["nA"], rows[-1]["nB"]
    p = cfg.baseline
    se = math.sqrt(p * (1 - p) * (1 / max(1, n_a_end) + 1 / max(1, n_b_end)))
    detectable = (bar + norm_ppf(cfg.power)) * se               # a drop this big is caught with 80% power at the harm bar
    last = rows[-1]
    verdict = "alert" if alert_day else ("ahead" if last["diff"] > 0 and last["ci95"][0] > 0 else "no_sign_of_loss")
    return {"share": cfg.holdback_share, "days": cfg.holdback_days, "rows": rows, "alert_day": alert_day, "detectable_drop_pp": round(detectable * 100, 1), "verdict": verdict}


def mix_pvalues(mix: dict) -> dict:
    """Chi-square p-value for each balance variable: do A and B have the same mix of values? Values nobody has drawn yet are left out."""
    from scipy.stats import chi2_contingency
    out = {}
    for name, vals in mix.items():
        cols = [ab for ab in vals.values() if ab[0] + ab[1] > 0]
        if len(cols) < 2 or min(sum(c[i] for c in cols) for i in (0, 1)) == 0:
            out[name] = None
            continue
        out[name] = float(chi2_contingency([[c[0] for c in cols], [c[1] for c in cols]], correction=False)[1])
    return out


def _spending(cfg: Config) -> dict:
    if cfg.rule_set == "final_look":
        return {"efficacy": "one look at the end of the window", "harm": f"daily, {1 - cfg.alpha_harm_daily:.1%} bar"}
    return {"efficacy": "obf", "harm": "pocock"}


def act_on_decision(cfg: Config, ledger: Ledger, decision: dict, final_row, base_hash: str, b_hash: str, n_looks: int):
    """Turn the engine's verdict into ledger entries and a routing change. Shared by the simulator run and the results-file run."""
    kind, hold_cause = decision["kind"], None
    production_after = base_hash
    test_split = {"A": 1 - cfg.share_b, "B": cfg.share_b}
    if kind == "PROMOTE" and cfg.approval == "manual":
        kind, hold_cause = "HOLD_FOR_APPROVAL", "manual_approval"
        decision = {**decision, "kind": kind, "reason": decision["reason"] + "; approval mode is manual, so a person decides"}
    elif kind == "HOLD_FOR_APPROVAL":
        hold_cause = decision.get("cause") or "guardrail_not_proven"
    if kind == "PROMOTE":
        production_after = b_hash
        routing = promoted_routing(cfg)
        ledger.append("decision", {"kind": kind, "reason": decision["reason"], "evidence": _evidence(final_row)})
        ledger.append("promotion", {"approval": "auto", "production_before": base_hash, "production_after": production_after, **({"scope": catalog.describe(cfg.segment)} if cfg.segment else {})})
        ledger.append("routing_changed", {**routing, "reason": promoted_reason(cfg)})
    elif kind == "HOLD_FOR_APPROVAL":
        routing = test_split                  # nothing changes for callers while a person decides
        ledger.append("decision", {"kind": kind, "reason": decision["reason"], "cause": hold_cause, "evidence": _evidence(final_row)})
        ledger.append("approval_requested", {"candidate": b_hash, "cause": hold_cause})
    else:
        routing = {"A": 1.0, "B": 0.0}
        ledger.append("decision", {"kind": kind, "reason": decision["reason"], **({"cause": decision["cause"]} if decision.get("cause") else {}), "evidence": _evidence(final_row)})
        ledger.append("routing_changed", {**routing, "reason": f"{kind}: all traffic back to control A"})
    return decision, routing, production_after, hold_cause


def promoted_routing(cfg_or_share) -> dict:
    h = cfg_or_share if isinstance(cfg_or_share, float) else cfg_or_share.holdback_share
    return {"A": round(h, 4), "B": round(1.0 - h, 4)}


def promoted_reason(cfg_or_share, days: int | None = None, scope_rule: str = "") -> str:
    h = cfg_or_share if isinstance(cfg_or_share, float) else cfg_or_share.holdback_share
    d = days if days is not None else (7 if isinstance(cfg_or_share, float) else cfg_or_share.holdback_days)
    scope = ""
    rule = scope_rule or (catalog.describe(cfg_or_share.segment) if not isinstance(cfg_or_share, float) and cfg_or_share.segment else "")
    if rule:
        scope = f" for {rule} only (the only leads it was tested on; everyone else keeps today's prompt)"
    return (f"winner promoted: B is the production prompt{scope or ' for all traffic'}" if h <= 0 else
            f"winner promoted: B is the production prompt{scope}; {h:.0%} of leads stay on A for {d} days to confirm the gain holds")


AUTOPILOT = "Canary autopilot"
HELD_TIMEOUT_DAYS = 2          # a held test nobody answers is closed the safe way (keep A) after this many days


def _branch(entries: list, when: str, steps: list, hours: float) -> list:
    """Ledger entries that would follow `entries`, chained from its head and stamped `hours` after `when` (one minute apart)."""
    t0, n = datetime.fromisoformat(when), {"i": 0}
    lg = Ledger(lambda: (t0 + timedelta(hours=hours, minutes=n["i"])).isoformat(timespec="seconds"))
    lg.entries = list(entries)
    for et, payload in steps:
        n["i"] += 1
        lg.append(et, payload)
    return lg.entries[len(entries):]


def decision_tails(entries: list, kind: str, hold_cause, base_hash: str, b_hash: str, when: str, demo: bool = True, holdback: float = 0.05, holdback_days: int = 7, scope_rule: str = "", autopilot: bool = False) -> dict:
    """What the ledger would say next, for the human actions: approve / reject a held test, or roll back a promotion.

    Every branch is chained from the real ledger head, so the dashboard can show the click and still verify the chain.
    The person is a placeholder. For a simulated run the clicks are the demo's and say so; for results files (demo=False) they are written as
    the dashboard user's own click, which only enters the record when someone actually clicks.
    With `autopilot`, a held test also gets `auto_reject`: nobody answered within HELD_TIMEOUT_DAYS, so the safe default keeps A.
    """
    if kind not in ("HOLD_FOR_APPROVAL", "PROMOTE"):
        return {}
    branch = lambda steps, hours: _branch(entries, when, steps, hours)
    who = {"by": "reviewer (demo click)", "simulated": True} if demo else {"by": "reviewer (dashboard click)", "simulated": False}
    if kind == "HOLD_FOR_APPROVAL":
        out = {
            "approve": branch([("approval", {**who, "action": "approved", "candidate": b_hash}),
                               ("promotion", {"approval": "human", "production_before": base_hash, "production_after": b_hash}),
                               ("routing_changed", {**promoted_routing(holdback), "reason": "approved: " + promoted_reason(holdback, holdback_days, scope_rule)})], 2),
            "reject": branch([("approval", {**who, "action": "rejected", "candidate": b_hash}),
                              ("routing_changed", {"A": 1.0, "B": 0.0, "reason": "rejected: all traffic back to control A"})], 2)}
        if autopilot:
            out["auto_reject"] = branch([("approval", {"by": AUTOPILOT, "simulated": demo, "action": "rejected", "candidate": b_hash,
                                                       "policy": f"no answer within {HELD_TIMEOUT_DAYS} days: the safe default keeps A"}),
                                         ("routing_changed", {"A": 1.0, "B": 0.0, "reason": "autopilot: nobody answered, all traffic back to control A"})], 24 * HELD_TIMEOUT_DAYS)
        return out
    return {"rollback": branch([("rollback", {**who, "from": b_hash, "to": base_hash, "reason": "one-click rollback of the promoted prompt"}),
                                ("routing_changed", {"A": 1.0, "B": 0.0, "reason": "rolled back: all traffic on the previous prompt"})], 24)}


def autopilot_rollback(rec: dict) -> None:
    """After a promotion the holdback week watches B against the held-back A. If it raises an alert, the autopilot rolls B back that day
    without waiting for a person. The entry is chained from the ledger head like the one-click rollback, so the record still verifies.
    Only a promotion the engine made itself is covered (a held test a person approved is that person's to roll back)."""
    tails, hb, res = rec.setdefault("tails", {}), rec.get("holdback") or {}, rec["result"]
    tails.pop("auto_rollback", None)
    if res["kind"] != "PROMOTE" or not hb.get("alert_day"):
        return
    r = hb["rows"][hb["alert_day"] - 1]
    reason = (f"holdback alert on day {r['day']}: B {r['rateB']:.1%} against the held-back A {r['rateA']:.1%} (z={r['z']:.2f}, alert line "
              f"-{r['bar']:.2f}); rolled back without waiting for a person")
    tails["auto_rollback"] = _branch(rec["ledger"], res["time"], [
        ("rollback", {"by": AUTOPILOT, "simulated": True, "from": res["production_after"], "to": res["production_before"], "reason": reason}),
        ("routing_changed", {"A": 1.0, "B": 0.0, "reason": "autopilot rollback: all traffic on the previous prompt"})], 24 * r["day"])


def more_leads(cfg: Config, d: Design, row: dict, leads_per_day: float) -> dict:
    """An inconclusive result still says how much more evidence would settle it (leads = analysed first calls).

    For each target lift (the planned one, then smaller ones) it says whether the data already in hand could have detected it
    (80% power) and, if not, how many more leads and days that would take. Where the data was already enough and nothing showed,
    the honest reading is that any real lift is smaller than that target. A lift 'seen so far' is offered too, flagged as a guess,
    because a small observed lift is mostly noise.
    """
    n = row["n"]
    base = min(max(cfg.baseline, 1e-4), 0.9999)
    lpd = max(1.0, float(leads_per_day))
    sign = 1 if cfg.primary_direction == "higher" else -1

    avg = cfg.primary_type == "average"           # metrics path, average primary: lifts are in the metric's own units, not points

    def need(delta: float) -> int:
        mde = abs(delta)
        key = "n_fixed" if cfg.rule_set == "final_look" else "n_max"
        if avg:
            return primary_plan(cfg, mde)[key]
        pa = min(base, 1 - mde - 1e-4) if sign > 0 else max(base, mde + 1e-4)
        tot = seqdesign.plan_sample_size(pa, sign * mde, cfg.share_b, cfg.alpha, cfg.power, cfg.n_looks)[key]
        return int(math.ceil(tot / cfg.primary_units_per_lead)) if cfg.metrics else tot

    def lift(delta: float) -> dict:
        if not cfg.metrics:
            return {"lift_pp": round(delta * 100, 2)}
        return {"lift_pp": None if avg else round(delta * 100, 2), "lift": round(delta, 6), "unit": metric_unit(cfg.metrics[[m["role"] for m in cfg.metrics].index("primary")]["def"])}

    opts, seen_pending = [], 0
    for frac in (1.0, 0.5, 1 / 3, 0.25):
        delta = cfg.mde * frac
        tot = need(delta)
        extra = max(0, tot - n)
        opts.append({"label": "the planned lift" if frac == 1.0 else f"{frac:.2g} of the planned lift" if frac in (0.5, 0.25) else "a third of the planned lift",
                     **lift(delta), "total_leads": tot, "more_leads": extra, "more_days": round(extra / lpd, 1),
                     "enough_already": extra == 0, "guess": False, "impractical": extra / lpd > 365})
    enough = [o for o in opts if o["enough_already"]]
    pending = [o for o in opts if not o["enough_already"]]
    out = enough[-1:] + pending[:2]                       # the smallest lift already testable, then the next two to aim for
    seen = abs(row["diff"]) if row.get("diff") is not None else 0
    if (0 if avg else 0.002) < seen < cfg.mde and (row["diff"] > 0) == (sign > 0):
        tot = need(seen)
        extra = max(0, tot - n)
        out.append({"label": "the lift seen so far, if it is real (a guess: small lifts are mostly noise)", **lift(seen), "total_leads": tot,
                    "more_leads": extra, "more_days": round(extra / lpd, 1), "enough_already": extra == 0, "guess": True, "impractical": extra / lpd > 365})
    return {"analysed": n, "leads_per_day": round(lpd), "options": out}


def _evidence(row):
    if not row:
        return {}
    keep = ("n", "nA", "xA", "nB", "xB", "rateA", "rateB", "diff", "rci", "ci95", "z", "eff", "harm", "p_srm", "guardrail")
    out = {k: row[k] for k in keep}
    if "metrics" in row:                  # metrics path: every metric of the locked list, as it stood at the decision
        out.update(dA=row["dA"], dB=row["dB"], metrics=[{k: m.get(k) for k in ("key", "name", "role", "diff", "lo", "hi", "rel", "worse", "upper", "margin")}
                                                          | {"A": m["A"]["value"], "B": m["B"]["value"]} for m in row["metrics"]])
    return out


def _stickiness(router: Router, sim, cfg: Config) -> dict:
    """Re-ask the router for every lead we have seen: nobody may change arm."""
    flips = 0
    for lead, arm in list(router.ledger.items()):
        if router.assign(lead) != arm:
            flips += 1
    # stateless check for hash mode: a brand-new router must agree on every lead
    stateless = None
    if cfg.assignment == "hash":
        fresh = Router(cfg.exp_id, cfg.share_b, cfg.salt, "hash")
        stateless = sum(1 for lead, arm in router.ledger.items() if fresh.assign(lead) != arm)
    # undo the extra bookkeeping calls so reported exposure is unaffected
    for lead, arm in router.ledger.items():
        router.calls[arm] -= 1
    return {"leads_checked": len(router.ledger), "arm_changes": flips, "independent_router_disagreements": stateless}


def replay_matches(record: dict, sim_factory) -> dict:
    """Re-run from the stored config and check the decision and ledger head are identical."""
    cfg = Config(**record["config"])
    again = run_experiment(cfg, sim_factory())
    return {"same_decision": again["result"]["kind"] == record["result"]["kind"],
            "same_ledger_head": again["ledger_head"] == record["ledger_head"],
            "ledger_head": again["ledger_head"]}


def lock_check(record: dict) -> dict:
    """Is the config in this record exactly the one that was registered when the test started?

    The 'experiment_created' ledger entry holds the config's hash; the config stored next to the results must still hash to it, and the
    ledger itself must be intact. If anyone edits a rule after the test started, one of the two checks fails.
    """
    import json
    created = json.loads(record["ledger"][0]["body"])["payload"]
    cfg = Config(**record["config"])
    ok_chain, bad = verify(record["ledger"])
    return {"config_hash_registered": created["config_hash"], "config_hash_now": cfg.hash(),
            "config_unchanged": created["config_hash"] == cfg.hash(), "ledger_intact": ok_chain, "ok": created["config_hash"] == cfg.hash() and ok_chain,
            "version": cfg.version,
            "parent_hash": cfg.parent_hash or None}
