"""Credit-protection tests for the Sarvam pipeline, using a fake client (no network, no spend)."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from picky import sarvam_pipe as sp


class FakeJob:
    def __init__(self, ok=True, text="buyer needs 500 pieces"):
        self.ok, self.text, self.paths = ok, text, []
    def upload_files(self, paths): self.paths = paths; return True
    def start(self): pass
    def wait_until_complete(self, poll_interval=5, timeout=600): pass
    def is_successful(self): return self.ok
    def get_output_mappings(self): return [{"input_file": Path(p).name, "output_file": Path(p).name + ".json"} for p in self.paths]
    def download_outputs(self, d):
        for p in self.paths:
            (Path(d) / (Path(p).name + ".json")).write_text(json.dumps({"transcript": self.text, "language_code": "hi-IN"}))
        return True


class FakeClient:
    def __init__(self, ok=True, replies=None):
        self.jobs, self.chat_calls, self.ok = 0, 0, ok
        self.replies = replies or ['{"label":"buylead_created","fields":["quantity","location"],"bot_error":false,"confidence":0.9,"evidence":"500 pieces"}']
        client = self
        class STT:
            def create_job(self, **kw): client.jobs += 1; return FakeJob(client.ok)
        class Comp:
            def completions(self, **kw):
                client.chat_calls += 1
                txt = client.replies[min(client.chat_calls - 1, len(client.replies) - 1)]
                if isinstance(txt, Exception): raise txt
                return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=txt), finish_reason="stop")],
                                       usage=SimpleNamespace(prompt_tokens=1000, completion_tokens=100))
        self.speech_to_text_job, self.chat = STT(), SimpleNamespace(completions=Comp().completions)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "call_durations.json").write_text(json.dumps([{"idx": i, "file": f"{i}_x.mp3", "duration_s": 60.0} for i in range(1, 61)]))
        self.old = {k: getattr(sp, k) for k in ("DATA", "TR", "AL", "SPEND", "QUEUE", "RAW", "DL")}
        sp.DATA, sp.TR, sp.AL = self.tmp, self.tmp / "transcripts", self.tmp / "auto_labels"
        sp.SPEND, sp.QUEUE, sp.RAW, sp.DL = self.tmp / "spend.json", self.tmp / "queue.json", self.tmp / "raw", self.tmp / "dl"
    def tearDown(self):
        for k, v in self.old.items(): setattr(sp, k, v)


class Pipeline(Base):
    def test_plan_is_free_and_priced_per_audio_hour(self):
        p = sp.plan(30)                                    # 30 calls x 60 s = 0.5 h
        self.assertAlmostEqual(p["stt_inr"], 15.0, places=2)
        self.assertEqual(p["to_transcribe"], 30)
        self.assertFalse(sp.SPEND.exists())               # planning spends nothing

    def test_budget_is_a_hard_cap_and_stops_before_the_batch_that_would_cross_it(self):
        c = FakeClient(); pipe = sp.Pipe(c, sleep=lambda s: None)
        r = pipe.transcribe(60, budget=12.0)               # one 20-call batch = Rs 10, a second would reach Rs 20
        self.assertEqual(c.jobs, 1)
        self.assertEqual(r["transcribed"], 20)
        self.assertLessEqual(sp._load_spend()["inr"], 12.0)

    def test_rerun_never_pays_twice_for_the_same_call(self):
        c = FakeClient(); pipe = sp.Pipe(c, sleep=lambda s: None)
        pipe.transcribe(20, budget=100); spent = sp._load_spend()["inr"]
        pipe.transcribe(20, budget=100)
        self.assertEqual(c.jobs, 1)
        self.assertEqual(sp._load_spend()["inr"], spent)

    def test_failed_batches_are_recorded_and_not_retried_automatically(self):
        c = FakeClient(ok=False); pipe = sp.Pipe(c, sleep=lambda s: None)
        pipe.transcribe(20, budget=100); pipe.transcribe(20, budget=100)
        self.assertEqual(c.jobs, 1)

    def test_outputs_are_matched_even_when_sarvam_names_them_differently_and_downloads_are_kept(self):
        class OddJob(FakeJob):
            job_id = "job-123"
            def get_output_mappings(self): return []                       # no mapping from the API
            def download_outputs(self, d):
                for i, p in enumerate(self.paths):
                    (Path(d) / "nested").mkdir(exist_ok=True)
                    (Path(d) / "nested" / f"{Path(p).stem}.txt.json").write_text(json.dumps({"transcript": "hello"}))
                return True
        c = FakeClient(); c.speech_to_text_job.create_job = lambda **kw: OddJob()
        r = sp.Pipe(c, sleep=lambda s: None).transcribe(3, budget=100)
        self.assertEqual(r["transcribed"], 3)
        self.assertTrue((sp.DL / "job-123").exists())                       # kept for free debugging
        self.assertEqual(sp._load_spend()["events"][0]["job"], "job-123")

    def test_a_single_input_matches_its_only_output_whatever_it_is_called(self):
        class OneJob(FakeJob):
            def get_output_mappings(self): raise RuntimeError("no mapping endpoint")
            def download_outputs(self, d): (Path(d) / "0.json").write_text(json.dumps({"text": "hello there"})); return True
        c = FakeClient(); c.speech_to_text_job.create_job = lambda **kw: OneJob()
        self.assertEqual(sp.Pipe(c, sleep=lambda s: None).transcribe(1, budget=100)["transcribed"], 1)

    def test_prefix_of_the_fixed_order_is_stable(self):
        a = [r["idx"] for r in sp.order()[:10]]
        self.assertEqual(a, [r["idx"] for r in sp.order()[:10]])
        self.assertEqual(len(set(r["idx"] for r in sp.order())), 60)

    def test_tagging_parses_json_counts_tokens_and_survives_bad_replies(self):
        c = FakeClient(replies=['noise {"label":"buylead_created","fields":["quantity","bogus"],"confidence":0.8,"bot_issues":["looping_behavior"]} noise',
                                'not json at all', '{"label":"made_up"}', RuntimeError("boom")])
        pipe = sp.Pipe(c, sleep=lambda s: None); pipe.transcribe(4, budget=100)
        r = pipe.tag(4, budget=100)
        self.assertEqual(r["tagged"] + r["failed"], 4)
        ok = sp.labelled()
        self.assertEqual(len(ok), 1)
        self.assertEqual(ok[0]["fields"], ["quantity"])    # unknown field dropped
        self.assertTrue(ok[0]["bot_error"])
        self.assertGreater(sp._load_spend()["llm_in"], 0)

    def test_rich_labels_are_validated_against_the_taxonomy_and_thinking_is_off(self):
        seen = {}
        c = FakeClient(replies=['{"label":"buylead_created","confidence":0.7,"fields":["quantity"],"captured":{"product":"steel pipes","quantity":"500","city":null},'
                                '"language":"hinglish","call_end":"buyer_hung_up","sentiment":"frustrated","buyer_requests":["price_query","nonsense"],'
                                '"bot_issues":["looping_behavior","made_up_issue"],"fatal":"oncall_fatal","fix_hint":"Do not ask the same question twice.","evidence":"x",'
                                '"transfer":{"offered":true,"accepted":false},"flow":"inbound_redirect"}'])
        orig = c.chat.completions
        def spy(**kw): seen.update(kw); return orig(**kw)
        c.chat = SimpleNamespace(completions=spy)
        pipe = sp.Pipe(c, sleep=lambda s: None); pipe.transcribe(1, budget=100); pipe.tag(1, budget=100)
        d = sp.labelled()[0]
        self.assertIsNone(seen["reasoning_effort"])
        self.assertEqual(d["bot_issues"], ["looping_behavior"]); self.assertEqual(d["buyer_requests"], ["price_query"])
        self.assertEqual((d["schema"], d["flow"], d["overall_call"], d["transfer"]), (2, "inbound_redirect", "fatal", {"offered": True, "accepted": False}))
        self.assertEqual((d["fatal"], d["language"], d["call_end"]), ("oncall_fatal", "hinglish", "buyer_hung_up"))
        self.assertTrue(d["bot_error"]); self.assertEqual(d["captured"]["quantity"], "500"); self.assertIsNone(d["captured"]["city"])
        self.assertEqual(sp.backlog()["issue_counts"], {"looping_behavior": 1})
        self.assertIn("rich", sp.report())

    def test_diarized_output_becomes_one_line_per_speaker_turn_and_costs_more(self):
        self.assertAlmostEqual(sp.plan(30, diarize=True)["stt_inr"], 22.5, places=2)       # 0.5 h at Rs 45/h
        text = sp._pick_diarized({"diarized_transcript": {"entries": [{"speaker_id": "0", "transcript": "hello"}, {"speaker_id": "1", "transcript": "haan"}]}})
        self.assertEqual(text.splitlines(), ["[Speaker 0] hello", "[Speaker 1] haan"])

    def test_silence_becomes_a_free_no_conversation_label_without_a_model_call(self):
        class SilentJob(FakeJob):
            def download_outputs(self, d):
                for p in self.paths: (Path(d) / (Path(p).name + ".json")).write_text(json.dumps({"transcript": "", "diarized_transcript": {"entries": []}}))
                return True
        c = FakeClient(); c.speech_to_text_job.create_job = lambda **kw: SilentJob()
        pipe = sp.Pipe(c, sleep=lambda s: None, diarize=True)
        self.assertEqual(pipe.transcribe(2, budget=100)["failed"], 0)
        pipe.tag(2, budget=100)
        self.assertEqual(c.chat_calls, 0)
        self.assertEqual({d["label"] for d in sp.labelled()}, {"no_connect"})

    def test_rate_limit_backs_off_then_succeeds(self):
        c = FakeClient(replies=[RuntimeError("429 Too Many Requests"), '{"label":"other","confidence":0.4}'])
        waits = []; pipe = sp.Pipe(c, sleep=waits.append); pipe.transcribe(1, budget=100); pipe.tag(1, budget=100)
        self.assertIn(20, waits); self.assertEqual(len(sp.labelled()), 1)

    def test_review_queue_has_a_blind_random_set_and_the_least_confident_calls(self):
        c = FakeClient(replies=['{"label":"other","confidence":0.5}']); pipe = sp.Pipe(c, sleep=lambda s: None)
        pipe.transcribe(40, budget=1000); pipe.tag(40, budget=1000)
        for i, f in enumerate(sorted(sp.AL.glob("*.json"))):    # give half of them a low confidence
            d = json.loads(f.read_text()); d["confidence"] = 0.1 if i < 5 else 0.9; f.write_text(json.dumps(d))
        q = sp.make_queue(n_blind=10, n_hard=5)
        self.assertEqual(len(q["blind"]), 10); self.assertEqual(len(q["hard"]), 5)
        self.assertFalse(set(q["blind"]) & set(q["hard"]))

    def test_nothing_is_printed_from_transcripts(self):
        import io, contextlib
        c = FakeClient(text="SECRET-BUYER-WORDS") if False else FakeClient(); pipe = sp.Pipe(c, sleep=lambda s: None)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            pipe.transcribe(20, budget=100); pipe.tag(20, budget=100)
        self.assertNotIn("buyer needs", buf.getvalue())

    def test_key_is_read_from_env_file_without_being_exposed(self):
        import os
        old = os.environ.pop("SARVAM_API_KEY", None)
        try:
            (self.tmp / ".env").write_text("SARVAM_API_KEY=abc123\n")
            oldroot = sp.ROOT; sp.ROOT = self.tmp
            self.assertEqual(sp.load_key(), "abc123")
            sp.ROOT = oldroot
        finally:
            if old: os.environ["SARVAM_API_KEY"] = old


if __name__ == "__main__":
    unittest.main()
