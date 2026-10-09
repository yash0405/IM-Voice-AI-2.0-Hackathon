"""Fix-loop tests on the REAL VANI prompt: what gets chosen, what an edit must satisfy, and the pre-screen gate. Fake client, no network, no spend."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from canary import fixloop as fx, prescreen as ps, promptlint as pl, sarvam_pipe as sp
from canary.variants import load_base, make_variant


def tag(i, issues, converted, label="partial", schema=1):
    return {"idx": i, "valid": True, "schema": schema, "label": label, "fields": ["quantity", "specification"] if converted else ["quantity"],
            "bot_issues": issues, "fatal": "none", "call_end": "buyer_declined", "buyer_requests": [], "fix_hint": "x" if issues else None}


class Fake:
    def __init__(self, replies):
        self.replies, self.calls = replies, 0
        c = self
        def completions(**kw):
            c.calls += 1
            txt = c.replies[min(c.calls - 1, len(c.replies) - 1)]
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=txt), finish_reason="stop")],
                                   usage=SimpleNamespace(prompt_tokens=30000, completion_tokens=200))
        self.chat = SimpleNamespace(completions=completions)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.old = (sp.DATA, sp.AL, sp.TR, sp.SPEND, fx.DATA, fx.PROPOSAL)
        sp.DATA = fx.DATA = self.tmp; sp.AL = self.tmp / "auto_labels"; sp.TR = self.tmp / "transcripts"; sp.SPEND = self.tmp / "spend.json"
        fx.PROPOSAL = self.tmp / "proposal.json"; sp.AL.mkdir(); sp.TR.mkdir()

    def tearDown(self):
        sp.DATA, sp.AL, sp.TR, sp.SPEND, fx.DATA, fx.PROPOSAL = self.old

    def put(self, rows):
        for r in rows:
            (sp.AL / f"{r['idx']}.json").write_text(json.dumps(r))

    def seed_labels(self):
        """'common' is everywhere and harmless; 'leak' is rarer but costs conversions."""
        rows, i = [], 0
        for _ in range(70): rows.append(tag(i, ["common"], True)); i += 1
        for _ in range(25): rows.append(tag(i, ["common"], False)); i += 1
        for _ in range(8): rows.append(tag(i, ["leak"], True)); i += 1
        for _ in range(22): rows.append(tag(i, ["leak"], False)); i += 1
        for _ in range(40): rows.append(tag(i, [], True)); i += 1
        for _ in range(20): rows.append(tag(i, [], False)); i += 1
        for _ in range(5): rows.append(tag(i, [], False, "no_connect")); i += 1
        self.put(rows)


class TestMine(Base):
    def test_ranks_by_cost_not_frequency(self):
        self.seed_labels()
        m = fx.mine()
        self.assertEqual(m["pm_pick"], "common")              # the PM's rule: biggest group among the failed calls
        self.assertEqual(m["target"], "leak")                  # ours: the failure that costs conversions
        self.assertEqual(next(r for r in m["issues"] if r["key"] == "common")["ceiling_pp"], 0.0)
        self.assertGreater(next(r for r in m["issues"] if r["key"] == "leak")["ceiling_pp"], 5)

    def test_an_issue_the_real_prompt_forbids_is_retired_not_ranked(self):
        rows = [tag(i, ["did_not_confirm_details"], False) for i in range(60)] + [tag(100 + i, [], True) for i in range(40)]
        self.put(rows)
        m = fx.mine()
        self.assertEqual([r["key"] for r in m["issues"]], [])                      # not a candidate target
        self.assertEqual(m["retired"][0]["key"], "did_not_confirm_details"); self.assertEqual(m["retired"][0]["calls"], 60)
        self.assertIn("No-Echo", m["retired"][0]["why"])

    def test_labels_from_before_the_real_prompt_are_flagged_provisional(self):
        self.seed_labels(); self.assertTrue(fx.mine()["provisional"])
        self.put([tag(i, [], True, "buylead_created", schema=2) for i in range(300, 330)])
        m = fx.mine(); self.assertTrue(m["provisional"]); self.assertEqual(m["schema2_calls"], 30)

    def test_schema2_conversion_is_the_real_buylead_disposition(self):
        rows = [tag(i, [], False, "buylead_created", schema=2) for i in range(30)] + [tag(100 + i, [], True, "requirement_unconfirmed", schema=2) for i in range(70)]
        self.put(rows)
        self.assertAlmostEqual(fx.mine()["baseline"]["rate"], 0.30)                  # fields do not matter once the label is the real disposition

    def test_silent_calls_are_not_counted_as_failures_and_tiny_clusters_never_chosen(self):
        self.seed_labels(); self.assertEqual(fx.mine()["no_connect"], 5)
        for f in sp.AL.glob("*.json"): f.unlink()
        self.put([tag(i, [], True) for i in range(80)] + [tag(100 + i, ["rare"], False) for i in range(5)])
        self.assertIsNone(fx.mine()["target"])


EDIT = json.dumps({"title": "Name limit agrees with its section", "why": "The table and the section disagree on the name limit.",
                   "edit": [{"in_line": "Total ask limits:", "find": "buyer name = 3", "replace": "buyer name = 2"}], "add": [], "risk": "Slightly less name capture."})


class TestPropose(Base):
    def setUp(self):
        super().setUp(); self.seed_labels()

    def test_dry_run_spends_nothing_and_states_the_cost(self):
        out = fx.propose(budget=100, yes=False)
        self.assertTrue(out["dry_run"]); self.assertGreater(out["est_inr"], 0)
        self.assertFalse(fx.PROPOSAL.exists()); self.assertFalse(sp.SPEND.exists())

    def test_valid_edit_is_cached_costed_and_stays_valid(self):
        c = Fake([EDIT])
        out = fx.propose(budget=500, yes=True, client=c)
        self.assertEqual(c.calls, 1); self.assertEqual(out["origin"], "ai-mined"); self.assertFalse(out["evidence"]["labels_are_human_verified"])
        self.assertTrue(out["evidence"]["labels_provisional"]); self.assertGreater(sp._load_spend()["inr"], 0)
        self.assertTrue(fx._valid(out))
        again = fx.propose(budget=500, yes=True, client=Fake([EDIT]))
        self.assertEqual(again["hash"], out["hash"])                                  # cached: no second call

    def test_an_anchor_that_is_not_in_the_prompt_is_retried_once_then_refused(self):
        bad = json.dumps({"title": "x", "why": "y", "edit": [{"in_line": "this text is nowhere in the prompt", "find": "a", "replace": "b"}], "add": [], "risk": "z"})
        c = Fake([bad, bad])
        with self.assertRaises(RuntimeError):
            fx.propose(budget=500, yes=True, client=c)
        self.assertEqual(c.calls, 2); self.assertFalse(fx.PROPOSAL.exists())

    def test_an_edit_that_creates_a_new_contradiction_is_refused(self):
        # quantity is 3 in the table AND in the quantity section; changing only one of them must be rejected
        one_sided = json.dumps({"title": "x", "why": "y", "edit": [{"in_line": "Total ask limits:", "find": "quantity = 3", "replace": "quantity = 2"}], "add": [], "risk": "z"})
        with self.assertRaises(RuntimeError) as cm:
            fx.propose(budget=500, yes=True, client=Fake([one_sided, one_sided]))
        self.assertIn("contradiction", str(cm.exception))

    def test_budget_is_enforced_before_any_call(self):
        c = Fake([EDIT])
        with self.assertRaises(sp.BudgetExceeded):
            fx.propose(budget=0.01, yes=True, client=c)
        self.assertEqual(c.calls, 0)

    def test_validation_rules(self):
        base = load_base()["text"]
        for bad in ({"edit": [], "add": []},
                    {"edit": [{"in_line": "Total ask limits:", "find": "buyer name = 3", "replace": 'buyer name = "two"'}]},          # quotes
                    {"edit": [{"in_line": "Total ask limits:", "find": "buyer name = 3", "replace": "buyer name = 98765"}]},           # long digit string
                    {"edit": [{"in_line": "Total ask limits:", "find": "buyer name = 3", "replace": "word " * 70}]},                   # too long
                    {"edit": [{"in_line": "Total ask limits:", "find": "buyer name = 3", "replace": "x"}] * 5}):                     # too many changes
            with self.assertRaises(ValueError):
                fx._validate(bad, base)
        ok = fx._validate(json.loads(EDIT), base)
        self.assertEqual(ok["edit"][0]["replace"], "buyer name = 2")


class TestFreeCandidate(Base):
    def test_the_prompt_derived_candidate_removes_every_contradiction_and_adds_none(self):
        c = fx.lint_candidate(force=True)
        self.assertEqual(c["origin"], "lint-derived"); self.assertEqual(c["evidence"]["conflicts_before"], 3); self.assertEqual(c["evidence"]["conflicts_after"], 0)
        self.assertEqual(c["evidence"]["introduced"], 0); self.assertTrue(fx._valid(c))

    def test_it_never_overwrites_a_sarvam_draft_that_still_applies_unless_forced(self):
        self.seed_labels()
        ai = fx.propose(budget=500, yes=True, client=Fake([EDIT]))
        self.assertEqual(fx.lint_candidate()["hash"], ai["hash"])
        self.assertEqual(fx.lint_candidate(force=True)["origin"], "lint-derived")

    def test_a_proposal_that_no_longer_matches_the_prompt_is_not_valid(self):
        self.assertFalse(fx._valid({"edit": [{"in_line": "gone", "find": "x", "replace": "y"}]}))

    def test_planning_shows_what_small_lifts_cost(self):
        self.seed_labels()
        p = fx.design_for_fix()
        sizes = {row["mde"]: row["n_max"] for row in p["table"]}
        self.assertGreater(sizes[0.01], 8 * sizes[0.03])           # a 1pp lift needs roughly 9x the calls of a 3pp lift
        self.assertEqual(p["mde"], fx.FIX_MDE)


class TestGate(Base):
    def setUp(self):
        super().setUp()
        self.old_ps, self.old_mine = ps.PS, fx.mine
        ps.PS = self.tmp / "prescreen.json"; fx.mine = lambda: {"target": "looping_behavior"}

    def tearDown(self):
        ps.PS, fx.mine = self.old_ps, self.old_mine; super().tearDown()

    def write(self, a_conv, b_conv, b_fatal=0, b_turns=6, hash_=None):
        res = []
        for i in range(24):
            for arm, conv, fatal, turns in (("A", i < a_conv, 0, 6), ("B", i < b_conv, 1 if i < b_fatal else 0, b_turns)):
                lines = [{"speaker": "bot" if k % 2 == 0 else "buyer", "text": "x"} for k in range(turns * 2)]
                res.append({"persona": f"p{i}", "arm": arm, "lines": lines,
                            "tag": {"label": "partial", "fields": ["quantity", "specification"] if conv else [], "bot_issues": [],
                                    "fatal": "oncall_fatal" if fatal else "none"}})
        d = {"results": res, "errors": []}
        if hash_: d["base_hash"] = hash_
        ps.PS.write_text(json.dumps(d))

    def test_no_harm_passes(self):
        self.write(20, 21); self.assertTrue(ps.summary()["passed"])

    def test_clearly_worse_conversion_fails(self):
        self.write(20, 14); s = ps.summary(); self.assertFalse(s["passed"]); self.assertFalse(s["checks"]["conversion"])

    def test_more_fatal_calls_fails(self):
        self.write(20, 20, b_fatal=6); self.assertFalse(ps.summary()["checks"]["fatal"])

    def test_much_longer_calls_fail(self):
        self.write(20, 20, b_turns=9); self.assertFalse(ps.summary()["checks"]["turns"])

    def test_results_made_with_another_base_prompt_are_marked_stale(self):
        self.write(20, 21); self.assertTrue(ps.summary()["stale"])                       # no hash = made with the earlier stand-in prompt
        self.write(20, 21, hash_=load_base()["hash"]); self.assertFalse(ps.summary()["stale"])

    def test_personas_cover_every_behaviour_and_product_and_costs_are_stated_up_front(self):
        P = ps.personas(); self.assertEqual(len(P), 24); self.assertEqual(len({p["key"] for p in P}), 24)
        self.assertEqual(len(ps.personas(12)), 12)
        pl_ = ps.plan(12)
        self.assertGreater(pl_["est_inr"], 50)                                           # the real prompt makes a simulated call expensive
        self.assertGreater(pl_["all_24_personas_inr"], pl_["est_inr"])


if __name__ == "__main__":
    unittest.main()
