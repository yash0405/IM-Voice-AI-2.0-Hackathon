"""Bundle everything the dashboard shows into one JSON, and into one offline HTML file."""
from __future__ import annotations

import json
import time
from pathlib import Path

from . import arena, fixloop, labels, planner, sarvam_pipe
from .engine import run_experiment
from .evaluator import load_dispositions
from .scenarios import ORDER, SCENARIOS, make, order
from .synth import benchmark_report
from .variants import load_base

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
WEB = ROOT / "web"
DIST = ROOT / "dist"


def scenario_bundle(key: str, seed: int | None = None, cfg_over: dict | None = None, sc_over: dict | None = None):
    from dataclasses import replace
    from .engine import Config
    from .scenarios import BASE
    from .simulator import TrafficSim
    cfg, sim, sc = make(key, seed)
    if sc_over:
        sc = replace(sc, **sc_over)
        sim = TrafficSim(sc)
    if cfg_over:
        cfg = Config(**{**cfg.as_dict(), **cfg_over}).validate()
    rec = run_experiment(cfg, sim)
    again = run_experiment(Config(**rec["config"]), TrafficSim(sc))
    replay = {"same_decision": again["result"]["kind"] == rec["result"]["kind"],
              "same_ledger_head": again["ledger_head"] == rec["ledger_head"]}
    meta = {k: getattr(sc, k) for k in ("key", "title", "story", "expect", "true_a", "true_b", "seed",
                                        "dur_mult_b", "log_drop_b", "repeat_rate")}
    return {"meta": meta, "record": rec, "replay": replay}


FILE_OPTS = dict(goal="buylead_created", share_b=0.30, baseline=0.45, mde=0.07, window_days=14)
FILE_EXTRA = {"early_hangup": dict(guard_name="early_hangup", guard_below_s=15)}


def files_demo() -> list:
    """The synthetic sample results files, decided by the same code path as an uploaded file (works offline in the dashboard)."""
    from . import decide, samples
    out = []
    for key, sp in samples.SAMPLES.items():
        name = f"results_{key}.csv"
        opts = {**FILE_OPTS, **FILE_EXTRA.get(key, {}), "exp_id": f"files-{key}", "name": sp["title"]}
        rec = decide.decide([{"name": name, "text": samples.to_csv(samples.make_rows(key)), "arm": None}], opts)
        truth, _, expected = sp["note"].partition(": expected ")
        meta = {"key": f"file_{key}", "title": sp["title"], "story": f"Synthetic results file. Truth put into it: {truth}. Expected decision: {expected}", "expect": "-", "true_a": None, "true_b": None, "seed": None, "source": "files"}
        out.append({"key": key, "title": sp["title"], "note": sp["note"], "opts": opts, "meta": meta, "record": rec})
    return out


def build_bundle() -> dict:
    OUT.mkdir(exist_ok=True)
    proof_path = OUT / "proof.json"
    return {
        "version": "0.1.0", "generated": time.strftime("%Y-%m-%d %H:%M"),
        "scenarios": [scenario_bundle(k) for k in order()],
        "fix": fixloop.bundle(),
        "files_demo": files_demo(),
        "proof": json.loads(proof_path.read_text()) if proof_path.exists() else None,
        "evalbench": benchmark_report(),
        "plans": planner.grid(),
        "labels": labels.summary(),
        "auto": sarvam_pipe.auto_info(),
        "arena": arena.load(),
        "dispositions": load_dispositions(),
        "base_prompt": {k: v for k, v in load_base().items() if k != "text"},
        "live": False,
    }


def build_html(bundle: dict | None = None) -> Path:
    bundle = bundle or build_bundle()
    DIST.mkdir(exist_ok=True)
    html = (WEB / "index.html").read_text()
    css = (WEB / "style.css").read_text()
    js = (WEB / "simple.js").read_text() + "\n" + (WEB / "app.js").read_text()
    data = json.dumps(bundle, separators=(",", ":")).replace("</", "<\\/")
    html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>{css}</style>")
    html = html.replace('<script src="simple.js"></script>\n', "").replace('<script src="app.js"></script>', f"<script>window.CANARY_DATA={data};</script><script>{js}</script>")
    import shutil
    if arena.ARENA.exists():
        shutil.copytree(arena.ARENA, DIST / "arena", dirs_exist_ok=True)      # audio for the offline demo
    out = DIST / "canary_demo.html"
    out.write_text(html)
    (OUT / "bundle.json").write_text(json.dumps(bundle))
    return out
