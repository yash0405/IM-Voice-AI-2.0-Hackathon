"""Fix-loop tests: what gets chosen, what a proposal must look like, and the pre-screen gate. Fake client, no network, no spend."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from canary import fixloop as fx, prescreen as ps, sarvam_pipe as sp
from canary.variants import load_base

ANCHOR = "- Never share another seller's or buyer's contact details."


def tag(i, issues, converted, label="partial"):
    return {"idx": i, "valid": True, "label": label, "fields": ["quantity", "specification"] if converted else ["quantity"],
            "bot_issues": issues, "fatal": "none", "call_end": "completed_with_readback", "buyer_requests": [], "fix_hint": "x" if issues else None}


class Fake:
    def __init__(self, replies):
        self.replies, self.calls = replies, 0
        c = self
        def completions(**kw):
            c.calls += 1
            txt = c.replies[min(c.calls - 1, len(c.replies) - 1)]
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=txt), finish_reason="stop")],
                                   usage=SimpleNamespace(prompt_tokens=1500, completion_tokens=120))
        self.chat = SimpleNamespace(completions=completions)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.old = (sp.DATA, sp.AL, sp.SPEND, fx.DATA, fx.PROPOSAL)
        sp.DATA = fx.DATA = self.tmp; sp.AL = self.tmp / "auto_labels"; sp.SPEND = self.tmp / "spend.json"
        fx.PROPOSAL = self.tmp / "proposal.json"; sp.AL.mkdir()

    def tearDown(self):
        sp.DATA, sp.AL, sp.SPEND, fx.DATA, fx.PROPOSAL = self.old

    def put(self, rows):
        for r in rows:
            (sp.AL / f"{r['idx']}.json").write_text(json.dumps(r))

    def seed_labels(self):
        """'common' is everywhere and harmless; 'leak' is rarer but costs conversions."""
        rows, i = [], 0
        for _ in range(70): rows.append(tag(i, ["common"], True)); i += 1          # common, converts
        for _ in range(25): rows.append(tag(i, ["common"], False)); i += 1
        for _ in range(8): rows.append(tag(i, ["leak"], True)); i += 1             # rare, leaks
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
        common = next(r for r in m["issues"] if r["key"] == "common")
        self.assertEqual(common["ceiling_pp"], 0.0)            # it converts better than average, so removing it recovers nothing
        self.assertGreater(next(r for r in m["issues"] if r["key"] == "leak")["ceiling_pp"], 5)

    def test_silent_calls_are_not_counted_as_failures(self):
        self.seed_labels()
        self.assertEqual(fx.mine()["no_connect"], 5)

    def test_tiny_clusters_are_never_chosen(self):
        rows = [tag(i, [], True) for i in range(80)] + [tag(100 + i, ["rare"], False) for i in range(5)]
        self.put(rows)
        self.assertIsNone(fx.mine()["target"])


GOOD = json.dumps({"title": "Ask for the next missing detail", "why": "Fewer abrupt endings.", "remove": [],
                   "add": [{"after": ANCHOR, "text": "- Ask for the next missing requirement detail before ending the call."}], "risk": "Slightly longer calls."})


class TestPropose(Base):
    def setUp(self):
        super().setUp(); self.seed_labels()

    def test_dry_run_spends_nothing(self):
        out = fx.propose(budget=100, yes=False)
        self.assertTrue(out["dry_run"]); self.assertFalse(fx.PROPOSAL.exists()); self.assertFalse(sp.SPEND.exists())

    def test_valid_edit_is_cached_and_costed(self):
        c = Fake([GOOD])
        out = fx.propose(budget=100, yes=True, client=c)
        self.assertEqual(c.calls, 1); self.assertEqual(out["origin"], "ai-mined")
        self.assertEqual(out["evidence"]["issue"], "leak"); self.assertFalse(out["evidence"]["labels_are_human_verified"])
        self.assertGreater(sp._load_spend()["inr"], 0)
        again = fx.propose(budget=100, yes=True, client=Fake([GOOD]))        # cached: no second call
        self.assertEqual(again["hash"], out["hash"])

    def test_bad_anchor_is_retried_once_then_refused(self):
        bad = json.dumps({"title": "x", "why": "y", "remove": [], "add": [{"after": "not a line of the prompt", "text": "- Be nice."}], "risk": "z"})
        c = Fake([bad, bad])
        with self.assertRaises(RuntimeError):
            fx.propose(budget=100, yes=True, client=c)
        self.assertEqual(c.calls, 2); self.assertFalse(fx.PROPOSAL.exists())

    def test_budget_is_enforced_before_any_call(self):
        c = Fake([GOOD])
        with self.assertRaises(sp.BudgetExceeded):
            fx.propose(budget=0.0001, yes=True, client=c)
        self.assertEqual(c.calls, 0)

    def test_validation_rules(self):
        base = load_base()["text"]
        for edit in ({"add": []},
                     {"add": [{"after": ANCHOR, "text": "- Offer 500 pieces."}]},                    # digits leak call detail
                     {"add": [{"after": ANCHOR, "text": '- Say "hello".'}]},                          # quotes
                     {"add": [{"after": ANCHOR, "text": "- " + "word " * 60}]},                      # too long
                     {"add": [{"after": ANCHOR, "text": "- a"}] * 3}):                              # too many lines
            with self.assertRaises(ValueError):
                fx._validate(edit, base)
        ok = fx._validate({"add": [{"after": ANCHOR, "text": "- Be brief."}]}, base)
        self.assertEqual(ok["add"][0]["text"], "- Be brief.")


class TestGate(Base):
    def setUp(self):
        super().setUp()
        self.old_ps, self.old_mine = ps.PS, fx.mine
        ps.PS = self.tmp / "prescreen.json"; fx.mine = lambda: {"target": "abrupt_end"}

    def tearDown(self):
        ps.PS, fx.mine = self.old_ps, self.old_mine; super().tearDown()

    def write(self, a_conv, b_conv, b_fatal=0, b_turns=6):
        res = []
        for i in range(24):
            for arm, conv, fatal, turns in (("A", i < a_conv, 0, 6), ("B", i < b_conv, 1 if i < b_fatal else 0, b_turns)):
                lines = [{"speaker": "bot" if k % 2 == 0 else "buyer", "text": "x"} for k in range(turns * 2)]
                res.append({"persona": f"p{i}", "arm": arm, "lines": lines,
                            "tag": {"label": "partial", "fields": ["quantity", "specification"] if conv else [], "bot_issues": [],
                                    "fatal": "oncall_fatal" if fatal else "none"}})
        ps.PS.write_text(json.dumps({"results": res, "errors": []}))

    def test_no_harm_passes(self):
        self.write(20, 21); self.assertTrue(ps.summary()["passed"])

    def test_clearly_worse_conversion_fails(self):
        self.write(20, 14); s = ps.summary(); self.assertFalse(s["passed"]); self.assertFalse(s["checks"]["conversion"])

    def test_more_fatal_calls_fails(self):
        self.write(20, 20, b_fatal=6); self.assertFalse(ps.summary()["checks"]["fatal"])

    def test_much_longer_calls_fail(self):
        self.write(20, 20, b_turns=9); self.assertFalse(ps.summary()["checks"]["turns"])

    def test_personas_cover_every_behaviour_and_product(self):
        P = ps.personas(); self.assertEqual(len(P), 24); self.assertEqual(len({p["key"] for p in P}), 24)


class TestLeadContext(unittest.TestCase):
    def test_simulated_vani_is_told_the_buyer_and_product(self):
        from canary import arena as ar
        for p in ar.PERSONAS + ps.personas():
            ctx = ar.lead_context(p)
            self.assertIn(p["name"], ctx); self.assertIn(p["product"], ctx)       # no "[Product Name]" spoken on a call
        self.assertIn("placeholders", ar.BOT_SUFFIX)

    def test_placeholder_check_counts_only_bot_lines(self):
        rs = [{"lines": [{"speaker": "bot", "text": "hi [Buyer Name]"}, {"speaker": "buyer", "text": "[x]"}, {"speaker": "bot", "text": "ok"}]}]
        self.assertEqual(ps.placeholder_lines(rs), 1)


if __name__ == "__main__":
    unittest.main()
