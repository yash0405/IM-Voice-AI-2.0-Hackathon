"""Export everything Canary knows into ONE SQLite file, so a judge can run SQL over it.

    python -m canary.export_db                      # writes out/canary.db (demo experiments + past tests, with per-lead rows)
    python -m canary.export_db --out x.db --no-past --no-calls

Every test, version and decision is traceable:  prompts -> experiments -> experiment_versions -> daily_results / decision_log, and
assignments / calls for the leads. Tables: variable_catalog, metrics, prompts, experiments, experiment_versions, assignments, calls,
daily_results, decision_log, suggestions, plus `meta` (key/value notes: how and when the file was made, what is synthetic).

HEADER NOTES (also stored in the `meta` table and as comments in the schema, so they travel with the file)

* EVERYTHING HERE IS SYNTHETIC. The call outcomes of the experiments come from our simulator (an injected, known effect), the daily volume is
  an assumption, the lead variables use the BRD's example names with a placeholder mix, and past tests are re-runs of our scenarios plus
  synthetic result files.
* calls: the simulator only produces a converted flag and a duration, so `disposition` holds 'converted' / 'not_converted' and is NULL when the
  call was not logged (an out-of-segment call, a repeat call that is not analysed twice, or a call missing from the log). `connected` is 1 for a
  logged call and NULL otherwise. There is no real 'connected' / 'not connected' signal in the simulator. `date` holds the full ISO time of the call.
* daily_results: values are CUMULATIVE up to the last look of that day (one row per day and variant, A and B). `test_results` is the whole test's
  statistics at that look, so it is the same JSON on the A row and the B row of a day.
* assignments and calls exist only for the demo experiments (they are re-run with capture). Past tests keep only their daily summaries and
  decision log: they have no per-lead rows.
* decision_log keeps EVERY ledger entry with the exact JSON text that was hashed (`body`). entry_hash = sha256(prev_hash + body), hex, UTF-8;
  the first prev_hash is 64 zeros (canary/ledger.py). SQLite has no sha256, so link continuity is checked in SQL (each prev_hash equals the
  previous entry_hash) and the re-hash is done by any tool that has sha256.
* experiments.status uses the BRD's words. A finished record is Completed, except STOP_HARM / STOP_GUARDRAIL / HALT_SRM, which are Stopped.
* Columns beyond the spec, added only for traceability: experiments.truth / variant_a_hash / variant_b_hash / variant_b_version,
  prompts.candidate_key, decision_log.seq / type / body.
"""
from __future__ import annotations

import argparse
import functools
import json
import math
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from . import catalog, console, planner, variants
from .engine import TERMINAL, Config, run_experiment
from .ledger import GENESIS, verify
from .simulator import Scenario, TrafficSim

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "out" / "canary.db"
SCHEMA_VERSION = 1
STOPPED = {"STOP_HARM", "STOP_GUARDRAIL", "HALT_SRM"}
TABLES = ["meta", "variable_catalog", "metrics", "prompts", "experiments", "experiment_versions", "assignments", "calls", "daily_results",
          "decision_log", "suggestions"]

SCHEMA = """
-- Canary results database. Everything in it is synthetic (simulated calls). See the `meta` table for the notes.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- The variables a test can be built on. pre_call = 1: known before the call, so allowed in a segment rule.
-- synthetic = 1: the names and values are the BRD's examples, and the mix the simulator draws from is a placeholder.
CREATE TABLE variable_catalog (
  name           TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  meaning        TEXT,
  type           TEXT,
  allowed_values TEXT CHECK (allowed_values IS NULL OR json_valid(allowed_values)),   -- JSON array
  pre_call       INTEGER NOT NULL CHECK (pre_call IN (0, 1)),
  synthetic      INTEGER NOT NULL CHECK (synthetic IN (0, 1))
);

-- The built-in metrics (canary/metriclib.py): goals the engine decides on, guardrails, and plain metrics (reach). A test launched from the
-- wizard locks its own list (primary / guardrails / secondary, custom metrics included) inside experiment_versions.config.
CREATE TABLE metrics (
  key                    TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  role                   TEXT NOT NULL CHECK (role IN ('goal', 'guardrail', 'metric')),
  numerator_dispositions TEXT CHECK (numerator_dispositions IS NULL OR json_valid(numerator_dispositions)),   -- JSON array
  denominator            TEXT,
  direction              TEXT,
  limit_text             TEXT,
  note                   TEXT
);

-- Prompt versions: v1 is the production prompt as received; every other row is a candidate edit of v1.
-- hash = first 12 hex characters of sha256(text); experiments.variant_a_hash / variant_b_hash join on it.
-- created_at is NULL: the source data carries no creation time (we do not invent one).
CREATE TABLE prompts (
  version_id     TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  hash           TEXT NOT NULL,
  text           TEXT NOT NULL,
  parent_version TEXT REFERENCES prompts (version_id),
  created_by     TEXT,                                 -- 'provided' (as received), or the candidate's origin: human / lint-derived / ai-mined
  created_at     TEXT,
  is_production  INTEGER NOT NULL CHECK (is_production IN (0, 1)),
  candidate_key  TEXT                                  -- the key the console and the suggestions use for this edit
);
CREATE INDEX idx_prompts_hash ON prompts (hash);

-- One row per experiment. status: Draft / Scheduled / Running / Completed / Stopped.
-- decision = the engine's verdict (PROMOTE, STOP_HARM, STOP_GUARDRAIL, HALT_SRM, INCONCLUSIVE, HOLD_FOR_APPROVAL).
-- truth = the effect the simulator injected (known only because the data is synthetic); NULL for result files.
-- variant_b_version = the prompts row whose hash equals variant_b_hash; NULL when the B prompt text is not in the library (result files).
CREATE TABLE experiments (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  hypothesis        TEXT,
  status            TEXT NOT NULL CHECK (status IN ('Draft', 'Scheduled', 'Running', 'Completed', 'Stopped')),
  current_version   INTEGER NOT NULL,
  kind              TEXT,                              -- simulated (we generated the calls) or files (results supplied as a file)
  segment_rule      TEXT,
  primary_goal      TEXT,
  decision          TEXT,
  decision_reason   TEXT,
  decided_at        TEXT,
  variant_a_hash    TEXT,
  variant_b_hash    TEXT,
  variant_b_version TEXT REFERENCES prompts (version_id),
  truth             TEXT CHECK (truth IS NULL OR json_valid(truth))
);
CREATE INDEX idx_experiments_status ON experiments (status);

-- The locked config of each version of an experiment. A change is a new version that points at its parent (parent_hash is inside config).
CREATE TABLE experiment_versions (
  experiment_id TEXT NOT NULL REFERENCES experiments (id),
  version       INTEGER NOT NULL,
  config        TEXT NOT NULL CHECK (json_valid(config)),
  config_hash   TEXT NOT NULL,
  locked_at     TEXT,                                  -- time of the 'experiment_created' ledger entry
  PRIMARY KEY (experiment_id, version)
);

-- Which arm each counted lead was given. A lead appears once: assignment is sticky. Demo experiments only.
CREATE TABLE assignments (
  experiment_id TEXT NOT NULL REFERENCES experiments (id),
  lead_id       TEXT NOT NULL,
  stratum       TEXT,                                  -- GST Nature of Business x HL Type (catalog.STRATA_VARS; NULL when the test is not stratified)
  variant       TEXT NOT NULL CHECK (variant IN ('A', 'B')),
  assigned_at   TEXT,
  PRIMARY KEY (experiment_id, lead_id)
);
CREATE INDEX idx_assignments_variant ON assignments (experiment_id, variant);

-- Every call of a demo experiment, in call order. The simulator only produces a converted flag and a duration, so:
--   disposition = 'converted' / 'not_converted' for a logged call, NULL when the call was not logged;
--   connected   = 1 for a logged call, NULL otherwise (there is no real connected / not-connected signal).
-- NULL disposition and duration also mean: out-of-segment call (in_segment = 0, gets the production prompt, not counted) or a repeat call
-- (repeat = 1, routed to the lead's arm but not analysed twice). `date` is the full ISO time of the call.
CREATE TABLE calls (
  experiment_id TEXT NOT NULL REFERENCES experiments (id),
  call_id       INTEGER NOT NULL,
  lead_id       TEXT NOT NULL,
  date          TEXT,
  connected     INTEGER CHECK (connected IS NULL OR connected = 1),
  disposition   TEXT CHECK (disposition IS NULL OR disposition IN ('converted', 'not_converted')),
  duration_s    REAL,
  variant       TEXT NOT NULL CHECK (variant IN ('A', 'B')),
  in_segment    INTEGER NOT NULL CHECK (in_segment IN (0, 1)),
  repeat        INTEGER NOT NULL CHECK (repeat IN (0, 1)),
  PRIMARY KEY (experiment_id, call_id)
);
CREATE INDEX idx_calls_lead ON calls (experiment_id, lead_id);
CREATE INDEX idx_calls_variant ON calls (experiment_id, variant, disposition);

-- One row per day and variant: the figures CUMULATIVE up to the last look of that day (`leads` = analysed first calls).
-- test_results = the whole test's statistics at that look (z, boundaries, diff, ci95, decision, mix_p, guardrails), the same JSON on both rows of a day.
CREATE TABLE daily_results (
  experiment_id TEXT NOT NULL REFERENCES experiments (id),
  day           INTEGER NOT NULL,
  variant       TEXT NOT NULL CHECK (variant IN ('A', 'B')),
  leads         INTEGER NOT NULL,
  conversions   INTEGER NOT NULL,
  rate          REAL,
  metric_values TEXT CHECK (metric_values IS NULL OR json_valid(metric_values)),
  test_results  TEXT CHECK (test_results IS NULL OR json_valid(test_results)),
  PRIMARY KEY (experiment_id, day, variant)
);

-- The hash-chained decision log, every entry kept. entry_hash = sha256(prev_hash + body); the first prev_hash is 64 zeros.
-- `body` is the exact JSON text that was hashed; `type` is the raw ledger type; `event` is its readable name.
CREATE TABLE decision_log (
  experiment_id TEXT NOT NULL REFERENCES experiments (id),
  time          TEXT,
  event         TEXT NOT NULL,
  reason        TEXT,
  evidence      TEXT CHECK (evidence IS NULL OR json_valid(evidence)),
  version       INTEGER,                               -- the experiment's config version
  entry_hash    TEXT NOT NULL,
  prev_hash     TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  type          TEXT NOT NULL,
  body          TEXT NOT NULL CHECK (json_valid(body)),
  PRIMARY KEY (experiment_id, seq)
);
CREATE UNIQUE INDEX idx_decision_log_hash ON decision_log (entry_hash);
CREATE INDEX idx_decision_log_event ON decision_log (experiment_id, event);

-- Ideas for the next tests. priority = ease x expected_pp where both exist, else NULL. patch = the candidate key (prompts.candidate_key).
CREATE TABLE suggestions (
  id            TEXT PRIMARY KEY,
  source        TEXT,
  title         TEXT NOT NULL,
  hypothesis    TEXT,
  patch         TEXT,
  metric        TEXT,
  expected_lift TEXT,
  days_needed   REAL,
  priority      REAL,
  caveat        TEXT
);
"""

EVENTS = {"experiment_created": "launched", "promotion": "promoted", "rollback": "rolled_back"}     # every other ledger type keeps its own name


# ---------------------------------------------------------------------------- small helpers

def _clean(o):
    """Plain JSON types only: numpy scalars become Python numbers, NaN / inf become null (they are not valid JSON)."""
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if hasattr(o, "item") and not isinstance(o, (str, bytes)):
        o = o.item()
    if isinstance(o, float) and not math.isfinite(o):
        return None
    return o


def _j(o) -> str | None:
    return None if o is None else json.dumps(_clean(o), sort_keys=True, separators=(",", ":"))


def status_of(rec: dict) -> str:
    """BRD status words. Every stored record is finished: Completed, except the three kinds that stop a test early."""
    kind = rec["result"]["kind"]
    if kind in STOPPED:
        return "Stopped"
    if kind in TERMINAL or rec["result"].get("status") not in (None, "running"):
        return "Completed"
    return "Running"


# ---------------------------------------------------------------------------- one experiment -> rows

def _event_row(exp_id: str, version: int, entry: dict) -> tuple:
    body = json.loads(entry["body"])
    etype, payload = body["type"], body["payload"]
    reason, evidence = None, payload
    if etype == "experiment_created":
        reason = (payload.get("config") or {}).get("name")
        evidence = {k: v for k, v in payload.items() if k != "config"}      # the config itself is in experiment_versions
    elif etype == "look":
        reason = payload.get("decision")                                    # the decision kind of this look (CONTINUE, PROMOTE ...)
    elif etype == "decision":
        reason = payload.get("reason")
        evidence = {"kind": payload.get("kind"), **({"cause": payload["cause"]} if payload.get("cause") else {}), **(payload.get("evidence") or {})}
    elif etype == "routing_changed":
        reason = payload.get("reason")
    elif etype == "promotion":
        reason = f"production prompt {payload.get('production_before')} -> {payload.get('production_after')} (approval: {payload.get('approval')})"
    elif etype == "approval_requested":
        reason = payload.get("cause")
    elif etype in ("approval", "rollback"):
        reason = payload.get("action") or payload.get("reason")
    return (exp_id, body.get("ts"), EVENTS.get(etype, etype), reason, _j(evidence), version, entry["hash"], entry["prev"], body["seq"], etype, entry["body"])


def _daily_rows(exp_id: str, rec: dict) -> list[tuple]:
    cfg = rec["config"]
    last = {}
    for row in rec["looks"]:                       # looks are in time order: the last look of a day wins
        last[row["day"]] = row
    keep = ("k", "time", "n", "z", "eff", "harm", "harm_g", "diff", "rci", "ci95", "decision", "mix_p", "p_srm", "p_loss", "naive_cross",
            "assignedB", "loggedB", "oos", "guardrail", "guardrail2")
    out = []
    for day in sorted(last):
        row = last[day]
        tests = {k: row[k] for k in keep if k in row}
        if "metrics" in row:                       # a test with a locked metric list: every metric's value per variant
            tests["metrics"] = [{k: m.get(k) for k in ("key", "role", "diff", "lo", "hi", "rel", "worse", "upper", "margin")} for m in row["metrics"]]
            avg = (cfg.get("primary_type") or "rate") == "average"
            for v in ("A", "B"):
                mv = {m["key"] + ("_mean" if m["type"] == "average" else "_rate"): m[v]["value"] for m in row["metrics"]}
                # leads = analysed leads; conversions = the primary's numerator count for a rate (0 for an average); rate = the primary's value
                out.append((exp_id, day, v, row[f"n{v}"], 0 if avg else int(round(row[f"x{v}"])), row[f"rate{v}"], _j(mv), _j(tests)))
            continue
        for v in ("A", "B"):
            mv = {f"{cfg['primary_goal']}_rate": row[f"rate{v}"]}
            g, g2 = row.get("guardrail"), row.get("guardrail2")
            if g:
                mv[f"{cfg['secondary_metric']}_mean"] = g["mean_a" if v == "A" else "mean_b"]
            if g2:
                mv[f"{g2['name']}_rate"] = g2["rate_a" if v == "A" else "rate_b"]
            out.append((exp_id, day, v, row[f"n{v}"], row[f"x{v}"], row[f"rate{v}"], _j(mv), _j(tests)))
    return out


def _experiment_rows(e: dict, prompt_by_hash: dict) -> dict:
    rec, cfg = e["record"], e["record"]["config"]
    version = cfg.get("version", 1)
    created = json.loads(rec["ledger"][0]["body"])
    decision = next((json.loads(x["body"]) for x in rec["ledger"] if json.loads(x["body"])["type"] == "decision"), None)
    a, b = rec["variants"]["A"]["hash"], rec["variants"]["B"]["hash"]
    res = rec["result"]
    exp = (e["id"], cfg["name"], e.get("hypothesis"), status_of(rec), version, e.get("kind"), catalog.describe(catalog.validate_segment(cfg.get("segment"))),
           cfg.get("primary_goal"), res["kind"], res.get("reason"), decision["ts"] if decision else res.get("time"), a, b, prompt_by_hash.get(b), _j(e.get("truth")))
    return {"experiment": exp,
            "version": (e["id"], version, _j(cfg), rec["config_hash"], created["ts"]),
            "daily": _daily_rows(e["id"], rec),
            "log": [_event_row(e["id"], version, x) for x in rec["ledger"]],
            "chain_ok": verify(rec["ledger"])[0]}


# ---------------------------------------------------------------------------- re-run with capture (demo experiments)

def _rerun_with_capture(e: dict) -> dict:
    """Run the demo experiment again, exactly as console.run_preset does, and keep its per-lead rows. The re-run must end on the same ledger head."""
    spec = next((d for d in console.DEMO if d["key"] == e["id"]), None)
    if spec is None:
        raise KeyError(f"{e['id']} is not one of console.DEMO: cannot rebuild its simulator")
    rec = e["record"]
    cfg = Config(**rec["config"]).validate()
    if cfg.hash() != rec["config_hash"]:
        raise RuntimeError(f"{e['id']}: the stored config no longer hashes to the stored config_hash")
    t = e["truth"]
    sc = Scenario(key=cfg.exp_id, title=cfg.name, story="", expect="-", true_a=t["true_a"], true_b=t["true_b"], seed=spec["seed"], dur_mult_b=spec.get("dur_mult", 1.0))
    cap: dict = {}
    again = run_experiment(cfg, TrafficSim(sc), capture=cap)
    if again["ledger_head"] != rec["ledger_head"]:
        raise RuntimeError(f"{e['id']}: the re-run ended on ledger head {again['ledger_head'][:12]}, the stored record on {rec['ledger_head'][:12]} (not deterministic)")
    cap.setdefault("assignments", [])
    cap.setdefault("calls", [])
    return {"head": again["ledger_head"], "assignments": cap["assignments"], "calls": cap["calls"]}


def _assignment_rows(exp_id: str, cap: dict) -> list[tuple]:
    return [(exp_id, a["lead_id"], a["stratum"], a["variant"], a["assigned_at"]) for a in cap["assignments"]]


def _call_rows(exp_id: str, cap: dict) -> list[tuple]:
    out = []
    for c in cap["calls"]:
        logged = c["converted"] is not None
        out.append((exp_id, c["call_id"], c["lead_id"], c["time"], 1 if logged else None, ("converted" if c["converted"] else "not_converted") if logged else None,
                    c["duration_s"], c["variant"], int(bool(c["in_segment"])), int(bool(c["repeat"]))))
    return out


# ---------------------------------------------------------------------------- reference tables

def _catalog_rows() -> list[tuple]:
    synthetic = int(bool(catalog.bundle()["synthetic"]))
    return [(v["name"], v["label"], v["meaning"], v["type"], _j(v["values"]), int(bool(v["pre_call"])), synthetic) for v in catalog.CATALOG]


def _metric_rows() -> list[tuple]:
    return [(m["key"], m["name"], m["role"], _j(m["dispositions"]), m["denominator"], m["direction"], m.get("limit"), m.get("note")) for m in console.metrics()]


def _prompt_rows() -> list[tuple]:
    lib = console.library()
    base = variants.load_base()
    rows = [("v1", lib["base"]["name"], base["hash"], base["text"], None, "provided", None, 1, None)]
    for i, c in enumerate(lib["candidates"], start=2):
        text = variants.make_variant(c["key"])["text"]
        rows.append((f"v{i}", c["name"], c["hash"], text, "v1", c["origin"], None, 0, c["key"]))
    return rows


@functools.lru_cache(maxsize=1)
def _suggestion_rows() -> tuple:
    """console.suggestions() takes a couple of seconds (it reads the prompt and the call labels), so it is computed once per process.
    days_needed is filled the way console.console_bundle() does it: the sample-size calculator at the suggestion's expected lift."""
    d = console.DEFAULTS
    rows = []
    for c in console.suggestions():
        days = None
        if c.get("expected_pp"):
            p = planner.plan_one(d["baseline"], max(0.005, c["expected_pp"] / 100), d["share_b"], d["duration_margin"])
            days = round(p["n_max"] / d["leads_per_day"], 1)
        priority = c["ease"] * c["expected_pp"] if c.get("ease") and c.get("expected_pp") else None
        rows.append((c["id"], c["source"], c["title"], c["hypothesis"], c.get("change", c.get("patch")), c.get("metric"), c.get("expected"), days, priority, c.get("caveat")))
    return tuple(rows)


# ---------------------------------------------------------------------------- the export

def export(path: str, include_past: bool = True, with_calls: bool = True) -> dict:
    """Write the whole database to `path` (an existing file is replaced) and return the row count of every table.

    include_past=False leaves out the ~16 finished tests of the History screen. with_calls=False skips the per-lead rows (assignments, calls) and the
    re-run, which is what proves them deterministic."""
    path = Path(path)
    demo = console.demo_experiments()
    past = console.past_tests() if include_past else []
    experiments = demo + past

    prompts = _prompt_rows()
    prompt_by_hash: dict = {}
    for p in prompts:
        prompt_by_hash.setdefault(p[2], p[0])                  # two candidates with the same text map to the first version
    built = {e["id"]: _experiment_rows(e, prompt_by_hash) for e in experiments}

    captured, meta_det = {}, {}
    if with_calls:
        for e in demo:                                         # raises if a re-run does not end on the stored ledger head
            captured[e["id"]] = _rerun_with_capture(e)
            meta_det[e["id"]] = captured[e["id"]]["head"]

    meta = [("generated_at", datetime.now(timezone.utc).isoformat(timespec="seconds")),
            ("schema_version", str(SCHEMA_VERSION)),
            ("source", "canary.console.demo_experiments() and past_tests(); per-lead rows from re-running each demo experiment with capture (canary.engine.run_experiment)"),
            ("note", "Everything in this file is synthetic: simulated call outcomes with an injected known effect, an assumed daily volume, placeholder lead-variable mixes, "
                     "and past tests that are re-runs of our scenarios plus synthetic result files."),
            ("synthetic", "true"),
            ("past_tests", f"included: {len(past)} finished tests" if include_past else "not included (--no-past)"),
            ("past_tests_per_lead_rows", "past tests have no per-lead rows: no assignments and no calls, only experiments, versions, daily_results and decision_log"),
            ("per_lead_rows", (f"assignments and calls exist for the {len(demo)} demo experiments only: {', '.join(e['id'] for e in demo)}" if with_calls
                               else "not included (--no-calls): assignments and calls are empty")),
            ("calls_columns", "the simulator only produces a converted flag and a duration: disposition is 'converted' / 'not_converted' (NULL when the call was not logged), "
                              "connected is 1 for a logged call and NULL otherwise; out-of-segment calls and repeat calls are not analysed, so they are NULL too"),
            ("demo_experiments", "each demo experiment is a complete simulated run to its decision; the console pauses it on day 2 for the walkthrough, so decided_at and the later "
                                 "daily_results days are dated after that pause"),
            ("daily_results", "cumulative up to the last look of each day; one row per day and variant; test_results is the same JSON on the A row and the B row"),
            ("hash_rule", "entry_hash = sha256(prev_hash + body), lowercase hex over UTF-8; the first prev_hash is 64 zeros; body is the exact JSON text in decision_log.body"),
            ("status_rule", "finished record -> Completed, except STOP_HARM / STOP_GUARDRAIL / HALT_SRM -> Stopped"),
            ("determinism_check", (f"ok: {len(meta_det)} of {len(demo)} demo experiments re-ran to the same ledger head" if with_calls else "skipped (--no-calls)"))]
    meta += [(f"rerun_ledger_head:{k}", v) for k, v in meta_det.items()]
    meta += [(f"ledger_chain_ok:{k}", "true" if v["chain_ok"] else "false") for k, v in built.items()]

    tmp = path.with_name(path.name + ".tmp")
    path.parent.mkdir(parents=True, exist_ok=True)
    for f in (tmp, Path(str(tmp) + "-journal")):
        f.unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    try:
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(SCHEMA)
        with con:                                              # one transaction for all rows
            ins = lambda table, n, rows: con.executemany(f"INSERT INTO {table} VALUES ({','.join('?' * n)})", rows)
            ins("meta", 2, meta)
            ins("variable_catalog", 7, _catalog_rows())
            ins("metrics", 8, _metric_rows())
            ins("prompts", 9, prompts)
            ins("experiments", 15, [b["experiment"] for b in built.values()])
            ins("experiment_versions", 5, [b["version"] for b in built.values()])
            ins("assignments", 5, [r for k, c in captured.items() for r in _assignment_rows(k, c)])
            ins("calls", 10, [r for k, c in captured.items() for r in _call_rows(k, c)])
            ins("daily_results", 8, [r for b in built.values() for r in b["daily"]])
            ins("decision_log", 11, [r for b in built.values() for r in b["log"]])
            ins("suggestions", 10, _suggestion_rows())
        counts = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES}
        broken = con.execute("PRAGMA foreign_key_check").fetchall()
        if broken:
            raise RuntimeError(f"foreign key check failed: {broken[:3]}")
    finally:
        con.close()
    os.replace(tmp, path)
    return counts


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m canary.export_db", description="Export every experiment, version, call and decision into one SQLite file (all data is synthetic).")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="the SQLite file to write; an existing file is replaced (default: out/canary.db)")
    ap.add_argument("--no-past", action="store_true", help="leave out the finished past tests (the demo experiments only)")
    ap.add_argument("--no-calls", action="store_true", help="leave out the per-lead rows (assignments, calls) and the determinism re-run")
    args = ap.parse_args(argv)
    t0 = time.time()
    counts = export(args.out, include_past=not args.no_past, with_calls=not args.no_calls)
    out = Path(args.out)
    print(f"wrote {out}  ({out.stat().st_size / 1e6:.1f} MB, {time.time() - t0:.1f} s)")
    for t, n in counts.items():
        print(f"  {t:<20}{n:>8}")
    print("All data is synthetic. Try:  sqlite3", out, '"SELECT id, status, decision FROM experiments"')
    return 0


if __name__ == "__main__":
    sys.exit(main())
