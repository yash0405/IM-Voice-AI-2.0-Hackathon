"""Sample results files, so the 'decide from files' path can be shown and tested without the voice platform.

These files are SYNTHETIC. They come from the same traffic simulator as the scenarios: outcomes are drawn from a known truth that
is written in SAMPLES, and call durations are resampled from the 713 real recordings. They exist to prove the engine reads files and
decides correctly; they say nothing about how a real prompt performs. The format is deliberately plain so a real export can be
renamed to match it (one row per call: call_id, lead_id, timestamp, variant, disposition, duration_s, connected).
"""
from __future__ import annotations

import csv
import hashlib
import io
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

from .simulator import real_durations

DATA = Path(__file__).resolve().parent.parent / "data"
OUTDIR = DATA / "samples"

LOSSES = [("requirement_unconfirmed", .30), ("particular_seller_only", .20), ("no_requirement", .30), ("no_connect", .12), ("other", .08)]

SAMPLES = {
    "b_wins": dict(title="B wins", true_a=.45, true_b=.52, share=.30, days=14, lpd=300, seed=101,
                   note="B truly +7 points: expected PROMOTE"),
    "b_harmful": dict(title="B is worse", true_a=.45, true_b=.35, share=.30, days=14, lpd=300, seed=102,
                      note="B truly -10 points: expected STOP_HARM"),
    "b_flat": dict(title="No real difference", true_a=.45, true_b=.45, share=.30, days=14, lpd=300, seed=103,
                   note="A and B identical: expected INCONCLUSIVE with a 'more leads needed' answer"),
    "guardrail_hold": dict(title="B wins but calls run longer", true_a=.45, true_b=.52, share=.30, days=14, lpd=150, seed=104, dur_mult_b=1.20,
                           note="B +7 points but 20% longer calls: expected HOLD_FOR_APPROVAL"),
    "early_hangup": dict(title="B wins but more early hang-ups", true_a=.45, true_b=.52, share=.30, days=14, lpd=300, seed=105, short_b=.06,
                         note="B +7 points but 6 points more calls under 15 s: expected a stop on the hang-up guardrail (run with guard_below_s=15)"),
    "messy": dict(title="A messy export", true_a=.45, true_b=.52, share=.30, days=14, lpd=300, seed=106, messy=True,
                  note="B truly +7 points, but a messy export (duplicates, other variant names, leads served both prompts, unknown variants): expected PROMOTE, with the data notes listing what was found"),
}
FIELDS = ["call_id", "lead_id", "timestamp", "variant", "disposition", "duration_s", "connected"]


def _arm(lead: str, exp: str, share: float) -> str:
    u = int.from_bytes(hashlib.sha256(f"{exp}:{lead}".encode()).digest()[:8], "big") / 2 ** 64
    return "B" if u < share else "A"


def make_rows(key: str, seed: int | None = None, **over) -> list[dict]:
    """The rows of one sample file. `seed` and `over` (true_a, true_b, lpd, days, ...) let the proof lab draw many files from one recipe."""
    sp = {**SAMPLES[key], **over}
    rng = np.random.default_rng(sp["seed"] if seed is None else seed)
    durs = real_durations()
    rows, cid = [], 0
    start = datetime(2026, 10, 12)
    lead_no = 0
    for day in range(sp["days"]):
        for _ in range(sp["lpd"]):
            lead = f"G{lead_no:07d}"
            lead_no += 1
            arm = _arm(lead, key, sp["share"])
            t = start + timedelta(days=day, seconds=int(rng.integers(8 * 3600, 20 * 3600)))
            p = sp["true_b"] if arm == "B" else sp["true_a"]
            dur = float(rng.choice(durs)) * (sp.get("dur_mult_b", 1.0) if arm == "B" else 1.0)
            if arm == "B" and sp.get("short_b") and rng.random() < sp["short_b"]:
                dur = float(rng.uniform(4, 14))
            if rng.random() < p:
                disp = "buylead_created"
            else:
                disp = str(rng.choice([x for x, _ in LOSSES], p=[w for _, w in LOSSES]))
            cid += 1
            rows.append({"call_id": f"C{cid:08d}", "lead_id": lead, "timestamp": t.isoformat(sep=" "), "variant": arm, "disposition": disp,
                         "duration_s": round(dur, 1), "connected": 0 if disp == "no_connect" else 1})
            if rng.random() < 0.12:                                    # a repeat call to the same lead, same prompt (sticky)
                cid += 1
                rows.append({"call_id": f"C{cid:08d}", "lead_id": lead, "timestamp": (t + timedelta(hours=int(rng.integers(2, 30)))).isoformat(sep=" "),
                             "variant": arm, "disposition": "other", "duration_s": round(float(rng.choice(durs)), 1), "connected": 1})
    if sp.get("messy"):
        rows = _mess(rows, rng)
    return rows


def _mess(rows: list[dict], rng) -> list[dict]:
    """Make the export look like a real one: other names for the variants, duplicates, a few contaminated leads, junk."""
    out = []
    for r in rows:
        r = dict(r)
        r["variant"] = {"A": "control", "B": "test"}[r["variant"]]
        out.append(r)
    for i in rng.choice(len(out), 40, replace=False):                  # exact duplicate rows
        out.append(dict(out[i]))
    for i in rng.choice(len(out), 30, replace=False):                  # leads that were served the other prompt on a later call
        r = dict(out[i]); r["call_id"] += "x"
        r["variant"] = "test" if r["variant"] == "control" else "control"
        out.append(r)
    for i in rng.choice(len(out), 12, replace=False):                  # unknown variant values
        out[i]["variant"] = "C"
    for i in rng.choice(len(out), 15, replace=False):                  # missing outcomes
        out[i]["disposition"] = ""
    return out


def to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=FIELDS)
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def to_daily_csv(rows: list[dict]) -> str:
    """The same results as a daily summary: one row per day and variant (no lead ids, so the sticky check cannot be run on it)."""
    agg: dict = {}
    seen = set()
    for r in sorted(rows, key=lambda r: r["timestamp"]):
        if r["lead_id"] in seen:
            continue
        seen.add(r["lead_id"])
        d = r["timestamp"][:10]
        a = agg.setdefault((d, r["variant"]), {"n": 0, "x": 0, "s": 0.0, "q": 0.0})
        a["n"] += 1; a["x"] += r["disposition"] == "buylead_created"; a["s"] += r["duration_s"]; a["q"] += r["duration_s"] ** 2
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date", "variant", "leads", "goal_count", "mean_duration", "sd_duration"])
    for (d, v), a in sorted(agg.items()):
        m = a["s"] / a["n"]
        sd = max(a["q"] / a["n"] - m * m, 0.0) ** 0.5 * (a["n"] / max(1, a["n"] - 1)) ** 0.5
        w.writerow([d, v, a["n"], a["x"], round(m, 2), round(sd, 2)])
    return buf.getvalue()


def write_all() -> list[Path]:
    OUTDIR.mkdir(parents=True, exist_ok=True)
    made = []
    for key in SAMPLES:
        rows = make_rows(key)
        p = OUTDIR / f"results_{key}.csv"
        p.write_text(to_csv(rows))
        made.append(p)
    rows = make_rows("b_wins")
    p = OUTDIR / "daily_b_wins.csv"
    p.write_text(to_daily_csv(rows))
    made.append(p)
    (OUTDIR / "README.md").write_text(
        "# Sample results files (synthetic)\n\nGenerated by `python -m canary samples` from the traffic simulator: outcomes are drawn from a known truth, "
        "call durations are resampled from the 713 real recordings. They prove the engine reads files and decides correctly; they say nothing about a real prompt.\n\n"
        "| File | Truth injected | Expected decision |\n|---|---|---|\n"
        + "\n".join(f"| results_{k}.csv | {v['note'].split(':')[0]} | {v['note'].split(':', 1)[1].strip()} |" for k, v in SAMPLES.items())
        + "\n| daily_b_wins.csv | the same results as 'B wins', as a daily summary | PROMOTE |\n\n"
        "Try: `python -m canary decide data/samples/results_b_wins.csv --goal buylead_created --share-b 0.3 --baseline 0.45 --mde 0.07 --window-days 14`\n")
    return made
