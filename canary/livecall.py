"""Live call test: hear prompt A and prompt B on real calls, judge them by the signals the listeners give.

The team talks to two Sarvam voice agents (A = today's prompt, B = the patched prompt). After every call the listener gives one
signal ("was that a good call?", plus an optional "fatal problem" flag). Everything that makes the result trustworthy is fixed
BEFORE the first call and cannot be changed afterwards:

  * the threshold: how many finished calls each prompt must have before ANY result is shown (no peeking, no stopping when it looks good);
  * the order of the calls: a secret, balanced sequence (one A and one B in every pair, shuffled), committed in the log by hash and
    revealed with the result so anyone can re-check it; calls that fail and are voided are re-issued for the same prompt;
  * the confidence level and the guardrails (call length, fatal problems);
  * optionally a blind mode: the listener hears "Line 1" and "Line 2" and only learns which is which when the result is released.

State lives in one JSON file per test under data/live/ (never committed). The decision log is the same hash-chained ledger the rest of
Picky uses (tamper-evident, not tamper-proof). Voice transport is separate: the browser SDK (liveserver.py + web/live/) or any other
way of calling the agents; this module only knows calls, signals and the decision. No Sarvam network call is made here.
"""
from __future__ import annotations

import csv
import difflib
import hashlib
import io
import json
import os
import random
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from . import livestats
from .stats import wilson
from .ledger import Ledger, verify

ROOT = Path(__file__).resolve().parent.parent
LOCK = threading.RLock()
LIMITS = {"min_calls": 3, "max_calls": 200}
DEMO_PRODUCT, DEMO_BOT = "stainless steel pipes", "Vani"
CONFIDENCE = {0.80: "80% (quick demo: 1 in 5 risk of a wrong call)", 0.90: "90% (recommended)", 0.95: "95% (strict)"}

# Same buyer scenario for the two calls of a pair, so A and B are heard on the same kind of buyer.
# The demo agents are rendered for stainless steel pipes with a live seller available (data/sarvam_agent_prompt.md).
BUYER_ROLES = [
    {"key": "cooperative", "title": "Cooperative buyer",
     "say": "You called a seller about stainless steel pipes and the call was redirected. You know what you want: 500 pieces, 20 mm, grade 304. Name: Rajesh Kumar, Pune. Answer each question clearly, one thing at a time."},
    {"key": "busy", "title": "Busy buyer",
     "say": "You are in a hurry. Same need (stainless steel pipes, 200 pieces, 25 mm) but give very short answers and only one detail per reply. If asked two things at once, answer only the first. Name: Sunil Patel, Surat."},
    {"key": "unsure", "title": "Unsure buyer",
     "say": "You do not know the quantity yet ('maybe a few hundred'). Ask about the price once. Give details only when the assistant is patient. Name: Vikram Singh, Jaipur."},
]


class LiveError(ValueError):
    """A request that cannot be honoured; the message is shown to the user as is."""


def live_dir() -> Path:
    d = Path(os.environ.get("CANARY_LIVE_DIR") or (ROOT / "data" / "live"))
    (d / "tests").mkdir(parents=True, exist_ok=True)
    return d


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _atomic_write(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


# ---------------------------------------------------------------------------- connection to the Sarvam Voice Agents platform

ENV_KEYS = ("SARVAM_VOICE_API_KEY", "SARVAM_ORG_ID", "SARVAM_WORKSPACE_ID")


def _env_files() -> list[Path]:
    return [ROOT / ".env", ROOT.parent / "canary" / ".env", ROOT.parent / ".env"]


def env_value(name: str) -> str:
    """Process environment first, then the .env files (the key is never written anywhere else and never sent to the browser)."""
    if os.environ.get(name):
        return os.environ[name].strip()
    for f in _env_files():
        try:
            for line in f.read_text().splitlines():
                m = re.match(rf"\s*{re.escape(name)}\s*=\s*['\"]?([^'\"\s]+)", line)
                if m:
                    return m.group(1)
        except OSError:
            continue
    return ""


def voice_api_key() -> str:
    return env_value("SARVAM_VOICE_API_KEY")


def connection() -> dict:
    """Which Sarvam agents the two prompts are. Ids are not secrets (the key is); they are saved in data/live/connection.json."""
    f = live_dir() / "connection.json"
    saved = json.loads(f.read_text()) if f.exists() else {}
    arms = saved.get("arms") or {}
    out = {"org_id": saved.get("org_id") or env_value("SARVAM_ORG_ID"), "workspace_id": saved.get("workspace_id") or env_value("SARVAM_WORKSPACE_ID"),
           "arms": {k: {"app_id": (arms.get(k) or {}).get("app_id", ""), "version": (arms.get(k) or {}).get("version", "")} for k in ("A", "B")}}
    out["key_set"] = bool(voice_api_key())
    out["ready"] = bool(out["key_set"] and out["org_id"] and out["workspace_id"] and all(out["arms"][k]["app_id"] for k in ("A", "B")))
    return out


_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")


def save_connection(body: dict) -> dict:
    org, ws = str(body.get("org_id", "")).strip(), str(body.get("workspace_id", "")).strip()
    arms = {}
    for k in ("A", "B"):
        a = (body.get("arms") or {}).get(k) or {}
        app, ver = str(a.get("app_id", "")).strip(), str(a.get("version", "")).strip()
        for label, v in (("agent id", app), ("version", ver)):
            if v and not _ID.match(v):
                raise LiveError(f"the {label} for prompt {k} has characters that are not allowed")
        arms[k] = {"app_id": app, "version": ver}
    for label, v in (("organisation id", org), ("workspace id", ws)):
        if v and not _ID.match(v):
            raise LiveError(f"the {label} has characters that are not allowed")
    _atomic_write(live_dir() / "connection.json", json.dumps({"org_id": org, "workspace_id": ws, "arms": arms}, indent=1))
    return connection()


# ---------------------------------------------------------------------------- the two prompts

def candidates() -> list[dict]:
    from . import variants
    out = []
    for key, spec in variants._candidates().items():
        out.append({"key": key, "name": spec["name"], "origin": spec.get("origin", "human"), "why": spec.get("why")})
    out.sort(key=lambda c: (c["key"] != "fix_candidate", c["name"]))
    seen, uniq = set(), []
    for c in out:                                   # the fix loop's pick can also be listed under its own name: show each patch once
        if c["name"] not in seen:
            seen.add(c["name"])
            uniq.append(c)
    return uniq


def default_candidate() -> str:
    cs = candidates()
    return cs[0]["key"] if cs else ""


def _side(words: list[str], ops: list, new_side: bool, ctx: int = 6) -> list[list]:
    """The words of one side of a changed line as [text, changed] segments: each changed run marked separately, long unchanged runs shortened."""
    segs: list[list] = []
    first, last = ops[0], ops[-1]
    for k, (tag, i1, i2, j1, j2) in enumerate(ops):
        lo, hi = (j1, j2) if new_side else (i1, i2)
        chunk = words[lo:hi]
        if tag == "equal":
            if len(chunk) > 2 * ctx + 2 and 0 < k < len(ops) - 1:
                segs.append([" ".join(chunk[:ctx]) + " … " + " ".join(chunk[-ctx:]) + " ", 0])
            elif k == 0:
                segs.append([("… " if len(chunk) > ctx else "") + " ".join(chunk[-ctx:]) + " ", 0])
            elif k == len(ops) - 1:
                segs.append([" " + " ".join(chunk[:ctx]) + (" …" if len(chunk) > ctx else ""), 0])
            else:
                segs.append([" ".join(chunk) + " ", 0])
        else:
            segs.append([(" ".join(chunk) or "(nothing)") + " ", 1])
    return segs


def changes(candidate_key: str) -> list[dict]:
    """What the patch changes, as short before/after snippets with the changed words marked (the real prompt lines are very long)."""
    from . import variants
    base = variants.load_base()["text"].splitlines()
    new = variants.make_variant(candidate_key)["text"].splitlines()
    out = []
    sm = difflib.SequenceMatcher(None, base, new, autojunk=False)
    for tag, a1, a2, b1, b2 in sm.get_opcodes():
        if tag == "equal":
            continue
        olds, news = base[a1:a2], new[b1:b2]
        for k in range(max(len(olds), len(news))):
            ow = (olds[k] if k < len(olds) else "").split()
            nw = (news[k] if k < len(news) else "").split()
            ops = difflib.SequenceMatcher(None, ow, nw, autojunk=False).get_opcodes()
            if all(o[0] == "equal" for o in ops):
                continue
            out.append({"before": _side(ow, ops, False), "after": _side(nw, ops, True)})
    return out


def agent_prompt(arm: str, candidate_key: str) -> str:
    """The text to paste into the Sarvam agent's Instructions: the real inbound-redirect prompt rendered for the demo call."""
    from . import realprompt as rp
    from . import variants
    if arm not in ("A", "B"):
        raise LiveError("arm must be A or B")
    text = variants.load_base()["text"] if arm == "A" else variants.make_variant(candidate_key)["text"]
    ctx = dict(product_name=DEMO_PRODUCT, buyer_name="", ast_seller_pns="9100000000", ast_flow_live="true",
               ast_seller_company="a verified seller", ast_seller_city="Delhi")
    out = rp.render(rp.flows(text)["inbound_redirect"], **ctx)
    # The real prompt names two platform variables as bare words (the PDF lost the template markers). A fresh demo agent has no such variables,
    # so the words are filled in. Both prompts get the same fill-in, so only the patch differs between A and B.
    out = re.sub(r"@\s*product_name", DEMO_PRODUCT, out)
    out = re.sub(r"product_name(?=[a-z])", DEMO_PRODUCT + " ", out)
    out = re.sub(r"(?<![A-Za-z_])product_name(?![A-Za-z_])", DEMO_PRODUCT, out)
    out = re.sub(r"bot_name(?=[a-z])", DEMO_BOT + " ", out)
    return re.sub(r"(?<![A-Za-z_])bot_name(?![A-Za-z_])", DEMO_BOT, out)


def prompt_pair(candidate_key: str) -> dict:
    from . import variants
    if candidate_key not in {c["key"] for c in candidates()}:
        raise LiveError("unknown patch: " + candidate_key)
    v = variants.make_variant(candidate_key)
    base = variants.load_base()
    return {"A": {"name": "Prompt A: today's prompt", "hash": base["hash"]}, "B": {"name": "Prompt B: " + v["name"], "hash": v["hash"], "origin": v["origin"]},
            "changes": changes(candidate_key), "why": (variants._candidates()[candidate_key] or {}).get("why"),
            "risk": (variants._candidates()[candidate_key] or {}).get("risk")}


# ---------------------------------------------------------------------------- a test

def _sequence(seed: int, per_arm: int) -> list[str]:
    rng = random.Random(seed)
    seq = []
    for _ in range(per_arm):
        pair = ["A", "B"]
        rng.shuffle(pair)
        seq += pair
    return seq


def _commit(sequence: list[str], labels: dict, salt: str) -> str:
    return hashlib.sha256((salt + json.dumps({"sequence": sequence, "labels": labels}, sort_keys=True)).encode()).hexdigest()


def _path(tid: str) -> Path:
    if not re.fullmatch(r"lt-[0-9]{8}-[0-9]{6}(-[0-9a-f]{4})?", tid):
        raise LiveError("unknown test")
    return live_dir() / "tests" / f"{tid}.json"


def _load(tid: str) -> dict:
    p = _path(tid)
    if not p.exists():
        raise LiveError("unknown test")
    return json.loads(p.read_text())


def _save(t: dict) -> None:
    _atomic_write(_path(t["id"]), json.dumps(t, indent=1, sort_keys=True))


def _ledger(t: dict) -> Ledger:
    lg = Ledger(_now)
    lg.entries = t["ledger"]
    return lg


def _log(t: dict, etype: str, payload: dict) -> None:
    _ledger(t).append(etype, payload)


def validate_plan(body: dict) -> dict:
    try:
        n = int(body.get("calls_per_arm", 10))
    except (TypeError, ValueError):
        raise LiveError("calls per prompt must be a whole number")
    if not LIMITS["min_calls"] <= n <= LIMITS["max_calls"]:
        raise LiveError(f"calls per prompt must be between {LIMITS['min_calls']} and {LIMITS['max_calls']}")
    try:
        conf = float(body.get("confidence", 0.90))
    except (TypeError, ValueError):
        raise LiveError("confidence must be 80, 90 or 95")
    conf = conf / 100 if conf > 1 else conf
    if round(conf, 2) not in CONFIDENCE:
        raise LiveError("confidence must be 80, 90 or 95")
    return {"calls_per_arm": n, "confidence": round(conf, 2), "alpha": round(1 - conf, 2)}


def create_test(body: dict) -> dict:
    with LOCK:
        for t in list_tests():
            if t["state"] == "running":
                raise LiveError(f"'{t['name']}' is still running: finish it or abandon it first")
        plan = validate_plan(body)
        cand = str(body.get("candidate") or default_candidate())
        pair = prompt_pair(cand)
        name = str(body.get("name") or "Live call test").strip()[:80] or "Live call test"
        goal = str(body.get("goal_name") or "Good call").strip()[:40] or "Good call"
        blind = bool(body.get("blind", True))
        seed = secrets.randbits(32)
        salt = secrets.token_hex(8)
        rng = random.Random(seed ^ 0x5EED)
        labels = {"A": "Prompt A", "B": "Prompt B"}
        if blind:
            first = rng.choice(["A", "B"])
            labels = {first: "Line 1", ("B" if first == "A" else "A"): "Line 2"}
        seq = _sequence(seed, plan["calls_per_arm"])
        tid = "lt-" + datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)
        cfg = {**plan, "blind": blind, "goal_name": goal, "candidate": cand, "duration_margin": 0.15, "fatal_margin": 0.15,
               "prompts": {"A": pair["A"]["hash"], "B": pair["B"]["hash"]}, "prompt_names": {"A": pair["A"]["name"], "B": pair["B"]["name"]}}
        t = {"id": tid, "name": name, "created": _now(), "state": "running", "config": cfg, "calls": [], "ledger": [],
             "secret": {"sequence": seq, "labels": labels, "salt": salt}, "result": None}
        _log(t, "test_locked", {"name": name, "config": cfg, "total_calls": len(seq), "sequence_commitment": _commit(seq, labels, salt),
                                "rule": "Result is released only when every prompt has the planned number of finished calls. Win = exact test and score test both pass."})
        _save(t)
        return public(t)


def list_tests() -> list[dict]:
    out = []
    for p in sorted((live_dir() / "tests").glob("lt-*.json")):
        try:
            t = json.loads(p.read_text())
            out.append({"id": t["id"], "name": t["name"], "state": t["state"], "created": t["created"], "config": t["config"]})
        except (OSError, ValueError, KeyError):
            continue
    return out


def _counts(t: dict) -> dict:
    done = {"A": 0, "B": 0}
    for c in t["calls"]:
        if c["status"] == "done":
            done[c["arm"]] += 1
    return done


def _open_call(t: dict) -> dict | None:
    for c in t["calls"]:
        if c["status"] in ("assigned", "in_call", "awaiting_signal"):
            return c
    return None


def _call_view(t: dict, c: dict, reveal: bool) -> dict:
    cfg, labels = t["config"], t["secret"]["labels"]
    v = {"id": c["id"], "n": c["slot"] + 1, "status": c["status"], "label": labels[c["arm"]], "duration_s": c.get("duration_s"),
         "role": BUYER_ROLES[(c["slot"] // 2) % len(BUYER_ROLES)], "source": c.get("source"), "has_signal": c.get("good") is not None,
         "app_id": c.get("app_id"), "version": c.get("version")}
    if reveal:
        v.update(arm=c["arm"], good=c.get("good"), fatal=c.get("fatal"), note=c.get("note"), interaction_id=c.get("interaction_id"),
                 transcript=c.get("transcript") or [], void_reason=c.get("void_reason"), auto=c.get("auto"))
    return v


def public(t: dict) -> dict:
    """Everything the page may see. Before the result is released it contains no signals, no tallies and (in blind mode) no arm."""
    released = t["state"] == "released"
    cfg, labels = t["config"], t["secret"]["labels"]
    counts = _counts(t)
    n = cfg["calls_per_arm"]
    prog = [{"label": labels[a], "done": counts[a], "of": n, **({"arm": a} if (released or not cfg["blind"]) else {})} for a in ("A", "B")]
    prog.sort(key=lambda p: p["label"])
    oc = _open_call(t)
    calls = [_call_view(t, c, released) for c in t["calls"] if c["status"] != "void" or released]
    lg = _ledger(t)
    ok, bad = verify(t["ledger"])
    out = {"id": t["id"], "name": t["name"], "created": t["created"], "state": t["state"],
           "config": {k: v for k, v in cfg.items() if k != "prompts" or released},
           "progress": prog, "total_done": sum(counts.values()), "total_planned": 2 * n, "open_call": _call_view(t, oc, False) if oc else None,
           "calls": calls, "locked": not released, "ledger": {"entries": len(t["ledger"]), "head": lg.head, "ok": ok}}
    if released:
        out["result"] = t["result"]
        out["reveal"] = {"labels": labels, "sequence": t["secret"]["sequence"], "salt": t["secret"]["salt"]}
        out["ledger"]["entries_full"] = t["ledger"]
        out["grading"] = {**(t.get("grading") or {}), **grade_plan_of(t)}         # the last run's outcome, with today's estimate and totals
    return out


def get_test(tid: str) -> dict:
    with LOCK:
        return public(_load(tid))


def active_test() -> dict | None:
    with LOCK:
        running = [x for x in list_tests() if x["state"] == "running"]
        if running:
            return public(_load(running[-1]["id"]))
        return None


# ---------------------------------------------------------------------------- calls

def next_call(tid: str, source: str = "sdk") -> dict:
    """The next call to make. Idempotent: if a call is already open (page refreshed) it is returned again."""
    with LOCK:
        t = _load(tid)
        if t["state"] != "running":
            raise LiveError("this test is no longer running")
        if source not in ("sdk", "manual"):
            raise LiveError("source must be sdk or manual")
        oc = _open_call(t)
        if oc is None:
            used = [c["slot"] for c in t["calls"] if c["status"] != "void"]
            slot = len(used)
            seq = t["secret"]["sequence"]
            if slot >= len(seq):
                raise LiveError("all planned calls are done")
            arm = seq[slot]
            con = connection()
            oc = {"id": f"c{len(t['calls']) + 1:03d}", "slot": slot, "arm": arm, "status": "assigned", "created_at": _now(), "source": source,
                  "app_id": con["arms"][arm]["app_id"], "version": con["arms"][arm]["version"], "good": None, "fatal": False}
            t["calls"].append(oc)
            _save(t)
        else:
            oc["source"] = source
            _save(t)
        return {"call": _call_view(t, oc, False), "test": public(t)}


def _find(t: dict, cid: str) -> dict:
    for c in t["calls"]:
        if c["id"] == cid:
            return c
    raise LiveError("unknown call")


def start_call(tid: str, cid: str) -> dict:
    with LOCK:
        t = _load(tid)
        c = _find(t, cid)
        if c["status"] not in ("assigned", "in_call"):
            raise LiveError("this call has already finished")
        if c["status"] == "assigned":
            c["status"], c["started_at"], c["_t0"] = "in_call", _now(), time.time()
            _save(t)
        return {"call": _call_view(t, c, False)}


MAX_TRANSCRIPT = 400


def end_call(tid: str, cid: str, body: dict) -> dict:
    with LOCK:
        t = _load(tid)
        c = _find(t, cid)
        if c["status"] != "in_call":
            raise LiveError("this call was not started or has already ended")
        dur = round(time.time() - c.pop("_t0", time.time()), 1)
        if c["source"] == "manual" and body.get("duration_s") not in (None, ""):
            try:
                dur = float(body["duration_s"])
            except (TypeError, ValueError):
                raise LiveError("call length must be a number of seconds")
            if not 0 <= dur <= 3600:
                raise LiveError("call length must be between 0 and 3600 seconds")
        tr = []
        for m in (body.get("transcript") or [])[:MAX_TRANSCRIPT]:
            if isinstance(m, dict) and m.get("content"):
                tr.append({"role": "bot" if str(m.get("role")) == "bot" else "user", "content": str(m["content"])[:1200]})
        iid = str(body.get("interaction_id") or "")[:120]
        c.update(status="awaiting_signal", ended_at=_now(), duration_s=dur, transcript=tr, interaction_id=iid)
        _save(t)
        return {"call": _call_view(t, c, False)}


def signal(tid: str, cid: str, body: dict) -> dict:
    """The listener's signal for a finished call. Releases the result when the threshold is reached."""
    with LOCK:
        t = _load(tid)
        c = _find(t, cid)
        if c["status"] != "awaiting_signal":
            raise LiveError("this call is not waiting for a signal")
        if body.get("good") not in (True, False):
            raise LiveError(f"say whether it was a {t['config']['goal_name'].lower()} (yes or no)")
        c.update(good=bool(body["good"]), fatal=bool(body.get("fatal")), note=str(body.get("note") or "")[:300], status="done", signalled_at=_now())
        _log(t, "call_logged", {"call": c["id"], "slot": c["slot"], "arm": c["arm"], "good": c["good"], "fatal": c["fatal"], "duration_s": c["duration_s"],
                                "source": c["source"], "interaction_id": c.get("interaction_id") or None, "app_id": c.get("app_id"), "version": c.get("version")})
        done = _counts(t)
        released = False
        if min(done.values()) >= t["config"]["calls_per_arm"]:
            _release(t)
            released = True
        _save(t)
        return {"released": released, "test": public(t)}


def void_call(tid: str, cid: str, reason: str) -> dict:
    """A call that did not work (no sound, dropped, wrong agent). It does not count and the same prompt is called again."""
    with LOCK:
        t = _load(tid)
        c = _find(t, cid)
        if c["status"] not in ("assigned", "in_call", "awaiting_signal"):
            raise LiveError("only an open call can be voided")
        reason = (reason or "").strip()[:200]
        if not reason:
            raise LiveError("say why the call is being voided (it is kept in the log)")
        c.update(status="void", void_reason=reason)
        c.pop("_t0", None)
        _log(t, "call_voided", {"call": c["id"], "slot": c["slot"], "arm": c["arm"], "reason": reason})
        _save(t)
        return {"test": public(t)}


def _release(t: dict) -> None:
    cfg = t["config"]
    a, b = livestats.summarise(t["calls"], "A"), livestats.summarise(t["calls"], "B")
    res = livestats.judge(a, b, cfg["alpha"], cfg["duration_margin"], cfg["fatal_margin"])
    res["goal_name"] = cfg["goal_name"]
    res["calls_per_arm"] = cfg["calls_per_arm"]
    res["released_at"] = _now()
    t["result"], t["state"] = res, "released"
    _log(t, "result_released", {"verdict": res["verdict"], "call": res["call"], "p_value": round(res["p_value"], 5), "diff": round(res["diff"], 4),
                                "a": a, "b": b, "guards": res["guards"], "sequence": t["secret"]["sequence"], "labels": t["secret"]["labels"], "salt": t["secret"]["salt"]})


# ---------------------------------------------------------------------------- Sarvam grades the calls (the deck's "auto-disposition vs labelled calls")

GRADE_GOAL = "buylead_created"           # the tagger's disposition that counts as the goal (the BRD's BuyLead created)
GRADE_BUDGET_INR = 10.0                  # hard cap per test, across every press
GRADE_MAX_CHARS = 12000                  # the longest transcript sent for one call (bounds what one call can cost)
_GRADING: set = set()                    # tests being graded right now (kept in memory, so a crash cannot leave a test stuck)


def _grade_text(c: dict) -> str:
    return "\n".join(f"{'VANI' if m['role'] == 'bot' else 'Buyer'}: {m['content']}" for m in c["transcript"])[:GRADE_MAX_CHARS]


def _grade_cost(text: str) -> float:
    """An upper estimate for one call: the tagger prompt plus the transcript in (1.5 characters a token, generous for Hindi), 900 tokens out
    (the reply's cap). The real cost comes from Sarvam's token counts and is lower; the cap is checked against this before each call."""
    from . import sarvam_pipe as sp
    from .evaluator import build_prompt
    return sp.llm_cost(int(len(build_prompt(text)) / 1.5), 900)


def _graded(t: dict) -> list[dict]:
    return [c for c in t["calls"] if c["status"] == "done" and (c.get("auto") or {}).get("valid")]


def grade_plan_of(t: dict, budget: float = GRADE_BUDGET_INR) -> dict:
    todo = [c for c in t["calls"] if c["status"] == "done" and c.get("transcript") and not c.get("auto")]
    no_tr = sum(1 for c in t["calls"] if c["status"] == "done" and not c.get("transcript"))
    spent = float(t.get("grading_spent_inr") or 0.0)
    return {"done": False, "to_grade": len(todo), "without_transcript": no_tr, "est_inr": round(sum(_grade_cost(_grade_text(c)) for c in todo), 2),
            "budget_inr": budget, "spent_inr": round(spent, 2), "left_inr": round(max(0.0, budget - spent), 2),
            "unreadable": sum(1 for c in t["calls"] if c.get("auto") and not c["auto"].get("valid")), "summary": grade_summary(t) if _graded(t) else None}


def grade_summary(t: dict) -> dict:
    """How often Sarvam's tag agrees with the listener: on the goal (yes or no) and on a fatal problem. A 2 by 2 table for the goal."""
    g = _graded(t)
    n = len(g)
    agree = sum(1 for c in g if bool(c["good"]) == bool(c["auto"]["goal_hit"]))
    fatal_agree = sum(1 for c in g if bool(c.get("fatal")) == bool(c["auto"]["fatal"]))
    lo, hi = wilson(agree, n) if n else (None, None)
    cell = lambda h, a: sum(1 for c in g if bool(c["good"]) == h and bool(c["auto"]["goal_hit"]) == a)
    return {"n": n, "goal_agree": agree, "goal_rate": agree / n if n else None, "goal_ci": [lo, hi], "fatal_agree": fatal_agree,
            "fatal_rate": fatal_agree / n if n else None, "table": {"yes_yes": cell(True, True), "yes_no": cell(True, False), "no_yes": cell(False, True), "no_no": cell(False, False)},
            "by_arm": {a: {"n": sum(1 for c in g if c["arm"] == a), "auto_goal": sum(1 for c in g if c["arm"] == a and c["auto"]["goal_hit"])} for a in ("A", "B")}}


def grade_calls(tid: str, yes: bool = False, budget: float = GRADE_BUDGET_INR, client=None) -> dict:
    """After the result is released, Sarvam's chat model reads each finished call's transcript with the same tagger the project uses for the
    real VANI recordings (canary/sarvam_pipe.py, data/evaluator_prompt.md) and the tag is compared with the listener's signal. It never changes
    the verdict (the signals decide). Paid: without yes=True it only returns the estimate. The budget is a hard cap for the test across every
    press: before each call the worst-case cost is checked against what is left. A reply that cannot be read marks that call unreadable (paid
    once, not retried); a network or service error stops the run and keeps what was graded. Sarvam is called outside the lock."""
    from . import sarvam_pipe as sp
    with LOCK:
        t = _load(tid)
        if t["state"] != "released":
            raise LiveError("calls are graded after the result is released, so the grades cannot sway the listeners")
        plan = grade_plan_of(t, budget)
        if not yes or not plan["to_grade"]:
            return {**plan, "test": public(t)}
        if tid in _GRADING:
            raise LiveError("this test is being graded right now")
        if client is None and not sp.load_key():
            raise LiveError("no Sarvam model key: put SARVAM_API_KEY in .env (the dashboard.sarvam.ai key), then press again")
        todo = [(c["id"], _grade_text(c)) for c in t["calls"] if c["status"] == "done" and c.get("transcript") and not c.get("auto")]
        spent0 = float(t.get("grading_spent_inr") or 0.0)
        _GRADING.add(tid)
    spent, results, error, capped = {"inr": 0.0}, {}, None, False
    try:
        pipe = sp.Pipe(client=client)

        def led(kind, inr, **info):
            spent["inr"] += inr
            sp._add_spend(kind, inr, source="live_call_grading", test=tid, **info)
        for cid, text in todo:
            if spent0 + spent["inr"] + _grade_cost(text) > budget:
                capped = True
                break
            try:
                tag = pipe.tag_text(text, idx=cid, ledger=led)
            except ValueError:                            # the reply could not be read: paid once, marked, not retried
                results[cid] = {"label": "other", "goal_hit": False, "fatal": False, "fatal_kind": "none", "overall_call": None, "evidence": "", "valid": False}
                continue
            except Exception as e:                        # the service did not answer: keep what was graded, say why it stopped
                error = f"Sarvam stopped answering after {len(results)} call(s): {str(e)[:160]}"
                break
            results[cid] = {"label": tag["label"], "goal_hit": tag["label"] == GRADE_GOAL, "fatal": tag["fatal"] != "none", "fatal_kind": tag["fatal"],
                            "overall_call": tag["overall_call"], "evidence": tag["evidence"], "valid": tag["valid"]}
    finally:
        with LOCK:
            _GRADING.discard(tid)
            t = _load(tid)
            for c in t["calls"]:
                if c["id"] in results:
                    c["auto"] = results[c["id"]]
            t["grading_spent_inr"] = round(spent0 + spent["inr"], 4)
            summ = grade_summary(t)
            graded = sum(1 for r in results.values() if r["valid"])
            t["grading"] = {**grade_plan_of(t, budget), "done": True, "graded_now": graded, "unreadable_now": len(results) - graded,
                            "spent_now_inr": round(spent["inr"], 2), "capped": capped, "summary": summ, "error": error}
            if results:
                _log(t, "calls_graded", {"by": "Sarvam chat model (" + sp.LLM_MODEL + ")", "graded": graded, "unreadable": len(results) - graded,
                                         "spent_inr": round(spent["inr"], 4), "agreement": {k: summ[k] for k in ("n", "goal_agree", "fatal_agree")}})
            _save(t)
    return {**t["grading"], "test": public(t)}


def abandon(tid: str, reason: str) -> dict:
    """Stop without a result. Nothing is released; the reason and the number of finished calls are kept in the log."""
    with LOCK:
        t = _load(tid)
        if t["state"] != "running":
            raise LiveError("this test is not running")
        reason = (reason or "").strip()[:200]
        if not reason:
            raise LiveError("say why the test is being abandoned (it is kept in the log)")
        t["state"] = "abandoned"
        _log(t, "test_abandoned", {"reason": reason, "finished_calls": sum(_counts(t).values())})
        _save(t)
        return public(t)


# ---------------------------------------------------------------------------- results out

def export_csv(tid: str) -> str:
    """The finished calls in the shape `python -m canary decide` reads (one row per call). Only after release: no peeking through the export."""
    with LOCK:
        t = _load(tid)
    if t["state"] != "released":
        raise LiveError("the results are exported when the result is released")
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["call_id", "lead_id", "timestamp", "variant", "disposition", "goal_hit", "duration_s", "connected", "fatal", "source", "interaction_id"])
    for c in t["calls"]:
        if c["status"] != "done":
            continue
        cid = f"{t['id']}-{c['id']}"
        w.writerow([cid, cid, c.get("started_at", ""), c["arm"], "good_call" if c["good"] else "not_good", int(c["good"]), c["duration_s"], 1,
                    int(c["fatal"]), c["source"], c.get("interaction_id") or ""])
    return buf.getvalue()


def plan_info(calls_per_arm: int, confidence: float) -> dict:
    """What a choice of threshold can and cannot show; for the setup screen."""
    p = validate_plan({"calls_per_arm": calls_per_arm, "confidence": confidence})
    n, alpha = p["calls_per_arm"], p["alpha"]
    gap = livestats.detectable_gap(n, alpha)
    fw = livestats.false_win_rate(n, alpha)
    return {**p, "total": 2 * n, "detectable_gap": gap, "false_win": fw["b_wins"], "false_call": fw["wrong_call"], "exact": n <= livestats.MAX_EXACT_N}
