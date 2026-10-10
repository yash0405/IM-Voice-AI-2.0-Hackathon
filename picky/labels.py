"""Human labels for the real recordings (the Label Lab writes here).

We were given 713 recordings and no labels. Labels give us (a) a real baseline rate for the goal
disposition (BuyLead created), with an honest interval, (b) the ground truth to score any auto-tagger,
(c) real data-capture and bot-error rates. Two labellers on the same calls give an agreement score,
so the label quality is itself measured.
"""
from __future__ import annotations

import json
import random
import time
from collections import Counter
from pathlib import Path

from .evaluator import load_dispositions, load_schema
from .stats import cohen_kappa, wilson

DATA = Path(__file__).resolve().parent.parent / "data"
LABELS = DATA / "labels.jsonl"
RECORDINGS = Path(__file__).resolve().parent.parent.parent / "Resources" / "call_recordings"
GOAL = "buylead_created"


def calls() -> list[dict]:
    rows = json.loads((DATA / "call_durations.json").read_text())
    rng = random.Random(2026)
    rng.shuffle(rows)        # same order for every labeller, so overlap is automatic
    return rows


def _read() -> list[dict]:
    if not LABELS.exists():
        return []
    return [json.loads(l) for l in LABELS.read_text().splitlines() if l.strip()]


def add(idx: int, labeler: str, label: str, note: str = "", fields=None, flags=None) -> dict:
    schema = load_schema()
    keys = {d["key"] for d in schema["dispositions"]}
    if label not in keys:
        raise ValueError(f"unknown label {label!r}")
    if not labeler.strip():
        raise ValueError("labeler name required")
    fk = {f["key"] for f in schema["fields"]}; gk = {f["key"] for f in schema["flags"]}
    fields = [f for f in (fields or []) if f in fk]
    flags = [f for f in (flags or []) if f in gk]
    row = {"idx": int(idx), "labeler": labeler.strip(), "label": label, "fields": fields, "flags": flags,
           "note": note[:200], "ts": int(time.time())}
    with LABELS.open("a") as f:
        f.write(json.dumps(row) + "\n")
    return row


def latest() -> dict[tuple, dict]:
    """Last label per (labeler, call) - relabelling overwrites."""
    out = {}
    for r in _read():
        out[(r["labeler"], r["idx"])] = r
    return out


def next_for(labeler: str) -> dict | None:
    done = {i for (who, i) in latest() if who == labeler}
    for c in calls():
        if c["idx"] not in done:
            return c
    return None


def next_review(labeler: str) -> dict | None:
    """Calls a human should spot-check: a BLIND random set first (no machine hint, for an unbiased accuracy), then the
    least-confident machine labels (with the machine's suggestion to confirm or fix)."""
    from . import sarvam_pipe as sp
    if not sp.QUEUE.exists():
        return None
    q = json.loads(sp.QUEUE.read_text())
    done = {i for (who, i) in latest() if who == labeler}
    rows = {r["idx"]: r for r in calls()}
    for kind in ("blind", "hard"):
        for i in q.get(kind, []):
            if i not in done and i in rows:
                f = sp.AL / f"{i}.json"
                machine = json.loads(f.read_text()) if (kind == "hard" and f.exists()) else None
                if machine and machine.get("schema", 1) < 2:
                    machine = None                    # labels from before the real prompt use another vocabulary: no hint
                return {**rows[i], "review": True, "blind": kind == "blind", "machine": machine,
                        "queue_left": sum(1 for k in ("blind", "hard") for j in q.get(k, []) if j not in done)}
    return None


def summary(goal: str = GOAL) -> dict:
    lat = latest()
    by_who = Counter(w for (w, _) in lat)
    per_call: dict[int, dict[str, dict]] = {}
    for (w, i), r in lat.items():
        per_call.setdefault(i, {})[w] = r
    out = {"total_calls": len(calls()), "labellers": dict(by_who), "labelled_calls": len(per_call)}
    cons, first = {}, {}
    for i, d in per_call.items():
        labs = [r["label"] for r in d.values()]
        if len(set(labs)) == 1:
            cons[i] = labs[0]; first[i] = next(iter(d.values()))
    out["consensus_calls"] = len(cons)
    dist = Counter(cons.values())
    out["distribution"] = dict(dist)
    n = len(cons)
    if n:
        k = dist.get(goal, 0)
        lo, hi = wilson(k, n)
        out["goal"] = goal
        out["goal_rate"] = {"rate": k / n, "ci": [lo, hi], "n": n}
        err = sum(1 for i in cons if "bot_error" in first[i].get("flags", []))
        elo, ehi = wilson(err, n)
        out["bot_error_rate"] = {"rate": err / n, "ci": [elo, ehi], "n": n}
        got = [i for i in cons if cons[i] in (goal, "partial")]
        if got:
            out["field_capture"] = {f["key"]: sum(1 for i in got if f["key"] in first[i].get("fields", [])) / len(got)
                                    for f in load_schema()["fields"]}
            out["field_capture_n"] = len(got)
    ws = [w for w, _ in by_who.most_common(2)]
    if len(ws) == 2:
        shared = [i for i, d in per_call.items() if ws[0] in d and ws[1] in d]
        if shared:
            a = [per_call[i][ws[0]]["label"] for i in shared]; b = [per_call[i][ws[1]]["label"] for i in shared]
            out["agreement"] = {"labellers": ws, "shared": len(shared),
                                "raw": sum(x == y for x, y in zip(a, b)) / len(shared),
                                "kappa": cohen_kappa(a, b)}
    out["target"] = 60
    return out


def consensus_labels() -> dict[int, str]:
    per_call: dict[int, dict[str, str]] = {}
    for (w, i), r in latest().items():
        per_call.setdefault(i, {})[w] = r["label"]
    return {i: list(d.values())[0] for i, d in per_call.items() if len(set(d.values())) == 1}
