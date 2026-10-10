"""The history database (picky/store.py) and its endpoints on the live server: tests, state, clicks, the decision record, reset, locking."""
import copy
import json
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from picky import build, server, store
from picky.ledger import verify

ROOT = Path(__file__).resolve().parent.parent


def bundle() -> dict:
    cached = build.OUT / "console_bundle.json"
    return json.loads(cached.read_text()) if cached.exists() else build.build_console_bundle()


B = bundle()
DEMO = {e["id"]: e for e in B["demo"]}


def launched(src_id="demo_win", new_id="exp-store-test", prompt_len=30000) -> dict:
    """A launched test as the console sends it: an engine record plus the console's own fields (prompt B text included)."""
    d = copy.deepcopy(DEMO[src_id])
    d.update(id=new_id, start_day=1, scheduled=False, prompt_b="B prompt " + "x" * prompt_len, prompt_a={"id": "v1", "hash": "abc"}, world="main")
    return d


def st(day, **kw) -> dict:
    return {"day": day, "paused": False, "approval": None, "rolledBack": False, "manualStop": False, "learning": "", **kw}


class StoreBase(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.db = Path(self.td.name) / "h.db"
        store.seed(B, self.db)
        self.epoch = store.load(self.db)["epoch"]
        self.revs = {}                                  # like a browser: the rev of every item it last saw

    def tearDown(self):
        self.td.cleanup()

    def q(self, sql, *a):
        con = sqlite3.connect(self.db)
        try:
            return con.execute(sql, a).fetchall()
        finally:
            con.close()

    def put(self, revs=None, **body):
        keys = [f"s:{k}" for k in body.get("state", {})] + [f"a:{k}" for k in body.get("app", {})]
        out = store.apply({"epoch": self.epoch, "revs": revs if revs is not None else {k: self.revs.get(k, 0) for k in keys}, **body}, self.db)
        self.revs.update(out["revs"])
        return out


class Seed(StoreBase):
    def test_every_demo_test_and_sample_is_stored_once(self):
        self.assertEqual(dict(self.q("SELECT origin, COUNT(*) FROM experiments GROUP BY origin")), {"demo": len(B["demo"]), "sample": len(B["past"])})
        self.assertEqual(store.seed(B, self.db), {"added": 0, "replaced": 0})          # a second start writes nothing

    def test_demo_tests_start_running_and_samples_are_finished(self):
        rows = dict(self.q("SELECT id, status FROM experiments"))
        self.assertTrue(all(rows[k] == "Running" for k in DEMO))
        self.assertTrue(all(rows[e["id"]] in ("Completed", "Stopped") for e in B["past"]))

    def test_daily_results_and_versions_follow_the_record(self):
        e = DEMO["demo_win"]
        days = {r["day"] for r in e["record"]["looks"]}
        self.assertEqual(self.q("SELECT COUNT(*) FROM daily_results WHERE experiment_id = 'demo_win'")[0][0], 2 * len(days))
        (cfg_hash,), = self.q("SELECT config_hash FROM experiment_versions WHERE experiment_id = 'demo_win'")
        self.assertEqual(cfg_hash, e["record"]["config_hash"])

    def test_a_rebuilt_record_replaces_the_old_one_and_keeps_the_state(self):
        self.put(state={"demo_flat": st(5)})
        b2 = copy.deepcopy(B)
        flat = next(e for e in b2["demo"] if e["id"] == "demo_flat")
        flat["record"] = copy.deepcopy(DEMO["demo_win"]["record"])                    # a different, valid record under the same id
        rev = self.revs["s:demo_flat"]
        self.assertEqual(store.seed(b2, self.db), {"added": 0, "replaced": 1})
        got = store.load(self.db)
        self.assertEqual((got["dyn"]["demo_flat"]["day"], got["revs"]["s:demo_flat"]), (5, rev + 1))
        with self.assertRaises(store.Conflict):                                       # a tab left open across the rebuild is stale
            self.put(revs={"s:demo_flat": rev}, state={"demo_flat": st(6)})


class Launch(StoreBase):
    def test_a_launched_test_comes_back_exactly_as_sent(self):
        d = launched()
        out = self.put(tests=[d], state={d["id"]: st(1, started=True, hold=0)})
        self.assertEqual((out["tests_added"], out["actions"]), (1, 0))
        got = store.load(self.db)
        self.assertEqual(got["launched"], [d])
        self.assertEqual(got["dyn"][d["id"]], st(1, started=True, hold=0))
        self.assertEqual([r[0] for r in self.q("SELECT action FROM actions")], ["launch"])

    def test_a_long_prompt_is_stored_once(self):
        a, b = launched(new_id="exp-1"), launched(new_id="exp-2")
        self.put(tests=[a, b], app={"drafts": [{"id": "d1", "promptB": a["prompt_b"]}]})
        self.assertEqual(self.q("SELECT COUNT(*) FROM prompt_texts")[0][0], 1)
        got = store.load(self.db)
        self.assertEqual(got["app"]["drafts"][0]["promptB"], a["prompt_b"])
        self.assertEqual([x["id"] for x in got["launched"]], ["exp-2", "exp-1"])     # newest first

    def test_sending_the_same_test_again_changes_nothing(self):
        d = launched()
        self.put(tests=[d])
        self.assertEqual(self.put(tests=[d])["tests_added"], 0)
        self.assertEqual(self.q("SELECT COUNT(*) FROM actions")[0][0], 1)

    def test_a_launched_test_is_locked(self):
        self.put(tests=[launched()])
        other = launched()
        other["record"] = copy.deepcopy(DEMO["demo_worse"]["record"])
        self.assertIn("locked", self.put(tests=[other])["rejected"][0]["error"])
        self.assertEqual(store.load(self.db)["launched"][0]["record"]["ledger_head"], DEMO["demo_win"]["record"]["ledger_head"])

    def test_a_browser_cannot_overwrite_a_demo_test(self):
        self.assertIn("server only", self.put(tests=[DEMO["demo_win"]])["rejected"][0]["error"])

    def test_a_changed_decision_record_is_refused(self):
        d = launched()
        body = json.loads(d["record"]["ledger"][1]["body"])
        body["ts"] = "2026-01-01T00:00:00"
        d["record"]["ledger"][1]["body"] = json.dumps(body)
        out = self.put(tests=[d], state={d["id"]: st(1)})
        self.assertIn("does not verify", out["rejected"][0]["error"])
        self.assertEqual(out["skipped"], [d["id"]])                                   # its state is not stored either
        self.assertEqual(self.q("SELECT COUNT(*) FROM experiments WHERE origin = 'launched'")[0][0], 0)    # nothing half-written

    def test_one_broken_test_does_not_block_the_rest_of_the_save(self):
        broken = launched(new_id="exp-old")
        del broken["record"]["ledger_head"]                                           # e.g. a test saved by an older version of the console
        out = self.put(tests=[broken, launched(new_id="exp-good")], state={"demo_flat": st(3)})
        self.assertEqual(([r["id"] for r in out["rejected"]], out["tests_added"], out["states"]), (["exp-old"], 1, 1))

    def test_bad_ids_and_shapes(self):
        for body in ({"tests": [{**launched(), "id": "a b"}]}, {"tests": [{"id": "x"}]}, {"tests": ["x"]}):
            self.assertEqual(len(self.put(**body)["rejected"]), 1)                    # a bad test is rejected on its own
        for body in ({"app": {"ui": {}}}, {"state": {"demo_win": 5}}, {"tests": {"x": 1}}, {"revs": [1]}):
            with self.assertRaises(store.StoreError):                               # a malformed save is refused whole
                self.put(**body)

    def test_a_scheduled_test_shows_scheduled_until_started(self):
        d = {**launched(), "scheduled": True}
        self.put(tests=[d], state={d["id"]: st(1, started=False, hold=0)})
        self.assertEqual(self.q("SELECT status FROM experiments WHERE id = ?", d["id"])[0][0], "Scheduled")
        self.put(state={d["id"]: st(1, started=True, hold=0)})
        self.assertEqual(self.q("SELECT status FROM experiments WHERE id = ?", d["id"])[0][0], "Running")
        self.assertEqual(self.q("SELECT action FROM actions ORDER BY id")[-1][0], "start")

    def test_nan_and_a_lone_surrogate_are_stored_safely(self):
        self.put(state={"demo_flat": st(3, learning="pasted \ud800 text", score=float("nan"), big=float("inf"))})
        got = store.load(self.db)["dyn"]["demo_flat"]
        self.assertEqual((got["learning"], got["score"], got["big"]), ("pasted \ufffd text", None, None))
        json.loads(json.dumps(store.load(self.db), allow_nan=False))                  # what the browser receives is valid JSON
        self.put(state={"demo_flat": st(4)})                                         # and later saves still work

    def test_state_for_an_unknown_test_is_skipped(self):
        self.assertEqual(self.put(state={"replay-1": st(1)})["skipped"], ["replay-1"])


class Clicks(StoreBase):
    def log_ok(self, exp_id):
        rows = self.q("SELECT body, prev_hash, entry_hash FROM decision_log WHERE experiment_id = ? ORDER BY seq", exp_id)
        self.assertTrue(verify([{"body": b, "prev": p, "hash": h} for b, p, h in rows])[0])
        return len(rows)

    def status(self, exp_id):
        return self.q("SELECT status, outcome, decision FROM experiments WHERE id = ?", exp_id)[0]

    def test_play_to_the_end_then_approve_a_held_test(self):
        n0 = self.log_ok("demo_hold")
        self.put(state={"demo_hold": st(7)})
        self.assertEqual(self.status("demo_hold"), ("Awaiting approval", "Held for approval", "HOLD_FOR_APPROVAL"))
        self.put(state={"demo_hold": st(7, approval="approved")})
        self.assertEqual(self.status("demo_hold"), ("Completed", "Promoted", "HOLD_FOR_APPROVAL"))
        self.assertEqual(self.log_ok("demo_hold"), n0 + len(DEMO["demo_hold"]["record"]["tails"]["approve"]))
        self.assertEqual([r[0] for r in self.q("SELECT action FROM actions ORDER BY id")], ["advance_day", "approve"])

    def test_roll_back_a_promotion(self):
        self.put(state={"demo_win": st(7)})
        self.assertEqual(self.status("demo_win")[:2], ("Completed", "Promoted"))
        self.put(state={"demo_win": st(7, rolledBack=True)})
        self.assertEqual(self.status("demo_win")[:2], ("Completed", "Promoted, then rolled back"))
        self.log_ok("demo_win")
        (detail,), = self.q("SELECT detail FROM actions WHERE action = 'advance_day'")
        self.assertEqual(json.loads(detail), {"from": 2, "to": 7})

    def test_the_autopilot_keeps_a_and_its_own_entries_are_logged(self):
        """A held win nobody answered: the autopilot keeps A. The decision log gets the autopilot's pre-chained entries (not a person's),
        the chain still verifies, and the click log says the autopilot acted."""
        n0 = self.log_ok("demo_hold")
        self.put(state={"demo_hold": st(7)})
        self.put(state={"demo_hold": st(7, approval="rejected", auto=True, waited=2)})
        self.assertEqual(self.status("demo_hold")[:2], ("Completed", "Rejected: kept A"))
        self.assertEqual(self.log_ok("demo_hold"), n0 + len(DEMO["demo_hold"]["record"]["tails"]["auto_reject"]))
        self.assertTrue(any('"by":"Picky autopilot"' in r[0] for r in self.q("SELECT body FROM decision_log WHERE experiment_id = 'demo_hold'")))
        self.assertEqual([r[0] for r in self.q("SELECT action FROM actions ORDER BY id")], ["advance_day", "autopilot_reject"])

    def test_the_autopilot_rolls_back_a_win_that_slips(self):
        self.put(state={"demo_fade": st(7)})
        self.assertEqual(self.status("demo_fade")[:2], ("Completed", "Promoted"))
        self.put(state={"demo_fade": st(7, hold=5, rolledBack=True, autoRoll=True)})
        self.assertEqual(self.status("demo_fade")[:2], ("Completed", "Promoted, then rolled back"))
        self.log_ok("demo_fade")
        self.assertTrue(any("holdback alert" in r[0] for r in self.q("SELECT reason FROM decision_log WHERE experiment_id = 'demo_fade'")))
        self.assertIn("autopilot_rollback", [r[0] for r in self.q("SELECT action FROM actions ORDER BY id")])

    def test_a_database_from_before_the_autopilot_gets_its_entries_on_the_next_start(self):
        """Same ledger head, new pre-chained branches: the stored record is replaced, so the autopilot's entry is what gets logged."""
        import copy, os
        old = copy.deepcopy(B)
        for e in old["demo"]:
            for k in ("auto_reject", "auto_rollback", "approve_rollback"):
                e["record"].get("tails", {}).pop(k, None)
        db = os.path.join(self.td.name, "old.db")
        store.seed(old, db)
        self.assertGreaterEqual(store.seed(B, db)["replaced"], 2)                   # demo_hold and demo_fade get their new branches
        self.assertEqual(store.seed(B, db), {"added": 0, "replaced": 0})          # and a third start writes nothing again
        self.db, self.revs = db, {}
        self.epoch = store.load(db)["epoch"]
        self.put(state={"demo_hold": st(7)})
        self.put(state={"demo_hold": st(7, approval="rejected", auto=True, waited=2)})
        self.assertTrue(any('"by":"Picky autopilot"' in r[0] for r in self.q("SELECT body FROM decision_log WHERE experiment_id = 'demo_hold'")))

    def test_approve_then_roll_back_reaches_the_record(self):
        self.put(state={"demo_hold": st(7)})
        self.put(state={"demo_hold": st(7, approval="approved")})
        self.put(state={"demo_hold": st(7, approval="approved", rolledBack=True)})
        self.assertEqual(self.status("demo_hold")[:2], ("Completed", "Promoted, then rolled back"))
        self.log_ok("demo_hold")
        types = [r[0] for r in self.q("SELECT type FROM decision_log WHERE experiment_id = 'demo_hold' ORDER BY seq")]
        self.assertEqual(types[-2:], ["rollback", "routing_changed"])                # the rollback is chained after the approval
        self.assertIn("approval", types)
        self.assertIn("rollback", types)

    def test_a_harmful_b_shows_stopped_and_a_person_can_stop_a_test(self):
        self.put(state={"demo_worse": st(9999)})
        self.assertEqual(self.status("demo_worse")[0], "Stopped")
        self.put(state={"demo_flat": st(3, paused=True)})
        self.put(state={"demo_flat": st(3)})
        self.put(state={"demo_flat": st(3, manualStop=True, learning="calls too long")})
        self.assertEqual(self.status("demo_flat")[:2], ("Stopped", "Stopped by a person"))
        self.assertEqual([r[0] for r in self.q("SELECT action FROM actions ORDER BY id")], ["advance_day", "advance_day", "pause", "resume", "stop", "learning_note"])

    def test_an_untouched_test_logs_no_click_and_stores_no_row(self):
        self.put(state={k: store.default_state(e, "demo") for k, e in DEMO.items()})
        self.put(state={e["id"]: store.default_state(e, "sample") for e in B["past"]})
        self.assertEqual((self.q("SELECT COUNT(*) FROM actions")[0][0], self.q("SELECT COUNT(*) FROM test_state")[0][0]), (0, 0))

    def test_a_clicked_return_to_the_default_is_kept_on_start(self):
        self.put(state={"demo_win": st(2, paused=True)})                              # a person pauses ...
        self.put(state={"demo_win": st(2)})                                           # ... and resumes: back to the default, but a real save
        rev = self.revs["s:demo_win"]
        store.seed(B, self.db)
        self.assertEqual(store.load(self.db)["revs"].get("s:demo_win"), rev)
        with self.assertRaises(store.Conflict):                                       # a tab that still shows it paused cannot undo the resume
            self.put(revs={"s:demo_win": 1}, state={"demo_win": st(2, paused=True, learning="stale")})

    def test_untouched_rows_from_an_older_version_are_removed_on_start(self):
        con = sqlite3.connect(self.db)
        con.execute("INSERT INTO test_state (experiment_id, state, updated_at, rev) VALUES ('demo_hold', ?, 'x', 1)", (json.dumps(store.default_state(DEMO["demo_hold"], "demo")),))
        con.commit(); con.close()
        self.put(state={"demo_win": st(4)})
        store.seed(B, self.db)
        self.assertEqual([r[0] for r in self.q("SELECT experiment_id FROM test_state")], ["demo_win"])

    def test_a_stale_browser_cannot_undo_a_newer_save(self):
        self.put(state={"demo_hold": st(7)})
        seen = dict(self.revs)                                                        # browser 2 loads now
        self.put(state={"demo_hold": st(7, approval="approved")})                      # browser 1 approves
        with self.assertRaises(store.Conflict):                                       # browser 2, still on day 7 and no approval, plays on
            self.put(revs={"s:demo_hold": seen["s:demo_hold"]}, state={"demo_hold": st(7, paused=True)})
        self.assertEqual(store.load(self.db)["dyn"]["demo_hold"]["approval"], "approved")
        self.assertEqual(self.status("demo_hold")[:2], ("Completed", "Promoted"))

    def test_the_same_applies_to_drafts(self):
        self.put(app={"drafts": [{"id": "d1"}]})
        with self.assertRaises(store.Conflict):
            self.put(revs={"a:drafts": 0}, app={"drafts": [{"id": "d2"}]})             # a browser that never saw d1
        self.assertEqual(store.load(self.db)["app"]["drafts"], [{"id": "d1"}])

    def test_sending_what_is_stored_is_never_a_conflict(self):
        self.put(state={"demo_win": st(4)})
        out = self.put(revs={"s:demo_win": 0}, state={"demo_win": st(4)})            # two browsers opened together send the same defaults
        self.assertEqual((out["states"], out["revs"]["s:demo_win"]), (0, 1))

    def test_many_browsers_saving_at_once_lose_no_update(self):
        errs, wins, lock = [], {}, threading.Lock()
        ids = list(DEMO)

        def worker(i):
            revs = {}
            for day in range(3, 9):
                k = ids[i % len(ids)]
                try:
                    out = store.apply({"epoch": self.epoch, "revs": {f"s:{k}": revs.get(f"s:{k}", 0)}, "state": {k: st(day, learning=f"w{i}")}}, self.db)
                    revs.update(out["revs"])
                    with lock:
                        wins[k] = wins.get(k, 0) + out["states"]
                except store.Conflict:
                    revs[f"s:{k}"] = store.load(self.db)["revs"].get(f"s:{k}", 0)   # what a browser does: reload, then go on
                except Exception as e:  # pragma: no cover
                    errs.append(e)
        ts = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        self.assertEqual(errs, [])
        self.assertEqual(self.q("PRAGMA integrity_check")[0][0], "ok")
        revs = store.load(self.db)["revs"]
        self.assertEqual({k: revs[f"s:{k}"] for k in wins}, wins)                    # every accepted save is one rev: none overwritten unseen


class Reset(StoreBase):
    def test_reset_clears_launched_tests_and_states_but_keeps_the_click_log(self):
        self.put(tests=[launched()], state={"demo_hold": st(7, approval="approved")}, app={"settings": {"confidence": 0.99}})
        out = store.reset(self.db)
        self.assertEqual(out["removed"], 1)
        got = store.load(self.db)
        self.assertEqual((got["launched"], got["dyn"], got["app"]), ([], {}, {}))
        self.assertEqual(self.q("SELECT status FROM experiments WHERE id = 'demo_hold'")[0][0], "Running")
        self.assertEqual(self.q("SELECT action FROM actions ORDER BY id DESC LIMIT 1")[0][0], "reset")
        self.assertEqual(self.q("SELECT COUNT(*) FROM prompt_texts")[0][0], 0)
        with self.assertRaises(store.EpochMismatch):                      # a browser still holding the old history cannot write it back
            self.put(state={"demo_win": st(7)})


class Upgrade(unittest.TestCase):
    def test_a_file_from_the_first_version_is_upgraded_in_place(self):
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / "h.db"
            store.seed(B, db)
            store.apply({"state": {"demo_win": st(4)}}, db)
            con = sqlite3.connect(db)
            con.execute("ALTER TABLE test_state DROP COLUMN rev")
            con.execute("ALTER TABLE app_state DROP COLUMN rev")
            con.execute("UPDATE meta SET value = '1' WHERE key = 'schema_version'")
            con.commit()
            con.close()
            store._ready.discard(str(db))
            got = store.load(db)
            self.assertEqual((got["dyn"]["demo_win"]["day"], got["revs"]["s:demo_win"]), (4, 0))
            store.apply({"revs": {"s:demo_win": 0}, "state": {"demo_win": st(5)}}, db)
            self.assertEqual(store.load(db)["revs"]["s:demo_win"], 1)


class Http(unittest.TestCase):
    """The live server's endpoints, on a throw-away database."""

    @classmethod
    def setUpClass(cls):
        cls.td = tempfile.TemporaryDirectory()
        cls.old_db, store.DB = store.DB, Path(cls.td.name) / "h.db"
        server._cache.pop("store_seeded", None)
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.H)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        store.DB = cls.old_db
        server._cache.pop("store_seeded", None)
        cls.td.cleanup()

    def call(self, path, body=None, headers=None):
        h = {**({"X-Picky-Store": "1"} if body is not None else {}), **(headers or {})}       # the console's own header on a save
        req = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(), method="GET" if body is None else "POST",
                                     headers={k: v for k, v in h.items() if v is not None})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def test_the_round_trip(self):
        self.call("/api/store/reset", {})                                  # the other test of this class may have stored a test
        code, raw = self.call("/api/store")
        s = json.loads(raw)
        self.assertEqual((code, s["launched"], s["info"]["tests"]["demo"]), (200, [], len(B["demo"])))
        d = launched()
        code, raw = self.call("/api/store", {"epoch": s["epoch"], "tests": [d], "state": {d["id"]: st(1, started=True)}})
        self.assertEqual((code, json.loads(raw)["tests_added"]), (200, 1))
        self.assertEqual(json.loads(self.call("/api/store")[1])["launched"], [d])
        code, raw = self.call("/api/store", {"epoch": "old", "state": {}})
        self.assertEqual((code, json.loads(raw)["reload"]), (409, True))
        code, raw = self.call("/api/store", {"epoch": s["epoch"], "tests": [{"id": "bad"}]})
        self.assertEqual((code, len(json.loads(raw)["rejected"])), (200, 1))
        code, raw = self.call("/api/store", {"epoch": s["epoch"], "app": {"ui": 1}})
        self.assertEqual(code, 400)
        code, raw = self.call("/api/store", {"epoch": s["epoch"], "revs": {"s:exp-store-test": 0}, "state": {d["id"]: st(2, started=True)}})
        self.assertEqual((code, json.loads(raw)["reload"], json.loads(raw)["reset"]), (409, True, False))     # a stale save
        code, raw = self.call("/api/store/download")
        self.assertEqual((code, raw[:16]), (200, b"SQLite format 3\x00"))
        info = json.loads(self.call("/api/store/info")[1])
        self.assertEqual(info["tests"]["launched"], 1)
        code, raw = self.call("/api/store/reset", {})
        self.assertEqual((code, json.loads(raw)["removed"]), (200, 1))
        self.assertNotEqual(json.loads(self.call("/api/store")[1])["epoch"], s["epoch"])

    def test_a_tunnel_or_another_computer_is_refused(self):
        for h in ({"X-Forwarded-For": "1.2.3.4"}, {"Host": "example.ngrok-free.dev"}, {"ngrok-skip-browser-warning": "1"}, {"CF-Connecting-IP": "1.2.3.4"},
                  {"Forwarded": "for=1.2.3.4"}):
            for path, body in (("/api/store", None), ("/api/store/info", None), ("/api/store/download", None), ("/api/store", {"state": {}}), ("/api/store/reset", {})):
                code, raw = self.call(path, body, h)
                self.assertEqual(code, 403, (h, path))
        port = self.srv.server_address[1]
        for h in ({"X-Picky-Store": None}, {"Origin": "null"}, {"Origin": f"http://127.0.0.1:{port + 1}"}, {"Origin": "https://evil.example"},
                  {"Sec-Fetch-Site": "cross-site"}, {"Via": "1.1 proxy"}, {"True-Client-IP": "1.2.3.4"}, {"Tailscale-User-Login": "x"},
                  {"Origin": "http://127.0.0.1:abc"}, {"Fly-Client-IP": "1.2.3.4"}, {"X-Envoy-External-Address": "1.2.3.4"}, {"CDN-Loop": "x"}, {"X-Azure-ClientIP": "1"}):
            self.assertEqual(self.call("/api/store/reset", {}, h)[0], 403, h)        # another page, another port, a proxy: no reset
        ok = {"Origin": f"http://127.0.0.1:{port}", "Sec-Fetch-Site": "same-origin"}
        self.assertEqual(self.call("/api/store", {"state": {}}, ok)[0], 200)        # the console itself
        self.assertEqual(self.call("/api/store/info")[0], 200)                       # this computer, directly
        self.assertEqual(self.call("/api/console", None, {"X-Forwarded-For": "1.2.3.4"})[0], 200)      # the rest of the server is unchanged

    def test_a_deleted_database_file_is_rebuilt_with_the_demo_tests(self):
        self.call("/api/store/info")
        for f in Path(store.DB).parent.glob(Path(store.DB).name + "*"):
            f.unlink()
        s = json.loads(self.call("/api/store")[1])
        self.assertEqual(s["info"]["tests"]["demo"], len(B["demo"]))
        code, raw = self.call("/api/store", {"epoch": s["epoch"], "state": {"demo_hold": st(7)}})
        self.assertEqual((code, json.loads(raw)["skipped"]), (200, []))

    def test_a_results_file_decision_is_stored_as_files(self):
        from picky import samples
        rec = server.run_decide({"files": [{"name": "r.csv", "text": samples.to_csv(samples.make_rows("b_wins"))}],
                                 "opts": {"goal": "buylead_created", "baseline": 0.45, "share_b": 0.3, "window_days": 14, "complete": True}})["record"]
        doc = {"id": "files-123", "kind": "files", "preset": "Results files", "hypothesis": "", "truth": None, "record": rec, "start_day": 9999}
        s = json.loads(self.call("/api/store")[1])
        code, raw = self.call("/api/store", {"epoch": s["epoch"], "tests": [doc], "state": {"files-123": st(9999)}})
        self.assertEqual(code, 200, raw)
        con = sqlite3.connect(store.DB)
        try:
            origin, status = con.execute("SELECT origin, status FROM experiments WHERE id = 'files-123'").fetchone()
        finally:
            con.close()
        self.assertEqual(origin, "files")
        self.assertIn(status, ("Completed", "Stopped", "Awaiting approval"))


if __name__ == "__main__":
    unittest.main()
