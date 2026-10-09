"""python -m unittest discover -s tests -v   (run from the canary/ folder)"""
import json
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from canary import ledger, proof, seqdesign
from canary.build import scenario_bundle
from canary.engine import Config, build_design
from canary.evaluator import LLMEvaluator, RuleEvaluator, metrics
from canary.router import NaiveRouter, Router
from canary.scenarios import ORDER, SCENARIOS
from canary.stats import pooled_z, score_diff_ci, srm_pvalue
from canary.variants import make_variant, load_base


class SeqDesign(unittest.TestCase):
    def test_obf_boundaries_match_published_lan_demets_values(self):
        b = seqdesign.compute_boundaries([k / 5 for k in range(1, 6)], 0.025, "obf")
        for got, want in zip(b, [4.881, 3.360, 2.683, 2.293, 2.034]):
            self.assertAlmostEqual(got, want, delta=0.01)

    def test_type_one_error_equals_alpha_by_integration_and_by_simulation(self):
        ts = [k / 10 for k in range(1, 11)]
        b = seqdesign.compute_boundaries(ts, 0.025, "obf")
        self.assertAlmostEqual(seqdesign.crossing_probability(ts, b, 0.0), 0.025, delta=0.0006)
        rng = np.random.default_rng(1)
        z = np.cumsum(rng.normal(size=(200000, 10)) * np.sqrt(0.1), axis=1) / np.sqrt(ts)
        self.assertAlmostEqual(float((z >= np.array(b)).any(axis=1).mean()), 0.025, delta=0.0015)

    def test_sample_size_inflation_is_small_and_power_is_80(self):
        p = seqdesign.plan_sample_size(0.12, 0.05, 0.10)
        self.assertGreater(p["n_max"], p["n_fixed"])
        self.assertLess(p["inflation"], 1.10)


class Routing(unittest.TestCase):
    def test_balanced_is_exact_per_block_and_sticky(self):
        r = Router("e", 0.10, "s", "balanced")
        for i in range(1000):
            r.assign(f"L{i}")
        self.assertEqual(r.counts["B"], 100)
        first = dict(r.ledger)
        self.assertTrue(all(r.assign(l) == a for l, a in first.items()))

    def test_hash_is_stateless_and_two_servers_agree(self):
        a, b = Router("e", 0.2, "s", "hash"), Router("e", 0.2, "s", "hash")
        self.assertTrue(all(a.assign(f"L{i}") == b.assign(f"L{i}") for i in range(3000)))

    def test_typical_coin_flip_router_is_not_sticky(self):
        n = NaiveRouter(0.1, 1)
        for _ in range(3):
            for i in range(500):
                n.assign(f"L{i}")
        self.assertGreater(n.flips, 0)


class Ledger(unittest.TestCase):
    def test_chain_verifies_and_detects_tampering(self):
        L = ledger.Ledger(lambda: "t")
        for i in range(5):
            L.append("look", {"k": i, "z": 0.5})
        self.assertTrue(ledger.verify(L.entries)[0])
        bad = json.loads(json.dumps(L.entries))
        bad[2]["body"] = bad[2]["body"].replace("0.5", "9.5")
        ok, idx = ledger.verify(bad)
        self.assertFalse(ok)
        self.assertEqual(idx, 2)
        reorder = [L.entries[0], L.entries[2], L.entries[1]] + L.entries[3:]
        self.assertFalse(ledger.verify(reorder)[0])


class Stats(unittest.TestCase):
    def test_interval_excludes_zero_exactly_when_the_decision_statistic_crosses(self):
        rnd = random.Random(3)
        for _ in range(120):
            nA, nB = rnd.randint(200, 3000), rnd.randint(50, 500)
            xA, xB = int(nA * rnd.uniform(.05, .3)), int(nB * rnd.uniform(.05, .35))
            z = pooled_z(xA, nA, xB, nB)
            for crit in (1.96, 2.7):
                _, lo, hi = score_diff_ci(xA, nA, xB, nB, crit)
                self.assertEqual(lo > 0 or hi < 0, abs(z) >= crit)

    def test_logging_completeness_check_catches_uneven_loss_but_not_even_loss(self):
        from canary.stats import loss_pvalue
        self.assertLess(loss_pvalue(2000, 2000, 200, 170), 0.001)      # B loses 15% of its calls
        self.assertGreater(loss_pvalue(2000, 1960, 200, 196), 0.5)     # both lose 2%
        self.assertEqual(loss_pvalue(2000, 2000, 200, 200), 1.0)

    def test_srm(self):
        self.assertGreater(srm_pvalue(900, 100, 0.10), 0.5)
        self.assertLess(srm_pvalue(940, 60, 0.10), 0.001)


class Engine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.b = {k: scenario_bundle(k) for k in ORDER}

    def test_every_scenario_reaches_the_expected_decision(self):
        for k in ORDER:
            self.assertEqual(self.b[k]["record"]["result"]["kind"], SCENARIOS[k].expect, k)

    def test_runs_are_reproducible_and_ledgers_verify(self):
        for k in ORDER:
            self.assertTrue(self.b[k]["replay"]["same_decision"] and self.b[k]["replay"]["same_ledger_head"], k)
            self.assertTrue(ledger.verify(self.b[k]["record"]["ledger"])[0], k)

    def test_no_lead_ever_changes_arm(self):
        for k in ORDER:
            self.assertEqual(self.b[k]["record"]["result"]["stickiness"]["arm_changes"], 0, k)

    def test_promotion_only_in_the_winning_scenario_and_routing_follows_decision(self):
        for k in ORDER:
            r = self.b[k]["record"]["result"]
            share = self.b[k]["record"]["config"]["share_b"]
            # promoted: B is production and a 5% holdback stays on A for a week; held for a person: the test split is left alone meanwhile; anything else: all back to A
            hold = self.b[k]["record"]["config"]["holdback_share"]
            want = 1.0 - hold if r["kind"] == "PROMOTE" else share if r["kind"] == "HOLD_FOR_APPROVAL" else 0.0
            self.assertEqual(r["routing_after"]["B"], want, k)
        self.assertEqual([k for k in ORDER if self.b[k]["record"]["result"]["kind"] == "PROMOTE"], ["b_wins"])

    def test_decisions_are_logged_with_evidence(self):
        for k in ORDER:
            types = [json.loads(e["body"])["type"] for e in self.b[k]["record"]["ledger"]]
            self.assertIn("decision", types)
            dec = [json.loads(e["body"]) for e in self.b[k]["record"]["ledger"] if json.loads(e["body"])["type"] == "decision"][0]
            self.assertIn("evidence", dec["payload"])

    def test_config_validation(self):
        with self.assertRaises(ValueError):
            Config(share_b=0.7).validate()
        with self.assertRaises(ValueError):
            Config(baseline=0.97, mde=0.05).validate()

    def test_variants_are_small_reviewable_patches(self):
        for key in ("reconcile_limits", "cap_two_asks"):
            v = make_variant(key)
            changed = [l for l in v["diff"] if l[:1] in "+-" and not l.startswith(("+++ B", "--- A"))]
            self.assertLess(len(changed), 14)                    # a handful of changed lines in a 2,300-line prompt
            self.assertNotEqual(v["hash"], load_base()["hash"])


class Evaluator(unittest.TestCase):
    def test_rules_on_clear_cases(self):
        ev = RuleEvaluator()
        cases = {"Haan chahiye, 500 pieces steel pipe, delivery Pune, within 10 days": "buylead_created",
                 "Abhi busy hoon, baad mein call kijiye": "callback_fixed",
                 "Not interested, please don't call again": "not_interested",
                 "The number you have dialled is currently switched off": "no_connect",
                 "Nahi chahiye ab, requirement khatam ho gayi": "not_interested"}
        for text, want in cases.items():
            self.assertEqual(ev.classify(text)["label"], want, text)

    def test_llm_hook_parses_json_and_rejects_unknown_labels(self):
        ev = LLMEvaluator(lambda p: 'sure: {"label": "buylead_created", "evidence": "500 pieces"}')
        self.assertEqual(ev.classify("x")["label"], "buylead_created")
        self.assertEqual(LLMEvaluator(lambda p: '{"label": "made_up"}').classify("x")["label"], "other")
        self.assertEqual(LLMEvaluator(lambda p: "not json").classify("x")["label"], "other")

    def test_metrics(self):
        m = metrics(["a", "a", "b", "b"], ["a", "b", "b", "b"], goal="a")
        self.assertAlmostEqual(m["accuracy"], 0.75)
        self.assertAlmostEqual(m["sensitivity"], 0.5)
        self.assertAlmostEqual(m["specificity"], 1.0)


class ProofSanity(unittest.TestCase):
    def test_canary_controls_false_wins_that_naive_peeking_does_not(self):
        cfg = Config(secondary_role="none")
        d = build_design(cfg)
        a = proof._gen(np.random.default_rng(9), 3000, d, cfg, 0.12, 0.12, with_dur=False)
        r = proof.evaluate(a, 3000, d, cfg, False, methods=["canary", "naive_peek"])
        canary = r["canary"]["kind"].count("PROMOTE") / 3000
        naive = r["naive_peek"]["kind"].count("PROMOTE") / 3000
        self.assertLess(canary, 0.045)
        self.assertGreater(naive, 2 * canary)


if __name__ == "__main__":
    unittest.main()
