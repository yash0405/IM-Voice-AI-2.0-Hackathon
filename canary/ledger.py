"""Append-only, hash-chained decision log.

Every entry stores the exact JSON text that was hashed (`body`), so anyone - Python or the
browser - can re-hash the chain and detect an edited, removed or re-ordered entry.
"""
from __future__ import annotations

import hashlib
import json

GENESIS = "0" * 64


def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=_default)


def _default(o):
    if hasattr(o, "item"):
        return o.item()
    raise TypeError(f"not serialisable: {type(o)}")


def _h(prev: str, body: str) -> str:
    return hashlib.sha256((prev + body).encode()).hexdigest()


class Ledger:
    def __init__(self, clock):
        self.clock = clock
        self.entries: list[dict] = []

    def append(self, etype: str, payload: dict) -> dict:
        prev = self.entries[-1]["hash"] if self.entries else GENESIS
        body = canonical({"seq": len(self.entries), "ts": self.clock(), "type": etype, "payload": payload})
        entry = {"body": body, "prev": prev, "hash": _h(prev, body)}
        self.entries.append(entry)
        return entry

    @property
    def head(self) -> str:
        return self.entries[-1]["hash"] if self.entries else GENESIS


def verify(entries: list[dict]) -> tuple[bool, int | None]:
    """Return (ok, index_of_first_bad_entry)."""
    prev = GENESIS
    for i, e in enumerate(entries):
        if e["prev"] != prev or e["hash"] != _h(prev, e["body"]):
            return False, i
        if json.loads(e["body"])["seq"] != i:
            return False, i
        prev = e["hash"]
    return True, None
