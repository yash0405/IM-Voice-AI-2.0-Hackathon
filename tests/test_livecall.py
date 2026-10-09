"""Live call test: exact statistics, the fairness rules (threshold, locked result, balanced secret order, blind mode), the log, and the server's
safety checks. No Sarvam network call is made: the one upstream request the server can make is pointed at a local stub."""
import csv
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from canary import livecall, livestats, liveserver
from canary.ledger import verify


def _calls(arm, good, n, dur=50.0, fatal=0):
    return [{"arm": arm, "status": "done", "good": i < good, "fatal": i < fatal, "duration_s": dur} for i in range(n)]


class Stats(unittest.TestCase):
    def test_fisher_known_value(self):
        # classic 2x2: 9/10 vs 3/10 -> two-sided p = 0.0198
        self.assertAlmostEqual(livestats.fisher_p(3, 10, 9, 10), 0.0198, places=3)

    def test_calls(self):
        c = livestats.call_for_counts
        self.assertEqual(c(3, 10, 9, 10, 0.10), "b_better")
        self.assertEqual(c(9, 10, 3, 10, 0.10), "a_better")
        self.assertEqual(c(5, 10, 5, 10, 0.10), "no_difference")
        self.assertEqual(c(5, 10, 6, 10, 0.10), "no_difference")
        self.assertEqual(c(0, 0, 0, 0, 0.10), "no_difference")

    def test_a_win_needs_both_tests(self):
        # wherever the exact test says significant the call is either a win or 'borderline', never a win on the exact test alone
        for xa in range(11):
            for xb in range(11):
                call = livestats.call_for_counts(xa, 10, xb, 10, 0.10)
                if call in ("b_better", "a_better"):
                    self.assertLess(livestats.fisher_p(xa, 10, xb, 10), 0.10)

    def test_false_win_never_exceeds_the_error_rate(self):
        for alpha in (0.20, 0.10, 0.05):
            for n in (3, 5, 10, 20):
                fw = livestats.false_win_rate(n, alpha)
                self.assertLessEqual(fw["wrong_call"], alpha + 1e-9, (alpha, n, fw))

    def test_power_grows_with_calls_and_gap(self):
        p = [livestats.power(n, 0.35, 0.65, 0.10) for n in (5, 10, 20, 40)]
        self.assertEqual(p, sorted(p))
        self.assertLess(livestats.power(10, 0.45, 0.55, 0.10), livestats.power(10, 0.2, 0.8, 0.10))
        g = [livestats.detectable_gap(n, 0.10) for n in (8, 15, 30)]
        self.assertTrue(g[0] > g[1] > g[2], g)

    def test_exact_probabilities_add_up(self):
        r = livestats.chance_of_call(8, 8, 0.4, 0.7, 0.10)
        self.assertAlmostEqual(r["b_wins"] + r["a_wins"] + r["no_call"], 1.0, places=9)

    def test_more_calls_is_exact_and_always_more_than_the_test_had(self):
        self.assertIsNone(livestats.more_calls(5, 10, 5, 10, 0.10))                         # no gap: nothing to confirm
        self.assertIsNone(livestats.more_calls(50, 100, 52, 100, 0.10))                     # 2 points: too small to matter
        n = livestats.more_calls(0, 3, 3, 3, 0.10)                                          # 0 of 3 vs 3 of 3 does not confirm itself
        self.assertGreater(n, 3)
        self.assertGreaterEqual(livestats.power(n, 0.125, 0.875, 0.10), 0.8)                # and the number it gives really reaches 80%
        small, big = livestats.more_calls(5, 10, 6, 10, 0.10), livestats.more_calls(3, 10, 8, 10, 0.10)
        self.assertGreater(small, big)                                                       # a smaller gap needs more calls

    def test_judge_verdicts(self):
        j = lambda a, b, **k: livestats.judge(livestats.summarise(a, "A"), livestats.summarise(b, "B"), 0.10, **k)
        self.assertEqual(j(_calls("A", 3, 10), _calls("B", 9, 10))["verdict"], "PROMOTE")
        self.assertEqual(j(_calls("A", 9, 10), _calls("B", 3, 10))["verdict"], "STOP_HARM")
        self.assertEqual(j(_calls("A", 5, 10), _calls("B", 5, 10))["verdict"], "INCONCLUSIVE")
        longer = j(_calls("A", 3, 10, dur=50), _calls("B", 9, 10, dur=70))                 # B wins but its calls run 40% longer
        self.assertEqual(longer["verdict"], "HOLD_FOR_APPROVAL")
        self.assertEqual(longer["guard_breached"], ["duration"])
        fatal = j(_calls("A", 3, 10), _calls("B", 9, 10, fatal=4))
        self.assertEqual(fatal["verdict"], "HOLD_FOR_APPROVAL")
        self.assertEqual(fatal["guard_breached"], ["fatal"])
        # a guardrail can never create a win
        self.assertEqual(j(_calls("A", 5, 10), _calls("B", 5, 10, dur=99))["verdict"], "INCONCLUSIVE")

    def test_interval_agrees_with_verdict(self):
        for xa in range(0, 11):
            for xb in range(0, 11):
                r = livestats.judge(livestats.summarise(_calls("A", xa, 10), "A"), livestats.summarise(_calls("B", xb, 10), "B"), 0.10)
                if r["verdict"] == "PROMOTE":
                    self.assertGreater(r["lo"], 0, (xa, xb))
                if r["verdict"] == "STOP_HARM":
                    self.assertLess(r["hi"], 0, (xa, xb))


class Env(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = {k: os.environ.get(k) for k in ("CANARY_LIVE_DIR", "SARVAM_VOICE_API_KEY", "SARVAM_ORG_ID", "SARVAM_WORKSPACE_ID")}
        os.environ["CANARY_LIVE_DIR"] = self.tmp.name
        for k in ("SARVAM_VOICE_API_KEY", "SARVAM_ORG_ID", "SARVAM_WORKSPACE_ID"):
            os.environ.pop(k, None)
        self._env_files = livecall._env_files
        livecall._env_files = lambda: []                       # never read a real .env in tests

    def tearDown(self):
        livecall._env_files = self._env_files
        for k, v in self.old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()

    def make(self, n=3, blind=True, conf=0.90, cand=None):
        return livecall.create_test({"name": "t", "calls_per_arm": n, "blind": blind, "confidence": conf, "candidate": cand or livecall.default_candidate()})

    def play(self, t, plan, dur=40.0):
        """plan(arm) -> (good, fatal, duration). Plays every call through the real API; returns the final public view."""
        tid, last = t["id"], t
        while True:
            try:
                r = livecall.next_call(tid, "manual")
            except livecall.LiveError:
                break
            cid = r["call"]["id"]
            arm = livecall._load(tid)["calls"][-1]["arm"]
            livecall.start_call(tid, cid)
            g, f, d = plan(arm)
            livecall.end_call(tid, cid, {"duration_s": d})
            out = livecall.signal(tid, cid, {"good": g, "fatal": f})
            last = out["test"]
            if out["released"]:
                break
        return last


class Lifecycle(Env):
    def test_sequence_is_balanced_in_every_pair(self):
        t = self.make(n=10)
        seq = livecall._load(t["id"])["secret"]["sequence"]
        self.assertEqual(len(seq), 20)
        for i in range(0, 20, 2):
            self.assertEqual(sorted(seq[i:i + 2]), ["A", "B"])

    def test_result_is_locked_until_the_threshold(self):
        t = self.make(n=3)
        tid = t["id"]
        plan = lambda arm: (arm == "B", False, 40.0)
        for _ in range(5):                                     # 5 of 6 calls
            r = livecall.next_call(tid, "manual")
            arm = livecall._load(tid)["calls"][-1]["arm"]
            livecall.start_call(tid, r["call"]["id"])
            livecall.end_call(tid, r["call"]["id"], {"duration_s": 40})
            out = livecall.signal(tid, r["call"]["id"], {"good": plan(arm)[0]})
            self.assertFalse(out["released"])
            view = json.dumps(out["test"])
            for leaked in ('"result"', '"good"', '"sequence"', '"salt"', '"reveal"', '"arm"'):
                self.assertNotIn(leaked, view, leaked)
            self.assertEqual(out["test"]["state"], "running")
            with self.assertRaises(livecall.LiveError):
                livecall.export_csv(tid)
        r = livecall.next_call(tid, "manual")
        livecall.start_call(tid, r["call"]["id"]); livecall.end_call(tid, r["call"]["id"], {"duration_s": 40})
        out = livecall.signal(tid, r["call"]["id"], {"good": True})
        self.assertTrue(out["released"])
        self.assertEqual(out["test"]["state"], "released")

    def test_each_prompt_gets_exactly_the_planned_calls(self):
        t = self.play(self.make(n=4), lambda arm: (arm == "B", False, 40.0))
        self.assertEqual({p["done"] for p in t["progress"]}, {4})
        self.assertEqual(sorted(c["arm"] for c in t["calls"]), ["A"] * 4 + ["B"] * 4)

    def test_verdict_follows_the_signals(self):
        t = self.play(self.make(n=10), lambda arm: (arm == "B", False, 40.0))          # B always good, A never
        self.assertEqual(t["result"]["verdict"], "PROMOTE")
        t = self.play(self.make(n=10), lambda arm: (arm == "A", False, 40.0))
        self.assertEqual(t["result"]["verdict"], "STOP_HARM")
        t = self.play(self.make(n=10), lambda arm: (True, False, 40.0))
        self.assertEqual(t["result"]["verdict"], "INCONCLUSIVE")

    def test_guardrail_sends_a_win_to_a_person(self):
        t = self.play(self.make(n=10), lambda arm: (arm == "B", False, 40.0 if arm == "A" else 70.0))
        self.assertEqual(t["result"]["verdict"], "HOLD_FOR_APPROVAL")

    def test_void_reissues_the_same_prompt_and_does_not_count(self):
        t = self.make(n=3)
        tid = t["id"]
        r = livecall.next_call(tid, "manual")
        arm1 = livecall._load(tid)["calls"][-1]["arm"]
        livecall.void_call(tid, r["call"]["id"], "no sound")
        r2 = livecall.next_call(tid, "manual")
        self.assertEqual(livecall._load(tid)["calls"][-1]["arm"], arm1)
        self.assertEqual(r2["call"]["n"], 1)
        with self.assertRaises(livecall.LiveError):
            livecall.void_call(tid, r2["call"]["id"], "")                       # a reason is required

    def test_next_call_is_idempotent(self):
        t = self.make(n=3)
        a = livecall.next_call(t["id"], "sdk")["call"]["id"]
        b = livecall.next_call(t["id"], "sdk")["call"]["id"]
        self.assertEqual(a, b)

    def test_blind_labels_hide_the_arm_until_release(self):
        t = self.make(n=3, blind=True)
        r = livecall.next_call(t["id"], "sdk")
        self.assertIn(r["call"]["label"], ("Line 1", "Line 2"))
        self.assertNotIn("arm", r["call"])
        t2 = self.make(n=3, blind=False) if False else None
        done = self.play(t, lambda arm: (arm == "B", False, 40.0))
        lab = done["reveal"]["labels"]
        self.assertEqual(sorted(lab.values()), ["Line 1", "Line 2"])
        self.assertEqual({c["label"] for c in done["calls"] if c["arm"] == "B"}, {lab["B"]})

    def test_one_running_test_at_a_time_and_abandon(self):
        t = self.make(n=3)
        with self.assertRaises(livecall.LiveError):
            self.make(n=3)
        with self.assertRaises(livecall.LiveError):
            livecall.abandon(t["id"], "")
        out = livecall.abandon(t["id"], "mic broke")
        self.assertEqual(out["state"], "abandoned")
        self.assertNotIn("result", out)
        self.make(n=3)                                                           # a new one can start now

    def test_plan_is_validated(self):
        for bad in ({"calls_per_arm": 2}, {"calls_per_arm": 500}, {"calls_per_arm": "x"}, {"calls_per_arm": 10, "confidence": 0.5}):
            with self.assertRaises(livecall.LiveError):
                livecall.validate_plan(bad)
        self.assertEqual(livecall.validate_plan({"calls_per_arm": 10, "confidence": 95})["alpha"], 0.05)

    def test_signal_needs_a_decision(self):
        t = self.make(n=3)
        r = livecall.next_call(t["id"], "manual")
        cid = r["call"]["id"]
        with self.assertRaises(livecall.LiveError):
            livecall.signal(t["id"], cid, {"good": True})                        # not ended yet
        livecall.start_call(t["id"], cid); livecall.end_call(t["id"], cid, {"duration_s": 30})
        with self.assertRaises(livecall.LiveError):
            livecall.signal(t["id"], cid, {})
        with self.assertRaises(livecall.LiveError):
            livecall.end_call(t["id"], cid, {})                                  # cannot end twice
        with self.assertRaises(livecall.LiveError):
            livecall.start_call(t["id"], "c999")

    def test_manual_duration_is_validated(self):
        t = self.make(n=3)
        r = livecall.next_call(t["id"], "manual"); cid = r["call"]["id"]
        livecall.start_call(t["id"], cid)
        for bad in ("abc", -5, 99999):
            with self.assertRaises(livecall.LiveError):
                livecall.end_call(t["id"], cid, {"duration_s": bad})

    def test_log_is_chained_and_tampering_is_detected(self):
        t = self.play(self.make(n=3), lambda arm: (arm == "B", False, 40.0))
        raw = livecall._load(t["id"])
        self.assertTrue(verify(raw["ledger"])[0])
        types = [json.loads(e["body"])["type"] for e in raw["ledger"]]
        self.assertEqual(types[0], "test_locked"); self.assertEqual(types[-1], "result_released"); self.assertEqual(types.count("call_logged"), 6)
        lock = json.loads(raw["ledger"][0]["body"])["payload"]
        self.assertEqual(lock["config"]["calls_per_arm"], 3)
        com = livecall._commit(raw["secret"]["sequence"], raw["secret"]["labels"], raw["secret"]["salt"])
        self.assertEqual(com, lock["sequence_commitment"])                       # the revealed order matches what was committed before call 1
        first = json.loads(raw["ledger"][1]["body"])["payload"]
        self.assertTrue({"arm", "good", "fatal", "duration_s"} <= set(first))
        raw["ledger"][1]["body"] = raw["ledger"][1]["body"].replace('"good":' + ("true" if first["good"] else "false"), '"good":' + ("false" if first["good"] else "true"), 1)
        self.assertFalse(verify(raw["ledger"])[0])                                # flipping one signal after the fact breaks the chain

    def test_csv_export_reads_back(self):
        t = self.play(self.make(n=3), lambda arm: (arm == "B", arm == "A", 42.5))
        text = livecall.export_csv(t["id"])
        rows = list(csv.DictReader(io.StringIO(text)))
        self.assertEqual(len(rows), 6)
        self.assertEqual({r["variant"] for r in rows}, {"A", "B"})
        self.assertTrue(all(r["goal_hit"] == ("1" if r["variant"] == "B" else "0") for r in rows))
        from canary import decide
        info = decide.inspect(text, "live.csv")                                   # the main engine can read the same file
        self.assertIn("variant", json.dumps(info))

    def test_connection_validation_and_key_stays_server_side(self):
        with self.assertRaises(livecall.LiveError):
            livecall.save_connection({"org_id": "bad id with spaces"})
        os.environ["SARVAM_VOICE_API_KEY"] = "sk_test_SECRET"
        c = livecall.save_connection({"org_id": "o1", "workspace_id": "w1", "arms": {"A": {"app_id": "appA", "version": "1"}, "B": {"app_id": "appB", "version": "2"}}})
        self.assertTrue(c["ready"])
        self.assertNotIn("SECRET", json.dumps(c))
        self.assertNotIn("SECRET", json.dumps(livecall.connection()))
        self.assertNotIn("SECRET", open(os.path.join(self.tmp.name, "connection.json")).read())


class Prompts(Env):
    def test_changes_are_short_and_marked(self):
        ch = livecall.changes("cap_two_asks")
        self.assertGreaterEqual(len(ch), 5)
        for c in ch:
            self.assertTrue(any(m for _, m in c["before"]) and any(m for _, m in c["after"]))
            self.assertLess(sum(len(t) for t, _ in c["after"]), 400)

    def test_agent_prompts_render_and_differ_only_by_the_patch(self):
        a, b = livecall.agent_prompt("A", "cap_two_asks"), livecall.agent_prompt("B", "cap_two_asks")
        self.assertIn("stainless steel pipes", a)
        self.assertNotIn("{{", a); self.assertNotIn("{%", a)
        self.assertNotIn("product_name", a); self.assertNotIn("bot_name", a)             # the bare platform variables are filled in
        self.assertNotEqual(a, b)
        self.assertEqual(livecall.agent_prompt("A", "cap_two_asks"), livecall.agent_prompt("A", "whatsapp_after_call"))
        with self.assertRaises(livecall.LiveError):
            livecall.prompt_pair("nope")


class Server(Env):
    """The HTTP layer with the real handler, against a stub standing in for apps.sarvam.ai."""
    def setUp(self):
        super().setUp()
        seen = self.seen = []

        class Stub(BaseHTTPRequestHandler):
            def log_message(self, *a): pass
            def do_GET(self):
                seen.append({"path": self.path, "key": self.headers.get("X-API-Key")})
                body = json.dumps({"url": "wss://stub.invalid/ws", "reference_id": "ref1"}).encode()
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        self.stub = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=self.stub.serve_forever, daemon=True).start()
        self.old_base = liveserver.RUNTIME_BASE
        liveserver.RUNTIME_BASE = f"http://127.0.0.1:{self.stub.server_address[1]}/api/app-runtime/"
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), liveserver.H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}"
        os.environ["SARVAM_VOICE_API_KEY"] = "sk_test_SECRETKEY"
        livecall.save_connection({"org_id": "o1", "workspace_id": "w1", "arms": {"A": {"app_id": "appA", "version": "1"}, "B": {"app_id": "appB", "version": "2"}}})

    def tearDown(self):
        self.srv.shutdown(); self.stub.shutdown(); self.srv.server_close(); self.stub.server_close(); liveserver.RUNTIME_BASE = self.old_base
        super().tearDown()

    def req(self, path, body=None, headers=None, method=None):
        h = dict(headers or {})
        data = None
        if body is not None:
            data = json.dumps(body).encode(); h.setdefault("Content-Type", "application/json")
        r = urllib.request.Request(self.base + path, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(r, timeout=10) as x:
                return x.status, x.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def test_state_never_contains_the_key(self):
        code, body = self.req("/api/live/state")
        self.assertEqual(code, 200)
        self.assertNotIn(b"SECRETKEY", body)
        self.assertTrue(json.loads(body)["connection"]["ready"])

    def test_proxy_adds_the_key_server_side_and_returns_only_the_signed_url(self):
        code, body = self.req("/sarvam/orgs/o1/workspaces/w1/apps/appA/url?interaction_type=call&version=1&evil=1", headers={"X-API-Key": "from-the-browser"})
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)["reference_id"], "ref1")
        self.assertEqual(self.seen[-1]["key"], "sk_test_SECRETKEY")                       # the server's key, not whatever the page sent
        self.assertNotIn("evil", self.seen[-1]["path"])                                   # only whitelisted query fields are forwarded
        self.assertIn("version=1", self.seen[-1]["path"])
        self.assertNotIn(b"SECRETKEY", body)

    def test_proxy_refuses_agents_that_are_not_configured(self):
        n = len(self.seen)
        for p in ("/sarvam/orgs/o1/workspaces/w1/apps/other/url", "/sarvam/orgs/o2/workspaces/w1/apps/appA/url", "/sarvam/orgs/o1/workspaces/w9/apps/appA/url"):
            self.assertEqual(self.req(p)[0], 403, p)
        self.assertEqual(len(self.seen), n)

    def test_other_hosts_and_cross_site_posts_are_refused(self):
        self.assertEqual(self.req("/api/live/state", headers={"Host": "evil.example.com"})[0], 403)
        self.assertEqual(self.req("/api/live/test", {"calls_per_arm": 3}, headers={"Origin": "https://evil.example.com"})[0], 403)
        r = urllib.request.Request(self.base + "/api/live/test", data=b'{"calls_per_arm":3}', headers={"Content-Type": "text/plain"})
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(r, timeout=10)
        self.assertEqual(cm.exception.code, 403)
        self.assertEqual(livecall.list_tests(), [])

    def test_full_flow_over_http(self):
        code, body = self.req("/api/live/test", {"name": "http", "calls_per_arm": 3, "confidence": 90, "blind": True}, headers={"Origin": self.base})
        self.assertEqual(code, 200)
        t = json.loads(body); tid = t["id"]
        for _ in range(6):
            code, body = self.req(f"/api/live/test/{tid}/call", {"source": "manual"}); self.assertEqual(code, 200)
            cid = json.loads(body)["call"]["id"]
            self.req(f"/api/live/test/{tid}/call/{cid}/start", {})
            self.req(f"/api/live/test/{tid}/call/{cid}/end", {"duration_s": 30})
            code, body = self.req(f"/api/live/test/{tid}/call/{cid}/signal", {"good": True})
            self.assertEqual(code, 200)
        self.assertTrue(json.loads(body)["released"])
        code, csv_body = self.req(f"/api/live/test/{tid}/csv"); self.assertEqual(code, 200); self.assertIn(b"call_id,lead_id", csv_body)
        code, _ = self.req(f"/api/live/test/{tid}/call", {"source": "manual"}); self.assertEqual(code, 400)       # no calls after release

    def test_connection_check_uses_the_stub_and_places_no_call(self):
        code, body = self.req("/api/live/check", {})
        self.assertEqual(code, 200)
        res = json.loads(body)
        self.assertTrue(res["all_ok"], res)
        self.assertTrue(all(s["path"].endswith("/url?interaction_type=call&version=1") or s["path"].endswith("/url?interaction_type=call&version=2") for s in self.seen))

    def test_prompt_downloads(self):
        code, body = self.req("/api/live/prompt/B?candidate=cap_two_asks")
        self.assertEqual(code, 200)
        self.assertIn(b"stainless steel pipes", body)
        self.assertEqual(self.req("/api/live/prompt/C")[0], 404)


if __name__ == "__main__":
    unittest.main()
