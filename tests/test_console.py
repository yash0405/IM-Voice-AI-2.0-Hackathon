"""The console's data (demo experiments, history, library, suggestions) and the wizard endpoint. No network, no Sarvam."""
import json
import re
import unittest
from pathlib import Path

from picky import build, console, promptlint, server, variants

ROOT = Path(__file__).resolve().parent.parent


class ConsoleData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.demo = console.demo_experiments()
        cls.past = console.past_tests()

    def test_the_demo_follows_the_specs_plan(self):
        """Set up B wins, B worse and flat in advance, paused on day 2; each reaches the decision the spec expects."""
        kinds = {e["id"]: e["record"]["result"]["kind"] for e in self.demo}
        self.assertEqual(kinds["demo_win"], "PROMOTE")
        self.assertEqual(kinds["demo_worse"], "STOP_HARM")
        self.assertEqual(kinds["demo_flat"], "INCONCLUSIVE")
        self.assertEqual(kinds["demo_hold"], "HOLD_FOR_APPROVAL")                      # the BRD's bonus scenario
        for e in self.demo:
            self.assertEqual(e["start_day"], 2)
            self.assertEqual(e["record"]["config"]["rule_set"], "final_look")          # one winner call at the end, a strict daily harm check
            self.assertEqual(e["record"]["config"]["window_days"], 7)
            self.assertTrue(e["record"]["ledger_ok"])
        worse = next(e for e in self.demo if e["id"] == "demo_worse")
        self.assertLess(worse["record"]["result"]["at_look"], 7)                     # stopped early, before the last day
        win = next(e for e in self.demo if e["id"] == "demo_win")
        self.assertEqual(win["record"]["result"]["at_look"], 7)                      # never promoted before the final call

    def test_every_look_belongs_to_a_day(self):
        for e in self.demo + self.past:
            days = [l["day"] for l in e["record"]["looks"]]
            self.assertTrue(all(isinstance(d, int) and d >= 1 for d in days), e["id"])
            self.assertEqual(days, sorted(days), e["id"])

    def test_history_is_all_in_the_past_and_covers_every_decision(self):
        self.assertTrue(all(p["record"]["config"]["start"] < "2026-10-05" if p["kind"] == "simulated" else p["record"]["looks"][0]["time"] < "2026-10-05" for p in self.past))
        got = {p["record"]["result"]["kind"] for p in self.past}
        for k in ("PROMOTE", "STOP_HARM", "INCONCLUSIVE", "HOLD_FOR_APPROVAL", "STOP_GUARDRAIL", "HALT_SRM"):
            self.assertIn(k, got)
        self.assertEqual(len({p["id"] for p in self.demo + self.past}), len(self.demo + self.past))

    def test_records_carry_no_prompt_text(self):
        for e in self.demo[:1] + self.past[:2]:
            for side in e["record"]["variants"].values():
                self.assertNotIn("text", side)
        self.assertLess(len(json.dumps(self.demo)), 400_000)

    def test_library_checks_template_variables(self):
        lib = console.library()
        self.assertGreater(len(lib["variables"]), 10)
        self.assertGreater(len(lib["base_text"]), 10_000)
        for c in lib["candidates"]:
            self.assertTrue(c["variables"]["ok"], c["key"])
        base = variants.load_base()["text"]
        broken = base.replace("buyer_name", "x")
        self.assertIn("buyer_name", promptlint.variable_report(base, broken)["dropped"])
        self.assertFalse(promptlint.variable_report(base, broken)["ok"])

    def test_suggestions_say_when_a_source_has_no_data(self):
        cards = {c["id"]: c for c in console.suggestions()}
        self.assertTrue(cards["segments"]["disabled"])
        self.assertIn("no segment data", cards["segments"]["change_note"].lower())
        self.assertIsNone(cards["gap"]["change"])                                     # not drafted: that would cost credits
        self.assertEqual(cards["lint"]["change"], "reconcile_limits")

    def test_metric_list_matches_the_spec(self):
        m = {x["key"]: x for x in console.metrics()}
        self.assertEqual(m["buylead_created"]["role"], "goal")
        self.assertEqual(m["duration_s"]["role"], "guardrail")
        self.assertIn("meeting_fixed", m)                                              # the goal named in the problem statement

    def test_the_script_is_assembled_from_its_parts(self):
        out = build.assemble_console_js()
        js = out.read_text()
        for route in ("ROUTES.overview", "ROUTES.experiments", "ROUTES.new", "ROUTES.suggest", "ROUTES.library", "ROUTES.log", "ROUTES.settings", "ROUTES.import", "ROUTES.report"):
            self.assertIn(route, js)
        self.assertEqual(len(re.findall(r"^\"use strict\";", js, re.M)), 1)


def wizard_body(**over):
    base = variants.load_base()["text"]
    return {"name": "Test", "prompt_b": base.replace("buyer name = 3", "buyer name = 2"), "share_b": 0.3, "window_days": 7, "improvement": 0.05,
            "leads_per_day": 1000, "metrics": [{"role": "primary", "key": "buylead_created"}], "effect_rel": 0.15, "seed": 6, **over}


class Wizard(unittest.TestCase):
    def test_the_wizard_runs_the_engine_with_the_chosen_rules(self):
        r = server.run_wizard(wizard_body(rule_set="final_look"))
        rec = r["record"]
        self.assertEqual(rec["config"]["rule_set"], "final_look")
        self.assertEqual(rec["result"]["kind"], "PROMOTE")
        self.assertEqual(rec["config"]["version"], 1)
        self.assertEqual(rec["config"]["min_per_arm"], 500)                          # the new default gate
        self.assertTrue(rec["ledger_ok"])

    def test_a_pasted_prompt_must_keep_its_template_variables(self):
        base = variants.load_base()["text"]
        with self.assertRaises(ValueError) as e:
            server.run_wizard(wizard_body(name="Broken", prompt_b=base.replace("buyer_name", "x")))
        self.assertIn("buyer_name", str(e.exception))
        ok = server.run_wizard(wizard_body(name="Edited", effect_rel=0.0, leads_per_day=600))
        self.assertTrue(ok["record"]["variants"]["B"]["diff"])

    def test_limits_protect_the_live_demo(self):
        with self.assertRaises(ValueError):
            server.run_wizard(wizard_body(window_days=28, leads_per_day=5000))
        with self.assertRaises(ValueError) as e:                                     # whole weeks only: 7, 14, 21 or 28 days
            server.run_wizard(wizard_body(window_days=10))
        self.assertIn("whole weeks", str(e.exception))
        with self.assertRaises(ValueError):
            server.run_wizard(wizard_body(effect_rel=9))


if __name__ == "__main__":
    unittest.main()
