"""Voice arena tests with a fake Sarvam client (no network, no spend)."""
import base64, json, sys, tempfile, unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from canary import arena as ar, sarvam_pipe as sp


class Fake:
    def __init__(self):
        self.chat_n = 0; self.tts_texts = []
        c = self
        def completions(**kw):
            c.chat_n += 1
            sysmsg = kw["messages"][0]["content"]
            if "Reply with ONE JSON object" in kw["messages"][-1]["content"]:
                txt = '{"label":"buylead_created","confidence":0.9,"fields":["quantity","specification"],"captured":{},"language":"hinglish","call_end":"completed_with_readback","sentiment":"neutral","buyer_requests":[],"bot_issues":[],"fatal":"none","evidence":"x"}'
            elif sysmsg.startswith("You are playing a BUYER"): txt = "हाँ, 500 pieces"
            else:
                n = sum(1 for m in kw["messages"] if m["role"] == "assistant")
                txt = "नमस्ते, quantity बताइए?" if n < 2 else "धन्यवाद [END]"
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=txt), finish_reason="stop")],
                                   usage=SimpleNamespace(prompt_tokens=1000, completion_tokens=50))
        def convert(**kw):
            c.tts_texts.append((kw["text"], kw["speaker"], kw["model"], kw["output_audio_codec"]))
            return SimpleNamespace(audios=[base64.b64encode(b"MP3" + kw["speaker"].encode()).decode()])
        self.chat = SimpleNamespace(completions=completions); self.text_to_speech = SimpleNamespace(convert=convert)


class ArenaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.old = (ar.ARENA, ar.LEDGER, sp.DATA, sp.TR, sp.AL, sp.SPEND, sp.RAW)
        ar.ARENA, ar.LEDGER = self.tmp / "arena", self.tmp / "arena_spend.json"
        sp.DATA, sp.TR, sp.AL, sp.SPEND, sp.RAW = self.tmp, self.tmp / "t", self.tmp / "a", self.tmp / "s.json", self.tmp / "r"
    def tearDown(self):
        ar.ARENA, ar.LEDGER, sp.DATA, sp.TR, sp.AL, sp.SPEND, sp.RAW = self.old

    def test_call_ends_on_the_end_marker_and_alternates_speakers(self):
        a = ar.Arena(Fake(), sleep=lambda s: None)
        lines = a.simulate("PROMPT", ar.PERSONAS[0])
        self.assertEqual(lines[0], {"speaker": "buyer", "text": "हेलो?"})
        self.assertEqual([l["speaker"] for l in lines], ["buyer", "bot", "buyer", "bot", "buyer", "bot"])
        self.assertNotIn("[END]", lines[-1]["text"])

    def test_every_line_is_spoken_with_the_right_voice_and_mp3_is_concatenated(self):
        f = Fake(); a = ar.Arena(f, sleep=lambda s: None); ar.ARENA.mkdir()
        lines = [{"speaker": "bot", "text": "नमस्ते"}, {"speaker": "buyer", "text": "हाँ"}]
        a.speak(lines, ar.PERSONAS[0], ar.ARENA / "x.mp3")
        self.assertEqual([t[1] for t in f.tts_texts], [ar.BOT_VOICE, ar.PERSONAS[0]["voice"]])
        self.assertEqual({t[2] for t in f.tts_texts}, {"bulbul:v3"})
        self.assertEqual((ar.ARENA / "x.mp3").read_bytes(), b"MP3ritu" + b"MP3rahul")
        self.assertGreater(ar.spent(), 0)

    def test_run_writes_cases_with_tags_is_cached_and_respects_the_budget(self):
        f = Fake(); a = ar.Arena(f, sleep=lambda s: None)
        r = a.run(budget=100)
        self.assertEqual(r["cases"], 3)
        data = ar.load(); self.assertEqual({c["key"] for c in data["cases"]}, {"cooperative", "busy", "unsure"})
        self.assertEqual(data["cases"][0]["B"]["tag"]["label"], "buylead_created")
        n = f.chat_n; a.run(budget=100); self.assertEqual(f.chat_n, n)               # cached: no new spend
        self.tmp2 = ar.LEDGER.read_text()
    def test_budget_cap_stops_before_a_case_that_would_cross_it(self):
        a = ar.Arena(Fake(), sleep=lambda s: None)
        r = a.run(budget=0.5)
        self.assertEqual(r["cases"], 0)

    def test_plan_is_free(self):
        p = ar.plan(); self.assertEqual(p["calls"], 6); self.assertGreater(p["total_inr"], 0); self.assertFalse(ar.LEDGER.exists())


if __name__ == "__main__":
    unittest.main()
