"""The real prompt tools: normaliser, flow splitter, renderer, ask-limit lint and the loop scan. No network, no spend."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from canary import loopscan as ls, promptlint as pl, realprompt as rp
from canary.variants import apply_patch, load_base, make_variant

RAW = """   Role & Persona:

   ●​ You are  bot_name  , a Business Development Executive at the IndiaMart Help Desk with 10+
      years of experience.
   ●​ Second bullet.
         ○​ Nested bullet that wraps over
            two lines.

{%if ast_seller_pns != ""%}

   ●​ A live seller is available.

{%endif%}
"""


class Normalise(unittest.TestCase):
    def test_wrapped_bullets_are_joined_and_nesting_is_kept(self):
        out = rp.normalize(RAW).splitlines()
        self.assertIn("- You are bot_name , a Business Development Executive at the IndiaMart Help Desk with 10+ years of experience.", out)
        self.assertIn("  - Nested bullet that wraps over two lines.", out)
        self.assertIn('{%if ast_seller_pns != ""%}', out)                                # template control lines stay on their own line

    def test_render_resolves_branches_from_the_call_context(self):
        t = rp.normalize(RAW)
        self.assertIn("A live seller is available.", rp.render(t, ast_seller_pns="9100000000"))
        self.assertNotIn("A live seller is available.", rp.render(t, ast_seller_pns=""))


class RealPrompt(unittest.TestCase):
    def setUp(self):
        self.text = load_base()["text"]

    def test_the_document_has_the_four_prompts_and_renders_without_leftover_tags(self):
        F = rp.flows(self.text)
        self.assertEqual(set(F), {"inbound_redirect", "enrichment", "redial_name_city", "redial_ast"})
        for name, t in F.items():
            r = rp.render(t, product_name="pipes", is_enrich="1" if name == "enrichment" else "0")
            self.assertNotIn("{%", r); self.assertNotIn("{{", r)
        self.assertLess(len(rp.render(F["inbound_redirect"])), len(F["inbound_redirect"]))     # unused branches disappear

    def test_the_prompt_says_what_we_learned_from_it(self):
        t = self.text
        self.assertIn("This is NOT an outbound call.", t)
        self.assertIn("Do not repeat, paraphrase, summarize, or reconfirm the value.", t)   # the No-Echo rule: reading values back is forbidden
        self.assertNotIn("timeline", t.lower().replace("current_phase", ""))                 # VANI does not collect a timeline


class Lint(unittest.TestCase):
    def test_finds_the_three_known_contradictions_in_the_real_prompt(self):
        got = {(c["flow"], c["field"], tuple(c["limits"])) for c in pl.analyse()["conflicts"]}
        self.assertEqual(got, {("inbound_redirect", "name", (2, 3)), ("inbound_redirect", "product", (4, 5)), ("enrichment", "any slot", (2, 3))})

    def test_every_finding_quotes_the_prompt_text(self):
        lines = load_base()["text"].splitlines()
        for c in pl.analyse()["conflicts"]:
            for e in c["evidence"]:
                self.assertIn(e["quote"].lower().replace("foure", "foure"), lines[e["line"]].lower())

    def test_an_edit_is_checked_for_new_contradictions(self):
        base = load_base()["text"]
        good = pl.compare(base, make_variant("reconcile_limits")["text"])
        self.assertEqual((good["before"], good["after"], good["ok"]), (3, 0, True))
        bad = apply_patch(base, {"edit": [{"in_line": "Total ask limits:", "find": "quantity = 3", "replace": "quantity = 2"}]})
        self.assertFalse(pl.compare(base, bad)["ok"])                                      # table says 2, the quantity section still says 3

    def test_a_stale_patch_never_silently_changes_nothing(self):
        base = load_base()["text"]
        with self.assertRaises(ValueError):
            apply_patch(base, {"edit": [{"in_line": "no such line anywhere", "find": "x", "replace": "y"}]})
        with self.assertRaises(ValueError):
            apply_patch(base, {"edit": [{"in_line": "Never ask", "find": "Never", "replace": "Always"}]})       # matches more than one line


class Loops(unittest.TestCase):
    BOT = "[Speaker 0] kya aap apna naam bata sakte hain please"
    BUYER = "[Speaker 1] haan ji"

    def test_a_bot_that_asks_the_same_thing_four_times_is_a_loop(self):
        t = "\n".join([self.BOT, self.BUYER] * 4)
        r = ls.scan_text(t); self.assertTrue(r["loop"]); self.assertEqual(r["bot_cluster"], 4)

    def test_three_repeats_are_at_the_limit_but_not_a_loop(self):
        r = ls.scan_text("\n".join([self.BOT, self.BUYER] * 3)); self.assertTrue(r["repeat"]); self.assertFalse(r["loop"])

    def test_normal_conversation_and_short_replies_are_not_flagged(self):
        t = "\n".join(["[Speaker 0] namaste kya aap pipes ke liye call kar rahe hain", "[Speaker 1] haan", "[Speaker 0] aapko kitni quantity chahiye",
                       "[Speaker 1] paanch sau", "[Speaker 0] size kaunsa chahiye bees mm ya paccis mm", "[Speaker 1] bees"])
        r = ls.scan_text(t); self.assertFalse(r["repeat"]); self.assertFalse(r["any_loop"])

    def test_the_bot_is_the_speaker_with_longer_turns_and_one_word_turns_are_ignored(self):
        t = "\n".join(["[Speaker 0] hello", "[Speaker 1] kya aap apna naam bata sakte hain please"] * 4)
        r = ls.scan_text(t); self.assertEqual(r["bot_cluster"], 4)                       # speaker 1 speaks in sentences, so it is the bot here


if __name__ == "__main__":
    unittest.main()
