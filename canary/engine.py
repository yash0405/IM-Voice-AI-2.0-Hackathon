"""The A/B engine: config, design, decision rules and the end-to-end experiment runner.

`Monitor.look` is the single decision function. The live runner, the scenario demos and the
Monte Carlo proof lab all call it, so what we prove is exactly what ships.
"""
from __future__ import annotations

import hashlib
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta

from . import seqdesign
from .ledger import Ledger, canonical, verify
from .router import Router
from .stats import loss_pvalue, norm_cdf, pooled_z, ratio_effect, score_diff_ci, srm_pvalue
from .variants import describe_pair, load_base

# ---------------------------------------------------------------------------- config


@dataclass
class Config:
    exp_id: str = "exp-001"
    name: str = "Ask quantity and location together"
    agent: str = "VANI BuyLead qualification agent"
    variant_b: str = "ask_together"
    share_b: float = 0.10
    assignment: str = "balanced"        # balanced | hash
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

    def as_dict(self):
        return asdict(self)

    def hash(self) -> str:
        return hashlib.sha256(canonical(self.as_dict()).encode()).hexdigest()[:12]

    def validate(self):
        errs = []
        if not 0 < self.share_b <= 0.5:
            errs.append("share_b must be between 0 and 0.5 (the test slice is the smaller share)")
        if not 0 < self.baseline < 1 or not 0 < self.mde < 1:
            errs.append("baseline and mde must be probabilities")
        if self.primary_direction == "higher" and self.baseline + self.mde >= 1:
            errs.append("baseline + mde must stay below 1")
        if self.assignment not in ("balanced", "hash"):
            errs.append("assignment must be balanced or hash")
        if self.secondary_role not in ("guardrail", "goal", "none"):
            errs.append("secondary_role must be guardrail, goal or none")
        if self.approval not in ("auto", "manual"):
            errs.append("approval must be auto or manual")
        if errs:
            raise ValueError("; ".join(errs))
        return self


# ---------------------------------------------------------------------------- design


@dataclass
class Design:
    n_max: int
    look_every: int
    capacity: int
    look_n: list           # analysed calls at each look
    ts: list               # information fractions
    eff: list              # efficacy critical values (Z scale)
    harm: list             # harm critical values (Z scale)
    theta: float
    inflation: float
    n_fixed: int
    power_in_window: float
    will_finish: bool
    duration_cv: float = 0.0
    guardrail_proof_prob: float = 1.0

    def summary(self) -> dict:
        d = {k: v for k, v in self.__dict__.items()}
        return d


def build_design(cfg: Config) -> Design:
    cfg.validate()
    sign = 1 if cfg.primary_direction == "higher" else -1
    plan = seqdesign.plan_sample_size(cfg.baseline, cfg.mde, cfg.share_b, cfg.alpha, cfg.power, cfg.n_looks)
    n_max = plan["n_max"]
    look_every = max(1, math.ceil(n_max / cfg.n_looks))
    capacity = cfg.window_days * cfg.leads_per_day
    look_n = []
    k = 1
    while k * look_every < min(n_max, capacity):
        look_n.append(k * look_every)
        k += 1
    final_n = min(n_max, capacity)
    look_n.append(final_n)
    ts = [n / n_max for n in look_n]
    truncated = final_n < n_max
    eff = seqdesign.compute_boundaries(ts, cfg.alpha, "obf", exhaust_last=truncated)
    harm = seqdesign.compute_boundaries(ts, cfg.alpha_harm, "pocock", exhaust_last=truncated)
    power_in_window = seqdesign.crossing_probability(ts, eff, plan["theta"])
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
                  eff=eff, harm=harm, theta=plan["theta"], inflation=float(plan["inflation"]),
                  n_fixed=plan["n_fixed"], power_in_window=power_in_window, will_finish=not truncated,
                  duration_cv=cv, guardrail_proof_prob=gp)


# ---------------------------------------------------------------------------- monitor


class Counts:
    __slots__ = ("nA", "xA", "nB", "xB", "sA", "qA", "sB", "qB", "aA", "aB")

    def __init__(self):
        self.nA = self.xA = self.nB = self.xB = 0
        self.sA = self.qA = self.sB = self.qB = 0.0
        self.aA = self.aB = 0   # assigned first calls (before any logging loss)


TERMINAL = {"PROMOTE", "STOP_HARM", "STOP_GUARDRAIL", "HALT_SRM", "INCONCLUSIVE", "NO_PROMOTE_GUARDRAIL"}


class Monitor:
    """Evaluates the pre-registered decision rule at each look."""

    def __init__(self, cfg: Config, design: Design):
        self.cfg, self.d = cfg, design
        self.sgn = 1 if cfg.primary_direction == "higher" else -1
        self.eff_at = None
        self.use_g = cfg.secondary_role == "guardrail"

    def look(self, k: int, c: Counts, final: bool, want_row: bool = False):
        cfg, d = self.cfg, self.d
        ce, ch, t = d.eff[k], d.harm[k], d.ts[k]
        n = c.nA + c.nB
        p_srm = srm_pvalue(c.nA, c.nB, cfg.share_b)
        p_loss = loss_pvalue(c.aA, c.nA, c.aB, c.nB) if (cfg.loss_check and (c.aA + c.aB) >= cfg.srm_min_n) else 1.0
        z = self.sgn * pooled_z(c.xA, c.nA, c.xB, c.nB)
        g = None
        if self.use_g and c.nA > 1 and c.nB > 1:
            r, se, ma, mb = ratio_effect(c.sA, c.qA, c.nA, c.sB, c.qB, c.nB)
            worse = r if cfg.secondary_worse_when == "higher" else -r
            if se > 0 and math.isfinite(se):
                g = {"rel_change": r, "worse": worse, "se": se, "mean_a": ma, "mean_b": mb,
                     "z_breach": (worse - cfg.guardrail_margin) / se,
                     "upper": worse + ce * se, "lower": worse - ce * se}
        kind, reason = "CONTINUE", "collecting data"
        if cfg.loss_check and (c.aA + c.aB) >= cfg.srm_min_n and p_loss < cfg.srm_alpha:
            kind = "HALT_SRM"
            reason = (f"calls are going missing from the log unevenly: {1 - c.nA / max(1, c.aA):.1%} of A's calls vs "
                      f"{1 - c.nB / max(1, c.aB):.1%} of B's (p={p_loss:.1e} < {cfg.srm_alpha}); results cannot be trusted")
        elif n >= cfg.srm_min_n and p_srm < cfg.srm_alpha:
            kind = "HALT_SRM"
            reason = (f"sample-ratio mismatch: logged B share {c.nB / n:.1%} vs configured {cfg.share_b:.1%} "
                      f"(p={p_srm:.1e} < {cfg.srm_alpha}); results cannot be trusted")
        elif c.nA < cfg.min_per_arm or c.nB < cfg.min_per_arm:
            if final:
                kind, reason = "INCONCLUSIVE", f"fewer than {cfg.min_per_arm} calls in an arm at the end of the window"
            else:
                reason = f"waiting for {cfg.min_per_arm} calls per arm before any decision"
        else:
            if z <= -ch:
                kind = "STOP_HARM"
                reason = f"B is clearly worse on {cfg.primary_goal}: z={z:.2f} crossed the harm boundary -{ch:.2f}"
            elif g is not None and g["z_breach"] >= ch:
                kind = "STOP_GUARDRAIL"
                reason = (f"guardrail breached: {cfg.secondary_metric} is {g['worse']:+.1%} worse "
                          f"(tolerated {cfg.guardrail_margin:+.0%}), z={g['z_breach']:.2f} crossed {ch:.2f}")
            else:
                if z >= ce and self.eff_at is None:
                    self.eff_at = k
                if self.eff_at is not None:
                    if g is None or g["upper"] < cfg.guardrail_margin:
                        kind = "PROMOTE"
                        reason = f"B beats A on {cfg.primary_goal}: z={z:.2f} crossed the efficacy boundary"
                        if g is not None:
                            reason += f"; guardrail {cfg.secondary_metric} proven within {cfg.guardrail_margin:+.0%}"
                    elif final:
                        kind = "NO_PROMOTE_GUARDRAIL"
                        reason = (f"B won on {cfg.primary_goal} but {cfg.secondary_metric} was not proven within "
                                  f"{cfg.guardrail_margin:+.0%} (upper bound {g['upper']:+.1%}); not promoted")
                    else:
                        reason = "efficacy shown; waiting for the guardrail to be proven"
                elif final:
                    kind = "INCONCLUSIVE"
                    reason = (f"window ended without evidence either way (z={z:.2f}, needed {ce:.2f}); "
                              f"no change shipped")
        dec = {"kind": kind, "reason": reason, "terminal": kind in TERMINAL}
        if not want_row:
            return dec
        d_, lo_rci, hi_rci = score_diff_ci(c.xA, c.nA, c.xB, c.nB, ce)
        _, lo95, hi95 = score_diff_ci(c.xA, c.nA, c.xB, c.nB, 1.96)
        row = {"k": k, "n": n, "t": round(t, 5), "nA": c.nA, "xA": c.xA, "nB": c.nB, "xB": c.xB,
               "rateA": c.xA / c.nA if c.nA else None, "rateB": c.xB / c.nB if c.nB else None,
               "diff": d_, "rci": [lo_rci, hi_rci], "ci95": [lo95, hi95],
               "z": z, "eff": ce, "harm": ch, "naive_cross": (abs(z) >= 1.96 and n >= 2 * cfg.min_per_arm),
               "p_srm": min(p_srm, p_loss), "p_loss": p_loss, "assignedB": c.aB / (c.aA + c.aB) if (c.aA + c.aB) else None,
               "loggedB": c.nB / n if n else None, "guardrail": g, "decision": dec["kind"]}
        return dec, row


# ---------------------------------------------------------------------------- runner


def _iso(start: datetime, seconds: float) -> str:
    return (start + timedelta(seconds=seconds)).isoformat(timespec="seconds")


def run_experiment(cfg: Config, sim, design: Design | None = None) -> dict:
    """Run one experiment end to end against a traffic simulator. Fully deterministic."""
    cfg.validate()
    d = design or build_design(cfg)
    start = datetime.fromisoformat(cfg.start)
    secs_per_call = 86400.0 / sim.calls_per_day(cfg)
    clock_state = {"i": 0}
    ledger = Ledger(lambda: _iso(start, clock_state["i"] * secs_per_call))
    variants = describe_pair(cfg.variant_b)
    router = Router(cfg.exp_id, cfg.share_b, cfg.salt, cfg.assignment)
    mon = Monitor(cfg, d)
    c = Counts()
    base = load_base()
    created = {
        "exp_id": cfg.exp_id, "config_hash": cfg.hash(), "config": cfg.as_dict(),
        "variant_A": variants["A"]["hash"], "variant_B": variants["B"]["hash"],
        "variant_B_origin": variants["B"]["origin"], "production_before": base["hash"],
        "design": {"n_max": d.n_max, "looks": len(d.look_n), "alpha": cfg.alpha, "alpha_harm": cfg.alpha_harm,
                   "spending": {"efficacy": "obf", "harm": "pocock"}, "power": cfg.power, "mde": cfg.mde}}
    if variants["B"].get("evidence"):
        created["variant_B_evidence"] = variants["B"]["evidence"]       # why the system proposed this edit (AI-mined variants only)
    ledger.append("experiment_created", created)
    ledger.append("routing_changed", {"A": 1 - cfg.share_b, "B": cfg.share_b, "reason": "experiment started"})

    looks, k = [], 0
    decision = None
    final_row = None
    calls = 0
    for call in sim.calls(cfg, d):
        calls += 1
        clock_state["i"] = call["i"]
        arm = router.assign(call["lead"])
        if call["repeat"]:
            continue                      # repeat calls are routed sticky but not analysed twice
        if arm == "A":
            c.aA += 1
        else:
            c.aB += 1
        logged, converted, dur = sim.observe(arm, call)
        if not logged:
            continue
        if arm == "A":
            c.nA += 1; c.xA += converted; c.sA += dur; c.qA += dur * dur
        else:
            c.nB += 1; c.xB += converted; c.sB += dur; c.qB += dur * dur
        n = c.nA + c.nB
        if n == d.look_n[k]:
            final = k == len(d.look_n) - 1
            dec, row = mon.look(k, c, final, want_row=True)
            looks.append(row)
            row["time"] = _iso(start, call["i"] * secs_per_call)
            row["exposedB"] = router.calls["B"]
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
    kind = decision["kind"]
    production_after = base["hash"]
    if kind == "PROMOTE":
        if cfg.approval == "auto":
            production_after = variants["B"]["hash"]
            routing = {"A": 0.0, "B": 1.0}
            ledger.append("decision", {"kind": kind, "reason": decision["reason"], "evidence": _evidence(final_row)})
            ledger.append("promotion", {"approval": "auto", "production_before": base["hash"],
                                        "production_after": production_after})
            ledger.append("routing_changed", {**routing, "reason": "winner promoted to all traffic"})
        else:
            routing = {"A": 1 - cfg.share_b, "B": cfg.share_b}
            ledger.append("decision", {"kind": "PROMOTE_PENDING_APPROVAL", "reason": decision["reason"],
                                       "evidence": _evidence(final_row)})
            ledger.append("approval_requested", {"candidate": variants["B"]["hash"]})
    else:
        routing = {"A": 1.0, "B": 0.0}
        ledger.append("decision", {"kind": kind, "reason": decision["reason"], "evidence": _evidence(final_row)})
        ledger.append("routing_changed", {**routing, "reason": f"{kind}: all traffic back to control A"})

    ok, _ = verify(ledger.entries)
    sticky = _stickiness(router, sim, cfg)
    result = {
        "kind": kind, "reason": decision["reason"], "at_look": len(looks), "of_looks": len(d.look_n),
        "calls_analysed": final_row["n"] if final_row else 0, "n_max": d.n_max,
        "routing_after": routing, "production_before": base["hash"], "production_after": production_after,
        "exposed_b_calls": router.calls["B"], "time": looks[-1]["time"] if looks else cfg.start,
        "split": router.split_report(), "stickiness": sticky,
    }
    return {"config": cfg.as_dict(), "config_hash": cfg.hash(), "design": d.summary(), "variants": variants,
            "looks": looks, "result": result, "ledger": ledger.entries, "ledger_head": ledger.head,
            "ledger_ok": ok, "calls_simulated": calls}


def _evidence(row):
    if not row:
        return {}
    keep = ("n", "nA", "xA", "nB", "xB", "rateA", "rateB", "diff", "rci", "ci95", "z", "eff", "harm", "p_srm", "guardrail")
    return {k: row[k] for k in keep}


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
