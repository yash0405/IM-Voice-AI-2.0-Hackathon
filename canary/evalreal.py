"""Score a tagger on REAL hand labels once transcripts exist.

    python -m canary eval --transcripts DIR      # DIR holds <idx>.txt (or .json turns) per labelled call
With no transcripts it reports what is missing, plus the synthetic benchmark for the plumbing.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import labels
from .evaluator import RuleEvaluator, metrics
from .synth import benchmark_report


def run(transcripts_dir: str | None = None) -> dict:
    lab = labels.consensus_labels()
    out = {"real_labels": len(lab), "synthetic_benchmark_accuracy": benchmark_report()["overall"]["accuracy"]}
    if not lab:
        out["status"] = "no real labels yet: use the Label Lab (python -m canary serve)"
        return out
    if not transcripts_dir:
        out["status"] = "labels exist but no --transcripts folder given (needs Sarvam speech-to-text output)"
        return out
    ev, truth, pred = RuleEvaluator(), [], []
    for idx, label in lab.items():
        for ext in ("txt", "json"):
            p = Path(transcripts_dir) / f"{idx}.{ext}"
            if p.exists():
                t = json.loads(p.read_text()) if ext == "json" else p.read_text()
                truth.append(label); pred.append(ev.classify(t)["label"]); break
    out["scored_calls"] = len(truth)
    if truth:
        out["metrics"] = metrics(truth, pred)
    return out
