"""The data files in the Resources folder as a column catalog for the custom-metric builder, and metrics computed over them.

The folder is <repo parent>/Resources (or CANARY_RESOURCES). Each .csv (and .xlsx when openpyxl is installed) is read once per change
(cached by path, mtime and size). Only column names, inferred types and category value lists ever leave this module through catalog();
evaluate() returns aggregates only. Rows stay in this process's memory.

Column types: number, category (fewer than 50 distinct values in the whole file), date, id (key-like names, phone/number/url columns,
very high-cardinality integers), text, empty (no value at all).

A metric over a file (the "full definition"):
  {"source": "file", "file", "type": "rate" | "average" | "sum", "count": "calls" | "leads", "num": [conds], "den": [conds] (rate),
   "col": <number column> (average/sum), "where": [conds] (average/sum), "direction": "higher" | "lower", "name"}
  condition {"col", "op", "value" | "values"}; operators by column type in OPS.
"""
from __future__ import annotations

import csv
import math
import os
import re
from datetime import datetime, timedelta
from pathlib import Path

from . import catalog as factors                  # the factor catalog (HL Type -> HL Bucket); this module has its own catalog()

try:                                                     # optional: .xlsx files need it
    import openpyxl  # type: ignore
except Exception:                                        # pragma: no cover - depends on the machine
    openpyxl = None

SAMPLE_ROWS = 1000
MAX_CATEGORIES = 50
OPS = {
    "number": ("=", "!=", ">", ">=", "<", "<=", "between"),
    "category": ("is", "is_not", "in"),
    "date": ("before", "after", "between"),
    "text": ("contains", "not_contains"),
}
TYPES = ("rate", "average", "sum")
DATE_FORMATS = ("%d/%m/%y %H:%M", "%d/%m/%y %H:%M:%S", "%d/%m/%y", "%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%d-%m-%Y %H:%M", "%d-%m-%Y")
UNLINKABLE = "Can't be linked to calls"

_CACHE: dict = {}                                        # path -> {"key": (mtime, size), "info": {...}, "rows": [...]}
_SCANNED = {"at": None}


def folder() -> Path:
    env = os.environ.get("CANARY_RESOURCES")
    return Path(env) if env else Path(__file__).resolve().parent.parent.parent / "Resources"


# ---------------------------------------------------------------------------- reading and type inference

# Columns whose meaning the data team named (the Redash "Voice Bot - Dashboard" calls redis_bucket the HL Type), and columns derived from them.
LABELS = {"redis_bucket": "HL type", "hl_bucket": "HL bucket (Top 3 / Rest)"}
# HL bucket comes from the HL type through factors.derive (canary/catalog.py), the project's one rule (the PM's "Data type passed" table); never a copy of it here.
DERIVED = {"hl_bucket": "redis_bucket"}


def label(name: str) -> str:
    if name in LABELS:
        return LABELS[name]
    s = re.sub(r"[_\s]+", " ", str(name)).strip()
    return (s[:1].upper() + s[1:]) if s else str(name)


def _num(v: str):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def norm_value(v) -> str:
    """A cell as a category value: numeric codes without '.0' ("51.0" -> "51")."""
    s = "" if v is None else str(v).strip()
    x = _num(s)
    if x is not None and x.is_integer() and re.fullmatch(r"[-+]?\d+(\.0*)?", s):
        return str(int(x))
    return s


def _date_fmt(samples: list):
    for f in DATE_FORMATS:
        try:
            for s in samples:
                datetime.strptime(s, f)
            return f
        except ValueError:
            continue
    return None


def parse_date(v, fmt):
    s = "" if v is None else str(v).strip()
    if not s or not fmt:
        return None
    try:
        return datetime.strptime(s, fmt)
    except ValueError:
        return None


def _id_name(n: str) -> bool:
    return n.endswith("id")


def _always_id(n: str) -> bool:
    """Phone/number/url columns and join keys (call ids, lead ids) are ids whatever their count of distinct values."""
    return bool(re.search(r"(_number|number$|phone|mobile|url$|_url)", n) or n.endswith("call_id")
                or (re.search(r"lead(_\w+)?_id$", n) and "disposition" not in n))


def _infer(name: str, values: list) -> dict:
    """Type of one column from all its cells (patterns from the first SAMPLE_ROWS non-empty ones, distinct values from all)."""
    n = name.lower().strip()
    nonempty = [v for v in values if v != ""]
    meta = {"type": "text"}
    if not nonempty:
        return {"type": "empty"}
    if _always_id(n):
        return {"type": "id"}
    sample = nonempty[:SAMPLE_ROWS]
    nums = [_num(v) for v in sample]
    numeric = all(x is not None for x in nums)
    if not numeric:
        f = _date_fmt(sample)
        if f:
            return {"type": "date", "fmt": f}
    distinct = set()
    for v in nonempty:
        distinct.add(norm_value(v))
        if len(distinct) >= MAX_CATEGORIES:
            break
    if len(distinct) < MAX_CATEGORIES:
        vals = sorted(distinct, key=lambda s: (0, float(s), s) if _num(s) is not None else (1, 0.0, s))
        return {"type": "category", "values": vals}
    if _id_name(n):
        return {"type": "id"}
    if numeric:
        ints = all(x.is_integer() for x in nums)
        if ints and len(sample) >= 100 and len(set(nums)) > 0.9 * len(sample):
            return {"type": "id"}
        meta = {"type": "number"}
        if "duration" in n or n.endswith(("_sec", "_secs", "_seconds")):
            meta["unit"] = "s"
    return meta


def _read_csv(p: Path) -> tuple:
    with open(p, newline="", encoding="utf-8-sig", errors="replace") as fh:
        r = csv.reader(fh)
        header = next(r, [])
        rows = [row for row in r if any(c.strip() for c in row)]
    return [h.strip() for h in header], rows


def _read_xlsx(p: Path) -> tuple:
    wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    try:
        it = wb.worksheets[0].iter_rows(values_only=True)
        header = [("" if h is None else str(h)).strip() for h in next(it, [])]

        def cell(v):
            if v is None:
                return ""
            if isinstance(v, datetime):
                return v.strftime("%Y-%m-%d %H:%M:%S")
            return str(v)
        rows = [[cell(v) for v in row] for row in it if any(v not in (None, "") for v in row)]
    finally:
        wb.close()
    return header, rows


def _keys(cols: list, empties: dict) -> dict:
    calls = [c for c in cols if c.lower().endswith("call_id")]
    call = min(calls, key=lambda c: (empties.get(c, 0), cols.index(c))) if calls else None
    lead = next((c for c in cols if re.search(r"lead(_\w+)?_id$", c.lower()) and "disposition" not in c.lower()), None)
    return {"lead": lead, "call": call}


def _load(p: Path) -> dict:
    header, raw = (_read_csv(p) if p.suffix.lower() == ".csv" else _read_xlsx(p))
    width = len(header)
    rows = [{h: (row[i].strip() if i < len(row) and row[i] is not None else "") for i, h in enumerate(header)} for row in raw]
    cols, empties = {}, {}
    for h in header:
        if not h:
            continue
        vals = [r[h] for r in rows]
        empties[h] = sum(1 for v in vals if v == "")
        cols[h] = _infer(h, vals)
    for d, base in DERIVED.items():                      # e.g. HL bucket from the HL type, by the project's rule
        if base in cols and d not in cols:
            for r in rows:
                r[d] = factors.derive(d, r[base]) if r[base] else ""
            cols[d] = {**_infer(d, [r[d] for r in rows]), "derived_from": base}
    keys = _keys([h for h in header if h], empties)
    linkable = bool(keys["lead"] or keys["call"])
    dates = [h for h in cols if cols[h]["type"] == "date"]
    date_col = "call_start_time" if "call_start_time" in dates else (dates[0] if dates else None)
    info = {"file": p.name, "rows": len(rows), "linkable": linkable, "keys": keys, "date_column": date_col, "columns": cols, "width": width}
    return {"info": info, "rows": rows}


def scan(path=None) -> dict:
    """Reads new or changed files in the folder (cache by path, mtime, size). Returns {file name: info} for the files present now."""
    d = Path(path) if path else folder()
    out = {}
    if not d.is_dir():
        return out
    seen = set()
    for p in sorted(d.iterdir()):
        ext = p.suffix.lower()
        if not p.is_file() or ext not in (".csv", ".xlsx") or p.name.startswith("~$"):
            continue
        key = str(p.resolve())
        seen.add(key)
        st = p.stat()
        sig = (st.st_mtime, st.st_size)
        hit = _CACHE.get(key)
        if hit is None or hit["key"] != sig:
            if ext == ".xlsx" and openpyxl is None:
                hit = {"key": sig, "info": {"file": p.name, "rows": None, "linkable": False, "keys": {"lead": None, "call": None},
                                            "date_column": None, "columns": {}, "note": "needs openpyxl"}, "rows": []}
            else:
                try:
                    hit = {"key": sig, **_load(p)}
                except Exception as e:                   # an unreadable file is listed with the reason, never fatal
                    hit = {"key": sig, "info": {"file": p.name, "rows": None, "linkable": False, "keys": {"lead": None, "call": None},
                                                "date_column": None, "columns": {}, "note": f"could not read: {str(e)[:120]}"}, "rows": []}
            _CACHE[key] = hit
        out[p.name] = hit
    for k in [k for k in _CACHE if Path(k).parent == d.resolve() and k not in seen]:
        _CACHE.pop(k, None)
    _SCANNED["at"] = datetime.now().isoformat(timespec="seconds")
    return out


def catalog(path=None) -> dict:
    """Names, types and category values only (never rows). A missing folder gives empty lists and 'missing'."""
    d = Path(path) if path else folder()
    if not d.is_dir():
        return {"files": [], "columns": [], "missing": str(d), "scanned_at": None}
    try:
        files = scan(d)
    except Exception as e:                               # the bundle must never fail because of this folder
        return {"files": [], "columns": [], "error": str(e)[:200], "scanned_at": None}
    fl, cl = [], []
    for name, hit in files.items():
        i = hit["info"]
        f = {"file": name, "rows": i["rows"], "linkable": i["linkable"], "keys": i["keys"], "date_column": i["date_column"]}
        if i.get("note"):
            f["note"] = i["note"]
        fl.append(f)
        for c, m in i["columns"].items():
            e = {"file": name, "column": c, "label": label(c), "type": m["type"]}
            if m.get("derived_from"):
                e["derived_from"] = m["derived_from"]
            if m["type"] == "category":
                e["values"] = list(m["values"])
            if m.get("unit"):
                e["unit"] = m["unit"]
            if m["type"] in OPS:
                e["ops"] = list(OPS[m["type"]])
            if not i["linkable"]:
                e["linkable"], e["why"] = False, UNLINKABLE
            cl.append(e)
    return {"files": fl, "columns": cl, "ops": {k: list(v) for k, v in OPS.items()}, "folder": d.name, "scanned_at": _SCANNED["at"]}


def rescan(path=None) -> dict:
    d = Path(path) if path else folder()
    for k in [k for k in _CACHE if Path(k).parent == d.resolve()]:
        _CACHE.pop(k, None)
    return catalog(d)


# ---------------------------------------------------------------------------- conditions

def _cv(c: dict) -> list:
    v = c.get("values")
    if v is None:
        v = [] if c.get("value") is None else [c.get("value")]
    return v if isinstance(v, list) else [v]


def _iso(v):
    s = str(v).strip()
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        return None, False
    return d, len(s) <= 10                               # date only: the whole day counts


def cond_match(c: dict, raw, ctype: str, fmt=None) -> bool:
    """One condition on one cell. Empty cells never match a number or date comparison."""
    op, vals = c["op"], _cv(c)
    s = "" if raw is None else str(raw).strip()
    if ctype == "number":
        x = _num(s) if s != "" else None
        if x is None:
            return False
        v = [float(t) for t in vals]
        return {"=": lambda: x == v[0], "!=": lambda: x != v[0], ">": lambda: x > v[0], ">=": lambda: x >= v[0],
                "<": lambda: x < v[0], "<=": lambda: x <= v[0], "between": lambda: v[0] <= x <= v[1]}[op]()
    if ctype == "category":
        x, want = norm_value(s), [norm_value(t) for t in vals]
        return (x not in want) if op == "is_not" else (x != "" and x in want)
    if ctype == "date":
        d = parse_date(s, fmt)
        if d is None:
            return False
        lo, lo_day = _iso(vals[0])
        if op == "before":
            return d < lo
        if op == "after":
            return d >= lo + timedelta(days=1) if lo_day else d > lo
        hi, hi_day = _iso(vals[1])
        return lo <= d < (hi + timedelta(days=1) if hi_day else hi + timedelta(microseconds=1))
    if ctype == "text":
        hit = str(vals[0]).lower() in s.lower() if s else False
        return (not hit) if op == "not_contains" else hit
    return False


def _check_cond(c, label_: str, cols: dict) -> tuple:
    """(cleaned condition | None, [errors])."""
    if not isinstance(c, dict):
        return None, [f"{label_}: a condition is an object"]
    col, op = str(c.get("col", "")), str(c.get("op", ""))
    if col not in cols:
        return None, [f"{label_}: '{col}' is not a column of this file"]
    m, lab = cols[col], label(col)
    t = m["type"]
    if t not in OPS:
        return None, [f"{label_}: {lab} is a{'n' if t[0] in 'aeiou' else ''} {t} column and cannot be used in a condition"]
    if op not in OPS[t]:
        return None, [f"{label_}: '{op}' does not work on {lab} (a {t} column); use one of: {', '.join(OPS[t])}"]
    vals = _cv(c)
    need2 = op == "between"
    many = op == "in"
    if need2 and len(vals) != 2:
        return None, [f"{label_}: 'between' needs two values for {lab}"]
    if not many and not need2 and len(vals) != 1:
        return None, [f"{label_}: give one value for {lab}"]
    if many and not vals:
        return None, [f"{label_}: choose at least one value for {lab}"]
    if t == "number":
        xs = [_num(v) for v in vals]
        if any(x is None for x in xs):
            return None, [f"{label_}: {lab} is compared with numbers"]
        if need2 and xs[0] > xs[1]:
            return None, [f"{label_}: the first value of 'between' must not exceed the second"]
        vals = xs
    elif t == "category":
        vals = [norm_value(v) for v in vals]
        bad = [v for v in vals if v not in m["values"]]
        if bad:
            return None, [f"{label_}: {', '.join(bad)} is not a value of {lab}"]
    elif t == "date":
        ds = [_iso(v)[0] for v in vals]
        if any(d is None for d in ds):
            return None, [f"{label_}: {lab} needs dates as YYYY-MM-DD"]
        if need2 and ds[0] > ds[1]:
            return None, [f"{label_}: the first date of 'between' must not be after the second"]
        vals = [str(v).strip() for v in vals]
    else:
        if not str(vals[0]).strip():
            return None, [f"{label_}: give the text to look for in {lab}"]
        vals = [str(vals[0])]
    out = {"col": col, "op": op}
    if need2 or many:
        out["values"] = vals
    else:
        out["value"] = vals[0]
    return out, []


# ---------------------------------------------------------------------------- validation and evaluation

def _file(name, path=None):
    files = scan(path)
    return files.get(str(name or ""))


def clean(defn, path=None) -> tuple:
    """(cleaned definition | None, [errors]) without looking at the data's values."""
    errs = []
    if not isinstance(defn, dict):
        return None, ["a metric definition is an object"]
    hit = _file(defn.get("file"), path)
    if hit is None:
        return None, [f"'{str(defn.get('file'))[:80]}' is not a file in the data folder"]
    info = hit["info"]
    if info.get("note"):
        return None, [f"{info['file']}: {info['note']}"]
    if not info["linkable"]:
        return None, [f"{info['file']}: {UNLINKABLE}"]
    cols = info["columns"]
    name = str(defn.get("name") or "").strip()
    if not name or len(name) > 60:
        errs.append("give the metric a name (at most 60 characters)")
    typ, count = defn.get("type"), defn.get("count", "calls")
    direction = defn.get("direction", "higher")
    if typ not in TYPES:
        errs.append("the type must be rate, average or sum")
    if count not in ("calls", "leads"):
        errs.append("count calls or leads")
    elif count == "leads" and not info["keys"]["lead"]:
        errs.append(f"{info['file']} has no lead column, so it cannot count leads")
    if direction not in ("higher", "lower"):
        errs.append("direction must be 'higher' or 'lower'")
    out = {"source": "file", "file": info["file"], "name": name, "type": typ, "count": count, "direction": direction}

    def conds(lst, lab):
        if lst is None:
            lst = []
        if not isinstance(lst, list):
            errs.append(f"{lab}: conditions must be a list")
            return []
        res = []
        for c in lst:
            cc, e = _check_cond(c, lab, cols)
            errs.extend(e)
            if cc:
                res.append(cc)
        return res
    if typ == "rate":
        out["num"] = conds(defn.get("num"), "Numerator")
        out["den"] = conds(defn.get("den"), "Denominator")
        if not defn.get("num"):
            errs.append("Numerator: add at least one condition")
    elif typ in ("average", "sum"):
        col = str(defn.get("col", ""))
        if col not in cols:
            errs.append(f"'{col}' is not a column of this file")
        elif cols[col]["type"] != "number":
            errs.append(f"{label(col)} is not a number column, so it cannot be {'averaged' if typ == 'average' else 'summed'}")
        out["col"] = col
        out["where"] = conds(defn.get("where"), "Condition")
    return (None if errs else out), errs


def validate(defn, path=None) -> list:
    """Every problem with a file metric, in plain words ([] = fine). Includes the data checks on the last 30 days."""
    d, errs = clean(defn, path)
    if errs:
        return errs
    ev = evaluate(d, path=path)
    if not ev["den"] or ev["den"] <= 0:
        return ["The denominator is 0 on the last 30 days: nothing would be counted"]
    if d["type"] == "rate" and ev["value"] is not None and not 0 <= ev["value"] <= 1:
        return [f"This rate comes to {ev['value']:.0%} on the last 30 days, but a rate must lie between 0 and 100%. "
                "Make the numerator count a part of the denominator"]
    return []


def _window(info: dict, rows: list, last_days: int) -> tuple:
    dc = info["date_column"]
    if not dc:
        return rows, None
    fmt = info["columns"][dc].get("fmt")
    dated = [(parse_date(r.get(dc), fmt), r) for r in rows]
    dated = [(d, r) for d, r in dated if d is not None]
    if not dated:
        return [], None
    hi = max(d for d, _ in dated)
    lo = hi - timedelta(days=last_days)
    return [r for d, r in dated if d > lo], {"from": lo.isoformat(timespec="minutes"), "to": hi.isoformat(timespec="minutes"), "column": dc}


def evaluate(defn: dict, last_days: int = 30, path=None) -> dict:
    """The metric over the file's last `last_days` days (ending at the file's latest date). Aggregates only."""
    d = defn
    if not (isinstance(d.get("num"), list) or "col" in d) or "count" not in d:
        d, errs = clean(defn, path)
        if errs:
            raise ValueError("; ".join(errs))
    hit = _file(d["file"], path)
    if hit is None:
        raise ValueError(f"'{d['file']}' is not a file in the data folder")
    info, cols = hit["info"], hit["info"]["columns"]
    rows, win = _window(info, hit["rows"], last_days)
    lk, dc = info["keys"]["lead"], info["date_column"]
    fmt = cols[dc].get("fmt") if dc else None

    def ok(conds, r):
        return all(cond_match(c, r.get(c["col"]), cols[c["col"]]["type"], cols[c["col"]].get("fmt")) for c in conds)
    leads = len({r.get(lk) for r in rows if r.get(lk)}) if lk else 0
    per_lead = d["count"] == "leads"
    if per_lead:
        rows = [r for r in rows if r.get(lk)]
    res = {"file": d["file"], "window": win, "rows_used": len(rows), "leads": leads}
    if d["type"] == "rate":
        if per_lead:
            num = len({r[lk] for r in rows if ok(d["num"], r)})
            den = len({r[lk] for r in rows if ok(d["den"], r)})
        else:
            num = sum(1 for r in rows if ok(d["num"], r))
            den = sum(1 for r in rows if ok(d["den"], r))
        v = num / den if den else None
        sd = math.sqrt(v * (1 - v)) if v is not None and 0 <= v <= 1 else None
        return {**res, "num": num, "den": den, "value": v, "sd": sd}
    col = d["col"]
    hits = [r for r in rows if ok(d.get("where") or [], r) and _num(r.get(col, "")) is not None and r.get(col, "") != ""]
    if per_lead:
        first = {}
        for r in sorted(hits, key=lambda r: parse_date(r.get(dc), fmt) or datetime.max) if dc else hits:
            first.setdefault(r[lk], r)
        vals = [_num(r[col]) for r in first.values()]
    else:
        vals = [_num(r[col]) for r in hits]
    k = len(vals)
    s = sum(vals)
    mu = s / k if k else None
    sd = math.sqrt(sum((x - mu) ** 2 for x in vals) / (k - 1)) if k > 1 else None
    return {**res, "num": s, "den": k, "value": (mu if d["type"] == "average" else (s if k else None)), "sd": sd}


def preview(defn, path=None) -> dict:
    """What the builder shows while editing: errors, or the aggregates over the last 30 days."""
    errs = validate(defn, path)
    d, cerrs = clean(defn, path)
    if cerrs:
        return {"ok": False, "errors": cerrs, "num": None, "den": None, "value": None, "window": None}
    ev = evaluate(d, path=path)
    return {"ok": not errs, "errors": errs, "num": ev["num"], "den": ev["den"], "value": ev["value"], "sd": ev["sd"], "window": ev["window"]}
