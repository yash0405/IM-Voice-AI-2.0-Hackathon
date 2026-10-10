"""The factor catalog and segment rules (one config: display name, data column, allowed values).

The catalog is the one list the router, the segment builder, the balance check and the dashboard all read. Each factor says what it means,
which column of the lead data holds it, which values it can take, and whether it is known BEFORE the call. Only pre-call factors can pick
leads for a test: anything decided during the call (the disposition, the call length) would bias the result, so the builder refuses them.

A segment is a list of rules, AND between rules and OR within a rule's values, saved as JSON: [{"factor", "column", "values"}].
No rules (None or []) means all traffic (a neutral test).

HONEST LABEL. The recordings we were given carry no lead attributes. The factors and values below are the ones the New Experiment spec
lists; how common each value is (the mix) is a PLACEHOLDER so that the simulator and the 30-day history (picky/history.py) have something
to split. Every screen that shows it says "synthetic". When the real lead table arrives, replace the mix (or load it) and nothing else changes.
"""
from __future__ import annotations

import hashlib
import itertools

SYNTHETIC_NOTE = ("HL Type and HL Bucket use the real mix from the call data file (29,591 calls). The other factors follow the New Experiment spec with a "
                  "placeholder mix, and the 30-day history is a placeholder, so the simulator has something to split. Replace them with the real lead table when it arrives.")

# SOURCE OF TRUTH for HL Bucket (Top 3 / Rest): the PM's "Data type passed" table (Oct 10, 2026), copied as written into HL_BUCKET_SOURCE,
# plus the PM's answer for the five types the table did not list (same day): TF and UATF are Top 3; ENQR, PNSM and PNSR are Rest.
#     Rest  = NUR, PIM, UA, PUA, ENQR, PNSM, PNSR
#     Top 3 = SCHD, OLP, OLPR, PAM, PNCHF, PANF, PUT, NVGT, TF, UATF
# It is NOT "the three most common types": the three most common types in the real data (PUA, PIM, UA) are Rest. It is NOT the Redash
# dashboard's rule either (NUR/UA/PUA/PIM = Rest, ELSE Top 3): that puts ENQR, PNSM and PNSR in Top 3, which the PM called wrong.
# Every reader goes through derive("hl_bucket", type), never the dict, so there is one answer. tests/test_hl_bucket.py pins all of it.
HL_BUCKET_SOURCE = {"NUR": "Rest", "PIM": "Rest", "UA": "Rest", "PUA": "Rest", "ENQR": "Rest", "PNSM": "Rest", "PNSR": "Rest",
                    "SCHD": "Top 3", "OLP": "Top 3", "OLPR": "Top 3", "PAM": "Top 3", "PNCHF": "Top 3", "PANF": "Top 3", "PUT": "Top 3", "NVGT": "Top 3",
                    "TF": "Top 3", "UATF": "Top 3"}
HL_REST = [t for t, b in HL_BUCKET_SOURCE.items() if b == "Rest"]
HL_BUCKET_DEFAULT = "Rest"             # only for a Hot Lead type that does not exist today (every current type is in the table above)

# `column`: the column of the lead data that holds the factor. `strata`: the router deals blocks inside each HL Type x GST Nature of Business
# group (the BRD's Hot Lead type x Nature of Business). `balance`: shown in the split-health balance table. A `derived_from` factor is a
# function of another factor (`derive` maps the other factor's value to this one's), so the two can never disagree.
def derive_hl(hl_type: str) -> str:
    return HL_BUCKET_SOURCE.get(hl_type, HL_BUCKET_DEFAULT)


CATALOG = [
    {"name": "assigned_status", "column": "assigned_status", "label": "Assigned Status", "short": "Assigned", "meaning": "Whether the lead is assigned to a seller or still in the pool",
     "type": "pick-list", "values": ["Assigned", "Pool", "Others"], "mix": [0.55, 0.35, 0.10], "pre_call": True, "balance": False, "strata": False},
    {"name": "gst_nature_of_business", "column": "gst_nature_of_business", "label": "GST Nature of Business", "short": "GST NOB", "meaning": "What kind of firm the buyer is, from GST",
     "type": "pick-list", "values": ["Retailer", "Service Provider", "Wholesaler", "Manufacturer", "NA"], "mix": [0.30, 0.15, 0.20, 0.20, 0.15], "pre_call": True, "balance": True, "strata": True},
    {"name": "gst_turnover", "column": "gst_turnover", "label": "GST Turnover", "short": "Turnover", "meaning": "The buyer's annual turnover band, from GST",
     "type": "pick-list", "values": ["0-40L", "40L-1.5Cr", "1.5-5Cr", "5-25Cr", "25-100Cr", "100-500Cr", ">500Cr", "NA"],
     "mix": [0.35, 0.22, 0.15, 0.10, 0.05, 0.02, 0.01, 0.10], "pre_call": True, "balance": False, "strata": False},
    {"name": "hl_bucket", "column": "hl_bucket", "label": "HL Bucket", "short": "HL Bucket", "meaning": "Top 3: " + ", ".join(t for t, b in HL_BUCKET_SOURCE.items() if b == "Top 3") + ". Rest: " + ", ".join(t for t, b in HL_BUCKET_SOURCE.items() if b == "Rest"),
     "type": "pick-list", "values": ["Top 3", "Rest"], "mix": None, "pre_call": True, "balance": False, "strata": False, "derived_from": "hl_type"},
    {"name": "hl_type", "column": "hl_type", "label": "HL Type", "short": "HL Type", "meaning": "Source of the lead (Hot Lead type)",
     "type": "pick-list", "values": ["UA", "PNSM", "PNSR", "PIM", "PUA", "PAM", "SCHD", "ENQR", "NUR", "PANF", "OLP", "PNCHF", "OLPR", "PUT", "NVGT", "TF", "UATF"],
     "mix": [0.172113, 0.012504, 0.01024, 0.321686, 0.347368, 0.039235, 0.001487, 0.0391, 0.00027, 0.004258, 0.046298, 0.001048, 0.001149, 0.0, 0.003244, 0.0, 0.0], "pre_call": True, "balance": True, "strata": True},
     # the REAL mix: share of each HL type (redis_bucket) in the dtl file, 29,591 calls, Oct 2026 (PUT, TF, UATF do not occur there)
    {"name": "legal_status", "column": "legal_status", "label": "Legal Status", "short": "Legal", "meaning": "The firm's legal form",
     "type": "pick-list", "values": ["Limited Company", "Partnership", "Proprietorship", "Others", "NA"], "mix": [0.15, 0.10, 0.45, 0.10, 0.20], "pre_call": True, "balance": True, "strata": False},
    {"name": "vendor", "column": "vendor", "label": "Vendor", "short": "Vendor", "meaning": "Which calling vendor handles the lead",
     "type": "pick-list", "values": ["arrowhead", "squadstack"], "mix": [0.60, 0.40], "pre_call": True, "balance": False, "strata": False},
    {"name": "vertical", "column": "vertical", "label": "Vertical", "short": "Vertical", "meaning": "The business vertical the lead belongs to",
     "type": "pick-list", "values": ["Top Cities - Inhouse", "Top Cities - Channel", "Emerging Market - Channel", "NA"], "mix": [0.35, 0.25, 0.30, 0.10], "pre_call": True, "balance": True, "strata": False},
    # decided during the call: listed so the catalog is complete, refused by the segment builder
    {"name": "disposition", "column": "disposition", "label": "Call disposition", "short": "Disposition", "meaning": "How the call ended", "type": "pick-list",
     "values": ["BuyLead created", "Meeting Fixed", "Callback Fixed", "Buyer Enriched", "Requirement not confirmed", "Wanted the original seller only",
                "No product requirement", "Other / unclear", "Nobody spoke"],                  # the same list as history.DISP_VALUES (a test checks it)
     "mix": None, "pre_call": False, "balance": False, "strata": False},
    {"name": "call_duration", "column": "call_duration", "label": "Call duration", "short": "Duration", "meaning": "Talk time of the call", "type": "number",
     "values": [], "mix": None, "pre_call": False, "balance": False, "strata": False},
]
VARS = {v["name"]: v for v in CATALOG}
HL_TOP3 = [t for t in VARS["hl_type"]["values"] if derive_hl(t) == "Top 3"]      # the HL Type values whose HL Bucket is Top 3
ORDER = {v["name"]: i for i, v in enumerate(CATALOG)}
PRE_CALL = [v["name"] for v in CATALOG if v["pre_call"]]
DRAWN = [n for n in PRE_CALL if not VARS[n].get("derived_from")]       # drawn independently; the rest are derived from these
STRATA_VARS = [v["name"] for v in CATALOG if v.get("strata")]
BALANCE_VARS = [v["name"] for v in CATALOG if v.get("balance")]
MIN_STRATUM = 30      # fewer expected leads than 3 blocks of 10 in a stratum: merge it into "Other" before splitting (BRD risk table)
MIN_SHARE = 0.02      # a segment below 2% of traffic is refused: the simulator would have to replay 50x the traffic to find its leads


def derive(name: str, base_value: str) -> str:
    """The value of a derived factor from its base factor's value (HL Bucket from HL Type)."""
    if name == "hl_bucket":
        return derive_hl(base_value)
    raise KeyError(name)


def _mix_of(name: str) -> list:
    """How common each value is. A derived factor's mix follows from its base factor's mix."""
    v = VARS[name]
    if v.get("derived_from"):
        base = VARS[v["derived_from"]]
        out = {x: 0.0 for x in v["values"]}
        for bv, p in zip(base["values"], base["mix"]):
            out[derive(name, bv)] += p
        return [round(out[x], 10) for x in v["values"]]
    return v["mix"]


for _v in CATALOG:
    if _v.get("derived_from"):
        _v["mix"] = _mix_of(_v["name"])
        _v["derive"] = {bv: derive(_v["name"], bv) for bv in VARS[_v["derived_from"]]["values"]}


def bundle(columns: list | None = None) -> dict:
    """The catalog as the dashboard shows it. `columns`: the columns present in the lead data; a factor whose column is missing is shown
    disabled ("Not in data yet")."""
    cols = set(columns) if columns is not None else None
    variables = []
    for c in CATALOG:
        v = {k: val for k, val in c.items()}
        v["in_data"] = cols is None or c["column"] in cols
        variables.append(v)
    return {"variables": variables, "note": SYNTHETIC_NOTE, "synthetic": True, "strata": STRATA_VARS, "balance": BALANCE_VARS,
            "min_stratum": MIN_STRATUM, "min_share": MIN_SHARE}


def lead_vars(lead: str) -> dict:
    """A lead's pre-call factors. In production these arrive with the lead; here they are a fixed pseudo-random function of the lead ID
    (so the router, the checks and the 30-day history always agree, and a run is repeatable)."""
    h = hashlib.sha256(f"mix:{lead}".encode()).digest()
    out = {}
    for i, name in enumerate(DRAWN):
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
    for name in PRE_CALL:
        v = VARS[name]
        if v.get("derived_from"):
            out[name] = derive(name, out[v["derived_from"]])
    return {n: out[n] for n in PRE_CALL}


# ---------------------------------------------------------------------------- segment rules

def _rules_in(seg) -> list:
    """Accepts the saved JSON list [{"factor", "column", "values"}] or the earlier {"rules": [{"var", "values"}]} form."""
    if not seg:
        return []
    if isinstance(seg, dict):
        return [{"column": r.get("var") or r.get("column"), "values": r.get("values")} for r in (seg.get("rules") or [])]
    if isinstance(seg, list):
        return [{"column": r.get("column") or r.get("var"), "values": r.get("values")} for r in seg]
    raise ValueError("a segment is a list of rules: [{factor, column, values}]")


def validate_segment(seg) -> list | None:
    """Every rule must hold (AND); a rule holds when the lead's value is one of its values (OR). Returns the cleaned segment as
    [{"factor", "column", "values"}] in catalog order, or None for all traffic. Raises ValueError with a plain message."""
    rules = _rules_in(seg)
    if not rules:
        return None
    clean, seen = [], set()
    for r in rules:
        name, vals = str(r.get("column") or ""), r.get("values") or []
        v = VARS.get(name)
        if v is None:
            raise ValueError(f"'{name}' is not a column in the factor catalog")
        if not v["pre_call"]:
            raise ValueError(f"{v['label']} is only known during the call, so it cannot pick leads before the call (it would bias the result)")
        if name in seen:
            raise ValueError(f"{v['label']} is used twice: a factor can be used only once; put its values in one condition")
        bad = [x for x in vals if x not in v["values"]]
        if not vals or bad:
            raise ValueError(f"{v['label']}: " + (f"{', '.join(map(str, bad))} is not an allowed value" if bad else "choose at least one value"))
        seen.add(name)
        clean.append({"factor": v["label"], "column": name, "values": [x for x in v["values"] if x in vals]})      # catalog order inside a rule
    clean.sort(key=lambda r: ORDER[r["column"]])                                                                     # catalog order across rules: one segment, one hash
    share = segment_share(clean)
    if share < MIN_SHARE:
        raise ValueError(f"this audience is only {share:.1%} of traffic; widen it (at least {MIN_SHARE:.0%})" if share > 0
                         else "no lead can match this rule (the conditions contradict each other, for example an HL Type outside the chosen HL Bucket)")
    return clean


def matches(seg, attrs: dict) -> bool:
    return all(attrs[r["column"]] in r["values"] for r in _rules_in(seg))


def allowed(seg, name: str) -> list:
    """Values of `name` the segment allows on that factor's own rule (catalog order)."""
    for r in _rules_in(seg):
        if r["column"] == name:
            return [x for x in VARS[name]["values"] if x in r["values"]]
    return list(VARS[name]["values"])


def allowed_eff(seg, name: str) -> list:
    """Values of a drawn factor that can occur in the segment once the rules on its derived factors are applied too."""
    ok = allowed(seg, name)
    for d in PRE_CALL:
        if VARS[d].get("derived_from") == name:
            okd = allowed(seg, d)
            ok = [x for x in ok if derive(d, x) in okd]
    return ok


def value_prob(name: str, value: str, seg=None) -> float:
    """P(value | the lead is in the segment) for a drawn factor."""
    v = VARS[name]
    ok = allowed_eff(seg, name)
    tot = sum(p for x, p in zip(v["values"], v["mix"]) if x in ok)
    return (v["mix"][v["values"].index(value)] / tot) if value in ok and tot else 0.0


def segment_share(seg) -> float:
    """Share of all traffic that matches the segment. Drawn factors are independent, so their shares multiply; a derived factor narrows
    the factor it is derived from."""
    s = 1.0
    for name in DRAWN:
        v = VARS[name]
        ok = allowed_eff(seg, name)
        s *= sum(p for x, p in zip(v["values"], v["mix"]) if x in ok)
    return s


def _or(vals: list) -> str:
    return vals[0] if len(vals) == 1 else ", ".join(vals[:-1]) + " or " + vals[-1]


def describe(seg) -> str:
    """The rule in plain words: Leads where HL Type is UA or PNSM AND Legal Status is Proprietorship."""
    rules = _rules_in(seg)
    if not rules:
        return "All traffic (neutral test)"
    rules = sorted(rules, key=lambda r: ORDER.get(r["column"], 99))
    return "Leads where " + " AND ".join(f"{VARS[r['column']]['label']} is {_or(list(r['values']))}" for r in rules)


# ---------------------------------------------------------------------------- strata

def stratum_key(attrs: dict) -> tuple:
    return tuple(attrs[n] for n in STRATA_VARS)


def plan_strata(eligible_total: float, seg=None) -> dict:
    """Every stratum (HL Type x GST Nature of Business) the segment allows, with the leads expected in it during the test. A stratum with fewer than
    MIN_STRATUM expected leads is merged into one 'Other' stratum before splitting, so blocks of 10 are not left half empty."""
    rows = []
    for combo in itertools.product(*[allowed_eff(seg, n) for n in STRATA_VARS]):
        p = 1.0
        for n, val in zip(STRATA_VARS, combo):
            p *= value_prob(n, val, seg)
        rows.append({"key": list(combo), "label": " x ".join(combo), "expected": eligible_total * p})
    small = [r for r in rows if r["expected"] < MIN_STRATUM]
    merged = [r["label"] for r in small] if len(small) > 1 or (small and len(rows) > 1) else []
    for r in rows:
        r["merged"] = r["label"] in merged
    return {"strata": rows, "merged": merged, "merged_expected": sum(r["expected"] for r in rows if r["merged"])}
