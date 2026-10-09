"""Traffic simulator / replay.

How outcomes are generated (stated on the slide too):
  * Leads arrive at a fixed daily rate; a share of calls are repeat calls from a known lead.
  * Each first call converts with probability true_a (arm A) or true_b (arm B). The difference
    true_b - true_a is the KNOWN effect we inject, so we can check the engine finds it.
  * Call duration is RESAMPLED from the 713 real recordings we were given (header-measured),
    multiplied by dur_mult_b for arm B.
  * log_drop_b models an instrumentation bug: non-converting B calls go missing from the log
    with that probability.
Randomness is pre-drawn per call number, so a run is reproducible from (config, seed).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

DATA = Path(__file__).resolve().parent.parent / "data"


def real_durations() -> np.ndarray:
    rows = json.loads((DATA / "call_durations.json").read_text())
    return np.array([r["duration_s"] for r in rows], dtype=float)


@dataclass
class Scenario:
    key: str
    title: str
    story: str
    expect: str
    true_a: float
    true_b: float
    seed: int
    dur_mult_b: float = 1.0
    log_drop_b: float = 0.0
    repeat_rate: float = 0.12
    event_a: float = 0.0        # optional rate guardrail (e.g. fatal calls): true rate in arm A ...
    event_b: float = 0.0        # ... and in arm B
    cfg: dict = field(default_factory=dict)


class TrafficSim:
    def __init__(self, sc: Scenario):
        self.sc = sc
        self.durs = real_durations()

    def calls_per_day(self, cfg) -> float:
        return cfg.leads_per_day / (1.0 - self.sc.repeat_rate)

    def calls(self, cfg, design):
        sc = self.sc
        rng = np.random.default_rng(sc.seed)
        m = int(3 * design.capacity / (1.0 - sc.repeat_rate)) + 2000
        self._u_out = rng.random(m)
        self._dur = rng.choice(self.durs, size=m)
        self._u_drop = rng.random(m)
        u_rep = rng.random(m)
        u_pick = rng.random(m)
        self._u_evt = rng.random(m)       # drawn last, so adding it leaves every earlier stream (and every earlier result) unchanged
        n_leads = 0
        for i in range(m):
            if n_leads > 0 and u_rep[i] < sc.repeat_rate:
                lead = f"L{int(u_pick[i] * n_leads):07d}"
                yield {"i": i, "lead": lead, "repeat": True}
            else:
                lead = f"L{n_leads:07d}"
                n_leads += 1
                yield {"i": i, "lead": lead, "repeat": False}

    def observe(self, arm: str, call: dict):
        sc, i = self.sc, call["i"]
        p = sc.true_a if arm == "A" else sc.true_b
        converted = 1 if self._u_out[i] < p else 0
        dur = float(self._dur[i]) * (sc.dur_mult_b if arm == "B" else 1.0)
        logged = not (arm == "B" and not converted and self._u_drop[i] < sc.log_drop_b)
        return logged, converted, dur

    def event(self, arm: str, call: dict) -> int:
        """1 if this call has the guardrail event (a fatal call, an early hang-up ...). Used only when a rate guardrail is configured."""
        p = self.sc.event_a if arm == "A" else self.sc.event_b
        return 1 if self._u_evt[call["i"]] < p else 0
