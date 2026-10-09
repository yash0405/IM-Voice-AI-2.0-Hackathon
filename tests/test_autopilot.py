"""The autopilot's two actions (no person needed): keep A when a held test gets no answer, and roll back when the holdback week raises an alert.
Both are ledger entries chained from the real head, exactly like a person's click, so the record still verifies. No network, no Sarvam."""
import json
import unittest
from datetime import datetime

from canary import console, engine
from canary.ledger import verify


def body(entry):
    return json.loads(entry["body"])


class AutopilotTails(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.demo = {e["id"]: e for e in console.demo_experiments()}

    def chain_ok(self, rec, key):
        ok, _ = verify(rec["ledger"] + rec["tails"][key])
        return ok

    def test_held_test_gets_a_safe_default(self):
        rec = self.demo["demo_hold"]["record"]
        self.assertEqual(rec["result"]["kind"], "HOLD_FOR_APPROVAL")
        self.assertEqual(set(rec["tails"]), {"approve", "reject", "auto_reject"})
        first = body(rec["tails"]["auto_reject"][0])
        self.assertEqual(first["payload"]["by"], engine.AUTOPILOT)
        self.assertEqual(first["payload"]["action"], "rejected")                 # the safe default keeps A: nothing ships without a yes
        self.assertIn(f"{engine.HELD_TIMEOUT_DAYS} days", first["payload"]["policy"])
        routing = body(rec["tails"]["auto_reject"][1])["payload"]
        self.assertEqual((routing["A"], routing["B"]), (1.0, 0.0))
        self.assertTrue(self.chain_ok(rec, "auto_reject"))
        hours = (datetime.fromisoformat(first["ts"]) - datetime.fromisoformat(rec["result"]["time"])).total_seconds() / 3600
        self.assertGreaterEqual(hours, 24 * engine.HELD_TIMEOUT_DAYS)           # only after the person had the full window to answer

    def test_holdback_alert_rolls_back_without_a_person(self):
        rec = self.demo["demo_fade"]["record"]
        self.assertEqual(rec["result"]["kind"], "PROMOTE")
        hb = rec["holdback"]
        self.assertIsNotNone(hb["alert_day"])
        self.assertIn("auto_rollback", rec["tails"])
        rb = body(rec["tails"]["auto_rollback"][0])
        self.assertEqual(rb["type"], "rollback")
        self.assertEqual(rb["payload"]["by"], engine.AUTOPILOT)
        self.assertEqual(rb["payload"]["from"], rec["result"]["production_after"])
        self.assertEqual(rb["payload"]["to"], rec["result"]["production_before"])
        self.assertIn(f"day {hb['alert_day']}", rb["payload"]["reason"])
        self.assertTrue(self.chain_ok(rec, "auto_rollback"))
        days = (datetime.fromisoformat(rb["ts"]) - datetime.fromisoformat(rec["result"]["time"])).total_seconds() / 86400
        self.assertGreaterEqual(days, hb["alert_day"])                          # stamped on the alert day, not before

    def test_a_win_that_holds_is_not_rolled_back(self):
        for key in ("demo_win", "demo_segment"):
            rec = self.demo[key]["record"]
            self.assertEqual(rec["result"]["kind"], "PROMOTE", key)
            self.assertIsNone(rec["holdback"]["alert_day"], key)
            self.assertNotIn("auto_rollback", rec["tails"], key)
            self.assertIn("rollback", rec["tails"], key)                         # the person's one-click rollback is still there

    def test_decisions_without_a_next_step_have_no_tails(self):
        for key in ("demo_worse", "demo_flat"):
            self.assertEqual(self.demo[key]["record"]["tails"], {}, key)

    def test_results_files_never_act_on_their_own(self):
        """For results files Canary only advises: no autopilot branch is written."""
        from canary import decide, samples
        files = [{"name": "results.csv", "text": samples.to_csv(samples.make_rows("guardrail_hold")), "arm": None}]
        rec = decide.decide(files, {"goal": "buylead_created", "baseline": 0.45, "share_b": 0.3, "window_days": 14, "mde": 0.07})
        self.assertEqual(rec["result"]["kind"], "HOLD_FOR_APPROVAL")
        self.assertIn("approve", rec["tails"])
        self.assertNotIn("auto_reject", rec.get("tails", {}))
        self.assertNotIn("auto_rollback", rec.get("tails", {}))

    def test_fade_truth_is_recorded(self):
        t = self.demo["demo_fade"]["truth"]
        self.assertLess(t["true_b_after"], t["true_a"])                         # the drop after rollout is the injected truth, labelled as such


if __name__ == "__main__":
    unittest.main()
