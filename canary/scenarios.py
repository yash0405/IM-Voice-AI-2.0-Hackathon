"""The demo scenarios. Truths (true_a, true_b, ...) are injected; everything else is measured.

Baseline 45% BuyLead conversion sits inside the 35-60% benchmark we were told about and inside the 42-53% range
measured on the real calls (provisional machine labels)."""
from __future__ import annotations

from .engine import Config
from .simulator import Scenario, TrafficSim

BASE = dict(share_b=0.10, baseline=0.45, mde=0.07, window_days=14, leads_per_day=600)

SCENARIOS = {
    "b_wins": Scenario(
        key="b_wins", title="B wins and is promoted",
        story="A candidate edit really lifts BuyLead conversion from 45% to 52% (known truth).",
        expect="PROMOTE", true_a=0.45, true_b=0.52, seed=11,
        cfg=dict(exp_id="exp-win", name="Candidate edit that really helps", variant_b="cap_two_asks")),
    "b_harmful": Scenario(
        key="b_harmful", title="B is harmful and stopped early",
        story="A candidate edit annoys buyers and drops conversion from 45% to 35% (known truth).",
        expect="STOP_HARM", true_a=0.45, true_b=0.35, seed=9,
        cfg=dict(exp_id="exp-harm", name="Candidate edit that backfires", variant_b="cap_two_asks")),
    "inconclusive": Scenario(
        key="inconclusive", title="Inconclusive: the effect is too small to call",
        story="A candidate edit changes conversion by only +1pp (known truth), far below the 7pp we planned to detect.",
        expect="INCONCLUSIVE", true_a=0.45, true_b=0.46, seed=31,
        cfg=dict(exp_id="exp-flat", name="Candidate edit with a tiny effect", variant_b="reconcile_limits")),
    "peeking_trap": Scenario(
        key="peeking_trap", title="Peeking trap: no real difference",
        story="A and B are identical in truth. A dashboard that checks p<0.05 every day would crown a winner.",
        expect="INCONCLUSIVE", true_a=0.45, true_b=0.45, seed=11,   # first of the A/A seeds 1-160 (found by scan) where naive peeking falsely wins mid-test
        cfg=dict(exp_id="exp-trap", name="Identical prompts (A/A)", variant_b="reconcile_limits")),
    "srm_broken": Scenario(
        key="srm_broken", title="Broken test: split mismatch caught",
        story="B silently loses 35% of its non-converting calls from the log. B looks better, but is not.",
        expect="HALT_SRM", true_a=0.45, true_b=0.45, seed=51, log_drop_b=0.35,
        cfg=dict(exp_id="exp-srm", name="Logging bug in B", variant_b="cap_two_asks")),
    "guardrail_veto": Scenario(
        key="guardrail_veto", title="More leads, vetoed by the handling-time guardrail",
        story="A candidate edit lifts conversion to 52% but makes calls 30% longer (guardrail: +15% max).",
        expect="STOP_GUARDRAIL", true_a=0.45, true_b=0.52, seed=61, dur_mult_b=1.30,
        cfg=dict(exp_id="exp-guard", name="Edit that lifts conversion but lengthens calls", variant_b="reconcile_limits")),
    "guardrail_hold": Scenario(
        key="guardrail_hold", title="More leads, calls much longer: held for a person",
        story="A candidate edit lifts conversion to 52% but makes calls 20% longer (guardrail: +15% max). It is a clear win, so the engine does not throw it away; a person decides.",
        expect="HOLD_FOR_APPROVAL", true_a=0.45, true_b=0.52, seed=7, dur_mult_b=1.20,
        cfg=dict(exp_id="exp-hold", name="Edit that lifts conversion but lengthens calls", variant_b="reconcile_limits", share_b=0.30)),
}

ORDER = ["b_wins", "b_harmful", "inconclusive", "peeking_trap", "srm_broken", "guardrail_veto", "guardrail_hold"]

# --- the fix-loop scenarios: B is the edit Sarvam drafted from the real failures (data/proposal.json) --------------------------
# The baseline is the measured one (provisional machine labels); the lift to detect is a planning choice (the smallest lift worth detecting,
# fixloop.FIX_MDE), because the edit is derived from the prompt itself and not from a measured failure. The TRUE effect injected is a known
# assumption (that is the point of a simulation: the engine must find it). The window is 21 days because the test needs about 15 days.
FIX_KEYS = ["fix_ships", "fix_harms", "fix_flat"]
FIX_TRUTH = {                 # (title, story, expected decision, true effect in points, seed)
    "fix_ships": ("The fix works and ships", "The edit really lifts BuyLead conversion by the {ceil}pp the test was planned to detect (known truth).", "PROMOTE", 0.00, 12),
    "fix_harms": ("The fix backfires and is stopped", "The edit annoys buyers and conversion drops by 6pp (known truth).", "STOP_HARM", -0.06, 2),
    "fix_flat": ("The fix does almost nothing", "The edit moves conversion by only +1pp (known truth), far below what the test was planned to detect.", "INCONCLUSIVE", 0.01, 1),
}


def have_fix() -> bool:
    from .variants import DATA
    return (DATA / "proposal.json").exists()


def order() -> list[str]:
    return (FIX_KEYS if have_fix() else []) + ORDER


def fix_plan() -> dict:
    from .fixloop import design_for_fix
    return design_for_fix(share_b=0.5)


def _fix_scenario(key: str) -> tuple[Scenario, dict]:
    from .variants import make_variant
    plan = fix_plan()
    title, story, expect, delta, seed = FIX_TRUTH[key]
    base, mde = plan["baseline"], plan["mde"]
    true_b = base + (mde if key == "fix_ships" else delta)
    sc = Scenario(key=key, title=title, story=story.format(ceil=round(mde * 100)), expect=expect, true_a=base, true_b=round(true_b, 4), seed=seed,
                  cfg=dict(exp_id=f"exp-{key.replace('_', '-')}", name=make_variant("fix_candidate")["name"], variant_b="fix_candidate"))
    return sc, dict(share_b=0.5, baseline=base, mde=mde, window_days=21, leads_per_day=600)


def make(key: str, seed: int | None = None):
    from dataclasses import replace
    if key in FIX_KEYS:
        sc, base = _fix_scenario(key)
    else:
        sc, base = SCENARIOS[key], BASE
    if seed is not None:
        sc = replace(sc, seed=seed)
    cfg = Config(**{**base, **sc.cfg}).validate()
    return cfg, TrafficSim(sc), sc
