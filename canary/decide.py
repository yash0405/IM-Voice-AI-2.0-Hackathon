"""Decide from results files: the test itself ran somewhere else; we judge it.

The voice calls (prompt A and prompt B) are made by the voice platform, not by us. What arrives here is the *result*: one row per
call (or one row per day and variant) saying which prompt served the call and what happened. This module

  1. reads those files, whatever the column names and delimiter (CSV, TSV, JSON, JSON lines, daily summaries);
  2. checks the data and says what it found: it refuses what it cannot read and lists everything it had to leave out, it never repairs
     data silently;
  3. counts each lead once, in the arm where it was first served;
  4. replays the results day by day through the SAME decision function the simulator and the proof lab use (`engine.Monitor.look`).
     At the look for day d it uses ONLY calls made on or before day d, so a decision is identical whether the results arrive daily or
     all at once;
  5. returns a record in the same shape as a simulated run, so the dashboard, the ledger and the reports work unchanged.

The plan (expected rate under A, share sent to B, smallest lift, test length) must be given up front: it fixes the boundaries, and a plan
read off the results would make the decision depend on the results. Nothing here knows about audio.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from . import engine, seqdesign
from .engine import Config, Counts, Monitor, build_design
from .ledger import Ledger, verify
from .stats import binom_ci
from .variants import prompt_hash

# ---------------------------------------------------------------------------- column vocabulary

ALIASES = {
    "lead": ["lead_id", "lead", "glid", "buyer_id", "customer_id", "user_id", "phone", "mobile", "msisdn", "number"],
    "call": ["call_id", "call", "recording_id", "session_id", "conversation_id", "id"],
    "arm": ["variant", "arm", "group", "bucket", "prompt_version", "prompt", "version", "experiment_variant", "agent_variant"],
    "time": ["timestamp", "call_time", "start_time", "started_at", "created_at", "called_at", "datetime", "time", "date"],
    "disp": ["disposition", "call_outcome", "buyer_disposition", "outcome", "result", "label", "status"],
    "goal": ["goal_hit", "converted", "goal", "success", "is_converted", "conversion"],
    "dur": ["duration_s", "duration_sec", "duration_seconds", "duration", "handling_time", "aht", "call_duration", "talk_time"],
    "conn": ["connected", "is_connected", "answered", "connect"],
    # daily summary files
    "day": ["day", "date", "test_day"],
    "n": ["leads", "n", "calls", "users", "count", "volume"],
    "x": ["goal_count", "conversions", "successes", "converted_count", "goals", "x"],
    "mean_dur": ["mean_duration", "avg_duration", "mean_duration_s", "avg_duration_s", "aht"],
    "sd_dur": ["sd_duration", "std_duration", "sd_duration_s", "std_duration_s", "duration_sd"],
    "g": ["guard_count", "guardrail_count", "fatal_count", "early_hangup_count"],
}
ARM_A = {"a", "control", "baseline", "base", "current", "production", "prod", "0", "v1", "prompt_a", "variant_a", "a_control"}
ARM_B = {"b", "test", "treatment", "variant", "candidate", "challenger", "1", "v2", "prompt_b", "variant_b", "b_candidate"}
TRUE = {"1", "true", "t", "yes", "y", "converted", "success"}
FALSE = {"0", "false", "f", "no", "n"}
PLACEHOLDER = {"", "null", "none", "nan", "n/a", "na", "-", "unknown", "undefined", "nil"}
MAX_DURATION_S = 86400.0


class DataError(ValueError):
    """The files cannot be analysed as they are. The message says exactly what to fix."""


def _col(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(s).strip().lower()).strip("_")


def _norm_val(s) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(s).strip().lower()).strip("_")


def parse_text(text: str) -> tuple[list[str], list[dict]]:
    """Return (normalised column names, rows). CSV/TSV/semicolon/pipe, JSON list, {"rows": [...]}, or JSON lines."""
    t = text.lstrip("﻿").strip()
    if not t:
        raise DataError("the file is empty")
    rows: list | None = None
    if t[0] in "[{":
        try:
            obj = json.loads(t)
            rows = obj if isinstance(obj, list) else next((obj[k] for k in ("rows", "calls", "data", "results") if isinstance(obj.get(k), list)), None)
        except json.JSONDecodeError:
            try:
                rows = [json.loads(line) for line in t.splitlines() if line.strip()]
            except json.JSONDecodeError as e:
                raise DataError(f"the file looks like JSON but cannot be read ({e.msg} near character {e.pos})")
        if rows is None:
            raise DataError("JSON must be a list of records, or an object with a 'rows' list")
    else:
        head = t.splitlines()[0]
        delim = max(",\t;|", key=head.count)
        if head.count(delim) == 0:
            raise DataError("could not find a delimiter in the header line (expected comma, tab, semicolon or pipe)")
        rows = list(csv.DictReader(io.StringIO(t), delimiter=delim))
    rows = [{_col(k): v for k, v in r.items() if k is not None} for r in rows if isinstance(r, dict)]
    if not rows:
        raise DataError("no rows found")
    return list(rows[0].keys()), rows


def pick(cols: list[str], key: str, override: str | None = None) -> str | None:
    if override:
        o = _col(override)
        return o if o in cols else None
    for a in ALIASES[key]:
        if a in cols:
            return a
    return None


def parse_time(v) -> datetime | None:
    """A naive datetime. A zone offset in the text is converted to UTC; epoch numbers are UTC. Nothing depends on the server's zone."""
    if v is None or str(v).strip() == "":
        return None
    s = str(v).strip()
    try:
        if re.fullmatch(r"\d{9,13}(\.\d+)?", s):
            x = float(s)
            return datetime.fromtimestamp(x / 1000 if x > 1e11 else x, tz=timezone.utc).replace(tzinfo=None)
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d.astimezone(timezone.utc).replace(tzinfo=None) if d.tzinfo else d
    except (ValueError, OverflowError, OSError):
        pass
    for f in ("%d-%m-%Y %H:%M:%S", "%d/%m/%Y %H:%M:%S", "%d-%m-%Y %H:%M", "%d/%m/%Y %H:%M", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, f)
        except ValueError:
            continue
    return None


def _truthy(v) -> bool | None:
    """True / False, or None when there is no readable answer (blank, text)."""
    s = str(v).strip().lower()
    if s in TRUE:
        return True
    if s in FALSE:
        return False
    try:
        x = float(s)
        return x > 0 if math.isfinite(x) else None
    except ValueError:
        return None


def _num(v) -> float | None:
    try:
        x = float(str(v).strip())
        return x if math.isfinite(x) else None
    except ValueError:
        return None


# ---------------------------------------------------------------------------- options

@dataclass
class Opts:
    goal: list = field(default_factory=list)       # dispositions that count as the goal (when no goal column)
    goal_name: str = ""                            # label shown for the goal
    goal_column: str | None = None
    denominator: str = "all"                       # all | connected
    a_name: str = "A (control)"
    b_name: str = "B (candidate)"
    arm_map: dict = field(default_factory=dict)    # file value -> "A" or "B"
    exp_id: str = "exp-files"
    name: str = "Results from files"
    # the plan: REQUIRED, because it fixes the decision boundaries
    share_b: float | None = None
    baseline: float | None = None
    window_days: int | None = None
    mde: float = 0.05
    leads_per_day: int | None = None
    rule_set: str = "sequential"
    approval: str = "auto"
    guardrail_margin: float = 0.15
    direction: str = "higher"
    guard_name: str = ""                           # optional rate guardrail: name of the event
    guard_column: str | None = None                # column that is 1 when the event happened ...
    guard_below_s: float | None = None             # ... or derive it: duration shorter than this many seconds
    guard_margin: float = 0.02
    through_day: int | None = None                 # only use results up to and including this day ("results up to yesterday")
    complete: bool | None = None                   # the test window is over (default: it is over when the last day of the window has data)
    start: str | None = None

    @staticmethod
    def from_dict(d: dict | None) -> "Opts":
        d = dict(d or {})
        known = {k: d[k] for k in Opts.__dataclass_fields__ if k in d and d[k] not in (None, "")}
        if isinstance(known.get("goal"), str):
            known["goal"] = [x.strip() for x in known["goal"].split(",") if x.strip()]
        for k in ("direction", "rule_set", "approval", "denominator"):
            if isinstance(known.get(k), str):
                known[k] = known[k].strip().lower()
        if known.get("direction") in ("up", "increase", "max", "maximise", "maximize"):
            known["direction"] = "higher"
        if known.get("direction") in ("down", "decrease", "min", "minimise", "minimize"):
            known["direction"] = "lower"
        try:
            return Opts(**known)
        except TypeError as e:
            raise DataError(f"unreadable option: {e}")


def _check_plan(o: Opts):
    miss = [n for n, v in (("baseline (the expected goal rate under A)", o.baseline), ("share_b (the share of traffic sent to B)", o.share_b),
                           ("window_days (the length of the test)", o.window_days)) if v is None]
    if miss:
        raise DataError("Tell Canary the plan before it reads the results: " + "; ".join(miss) + ". "
                        "The plan fixes the decision boundaries, and a plan read off the results would make the decision depend on them.")
    if o.direction not in ("higher", "lower"):
        raise DataError("direction must be 'higher' or 'lower'")
    if o.rule_set not in ("sequential", "final_look"):
        raise DataError("rule must be 'sequential' or 'final_look'")
    if o.through_day is not None and o.through_day < 1:
        raise DataError("through_day must be 1 or more")
    if o.arm_map and any(str(v).upper() not in ("A", "B") for v in o.arm_map.values()):
        raise DataError("arm_map values must be 'A' or 'B'")
    if o.guard_name and not (o.guard_column or o.guard_below_s is not None):
        raise DataError(f"the guardrail {o.guard_name!r} needs a column (guard_column) or a threshold (guard_below_s) that says when it happened")


# ---------------------------------------------------------------------------- stage 1: files -> clean calls

def build_calls(files: list[dict], o: Opts) -> tuple[list[dict], dict]:
    warnings: list[str] = []
    calls: list[dict] = []
    colmap: dict = {}
    dropped = Counter()
    seen_ids: set = set()
    dup = 0
    bad_time = bad_dur = no_lead = 0
    missing_goal_values: set = set()
    for fi in files:
        cols, rows = parse_text(fi["text"])
        arm_c = pick(cols, "arm", None)
        if fi.get("arm") is None and arm_c is None:
            raise DataError(f"{fi['name']}: no column says which prompt served the call (expected one of: {', '.join(ALIASES['arm'][:5])}…). "
                            f"Upload A's results and B's results as two files, or add a variant column.")
        lead_c, call_c, time_c = pick(cols, "lead"), pick(cols, "call"), pick(cols, "time")
        disp_c = pick(cols, "disp"); goal_c = pick(cols, "goal", o.goal_column); dur_c = pick(cols, "dur"); conn_c = pick(cols, "conn")
        if o.goal_column and goal_c is None:
            raise DataError(f"{fi['name']}: the goal column {o.goal_column!r} is not in the file (columns: {', '.join(cols)})")
        want = {_norm_val(x) for x in o.goal}
        by_disp = bool(want)
        if by_disp and disp_c is None:
            raise DataError(f"{fi['name']}: you named dispositions that count as the goal, but the file has no disposition column (expected one of: {', '.join(ALIASES['disp'][:5])}…)")
        if not by_disp and goal_c is None:
            top = Counter(_norm_val(r.get(disp_c, "")) for r in rows).most_common(12) if disp_c else []
            raise DataError(f"{fi['name']}: which outcome counts as the goal? Either add a 0/1 goal column, or name the dispositions that count. "
                            + (f"Dispositions in this file: {', '.join(f'{k} ({v})' for k, v in top)}." if top else f"Columns found: {', '.join(cols)}."))
        if by_disp:
            present = Counter(_norm_val(r.get(disp_c, "")) for r in rows)
            if not any(present[w] for w in want):
                raise DataError(f"{fi['name']}: none of the dispositions you named as the goal ({', '.join(sorted(want))}) appear in the file. "
                                f"Dispositions in this file: {', '.join(f'{k} ({v})' for k, v in present.most_common(12))}.")
            missing_goal_values |= {w for w in want if not present[w]}
            if goal_c and not o.goal_column:
                warnings.append(f"{fi['name']}: the file has a 0/1 column {goal_c!r}; it was ignored because you named the goal dispositions")
        colmap = {"lead": lead_c, "call": call_c, "arm": arm_c, "time": time_c, "disposition": disp_c, "goal": None if by_disp else goal_c,
                  "duration": dur_c, "connected": conn_c}
        # a date column with a separate clock column next to it
        clock_c = None
        if "date" in cols and time_c in ("time", "call_time", "start_time") and "timestamp" not in cols:
            time_c, clock_c = "date", time_c
        colmap["time"] = time_c
        guard_c = _col(o.guard_column) if o.guard_column else None
        if guard_c and guard_c not in cols:
            raise DataError(f"{fi['name']}: guardrail column {o.guard_column!r} is not in the file (columns: {', '.join(cols)})")
        if o.guard_name and not guard_c and dur_c is None:
            raise DataError(f"{fi['name']}: the guardrail {o.guard_name!r} is derived from call duration, but the file has no duration column")
        amap = {_norm_val(k): str(v).upper() for k, v in (o.arm_map or {}).items()}
        for i, r in enumerate(rows):
            arm = fi.get("arm")
            if arm is None:
                v = _norm_val(r.get(arm_c, ""))
                arm = amap.get(v) or ("A" if v in ARM_A else "B" if v in ARM_B else None)
                if arm is None:
                    dropped[f"unknown variant value {r.get(arm_c)!r}"] += 1
                    continue
            if by_disp:
                raw = str(r.get(disp_c, "")).strip()
                hit = (_norm_val(raw) in want) if raw != "" else None
            else:
                hit = _truthy(r.get(goal_c))
            if hit is None:
                dropped["no outcome / unreadable goal value"] += 1
                continue
            cid = r.get(call_c) if call_c else None
            if cid not in (None, ""):
                key = (fi["name"] if fi.get("arm") else "", str(cid))
                if key in seen_ids:
                    dup += 1
                    continue
                seen_ids.add(key)
            dur = _num(r.get(dur_c)) if dur_c else None
            if dur_c and str(r.get(dur_c, "")).strip() != "" and (dur is None or dur < 0 or dur > MAX_DURATION_S):
                bad_dur += 1
                dur = None
            conn = _truthy(r.get(conn_c)) if conn_c else None
            g = None
            if guard_c:
                raw = r.get(guard_c)
                g = _truthy(raw)
                if g is None and str(raw).strip().lower() not in PLACEHOLDER:
                    raise DataError(f"{fi['name']}: the guardrail column {o.guard_column!r} holds a value that is not yes/no or 0/1: {str(raw)!r} (row {i + 2})")
            elif o.guard_below_s is not None and dur is not None:
                g = dur < o.guard_below_s
            tv = r.get(time_c) if time_c else None
            if clock_c and str(r.get(clock_c, "")).strip():
                tv = f"{str(tv).strip()} {str(r.get(clock_c)).strip()}"
            t = parse_time(tv) if time_c else None
            if time_c and t is None:
                bad_time += 1
            lead = str(r.get(lead_c)).strip() if lead_c else ""
            if not lead_c or lead.lower() in PLACEHOLDER:
                lead = None
                if lead_c:
                    no_lead += 1
            calls.append({"lead": lead, "arm": arm, "t": t, "hit": bool(hit), "dur": dur, "conn": conn, "g": g, "order": len(calls),
                          "disp": _norm_val(r.get(disp_c, "")) if disp_c else None})
    if not calls:
        raise DataError("no usable rows after cleaning: " + ("; ".join(f"{v} × {k}" for k, v in dropped.items()) or "nothing was read"))
    if dup:
        warnings.append(f"{dup} repeated call ids were ignored (each call counted once)")
    for k, v in dropped.items():
        warnings.append(f"{v} rows dropped: {k}")
    if missing_goal_values:
        warnings.append(f"named as goal but never seen in the file: {', '.join(sorted(missing_goal_values))} (check the spelling)")
    if bad_dur:
        warnings.append(f"{bad_dur} durations were not usable (negative, not a number, or longer than a day) and were left out")
    has_lead_col = bool(colmap.get("lead"))
    if not has_lead_col:
        warnings.append("no lead id: every call counts as its own lead. A caller who phoned twice is counted twice, which makes the result look surer than it is")
    elif no_lead:
        warnings.append(f"{no_lead} calls have no usable lead id (blank, NULL, unknown); each is counted as its own lead")
    timed = all(c["t"] is not None for c in calls) and bool(colmap.get("time"))
    if not timed:
        if colmap.get("time"):
            warnings.append(f"{bad_time or 'some'} rows have no readable timestamp, so the whole file is read in file order instead of by day")
        else:
            warnings.append("no timestamp column: the file is read in file order, in up to 40 equal steps, and the test length in days does not apply. "
                            "If the file is sorted by prompt, the split check will (rightly) fire")
        for c in calls:
            c["t"] = None
    for i, c in enumerate(calls):
        if c["lead"] is None:
            c["lead"] = f"#call{i}"
    report = {"files": [f["name"] for f in files], "files_sha256": [hashlib.sha256(f["text"].encode()).hexdigest()[:16] for f in files],
              "rows_read": len(calls) + dup + sum(dropped.values()), "calls_used": len(calls), "has_lead_id": has_lead_col, "has_time": timed,
              "columns": colmap, "warnings": warnings,
              "dispositions": Counter(c["disp"] for c in calls if c["disp"]).most_common(12) if calls and calls[0]["disp"] is not None else []}
    return calls, report


# ---------------------------------------------------------------------------- stage 2: calls -> cumulative day-by-day snapshots

def snapshots(calls: list[dict], report: dict, o: Opts, n_cap: int | None) -> list[dict]:
    """A snapshot per day: the counts that were knowable at the END of that day. A lead appears from its first call; it is converted from the
    day a call of its own arm reached the goal. Calls after the window, after `through_day`, and leads beyond the planned maximum are left out."""
    warn = report["warnings"]
    timed = report["has_time"]
    window = o.window_days
    d0 = None
    if timed:
        d0 = min(c["t"].date() for c in calls)
        for c in calls:
            c["day"] = (c["t"].date() - d0).days + 1
        late = sum(1 for c in calls if c["day"] > window)
        if late:
            warn.append(f"{late} calls fall after the {window}-day window and were not used")
        calls = [c for c in calls if c["day"] <= window]
        if o.through_day:
            calls = [c for c in calls if c["day"] <= o.through_day]
        if not calls:
            raise DataError(f"no calls fall inside the first {o.through_day or window} days of the file (the first call is on {d0.isoformat()})")
        have = {c["day"] for c in calls}
        empty = [d for d in range(1, max(have) + 1) if d not in have]
        if empty:
            warn.append(f"no calls on {len(empty)} day{'s' if len(empty) != 1 else ''} inside the window (day {', '.join(map(str, empty[:6]))}{'…' if len(empty) > 6 else ''}); check the dates")
    # one record per lead, in the arm of its first call
    by: dict = {}
    for c in sorted(calls, key=lambda c: ((c["t"] or datetime.min), c["order"])):
        by.setdefault(c["lead"], []).append(c)
    leads = []
    both = 0
    for lead, cs in by.items():
        arm = cs[0]["arm"]
        own = [c for c in cs if c["arm"] == arm]
        if len(own) != len(cs):
            both += 1
        leads.append({"lead": lead, "arm": arm, "first": (cs[0]["t"] or datetime.min, cs[0]["order"]), "day": cs[0].get("day"), "calls": own})
    leads.sort(key=lambda l: l["first"])
    report["leads_in_both_arms"] = both
    if both:
        warn.append(f"{both} leads appear under BOTH prompts. Either sticky assignment broke, or rows were duplicated with the other prompt's label (look for call ids that repeat with a suffix). "
                    f"Each lead is counted once, in the arm of its first call, and only calls of that arm count toward its outcome")
    if o.denominator == "connected":
        if any(c["conn"] is None for l in leads for c in l["calls"]):
            warn.append("denominator 'connected' needs a connected column on every call; it is missing, so all leads are counted")
        else:
            before = len(leads)
            leads = [l for l in leads if any(c["conn"] for c in l["calls"])]
            warn.append(f"only connected leads are counted ({len(leads)} of {before})")
    has_dur_col = bool(report["columns"].get("duration"))
    have_dur = has_dur_col
    all_dur = all(c["dur"] is not None for l in leads for c in l["calls"]) and has_dur_col
    use_guard = bool(o.guard_name)
    if use_guard and any(c["g"] is None for l in leads for c in l["calls"]):
        raise DataError(f"the guardrail {o.guard_name!r} cannot be read for every call (blank values or missing durations); fix the column or leave the guardrail out")
    report["duration_column"] = "complete" if all_dur else "partial" if have_dur else "none"
    if have_dur and not all_dur:
        warn.append("some calls have no usable duration: the handling-time guardrail cannot be evaluated, so a win will be HELD for a person instead of shipped")
    if not have_dur:
        warn.append("no duration column: no handling-time guardrail was checked")
    arms = Counter(l["arm"] for l in leads)
    if not arms.get("A") or not arms.get("B"):
        raise DataError(f"need results for both prompts, found A={arms.get('A', 0)} leads and B={arms.get('B', 0)} leads")
    report.update({"leads": len(leads), "arms": dict(arms), "repeat_call_share": round(1 - len(leads) / max(1, len(calls)), 4) if report["has_lead_id"] else None})

    def tally(units, upto):
        out = {a: {"n": 0, "x": 0, "s": 0.0, "q": 0.0, "g": 0} for a in "AB"}
        for l in units:
            cs = [c for c in l["calls"] if upto is None or (c.get("day") or 0) <= upto]
            a = out[l["arm"]]
            a["n"] += 1
            a["x"] += any(c["hit"] for c in cs)
            if all_dur:
                d = sum(c["dur"] for c in cs) / len(cs)
                a["s"] += d; a["q"] += d * d
            if use_guard:
                a["g"] += any(c["g"] for c in cs)
        return out

    snaps = []
    if timed:
        last_day = max(c["day"] for l in leads for c in l["calls"])
        first_day = min(l["day"] for l in leads)
        for d in range(first_day, last_day + 1):
            units = [l for l in leads if l["day"] <= d]
            if not units:
                continue
            capped = False
            if n_cap is not None and len(units) >= n_cap:
                units, capped = units[:n_cap], True
            t = tally(units, d)
            snaps.append({"day": d, "t": datetime.combine(d0 + timedelta(days=d - 1), datetime.min.time()), "A": t["A"], "B": t["B"], "capped": capped})
            if capped:
                break
    else:
        us = sorted(leads, key=lambda l: l["first"])
        k = min(40, max(1, len(us) // 20))
        for i in range(k):
            m = round(len(us) * (i + 1) / k)
            units = us[:m]
            if not units:
                continue
            capped = False
            if n_cap is not None and len(units) >= n_cap:
                units, capped = units[:n_cap], True
            t = tally(units, None)
            snaps.append({"day": i + 1, "t": None, "A": t["A"], "B": t["B"], "capped": capped})
            if capped:
                break
    for sn in snaps:
        for a in "AB":
            if not all_dur:
                sn[a]["s"] = sn[a]["q"] = (0.0 if have_dur else None)    # partial: zeros make the guardrail 'not evaluable' (win is held); none: no guardrail
            if not use_guard:
                sn[a]["g"] = None
    return snaps


def build_daily(files: list[dict], o: Opts) -> tuple[list[dict], dict]:
    """One row per day and variant: day, variant, leads, goal count [, mean/sd duration, guardrail count]. Returns cumulative snapshots."""
    warnings: list[str] = []
    per: dict = {}
    for fi in files:
        cols, rows = parse_text(fi["text"])
        day_c, arm_c, n_c, x_c = pick(cols, "day"), pick(cols, "arm", None), pick(cols, "n"), pick(cols, "x")
        md_c, sd_c, g_c = pick(cols, "mean_dur"), pick(cols, "sd_dur"), pick(cols, "g")
        if not (day_c and n_c and x_c):
            raise DataError(f"{fi['name']}: a daily summary needs a day, a lead count and a goal count (found columns: {', '.join(cols)})")
        if fi.get("arm") is None and not arm_c:
            raise DataError(f"{fi['name']}: no variant column")
        if o.guard_name and not g_c:
            raise DataError(f"{fi['name']}: the guardrail {o.guard_name!r} needs a count column in the daily summary (for example guard_count)")
        amap = {_norm_val(k): str(v).upper() for k, v in (o.arm_map or {}).items()}
        for r in rows:
            arm = fi.get("arm")
            if arm is None:
                v = _norm_val(r.get(arm_c))
                arm = amap.get(v) or ("A" if v in ARM_A else "B" if v in ARM_B else None)
            n, x = _num(r.get(n_c)), _num(r.get(x_c))
            t = parse_time(r.get(day_c))
            dn = _num(r.get(day_c))
            d_idx = int(dn) if t is None and dn is not None and 0 < dn < 4000 else None
            if arm is None or n is None or x is None or (t is None and d_idx is None):
                warnings.append(f"skipped an unreadable row: {dict(list(r.items())[:4])}")
                continue
            if n < 0 or x < 0 or x > n:
                raise DataError(f"{fi['name']}: goal count {x:g} must be between 0 and the lead count {n:g} (day {r.get(day_c)})")
            m, sd = (_num(r.get(md_c)) if md_c else None), (_num(r.get(sd_c)) if sd_c else None)
            if (m is not None and (m < 0 or m > MAX_DURATION_S)) or (sd is not None and (sd < 0 or sd > MAX_DURATION_S)):
                raise DataError(f"{fi['name']}: duration mean/sd outside 0 to {MAX_DURATION_S:g} seconds on {r.get(day_c)}")
            g = None
            if g_c:
                g = _num(r.get(g_c))
                if g is None or g < 0 or g > n:
                    raise DataError(f"{fi['name']}: guardrail count must be between 0 and the lead count on {r.get(day_c)}")
            key = t.date() if t else d_idx
            e = per.setdefault(key, {"A": None, "B": None})
            if e[arm] is not None:
                raise DataError(f"{fi['name']}: two rows for the same day and prompt ({r.get(day_c)}, {arm}). A daily summary needs exactly one row per day and prompt")
            e[arm] = {"n": int(n), "x": int(x), "s": (m * n if m is not None else None),
                      "q": (((n - 1) * sd * sd + n * m * m) if (m is not None and sd is not None and n > 1) else None), "g": (int(g) if g is not None else None)}
    keys = sorted(per, key=lambda k: (k if isinstance(k, date) else date(2000, 1, 1) + timedelta(days=k)))
    k0 = keys[0] if keys else None
    days = []
    for k in keys:
        e = per[k]
        if not e["A"] or not e["B"]:
            warnings.append(f"{k}: only one prompt has numbers; the day is skipped")
            continue
        idx = ((k - k0).days + 1) if isinstance(k, date) else (k - k0 + 1)
        days.append({"day": idx, "t": datetime.combine(k, datetime.min.time()) if isinstance(k, date) else None, "A": e["A"], "B": e["B"]})
    if not days:
        raise DataError("no complete days (both prompts) in the summary")
    use_dur = all(d[a]["s"] is not None and d[a]["q"] is not None for d in days for a in "AB")
    use_guard = bool(o.guard_name)
    if not use_dur:
        warnings.append("the summary has no mean/sd duration, so the handling-time guardrail was not checked")
    snaps, cum = [], {a: {"n": 0, "x": 0, "s": 0.0, "q": 0.0, "g": 0} for a in "AB"}
    window = o.window_days
    for d in days:
        if d["day"] > window or (o.through_day and d["day"] > o.through_day):
            continue
        for a in "AB":
            c = cum[a]; r = d[a]
            c["n"] += r["n"]; c["x"] += r["x"]
            if use_dur:
                c["s"] += r["s"]; c["q"] += r["q"]
            if use_guard:
                c["g"] += r["g"]
        snaps.append({"day": d["day"], "t": d["t"], "A": {**cum["A"]}, "B": {**cum["B"]}, "capped": False})
    if not snaps:
        raise DataError("no days fall inside the test window")
    for sn in snaps:
        for a in "AB":
            if not use_dur:
                sn[a]["s"] = sn[a]["q"] = None
            if not use_guard:
                sn[a]["g"] = None
    report = {"files": [f["name"] for f in files], "files_sha256": [hashlib.sha256(f["text"].encode()).hexdigest()[:16] for f in files],
              "format": "daily summary", "days": len(snaps), "has_lead_id": False, "has_time": snaps[0]["t"] is not None, "leads_in_both_arms": None,
              "leads": snaps[-1]["A"]["n"] + snaps[-1]["B"]["n"], "calls_used": snaps[-1]["A"]["n"] + snaps[-1]["B"]["n"],
              "arms": {"A": snaps[-1]["A"]["n"], "B": snaps[-1]["B"]["n"]}, "duration_column": "complete" if use_dur else "none",
              "columns": {}, "warnings": warnings + ["a daily summary cannot show whether any lead saw both prompts; the sticky check needs per-call files"]}
    return snaps, report


def _is_daily(files: list[dict]) -> bool:
    cols, _ = parse_text(files[0]["text"])
    return bool(pick(cols, "n") and pick(cols, "x")) and not pick(cols, "disp") and not pick(cols, "goal")


# ---------------------------------------------------------------------------- stage 3: replay through the proven decision rule

def _clean(x):
    """Strict JSON: no NaN or infinity anywhere."""
    if isinstance(x, float) and not math.isfinite(x):
        return None
    if isinstance(x, dict):
        return {k: _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    return x


def analyse(snaps: list[dict], report: dict, o: Opts, plan: dict) -> dict:
    warn = report["warnings"]
    timed = snaps[0]["t"] is not None
    # a snapshot with nothing new is not a new look
    keep, prev = [], 0
    for sn in snaps:
        n = sn["A"]["n"] + sn["B"]["n"]
        if n > prev:
            keep.append(sn); prev = n
    snaps = keep
    cum = [sn["A"]["n"] + sn["B"]["n"] for sn in snaps]
    window = o.window_days
    capped = snaps[-1].get("capped", False)
    last_day = snaps[-1]["day"]
    complete = o.complete if o.complete is not None else (capped or not timed or (last_day >= window and not o.through_day) or bool(o.through_day and o.through_day >= window))
    if capped:
        warn.append(f"the plan (baseline {o.baseline:.0%}, smallest lift {o.mde * 100:g} points, {o.share_b:.0%} to B) needs at most {plan['n_max']:,} leads and was reached on "
                    f"day {last_day}; leads after that were not used. To judge more data, plan for a smaller lift")
    if o.rule_set == "sequential" and not capped and cum[-1] > plan["n_max"] and report.get("format") == "daily summary":
        warn.append(f"a daily summary cannot be cut: the day that completed the plan brought the total to {cum[-1]:,} leads against a plan of {plan['n_max']:,}, "
                    f"so the false-win rate can be slightly above its 2.5% budget")
    lpd = o.leads_per_day or max(1, round(cum[-1] / max(1, (last_day if timed else window))))
    start = o.start or (snaps[0]["t"].isoformat(timespec="seconds") if timed else "2026-10-12T09:00:00")
    use_dur = report.get("duration_column", "none") != "none"
    use_guard = bool(o.guard_name)
    gdef = (f"{o.guard_name}: " + (f"column {o.guard_column}" if o.guard_column else f"call shorter than {o.guard_below_s:g} s")) if use_guard else ""
    gldef = (("dispositions " + ", ".join(sorted(o.goal))) if o.goal else f"column {o.goal_column or (report.get('columns', {}).get('goal') or 'goal')}") + f"; denominator {o.denominator}"
    cfg = Config(exp_id=o.exp_id, name=o.name, agent="results files", variant_b="external", share_b=o.share_b, assignment="hash", salt="from-files",
                 start=start, window_days=window, leads_per_day=lpd, primary_goal=o.goal_name or (", ".join(o.goal) if o.goal else "goal"),
                 primary_direction=o.direction, baseline=round(o.baseline, 4), mde=o.mde, secondary_metric="duration_s",
                 secondary_role="guardrail" if use_dur else "none", guardrail_margin=o.guardrail_margin,
                 guard_rate=o.guard_name if use_guard else "", guard_rate_margin=o.guard_margin, guard_rate_worse_when="higher",
                 loss_check=False, srm_alpha=0.001, approval=o.approval, rule_set=o.rule_set, goal_definition=gldef, guard_definition=gdef).validate()
    # look times = the end of each day that has data; the last look is final only if the window is over (or the planned maximum is reached)
    capacity = (max(window * lpd, plan["n_max"]) if capped else cum[-1]) if complete else max(window * lpd, cum[-1] + 1)
    ds = build_design(cfg, look_n=cum, planned_final=capacity)
    mon = Monitor(cfg, ds)
    clock = {"t": datetime.fromisoformat(start)}
    ledger = Ledger(lambda: clock["t"].isoformat(timespec="seconds"))
    hashA, hashB = prompt_hash("A:" + o.a_name), prompt_hash("B:" + o.b_name)
    variants = {"A": {"name": o.a_name, "hash": hashA, "origin": "external", "diff": [], "text": ""},
                "B": {"name": o.b_name, "hash": hashB, "origin": "external", "diff": [], "text": ""}}
    ledger.append("experiment_created", {
        "exp_id": cfg.exp_id, "config_hash": cfg.hash(), "config": cfg.as_dict(), "variant_A": hashA, "variant_B": hashB,
        "variant_B_origin": "external", "production_before": hashA, "config_version": cfg.version, "parent_config_hash": cfg.parent_hash or None,
        "config_locked": True,
        "source": {"type": "files", "files": report["files"], "files_sha256": report.get("files_sha256"), "leads": report.get("leads"), "warnings": len(warn)},
        "design": {"n_max": ds.n_max, "looks": len(ds.look_n), "alpha": cfg.alpha, "alpha_harm": cfg.alpha_harm, "rule_set": cfg.rule_set,
                   "spending": engine._spending(cfg), "power": cfg.power, "mde": cfg.mde}})
    ledger.append("routing_changed", {"A": 1 - cfg.share_b, "B": cfg.share_b, "reason": "test running (results supplied from files)"})

    c = Counts()
    looks, decision, final_row = [], None, None
    for k, sn in enumerate(snaps):
        clock["t"] = (sn["t"] + timedelta(hours=23, minutes=59)) if sn["t"] else datetime.fromisoformat(start) + timedelta(days=sn["day"])
        a, b = sn["A"], sn["B"]
        c.nA, c.xA, c.aA = a["n"], a["x"], a["n"]
        c.nB, c.xB, c.aB = b["n"], b["x"], b["n"]
        if use_dur:
            c.sA, c.qA, c.sB, c.qB = (a["s"] or 0.0), (a["q"] or 0.0), (b["s"] or 0.0), (b["q"] or 0.0)
        if use_guard:
            c.gA, c.gB = a["g"], b["g"]
        final = complete and k == len(snaps) - 1
        dec, row = mon.look(k, c, final, want_row=True)
        row["time"] = clock["t"].isoformat(timespec="seconds")
        row["exposedB"] = c.nB
        row["day"] = sn["day"]
        looks.append(row)
        ledger.append("look", {"k": k, "n": row["n"], "z": round(row["z"], 4), "bound_eff": round(row["eff"], 4), "bound_harm": round(row["harm"], 4),
                               "rateA": row["rateA"], "rateB": row["rateB"], "p_srm": row["p_srm"], "decision": dec["kind"], "day": sn["day"]})
        if dec["terminal"]:
            decision, final_row = dec, row
            break
    status = "decided" if decision else "running"
    if decision is None:
        decision = {"kind": "CONTINUE", "reason": f"results so far cover {last_day} of {window} days; no boundary crossed yet", "terminal": False}
        final_row = looks[-1]
    hold_cause, routing, production_after, tails = None, {"A": 1 - cfg.share_b, "B": cfg.share_b}, hashA, {}
    if status == "decided":
        decision, routing, production_after, hold_cause = engine.act_on_decision(cfg, ledger, decision, final_row, hashA, hashB, len(looks))
        tails = engine.decision_tails(ledger.entries, decision["kind"], hold_cause, hashA, hashB, looks[-1]["time"], demo=False, holdback=cfg.holdback_share, holdback_days=cfg.holdback_days)
    ok, _ = verify(ledger.entries)
    sa, sb = snaps[len(looks) - 1]["A"]["n"], snaps[len(looks) - 1]["B"]["n"]
    n_all = sa + sb
    lo, hi = binom_ci(sb, n_all) if n_all else (0.0, 1.0)
    split = {"mode": "from files", "configured_b": cfg.share_b, "achieved_b": sb / n_all if n_all else 0.0, "n_leads": n_all, "n_a": sa, "n_b": sb,
             "abs_error_pp": (sb / n_all - cfg.share_b) * 100 if n_all else 0.0, "binomial_ci": [lo, hi], "within_chance_band": bool(lo <= cfg.share_b <= hi),
             "split_check": "on"}
    both = report.get("leads_in_both_arms")
    result = {"kind": decision["kind"], "reason": decision["reason"], "hold_cause": hold_cause, "cause": decision.get("cause"), "status": status, "at_look": len(looks), "of_looks": len(ds.look_n),
              "calls_analysed": final_row["n"], "n_max": ds.n_max, "routing_after": routing, "production_before": hashA, "production_after": production_after,
              "exposed_b_calls": c.nB, "time": looks[-1]["time"], "split": split,
              "stickiness": {"leads_checked": report.get("leads", 0), "arm_changes": both if both is not None else 0, "independent_router_disagreements": None,
                             "checkable": both is not None},
              "days_seen": looks[-1]["day"], "window_days": window, "complete": complete}
    if decision["kind"] == "INCONCLUSIVE":
        result["more_leads"] = engine.more_leads(cfg, ds, final_row, lpd)
    rec = {"config": cfg.as_dict(), "config_hash": cfg.hash(), "design": ds.summary(), "variants": variants, "looks": looks, "result": result,
           "ledger": ledger.entries, "ledger_head": ledger.head, "ledger_ok": ok, "calls_simulated": None, "calls_read": report.get("calls_used", n_all), "tails": tails,
           "source": {"type": "files", **{k: v for k, v in report.items() if k != "warnings"}, "warnings": warn}}
    return _clean(rec)


def decide(files: list[dict], opts: dict | Opts | None = None) -> dict:
    """The one entry point. files: [{"name", "text", "arm": "A"|"B"|None}] (arm is set when A and B come as two separate files)."""
    o = opts if isinstance(opts, Opts) else Opts.from_dict(opts)
    if not files:
        raise DataError("no files given")
    _check_plan(o)
    try:
        sign = 1 if o.direction == "higher" else -1
        if not 0 < o.share_b <= 0.5:
            raise DataError("share_b is the smaller test slice, between 0 and 0.5; if B got more than half of the traffic, swap the roles of A and B")
        plan = seqdesign.plan_sample_size(min(max(o.baseline, 1e-4), 1 - 1e-4), sign * o.mde, o.share_b, 0.025, 0.8, 40)
        if _is_daily(files):
            snaps, report = build_daily(files, o)
        else:
            calls, report = build_calls(files, o)
            snaps = snapshots(calls, report, o, plan["n_max"] if o.rule_set == "sequential" else None)
        return analyse(snaps, report, o, plan)
    except DataError:
        raise
    except (ValueError, OverflowError, RecursionError, csv.Error, ZeroDivisionError, KeyError, IndexError, TypeError) as e:
        raise DataError(f"could not analyse the files: {e}")


def inspect(text: str, name: str = "file") -> dict:
    """A quick, no-decision look at a file so a person can choose what counts as success: what columns it has, which prompts it names,
    which outcomes occur and how often, and how many leads and days it covers."""
    cols, rows = parse_text(text)
    arm_c, lead_c, time_c = pick(cols, "arm", None), pick(cols, "lead"), pick(cols, "time")
    disp_c, goal_c, dur_c = pick(cols, "disp"), pick(cols, "goal"), pick(cols, "dur")
    if "date" in cols and time_c in ("time", "call_time", "start_time"):
        time_c = "date"
    arms = Counter(_norm_val(r.get(arm_c, "")) for r in rows) if arm_c else Counter()
    disp = Counter(str(r.get(disp_c, "")).strip() for r in rows if str(r.get(disp_c, "")).strip()) if disp_c else Counter()
    leads = len({str(r.get(lead_c)).strip() for r in rows}) if lead_c else None
    days = None
    if time_c:
        ts = [parse_time(r.get(time_c)) for r in rows[:5000]]
        ts = [t for t in ts if t]
        if ts:
            days = (max(ts).date() - min(ts).date()).days + 1
    return {"name": name, "rows": len(rows), "columns": cols, "variant_column": arm_c, "variants": dict(arms.most_common(6)),
            "lead_column": lead_c, "leads": leads, "time_column": time_c, "days": days, "outcome_column": disp_c, "outcomes": disp.most_common(20),
            "goal_column": goal_c, "duration_column": dur_c, "daily_summary": _is_daily([{"text": text}])}


def summary_text(rec: dict) -> str:
    """The decision in plain words, for the terminal."""
    r, c, src = rec["result"], rec["config"], rec["source"]
    last = rec["looks"][-1]
    pc = lambda x: f"{x:.1%}" if x is not None else "n/a"
    pp = lambda x: f"{x * 100:+.2f}" if x is not None else "n/a"
    lines = [f"{r['kind'].replace('_', ' ')}  ({r['status']}; day {r['days_seen']} of {r['window_days']}, {r['calls_analysed']:,} leads analysed)",
             r["reason"], "",
             f"A  {last['xA']:,} of {last['nA']:,} = {pc(last['rateA'])}      B  {last['xB']:,} of {last['nB']:,} = {pc(last['rateB'])}",
             f"B minus A = {pp(last['diff'])} points   (always-valid 95% interval {pp(last['rci'][0])} to {pp(last['rci'][1])})",
             f"evidence now z = {last['z']:.2f}; win line {'far away (above 50)' if last['eff'] > 50 else f'z >= {last['eff']:.2f}'}, stop line z <= -{last['harm']:.2f}",
             f"rule set: {c['rule_set']}   ledger: {'intact' if rec['ledger_ok'] else 'BROKEN'} ({rec['ledger_head'][:12]})"]
    if r.get("more_leads"):
        m = r["more_leads"]
        lines += ["", "What would settle it:"] + [
            (f"  already enough data to detect {o['lift_pp']} points ({o['label']}): a real lift, if any, is smaller than that" if o["enough_already"] else
             f"  {o['more_leads']:,} more leads (~{o['more_days']} days) to detect {o['lift_pp']} points ({o['label']})" + ("  [not practical: over a year]" if o.get("impractical") else ""))
            for o in m["options"]]
    if src.get("warnings"):
        lines += ["", "Data notes:"] + [f"  - {w}" for w in src["warnings"]]
    return "\n".join(lines)
