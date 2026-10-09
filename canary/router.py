"""Sticky traffic routing.

Two assignment modes, both random-looking, both sticky (a lead never changes arm):

* "hash"     - stateless. arm = f(sha256(exp:salt:lead)). Two servers always agree.
               The achieved split is binomial, so it wobbles around the target.
* "balanced" - permuted blocks over first-seen leads, remembered in a ledger. The achieved
               split stays within one block of the target at every moment.

NaiveRouter is the "typical" implementation (coin flip per call) used as a baseline.
"""
from __future__ import annotations

import hashlib
import random

from .stats import binom_ci

BLOCK = 100


def _u(exp_id: str, salt: str, lead: str) -> float:
    h = hashlib.sha256(f"{exp_id}:{salt}:{lead}".encode()).digest()
    return int.from_bytes(h[:8], "big") / 2 ** 64


class Router:
    def __init__(self, exp_id: str, share_b: float, salt: str = "s1", mode: str = "balanced"):
        if not 0 < share_b < 1:
            raise ValueError("share_b must be in (0, 1)")
        if mode not in ("hash", "balanced"):
            raise ValueError("mode must be 'hash' or 'balanced'")
        self.exp_id, self.share_b, self.salt, self.mode = exp_id, share_b, salt, mode
        self.ledger: dict[str, str] = {}
        self._block: list[str] = []
        self._block_no = 0
        self.counts = {"A": 0, "B": 0}      # distinct leads per arm
        self.calls = {"A": 0, "B": 0}       # all calls per arm (incl. repeats)

    def _next_in_block(self) -> str:
        if not self._block:
            k = round(self.share_b * BLOCK)
            blk = ["B"] * k + ["A"] * (BLOCK - k)
            rng = random.Random(f"{self.exp_id}:{self.salt}:blk{self._block_no}")
            rng.shuffle(blk)
            self._block, self._block_no = blk, self._block_no + 1
        return self._block.pop()

    def assign(self, lead: str) -> str:
        arm = self.ledger.get(lead)
        if arm is None:
            if self.mode == "hash":
                arm = "B" if _u(self.exp_id, self.salt, lead) < self.share_b else "A"
            else:
                arm = self._next_in_block()
            self.ledger[lead] = arm
            self.counts[arm] += 1
        self.calls[arm] += 1
        return arm

    def split_report(self, conf: float = 0.95) -> dict:
        n = self.counts["A"] + self.counts["B"]
        achieved = self.counts["B"] / n if n else float("nan")
        lo, hi = binom_ci(self.counts["B"], n, conf) if n else (float("nan"),) * 2
        return {"mode": self.mode, "configured_b": self.share_b, "achieved_b": achieved,
                "n_leads": n, "n_a": self.counts["A"], "n_b": self.counts["B"], "calls_a": self.calls["A"], "calls_b": self.calls["B"],
                "abs_error_pp": (achieved - self.share_b) * 100 if n else float("nan"),
                "binomial_ci": [lo, hi],
                "within_chance_band": bool(lo <= self.share_b <= hi) if n else True}


class NaiveRouter:
    """Typical implementation: independent coin flip on every call. Not sticky."""

    def __init__(self, share_b: float, seed: int = 0):
        self.share_b, self.rng = share_b, random.Random(seed)
        self.first: dict[str, str] = {}
        self.flips = 0
        self.repeat_calls = 0

    def assign(self, lead: str) -> str:
        arm = "B" if self.rng.random() < self.share_b else "A"
        if lead in self.first:
            self.repeat_calls += 1
            if self.first[lead] != arm:
                self.flips += 1
        else:
            self.first[lead] = arm
        return arm
