"""Tagger-free loop detector: how often does a speaker say (nearly) the same thing again and again?

IndiaMART's call-quality matrix grades "Looping Behavior" as fatal when a parameter is probed more than 1+2 times. Here that is measured
directly on the transcripts, with no language model: a cluster of near-identical turns by one speaker is a loop.

Limits, stated up front:
  * It only sees VERBATIM-ish repeats. VANI's prompt tells it to vary its wording on each retry, so a loop made of rephrased questions
    is invisible here. The rates are therefore LOWER BOUNDS.
  * Transcripts are speech-to-text with speaker separation; which speaker is the bot is not given. We attribute a loop to the speaker
    with the longer turns on average (the bot speaks in full sentences) and report loops by either speaker separately.
It reads transcripts in code. No transcript text is returned or printed, only counts.
"""
from __future__ import annotations

import json
import re
from difflib import SequenceMatcher

from . import sarvam_pipe as sp

REPEAT_RATIO = 0.82          # two turns this similar count as the same thing said again
MIN_WORDS = 4                # ignore one-word turns ("haan", "hello")
LOOP_AT = 4                  # said 4 times = asked more than 1+2 times, the matrix's fatal threshold
REPEAT_AT = 3                # said 3 times = at the limit


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", t.lower())).strip()


def parse(text: str) -> list[tuple[str, str]]:
    out = []
    for line in text.splitlines():
        m = re.match(r"\[Speaker (\S+)\]\s*(.*)", line)
        if m and m.group(2).strip():
            out.append((m.group(1), m.group(2).strip()))
    return out


def biggest_cluster(turns: list[str]) -> int:
    """Largest set of near-identical turns, among turns of at least MIN_WORDS words."""
    norm = [_norm(t) for t in turns if len(t.split()) >= MIN_WORDS]
    best = 1 if norm else 0
    for i, a in enumerate(norm):
        n = 1
        for j, b in enumerate(norm):
            if i != j and abs(len(a) - len(b)) <= 0.35 * max(len(a), len(b)) and SequenceMatcher(None, a, b).ratio() >= REPEAT_RATIO:
                n += 1
        best = max(best, n)
    return best


def scan_text(text: str) -> dict:
    turns = parse(text)
    spk: dict[str, list[str]] = {}
    for s, t in turns:
        spk.setdefault(s, []).append(t)
    if not spk:
        return {"turns": 0, "bot_cluster": 0, "other_cluster": 0, "loop": False, "repeat": False}
    # the bot is the speaker with the longer turns on average
    bot = max(spk, key=lambda s: sum(len(t.split()) for t in spk[s]) / len(spk[s]))
    bc = biggest_cluster(spk[bot])
    oc = max([biggest_cluster(v) for s, v in spk.items() if s != bot] or [0])
    return {"turns": len(turns), "bot_cluster": bc, "other_cluster": oc, "loop": bc >= LOOP_AT, "repeat": bc >= REPEAT_AT,
            "any_loop": max(bc, oc) >= LOOP_AT}


def scan_all() -> dict[int, dict]:
    out = {}
    for f in sorted(sp.TR.glob("*.json")):
        d = json.loads(f.read_text())
        out[int(d["idx"])] = scan_text(d.get("text") or "")
    return out


def summary() -> dict | None:
    """Free. Loop rates over the transcribed calls, and how they relate to the machine labels (aggregates only)."""
    from .stats import wilson, pooled_z, norm_cdf
    R = scan_all()
    if not R:
        return None
    L = {d["idx"]: d for d in sp.labelled()}
    talk = {i: r for i, r in R.items() if r["turns"] >= 4}              # calls where anyone actually spoke
    n = len(talk)

    def rate(k):
        c = sum(1 for r in talk.values() if r[k])
        return {"n": c, "rate": round(c / n, 4) if n else 0.0, "ci": [round(x, 4) for x in wilson(c, n)] if n else [0, 0]}
    out = {"calls_scanned": len(R), "calls_with_speech": n, "bot_loop": rate("loop"), "bot_repeat3": rate("repeat"), "any_loop": rate("any_loop"),
           "limits": f"near-identical turns (similarity >= {REPEAT_RATIO}), at least {MIN_WORDS} words; loop = said {LOOP_AT}+ times; lower bound"}
    # relation to the (provisional) conversion label: quantity AND specification captured
    both = [(r, L[i]) for i, r in talk.items() if i in L]
    if both:
        conv = lambda d: {"quantity", "specification"} <= set(d.get("fields") or [])
        yes = [conv(d) for r, d in both if r["repeat"]]
        no = [conv(d) for r, d in both if not r["repeat"]]
        if yes and no:
            ky, kn = sum(yes), sum(no)
            z = pooled_z(kn, len(no), ky, len(yes))
            out["repeat3_vs_conversion"] = {"with": {"n": len(yes), "converted": round(ky / len(yes), 4)}, "without": {"n": len(no), "converted": round(kn / len(no), 4)},
                                            "p_value": round(2 * (1 - norm_cdf(abs(z))), 4)}
        # agreement with the language model's own loop flags
        flag = lambda d: bool({"stuck_loop", "repeated_question", "looping_behavior"} & set(d.get("bot_issues") or []))
        a = sum(1 for r, d in both if r["repeat"] and flag(d)); b = sum(1 for r, d in both if r["repeat"] and not flag(d))
        c = sum(1 for r, d in both if not r["repeat"] and flag(d)); dd = sum(1 for r, d in both if not r["repeat"] and not flag(d))
        out["vs_machine_loop_flag"] = {"both": a, "scan_only": b, "machine_only": c, "neither": dd}
    return out
