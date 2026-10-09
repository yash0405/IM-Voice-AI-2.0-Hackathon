"""The second BRD (Oct 9): segments, the stratified router, the end-of-test loss call, the holdback week, whole-week durations.
No network, no Sarvam credits."""
import unittest

from canary import catalog, console, server
from canary.engine import Config, Monitor, build_design, holdback_week, run_experiment
from canary.router import StratifiedRouter, block_for
from canary.simulator import Scenario, TrafficSim

SEG = {"rules": [{"var": "nature_of_business", "values": ["Proprietor"]}], "text": "Proprietors"}


class Catalog(unittest.TestCase):
    def test_in_call_variables_cannot_pick_leads(self):
        with self.assertRaises(ValueError) as e:
            catalog.validate_segment({"rules": [{"var": "disposition", "values": ["BuyLead created"]}]})
        self.assertIn("during the call", str(e.exception))

    def test_bad_values_and_tiny_segments_are_refused(self):
        with self.assertRaises(ValueError):
            catalog.validate_segment({"rules": [{"var": "city", "values": ["Atlantis"]}]})
        with self.assertRaises(ValueError):             # Chennai x Partnership x ENQR is under 2% of traffic
            catalog.validate_segment({"rules": [{"var": "city", "values": ["Chennai"]}, {"var": "nature_of_business", "values": ["Partnership"]}, {"var": "hot_lead_type", "values": ["ENQR"]}]})

    def test_the_rule_is_written_the_way_the_brd_writes_it(self):
        seg = catalog.validate_segment({"rules": [{"var": "city", "values": ["Mumbai"]}, {"var": "nature_of_business", "values": ["Proprietor"]},
                                                  {"var": "hot_lead_type", "values": ["UA", "PNS"]}]})
        self.assertEqual(catalog.describe(seg), "City = Mumbai AND NOB = Proprietor AND HL IN (UA, PNS)")
        self.assertAlmostEqual(catalog.segment_share(seg), 0.14 * 0.45 * 0.60, places=6)

    def test_lead_variables_are_a_fixed_function_of_the_lead(self):
        self.assertEqual(catalog.lead_vars("L0000042"), catalog.lead_vars("L0000042"))
        n = 20000
        share = sum(catalog.lead_vars(f"L{i:07d}")["nature_of_business"] == "Proprietor" for i in range(n)) / n
        self.assertAlmostEqual(share, 0.45, delta=0.02)

    def test_small_strata_merge_into_other(self):
        plan = catalog.plan_strata(300, None)           # 300 leads over 16 strata: most hold fewer than 30
        self.assertTrue(plan["merged"])
        self.assertEqual(len(catalog.plan_strata(100000, None)["merged"]), 0)


class Router(unittest.TestCase):
    def test_block_sizes(self):
        self.assertEqual(block_for(0.10), (10, 1)); self.assertEqual(block_for(0.30), (10, 3)); self.assertEqual(block_for(0.05), (20, 1)); self.assertEqual(block_for(0.25), (20, 5))

    def test_every_stratum_carries_the_configured_share_and_nobody_changes_arm(self):
        rt = StratifiedRouter("t", 0.30, "s", [])
        leads = [f"L{i:07d}" for i in range(5000)]
        for l in leads:
            rt.assign(l, catalog.lead_vars(l))
        for st, (a, b) in rt.strata.items():
            self.assertLessEqual(abs(b - 0.3 * (a + b)), 1.5, st)        # within one block's rounding
        self.assertLess(abs(rt.counts["B"] / 5000 - 0.30), 0.005)        # the BRD's +/-0.5 pp
        before = dict(rt.ledger)
        for l in leads[:500]:
            self.assertEqual(rt.assign(l), before[l])                     # sticky: asked again, same arm (no attributes needed)


class Engine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rec = console.run_preset("seg", "cap_two_asks", "2026-10-09T09:00:00", "exp-seg", 0.15, 7, assignment="stratified", segment=SEG, min_per_arm=1000, mde=0.07)

    def test_a_segment_test_counts_only_matching_leads(self):
        sc = self.rec["result"]["segment_check"]
        self.assertEqual(sc["matching"], sc["counted_leads"])
        self.assertGreater(sc["out_of_segment_leads"], sc["counted_leads"])      # 55% of traffic is outside "proprietors"
        self.assertAlmostEqual(sc["share_of_traffic"], 0.45)
        last = self.rec["looks"][-1]
        self.assertEqual(sum(sum(ab) for ab in last["mix"]["nature_of_business"].values()), sc["counted_leads"])
        self.assertEqual(sum(sum(ab) for k, ab in last["mix"]["nature_of_business"].items() if k != "Proprietor"), 0)

    def test_the_split_is_exact_and_the_mix_balanced(self):
        r = self.rec["result"]
        self.assertLess(abs(r["split"]["achieved_b"] - 0.30), 0.005)
        self.assertEqual(r["stickiness"]["arm_changes"], 0)
        self.assertGreater(self.rec["looks"][-1]["mix_p"]["hot_lead_type"], 0.5)   # blocks inside each type: A and B share one mix

    def test_by_call_share_counts_only_routed_calls(self):
        last = self.rec["looks"][-1]
        self.assertLess(abs(last["exposedB"] / last["calls"] - 0.30), 0.02)

    def test_the_calculator_eligible_volume_follows_the_segment(self):
        cfg = Config(**self.rec["config"])
        self.assertAlmostEqual(cfg.eligible_per_day, 450.0)
        self.assertEqual(build_design(cfg).capacity, 7 * 450)

    def test_a_segmented_test_needs_the_stratified_router(self):
        with self.assertRaises(ValueError):
            Config(segment=SEG, assignment="balanced").validate()


class EndOfTestLoss(unittest.TestCase):
    def test_a_b_that_is_significantly_worse_at_the_end_is_logged_as_a_loss(self):
        cfg = Config(share_b=0.3, baseline=0.45, mde=0.045, window_days=7, leads_per_day=1000, rule_set="final_look", min_per_arm=1000)
        d = build_design(cfg)
        self.assertAlmostEqual(d.harm[-1], 1.959964, places=4)           # two-sided 95% on the last day
        self.assertAlmostEqual(d.harm[0], 3.0902, places=3)              # a strict 99.9% bar on every other day
        from canary.engine import Counts
        mon, c = Monitor(cfg, d), Counts()
        c.nA, c.nB = 4900, 2100
        c.xA, c.xB = int(0.45 * 4900), int(0.45 * 2100 - 0.036 * 2100)  # B about 3.6 points lower: z near -2.7? no: well under the daily bar
        dec = mon.look(len(d.look_n) - 1, c, True)
        self.assertEqual(dec["kind"], "STOP_HARM")
        self.assertEqual(dec["cause"], "loss_at_end")
        self.assertIn("logged as a loss", dec["reason"])
        early = Monitor(cfg, d).look(2, c, False)                       # the same gap on an ordinary day is NOT enough to stop
        self.assertNotEqual(early["kind"], "STOP_HARM")

    def test_the_minimum_leads_gate_does_not_block_the_end_of_test_call(self):
        cfg = Config(share_b=0.1, baseline=0.45, mde=0.045, window_days=7, leads_per_day=1000, rule_set="final_look", min_per_arm=1000, secondary_role="none")
        from canary.engine import Counts
        d = build_design(cfg)
        c = Counts(); c.nA, c.nB, c.xA, c.xB = 6300, 700, 2835, 420       # only 700 B leads: below the 1,000 gate, but a clear win at the end
        dec = Monitor(cfg, d).look(len(d.look_n) - 1, c, True)
        self.assertEqual(dec["kind"], "PROMOTE")


class Holdback(unittest.TestCase):
    def test_a_promotion_keeps_a_slice_on_a_and_the_week_is_replayed(self):
        rec = console.run_preset("w", "cap_two_asks", "2026-10-09T09:00:00", "exp-w", 0.15, 6, assignment="stratified", min_per_arm=1000)
        self.assertEqual(rec["result"]["kind"], "PROMOTE")
        self.assertEqual(rec["result"]["routing_after"], {"A": 0.05, "B": 0.95})
        h = rec["holdback"]
        self.assertEqual(len(h["rows"]), 7)
        self.assertIn(h["verdict"], ("no_sign_of_loss", "ahead"))
        self.assertGreater(h["detectable_drop_pp"], 5)                   # 5% of leads cannot re-prove a gain: the card says so

    def test_a_decaying_b_raises_an_alert(self):
        cfg = Config(**{**Config().as_dict(), "assignment": "stratified", "leads_per_day": 3000})
        h = holdback_week(cfg, 0.45, 0.52, 3, true_b_after=0.30)
        self.assertEqual(h["verdict"], "alert")
        self.assertIsNotNone(h["alert_day"])

    def test_stopped_tests_have_no_holdback(self):
        rec = console.run_preset("x", "cap_two_asks", "2026-10-09T09:00:00", "exp-x", -0.15, 2, assignment="stratified", min_per_arm=1000)
        self.assertNotIn("holdback", rec)


class Wizard(unittest.TestCase):
    def test_the_wizard_runs_a_segment_and_refuses_in_call_variables(self):
        r = server.run_wizard({"name": "Seg", "effect_rel": 0.15, "seed": 7, "window_days": 7, "leads_per_day": 1000, "share_b": 0.3, "segment": SEG, "mde": 0.07})
        self.assertEqual(r["record"]["config"]["segment"]["rules"][0]["var"], "nature_of_business")
        self.assertEqual(r["record"]["config"]["assignment"], "stratified")
        with self.assertRaises(ValueError):
            server.run_wizard({"name": "Bad", "window_days": 7, "segment": {"rules": [{"var": "call_duration", "values": ["x"]}]}})

    def test_durations_are_whole_weeks(self):
        for d in (3, 10, 30):
            with self.assertRaises(ValueError):
                server.run_wizard({"name": "x", "window_days": d})

    def test_the_demo_has_the_segmented_scenario(self):
        ids = [d["key"] for d in console.DEMO]
        self.assertIn("demo_segment", ids)
        self.assertEqual(console.DEFAULTS["min_leads_per_arm"], 1000)         # the BRD's default for the daily harm check


if __name__ == "__main__":
    unittest.main()


class ReviewFixes(unittest.TestCase):
    """Defects an independent review found in the first version of this work: each is pinned here."""

    def test_a_share_that_blocks_cannot_deal_is_refused(self):
        with self.assertRaises(ValueError) as e:
            Config(share_b=0.065, assignment="stratified").validate()
        self.assertIn("whole percent", str(e.exception))
        Config(share_b=0.065, assignment="hash").validate()                     # the stateless hash can take any share

    def test_any_last_day_call_that_b_is_worse_is_the_end_of_test_loss(self):
        cfg = Config(share_b=0.3, baseline=0.45, mde=0.045, window_days=7, leads_per_day=1000, rule_set="final_look", min_per_arm=1000)
        d = build_design(cfg)
        from canary.engine import Counts
        c = Counts(); c.nA, c.nB = 4900, 2100; c.xA, c.xB = 2205, int(0.40 * 2100)      # far past even the daily bar
        dec = Monitor(cfg, d).look(len(d.look_n) - 1, c, True)
        self.assertEqual((dec["kind"], dec["cause"]), ("STOP_HARM", "loss_at_end"))

    def test_a_segment_win_says_it_is_promoted_for_the_segment_only(self):
        rec = console.run_preset("w", "cap_two_asks", "2026-10-09T09:00:00", "exp-scope", 0.15, 7, assignment="stratified", segment=SEG, min_per_arm=1000, mde=0.07)
        import json
        reasons = [json.loads(e["body"])["payload"].get("reason", "") for e in rec["ledger"] if json.loads(e["body"])["type"] == "routing_changed"]
        self.assertTrue(any("NOB = Proprietor only" in r for r in reasons), reasons)

    def test_the_early_hangup_guardrail_sees_a_real_difference(self):
        a = server.run_wizard({"name": "h0", "effect_rel": 0.15, "seed": 6, "window_days": 7, "leads_per_day": 1000, "share_b": 0.3, "early_hangup": True, "rate_margin_pp": 2, "hang_extra_pp": 0})
        b = server.run_wizard({"name": "h9", "effect_rel": 0.15, "seed": 6, "window_days": 7, "leads_per_day": 1000, "share_b": 0.3, "early_hangup": True, "rate_margin_pp": 2, "hang_extra_pp": 9})
        ga, gb = a["record"]["looks"][-1]["guardrail2"], b["record"]["looks"][-1]["guardrail2"]
        self.assertAlmostEqual(ga["rate_a"], console.early_hangup_share(), delta=0.02)       # A's rate comes from the real recordings
        self.assertGreater(gb["rate_b"] - gb["rate_a"], 0.07)
        self.assertEqual(b["record"]["result"]["kind"], "STOP_GUARDRAIL")

    def test_the_a_vs_a_study_counts_only_daily_checks_that_could_fire(self):
        import json
        from pathlib import Path
        P = json.loads((Path(__file__).resolve().parent.parent / "out" / "proof.json").read_text())["aa_brd"]
        self.assertLess(P["early_harm_stop_per_check"], 0.001)                                # the BRD's 0.1% per check
        self.assertAlmostEqual(P["significant_either_way"]["rate"], P["promoted"]["rate"] + P["held_for_approval"]["rate"] + P["logged_as_loss"]["rate"], places=9)


class SegmentReader(unittest.TestCase):
    def test_the_plain_english_reader_in_node(self):
        import shutil
        import subprocess
        from pathlib import Path
        node = shutil.which("node")
        script = Path(__file__).resolve().parent / "browser" / "segment_reader.cjs"
        if not node or not (Path(__file__).resolve().parent.parent / "out" / "console_bundle.json").exists():
            self.skipTest("node or the built console bundle is not available")
        r = subprocess.run([node, str(script)], capture_output=True, text=True, timeout=60)
        self.assertIn("all ok", r.stdout, r.stdout + r.stderr)
