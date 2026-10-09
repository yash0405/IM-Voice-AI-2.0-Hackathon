"""The demo scenarios. Truths (true_a, true_b, ...) are injected; everything else is measured.

Baseline 45% BuyLead conversion sits inside the 35-60% benchmark we were told about; it is an ASSUMPTION
until real labels give the measured rate (Label Lab)."""
from __future__ import annotations

from .engine import Config
from .simulator import Scenario, TrafficSim

BASE = dict(share_b=0.10, baseline=0.45, mde=0.07, window_days=14, leads_per_day=600)

SCENARIOS = {
    "b_wins": Scenario(
        key="b_wins", title="B wins and is promoted",
        story="Asking quantity and delivery location in one question lifts BuyLead conversion from 45% to 52% (known truth).",
        expect="PROMOTE", true_a=0.45, true_b=0.52, seed=11,
        cfg=dict(exp_id="exp-win", name="Ask quantity and location together", variant_b="ask_together")),
    "b_harmful": Scenario(
        key="b_harmful", title="B is harmful and stopped early",
        story="Asking for the specification up to three times annoys buyers and drops conversion from 45% to 35% (known truth).",
        expect="STOP_HARM", true_a=0.45, true_b=0.35, seed=9,
        cfg=dict(exp_id="exp-harm", name="Keep asking until the specification is given", variant_b="insist_specs")),
    "inconclusive": Scenario(
        key="inconclusive", title="Inconclusive: the effect is too small to call",
        story="A warmer greeting changes conversion by only +1pp (known truth), far below the 7pp we planned to detect.",
        expect="INCONCLUSIVE", true_a=0.45, true_b=0.46, seed=31,
        cfg=dict(exp_id="exp-flat", name="Warmer greeting", variant_b="warmer_greeting")),
    "peeking_trap": Scenario(
        key="peeking_trap", title="Peeking trap: no real difference",
        story="A and B are identical in truth. A dashboard that checks p<0.05 every day would crown a winner.",
        expect="INCONCLUSIVE", true_a=0.45, true_b=0.45, seed=11,   # first of the A/A seeds 1-160 (found by scan) where naive peeking falsely wins mid-test
        cfg=dict(exp_id="exp-trap", name="Identical prompts (A/A)", variant_b="warmer_greeting")),
    "srm_broken": Scenario(
        key="srm_broken", title="Broken test: split mismatch caught",
        story="B silently loses 35% of its non-converting calls from the log. B looks better, but is not.",
        expect="HALT_SRM", true_a=0.45, true_b=0.45, seed=51, log_drop_b=0.35,
        cfg=dict(exp_id="exp-srm", name="Logging bug in B", variant_b="ask_together")),
    "guardrail_veto": Scenario(
        key="guardrail_veto", title="More leads, vetoed by the handling-time guardrail",
        story="Explaining how the seller will use the details lifts conversion to 52% but makes calls 30% longer (guardrail: +15% max).",
        expect="STOP_GUARDRAIL", true_a=0.45, true_b=0.52, seed=61, dur_mult_b=1.30,
        cfg=dict(exp_id="exp-guard", name="Explain details usage before asking", variant_b="long_intro")),
}

ORDER = ["b_wins", "b_harmful", "inconclusive", "peeking_trap", "srm_broken", "guardrail_veto"]

# --- the fix-loop scenarios: B is the edit Sarvam drafted from the real failures (data/proposal.json) --------------------------
# Baseline and the lift to detect come from the measured labels, not from us: baseline = measured BuyLead rate (loose definition),
# lift = the ceiling for removing the targeted failure entirely. The TRUE effect injected is a known assumption (that is the point of
# a simulation: the engine must find it). They only exist when a proposal has been drafted.
FIX_KEYS = ["fix_ships", "fix_harms", "fix_flat"]
FIX_TRUTH = {                 # (title, story, expected decision, true effect in points, seed)
    "fix_ships": ("The fix works and ships", "The edit really lifts BuyLead conversion by the full {ceil}pp it could at best (known truth).", "PROMOTE", 0.00, 17),
    "fix_harms": ("The fix backfires and is stopped", "The edit annoys buyers and conversion drops by 6pp (known truth).", "STOP_HARM", -0.06, 5),
    "fix_flat": ("The fix does almost nothing", "The edit moves conversion by only +1pp (known truth), far below what the test was planned to detect.", "INCONCLUSIVE", 0.01, 3),
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
                  cfg=dict(exp_id=f"exp-{key.replace('_', '-')}", name=make_variant("ai_fix")["name"], variant_b="ai_fix"))
    return sc, dict(share_b=0.5, baseline=base, mde=mde, window_days=14, leads_per_day=600)


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
