"""The fix loop: the PM's "bot finds its own weakness, fixes it, proves the fix" idea, built on the real call labels.

  1. mine()     free. Which failure costs BuyLeads? Ranked by the conversion gap, not by how often it occurs.
  2. propose()  one Sarvam-105B call drafts a small, reviewable prompt edit aimed at that failure (cached, budget-capped).
  3. prescreen  simulated buyers hear prompt A and prompt B (see prescreen.py); a cheap gate before real buyers are involved.
  4. plan()     how many calls the live A/B test needs, from the measured baseline and the failure's ceiling.
  The A/B engine then decides whether the edit ships. Mining proposes, the engine disposes.

What we corrected from the PM's version (stated on the slide too):
  * "Top cluster among failed calls" picks the failure that is most COMMON, which is not the one that COSTS leads. A failure
    that also shows up in calls that convert is noise. We rank by the conversion gap (calls with it vs without it).
  * Machine labels are associations, not causes. That is exactly why the edit goes through the A/B engine and is never shipped
    on the mining result alone.
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

# plain-words names and one-line meanings (the machine tagger's own taxonomy)
ISSUES = {
    "did_not_confirm_details": ("Did not read the details back", "VANI did not repeat the captured requirement for the buyer to confirm."),
    "ignored_answer": ("Ignored what the buyer said", "VANI asked again or moved on although the buyer had just answered."),
    "abrupt_end": ("Ended the call abruptly", "The call ended before VANI had captured the requirement or closed politely."),
    "language_mismatch": ("Wrong language", "VANI kept speaking a language the buyer was not using."),
    "repeated_question": ("Asked the same thing twice", "VANI repeated a question the buyer had already answered."),
    "wrong_detail_recorded": ("Recorded a wrong detail", "The captured value differs from what the buyer said."),
    "stuck_loop": ("Got stuck in a loop", "VANI repeated itself or could not move the call forward."),
    "misheard_product_or_number": ("Misheard a product or number", "A product name or number was understood incorrectly."),
    "too_verbose": ("Talked too much", "VANI's turns were long enough to lose the buyer."),
}


def plain(issue: str) -> str:
    return ISSUES.get(issue, (issue.replace("_", " ").capitalize(), ""))[0]


def _converted(d: dict) -> bool:
    return {"quantity", "specification"} <= set(d.get("fields") or [])        # the "loose" BuyLead: quantity AND specification


def mine() -> dict:
    """Free, offline, deterministic. Aggregate statistics over the machine labels; reads no transcript text."""
    L = sp.labelled()
    N = len(L)
    conn = [d for d in L if d["label"] != "no_connect"]
    n = len(conn)
    if not n:
        return {"n_calls": N, "n_connected": 0, "issues": []}
    k_all = sum(_converted(d) for d in L)
    k_conn = sum(_converted(d) for d in conn)
    rows = []
    for key in sorted({i for d in conn for i in d.get("bot_issues", [])}):
        pres = [d for d in conn if key in d["bot_issues"]]
        absn = [d for d in conn if key not in d["bot_issues"]]
        kp, ka = sum(map(_converted, pres)), sum(map(_converted, absn))
        rp, ra = kp / len(pres), (ka / len(absn) if absn else float("nan"))
        z = pooled_z(ka, len(absn), kp, len(pres)) if absn else 0.0      # >0 means "with it" converts better
        p = 2 * (1 - norm_cdf(abs(z)))
        gap = ra - rp if absn else 0.0
        failed = len(pres) - kp
        rows.append({
            "key": key, "name": plain(key), "meaning": ISSUES.get(key, ("", ""))[1],
            "calls": len(pres), "pct_of_connected": round(len(pres) / n, 4),
            "converted_with": round(rp, 4), "converted_without": round(ra, 4),
            "ci_with": [round(x, 4) for x in wilson(kp, len(pres))],
            "gap_pp": round(gap * 100, 1), "p_value": round(p, 4),
            "failed_calls": failed,                                       # the PM's "top cluster" counts these
            "ceiling_pp": round(max(0.0, len(pres) * gap / len(L)) * 100, 1),   # leads recovered per 100 calls if the failure vanished (association)
            "eligible": len(pres) >= MIN_CALLS,
        })
    rows.sort(key=lambda r: -r["ceiling_pp"])
    elig = [r for r in rows if r["eligible"] and r["gap_pp"] > 0]
    target = elig[0]["key"] if elig else None
    naive = max(rows, key=lambda r: r["failed_calls"])["key"] if rows else None
    return {
        "n_calls": N, "n_connected": n, "no_connect": N - n,
        "baseline": {"rate": round(k_all / N, 4), "ci": [round(x, 4) for x in wilson(k_all, N)], "definition": "quantity and specification captured"},
        "baseline_connected": round(k_conn / n, 4),
        "issues": rows, "target": target, "pm_pick": naive, "most_common": max(rows, key=lambda r: r["calls"])["key"] if rows else None,
        "note": "Machine labels, not yet human-verified. Associations, not causes: the A/B test is what proves cause.",
    }


# ------------------------------------------------------------------------------------------------ propose
PROMPT = """You improve the system prompt of VANI, IndiaMART's voice bot. VANI phones a buyer when the seller is unavailable and must capture the requirement (quantity, specification, delivery location, timeline) so a BuyLead is created.

PROBLEM FOUND IN REAL CALLS: "{name}" - {meaning}
It appears in {calls} of {connected} connected calls. Calls with it become BuyLeads {cw:.0%} of the time, calls without it {cwo:.0%}.
What is different about these calls (measured on the labelled calls):
{profile}
Fix suggestions written by an auditor for individual calls with this problem (they may repeat or disagree):
{hints}

CURRENT PROMPT:
{prompt}

Write ONE small edit to the prompt that makes this problem less likely. Rules:
- At most 2 added lines and at most 1 removed line. Each line is one plain instruction of at most 40 words.
- "after" and "remove" must copy an EXISTING line of the current prompt exactly, character for character.
- Put the new line in the "## Rules" section: use one of its existing "- " lines as "after". Only change a numbered flow step if the problem cannot be fixed with a rule.
- Say what VANI should DO instead ("When X happens, do Y"), not only what it must not do.
- Never tell VANI to keep a call going when the buyer clearly refuses or asks to stop; respect that. Prefer fixes such as offering a callback time, or asking for the next missing detail before closing.
- The title and the "why" must describe exactly what the added line(s) tell VANI to do.
- Do not add new questions, new steps for the buyer, or promises. Do not make the call longer unless it is essential.
- The edit must be general: no names, no product names, no numbers taken from calls, no quotes.
Reply with ONE JSON object only:
{{"title":"max 8 words","why":"one sentence","remove":[],"add":[{{"after":"<existing line>","text":"<new line>"}}],"risk":"one sentence on what could go wrong"}}"""

_BAD = re.compile(r"[\"“”]|\d")        # no digits or quotes: stops call-specific details leaking into a prompt edit


def profile(issue: str) -> list[str]:
    """What is different about calls with this failure? Aggregate shares only (no transcript text). Biggest differences first."""
    L = [d for d in sp.labelled() if d["label"] != "no_connect"]
    P = [d for d in L if issue in d.get("bot_issues", [])]
    O = [d for d in L if issue not in d.get("bot_issues", [])]
    if not P or not O:
        return []
    out = []
    def share(X, f):
        return sum(1 for d in X if f(d)) / len(X)
    tests = [("how the call ended: " + k.replace("_", " "), lambda d, k=k: d.get("call_end") == k) for k in
             ("bot_ended_early", "buyer_declined", "buyer_hung_up", "no_response")]
    tests += [("buyer asked for " + k.replace("_", " "), lambda d, k=k: k in d.get("buyer_requests", [])) for k in
              ("callback", "seller_contact", "price_quote", "stop_calling")]
    tests += [("buyer gave the " + k, lambda d, k=k: k in d.get("fields", [])) for k in ("quantity", "specification", "location", "timeline")]
    for name, f in tests:
        a, b = share(P, f), share(O, f)
        out.append((abs(a - b), f"{name}: {a:.0%} of these calls vs {b:.0%} of other calls"))
    return [t for d, t in sorted(out, reverse=True) if d >= 0.05][:6]


def _clean_hints(issue: str, limit: int = 40) -> list[str]:
    path = DATA / "fix_backlog.json"
    if not path.exists():
        sp.backlog()
    seen, out = set(), []
    for h in json.loads(path.read_text())["issues"].get(issue, {}).get("hints", []):
        k = re.sub(r"\W+", " ", h.lower()).strip()
        if k and k not in seen and not _BAD.search(h):
            seen.add(k); out.append(h.strip())
    return out[:limit]


def _validate(obj: dict, base_text: str) -> dict:
    add = [a for a in (obj.get("add") or []) if isinstance(a, dict) and a.get("text")]
    rem = [r for r in (obj.get("remove") or []) if isinstance(r, str)]
    if not add or len(add) > 2 or len(rem) > 1:
        raise ValueError("edit must add 1-2 lines and remove at most 1")
    for t in [a["text"] for a in add]:
        if len(t.split()) > 45 or _BAD.search(t):
            raise ValueError("an added line is too long or contains digits/quotes")
    apply_patch(base_text, {"remove": rem, "add": add})                 # raises if an anchor is not an exact line
    return {"remove": rem, "add": [{"after": a["after"], "text": a["text"].strip()} for a in add]}


def propose(budget: float, yes: bool = False, force: bool = False, client=None, target: str | None = None) -> dict:
    """One Sarvam call (about Rs 0.1). Cached in data/proposal.json. Nothing is spent without yes=True."""
    if PROPOSAL.exists() and not force:
        return json.loads(PROPOSAL.read_text())
    m = mine()
    key = target or m["target"]
    row = next(r for r in m["issues"] if r["key"] == key)
    base = load_base()
    hints = _clean_hints(key)
    prompt = PROMPT.format(name=row["name"], meaning=row["meaning"], calls=row["calls"], connected=m["n_connected"],
                           cw=row["converted_with"], cwo=row["converted_without"],
                           hints="\n".join(f"- {h}" for h in hints) or "- (none)", prompt=base["text"].rstrip(),
                           profile="\n".join(f"- {t}" for t in profile(key)) or "- (nothing stands out)")
    est = sp.llm_cost(len(prompt) // 3 + 200, 500) * 2
    if not yes:
        return {"dry_run": True, "target": key, "hints": len(hints), "est_inr": round(est, 3)}
    if sp.status()["estimated_spend_inr"] + est > budget:
        raise sp.BudgetExceeded(f"proposal (~Rs {est:.2f}) would exceed the Rs {budget:.2f} budget")
    pipe = sp.Pipe(client)
    err, edit, tin, tout = "", None, 0, 0
    for attempt in range(2):
        msg = prompt if not err else prompt + f"\n\nYour previous reply was rejected: {err}. Reply again, fixing that."
        r = pipe.client.chat.completions(model=sp.LLM_MODEL, temperature=0.2, max_tokens=700, reasoning_effort=None,
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
            edit = {"title": str(obj.get("title", "Prompt edit"))[:80], "why": str(obj.get("why", ""))[:240], "risk": str(obj.get("risk", ""))[:240], **patch}
            break
        except Exception as e:                                           # one retry with the reason, then stop
            err = str(e)[:160]
    if not edit:
        raise RuntimeError(f"Sarvam did not return a valid prompt edit twice ({err}). Nothing was cached.")
    ids = sorted(d["idx"] for d in sp.labelled() if key in d.get("bot_issues", []))
    out = {"key": "ai_fix", "name": edit["title"], "origin": "ai-mined", "remove": edit["remove"], "add": edit["add"],
           "why": edit["why"], "risk": edit["risk"],
           "evidence": {"issue": key, "issue_name": row["name"], "calls_with_issue": row["calls"], "connected_calls": m["n_connected"],
                        "converted_with": row["converted_with"], "converted_without": row["converted_without"], "ceiling_pp": row["ceiling_pp"],
                        "hints_used": len(hints), "call_ids_sha256": hashlib.sha256(json.dumps(ids).encode()).hexdigest()[:16],
                        "base_prompt_hash": base["hash"], "labels_are_human_verified": False},
           "model": sp.LLM_MODEL, "tokens": {"in": tin, "out": tout}, "inr": round(sp.llm_cost(tin, tout), 4),
           "generated": time.strftime("%Y-%m-%d %H:%M")}
    out["hash"] = prompt_hash(json.dumps({k: out[k] for k in ("remove", "add")}, sort_keys=True))
    PROPOSAL.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    return out


def load_proposal() -> dict | None:
    return json.loads(PROPOSAL.read_text()) if PROPOSAL.exists() else None


# ------------------------------------------------------------------------------------------------ plan and bundle
def design_for_fix(leads_per_day: int = 600, share_b: float = 0.5) -> dict | None:
    """Test size for the measured baseline and the failure's ceiling (rounded to a whole point, at least 3pp)."""
    from .engine import Config, build_design
    m = mine()
    if not m.get("target"):
        return None
    row = next(r for r in m["issues"] if r["key"] == m["target"])
    mde = max(0.03, round(row["ceiling_pp"] / 100, 2))
    base = round(m["baseline"]["rate"], 3)
    cfg = Config(baseline=base, mde=mde, share_b=share_b, leads_per_day=leads_per_day, window_days=14).validate()
    d = build_design(cfg)
    return {"baseline": base, "mde": mde, "share_b": share_b, "leads_per_day": leads_per_day, "n_max": int(d.n_max),
            "days_needed": round(d.n_max / leads_per_day, 1)}


def bundle() -> dict:
    """What the dashboard shows. Free."""
    m = mine()
    prop = load_proposal()
    out = {"mine": m, "proposal": None, "prescreen": None, "plan": None}
    if prop:
        base = load_base()
        v = make_variant("ai_fix")
        out["proposal"] = {**{k: prop[k] for k in ("name", "why", "risk", "evidence", "hash", "generated", "model")},
                           "diff": v["diff"], "added": [a["text"] for a in prop["add"]], "removed": prop["remove"], "base_hash": base["hash"]}
    try:
        from . import prescreen
        out["prescreen"] = prescreen.summary()
    except Exception:
        out["prescreen"] = None
    out["plan"] = design_for_fix()
    return out


def write_agent_prompts() -> str:
    """Rewrite data/sarvam_agent_prompt.md so the two Sarvam agents (dashboard step) match the prompts that were tested."""
    f = DATA / "sarvam_agent_prompt.md"
    old = f.read_text()
    head = old[:old.index("## System prompt A")]
    a, b = load_base()["text"].rstrip(), make_variant("ai_fix")
    f.write_text(head + "## System prompt A (today's prompt; stand-in written from the VANI description, replace with the real prompt)\n" + a +
                 f"\n\n## System prompt B (candidate: {b['name']}; drafted by Sarvam from the real failures, one added line)\n" + b["text"].rstrip() + "\n")
    return str(f)
