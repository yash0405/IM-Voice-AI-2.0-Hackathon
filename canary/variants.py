"""Prompt variants: a base prompt plus small, reviewable instruction patches."""
from __future__ import annotations

import difflib
import hashlib
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def prompt_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def load_base() -> dict:
    meta = json.loads((DATA / "variants.json").read_text())["base"]
    text = (DATA / meta["file"]).read_text()
    return {"id": meta["id"], "version": meta["version"], "text": text, "hash": prompt_hash(text)}


def apply_patch(base_text: str, patch: dict) -> str:
    lines = base_text.splitlines()
    for rem in patch.get("remove", []):
        if rem not in lines:
            raise ValueError(f"patch removes a line that is not in the base prompt: {rem!r}")
        lines.remove(rem)
    for add in patch.get("add", []):
        anchor = add["after"]
        if anchor not in lines:
            raise ValueError(f"anchor not found: {anchor!r}")
        lines.insert(lines.index(anchor) + 1, add["text"])
    return "\n".join(lines) + "\n"


def _candidates() -> dict:
    """Hand-written candidates plus the AI-drafted fix (data/proposal.json, written by `python -m canary fix propose`)."""
    c = json.loads((DATA / "variants.json").read_text())["candidates"]
    prop = DATA / "proposal.json"
    if prop.exists():
        p = json.loads(prop.read_text())
        c["ai_fix"] = {"name": p["name"], "origin": p.get("origin", "ai-mined"), "remove": p["remove"], "add": p["add"],
                       "evidence": p.get("evidence"), "why": p.get("why"), "risk": p.get("risk")}
    return c


def make_variant(candidate_key: str) -> dict:
    spec = _candidates()[candidate_key]
    base = load_base()
    text = apply_patch(base["text"], spec)
    diff = list(difflib.unified_diff(base["text"].splitlines(), text.splitlines(),
                                     "A (production)", "B (candidate)", lineterm="", n=1))
    return {"key": candidate_key, "name": spec["name"], "origin": spec.get("origin", "human"),
            "text": text, "hash": prompt_hash(text), "diff": diff, "evidence": spec.get("evidence")}


def describe_pair(candidate_key: str) -> dict:
    base = load_base()
    b = make_variant(candidate_key)
    return {"A": {"name": f"Production prompt {base['version']}", "hash": base["hash"], "text": base["text"]},
            "B": b}
