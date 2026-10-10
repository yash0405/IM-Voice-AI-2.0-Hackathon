"""The fix loop: the PM's "bot finds its own weakness, fixes it, proves the fix" idea, built on the REAL VANI prompt.

  1. find      evidence from three independent places (none needs a paid call):
                 - the prompt itself      promptlint.py   contradictory ask limits, quoted with line numbers
                 - the real calls         loopscan.py     how often VANI repeats itself (local, no model), plus mine() on the machine labels
                 - the quality matrix     IndiaMART's own fatal / non-fatal definitions (data/dispositions.json, schema 2)
  2. fix       lint_candidate()  free, deterministic: make the prompt agree with itself
               propose()         paid, opt-in: Sarvam-105B drafts an edit from the same evidence (needs --yes)
  3. pre-check prescreen.py      paid, opt-in: simulated buyers hear prompt A and B
  4. prove     the A/B engine decides. Mining proposes, the engine disposes.

What changed when the real prompt arrived (all stated on the page and in docs/QA_REPORT.md):
  * Our earlier stand-in prompt was wrong about VANI: the call is INBOUND (the buyer called a seller, the call was redirected), it collects
    quantity, specification, name and city/state (no timeline), and it FORBIDS reading values back (No-Echo rule).
  * So "did not read the details back", our most common machine-labelled issue, is not a failure. It is retired from the ranking.
  * Machine labels made before the real prompt are provisional until `python -m picky autolabel retag --yes` re-tags them (about Rs 23).
  * Mining is an association between machine labels, never a cause: that is why every edit goes through the A/B engine.
"""
from __future__ import annotations

import hashlib
import json
import re
import time

from . import sarvam_pipe as sp
from .stats import pooled_z, norm_cdf, wilson
from .variants import apply_patch, load_base, make_variant, prompt_hash

DATA = sp.DATA
PROPOSAL = DATA / "proposal.json"
MIN_CALLS = 20                       # a failure seen in fewer connected calls is never chosen as the target
FIX_MDE = 0.03                       # the smallest lift worth detecting: a planning choice, not a measurement

# the earlier tagger flagged this on 129 of 299 calls; the real prompt FORBIDS reading values back, so it is not a failure
RETIRED = {"did_not_confirm_details": "VANI's real prompt forbids reading captured values back (the No-Echo rule), so this is not a failure."}

ISSUES = {
    # schema 2: IndiaMART's call-quality matrix plus the real prompt's own rules
    "looping_behavior": ("Looped on the same question", "Asked for the same parameter more than 1+2 times (a fatal parameter in the matrix)."),
    "quantity_probing_error": ("Quantity asked wrongly", "Quantity asked when already given, not asked when it should be, or an improper nudge."),
    "qty_missed_opportunity": ("Missed a quantity", "The buyer gave a quantity and VANI did not capture it."),
    "quantity_accuracy": ("Wrong quantity or unit", "Quantity captured with a wrong value or unit."),
    "spec_missed_opportunity": ("Missed a specification", "The buyer gave a specification and VANI did not capture it."),
    "spec_accuracy": ("Wrong specification", "A specification captured as a different value than the buyer said."),
    "wer_error": ("Speech misheard", "A wrongly recognised word changed a captured detail."),
    "additional_details_error": ("Wrong extra details", "Irrelevant or wrong information stored as the buyer's additional details."),
    "oncall_astbuy_error": ("Live seller not offered", "A live seller was available but the transfer was not offered or was recorded wrongly."),
    "product_accuracy": ("Wrong product", "The wrong product was confirmed or approved."),
    "dead_air": ("Dead air", "More than 5 seconds of silence that VANI did not handle."),
    "echoed_value": ("Repeated the buyer's answer back", "Broke the No-Echo rule by repeating or paraphrasing a value just given."),
    "open_ended_question": ("Asked 'anything else?'", "An unneeded open question, which the prompt forbids."),
    "ignored_buyer_question": ("Ignored a buyer question", "The buyer asked something and VANI did not answer or acknowledge it."),
    "abrupt_end": ("Ended the call abruptly", "VANI ended the call before a proper closing, when it should not have."),
    "language_problem": ("Language problem", "Kept a language the buyer struggled with, or mishandled a switch."),
    # schema 1 (earlier labels)
    "ignored_answer": ("Ignored what the buyer said", "VANI asked again or moved on although the buyer had just answered."),
    "language_mismatch": ("Wrong language", "VANI kept speaking a language the buyer was not using."),
    "repeated_question": ("Asked the same thing twice", "VANI repeated a question the buyer had already answered."),
    "wrong_detail_recorded": ("Recorded a wrong detail", "The captured value differs from what the buyer said."),
    "stuck_loop": ("Got stuck in a loop", "VANI repeated itself or could not move the call forward."),
    "misheard_product_or_number": ("Misheard a product or number", "A product name or number was understood incorrectly."),
    "too_verbose": ("Talked too much", "VANI's turns were long enough to lose the buyer."),
    "did_not_confirm_details": ("Did not read the details back", RETIRED["did_not_confirm_details"]),
}


def plain(issue: str) -> str:
    return ISSUES.get(issue, (issue.replace("_", " ").capitalize(), ""))[0]


def _converted(d: dict) -> bool:
    """Schema 2: the real BuyLead disposition. Earlier labels: the proxy (quantity AND specification captured)."""
    if d.get("schema", 1) >= 2:
        return d["label"] == "buylead_created"
    return {"quantity", "specification"} <= set(d.get("fields") or [])


# ------------------------------------------------------------------------------------------------ 1. find: mine the labels
def mine() -> dict:
    """Free, offline, deterministic. Aggregate statistics over the machine labels; reads no transcript text."""
    L = sp.labelled()
    N = len(L)
    conn = [d for d in L if d["label"] != "no_connect"]
    n = len(conn)
    if not n:
        return {"n_calls": N, "n_connected": 0, "issues": [], "retired": []}
    k_all = sum(_converted(d) for d in L)
    k_conn = sum(_converted(d) for d in conn)
    rows, retired = [], []
    for key in sorted({i for d in conn for i in d.get("bot_issues", [])}):
        if key in RETIRED:
            retired.append({"key": key, "name": plain(key), "calls": sum(1 for d in conn if key in d["bot_issues"]), "why": RETIRED[key]})
            continue
        pres = [d for d in conn if key in d["bot_issues"]]
        absn = [d for d in conn if key not in d["bot_issues"]]
        kp, ka = sum(map(_converted, pres)), sum(map(_converted, absn))
        rp, ra = kp / len(pres), (ka / len(absn) if absn else float("nan"))
        z = pooled_z(ka, len(absn), kp, len(pres)) if absn else 0.0      # >0 means "with it" converts better
        p = 2 * (1 - norm_cdf(abs(z)))
        gap = ra - rp if absn else 0.0
        rows.append({
            "key": key, "name": plain(key), "meaning": ISSUES.get(key, ("", ""))[1],
            "calls": len(pres), "pct_of_connected": round(len(pres) / n, 4),
            "converted_with": round(rp, 4), "converted_without": round(ra, 4),
            "ci_with": [round(x, 4) for x in wilson(kp, len(pres))],
            "gap_pp": round(gap * 100, 1), "p_value": round(p, 4),
            "failed_calls": len(pres) - kp,
            "ceiling_pp": round(max(0.0, len(pres) * gap / len(L)) * 100, 1),   # BuyLeads per 100 calls if the failure vanished (association)
            "eligible": len(pres) >= MIN_CALLS,
        })
    rows.sort(key=lambda r: -r["ceiling_pp"])
    elig = [r for r in rows if r["eligible"] and r["gap_pp"] > 0]
    schema2 = sum(1 for d in L if d.get("schema", 1) >= 2)
    return {
        "n_calls": N, "n_connected": n, "no_connect": N - n,
        "baseline": {"rate": round(k_all / N, 4), "ci": [round(x, 4) for x in wilson(k_all, N)],
                     "definition": "BuyLead created (real disposition)" if schema2 == N else "quantity and specification captured (a proxy; earlier labels)"},
        "baseline_connected": round(k_conn / n, 4),
        "issues": rows, "retired": retired,
        "target": elig[0]["key"] if elig else None,
        "pm_pick": max(rows, key=lambda r: r["failed_calls"])["key"] if rows else None,
        "most_common": max(rows, key=lambda r: r["calls"])["key"] if rows else None,
        "provisional": schema2 < N, "schema2_calls": schema2,
        "note": "Machine labels, not yet human-verified. Associations, not causes: the A/B test is what proves cause.",
    }


def profile(issue: str) -> list[str]:
    """What is different about calls with this failure? Aggregate shares only (no transcript text). Biggest differences first."""
    L = [d for d in sp.labelled() if d["label"] != "no_connect"]
    P = [d for d in L if issue in d.get("bot_issues", [])]
    O = [d for d in L if issue not in d.get("bot_issues", [])]
    if not P or not O:
        return []
    def share(X, f):
        return sum(1 for d in X if f(d)) / len(X)
    tests = [("how the call ended: " + k.replace("_", " "), lambda d, k=k: d.get("call_end") == k) for k in
             ("bot_ended_early", "buyer_declined", "buyer_hung_up", "no_response", "transferred_to_seller")]
    tests += [("buyer asked for " + k.replace("_", " "), lambda d, k=k: k in d.get("buyer_requests", [])) for k in
              ("seller_contact", "alternate_seller", "price_query", "status_inquiry")]
    tests += [("buyer gave the " + k, lambda d, k=k: k in d.get("fields", [])) for k in ("quantity", "specification", "name", "city_state")]
    out = []
    for name, f in tests:
        a, b = share(P, f), share(O, f)
        out.append((abs(a - b), f"{name}: {a:.0%} of these calls vs {b:.0%} of other calls"))
    return [t for d, t in sorted(out, reverse=True) if d >= 0.05][:6]


def evidence(candidate_key: str | None = "fix_candidate") -> dict:
    """Free. The independent evidence the page shows: the prompt's own contradictions, the loop scan, the edit's lint check."""
    from . import loopscan, promptlint
    base = load_base()["text"]
    lint = promptlint.analyse(base)
    out = {"prompt": lint["prompt"],
           "conflicts": [{"flow": c["flow"], "field": c["field"], "limits": c["limits"], "kind": c["kind"],
                          "evidence": [{"line": e["line"], "limit": e["limit"], "quote": e["quote"]} for e in c["evidence"]]} for c in lint["conflicts"]],
           "cross_flow": lint["cross_flow"], "duplicates": lint["duplicates"][:5], "loops": loopscan.summary()}
    if candidate_key:
        try:
            out["edit_check"] = promptlint.compare(base, make_variant(candidate_key)["text"])
        except Exception:
            out["edit_check"] = None
    return out


# ------------------------------------------------------------------------------------------------ 2a. fix: the free, prompt-derived candidate
def lint_candidate(force: bool = False) -> dict:
    """Free and deterministic: make the real prompt agree with itself (variants.json: reconcile_limits). Writes data/proposal.json
    unless a Sarvam-drafted proposal that still applies is already there."""
    cur = load_proposal()
    if cur and not force and cur.get("origin") == "ai-mined" and _valid(cur):
        return cur
    from . import loopscan, promptlint, variants as _variants
    spec = json.loads((_variants.DATA / "variants.json").read_text())["candidates"]["reconcile_limits"]
    base = load_base()
    after = apply_patch(base["text"], spec)
    cmp = promptlint.compare(base["text"], after)
    lint = promptlint.analyse(base["text"])
    loops = loopscan.summary() or {}
    rep3 = (loops.get("bot_repeat3") or {}).get("rate")
    pairs = "; ".join(f"{c['field']} {' vs '.join(str(x) for x in c['limits'])}" for c in lint["conflicts"])
    out = {"key": "fix_candidate", "name": spec["name"], "origin": "lint-derived", "edit": spec["edit"], "remove": [], "add": [],
           "why": (f"The real prompt states different ask limits for the same thing ({pairs}). IndiaMART's quality matrix grades probing a parameter more than "
                   "1+2 times as fatal looping behaviour, so the limits have to agree. This edit makes each pair agree on the more specific statement."),
           "risk": ("It changes no intended behaviour, but a model that was following the looser limit will now stop a little sooner, so slightly less name or product detail may be captured. "
                    + (f"Verbatim loops are rare in the real calls ({rep3:.1%} reach three repeats; a lower bound), so the expected gain is small and mostly protects against fatal looping."
                       if rep3 is not None else "")),
           "evidence": {"source": "prompt lint", "conflicts_before": cmp["before"], "conflicts_after": cmp["after"], "introduced": len(cmp["introduced"]),
                        "base_prompt_hash": base["hash"], "loops_bot_repeat3": rep3},
           "model": None, "generated": time.strftime("%Y-%m-%d %H:%M")}
    out["hash"] = prompt_hash(json.dumps(spec["edit"], sort_keys=True))
    PROPOSAL.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    return out


def load_proposal() -> dict | None:
    return json.loads(PROPOSAL.read_text()) if PROPOSAL.exists() else None


def _valid(prop: dict) -> bool:
    """A proposal still applies if every anchor matches the CURRENT base prompt exactly (a stale one never changes silently)."""
    try:
        apply_patch(load_base()["text"], {k: prop.get(k, []) for k in ("edit", "remove", "add")})
        return True
    except Exception:
        return False


# ------------------------------------------------------------------------------------------------ 2b. fix: Sarvam drafts one (paid, opt-in)
PROMPT = """You improve the system prompt of VANI, IndiaMART's buyer-side voice assistant. A buyer called a seller from the IndiaMART portal, the seller was unavailable, and the call was redirected to VANI, which confirms the product, collects quantity, specifications, buyer name and city/state, and connects the buyer to a live seller when one is available.

IndiaMART grades calls with a quality matrix. "Looping Behavior" (asking for the same parameter more than 1+2 times) is a fatal parameter; so are wrong captured data and a missed live-seller pitch.

EVIDENCE
{evidence}

CURRENT PROMPT (the inbound-redirect prompt; lines are exact):
{prompt}

Write ONE small edit that addresses the evidence. Rules:
- At most 4 changes in total. A change is either an "edit" (replace text inside ONE existing line) or an "add" (a new line after an existing line).
- For an edit: "in_line" is text that appears in exactly ONE line of the prompt, "find" is exact text inside that line, "replace" is the new text.
- For an add: "after" must copy an EXISTING line exactly, character for character.
- Never contradict another rule of the prompt, never change a limit in only one of the places that state it, never add questions or steps that lengthen the call without need.
- The edit must be general: no names, no product names, no call-specific details, no quotes.
- The title and the "why" must describe exactly what the change does.
Reply with ONE JSON object only:
{{"title":"max 8 words","why":"one sentence","edit":[{{"in_line":"...","find":"...","replace":"..."}}],"add":[],"risk":"one sentence on what could go wrong"}}"""

_BAD = re.compile(r"[\"“”]|\d{3,}")        # no quotes or long digit runs in new text: stops call-specific details leaking into a prompt edit


def _evidence_text(target: str | None) -> str:
    ev = evidence(None)
    parts = []
    for c in ev["conflicts"]:
        parts.append(f"- In the {c['flow'].replace('_', ' ')} prompt the limit for {c['field']} is stated as " + " and ".join(str(x) for x in c["limits"]) +
                     f" ({'; '.join(e['quote'] for e in c['evidence'][:3])}).")
    lp = ev.get("loops") or {}
    if lp:
        parts.append(f"- In {lp['calls_with_speech']} real calls with speech, VANI repeated a near-identical turn 3+ times in {lp['bot_repeat3']['n']} and 4+ times in {lp['bot_loop']['n']} (a lower bound: rephrased re-asks are not counted).")
    m = mine()
    if target and m.get("issues"):
        row = next((r for r in m["issues"] if r["key"] == target), None)
        if row:
            parts.append(f"- Machine labels ({'provisional' if m['provisional'] else 'current'}): '{row['name']}' appears in {row['calls']} of {m['n_connected']} connected calls; "
                         f"{row['converted_with']:.0%} of those convert against {row['converted_without']:.0%} of the others. " + " ".join(profile(target)[:3]))
    return "\n".join(parts) or "- (no evidence available)"


def _validate(obj: dict, base_text: str) -> dict:
    from . import promptlint
    edit = [e for e in (obj.get("edit") or []) if isinstance(e, dict) and e.get("find")]
    add = [a for a in (obj.get("add") or []) if isinstance(a, dict) and a.get("text")]
    if not (edit or add) or len(edit) + len(add) > 4:
        raise ValueError("an edit must make 1-4 changes")
    for t in [e.get("replace", "") for e in edit] + [a["text"] for a in add]:
        if len(t.split()) > 60 or _BAD.search(t):
            raise ValueError("a new piece of text is too long or contains quotes or long digit strings")
    clean = {"edit": [{"in_line": e["in_line"], "find": e["find"], "replace": e.get("replace", "")} for e in edit],
             "add": [{"after": a["after"], "text": a["text"].strip()} for a in add], "remove": []}
    patched = apply_patch(base_text, clean)                              # raises unless every anchor matches exactly
    gate = promptlint.compare(base_text, patched)
    if not gate["ok"]:
        raise ValueError(f"the edit introduces a new contradiction between limits: {gate['introduced']}")
    return clean


def propose_cost() -> dict:
    from . import realprompt as rp
    base = load_base()["text"]
    flow = rp.flows(base)["inbound_redirect"]
    tin = int(len(PROMPT) / 3.6 + len(flow) / 3.6 + 900)
    one = sp.llm_cost(tin, 450)
    return {"est_tokens_in": tin, "est_inr": round(one, 2), "worst_case_inr": round(one * 2, 2)}


def propose(budget: float, yes: bool = False, force: bool = False, client=None, target: str | None = None) -> dict:
    """One Sarvam call (about Rs 1: the real prompt is large). Nothing is spent without yes=True. Replaces the prompt-derived candidate."""
    cur = load_proposal()
    if cur and cur.get("origin") == "ai-mined" and _valid(cur) and not force:
        return cur
    m = mine()
    target = target or m.get("target")
    cost = propose_cost()
    if not yes:
        return {"dry_run": True, "target": target, **cost}
    if sp.status()["estimated_spend_inr"] + cost["worst_case_inr"] > budget:
        raise sp.BudgetExceeded(f"proposal (up to Rs {cost['worst_case_inr']:.2f}) would exceed the Rs {budget:.2f} budget")
    from . import realprompt as rp
    base = load_base()
    flow = rp.flows(base["text"])["inbound_redirect"]
    prompt = PROMPT.format(evidence=_evidence_text(target), prompt=flow.rstrip())
    pipe = sp.Pipe(client)
    err, edit, tin, tout = "", None, 0, 0
    for attempt in range(2):
        msg = prompt if not err else prompt + f"\n\nYour previous reply was rejected: {err}. Reply again, fixing that."
        r = pipe.client.chat.completions(model=sp.LLM_MODEL, temperature=0.2, max_tokens=900, reasoning_effort=None,
                                         messages=[{"role": "user", "content": msg}])
        u = getattr(r, "usage", None)
        ti, to = (getattr(u, "prompt_tokens", 0) or 0), (getattr(u, "completion_tokens", 0) or 0)
        tin, tout = tin + ti, tout + to
        sp._add_spend("llm", sp.llm_cost(ti, to), **{"in": ti, "out": to})
        raw = r.choices[0].message.content or ""
        try:
            m_ = re.search(r"\{.*\}", raw, re.S)
            obj = json.loads(m_.group(0))
            patch = _validate(obj, base["text"])
            edit = {"title": str(obj.get("title", "Prompt edit"))[:80], "why": str(obj.get("why", ""))[:300], "risk": str(obj.get("risk", ""))[:300], **patch}
            break
        except Exception as e:                                           # one retry with the reason, then stop
            err = str(e)[:200]
    if not edit:
        raise RuntimeError(f"Sarvam did not return a valid prompt edit twice ({err}). Nothing was cached.")
    row = next((r for r in m.get("issues", []) if r["key"] == target), None)
    ids = sorted(d["idx"] for d in sp.labelled() if target in d.get("bot_issues", [])) if target else []
    out = {"key": "fix_candidate", "name": edit["title"], "origin": "ai-mined", "remove": [], "add": edit["add"], "edit": edit["edit"],
           "why": edit["why"], "risk": edit["risk"],
           "evidence": {"source": "prompt lint + machine labels", "issue": target, "calls_with_issue": row["calls"] if row else None,
                        "connected_calls": m.get("n_connected"), "converted_with": row["converted_with"] if row else None,
                        "converted_without": row["converted_without"] if row else None,
                        "call_ids_sha256": hashlib.sha256(json.dumps(ids).encode()).hexdigest()[:16], "base_prompt_hash": base["hash"],
                        "labels_are_human_verified": False, "labels_provisional": m.get("provisional")},
           "model": sp.LLM_MODEL, "tokens": {"in": tin, "out": tout}, "inr": round(sp.llm_cost(tin, tout), 4), "generated": time.strftime("%Y-%m-%d %H:%M")}
    out["hash"] = prompt_hash(json.dumps({k: out[k] for k in ("edit", "add")}, sort_keys=True))
    PROPOSAL.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    return out


# ------------------------------------------------------------------------------------------------ 4. plan and bundle
def design_for_fix(leads_per_day: int = 600, share_b: float = 0.5, mde: float = FIX_MDE) -> dict | None:
    """Test size from the measured baseline and the smallest lift worth detecting, plus what smaller lifts would cost."""
    from .engine import Config, build_design
    m = mine()
    if not m.get("n_calls"):
        return None
    base = round(m["baseline"]["rate"], 3)

    def size(delta):
        cfg = Config(baseline=base, mde=delta, share_b=share_b, leads_per_day=leads_per_day, window_days=14).validate()
        return int(build_design(cfg).n_max)
    n = size(mde)
    return {"baseline": base, "mde": mde, "share_b": share_b, "leads_per_day": leads_per_day, "n_max": n, "days_needed": round(n / leads_per_day, 1),
            "table": [{"mde": x, "n_max": size(x), "days": round(size(x) / leads_per_day, 1)} for x in (0.01, 0.02, 0.03, 0.05)]}


def costs() -> dict:
    """Free. What each paid step would cost, so nobody has to guess. Nothing here calls Sarvam."""
    out = {"retag": sp.retag_plan(), "draft": propose_cost()}
    try:
        from . import arena, prescreen
        out["prescreen"] = prescreen.plan()
        out["arena"] = arena.plan()
    except Exception:
        pass
    return out


def bundle() -> dict:
    """What the dashboard shows. Free (it may write the prompt-derived candidate to data/proposal.json)."""
    m = mine()
    prop = load_proposal()
    if not prop or not _valid(prop):
        prop = lint_candidate(force=True)
    out = {"mine": m, "proposal": None, "prescreen": None, "plan": None, "evidence": None, "costs": None}
    v = make_variant("fix_candidate")
    out["proposal"] = {**{k: prop.get(k) for k in ("name", "why", "risk", "evidence", "hash", "generated", "model", "origin")},
                       "diff": v["diff"], "base_hash": load_base()["hash"]}
    try:
        out["evidence"] = evidence("fix_candidate")
    except Exception:
        pass
    try:
        from . import prescreen
        out["prescreen"] = prescreen.summary()
    except Exception:
        pass
    out["plan"] = design_for_fix()
    try:
        out["costs"] = costs()
    except Exception:
        pass
    return out
