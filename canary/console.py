"""Data for the console: the dashboard that follows the PS05 feature spec (Overview, New Experiment, Live Experiments, History,
Suggest A/B Tests, Prompt Library, Decision Log, Settings).

Everything the console shows comes from here and from the engine; the console itself only draws it. Three things are simulated on
purpose and labelled as such in the interface: the call outcomes of the demo experiments (an injected known effect), the daily
volume (an assumption to replace with the real one), and the history of past tests (re-runs of our scenarios and sample result files).
"""
from __future__ import annotations

import json
from pathlib import Path

from . import catalog, decide, fixloop, history, metriclib, planner, promptlint, samples, variants
from .engine import Config, run_experiment
from .evaluator import load_dispositions
from .scenarios import make, order
from .simulator import Scenario, TrafficSim

DATA = Path(__file__).resolve().parent.parent / "data"

DEFAULTS = {"confidence": 0.95, "power": 0.80, "harm_bar": 0.999, "min_leads_per_arm": 500, "improvement_pts": 5, "min_days": 7, "max_days": 28, "approval": "auto", "rule_set": "final_look", "duration_margin": 0.10,
            "rate_margin_pp": 2, "window_days": 7, "share_b": 0.30, "baseline": 0.45, "lift_rel": 0.10, "mde": 0.045, "leads_per_day": 1000, "assignment": "stratified", "holdback": 0.05, "holdback_days": 7,
            "leads_per_day_note": "An assumption: no real daily volume was provided. Replace it with yours in Settings."}

# The spec's demo: three experiments set up in advance, each paused on day 2 (B wins, B worse, flat). The truth is a RELATIVE effect, as in the spec.
DEMO = [
    dict(key="demo_win", name="Ask for any single detail at most twice", variant="cap_two_asks", preset="B wins", effect=+0.15, seed=6, start="2026-10-05T09:00:00",
         hypothesis="Capping every question at two asks will stop looping and keep buyers engaged. Expected effect: +15% BuyLeads.", day=2),
    dict(key="demo_worse", name="Make the ask limits agree with each other", variant="reconcile_limits", preset="B worse", effect=-0.15, seed=2, start="2026-10-06T09:00:00",
         hypothesis="Making the stated limits agree will remove contradictions. (Demo truth: this edit backfires by 15%.)", day=2),
    dict(key="demo_flat", name="Warmer opening line", variant="reconcile_limits", preset="Flat", effect=0.0, seed=6, start="2026-10-07T09:00:00",
         hypothesis="A warmer first sentence will make more buyers stay on the line. (Demo truth: it changes nothing.)", day=2),
    dict(key="demo_segment", name="Proprietors: ask for any detail at most twice", variant="cap_two_asks", preset="B wins, one segment", effect=+0.15, seed=7, start="2026-10-09T09:00:00", over={"mde": 0.07},
         segment=[{"factor": "Legal Status", "column": "legal_status", "values": ["Proprietorship"]}],
         hypothesis="Only proprietors are in this test; every other lead keeps today's prompt and is not counted. (Demo truth: +15% BuyLeads for proprietors.)", day=2),
    dict(key="demo_hold", name="Offer the seller details on WhatsApp earlier", variant="whatsapp_after_call", preset="B wins, calls longer", effect=+0.15, seed=5, start="2026-10-08T09:00:00", dur_mult=1.12,
         hypothesis="Offering the WhatsApp details sooner should lift BuyLeads. (Demo truth: +15% BuyLeads, but calls run 12% longer, just past the 10% limit: the bonus scenario, held for a person.)", day=2),
]


def slim(rec: dict) -> dict:
    """The console never needs the full prompt text: keep names, hashes and the diff."""
    out = dict(rec)
    out["variants"] = {k: {kk: vv for kk, vv in v.items() if kk != "text"} for k, v in rec["variants"].items()}
    return out


DEMO_MIN_LEADS = 1000      # the five demo tests were set up with 1,000 leads per prompt before the daily harm check; kept so their recorded runs do not change


def demo_config(name: str, variant: str, start: str, exp_id: str, **over) -> Config:
    d = DEFAULTS
    base = dict(exp_id=exp_id, name=name, variant_b=variant, share_b=d["share_b"], baseline=d["baseline"], mde=d["mde"], window_days=d["window_days"],
                leads_per_day=d["leads_per_day"], rule_set=d["rule_set"], alpha=(1 - d["confidence"]) / 2, alpha_harm_daily=1 - d["harm_bar"],
                guardrail_margin=d["duration_margin"], assignment=d["assignment"], start=start, approval=d["approval"], min_per_arm=DEMO_MIN_LEADS)
    return Config(**{**base, **over}).validate()


def early_hangup_share() -> float:
    """Share of the real recordings shorter than 15 seconds: the simulator's early-hang-up rate under A (measured, 100 of 713)."""
    from .simulator import real_durations
    d = real_durations()
    return round(float((d < 15).mean()), 4)


def run_preset(name: str, variant: str, start: str, exp_id: str, effect: float, seed: int, dur_mult: float = 1.0, hang_extra: float = 0.0, **over) -> dict:
    """`hang_extra` (absolute, 0.03 = 3 points) is how much MORE often B's calls end in the first 15 seconds; it matters only when the early-hang-up guardrail is on."""
    cfg = demo_config(name, variant, start, exp_id, **over)
    ha = early_hangup_share() if cfg.guard_rate else 0.0
    sc = Scenario(key=exp_id, title=name, story="", expect="-", true_a=cfg.baseline, true_b=round(cfg.baseline * (1 + effect), 4), seed=seed, dur_mult_b=dur_mult,
                  event_a=ha, event_b=min(0.99, ha + hang_extra) if cfg.guard_rate else 0.0)
    rec = run_experiment(cfg, TrafficSim(sc))
    return rec


def demo_experiments() -> list[dict]:
    out = []
    for d in DEMO:
        rec = run_preset(d["name"], d["variant"], d["start"], "exp-" + d["key"].replace("_", "-"), d["effect"], d["seed"], d.get("dur_mult", 1.0),
                         **({"segment": catalog.validate_segment(d["segment"])} if d.get("segment") else {}), **d.get("over", {}))
        out.append({"id": d["key"], "kind": "simulated", "preset": d["preset"], "hypothesis": d["hypothesis"], "start_day": d["day"],
                    "truth": {"effect_rel": d["effect"], "true_a": rec["config"]["baseline"], "true_b": round(rec["config"]["baseline"] * (1 + d["effect"]), 4)},
                    "record": slim(rec)})
    return out


def past_tests() -> list[dict]:
    """Finished tests for the History screen: our scenarios re-run with earlier start dates, plus the sample result files."""
    out = []
    keys = ["fix_ships", "fix_harms", "fix_flat", "b_wins", "b_harmful", "inconclusive", "peeking_trap", "srm_broken", "guardrail_veto", "guardrail_hold"]
    keys = [k for k in keys if k in order()]
    from datetime import datetime, timedelta
    t0 = datetime(2026, 6, 1, 9)                       # one timeline, a test starting every week, all finished before the demo day
    n_sim = len(keys)
    for i, key in enumerate(keys):
        cfg, sim, sc = make(key)
        cfg = Config(**{**cfg.as_dict(), "start": (t0 + timedelta(days=7 * i)).isoformat(timespec="seconds"), "assignment": "stratified"})
        rec = run_experiment(cfg, sim)
        out.append({"id": f"past_{key}", "kind": "simulated", "preset": sc.title, "hypothesis": sc.story,
                    "truth": {"true_a": sc.true_a, "true_b": sc.true_b}, "record": slim(rec)})
    # the sample result files: the test ran elsewhere, we judged its results
    for i, (key, sp) in enumerate(samples.SAMPLES.items()):
        start = (t0 + timedelta(days=7 * (n_sim + i))).date().isoformat()
        rows = samples.make_rows(key, start=start + "T00:00:00")
        opts = dict(goal="buylead_created", share_b=0.30, baseline=0.45, mde=0.07, window_days=14, exp_id=f"files-{key}", name=sp["title"],
                    **({"guard_name": "early_hangup", "guard_below_s": 15} if key == "early_hangup" else {}))
        rec = decide.decide([{"name": f"results_{key}.csv", "text": samples.to_csv(rows), "arm": None}], opts)
        truth, _, expected = sp["note"].partition(": expected ")
        out.append({"id": f"files_{key}", "kind": "files", "preset": sp["title"], "hypothesis": f"Results supplied as a file (synthetic). Truth put into it: {truth}.",
                    "truth": None, "record": slim(rec)})
    return out


def library() -> dict:
    base = variants.load_base()
    versions = [{"id": "v1", "name": "VANI buyer-side prompt (real prompt, as received)", "hash": base["hash"], "origin": "provided", "parent": None,
                 "lines": base["text"].count("\n") + 1, "diff": [], "variables": {"ok": True, "dropped": [], "added": [], "base": promptlint.variables(base["text"])},
                 "lint": promptlint.analyse(base["text"]).get("n_conflicts", None)}]
    cands = []
    texts = {}
    for key in ("reconcile_limits", "cap_two_asks", "whatsapp_after_call"):
        v = variants.make_variant(key)
        texts[key] = v["text"]
        cmp = promptlint.compare(base["text"], v["text"])
        cands.append({"key": key, "name": v["name"], "hash": v["hash"], "origin": v["origin"], "diff": v["diff"], "variables": promptlint.variable_report(base["text"], v["text"]),
                      "lint_before": cmp.get("before", {}).get("n") if isinstance(cmp.get("before"), dict) else cmp.get("before"),
                      "lint_after": cmp.get("after", {}).get("n") if isinstance(cmp.get("after"), dict) else cmp.get("after"), "lint_ok": cmp.get("ok", True)})
    import difflib
    pair = {}
    for a, ta in texts.items():                           # what changes between two versions (the edits are all on the base prompt)
        for b, tb in texts.items():
            if a != b:
                pair[f"{a}>{b}"] = list(difflib.unified_diff(ta.splitlines(), tb.splitlines(), "previous version", "this version", lineterm="", n=1))[:300]
    specs = variants._candidates()
    edits = {k: {op: specs[k].get(op, []) for op in ("edit", "remove", "add")} for k in texts}
    return {"pair_diffs": pair, "base": versions[0], "candidates": cands, "edits": edits, "variables": promptlint.variables(base["text"]), "base_text": base["text"], "base_lines": base["text"].count("\n") + 1}


def suggestions() -> list[dict]:
    """Ideas for the next tests, each with the evidence behind it. Nothing is invented: where a source has no data the card says so."""
    F = fixloop.bundle()
    mine, plan = F["mine"], F["plan"]
    cards = []
    top = next((i for i in mine["issues"] if i["key"] == mine["target"]), None)
    if top:
        cards.append({"id": "gap", "source": "Disposition gaps", "title": "Calls that end abruptly convert far less",
                      "hypothesis": f"{top['calls']} of {mine['n_connected']} connected calls ended abruptly and converted {top['converted_with']:.0%} against {top['converted_without']:.0%} for the rest "
                                    f"(machine labels, not yet checked by a person). Ask for the next missing detail before closing.",
                      "change": None, "change_note": "Not drafted yet. A Sarvam draft costs about Rs 1 and needs your go-ahead.",
                      "metric": "buylead_created", "expected": f"at most +{top['ceiling_pp']} points (if every such call were fixed)", "expected_pp": top["ceiling_pp"],
                      "days": None, "ease": 2, "caveat": "An association, not a cause; only the A/B test shows whether the edit helps.", "variant": None})
    cards.append({"id": "lint", "source": "Prompt review", "title": "The prompt's own limits contradict each other",
                  "hypothesis": "Three places give different ask limits for the same thing (any slot 2 vs 3, buyer name 2 vs 3, product 4 vs 5). IndiaMART's quality matrix grades probing a parameter more than 1+2 times as fatal.",
                  "change": "reconcile_limits", "change_note": "4 edits, no new contradiction, every template variable kept.", "metric": "buylead_created",
                  "expected": "about +1 point at most (a consistency fix)", "expected_pp": 1.0, "days": None, "ease": 3,
                  "caveat": "Verbatim loops are rare (1.7% of calls), so the effect is small; proving 1 point needs tens of thousands of leads.", "variant": "reconcile_limits"})
    cards.append({"id": "loops", "source": "Call transcripts", "title": "Cap every question at two asks",
                  "hypothesis": "A small share of calls repeat the same question three or more times (a lower bound: the scan only sees near-identical repeats).",
                  "change": "cap_two_asks", "change_note": "9 small edits; reviewed by a person.", "metric": "buylead_created", "expected": "about +1 to +3 points (a guess)", "expected_pp": 2.0,
                  "days": None, "ease": 2, "caveat": "A planning guess, not a measurement.", "variant": "cap_two_asks"})
    cards.append({"id": "segments", "source": "Weak segments", "title": "Find the categories or cities where conversion is weakest",
                  "hypothesis": "Needs a category, city or lead type on every call. The recordings carry none, so this idea cannot be generated yet.",
                  "change": None, "change_note": "Unavailable: no segment data.", "metric": None, "expected": "-", "expected_pp": 0, "days": None, "ease": 0,
                  "caveat": "Shown so the gap is visible; nothing is invented.", "variant": None, "disabled": True})
    cards.append({"id": "past", "source": "Past tests", "title": "Re-run an inconclusive test for longer",
                  "hypothesis": "A past test ended without evidence either way. The result says how many more leads would settle it.",
                  "change": None, "change_note": "Uses the same edit as the original test.", "metric": "buylead_created", "expected": "settles whether a smaller lift is real", "expected_pp": 0,
                  "days": None, "ease": 3, "caveat": "", "variant": None, "from_history": "inconclusive"})
    return cards


def metrics() -> list[dict]:
    """The metric list (Settings > Metrics and every screen that names a metric): built from the one metric catalog, canary/metriclib.py."""
    return [{**m, "direction": ("higher" if m["direction"] == "higher" else "lower") + " is better",
             "def": metriclib.definition(m), "available": m.get("available", True)} for m in metriclib.BUILTIN]


def console_bundle() -> dict:
    demo = demo_experiments()
    past = past_tests()
    # days needed for each suggestion, from the same calculator the wizard uses
    sg = suggestions()
    d = DEFAULTS
    for c in sg:
        if c.get("expected_pp"):
            p = planner.plan_one(d["baseline"], max(0.005, c["expected_pp"] / 100), d["share_b"], d["duration_margin"])
            c["days"] = round(p["n_max"] / d["leads_per_day"], 1)
            c["leads"] = p["n_max"]
    proof = None
    pj = DATA.parent / "out" / "proof.json"
    if pj.exists():
        P = json.loads(pj.read_text())
        rs = (P.get("rulesets") or {}).get("aa")
        rate = lambda m, k: m["outcomes"].get(k, {"rate": 0})["rate"]
        if rs:
            ci = rs["final_look"]["canary"]["outcomes"].get("PROMOTE", {"ci": [0, 0]})["ci"]
            proof = {"final_look_ci": ci, "final_look": rate(rs["final_look"]["canary"], "PROMOTE"), "sequential": rate(rs["sequential"]["canary"], "PROMOTE"), "naive": rate(rs["final_look"]["naive_peek"], "PROMOTE"),
                     "naive_wrong": rate(rs["final_look"]["naive_peek"], "PROMOTE") + rate(rs["final_look"]["naive_peek"], "STOP_HARM"), "runs": rs["sequential"]["canary"]["runs"]}
        aa = P.get("aa_brd")
        if aa:                       # the BRD's own study on the console's defaults (7 days, 1,000 leads a day, 30% to B): these are the numbers shown first
            ci2 = aa["false_winner"]["ci"]
            proof = {**(proof or {}), "final_look": aa["false_winner"]["rate"], "final_look_ci": ci2, "either": aa["significant_either_way"]["rate"], "loss": aa["logged_as_loss"]["rate"], "runs": aa["runs"],
                     "early_harm_stop": aa["early_harm_stop"]["rate"], "naive": aa.get("plain_daily_check_false_winner", {}).get("rate", (proof or {}).get("naive")),
                     "naive_wrong": (aa.get("plain_daily_check_false_winner", {}).get("rate", 0) + aa.get("plain_daily_check_false_stop", {}).get("rate", 0)) or (proof or {}).get("naive_wrong"), "aa_brd": aa}
        RS = P.get("rulesets") or {}
        if RS.get("harm") and RS.get("win") and proof:
            h, w = RS["harm"], RS["win"]
            hit = lambda m: sum(rate(m, k) for k in ("STOP_HARM", "STOP_GUARDRAIL"))
            hs, hf = h["sequential"]["canary"], h["final_look"]["canary"]
            ps, pf = w["sequential"]["canary"], w["final_look"]["canary"]
            proof["rules"] = {"harm_sequential": hit(hs), "harm_final": hit(hf), "exposure_saved": 1 - hs["mean_exposure_b"] / hf["mean_exposure_b"] if hf["mean_exposure_b"] else 0,
                              "sooner": round(100 * (1 - ps["median_n_when_promoted"] / pf["median_n_when_promoted"])) if ps.get("median_n_when_promoted") and pf.get("median_n_when_promoted") else None}
        if P.get("split_brd") and proof is not None:
            proof["split_brd"] = P["split_brd"]
    return {"version": "console-3", "defaults": {**DEFAULTS, "early_hangup_share": early_hangup_share()}, "catalog": catalog.bundle([c["name"] for c in history.COLUMNS]), "history": history.bundle(), "metric_catalog": metriclib.catalog_bundle(), "proof": proof, "demo": demo, "past": past, "library": library(), "suggestions": sg, "metrics": metrics(),
            "dispositions": load_dispositions(), "plans": planner.grid(), "spec_check": planner.spec_calculator_check(),
            "tools": {"proof": (DATA.parent / "out" / "proof.json").exists()}}
