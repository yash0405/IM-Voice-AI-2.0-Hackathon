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
    """Patch operations, applied in this order:
      edit    [{"in_line": text that identifies exactly one line, "find": text inside it, "replace": new text}]  (real prompt lines are long)
      remove  [exact line, ...]
      add     [{"after": exact line, "text": new line}]
    Anything that does not match exactly raises, so a stale patch can never silently change nothing."""
    lines = base_text.splitlines()
    for e in patch.get("edit", []):
        hits = [i for i, l in enumerate(lines) if e["in_line"] in l]
        if len(hits) != 1:
            raise ValueError(f"edit anchor {e['in_line']!r} matches {len(hits)} lines (need exactly 1)")
        if e["find"] not in lines[hits[0]]:
            raise ValueError(f"{e['find']!r} is not in the line identified by {e['in_line']!r}")
        lines[hits[0]] = lines[hits[0]].replace(e["find"], e["replace"], 1)
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
    """Hand-written candidates plus the fix candidate (data/proposal.json: derived from the prompt lint, or drafted by Sarvam)."""
    c = json.loads((DATA / "variants.json").read_text())["candidates"]
    prop = DATA / "proposal.json"
    if prop.exists():
        p = json.loads(prop.read_text())
        c["fix_candidate"] = {"name": p["name"], "origin": p.get("origin", "ai-mined"), "remove": p.get("remove", []), "add": p.get("add", []),
                              "edit": p.get("edit", []), "evidence": p.get("evidence"), "why": p.get("why"), "risk": p.get("risk")}
    return c


RUNTIME: dict = {}          # full prompts pasted in the New Experiment wizard: key -> {"name", "text"} (B candidates "custom_...", live prompts A "live_...")


def register_text(name: str, text: str, prefix: str = "custom_") -> str:
    key = prefix + prompt_hash(text)
    while len(RUNTIME) >= 60 and key not in RUNTIME:        # a long-running host must not grow without bound
        RUNTIME.pop(next(iter(RUNTIME)))
    RUNTIME[key] = {"name": name or "A pasted prompt", "text": text}
    return key


def register_live(name: str, text: str) -> str:
    """The live prompt A as the wizard sent it, when it is not the production prompt in data/ (e.g. 'Production prompt v2')."""
    return register_text(name, text, prefix="live_")


def make_variant(candidate_key: str, against: dict | None = None) -> dict:
    """B's text, hash and diff. `against` ({"text", ...}) is the prompt A the diff is taken against (default: the production prompt in data/)."""
    a_text = (against or load_base())["text"]
    if candidate_key in RUNTIME:
        r = RUNTIME[candidate_key]
        diff = list(difflib.unified_diff(a_text.splitlines(), r["text"].splitlines(), "A (production)", "B (candidate)", lineterm="", n=1))
        return {"key": candidate_key, "name": r["name"], "origin": "human", "text": r["text"], "hash": prompt_hash(r["text"]), "diff": diff[:400], "evidence": None}
    spec = _candidates()[candidate_key]
    base = load_base()
    text = apply_patch(base["text"], spec)
    diff = list(difflib.unified_diff(a_text.splitlines(), text.splitlines(),
                                     "A (production)", "B (candidate)", lineterm="", n=1))
    return {"key": candidate_key, "name": spec["name"], "origin": spec.get("origin", "human"),
            "text": text, "hash": prompt_hash(text), "diff": diff, "evidence": spec.get("evidence")}


def describe_pair(candidate_key: str, a_key: str = "") -> dict:
    """A and B of a test. `a_key` names a live prompt A registered with register_live (""= the production prompt in data/)."""
    if a_key:
        if a_key not in RUNTIME:
            raise ValueError("the live prompt A of this test is no longer held by the server: send it again")
        r = RUNTIME[a_key]
        a = {"name": r["name"], "hash": prompt_hash(r["text"]), "text": r["text"]}
    else:
        base = load_base()
        a = {"name": f"Production prompt {base['version']}", "hash": base["hash"], "text": base["text"]}
    return {"A": a, "B": make_variant(candidate_key, against=a)}
