"""Auto-label the call recordings with the Sarvam platform, spending as little credit as possible.

    python -m canary autolabel plan   --n 100                 # free: shows the cost, spends nothing
    python -m canary autolabel run    --n 5   --budget 10 --yes   # pilot
    python -m canary autolabel run    --n 100 --budget 70 --yes   # first real sample
    python -m canary autolabel status                          # free: counts and estimated spend
    python -m canary autolabel queue                           # free: picks the calls a human should check
    python -m canary autolabel report                          # free: conversion rate, accuracy

Pipeline per call:  audio -> Sarvam Saaras batch speech-to-text -> Sarvam chat model tagger -> label file.
Credit protection (every rule is tested):
  * nothing is spent without --yes; `plan` and `status` never call the API
  * a hard --budget in rupees: a batch that would cross it is not started
  * calls are processed in ONE fixed random order, so any prefix is a representative random sample and
    stopping early loses nothing
  * every transcript and label is cached on disk; a re-run never pays twice for the same call
  * failures are recorded and NOT retried automatically
  * the model runs at temperature 0 with a short output cap
Customer data: audio goes only to Sarvam (the provided platform); transcripts and labels stay in data/.
The code prints counts and rupees, never transcript text.
"""
from __future__ import annotations

import json
import math
import os
from collections import Counter
import random
import re
import tempfile
import time
from pathlib import Path

from .evaluator import PROMPT, load_dispositions, load_schema
from .stats import wilson

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TR, AL = DATA / "transcripts", DATA / "auto_labels"
RAW = DATA / "transcripts_raw"
DL = DATA / "sarvam_dl"          # every downloaded batch output is kept, so parsing fixes never cost a second call
SPEND, QUEUE = DATA / "sarvam_spend.json", DATA / "review_queue.json"
REC = ROOT.parent / "Resources" / "call_recordings"

# Prices from sarvam.ai/api-pricing (INR). Re-check before a large run.
STT_INR_PER_HOUR = 30.0              # batch, no diarization
STT_INR_PER_HOUR_DIAR = 45.0         # batch with speaker diarization
LLM_IN_INR_PER_M, LLM_OUT_INR_PER_M = 29.28, 73.20     # sarvam-105b
STT_MODEL, STT_MODE, STT_LANG = "saaras:v4", "codemix", "unknown"
LLM_MODEL = "sarvam-105b"
CHUNK = 20                           # batch API limit: 20 files per job
LLM_GAP_S = 1.7                      # 105B is limited to ~40 requests/minute on the starter plan
EST_PROMPT_TOKENS, EST_OUT_TOKENS = 1300, 350   # planning estimate for the LLM step only (thinking switched off)


class BudgetExceeded(RuntimeError):
    pass


def load_key() -> str | None:
    key = os.environ.get("SARVAM_API_KEY")
    if key:
        return key.strip()
    for f in (ROOT / ".env", ROOT.parent / ".env"):
        if f.exists():
            for line in f.read_text().splitlines():
                m = re.match(r"\s*SARVAM_API_KEY\s*=\s*['\"]?([^'\"\s]+)", line)
                if m:
                    return m.group(1)
    return None


def order() -> list[dict]:
    rows = sorted(json.loads((DATA / "call_durations.json").read_text()), key=lambda r: r["idx"])
    random.Random(713).shuffle(rows)         # fixed: any prefix is a random sample
    return rows


def _load_spend() -> dict:
    if SPEND.exists():
        return json.loads(SPEND.read_text())
    return {"stt_seconds": 0.0, "llm_in": 0, "llm_out": 0, "inr": 0.0, "events": []}


def _save_spend(s: dict) -> None:
    SPEND.write_text(json.dumps(s, indent=1))


def _add_spend(kind: str, inr: float, **info) -> dict:
    s = _load_spend()
    s["inr"] = round(s["inr"] + inr, 4)
    if kind == "stt":
        s["stt_seconds"] += info.get("seconds", 0)
    else:
        s["llm_in"] += info.get("in", 0); s["llm_out"] += info.get("out", 0)
    s["events"].append({"ts": int(time.time()), "kind": kind, "inr": round(inr, 4), **info})
    _save_spend(s)
    return s


def stt_cost(seconds: float, diarize: bool = False) -> float:
    return seconds / 3600.0 * (STT_INR_PER_HOUR_DIAR if diarize else STT_INR_PER_HOUR)


def llm_cost(tok_in: int, tok_out: int) -> float:
    return tok_in / 1e6 * LLM_IN_INR_PER_M + tok_out / 1e6 * LLM_OUT_INR_PER_M


def plan(n: int, diarize: bool = False) -> dict:
    """Free. What would it cost to have the first n calls transcribed and tagged?"""
    rows = order()[:n]
    need_t = [r for r in rows if not (TR / f"{r['idx']}.json").exists()]
    need_l = [r for r in rows if not (AL / f"{r['idx']}.json").exists()]
    sec = sum(r["duration_s"] for r in need_t)
    stt, llm = stt_cost(sec, diarize), llm_cost(len(need_l) * EST_PROMPT_TOKENS, len(need_l) * EST_OUT_TOKENS)
    spent = _load_spend()["inr"]
    return {"calls": n, "to_transcribe": len(need_t), "audio_minutes": round(sec / 60, 1), "stt_inr": round(stt, 2),
            "to_tag": len(need_l), "llm_inr": round(llm, 2), "total_inr": round(stt + llm, 2), "already_spent_inr": round(spent, 2),
            "pricing": f"STT Rs {STT_INR_PER_HOUR}/h, LLM Rs {LLM_IN_INR_PER_M}/{LLM_OUT_INR_PER_M} per 1M tokens (in/out)"}


def _pick_text(doc: dict) -> str:
    for k in ("transcript", "text"):
        if isinstance(doc.get(k), str) and doc[k].strip():
            return doc[k].strip()
    ent = (doc.get("diarized_transcript") or {}).get("entries") or []
    return " ".join(e.get("transcript", "") for e in ent).strip()


def _pick_diarized(doc: dict) -> str:
    """One line per speaker turn, so the tagger can tell the bot from the buyer."""
    ent = (doc.get("diarized_transcript") or {}).get("entries") or []
    lines = [f"[Speaker {e.get('speaker_id', '?')}] {str(e.get('transcript', '')).strip()}" for e in ent if str(e.get("transcript", "")).strip()]
    return "\n".join(lines)


class Pipe:
    def __init__(self, client=None, sleep=time.sleep, diarize: bool = False):
        if client is None:
            key = load_key()
            if not key:
                raise SystemExit("No Sarvam key found. Put SARVAM_API_KEY=... in canary/.env (or export it), then re-run.")
            from sarvamai import SarvamAI
            client = SarvamAI(api_subscription_key=key)
        self.client, self.sleep, self.diarize = client, sleep, diarize
        TR.mkdir(parents=True, exist_ok=True); AL.mkdir(parents=True, exist_ok=True); RAW.mkdir(parents=True, exist_ok=True)

    # -------------------------------------------------------------- speech-to-text
    def transcribe(self, n: int, budget: float) -> dict:
        bad_before = json.loads((DATA / "transcripts_failed.json").read_text()) if (DATA / "transcripts_failed.json").exists() else {}
        rows = [r for r in order()[:n] if not (TR / f"{r['idx']}.json").exists() and str(r["idx"]) not in bad_before]
        done = failed = 0
        for i in range(0, len(rows), CHUNK):
            chunk = rows[i:i + CHUNK]
            cost = stt_cost(sum(r["duration_s"] for r in chunk), self.diarize)
            spent = _load_spend()["inr"]
            if spent + cost > budget:
                print(f"STOP: next batch (~Rs {cost:.2f}) would take spending to Rs {spent + cost:.2f}, over the Rs {budget:.2f} budget.")
                break
            ok, bad = self._chunk(chunk, cost)
            done += ok; failed += bad
            print(f"transcribed {done} calls so far ({failed} failed), spent about Rs {_load_spend()['inr']:.2f}")
        return {"transcribed": done, "failed": failed, "spent_inr": _load_spend()["inr"]}

    def _chunk(self, chunk: list[dict], cost: float) -> tuple[int, int]:
        job = self.client.speech_to_text_job.create_job(model=STT_MODEL, mode=STT_MODE, language_code=STT_LANG,
                                                        with_diarization=self.diarize, num_speakers=2 if self.diarize else None, with_timestamps=False)
        job.upload_files([str(REC / r["file"]) for r in chunk])
        job.start()
        jid = str(getattr(job, "job_id", "") or "job")
        _add_spend("stt", cost, seconds=sum(r["duration_s"] for r in chunk), files=len(chunk), job=jid)   # charged from here on
        job.wait_until_complete(poll_interval=10, timeout=1800)
        if not job.is_successful():
            self._note_failed([r["idx"] for r in chunk], "job failed")
            return 0, len(chunk)
        dl = DL / jid
        dl.mkdir(parents=True, exist_ok=True)
        job.download_outputs(str(dl))
        files = [p for p in dl.rglob("*") if p.is_file()]
        try:
            maps = job.get_output_mappings()
        except Exception:
            maps = []
        self._debug({"job": jid, "files_downloaded": [p.name for p in files], "mappings": maps[:3], "n_inputs": len(chunk)})
        for r in chunk:
            out = self._match(r, files, maps, single=(len(chunk) == 1))
            if out is None:
                continue
            doc = self._read(out)
            (RAW / f"{r['idx']}.json").write_text(json.dumps(doc, ensure_ascii=False))     # local only
            text = (_pick_diarized(doc) if self.diarize else "") or _pick_text(doc)
            if text or ("transcript" in doc and not (doc.get("transcript") or "").strip()):    # empty = silence, a real result
                (TR / f"{r['idx']}.json").write_text(json.dumps({"idx": r["idx"], "duration_s": r["duration_s"], "engine": f"sarvam {STT_MODEL}" + (" diarized" if self.diarize else ""),
                                                                  "language": doc.get("language_code"), "text": text}, ensure_ascii=False))
        missing = [r["idx"] for r in chunk if not (TR / f"{r['idx']}.json").exists()]
        if missing:
            self._note_failed(missing, "no transcript returned")
        return len(chunk) - len(missing), len(missing)

    @staticmethod
    def _match(r: dict, files: list[Path], maps: list[dict], single: bool):
        stem, name = Path(r["file"]).stem, Path(r["file"]).name
        for m in maps:                                            # 1. the API's own input -> output mapping
            if Path(str(m.get("input_file", ""))).name == name:
                for p in files:
                    if p.name == Path(str(m.get("output_file", ""))).name:
                        return p
        for p in files:                                           # 2. output name contains the input name
            if name in p.name or stem in p.name:
                return p
        return files[0] if (single and len(files) == 1) else None  # 3. one input, one output

    @staticmethod
    def _read(path: Path) -> dict:
        raw = path.read_text(errors="replace")
        try:
            d = json.loads(raw)
            return d if isinstance(d, dict) else {"transcript": " ".join(map(str, d))} if isinstance(d, list) else {"transcript": str(d)}
        except json.JSONDecodeError:
            return {"transcript": raw}

    @staticmethod
    def _debug(info: dict):
        f = DATA / "sarvam_debug.json"
        cur = json.loads(f.read_text()) if f.exists() else []
        cur.append({"ts": int(time.time()), **info})
        f.write_text(json.dumps(cur[-20:]))

    @staticmethod
    def _note_failed(idxs, why):
        f = DATA / "transcripts_failed.json"
        cur = json.loads(f.read_text()) if f.exists() else {}
        for i in idxs:
            cur[str(i)] = why
        f.write_text(json.dumps(cur))

    # -------------------------------------------------------------- tagging
    def tag(self, n: int, budget: float) -> dict:
        rows = [r for r in order()[:n] if (TR / f"{r['idx']}.json").exists() and not (AL / f"{r['idx']}.json").exists()]
        done = bad = 0
        for r in rows:
            if _load_spend()["inr"] + llm_cost(EST_PROMPT_TOKENS, EST_OUT_TOKENS) > budget:
                print("STOP: budget reached before tagging finished.")
                break
            try:
                self._tag_one(r)
                done += 1
            except Exception as e:                      # never retry blindly: report once and move on
                bad += 1
                (AL / f"{r['idx']}.json").write_text(json.dumps({"idx": r["idx"], "error": type(e).__name__}))
            self.sleep(LLM_GAP_S)
        return {"tagged": done, "failed": bad, "spent_inr": _load_spend()["inr"]}

    def _tag_one(self, r: dict) -> None:
        text = json.loads((TR / f"{r['idx']}.json").read_text())["text"]
        if not text.strip():           # silence: a certain, free label (no model call, no tokens)
            (AL / f"{r['idx']}.json").write_text(json.dumps({"idx": r["idx"], "label": "no_connect", "fields": [], "captured": {},
                "language": None, "call_end": "no_response", "sentiment": None, "buyer_requests": [], "bot_issues": [], "fatal": "none",
                "bot_error": False, "fix_hint": None, "confidence": 0.95, "evidence": "empty transcript", "valid": True,
                "rule": "empty_transcript", "tokens": {"in": 0, "out": 0}, "finish": None}))
            return
        out = self.tag_text(text, r["idx"])
        (AL / f"{r['idx']}.json").write_text(json.dumps(out, ensure_ascii=False))

    def tag_text(self, text: str, idx=None, ledger=None) -> dict:
        """Tag one transcript with the Sarvam chat model (thinking off). Returns the rich label dict."""
        disp = "\n".join(f"- {d['key']}: {d['hint']}" for d in load_dispositions())
        bi = ", ".join(load_schema()["taxonomy"]["bot_issues"])
        prompt = PROMPT.read_text().replace("{{DISPOSITIONS}}", disp).replace("{{BOT_ISSUES}}", bi).replace("{{TRANSCRIPT}}", text)
        resp, tries = None, 0
        while resp is None:
            try:
                resp = self.client.chat.completions(model=LLM_MODEL, temperature=0.0, max_tokens=900, reasoning_effort=None,
                                                    messages=[{"role": "user", "content": prompt}])
            except Exception as e:
                tries += 1
                if "429" in str(e) and tries <= 3:
                    self.sleep(20 * tries); continue
                raise
        u = getattr(resp, "usage", None)
        tin, tout = (getattr(u, "prompt_tokens", 0) or 0), (getattr(u, "completion_tokens", 0) or 0)
        (ledger or _add_spend)("llm", llm_cost(tin, tout), **{"in": tin, "out": tout})
        raw = resp.choices[0].message.content or ""
        m = re.search(r"\{.*\}", raw, re.S)
        obj = json.loads(m.group(0)) if m else {}
        sch = load_schema(); tx = sch["taxonomy"]
        keys = {d["key"] for d in sch["dispositions"]}
        fk = {f["key"] for f in sch["fields"]}
        label = obj.get("label") if obj.get("label") in keys else "other"
        issues = [i for i in (obj.get("bot_issues") or []) if i in tx["bot_issues"]]
        fatal = obj.get("fatal") if obj.get("fatal") in tx["fatal"] else "none"
        cap = obj.get("captured") if isinstance(obj.get("captured"), dict) else {}
        pick = lambda v, allowed, default=None: v if v in allowed else default
        out = {"idx": idx, "label": label, "fields": [f for f in (obj.get("fields") or []) if f in fk],
               "captured": {k: (str(cap[k])[:60] if cap.get(k) else None) for k in tx["captured"]},
               "language": pick(obj.get("language"), tx["language"]), "call_end": pick(obj.get("call_end"), tx["call_end"]),
               "sentiment": pick(obj.get("sentiment"), tx["sentiment"]),
               "buyer_requests": [x for x in (obj.get("buyer_requests") or []) if x in tx["buyer_requests"]],
               "bot_issues": issues, "fatal": fatal, "bot_error": bool(issues) or fatal != "none",
               "fix_hint": (str(obj["fix_hint"])[:160] if obj.get("fix_hint") and issues else None),
               "confidence": _num(obj.get("confidence"), 0.5), "evidence": str(obj.get("evidence", ""))[:120],
               "valid": bool(m and obj.get("label") in keys),
               "tokens": {"in": tin, "out": tout}, "finish": getattr(resp.choices[0], "finish_reason", None)}
        if not out["valid"]:
            out["raw_reply"] = raw[:600]
        return out


def _num(x, default):
    try:
        return max(0.0, min(1.0, float(x)))
    except (TypeError, ValueError):
        return default


# ------------------------------------------------------------------ queue, status, report (all free)
def labelled() -> list[dict]:
    out = []
    for f in sorted(AL.glob("*.json")) if AL.exists() else []:
        d = json.loads(f.read_text())
        if d.get("valid"):
            out.append(d)
    return out


def make_queue(n_blind: int = 30, n_hard: int = 10, seed: int = 99) -> dict:
    """Which calls should a human check? A random BLIND set (unbiased accuracy) plus the least-confident ones."""
    L = labelled()
    rng = random.Random(seed)
    pool = L[:]; rng.shuffle(pool)
    blind = pool[:n_blind]
    taken = {d["idx"] for d in blind}
    hard = sorted([d for d in L if d["idx"] not in taken], key=lambda d: (d["confidence"], d["idx"]))[:n_hard]
    q = {"blind": [d["idx"] for d in blind], "hard": [d["idx"] for d in hard]}
    QUEUE.write_text(json.dumps(q))
    return q


def status() -> dict:
    s = _load_spend()
    nt = len(list(TR.glob("*.json"))) if TR.exists() else 0
    nl = len(labelled())
    arena = DATA / "arena_spend.json"
    a_inr = json.loads(arena.read_text())["inr"] if arena.exists() else 0.0
    return {"transcripts": nt, "tagged_valid": nl, "estimated_spend_inr": round(s["inr"] + a_inr, 2), "arena_spend_inr": round(a_inr, 2),
            "audio_minutes_sent": round(s["stt_seconds"] / 60, 1), "llm_tokens": {"in": s["llm_in"], "out": s["llm_out"]}}


def report() -> dict:
    """Free. Machine-label results, checked against human labels where they exist."""
    from . import labels as human
    from .evaluator import metrics
    L = labelled()
    out = {"machine_labelled": len(L)}
    if not L:
        return out
    goal = "buylead_created"
    dist = Counter(d["label"] for d in L)
    k, n = dist.get(goal, 0), len(L)
    lo, hi = wilson(k, n)
    out["distribution"] = dict(dist)
    out["buylead_rate_machine"] = {"rate": k / n, "ci": [lo, hi], "n": n}
    out["bot_error_rate_machine"] = sum(1 for d in L if d["bot_error"]) / n
    # The strict goal label needs quantity + specification + (location or timeline). IndiaMART's "BL conversion" is probably closer to this
    # looser reading, which is the one that matches the stated 35-60% benchmark. Confirm the official definition with the organisers.
    loose = sum(1 for d in L if {"quantity", "specification"} <= set(d.get("fields", [])))
    llo, lhi = wilson(loose, n)
    out["buylead_rate_loose"] = {"rate": loose / n, "ci": [llo, lhi], "n": n, "definition": "quantity AND specification captured"}
    conn = [d for d in L if d["label"] != "no_connect"]
    if conn:
        out["capture_connected"] = {"n": len(conn), **{f: sum(1 for d in conn if f in d.get("fields", [])) / len(conn) for f in ("quantity", "specification", "location", "timeline")}}
    got = [d for d in L if d["label"] in (goal, "partial")]
    if got:
        out["field_capture_machine"] = {f["key"]: sum(1 for d in got if f["key"] in d["fields"]) / len(got) for f in load_schema()["fields"]}
    out["rich"] = {
        "fatal": dict(Counter(d.get("fatal", "none") for d in L)),
        "bot_issue_counts": dict(Counter(i for d in L for i in d.get("bot_issues", [])).most_common()),
        "bot_issue_rate": sum(1 for d in L if d.get("bot_issues")) / n,
        "call_end": dict(Counter(d.get("call_end") for d in L if d.get("call_end"))),
        "sentiment": dict(Counter(d.get("sentiment") for d in L if d.get("sentiment"))),
        "language": dict(Counter(d.get("language") for d in L if d.get("language"))),
        "buyer_requests": dict(Counter(x for d in L for x in d.get("buyer_requests", [])).most_common()),
    }
    q = json.loads(QUEUE.read_text()) if QUEUE.exists() else {"blind": [], "hard": []}
    human_lab = human.consensus_labels()
    mach = {d["idx"]: d["label"] for d in L}
    for name, ids in (("blind", q["blind"]), ("all_checked", q["blind"] + q["hard"])):
        both = [i for i in ids if i in human_lab and i in mach]
        if both:
            m = metrics([human_lab[i] for i in both], [mach[i] for i in both], goal)
            out[f"tagger_vs_human_{name}"] = {"n": len(both), "accuracy": m["accuracy"], "accuracy_ci": m["accuracy_ci"],
                                              "sensitivity": m["sensitivity"], "specificity": m["specificity"]}
    b = out.get("tagger_vs_human_blind")
    if b and b["sensitivity"] is not None and b["specificity"] is not None and b["sensitivity"] + b["specificity"] > 1.05:
        se, sp = b["sensitivity"], b["specificity"]
        out["buylead_rate_corrected"] = {"rate": max(0.0, min(1.0, (out["buylead_rate_machine"]["rate"] + sp - 1) / (se + sp - 1))),
                                         "note": "machine rate corrected with the measured sensitivity/specificity (Rogan-Gladen); approximate"}
    return out


def auto_info() -> dict:
    """Free, read-only summary for the dashboard."""
    try:
        q = json.loads(QUEUE.read_text()) if QUEUE.exists() else {"blind": [], "hard": []}
        return {"status": status(), "queue": {k: len(v) for k, v in q.items()}, "report": report(), "key_present": bool(load_key())}
    except Exception as e:           # never break the dashboard
        return {"error": type(e).__name__}


def backlog() -> dict:
    """Free. Group the machine's bot-issue findings into a fix backlog (data/fix_backlog.json, local only).
    Each entry: how many calls, which calls, and the suggested prompt instructions. For a later fix loop (Problem 1)."""
    L = labelled()
    g: dict[str, dict] = {}
    for d in L:
        for i in d.get("bot_issues", []):
            e = g.setdefault(i, {"count": 0, "calls": [], "hints": []})
            e["count"] += 1; e["calls"].append(d["idx"])
            if d.get("fix_hint"):
                e["hints"].append(d["fix_hint"])
    out = {"calls_analysed": len(L), "issues": dict(sorted(g.items(), key=lambda kv: -kv[1]["count"]))}
    (DATA / "fix_backlog.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    return {"calls_analysed": len(L), "issue_counts": {k: v["count"] for k, v in out["issues"].items()}}
