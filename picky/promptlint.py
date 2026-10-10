"""Static analysis of the real VANI prompt. Free, deterministic, no model and no network.

The prompt is 25,000 words and four prompts in one document, edited by several people. The same rule is restated in several places,
and the restatements do not always agree. For a voice bot that matters directly: IndiaMART's own call-quality matrix grades
"Looping Behavior" (probing a parameter more than 1+2 times) as a fatal parameter, and the ask limits are what stop loops.

What this finds:
  limits      every statement of "how many times may VANI ask for X", with the flow, line and quote
  conflicts   the same field given different limits (inside one flow, or across flows)
  duplicates  long blocks copied into more than one flow (an edit to one copy leaves the others behind)
  A finding is a lead for a human to check, not a verdict: the line numbers refer to data/base_prompt.md (the normalised text).
"""
from __future__ import annotations

import hashlib
import re
from collections import defaultdict

from . import realprompt as rp

WORDS = {"one": 1, "once": 1, "two": 2, "tow": 2, "twice": 2, "three": 3, "four": 4, "foure": 4, "five": 5, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5}
NUM = r"(\d|one|once|two|tow|twice|three|four|foure|five)"


def _n(tok: str) -> int | None:
    return WORDS.get(tok.lower())


# (field, regex, how to read the limit from the match). Each rule is one statement form that occurs in the prompt.
TABLE = re.compile(r"(product identification/requirement confirmation|quantity|each specification|buyer name|buyer city|buyer state|transfer consent)\s*=\s*(\d)", re.I)
TABLE_FIELD = {"product identification/requirement confirmation": "product", "quantity": "quantity", "each specification": "specification",
               "buyer name": "name", "buyer city": "city", "buyer state": "state", "transfer consent": "transfer"}

RULES = [
    ("product", re.compile(rf"{NUM}-ask (product )?allowance", re.I), lambda m: _n(m.group(1))),
    ("city_state", re.compile(rf"each city/state has a {NUM}-ask limit", re.I), lambda m: _n(m.group(1))),
    ("name", re.compile(rf"buyer name may be requested a maximum of {NUM} times", re.I), lambda m: _n(m.group(1))),
    ("specification", re.compile(rf"each specification field may be asked a maximum of {NUM} times", re.I), lambda m: _n(m.group(1))),
    ("specification", re.compile(rf"single specification question can be probed is {NUM} times", re.I), lambda m: _n(m.group(1))),
    ("specification", re.compile(r"allow one initial ask and one follow-up per field", re.I), lambda m: 2),
    ("quantity", re.compile(r"allow one initial question and at most two follow-ups", re.I), lambda m: 3),
    ("quantity", re.compile(rf"quantity question can be asked is {NUM} times", re.I), lambda m: _n(m.group(1))),
    ("any_slot", re.compile(rf"each slot may be requested at most {NUM} times", re.I), lambda m: _n(m.group(1))),
    ("any_slot", re.compile(rf"STRICT MAX {NUM} ATTEMPTS PER SLOT", re.I), lambda m: _n(m.group(1))),
    ("any_slot", re.compile(rf"never ask the same question more than {NUM} times", re.I), lambda m: _n(m.group(1))),
    ("policy_slot", re.compile(r"make only one fair attempt to collect each required piece", re.I), lambda m: 1),   # a stricter rule for one case, not a maximum
    ("city", re.compile(r"city question even after trying for more then (\d) times", re.I), lambda m: int(m.group(1)) + 1),
]

FLOWS = ["inbound_redirect", "enrichment", "redial_name_city", "redial_ast"]


def _flow_of_lines(text: str) -> list[str]:
    """For every line of the whole document, which of the four prompts it belongs to."""
    lines = text.splitlines()
    starts = {}
    for name, head in rp.FLOW_HEADINGS.items():
        for i, l in enumerate(lines):
            if l.strip().startswith(head) and len(l.strip()) <= len(head) + 4:
                starts[i] = name; break
    out, cur = [], "inbound_redirect"
    for i in range(len(lines)):
        cur = starts.get(i, cur)
        out.append(cur)
    return out


def limits(text: str) -> list[dict]:
    lines = text.splitlines()
    flow = _flow_of_lines(text)
    found = []
    for i, l in enumerate(lines):
        for m in TABLE.finditer(l):
            found.append({"field": TABLE_FIELD[m.group(1).lower()], "limit": int(m.group(2)), "line": i, "flow": flow[i], "form": "table", "quote": m.group(0)})
        for field, rx, read in RULES:
            m = rx.search(l)
            if m and read(m) is not None:
                found.append({"field": field, "limit": read(m), "line": i, "flow": flow[i], "form": "text", "quote": m.group(0)})
    return found


def conflicts(found: list[dict]) -> list[dict]:
    """Different limits for the same thing inside ONE flow. Named fields are compared with each other; the slot-wide statements
    ("each slot may be asked at most N times") are compared with each other and with the named limits of their flow."""
    by = defaultdict(list)
    for f in found:
        by[(f["flow"], f["field"])].append(f)
    out = []

    def add(flow, field, pool, kind):
        vals = sorted({p["limit"] for p in pool})
        if len(vals) > 1:
            ev = {(p["line"], p["limit"], p["quote"]) for p in pool}
            out.append({"flow": flow, "field": field, "limits": vals, "kind": kind,
                        "evidence": [{"line": l, "limit": n, "quote": q} for l, n, q in sorted(ev)]})

    for (flow, field), items in by.items():
        if field == "any_slot":
            add(flow, "any slot", items, "slot-wide statements disagree")
        elif field in ("city", "state", "city_state"):
            continue                                                    # handled below as one group
        else:
            add(flow, field, items, "named limits disagree")
    for flow in FLOWS:
        add(flow, "city / state", by.get((flow, "city"), []) + by.get((flow, "state"), []) + by.get((flow, "city_state"), []), "named limits disagree")
    return sorted(out, key=lambda c: (c["flow"], c["field"]))


def cross_flow(found: list[dict]) -> list[dict]:
    by = defaultdict(lambda: defaultdict(set))
    for f in found:
        by[f["field"]][f["flow"]].add(f["limit"])
    return [{"field": fld, "by_flow": {k: sorted(v) for k, v in fl.items()}} for fld, fl in by.items()
            if len({tuple(sorted(v)) for v in fl.values()}) > 1 and fld != "any_slot"]


def duplicates(text: str, min_lines: int = 6) -> list[dict]:
    """Blocks of at least `min_lines` consecutive non-empty lines that appear verbatim in more than one place."""
    lines = [l.strip() for l in text.splitlines()]
    flow = _flow_of_lines(text)
    idx = defaultdict(list)
    for i in range(len(lines) - min_lines):
        block = lines[i:i + min_lines]
        if all(block) and not any(b.startswith("{%") for b in block):
            idx[hashlib.md5("\n".join(block).encode()).hexdigest()].append(i)
    runs, used = [], set()
    for h, starts in idx.items():
        if len(starts) < 2:
            continue
        key = tuple(starts)
        if any(s in used for s in starts):
            continue
        n = min_lines
        while all(s + n < len(lines) and lines[s + n] == lines[starts[0] + n] and lines[s + n] for s in starts):
            n += 1
        for s in starts:
            used.update(range(s, s + n))
        runs.append({"lines": n, "copies": len(starts), "at": [{"line": s, "flow": flow[s]} for s in starts], "starts_with": lines[starts[0]][:90]})
    return sorted(runs, key=lambda r: -r["lines"] * r["copies"])


def conflict_keys(text: str) -> set[tuple]:
    return {(c["flow"], c["field"], tuple(c["limits"])) for c in conflicts(limits(text))}


def compare(before: str, after: str) -> dict:
    """The gate for any prompt edit: it must not introduce a contradiction, and we show which ones it removes."""
    a, b = conflict_keys(before), conflict_keys(after)
    return {"before": len(a), "after": len(b), "removed": sorted(a - b), "introduced": sorted(b - a), "ok": not (b - a)}


def analyse(text: str | None = None) -> dict:
    from pathlib import Path
    text = text or (rp.DATA / "base_prompt.md").read_text()
    found = limits(text)
    return {"prompt": rp.stats(text), "limits": found, "conflicts": conflicts(found), "cross_flow": cross_flow(found),
            "duplicates": duplicates(text)[:8],
            "note": "A lead for a person to check. Line numbers refer to data/base_prompt.md."}


def variables(text: str) -> list[str]:
    """Names of the template variables a prompt uses (for example buyer_name). A candidate must not drop any of them."""
    try:
        from jinja2 import Environment, meta
        return sorted(meta.find_undeclared_variables(Environment().parse(text)))
    except Exception:                                  # a template that does not parse: fall back to a plain scan
        return sorted(set(re.findall(r"{{\s*([A-Za-z_][A-Za-z0-9_]*)", text)))


def variable_report(before: str, after: str) -> dict:
    a, b = set(variables(before)), set(variables(after))
    return {"base": sorted(a), "dropped": sorted(a - b), "added": sorted(b - a), "ok": not (a - b)}
