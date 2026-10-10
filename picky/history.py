"""The last 30 days of lead and call data that the New Experiment page reads (leads a day, today's rate, metric previews).

HONEST LABEL: no real lead table was provided, so this history is a SYNTHETIC PLACEHOLDER, generated deterministically:
  * leads arrive every day (about LEADS_PER_DAY attempted leads; the count varies a little day to day);
  * each lead's factors (HL Type, Legal Status, ...) come from `catalog.lead_vars`, the same function the router and simulator use;
  * a lead is dialled up to MAX_ATTEMPTS times until someone answers (each attempt answered with P_ANSWER, a placeholder);
  * an answered call's length is RESAMPLED from the 713 real recordings (whole seconds), so the early hang-up share is real;
  * an answered call ends in one disposition, drawn from DISPOSITIONS (a placeholder mix; BuyLead created is 45%, the planning baseline
    used everywhere else in this build).
Outcomes do not depend on the factors (the same assumption the simulator makes). Replace `leads()` with a reader of the real table and every
number on the page follows, because they are all computed from these rows.

One row per call attempt (see `calls()`); `COLUMNS` lists every column a segment or a metric may use.
"""
from __future__ import annotations

import json
import random
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

from . import catalog

DATA = Path(__file__).resolve().parent.parent / "data"

END = date(2026, 10, 8)              # the day before the demo's "today" (2026-10-09)
DAYS = 30
START = END - timedelta(days=DAYS - 1)
LEADS_PER_DAY = 1030                 # attempted leads a day, all traffic (placeholder: gives about 1,000 connected leads a day)
P_ANSWER = 0.70                      # chance a single attempt is answered (placeholder)
MAX_ATTEMPTS = 3
NOT_ANSWERED = [("Not answered", 0.60), ("Busy", 0.25), ("Failed", 0.15)]
NO_CONNECT = "Nobody spoke"
DISPOSITIONS = [("BuyLead created", 0.45), ("Meeting Fixed", 0.08), ("Callback Fixed", 0.10), ("Buyer Enriched", 0.07),
                ("Requirement not confirmed", 0.12), ("Wanted the original seller only", 0.05), ("No product requirement", 0.09), ("Other / unclear", 0.04)]
EARLY_HANGUP_S = 15                  # an answered call shorter than this is an early hang-up (our assumed cut-off)
SEED = 20261008
SYNTHETIC_NOTE = ("Synthetic placeholder history: no real lead table was provided. Factors use the catalog's placeholder mix, call lengths are "
                  "resampled from the 713 real recordings, and connect rates and dispositions are placeholders. Replace it with the real table.")

STATUSES = ["Answered"] + [s for s, _ in NOT_ANSWERED]
DISP_VALUES = [d for d, _ in DISPOSITIONS] + [NO_CONNECT]

# every column a segment condition (factors) or a metric condition (call columns) may use: name, label, type, allowed values
COLUMNS = ([{"name": v["column"], "label": v["label"], "type": "category", "values": list(v["values"]), "factor": True} for v in catalog.CATALOG if v["pre_call"]] + [
    {"name": "call_status", "label": "Call status", "type": "category", "values": STATUSES, "factor": False},
    {"name": "connected", "label": "Connected", "type": "category", "values": ["1", "0"], "factor": False},
    {"name": "disposition", "label": "Disposition", "type": "category", "values": DISP_VALUES, "factor": False},
    {"name": "early_hangup", "label": f"Early hang-up (under {EARLY_HANGUP_S} s)", "type": "category", "values": ["Yes", "No"], "factor": False},
    {"name": "call_duration", "label": "Call duration", "type": "number", "unit": "s", "values": [], "factor": False},
])
COL = {c["name"]: c for c in COLUMNS}


def _pick(u: float, table: list) -> str:
    acc = 0.0
    for val, p in table:
        acc += p
        if u < acc:
            return val
    return table[-1][0]


@lru_cache(maxsize=1)
def _durations() -> tuple:
    rows = json.loads((DATA / "call_durations.json").read_text())
    return tuple(max(1, int(round(r["duration_s"]))) for r in rows)


@lru_cache(maxsize=1)
def leads() -> tuple:
    """Every lead of the last 30 days: factors, the attempts made, and the answered call's length and disposition. Deterministic."""
    rng = random.Random(SEED)
    durs = _durations()
    out, n = [], 0
    for d in range(DAYS):
        day = (START + timedelta(days=d)).isoformat()
        count = LEADS_PER_DAY + int(round((rng.random() - 0.5) * 0.08 * LEADS_PER_DAY))      # +-4% day to day
        for _ in range(count):
            lead_id = f"H{n:07d}"
            n += 1
            attempts = []
            for _a in range(MAX_ATTEMPTS):
                if rng.random() < P_ANSWER:
                    attempts.append("Answered")
                    break
                attempts.append(_pick(rng.random(), NOT_ANSWERED))
            connected = attempts[-1] == "Answered"
            dur = durs[int(rng.random() * len(durs))] if connected else 0
            disp = _pick(rng.random(), DISPOSITIONS) if connected else NO_CONNECT
            out.append({"lead_id": lead_id, "date": day, **catalog.lead_vars(lead_id), "attempts": tuple(attempts),
                        "connected": connected, "call_duration": dur, "disposition": disp})
    return tuple(out)


def lead_calls(lead: dict) -> list:
    """The call rows of one lead: one per attempt. Only the answered (last) attempt has a length and a disposition."""
    rows = []
    factors = {n: lead[n] for n in catalog.PRE_CALL}
    for k, st in enumerate(lead["attempts"], start=1):
        ans = st == "Answered"
        dur = lead["call_duration"] if ans else 0
        rows.append({"call_id": f"{lead['lead_id']}-{k}", "lead_id": lead["lead_id"], "date": lead["date"], **factors, "attempt": k,
                     "call_status": st, "connected": "1" if ans else "0", "call_duration": dur,
                     "disposition": lead["disposition"] if ans else NO_CONNECT, "early_hangup": "Yes" if ans and dur < EARLY_HANGUP_S else "No"})
    return rows


def calls() -> list:
    return [r for lead in leads() for r in lead_calls(lead)]


def audience(segment=None) -> dict:
    """Leads and connected leads of the last 30 days, all traffic or one audience (a segment), and the connected share of all traffic."""
    seg = catalog.validate_segment(segment) if segment else None
    n = c = n_all = c_all = 0
    for L in leads():
        n_all += 1
        c_all += L["connected"]
        if seg is None or catalog.matches(seg, L):
            n += 1
            c += L["connected"]
    return {"leads": n, "connected": c, "days": DAYS, "connected_per_day": c / DAYS, "p_connected_all": c_all / n_all}


# ---------------------------------------------------------------------------- the compact form the dashboard reads

ALPH = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"


def patterns() -> list:
    """Every possible sequence of attempt statuses: up to two misses then an answer, or one to three misses."""
    miss = [s for s, _ in NOT_ANSWERED]
    out = []
    for k in range(MAX_ATTEMPTS):
        for combo in _product(miss, k):
            out.append(tuple(combo) + ("Answered",))
    for k in range(1, MAX_ATTEMPTS + 1):
        for combo in _product(miss, k):
            out.append(tuple(combo))
    return out


def _product(items: list, k: int) -> list:
    res = [[]]
    for _ in range(k):
        res = [r + [x] for r in res for x in items]
    return res


def bundle() -> dict:
    """Leads as a fixed-width string, 13 characters a lead: day, the 8 factors, attempt pattern, disposition, call length (2 characters, base 62)."""
    pats = patterns()
    pidx = {p: i for i, p in enumerate(pats)}
    fac = catalog.PRE_CALL
    chunks = []
    for L in leads():
        day = (date.fromisoformat(L["date"]) - START).days
        d = L["call_duration"]
        chunks.append(ALPH[day] + "".join(ALPH[catalog.VARS[n]["values"].index(L[n])] for n in fac) + ALPH[pidx[L["attempts"]]]
                      + ALPH[DISP_VALUES.index(L["disposition"])] + ALPH[d // 62] + ALPH[d % 62])
    return {"synthetic": True, "note": SYNTHETIC_NOTE, "start": START.isoformat(), "end": END.isoformat(), "days": DAYS, "factors": fac,
            "columns": COLUMNS, "patterns": [list(p) for p in pats], "dispositions": DISP_VALUES, "no_connect": NO_CONNECT, "early_hangup_s": EARLY_HANGUP_S,
            "width": 13, "alphabet": ALPH, "leads": "".join(chunks), "n_leads": len(leads()), "n_calls": sum(len(L["attempts"]) for L in leads())}


def to_sqlite(path) -> None:
    """The same rows as a SQLite table `calls`, for an independent check of the dashboard's numbers with plain SQL."""
    import sqlite3
    con = sqlite3.connect(str(path))
    cols = ["call_id", "lead_id", "date"] + catalog.PRE_CALL + ["attempt", "call_status", "connected", "call_duration", "disposition", "early_hangup"]
    con.execute("DROP TABLE IF EXISTS calls")
    con.execute("CREATE TABLE calls (" + ", ".join(f"{c} {'INTEGER' if c in ('attempt', 'call_duration') else 'TEXT'}" for c in cols) + ")")
    con.executemany("INSERT INTO calls VALUES (" + ",".join("?" * len(cols)) + ")", [tuple(r[c] for c in cols) for r in calls()])
    con.commit()
    con.close()
