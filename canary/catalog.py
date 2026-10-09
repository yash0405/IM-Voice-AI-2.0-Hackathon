"""The variable catalog and segment rules (BRD section 0 and 2).

The catalog is the one list the router, the segment builder and the balance check all read. Each entry says what a variable means, what
values it can take, and whether it is known BEFORE the call. Only pre-call variables can pick leads for a test: anything decided during the
call (the disposition, the call length) would bias the result, so the builder refuses them.

HONEST LABEL. The recordings we were given carry no lead attributes at all. The four pre-call variables below use the names and values
the BRD gives as examples; the mix (how common each value is) is a PLACEHOLDER so that the simulator has something to split. Every screen
that shows it says "synthetic". When real lead data arrives, replace CATALOG (or load it from a lead file) and nothing else changes.
"""
from __future__ import annotations

import hashlib

SYNTHETIC_NOTE = ("The recordings carry no lead attributes. These variables use the BRD's example names and values; how common each value is "
                  "(the mix) is a placeholder so the simulator has something to split. Replace it with the real lead data when it arrives.")

# `balance`: shown in the split-health balance table. `strata`: used to stratify the split (the BRD's Hot Lead type x Nature of Business).
CATALOG = [
    {"name": "hot_lead_type", "label": "Hot Lead type", "short": "HL", "meaning": "Source of the lead", "type": "pick-list",
     "values": ["UA", "PUA", "ENQR", "PNS"], "mix": [0.30, 0.20, 0.20, 0.30], "pre_call": True, "balance": True, "strata": True, "rule_order": 3},
    {"name": "nature_of_business", "label": "Nature of Business", "short": "NOB", "meaning": "What kind of firm the lead is", "type": "pick-list",
     "values": ["Proprietor", "Pvt Ltd", "Partnership", "Other"], "mix": [0.45, 0.25, 0.12, 0.18], "pre_call": True, "balance": True, "strata": True, "rule_order": 2},
    {"name": "city", "label": "City", "short": "City", "meaning": "City the buyer is in, from the lead record", "type": "pick-list",
     "values": ["Mumbai", "Delhi", "Bengaluru", "Pune", "Chennai", "Other"], "mix": [0.14, 0.16, 0.10, 0.07, 0.06, 0.47], "pre_call": True, "balance": True, "strata": False, "rule_order": 1},
    # decided during the call: listed so the catalog is complete, refused by the segment builder
    {"name": "disposition", "label": "Call disposition", "short": "Disposition", "meaning": "How the call ended", "type": "pick-list",
     "values": ["BuyLead created", "Callback fixed", "Not interested"], "mix": None, "pre_call": False, "balance": False, "strata": False},
    {"name": "call_duration", "label": "Call duration", "short": "Duration", "meaning": "Talk time of the call", "type": "number",
     "values": [], "mix": None, "pre_call": False, "balance": False, "strata": False},
]
# plain-English words the dashboard's rule-based reader recognises for each value (no language model is used to read a segment)
SYNONYMS = {
    "hot_lead_type": {"UA": ["ua"], "PUA": ["pua"], "ENQR": ["enqr", "enquiry", "enquiries"], "PNS": ["pns"]},
    "nature_of_business": {"Proprietor": ["proprietor", "proprietors", "proprietorship", "proprietorships", "sole proprietor", "sole proprietors"],
                           "Pvt Ltd": ["pvt ltd", "pvt. ltd", "pvt ltd.", "private limited", "private ltd", "pvt", "pvt-ltd"],
                           "Partnership": ["partnership", "partnerships", "partner firm", "partnership firm"], "Other": []},
    "city": {"Mumbai": ["mumbai", "bombay"], "Delhi": ["delhi", "new delhi"], "Bengaluru": ["bengaluru", "bangalore", "bengalore"], "Pune": ["pune"],
             "Chennai": ["chennai", "madras"], "Other": []},
}
# words that mean the user is describing something that happens DURING the call: refused with a plain explanation
IN_CALL_WORDS = ["answered", "picked up", "pick up", "connected", "disposition", "duration", "long call", "short call", "hung up", "hang up", "hangup", "interested",
                 "converted", "meeting fixed", "callback", "not interested", "talk time", "asked for"]
VARS = {v["name"]: v for v in CATALOG}
PRE_CALL = [v["name"] for v in CATALOG if v["pre_call"]]
STRATA_VARS = [v["name"] for v in CATALOG if v.get("strata")]
BALANCE_VARS = [v["name"] for v in CATALOG if v.get("balance")]
MIN_STRATUM = 30      # fewer expected leads than 3 blocks of 10 in a stratum: merge it into "Other" before splitting (BRD risk table)
MIN_SHARE = 0.02      # a segment below 2% of traffic is refused: the simulator would have to replay 50x the traffic to find its leads


def bundle(pre_call_overrides: dict | None = None) -> dict:
    """The catalog as the dashboard shows it."""
    return {"variables": [{k: v for k, v in c.items()} for c in CATALOG], "note": SYNTHETIC_NOTE, "synthetic": True, "synonyms": SYNONYMS, "in_call_words": IN_CALL_WORDS,
            "strata": STRATA_VARS, "balance": BALANCE_VARS, "min_stratum": MIN_STRATUM, "min_share": MIN_SHARE}


def lead_vars(lead: str) -> dict:
    """A lead's pre-call variables. In production these arrive with the lead; here they are a fixed pseudo-random function of the lead ID
    (so the router and the checks always agree, and a run is repeatable)."""
    h = hashlib.sha256(f"mix:{lead}".encode()).digest()
    out = {}
    for i, name in enumerate(PRE_CALL):
        u = int.from_bytes(h[4 * i:4 * i + 4], "big") / 2 ** 32
        v = VARS[name]
        acc = 0.0
        pick = v["values"][-1]
        for val, p in zip(v["values"], v["mix"]):
            acc += p
            if u < acc:
                pick = val
                break
        out[name] = pick
    return out


# ---------------------------------------------------------------------------- segment rules

def validate_segment(seg) -> dict | None:
    """A segment is {"rules": [{"var": name, "values": [...]}], "text": "what the user typed"}: every rule must hold (AND), a rule holds when the
    lead's value is one of its values (IN). Returns the cleaned segment, or None for 'all leads'. Raises ValueError with a plain message."""
    if not seg:
        return None
    rules = seg.get("rules") if isinstance(seg, dict) else None
    if not rules:
        return None
    clean, seen = [], set()
    for r in rules:
        name, vals = str(r.get("var", "")), r.get("values") or []
        v = VARS.get(name)
        if v is None:
            raise ValueError(f"'{name}' is not in the variable catalog")
        if not v["pre_call"]:
            raise ValueError(f"{v['label']} is only known during the call, so it cannot pick leads before the call (it would bias the result)")
        if name in seen:
            raise ValueError(f"{v['label']} appears twice: put its values in one rule")
        bad = [x for x in vals if x not in v["values"]]
        if not vals or bad:
            raise ValueError(f"{v['label']}: " + (f"{', '.join(map(str, bad))} is not an allowed value" if bad else "choose at least one value"))
        seen.add(name)
        clean.append({"var": name, "values": [x for x in v["values"] if x in vals]})        # catalog order: the same segment always hashes the same
    clean.sort(key=lambda r: VARS[r["var"]].get("rule_order", 9))                                 # City, then Nature of Business, then Hot Lead type: the BRD's order
    out = {"rules": clean, "text": str(seg.get("text", ""))[:300]}
    if segment_share(out) < MIN_SHARE:
        raise ValueError(f"this segment is only {segment_share(out):.1%} of traffic; widen it (at least {MIN_SHARE:.0%})")
    return out


def matches(seg, attrs: dict) -> bool:
    return not seg or all(attrs[r["var"]] in r["values"] for r in seg["rules"])


def allowed(seg, name: str) -> list:
    v = VARS[name]
    for r in (seg or {}).get("rules", []):
        if r["var"] == name:
            return list(r["values"])
    return list(v["values"])


def value_prob(name: str, value: str, seg=None) -> float:
    """P(value | the lead is in the segment)."""
    v = VARS[name]
    ok = allowed(seg, name)
    tot = sum(p for x, p in zip(v["values"], v["mix"]) if x in ok)
    return (v["mix"][v["values"].index(value)] / tot) if value in ok and tot else 0.0


def segment_share(seg) -> float:
    """Share of all traffic that matches the segment (the variables are drawn independently, so shares multiply)."""
    s = 1.0
    for r in (seg or {}).get("rules", []):
        v = VARS[r["var"]]
        s *= sum(p for x, p in zip(v["values"], v["mix"]) if x in r["values"])
    return s


def describe(seg) -> str:
    """The exact rule, as the BRD writes it: City = Mumbai AND NOB = Proprietor AND HL IN (UA, PNS)."""
    if not seg or not seg.get("rules"):
        return "All leads (neutral test)"
    parts = []
    for r in seg["rules"]:
        short = VARS[r["var"]]["short"]
        parts.append(f"{short} = {r['values'][0]}" if len(r["values"]) == 1 else f"{short} IN ({', '.join(r['values'])})")
    return " AND ".join(parts)


# ---------------------------------------------------------------------------- strata

def stratum_key(attrs: dict) -> tuple:
    return tuple(attrs[n] for n in STRATA_VARS)


def plan_strata(eligible_total: float, seg=None) -> dict:
    """Every stratum (Hot Lead type x Nature of Business) the segment allows, with the leads expected in it during the test. A stratum with fewer than
    MIN_STRATUM expected leads is merged into one 'Other' stratum before splitting, so blocks of 10 are not left half empty."""
    import itertools
    rows = []
    for combo in itertools.product(*[allowed(seg, n) for n in STRATA_VARS]):
        p = 1.0
        for n, val in zip(STRATA_VARS, combo):
            p *= value_prob(n, val, seg)
        rows.append({"key": list(combo), "label": " x ".join(combo), "expected": eligible_total * p})
    small = [r for r in rows if r["expected"] < MIN_STRATUM]
    merged = [r["label"] for r in small] if len(small) > 1 or (small and len(rows) > 1) else []
    for r in rows:
        r["merged"] = r["label"] in merged
    return {"strata": rows, "merged": merged, "merged_expected": sum(r["expected"] for r in rows if r["merged"])}
