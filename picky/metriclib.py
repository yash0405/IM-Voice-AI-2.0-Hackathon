"""The metric catalog: one definition format for built-in and custom metrics (New Experiment, Step 4).

A metric is computed from the call data's columns only (no free-text code):
  rate     count of [calls | leads] where <conditions>  /  count of [calls | leads] where <conditions> (no conditions = all attempted)
  average  average of <numeric column> over [calls | leads] where <optional conditions>
A condition is {"col", "op": "is" | "is_not" | "in", "values": [...]}; up to 3 per side, joined with AND.

Counting per lead (the unit the router assigns): for a "calls" side a lead contributes how many of its calls match; for a "leads" side it
contributes 1 if any of its calls matches. An average over "calls" adds every matching call's value; over "leads" it takes the lead's first
matching call. Every metric is then a ratio of two per-lead sums, so one estimator (the ratio of sums, with a delta-method variance) serves
rates and averages alike; for a plain lead-level rate it is exactly the usual proportion and its variance.
"""
from __future__ import annotations

import math
import re

from . import history

OPS = ("is", "is_not", "in")
MAX_CONDS = 3


def _c(col, *values, op="is"):
    return {"col": col, "op": op if len(values) == 1 or op == "is_not" else "in", "values": list(values)}


def _outcome(key, name, disp, note):
    return {"key": key, "name": name, "group": "Outcome", "role": "goal", "direction": "higher", "type": "rate",
            "num": {"unit": "leads", "where": [_c("disposition", disp)]}, "den": {"unit": "leads", "where": [_c("connected", "1")]},
            "dispositions": [key], "denominator": "connected leads", "note": note}


# built-in metrics: the four goals, then call quality and reach. `available: False` = the data has no column for it yet.
BUILTIN = [
    _outcome("buylead_created", "BuyLead created", "BuyLead created", "BL Approved / BL Enriched in the prompt's own vocabulary; the exact definition is to be confirmed with the organisers."),
    _outcome("meeting_fixed", "Meeting Fixed", "Meeting Fixed", "The goal named in the problem statement (seller side)."),
    _outcome("bl_enriched", "Buyer Enriched", "Buyer Enriched", "Named in the event deck."),
    _outcome("callback_fixed", "Callback Fixed", "Callback Fixed", "Named in the event deck."),
    {"key": "duration_s", "name": "Call duration", "group": "Call quality", "role": "guardrail", "direction": "lower", "type": "average",
     "col": "call_duration", "unit": "calls", "where": [_c("connected", "1")], "dispositions": [], "denominator": "average per answered call",
     "limit": "no more than +10% (default)", "note": "Talk time of answered calls, compared as a ratio with a range."},
    {"key": "early_hangup", "name": "Early hang-ups", "group": "Call quality", "role": "guardrail", "direction": "lower", "type": "rate",
     "num": {"unit": "calls", "where": [_c("early_hangup", "Yes")]}, "den": {"unit": "calls", "where": [_c("connected", "1")]},
     "dispositions": [], "denominator": "answered calls", "limit": "no more than +2 points (suggested)",
     "note": f"Answered calls shorter than {history.EARLY_HANGUP_S} seconds (our assumed cut-off)."},
    {"key": "answered_pct", "name": "Answered %", "group": "Reach", "role": "metric", "direction": "higher", "type": "rate",
     "num": {"unit": "calls", "where": [_c("call_status", "Answered")]}, "den": {"unit": "calls", "where": []},
     "dispositions": [], "denominator": "all calls attempted", "note": "Mostly decided before the prompt speaks: useful as a check, rarely as a goal."},
    {"key": "connected_pct", "name": "Connected %", "group": "Reach", "role": "metric", "direction": "higher", "type": "rate",
     "num": {"unit": "leads", "where": [_c("connected", "1")]}, "den": {"unit": "leads", "where": []},
     "dispositions": [], "denominator": "all leads attempted", "note": "Mostly decided before the prompt speaks: useful as a check, rarely as a goal."},
    {"key": "fatal_call", "name": "Fatal calls (quality matrix)", "group": "Call quality", "role": "guardrail", "direction": "lower", "type": "rate",
     "num": {"unit": "calls", "where": [_c("fatal_flag", "Yes")]}, "den": {"unit": "calls", "where": [_c("connected", "1")]},
     "dispositions": [], "denominator": "answered calls", "limit": "no more than +2 points (suggested)", "available": False,
     "note": "Not in data yet: needs a fatal-call flag on each call (results files can carry it)."},
]
BY_KEY = {m["key"]: m for m in BUILTIN}
GOALS = [m["key"] for m in BUILTIN if m["group"] == "Outcome"]


def definition(m: dict) -> dict:
    """The parts of a metric that decide its value (what is locked into a test's config)."""
    keys = ("key", "name", "type", "num", "den", "col", "unit", "where", "direction")
    return {k: m[k] for k in keys if k in m}


# ---------------------------------------------------------------------------- validation

def _check_conds(conds, label: str, columns: dict, need_one: bool) -> list:
    if conds is None:
        conds = []
    if not isinstance(conds, list):
        raise ValueError(f"{label}: conditions must be a list")
    if need_one and not conds:
        raise ValueError(f"{label}: add at least one condition")
    if len(conds) > MAX_CONDS:
        raise ValueError(f"{label}: at most {MAX_CONDS} conditions (joined with AND)")
    out = []
    for c in conds:
        col, op, vals = str(c.get("col", "")), str(c.get("op", "is")), c.get("values") or []
        meta = columns.get(col)
        if meta is None:
            raise ValueError(f"{label}: '{col}' is not a column in the data")
        if meta["type"] != "category":
            raise ValueError(f"{label}: {meta['label']} is a number; conditions compare a column to values from its list")
        if op not in OPS:
            raise ValueError(f"{label}: the comparison must be 'is', 'is not' or 'is one of'")
        if not vals:
            raise ValueError(f"{label}: choose at least one value for {meta['label']}")
        bad = [v for v in vals if v not in meta["values"]]
        if bad:
            raise ValueError(f"{label}: {', '.join(map(str, bad))} is not a value of {meta['label']}")
        if op == "is" and len(vals) != 1:
            op = "in"
        out.append({"col": col, "op": op, "values": [v for v in meta["values"] if v in vals]})
    return out


def validate(m: dict, columns: list | None = None, check_data: bool = True) -> dict:
    """Checks a metric definition and returns its cleaned form. Only columns from the data; the denominator must be above 0 on the last
    30 days; a rate must lie between 0 and 100%. Raises ValueError with a plain message."""
    if isinstance(m, dict) and m.get("source") == "file":
        return validate_file(m, check_data)
    cols = {c["name"]: c for c in (columns or history.COLUMNS)}
    if not isinstance(m, dict):
        raise ValueError("a metric definition is an object")
    name = str(m.get("name") or "").strip()
    if not name or len(name) > 60:
        raise ValueError("give the metric a name (at most 60 characters)")
    typ = m.get("type")
    direction = m.get("direction", "higher")
    if direction not in ("higher", "lower"):
        raise ValueError("direction must be 'higher' or 'lower'")
    key = str(m.get("key") or "custom_" + re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_"))[:60]
    if typ == "rate":
        num, den = m.get("num") or {}, m.get("den") or {}
        for side, lab in ((num, "Numerator"), (den, "Denominator")):
            if side.get("unit") not in ("calls", "leads"):
                raise ValueError(f"{lab}: count calls or leads")
        out = {"key": key, "name": name, "type": "rate", "direction": direction,
               "num": {"unit": num["unit"], "where": _check_conds(num.get("where"), "Numerator", cols, True)},
               "den": {"unit": den["unit"], "where": _check_conds(den.get("where"), "Denominator", cols, False)}}
    elif typ == "average":
        col = str(m.get("col", ""))
        if col not in cols:
            raise ValueError(f"'{col}' is not a column in the data")
        if cols[col]["type"] != "number":
            raise ValueError(f"{cols[col]['label']} is not a number column, so it cannot be averaged")
        if m.get("unit") not in ("calls", "leads"):
            raise ValueError("average over calls or leads")
        out = {"key": key, "name": name, "type": "average", "direction": direction, "col": col, "unit": m["unit"],
               "where": _check_conds(m.get("where"), "Condition", cols, False)}
    else:
        raise ValueError("the type must be 'rate' or 'average'")
    if check_data:
        ev = evaluate(out)
        if ev["den"] <= 0:
            raise ValueError("the denominator is 0 on the last 30 days: nothing would be counted")
        if out["type"] == "rate" and not 0 <= ev["value"] <= 1:
            raise ValueError(f"this rate comes to {ev['value']:.0%} on the last 30 days; a rate must lie between 0 and 100% (check the numerator counts a subset of the denominator)")
    return out


# ---------------------------------------------------------------------------- metrics over a data file (picky/filecatalog.py)

# file column -> the simulator's column (history.py). A file metric runs in a test only when every column it uses is here.
FILE_SIM = {"lead_call_duration": "call_duration", "lead_call_status": "call_status"}
FILE_SIM_VALUES = {"lead_call_status": {"NotAnswered": [s for s in history.STATUSES if s != "Answered"]}}


def _sim_conds(conds: list, name: str) -> list:
    from .filecatalog import label
    out = []
    for c in conds:
        col = c["col"]
        if col not in FILE_SIM:
            raise ValueError(f"{name}: {label(col)} is in the data file but not in the test simulator yet (only "
                             f"{' and '.join(label(k).lower() for k in FILE_SIM)}); preview it, but it cannot run in a test yet")
        vals = c.get("values") if c.get("values") is not None else [c.get("value")]
        if c["op"] in ("is", "is_not", "in"):
            vm = FILE_SIM_VALUES.get(col, {})
            vals = [x for v in vals for x in vm.get(v, [v])]
            op = "is_not" if c["op"] == "is_not" else ("is" if len(vals) == 1 else "in")
        else:
            op = c["op"]
        out.append({"col": FILE_SIM[col], "op": op, "values": vals})
    return out


def validate_file(m: dict, check_data: bool = True) -> dict:
    """A custom metric over a data file: checked by filecatalog (columns, operators, denominator above 0, a rate within 0-100% on the
    file's last 30 days). Returned in this module's format on the simulator's columns, with the file definition kept in `file_def`
    (its baseline comes from the file: see evaluate)."""
    from . import filecatalog
    d, errs = filecatalog.clean(m)
    if not errs and check_data:
        errs = filecatalog.validate(m)
    if errs:
        raise ValueError("; ".join(errs))
    if d["type"] == "sum":
        raise ValueError(f"{d['name']}: a sum can be previewed but not used in a test yet (use a rate or an average)")
    key = str(m.get("key") or "custom_" + re.sub(r"[^a-z0-9]+", "_", d["name"].lower()).strip("_"))[:60]
    out = {"key": key, "name": d["name"], "type": d["type"], "direction": d["direction"], "source": "file", "file": d["file"], "file_def": d}
    if d["type"] == "rate":
        out["num"] = {"unit": d["count"], "where": _sim_conds(d["num"], d["name"])}
        out["den"] = {"unit": d["count"], "where": _sim_conds(d["den"], d["name"])}
    else:
        if d["col"] not in FILE_SIM:
            _sim_conds([{"col": d["col"], "op": "=", "value": 0}], d["name"])     # raises the plain message
        out.update(col=FILE_SIM[d["col"]], unit=d["count"], where=_sim_conds(d["where"], d["name"]))
    return out


# ---------------------------------------------------------------------------- counting

def cond_ok(c: dict, row: dict) -> bool:
    v = row.get(c["col"])
    if c["op"] == "is_not":
        return v not in c["values"]
    if c["op"] in OPS:
        return v in c["values"]
    from .filecatalog import cond_match                   # number comparisons (file metrics only)
    return cond_match(c, v, "number")


def _match(where: list, row: dict) -> bool:
    return all(cond_ok(c, row) for c in where)


def _count(side: dict, rows: list) -> int:
    hits = sum(1 for r in rows if _match(side["where"], r))
    return hits if side["unit"] == "calls" else (1 if hits else 0)


def contrib(m: dict, rows: list) -> tuple:
    """(numerator, denominator) one lead adds, from its call rows."""
    if m["type"] == "rate":
        return _count(m["num"], rows), _count(m["den"], rows)
    vals = [float(r[m["col"]]) for r in rows if _match(m["where"], r)]
    if not vals:
        return 0.0, 0
    if m["unit"] == "leads":
        return vals[0], 1
    return sum(vals), len(vals)


class Acc:
    """Running sums for the ratio-of-sums estimator: R = sum(num) / sum(den), Var(R) by the delta method over leads."""
    __slots__ = ("n", "sn", "sd", "snn", "sdd", "snd", "ssq", "nu")

    def __init__(self):
        self.n = 0                                  # leads seen (including those that add 0 to the denominator)
        self.sn = self.sd = self.snn = self.sdd = self.snd = 0.0
        self.ssq = 0.0                              # sum of squared unit values (averages over leads: the plain SD)
        self.nu = 0

    def add(self, num: float, den: float, sq: float = 0.0):
        self.n += 1
        self.sn += num
        self.sd += den
        self.snn += num * num
        self.sdd += den * den
        self.snd += num * den
        self.ssq += sq

    @property
    def value(self):
        return self.sn / self.sd if self.sd else None

    def var(self):
        """Variance of the ratio. For a lead-level 0/1 rate this equals p(1-p)/count, the usual proportion variance."""
        if not self.sd or self.n < 2:
            return None
        r = self.sn / self.sd
        ss = self.snn - 2 * r * self.snd + r * r * self.sdd           # sum over leads of (num - r * den)^2
        dbar = self.sd / self.n
        return max(ss, 0.0) / (self.n - 1) / (self.n * dbar * dbar)


def evaluate(m: dict, segment=None, leads=None) -> dict:
    """The metric on the last 30 days (optionally for one audience): numerator, denominator, value, and the spread of one unit
    (sqrt(p(1-p)) for a rate, the standard deviation of a call or lead for an average). A file metric is computed on its file's
    last 30 days (all traffic: the file has no audience factors)."""
    if m.get("source") == "file" and isinstance(m.get("file_def"), dict):
        from . import filecatalog
        ev = filecatalog.evaluate(m["file_def"])
        return {"num": ev["num"], "den": ev["den"], "value": ev["value"], "sd": ev["sd"], "leads": ev["leads"], "window": ev["window"]}
    from . import catalog
    acc = Acc()
    unit_vals = []
    n_leads = 0
    for L in (leads if leads is not None else history.leads()):
        if segment and not catalog.matches(segment, L):
            continue
        n_leads += 1
        rows = history.lead_calls(L)
        num, den = contrib(m, rows)
        acc.add(num, den)
        if m["type"] == "average":
            if m["unit"] == "calls":
                unit_vals += [float(r[m["col"]]) for r in rows if _match(m["where"], r)]
            elif den:
                unit_vals.append(num)
    v = acc.value
    if m["type"] == "rate":
        spread = math.sqrt(v * (1 - v)) if v is not None and 0 <= v <= 1 else None
    else:
        k = len(unit_vals)
        mu = sum(unit_vals) / k if k else None
        spread = math.sqrt(sum((x - mu) ** 2 for x in unit_vals) / (k - 1)) if k > 1 else None
    return {"num": acc.sn, "den": acc.sd, "value": v, "sd": spread, "leads": n_leads}


def catalog_bundle() -> dict:
    """The metric list as the dashboard reads it: built-ins with their definitions and the columns a custom metric may use."""
    return {"builtin": BUILTIN, "columns": history.COLUMNS, "ops": [{"op": "is", "label": "is"}, {"op": "is_not", "label": "is not"}, {"op": "in", "label": "is one of"}],
            "max_conditions": MAX_CONDS, "groups": ["Outcome", "Call quality", "Reach", "Custom"],
            "limits": {"guardrails": 3, "secondary": 5}, "default_guardrail": {"key": "duration_s", "limit": {"value": 10, "kind": "rel"}}}
