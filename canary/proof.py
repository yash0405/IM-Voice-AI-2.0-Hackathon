"""Monte Carlo proof lab. Every number in the QA report and the dashboard's Proof tab comes from here.

Canary's decisions are made by the same `Monitor.look` used by the live engine; the typical
approaches (baselines.py) see exactly the same simulated counts.
Run:  python -m canary proof [--runs N]      (seeded, reproducible)
"""
from __future__ import annotations

import json
import math
import time
from dataclasses import replace
from multiprocessing import Pool
from pathlib import Path

import numpy as np

from . import seqdesign
from .baselines import fixed_horizon_decision, higher_rate_decision, naive_peek
from .engine import Config, Counts, Monitor, build_design
from .router import NaiveRouter, Router
from .scenarios import BASE
from .simulator import real_durations
from .stats import binom_ci

OUT = Path(__file__).resolve().parent.parent / "out"
METHODS = ["canary", "naive_peek", "fixed_horizon", "higher_rate"]

PROOF_SCENARIOS = {
    "aa":        dict(label="No real difference (A = B)", true_a=0.45, true_b=0.45, truth="no_effect"),
    "win":       dict(label="B truly +7pp better", true_a=0.45, true_b=0.52, truth="better"),
    "harm":      dict(label="B truly 10pp worse", true_a=0.45, true_b=0.35, truth="worse"),
    "small":     dict(label="B truly +1pp (below the 7pp planned)", true_a=0.45, true_b=0.46, truth="tiny"),
    "srm_bug":   dict(label="No real difference, B loses 35% of non-converting calls from the log",
                      true_a=0.45, true_b=0.45, drop_b=0.35, truth="no_effect"),
    "guardrail": dict(label="B +7pp on BuyLeads but 30% longer calls",
                      true_a=0.45, true_b=0.52, dur_mult=1.30, truth="guardrail_bad"),
}


def _gen(rng, M, d, cfg, true_a, true_b, drop_b=0.0, dur_mult=1.0, with_dur=True):
    K = len(d.look_n)
    inc = np.diff([0] + d.look_n)
    nBi = rng.binomial(inc[None, :], cfg.share_b, size=(M, K))
    nAi = inc[None, :] - nBi
    xBi = rng.binomial(nBi, true_b)
    xAi = rng.binomial(nAi, true_a)
    if drop_b > 0:
        dropped = rng.binomial(nBi - xBi, drop_b)
    else:
        dropped = np.zeros_like(nBi)
    nBl = nBi - dropped
    arr = {"aB": np.cumsum(nBi, 1), "aA": np.cumsum(nAi, 1), "nA": np.cumsum(nAi, 1), "xA": np.cumsum(xAi, 1),
           "nB": np.cumsum(nBl, 1), "xB": np.cumsum(xBi, 1)}
    if with_dur:
        durs = real_durations()
        sA = np.zeros((M, K)); qA = np.zeros((M, K)); sB = np.zeros((M, K)); qB = np.zeros((M, K))
        for k in range(K):
            L = int(inc[k])
            D = durs[rng.integers(0, len(durs), (M, L))]
            idx = np.arange(L)[None, :]
            ma = idx < nAi[:, k, None]
            mb = (idx >= nAi[:, k, None]) & (idx < (nAi[:, k, None] + nBl[:, k, None]))
            sA[:, k] = (D * ma).sum(1); qA[:, k] = (D * D * ma).sum(1)
            Db = D * dur_mult
            sB[:, k] = (Db * mb).sum(1); qB[:, k] = (Db * Db * mb).sum(1)
        arr.update(sA=np.cumsum(sA, 1), qA=np.cumsum(qA, 1), sB=np.cumsum(sB, 1), qB=np.cumsum(qB, 1))
    return arr


def _set(c: Counts, a: dict, m: int, k: int, with_dur: bool):
    c.nA = int(a["nA"][m][k]); c.xA = int(a["xA"][m][k]); c.nB = int(a["nB"][m][k]); c.xB = int(a["xB"][m][k])
    if with_dur:
        c.sA = float(a["sA"][m][k]); c.qA = float(a["qA"][m][k]); c.sB = float(a["sB"][m][k]); c.qB = float(a["qB"][m][k])


def evaluate(a: dict, M: int, d, cfg: Config, with_dur: bool = True, methods=METHODS):
    """Run the methods on the same simulated counts. Returns per-method kinds, n, B exposure."""
    K = len(d.look_n)
    aB = {m: [] for m in methods}
    res = {m: {"kind": [], "n": [], "expB": [], "cause": [], "look": []} for m in methods}
    cols = {k: v.tolist() for k, v in a.items()}
    kf = next((i for i, n in enumerate(d.look_n) if n >= d.n_fixed), K - 1)
    c = Counts()

    def load(m, k):
        c.aA = cols["aA"][m][k]; c.aB = cols["aB"][m][k]
        c.nA = cols["nA"][m][k]; c.xA = cols["xA"][m][k]; c.nB = cols["nB"][m][k]; c.xB = cols["xB"][m][k]
        if with_dur:
            c.sA = cols["sA"][m][k]; c.qA = cols["qA"][m][k]; c.sB = cols["sB"][m][k]; c.qB = cols["qB"][m][k]

    for m in range(M):
        if "canary" in methods:
            mon = Monitor(cfg, d)
            kind, kk, why = "INCONCLUSIVE", K - 1, None
            for k in range(K):
                load(m, k)
                dec = mon.look(k, c, k == K - 1)
                if dec["terminal"]:
                    kind, kk, why = dec["kind"], k, dec.get("cause")
                    break
            res["canary"]["cause"].append(why); res["canary"]["look"].append(kk)
            res["canary"]["kind"].append(kind); res["canary"]["n"].append(cols["nA"][m][kk] + cols["nB"][m][kk])
            res["canary"]["expB"].append(cols["aB"][m][kk])
        if "naive_peek" in methods:
            kind, kk = "NO_SHIP", K - 1
            for k in range(K):
                load(m, k)
                dec = naive_peek(c, cfg.min_per_arm)
                if dec:
                    kind, kk = dec, k
                    break
            res["naive_peek"]["kind"].append(kind); res["naive_peek"]["n"].append(cols["nA"][m][kk] + cols["nB"][m][kk])
            res["naive_peek"]["expB"].append(cols["aB"][m][kk])
        if "fixed_horizon" in methods:
            load(m, kf)
            res["fixed_horizon"]["kind"].append(fixed_horizon_decision(c))
            res["fixed_horizon"]["n"].append(cols["nA"][m][kf] + cols["nB"][m][kf]); res["fixed_horizon"]["expB"].append(cols["aB"][m][kf])
        if "higher_rate" in methods:
            load(m, K - 1)
            res["higher_rate"]["kind"].append(higher_rate_decision(c))
            res["higher_rate"]["n"].append(cols["nA"][m][K - 1] + cols["nB"][m][K - 1]); res["higher_rate"]["expB"].append(cols["aB"][m][K - 1])
    return res


def _summ(kinds, ns, exps):
    M = len(kinds)
    out = {}
    for k in sorted(set(kinds)):
        x = kinds.count(k)
        lo, hi = binom_ci(x, M)
        out[k] = {"rate": x / M, "ci": [lo, hi]}
    prom = [n for k, n in zip(kinds, ns) if k == "PROMOTE"]
    return {"outcomes": out, "median_n": float(np.median(ns)), "mean_exposure_b": float(np.mean(exps)), "runs": M,
            "median_n_when_promoted": float(np.median(prom)) if prom else None}


def run_scenario(args):
    key, runs, seed = args
    sc = PROOF_SCENARIOS[key]
    cfg = Config(**BASE)
    d = build_design(cfg)
    rng = np.random.default_rng(seed)
    a = _gen(rng, runs, d, cfg, sc["true_a"], sc["true_b"], sc.get("drop_b", 0.0), sc.get("dur_mult", 1.0), True)
    res = evaluate(a, runs, d, cfg, True)
    return key, {"label": sc["label"], "truth": sc["truth"], "true_a": sc["true_a"], "true_b": sc["true_b"],
                 "methods": {m: _summ(r["kind"], r["n"], r["expB"]) for m, r in res.items()},
                 "n_max": d.n_max, "n_fixed": d.n_fixed}


def run_looks_sweep(args):
    K, runs, seed = args
    cfg = Config(**{**BASE, "n_looks": K, "secondary_role": "none"})
    d = build_design(cfg)
    rng = np.random.default_rng(seed)
    a = _gen(rng, runs, d, cfg, cfg.baseline, cfg.baseline, with_dur=False)
    res = evaluate(a, runs, d, cfg, False, methods=["canary", "naive_peek"])
    out = {}
    for m, r in res.items():
        x = r["kind"].count("PROMOTE")
        out[m] = {"false_promote": x / runs, "ci": list(binom_ci(x, runs))}
    return K, out


def run_bug_sweep(args):
    drop, runs, seed = args
    cfg_full = Config(**BASE)
    cfg_share = Config(**{**BASE, "loss_check": False})
    d = build_design(cfg_full)
    a = _gen(np.random.default_rng(seed), runs, d, cfg_full, cfg_full.baseline, cfg_full.baseline, drop_b=drop, with_dur=True)
    full = evaluate(a, runs, d, cfg_full, True, methods=["canary", "naive_peek"])
    share = evaluate(a, runs, d, cfg_share, True, methods=["canary"])
    f, sh, nv = full["canary"]["kind"], share["canary"]["kind"], full["naive_peek"]["kind"]
    return drop, {"share_check_only": {"halts": sh.count("HALT_SRM") / runs, "ships": sh.count("PROMOTE") / runs},
                  "with_completeness_check": {"halts": f.count("HALT_SRM") / runs, "ships": f.count("PROMOTE") / runs},
                  "naive_ships": nv.count("PROMOTE") / runs, "runs": runs}


def run_grid_cell(args):
    base, share, runs, seed = args
    mde = max(0.02, round(0.15 * base, 3))
    cfg = Config(**{**BASE, "share_b": share, "baseline": base, "mde": mde, "secondary_role": "none",
                    "window_days": 400, "leads_per_day": 10000})
    d = build_design(cfg)
    rng = np.random.default_rng(seed)
    a = _gen(rng, runs, d, cfg, base, base, with_dur=False)
    res = evaluate(a, runs, d, cfg, False, methods=["canary", "naive_peek"])
    kinds = res["canary"]["kind"]
    nk = res["naive_peek"]["kind"]
    return (base, share), {"mde": mde, "n_max": d.n_max,
                           "canary_false_promote": kinds.count("PROMOTE") / runs,
                           "canary_false_harm_stop": kinds.count("STOP_HARM") / runs,
                           "canary_srm_false_alarm": kinds.count("HALT_SRM") / runs,
                           "naive_false_promote": nk.count("PROMOTE") / runs, "runs": runs}


def run_split_cell(args):
    share, n, reps, seed = args
    out = {}
    for mode in ("hash", "balanced", "naive_random"):
        errs, inside, worst = [], 0, 0.0
        for r in range(reps):
            if mode == "naive_random":
                rt = NaiveRouter(share, seed + r)
                b = sum(1 for i in range(n) if rt.assign(f"L{i}") == "B")
            else:
                rt = Router(f"e{seed}-{r}", share, f"salt{r}", mode)
                for i in range(n):
                    rt.assign(f"L{i}")
                    if mode == "balanced" and i >= 499:      # worst deviation at ANY moment after 500 leads
                        worst = max(worst, abs(rt.counts["B"] / (i + 1) - share) * 100)
                b = rt.counts["B"]
            errs.append((b / n - share) * 100)
            lo, hi = binom_ci(b, n)
            inside += lo <= share <= hi
        e = np.abs(np.array(errs))
        out[mode] = {"mean_abs_err_pp": float(e.mean()), "max_abs_err_pp": float(e.max()),
                     "inside_95_band": inside / reps}
        if mode == "balanced":
            out[mode]["worst_prefix_pp"] = worst
    return (share, n), out


def stickiness_test(n_calls: int = 20000, repeat_rate: float = 0.3, share: float = 0.10, seed: int = 5):
    rng = np.random.default_rng(seed)
    leads, calls = [], []
    for i in range(n_calls):
        if leads and rng.random() < repeat_rate:
            calls.append(leads[int(rng.integers(0, len(leads)))])
        else:
            lead = f"L{len(leads):07d}"; leads.append(lead); calls.append(lead)
    out = {"calls": n_calls, "distinct_leads": len(leads), "repeat_calls": n_calls - len(leads)}
    nr = NaiveRouter(share, seed)
    for l in calls:
        nr.assign(l)
    out["naive_random"] = {"repeat_calls": nr.repeat_calls, "arm_flips": nr.flips,
                           "flip_rate": nr.flips / max(1, nr.repeat_calls)}
    for mode in ("hash", "balanced"):
        rt = Router("stick", share, "s", mode)
        first = {}
        flips = 0
        for l in calls:
            arm = rt.assign(l)
            if l in first and first[l] != arm:
                flips += 1
            first.setdefault(l, arm)
        res = {"arm_flips": flips}
        if mode == "hash":
            other = Router("stick", share, "s", "hash")   # an independent server with no shared state
            res["independent_server_disagreements"] = sum(1 for l, a in first.items() if other.assign(l) != a)
        out[mode] = res
    return out


def evaluator_error_study(runs: int, seed: int):
    """What a noisy auto-disposition tagger does to power. Pure model: sensitivity/specificity are inputs."""
    cases = [("perfect tagger", 1.0, 1.0), ("good tagger", 0.95, 0.98), ("decent tagger", 0.90, 0.95),
             ("weak tagger", 0.80, 0.90)]
    out = []
    for name, se, sp in cases:
        cfg = Config(**{**BASE, "secondary_role": "none"})
        a0, b0 = cfg.baseline, cfg.baseline + cfg.mde
        pa = a0 * se + (1 - a0) * (1 - sp)
        pb = b0 * se + (1 - b0) * (1 - sp)
        d = build_design(cfg)
        rng = np.random.default_rng(seed)
        a = _gen(rng, runs, d, cfg, pa, pb, with_dur=False)
        res = evaluate(a, runs, d, cfg, False, methods=["canary"])
        k = res["canary"]["kind"]
        need = seqdesign.plan_sample_size(pa, pb - pa, cfg.share_b, cfg.alpha, cfg.power, cfg.n_looks)["n_max"]
        out.append({"tagger": name, "sensitivity": se, "specificity": sp, "observed_rate_a": pa, "observed_rate_b": pb,
                    "observed_lift_pp": (pb - pa) * 100, "power": k.count("PROMOTE") / runs,
                    "calls_needed_for_80pct_power": need, "calls_planned": d.n_max,
                    "extra_calls_factor": need / d.n_max})
    return out


# ---------------------------------------------------------------------------- the BRD's headline proofs

AA_CFG = dict(share_b=0.30, baseline=0.45, mde=0.05, window_days=7, leads_per_day=1000, rule_set="final_look", min_per_arm=1000)


def aa_study(runs: int, seed: int) -> dict:
    """A vs A under the one-look rule: how often is a winner wrongly declared, and how often does the daily harm check fire by mistake?

    The BRD's target is '~5%'. That is the two-sided 95% test: 5% of identical-prompt tests look different in EITHER direction, about 2.5% in
    B's favour (a false winner: promoted) and about 2.5% against it (logged as a loss: nothing ships). Both are reported."""
    cfg = Config(**AA_CFG)
    d = build_design(cfg)
    rng = np.random.default_rng(seed)
    a = _gen(rng, runs, d, cfg, cfg.baseline, cfg.baseline, with_dur=True)
    r = evaluate(a, runs, d, cfg, True, methods=["canary"])["canary"]
    nv = evaluate(a, runs, d, Config(**{**AA_CFG, "min_per_arm": 50}), True, methods=["naive_peek"])["naive_peek"]["kind"]     # a plain daily p < 0.05 check, from the first 50 leads per prompt
    kinds, cause, look = r["kind"], r["cause"], r["look"]
    cnt = lambda f: sum(1 for k, c, l in zip(kinds, cause, look) if f(k, c, l))
    mk = lambda x: {"count": x, "rate": x / runs, "ci": list(binom_ci(x, runs))}
    K = len(d.look_n)
    promote, hold = cnt(lambda k, c, l: k == "PROMOTE"), cnt(lambda k, c, l: k == "HOLD_FOR_APPROVAL")
    loss = cnt(lambda k, c, l: k == "STOP_HARM" and (c == "loss_at_end" or l == K - 1))             # any last-day call that B is worse is the end-of-test call
    early = cnt(lambda k, c, l: k == "STOP_HARM" and l < K - 1)                                      # the daily harm check, before the last day
    nA, nB = a["nA"], a["nB"]
    checks = 0                                                                                       # daily harm checks that could actually fire: both prompts past the minimum, before the last day
    for m, (k, l) in enumerate(zip(kinds, look)):
        last = l if (k == "STOP_HARM" and l < K - 1) else K - 2
        checks += sum(1 for j in range(0, last + 1) if nA[m][j] >= cfg.min_per_arm and nB[m][j] >= cfg.min_per_arm)
    mk = lambda x: {"count": x, "rate": x / runs, "ci": list(binom_ci(x, runs))}
    return {"runs": runs, "seed": seed, "config": cfg.as_dict(), "days": cfg.window_days, "leads_total": d.look_n[-1],
            "false_winner": mk(promote + hold), "promoted": mk(promote), "held_for_approval": mk(hold), "logged_as_loss": mk(loss),
            "significant_either_way": mk(promote + hold + loss), "early_harm_stop": mk(early),
            "early_harm_stop_per_check": early / max(1, checks), "daily_checks": checks, "halted_split": mk(cnt(lambda k, c, l: k == "HALT_SRM")),
            "no_call": mk(cnt(lambda k, c, l: k == "INCONCLUSIVE")),
            "plain_daily_check_false_winner": mk(nv.count("PROMOTE")), "plain_daily_check_false_stop": mk(nv.count("STOP_HARM"))}


def _attrs_cache(n: int) -> list:
    from . import catalog
    return [catalog.lead_vars(f"L{i:07d}") for i in range(n)]


def split_cell(args):
    """Achieved share and lead mix: the BRD's router (stratified blocks) against a plain coin flip per lead (hash) and a coin flip per call (naive)."""
    from . import catalog
    from .router import StratifiedRouter
    share, n, reps, seed, seg = args
    seg = catalog.validate_segment(seg) if seg else None
    attrs = [a for a in _attrs_cache(int(n / max(catalog.segment_share(seg), 0.05) * 1.3)) if catalog.matches(seg, a)][:n]
    plan = catalog.plan_strata(n, seg)
    out = {}
    for mode in ("stratified", "hash"):
        errs, gaps, both, within = [], {n: [] for n in catalog.BALANCE_VARS}, 0, 0
        for r in range(reps):
            rt = StratifiedRouter(f"s{seed}-{r}", share, f"salt{r}", plan["merged"]) if mode == "stratified" else Router(f"s{seed}-{r}", share, f"salt{r}", "hash")
            for i, a in enumerate(attrs):
                rt.assign(f"L{i:07d}", a)
            both += sum(1 for i, a in enumerate(attrs[:300]) if rt.ledger[f"L{i:07d}"] != rt.assign(f"L{i:07d}", a))          # asked again: nobody changes arm
            err = (rt.counts["B"] / n - share) * 100
            errs.append(err); within += abs(err) <= 0.5
            for name, vals in rt.mix.items():              # the biggest difference, over the values of one balance factor (catalog.BALANCE_VARS), between A's share and B's share
                ta, tb = sum(v[0] for v in vals.values()), sum(v[1] for v in vals.values())
                gaps[name].append(max((abs(v[0] / ta - v[1] / tb) * 100 for v in vals.values()), default=0.0) if ta and tb else 0.0)
        e = np.abs(np.array(errs))
        out[mode] = {"mean_abs_err_pp": float(e.mean()), "p95_abs_err_pp": float(np.percentile(e, 95)), "max_abs_err_pp": float(e.max()), "within_half_pp": within / reps,
                     "mix_gap_pp": {n: {"mean": float(np.mean(g)), "p95": float(np.percentile(g, 95))} for n, g in gaps.items()}, "arm_changes_after_reask": both}
    return {"share": share, "n": n, "segment": catalog.describe(seg), "reps": reps, **out}


SPLIT_SEGMENT = [{"factor": "Legal Status", "column": "legal_status", "values": ["Proprietorship"]}]      # the demo's segmented test: 45% of traffic


def run_split_brd(pool, seed: int) -> list:
    seg = SPLIT_SEGMENT
    jobs = [(0.10, 1000, 60, seed + 1, None), (0.10, 7000, 30, seed + 2, None), (0.30, 1000, 60, seed + 3, None), (0.30, 7000, 30, seed + 4, None),
            (0.30, 3150, 30, seed + 5, seg)]
    return pool.map(split_cell, jobs)


# ---------------------------------------------------------------------------- decisions from files, and the spec's single-look rule

FILE_CASES = {"aa": ("No real difference (A = B)", 0.45, 0.45), "win": ("B truly +7 points", 0.45, 0.52),
              "harm": ("B truly 10 points worse", 0.45, 0.35), "small": ("B truly +1 point", 0.45, 0.46)}


def _file_run(args):
    """One synthetic results file -> CSV text -> decide(): the whole file path, end to end."""
    case, seed = args
    from . import decide, samples
    _, ta, tb = FILE_CASES[case]
    rows = samples.make_rows("b_wins", seed=seed, true_a=ta, true_b=tb, lpd=300, days=14)
    rec = decide.decide([{"name": "f.csv", "text": samples.to_csv(rows), "arm": None}],
                        {"goal": "buylead_created", "share_b": 0.30, "baseline": 0.45, "mde": 0.07, "window_days": 14})
    r = rec["result"]
    return case, r["kind"], r["calls_analysed"], int(r["exposed_b_calls"]), rec["ledger_ok"], rec["source"]["leads_in_both_arms"]


def run_files(runs: int, seed: int, pool) -> dict:
    """Does a decision made from a results file behave like the proven engine? A/A files must rarely crown a winner."""
    n = {"aa": runs, "win": runs // 2, "harm": runs // 2, "small": runs // 4}
    jobs = [(c, seed + 10_000 * i + j) for i, (c, m) in enumerate(n.items()) for j in range(m)]
    out = {c: {"label": FILE_CASES[c][0], "kinds": [], "n": [], "expB": [], "ledger_ok": 0, "contaminated": 0} for c in FILE_CASES}
    for case, kind, nn, eb, ok, cont in pool.map(_file_run, jobs, chunksize=8):
        o = out[case]
        o["kinds"].append(kind); o["n"].append(nn); o["expB"].append(eb); o["ledger_ok"] += int(ok); o["contaminated"] += int(cont or 0)
    res = {}
    for c, o in out.items():
        res[c] = {"label": o["label"], **_summ(o["kinds"], o["n"], o["expB"]), "ledger_ok": o["ledger_ok"], "files_with_two_prompt_leads": o["contaminated"]}
    return res


RULESETS = {"aa": ("No real difference (A = B)", 0.45, 0.45), "small": ("B truly +3 points", 0.45, 0.48),
            "win": ("B truly +7 points", 0.45, 0.52), "harm": ("B truly 7 points worse", 0.45, 0.38)}


def run_ruleset_case(args):
    key, runs, seed = args
    _, ta, tb = RULESETS[key]
    out = {}
    base = dict(share_b=0.30, baseline=0.45, mde=0.03, window_days=14, leads_per_day=300, secondary_role="none")   # same window, same data volume
    for rs, methods in (("sequential", ["canary", "naive_peek"]), ("final_look", ["canary", "naive_peek"])):
        cfg = Config(**{**base, "rule_set": rs})
        d = build_design(cfg)
        rng = np.random.default_rng(seed)
        a = _gen(rng, runs, d, cfg, ta, tb, with_dur=False)
        res = evaluate(a, runs, d, cfg, False, methods=methods)
        out[rs] = {m: _summ(r["kind"], r["n"], r["expB"]) for m, r in res.items()}
        out[rs]["looks"] = len(d.look_n); out[rs]["final_n"] = d.look_n[-1]
    return key, out


def run_rulesets(runs: int, seed: int, pool) -> dict:
    """The dashboard spec's rule (one winner call at the end + a strict daily harm check) against ours, on identical traffic."""
    cases = dict(pool.map(run_ruleset_case, [(k, runs, seed + 50 * i) for i, k in enumerate(RULESETS)]))
    return {k: {"label": RULESETS[k][0], "true_a": RULESETS[k][1], "true_b": RULESETS[k][2], **v} for k, v in cases.items()}


def run_all(runs: int = 4000, aa_runs: int = 12000, seed: int = 20261009, progress=print) -> dict:
    t0 = time.time()
    proof = {"seed": seed, "runs": runs, "aa_runs": aa_runs,
             "config": Config(**BASE).as_dict(), "design": {}}
    d = build_design(Config(**BASE))
    proof["design"] = {"n_max": d.n_max, "n_fixed": d.n_fixed, "inflation": d.inflation, "looks": len(d.look_n),
                       "efficacy_bounds_first_last": [d.eff[0], d.eff[-1]]}
    with Pool(min(10, 12)) as pool:
        progress("scenarios...")
        jobs = [(k, aa_runs if k in ("aa", "srm_bug") else runs, seed + i) for i, k in enumerate(PROOF_SCENARIOS)]
        proof["scenarios"] = dict(pool.map(run_scenario, jobs))
        progress("looks sweep...")
        proof["looks_sweep"] = {str(k): v for k, v in pool.map(run_looks_sweep, [(K, aa_runs // 2, seed + 100 + K) for K in (1, 2, 3, 5, 10, 20, 40)])}
        progress("logging-bug sweep...")
        proof["logging_bug_sweep"] = {str(k): v for k, v in pool.map(run_bug_sweep, [(dr, runs, seed + 700 + i) for i, dr in enumerate((0.0, 0.05, 0.10, 0.20, 0.35, 0.50))])}
        progress("robustness grid...")
        cells = pool.map(run_grid_cell, [(b, s, runs, seed + 200 + i) for i, (b, s) in enumerate(
            [(b, s) for b in (0.10, 0.45, 0.60) for s in (0.05, 0.10, 0.45)])])
        proof["grid"] = [{"baseline": b, "share": s, **v} for (b, s), v in cells]
        progress("split accuracy...")
        sp = pool.map(run_split_cell, [(s, n, 100 if n <= 1100 else 60, 300 + i) for i, (s, n) in enumerate(
            [(s, n) for s in (0.05, 0.10, 0.20, 0.30, 0.45) for n in (237, 1037, 5037)])])
        proof["split_accuracy"] = [{"share": s, "n": n, **v} for (s, n), v in sp]
        progress("decisions from files (end to end)...")
        proof["files"] = run_files(max(200, runs // 7), seed + 3000, pool)
        progress("spec's single-look rule vs ours...")
        proof["rulesets"] = run_rulesets(runs, seed + 4000, pool)
        progress("the BRD's A vs A study and split quality...")
        proof["aa_brd"] = aa_study(aa_runs, seed + 5000)
        proof["split_brd"] = run_split_brd(pool, seed + 6000)
    progress("stickiness...")
    proof["stickiness"] = stickiness_test()
    progress("evaluator error...")
    proof["evaluator_error"] = evaluator_error_study(runs, seed + 900)
    proof["seconds"] = round(time.time() - t0, 1)
    return proof


def main(runs: int = 4000, aa_runs: int = 12000):
    OUT.mkdir(exist_ok=True)
    proof = run_all(runs, aa_runs)
    (OUT / "proof.json").write_text(json.dumps(proof, indent=1))
    print(f"proof.json written in {proof['seconds']}s")
    return proof


if __name__ == "__main__":
    main()
