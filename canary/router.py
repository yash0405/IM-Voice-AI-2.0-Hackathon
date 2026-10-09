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

from . import catalog
from .stats import binom_ci

BLOCK = 100


def block_for(share: float) -> tuple[int, int]:
    """(block size, B slots per block): 10 where the share allows (10%, 20%, 30% ...), else the smallest block that gives the share exactly."""
    for size in (10, 20, 40, 50, 100):
        k = share * size
        if abs(k - round(k)) < 1e-9 and round(k) >= 1:
            return size, int(round(k))
    return 100, max(1, int(round(share * 100)))


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
        self.mix = {n: {v: [0, 0] for v in catalog.VARS[n]["values"]} for n in catalog.BALANCE_VARS}   # leads per value and arm: the balance table

    def _note_mix(self, arm: str, attrs: dict | None):
        if attrs:
            for n in catalog.BALANCE_VARS:
                self.mix[n][attrs[n]][0 if arm == "A" else 1] += 1

    def _next_in_block(self) -> str:
        if not self._block:
            k = round(self.share_b * BLOCK)
            blk = ["B"] * k + ["A"] * (BLOCK - k)
            rng = random.Random(f"{self.exp_id}:{self.salt}:blk{self._block_no}")
            rng.shuffle(blk)
            self._block, self._block_no = blk, self._block_no + 1
        return self._block.pop()

    def assign(self, lead: str, attrs: dict | None = None) -> str:
        arm = self.ledger.get(lead)
        if arm is None:
            if self.mode == "hash":
                arm = "B" if _u(self.exp_id, self.salt, lead) < self.share_b else "A"
            else:
                arm = self._next_in_block()
            self.ledger[lead] = arm
            self.counts[arm] += 1
            self._note_mix(arm, attrs)
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


class StratifiedRouter(Router):
    """The BRD's router: a new lead is dealt into its stratum (Hot Lead type x Nature of Business) from shuffled blocks of 10 (or the smallest
    block that gives the share exactly). Every stratum therefore carries the configured B share to within one block, so A and B end with the
    same mix of lead types. Assignments are remembered, so a lead is sticky: it never changes arm and never sees both prompts.

    Strata too small to fill blocks (expected leads below catalog.MIN_STRATUM) are merged into one "Other" stratum before splitting.
    """

    def __init__(self, exp_id: str, share_b: float, salt: str = "s1", merged: list | None = None):
        super().__init__(exp_id, share_b, salt, "balanced")
        self.mode = "stratified"
        self.size, self.k = block_for(share_b)
        self.merged = set(merged or [])
        self._blocks: dict[str, list] = {}
        self._block_no: dict[str, int] = {}
        self.strata: dict[str, list] = {}          # stratum -> [leads in A, leads in B]
        self.stratum_of: dict[str, str] = {}

    def stratum(self, attrs: dict) -> str:
        label = " x ".join(catalog.stratum_key(attrs))
        return "Other" if label in self.merged else label

    def _deal(self, st: str) -> str:
        blk = self._blocks.get(st)
        if not blk:
            n = self._block_no.get(st, 0)
            blk = ["B"] * self.k + ["A"] * (self.size - self.k)
            random.Random(f"{self.exp_id}:{self.salt}:{st}:blk{n}").shuffle(blk)
            self._block_no[st] = n + 1
            self._blocks[st] = blk
        return blk.pop()

    def assign(self, lead: str, attrs: dict | None = None) -> str:
        arm = self.ledger.get(lead)
        if arm is None:
            if attrs is None:
                raise ValueError("the stratified router needs the lead's variables")
            st = self.stratum(attrs)
            arm = self._deal(st)
            self.ledger[lead] = arm
            self.stratum_of[lead] = st
            self.counts[arm] += 1
            self.strata.setdefault(st, [0, 0])[0 if arm == "A" else 1] += 1
            self._note_mix(arm, attrs)
        self.calls[arm] += 1
        return arm

    def split_report(self, conf: float = 0.95) -> dict:
        r = super().split_report(conf)
        rows = []
        for st, (a, b) in sorted(self.strata.items()):
            n = a + b
            rows.append({"stratum": st, "a": a, "b": b, "share_b": b / n if n else None, "off_slots": round(b - self.share_b * n, 2)})
        r.update({"block": self.size, "b_slots": self.k, "strata": rows, "merged": sorted(self.merged),
                  "max_stratum_off_slots": max((abs(x["off_slots"]) for x in rows), default=0.0)})
        return r


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
