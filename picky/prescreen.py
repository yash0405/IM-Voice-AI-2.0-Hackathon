"""Pre-screen: simulated buyers hear prompt A and prompt B before any real buyer does.

24 buyers (8 behaviours x 3 products) each talk to VANI under prompt A and under the candidate B. Sarvam's chat model plays the
buyer and VANI; the same Sarvam tagger that labelled the real recordings scores every call. Text only (no voice), so it is cheap.

What this is: a smoke test that catches an edit that makes the bot clearly worse, and shows the direction on the targeted failure.
What it is not: proof. 24 simulated buyers cannot prove a lift, and the simulated buyers are far more cooperative than real ones. The proof
comes from the A/B engine on live traffic.

The pass rule is fixed here, before any result exists, so it cannot be tuned after seeing the numbers (see GATE).
  python -m picky fix prescreen-plan | prescreen --yes --budget N | status
"""
from __future__ import annotations

import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from . import arena as ar
from . import sarvam_pipe as sp
from .variants import load_base, make_variant

PS = sp.DATA / "prescreen.json"
WORKERS = 2                      # about 25 requests a minute, under the 40/min Sarvam-105B limit

BEHAVIOURS = [
    ("cooperative", "Friendly and clear. Answer only the question you are asked."),
    ("busy", "Busy and a little impatient. Very short answers. If a question has two parts, answer only one part."),
    ("unsure", "Hesitant and not sure of some details. You ask about the price once. You give details only if the assistant is patient."),
    ("terse", "Answer with one or two words only ('haan', 'theek hai', 'pata nahi'). Sometimes reply only '...'."),
    ("skeptical", "Ask who is calling and why before you give any detail. Give details only after the assistant explains."),
    ("all_at_once", "In your first answer give everything you know at once: quantity, size, location and timing."),
    ("english", "Speak only English (Indian business English), never Hindi."),
    ("leaves", "After two questions say you are busy driving and ask to be called later ('baad mein baat karte hain')."),
]
PRODUCTS = [
    ("pipes", "stainless steel pipes", "You enquired about stainless steel pipes. You need 500 pieces, size 20 mm, grade 304. Delivery to Pune. You need it within 10 days."),
    ("lights", "LED street lights", "You enquired about LED street lights. You need 200 units, 40 watt. Delivery to Surat. You need them next week."),
    ("boxes", "packaging boxes", "You enquired about packaging boxes. You are not sure of the quantity (maybe a few thousand). Size 12x10x8 inch. Delivery to Jaipur. No fixed date."),
]

# Pass rule, fixed before the run. B passes the gate when it shows no sign of harm:
GATE = {"conv_drop_max": 2,      # B may convert at most 2 of 24 fewer simulated buyers than A (noise at this size)
        "fatal_rise_max": 2,     # and have at most 2 more on-call-fatal calls
        "turns_ratio_max": 1.30}  # and at most 30% more bot turns (a proxy for handling time)
_lock = threading.Lock()


NAMES = ["Rajesh Kumar", "Sunil Patel", "Vikram Singh", "Anil Sharma", "Mohit Jain", "Deepak Verma", "Suresh Reddy", "Karan Mehta"]


def personas(n: int | None = None) -> list[dict]:
    """The first n personas of a fixed order (all 24 when n is None). Every second persona has a live seller available."""
    out = []
    for i, (b, bh) in enumerate(BEHAVIOURS):
        for j, (p, product, facts) in enumerate(PRODUCTS):
            out.append({"key": f"{b}_{p}", "behaviour": b, "facts": facts, "how": bh, "name": NAMES[i], "product": product, "live_seller": (i + j) % 2 == 0})
    return out[:n] if n else out


def _persona_obj(p: dict) -> dict:
    return {"key": p["key"], "facts": p["facts"], "behaviour": p["how"], "name": p["name"], "product": p["product"], "live_seller": p["live_seller"]}


def placeholder_lines(results: list[dict]) -> int:
    """Data-quality check: bot lines that still contain a [placeholder]. Should be 0."""
    return sum(1 for r in results for l in r["lines"] if l["speaker"] == "bot" and "[" in l["text"])


DEFAULT_PERSONAS = 12


def plan(n: int = DEFAULT_PERSONAS) -> dict:
    """Free. Exact-enough cost before anything is spent. n personas, each heard under prompt A and prompt B."""
    c = ar.sim_cost(n * 2)
    return {"personas": n, "simulated_calls": n * 2, "chat_requests": c["chat_requests"], "prompt_tokens_per_vani_turn": c["prompt_tokens_per_vani_turn"],
            "est_inr": c["total_inr"], "est_minutes": round(c["chat_requests"] / 25, 0), "arena_ledger_inr_so_far": round(ar.spent(), 2), "workers": WORKERS,
            "all_24_personas_inr": ar.sim_cost(48)["total_inr"]}


def _load() -> dict:
    return json.loads(PS.read_text()) if PS.exists() else {"results": [], "errors": []}


def _save(d: dict) -> None:
    tmp = PS.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1))
    os.replace(tmp, PS)


def run(budget: float, client=None, n: int = DEFAULT_PERSONAS) -> dict:
    """Spends credits. Resumable: finished (persona, arm) pairs are never repeated. Failed ones are recorded, not retried."""
    base = load_base()
    d = _load()
    if d.get("base_hash") not in (None, base["hash"]) or (d["results"] and "base_hash" not in d):
        d = {"results": [], "errors": []}                          # made with another base prompt (e.g. the earlier stand-in): start clean
    d["b_variant"] = "fix_candidate"
    d["b_name"] = make_variant("fix_candidate")["name"]
    d["base_hash"] = base["hash"]
    done = {(r["persona"], r["arm"]) for r in d["results"]}
    prompts = {"A": base["text"], "B": make_variant("fix_candidate")["text"]}
    a = ar.Arena(client)
    pl = plan(n)
    per_call = pl["est_inr"] / pl["simulated_calls"]
    stop = threading.Event()

    def task(p: dict, arm: str):
        if stop.is_set():
            return
        with _lock:
            if ar.spent() + per_call * 2 > budget:
                stop.set(); print(f"STOP: next call would exceed the Rs {budget:.2f} budget."); return
        try:
            lines = a.simulate(ar.sim_prompt(prompts[arm], p), _persona_obj(p))
            text = "\n".join(f"[Speaker {0 if l['speaker'] == 'bot' else 1}] {l['text']}" for l in lines)
            tag = a.pipe.tag_text(text, ledger=ar._spend)
            tag.pop("raw_reply", None)
            rec = {"persona": p["key"], "behaviour": p["behaviour"], "arm": arm, "lines": lines,
                   "tag": {k: tag.get(k) for k in ("label", "fields", "bot_issues", "fatal", "call_end", "valid")}}
            with _lock:
                d["results"].append(rec); d["generated"] = time.strftime("%Y-%m-%d %H:%M"); _save(d)
            print(f"{p['key']:20s} {arm}  turns={len(lines):2d}  {tag['label']:16s} issues={tag.get('bot_issues')}  spent Rs {ar.spent():.2f}", flush=True)
        except Exception as e:
            with _lock:
                d["errors"].append({"persona": p["key"], "arm": arm, "error": str(e)[:200]}); _save(d)
            print(f"ERROR {p['key']} {arm}: {str(e)[:120]}", flush=True)

    todo = [(p, arm) for p in personas(n) for arm in ("A", "B") if (p["key"], arm) not in done]
    with ThreadPoolExecutor(WORKERS) as ex:
        list(ex.map(lambda t: task(*t), todo))
    return {"results": len(_load()["results"]), "errors": len(_load()["errors"]), "arena_ledger_inr": round(ar.spent(), 2)}


def _conv(tag: dict) -> bool:
    return {"quantity", "specification"} <= set(tag.get("fields") or [])


def summary() -> dict | None:
    d = _load()
    R = d.get("results", [])
    if not R:
        return None
    from .fixloop import mine
    target = mine().get("target")
    stale = d.get("base_hash") != load_base()["hash"]            # run with a different base prompt, e.g. the earlier stand-in
    by = {}
    for r in R:
        by.setdefault(r["persona"], {})[r["arm"]] = r
    pairs = {k: v for k, v in by.items() if "A" in v and "B" in v}
    if not pairs:
        return None
    def arm(x):
        rs = [v[x] for v in pairs.values()]
        return {"n": len(rs),
                "converted": sum(_conv(r["tag"]) for r in rs),
                "buylead": sum(r["tag"]["label"] == "buylead_created" for r in rs),
                "target_issue": sum(target in (r["tag"].get("bot_issues") or []) for r in rs),
                "any_issue": sum(bool(r["tag"].get("bot_issues")) for r in rs),
                "fatal": sum((r["tag"].get("fatal") or "none") != "none" for r in rs),
                "bot_turns": round(sum(sum(1 for l in r["lines"] if l["speaker"] == "bot") for r in rs) / len(rs), 2)}
    A, B = arm("A"), arm("B")
    b_only = sum(_conv(v["B"]["tag"]) and not _conv(v["A"]["tag"]) for v in pairs.values())
    a_only = sum(_conv(v["A"]["tag"]) and not _conv(v["B"]["tag"]) for v in pairs.values())
    checks = {"conversion": B["converted"] >= A["converted"] - GATE["conv_drop_max"],
              "fatal": B["fatal"] <= A["fatal"] + GATE["fatal_rise_max"],
              "turns": B["bot_turns"] <= A["bot_turns"] * GATE["turns_ratio_max"]}
    return {"n_pairs": len(pairs), "A": A, "B": B, "target": target, "b_better": b_only, "a_better": a_only,
            "gate": GATE, "checks": checks, "passed": all(checks.values()),
            "target_issue_fell": B["target_issue"] < A["target_issue"],
            "errors": len(d.get("errors", [])), "stale": stale, "placeholder_lines": placeholder_lines(R), "b_name": d.get("b_name"), "generated": d.get("generated"),
            "note": ("Simulated buyers played by Sarvam's language model against the real VANI prompt. A smoke test that catches an edit that "
                     "makes the bot clearly worse. It cannot prove a lift: that takes the live A/B test.")}
