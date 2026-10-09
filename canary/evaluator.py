"""Auto-disposition: tag a call transcript with one outcome.

Three pieces, all runnable with no network:
  RuleEvaluator  - transparent cue-word tagger for Hinglish / English / Devanagari (data/rules.json).
  LLMEvaluator   - same interface, delegates to any `complete(prompt) -> str` function. This is the
                   hook for the Sarvam LLM later; here it is only exercised with a stub in tests.
  metrics()      - accuracy, per-class precision/recall, Cohen's kappa, confusion matrix, sensitivity /
                   specificity of the goal disposition (feeds the evaluator-error study).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .stats import cohen_kappa, wilson

DATA = Path(__file__).resolve().parent.parent / "data"


def load_dispositions() -> list[dict]:
    return json.loads((DATA / "dispositions.json").read_text())["dispositions"]


def load_schema() -> dict:
    return json.loads((DATA / "dispositions.json").read_text())


def goal_info(key: str = "buylead_created") -> dict:
    return next((d for d in load_dispositions() if d["key"] == key), {"key": key, "name": key, "noun": key})


_CLOCK = re.compile(r"\b(within|in|next|agle|is)\s\d{0,3}\s?(day|days|week|weeks|month|months|hafte|hafta|mahine|din)\b")
_QTY = re.compile(r"\b\d{2,6}\s?(pcs|pieces|piece|nos|kg|kgs|ton|tons|meter|meters|mtr|units|unit|boxes|bags|litre|sets|pair|dozen|sqft|sq ft)?\b")


def _norm(text: str) -> str:
    t = text.lower()
    t = re.sub(r"[^\w\s'’ऀ-ॿ]", " ", t)
    return " " + re.sub(r"\s+", " ", t).strip() + " "


class RuleEvaluator:
    """Transparent cue-word tagger for BuyLead qualification calls (Hinglish / English / Devanagari)."""

    FIELDS = ("quantity", "specification", "location", "timeline")

    def __init__(self, rules: dict | None = None):
        self.r = rules or json.loads((DATA / "rules.json").read_text())

    def _hits(self, text: str, cues: list[str]):
        out = []
        for cue in cues:
            c = cue if cue.startswith(" ") else " " + cue
            c = c if c.endswith(" ") else c + " "
            start = 0
            while True:
                i = text.find(c, start)
                if i < 0:
                    break
                out.append((i, cue))
                start = i + 1
        return out

    def _negated(self, text: str, pos: int, cue: str) -> bool:
        before = text[:pos].split()[-3:]
        after = text[pos + len(cue):].split()[:2]
        neg = set(self.r["negators"])
        return any(w in neg for w in before) or any(w in neg for w in after)

    def fields(self, text: str) -> list[str]:
        t = _norm(text)
        got = [f for f in self.FIELDS if self._hits(t, self.r[f])]
        if "quantity" not in got and _QTY.search(t):
            got.append("quantity")
        if "timeline" not in got and _CLOCK.search(t):
            got.append("timeline")
        return [f for f in self.FIELDS if f in got]

    def classify(self, transcript) -> dict:
        if isinstance(transcript, list):
            buyer = [t["text"] for t in transcript if t.get("speaker", "buyer") != "bot"]
            text = " ".join(buyer) if buyer else " ".join(t["text"] for t in transcript)
        else:
            text = str(transcript)
        t = _norm(text)
        words = len(t.split())
        if self._hits(t, self.r["voicemail"]):
            return {"label": "no_connect", "confidence": 0.9, "evidence": text[:80], "fields": []}
        ref, call = self._hits(t, self.r["refuse"]), [h for h in self._hits(t, self.r["callback"]) if not self._negated(t, h[0], h[1])]
        got = self.fields(text)
        n = len(got)
        ev = lambda hits: _snippet(t, hits[0][0]) if hits else ""
        if words < 4 and not ref:
            return {"label": "no_connect", "confidence": 0.7, "evidence": text[:80], "fields": got}
        if ref and n < 2:
            return {"label": "not_interested", "confidence": 0.8, "evidence": ev(ref), "fields": got}
        if n >= 3:
            return {"label": "buylead_created", "confidence": 0.8, "evidence": ", ".join(got), "fields": got}
        if call and n < 2:
            return {"label": "callback_fixed", "confidence": 0.7, "evidence": ev(call), "fields": got}
        if n >= 1:
            return {"label": "partial", "confidence": 0.6, "evidence": ", ".join(got), "fields": got}
        return {"label": "other", "confidence": 0.4, "evidence": "", "fields": got}


def _snippet(t: str, pos: int, w: int = 40) -> str:
    return t[max(0, pos - w): pos + w].strip()


PROMPT = DATA / "evaluator_prompt.md"


class LLMEvaluator:
    """Plug a model in with `complete(prompt)->str`. Expected reply: JSON {"label","evidence"}."""

    def __init__(self, complete):
        self.complete = complete

    def classify(self, transcript) -> dict:
        text = transcript if isinstance(transcript, str) else "\n".join(f"{t.get('speaker','?')}: {t['text']}" for t in transcript)
        disp = "\n".join(f"- {d['key']}: {d['hint']}" for d in load_dispositions())
        prompt = PROMPT.read_text().replace("{{DISPOSITIONS}}", disp).replace("{{TRANSCRIPT}}", text)
        raw = self.complete(prompt)
        m = re.search(r"\{.*\}", raw, re.S)
        keys = {d["key"] for d in load_dispositions()}
        try:
            obj = json.loads(m.group(0)) if m else {}
        except json.JSONDecodeError:
            obj = {}
        label = obj.get("label") if obj.get("label") in keys else "other"
        return {"label": label, "confidence": 0.5, "evidence": str(obj.get("evidence", ""))[:160]}


def metrics(y_true: list, y_pred: list, goal: str = "buylead_created") -> dict:
    n = len(y_true)
    labels = sorted(set(y_true) | set(y_pred))
    correct = sum(1 for a, b in zip(y_true, y_pred) if a == b)
    lo, hi = wilson(correct, n)
    per = {}
    for l in labels:
        tp = sum(1 for a, b in zip(y_true, y_pred) if a == l and b == l)
        fp = sum(1 for a, b in zip(y_true, y_pred) if a != l and b == l)
        fn = sum(1 for a, b in zip(y_true, y_pred) if a == l and b != l)
        p = tp / (tp + fp) if tp + fp else None
        r = tp / (tp + fn) if tp + fn else None
        per[l] = {"precision": p, "recall": r, "support": tp + fn}
    conf = {a: {b: sum(1 for x, y in zip(y_true, y_pred) if x == a and y == b) for b in labels} for a in labels}
    pos = [a == goal for a in y_true]
    pp = [b == goal for b in y_pred]
    tp = sum(1 for a, b in zip(pos, pp) if a and b); fn = sum(1 for a, b in zip(pos, pp) if a and not b)
    tn = sum(1 for a, b in zip(pos, pp) if not a and not b); fp = sum(1 for a, b in zip(pos, pp) if not a and b)
    return {"n": n, "accuracy": correct / n if n else None, "accuracy_ci": [lo, hi],
            "kappa": cohen_kappa(list(y_true), list(y_pred)), "per_class": per, "confusion": conf,
            "goal": goal, "sensitivity": tp / (tp + fn) if tp + fn else None,
            "specificity": tn / (tn + fp) if tn + fp else None}
