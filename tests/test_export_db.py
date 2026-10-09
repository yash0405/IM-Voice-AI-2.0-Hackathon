"""The SQLite export: every table is there, the per-lead rows are deterministic and sticky, the segment is respected and the decision log
can be re-hashed from what is stored. Demo experiments only (fast); one extra test adds the past tests without per-lead rows."""
import contextlib
import hashlib
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from canary import catalog, console, export_db, ledger, variants

TABLES = ["variable_catalog", "metrics", "prompts", "experiments", "experiment_versions", "assignments", "calls", "daily_results", "decision_log", "suggestions"]
JSON_COLUMNS = [("variable_catalog", "allowed_values"), ("metrics", "numerator_dispositions"), ("experiments", "truth"), ("experiment_versions", "config"),
                ("daily_results", "metric_values"), ("daily_results", "test_results"), ("decision_log", "evidence"), ("decision_log", "body")]


def dump(con) -> str:
    """Every table except `meta` (it holds the generation time), in a fixed order, as one digest."""
    h = hashlib.sha256()
    for t in export_db.TABLES:
        if t == "meta":
            continue
        for row in con.execute(f"SELECT * FROM {t} ORDER BY rowid"):
            h.update(repr(row).encode())
    return h.hexdigest()


class ExportDb(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.path = str(Path(cls.tmp.name) / "canary.db")
        cls.counts = export_db.export(cls.path, include_past=False)
        cls.con = sqlite3.connect(cls.path)
        cls.demo = {e["id"]: e for e in console.demo_experiments()}

    @classmethod
    def tearDownClass(cls):
        cls.con.close()
        cls.tmp.cleanup()

    def q(self, sql, *args):
        return self.con.execute(sql, args).fetchall()

    def one(self, sql, *args):
        return self.con.execute(sql, args).fetchone()[0]

    def test_all_tables_exist_and_are_filled(self):
        have = {r[0] for r in self.q("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertEqual(have, set(TABLES) | {"meta"})
        self.assertEqual(set(self.counts), set(TABLES) | {"meta"})
        for t in TABLES + ["meta"]:
            self.assertGreater(self.one(f"SELECT COUNT(*) FROM {t}"), 0, t)
            self.assertEqual(self.counts[t], self.one(f"SELECT COUNT(*) FROM {t}"), t)

    def test_every_json_column_is_valid_json(self):
        for t, c in JSON_COLUMNS:
            self.assertEqual(self.one(f"SELECT COUNT(*) FROM {t} WHERE {c} IS NOT NULL AND NOT json_valid({c})"), 0, f"{t}.{c}")

    def test_reference_tables(self):
        self.assertEqual(self.one("SELECT COUNT(*) FROM variable_catalog"), len(catalog.CATALOG))
        self.assertEqual({r[0] for r in self.q("SELECT name FROM variable_catalog WHERE pre_call = 1")}, set(catalog.PRE_CALL))
        self.assertEqual(self.one("SELECT COUNT(*) FROM metrics"), len(console.metrics()))
        self.assertEqual(self.one("SELECT COUNT(*) FROM prompts"), 1 + len(console.library()["candidates"]))
        self.assertEqual(self.one("SELECT COUNT(*) FROM prompts WHERE is_production = 1"), 1)
        v1 = self.q("SELECT hash, parent_version, created_by FROM prompts WHERE version_id = 'v1'")[0]
        self.assertEqual(v1, (variants.load_base()["hash"], None, "provided"))
        for h, text, parent, prod in self.q("SELECT hash, text, parent_version, is_production FROM prompts"):
            self.assertEqual(variants.prompt_hash(text), h)
            self.assertEqual(parent, None if prod else "v1")
        # a priority exists only where there is both an ease and an expected lift
        pri = dict(self.q("SELECT id, priority FROM suggestions"))
        self.assertEqual(len(pri), 5)
        self.assertIsNone(pri["segments"])
        self.assertIsNone(pri["past"])
        self.assertGreater(pri["gap"], 0)

    def test_five_experiments_with_the_brd_status_words(self):
        rows = {r[0]: r[1:] for r in self.q("SELECT id, status, decision, current_version, variant_b_version FROM experiments")}
        self.assertEqual(set(rows), {"demo_win", "demo_worse", "demo_flat", "demo_segment", "demo_hold"})
        self.assertEqual(self.one("SELECT COUNT(*) FROM experiments"), 5)
        self.assertEqual(rows["demo_win"][:2], ("Completed", "PROMOTE"))
        self.assertEqual(rows["demo_worse"][:2], ("Stopped", "STOP_HARM"))
        self.assertEqual(rows["demo_flat"][:2], ("Completed", "INCONCLUSIVE"))
        self.assertEqual(rows["demo_hold"][:2], ("Completed", "HOLD_FOR_APPROVAL"))
        for status, decision, version, b in rows.values():
            self.assertEqual(version, 1)
            self.assertIsNotNone(b)                                   # the demo's B prompt is in the library
        self.assertEqual(self.one("SELECT COUNT(*) FROM experiment_versions"), 5)
        self.assertEqual(self.one("SELECT segment_rule FROM experiments WHERE id = 'demo_segment'"), "NOB = Proprietor")
        # every experiment traces to a prompt version
        self.assertEqual(self.one("SELECT COUNT(*) FROM experiments e JOIN prompts p ON p.version_id = e.variant_b_version AND p.hash = e.variant_b_hash"), 5)

    def test_the_rerun_matches_the_stored_ledger_head(self):
        self.assertTrue(self.one("SELECT value FROM meta WHERE key = 'determinism_check'").startswith("ok: 5 of 5"))
        for eid, e in self.demo.items():
            head = self.one("SELECT value FROM meta WHERE key = ?", f"rerun_ledger_head:{eid}")
            self.assertEqual(head, e["record"]["ledger_head"], eid)
            self.assertEqual(head, self.one("SELECT entry_hash FROM decision_log WHERE experiment_id = ? ORDER BY seq DESC LIMIT 1", eid), eid)

    def test_assignments_are_sticky(self):
        self.assertEqual(self.one("SELECT COUNT(*) FROM assignments WHERE variant NOT IN ('A', 'B')"), 0)
        self.assertGreater(self.one("SELECT COUNT(*) FROM assignments"), 10000)
        self.assertEqual(self.one("SELECT COUNT(*) FROM (SELECT experiment_id, lead_id FROM assignments GROUP BY experiment_id, lead_id HAVING COUNT(*) > 1)"), 0)
        # no lead saw both prompts: all of its counted calls carry one variant, and it is the assigned one
        self.assertEqual(self.one("SELECT COUNT(*) FROM (SELECT experiment_id, lead_id FROM calls WHERE in_segment = 1 GROUP BY experiment_id, lead_id HAVING COUNT(DISTINCT variant) > 1)"), 0)
        self.assertEqual(self.one("SELECT COUNT(*) FROM calls c JOIN assignments a ON a.experiment_id = c.experiment_id AND a.lead_id = c.lead_id WHERE c.variant <> a.variant"), 0)
        # every counted call has an assignment, and each experiment split near its configured 30% B
        self.assertEqual(self.one("SELECT COUNT(*) FROM calls c LEFT JOIN assignments a ON a.experiment_id = c.experiment_id AND a.lead_id = c.lead_id WHERE c.in_segment = 1 AND a.lead_id IS NULL"), 0)
        for eid, share in self.q("SELECT experiment_id, AVG(variant = 'B') FROM assignments GROUP BY experiment_id"):
            self.assertAlmostEqual(share, 0.30, delta=0.01, msg=eid)

    def test_the_segmented_demo_only_counts_proprietors(self):
        seg = "demo_segment"
        inside = self.one("SELECT COUNT(*) FROM calls WHERE experiment_id = ? AND in_segment = 1", seg)
        outside = self.one("SELECT COUNT(*) FROM calls WHERE experiment_id = ? AND in_segment = 0", seg)
        self.assertGreater(inside, 1000)
        self.assertGreater(outside, 1000)                              # the segment is 45% of traffic: the rest is out
        self.assertEqual(self.one("SELECT COUNT(*) FROM calls c JOIN assignments a ON a.experiment_id = c.experiment_id AND a.lead_id = c.lead_id "
                                  "WHERE c.experiment_id = ? AND c.in_segment = 1 AND a.stratum NOT LIKE '%Proprietor'", seg), 0)
        self.assertEqual(self.one("SELECT COUNT(*) FROM calls c JOIN assignments a ON a.experiment_id = c.experiment_id AND a.lead_id = c.lead_id "
                                  "WHERE c.experiment_id = ? AND c.in_segment = 0", seg), 0)                # out-of-segment leads have no assignment
        self.assertEqual(self.one("SELECT COUNT(*) FROM assignments WHERE experiment_id = ? AND stratum NOT LIKE '%x Proprietor'", seg), 0)
        # outside the segment: production prompt, nothing counted
        self.assertEqual(self.one("SELECT COUNT(*) FROM calls WHERE experiment_id = ? AND in_segment = 0 AND (variant <> 'A' OR disposition IS NOT NULL OR connected IS NOT NULL OR duration_s IS NOT NULL)", seg), 0)
        # independent check against the catalog: every assigned lead really is a proprietor
        for (lead,) in self.q("SELECT lead_id FROM assignments WHERE experiment_id = ?", seg):
            self.assertEqual(catalog.lead_vars(lead)["nature_of_business"], "Proprietor")
        # the neutral demos have no out-of-segment calls
        self.assertEqual(self.one("SELECT COUNT(*) FROM calls WHERE experiment_id <> ? AND in_segment = 0", seg), 0)

    def test_calls_columns_follow_the_simulator(self):
        self.assertEqual(self.one("SELECT COUNT(*) FROM calls WHERE (connected IS NULL) <> (disposition IS NULL)"), 0)
        self.assertEqual(self.one("SELECT COUNT(*) FROM calls WHERE (connected IS NULL) <> (duration_s IS NULL)"), 0)
        self.assertEqual({r[0] for r in self.q("SELECT DISTINCT disposition FROM calls")}, {None, "converted", "not_converted"})
        self.assertGreater(self.one("SELECT COUNT(*) FROM calls WHERE repeat = 1"), 0)
        self.assertEqual(self.one("SELECT COUNT(*) FROM calls WHERE repeat = 1 AND connected IS NOT NULL"), 0)      # repeat calls are not analysed twice
        for eid, e in self.demo.items():
            rec = e["record"]
            last = rec["looks"][-1]
            self.assertEqual(self.one("SELECT COUNT(*) FROM calls WHERE experiment_id = ?", eid), rec["calls_simulated"], eid)
            self.assertEqual(self.one("SELECT COUNT(*) FROM calls WHERE experiment_id = ? AND connected = 1", eid), last["n"], eid)
            got = dict(self.q("SELECT variant, SUM(disposition = 'converted') FROM calls WHERE experiment_id = ? AND connected = 1 GROUP BY variant", eid))
            self.assertEqual(got, {"A": last["xA"], "B": last["xB"]}, eid)

    def test_daily_results_match_the_looks(self):
        for eid, e in self.demo.items():
            rec = e["record"]
            days = sorted({l["day"] for l in rec["looks"]})
            self.assertEqual([r[0] for r in self.q("SELECT DISTINCT day FROM daily_results WHERE experiment_id = ? ORDER BY day", eid)], days, eid)
            self.assertEqual(self.one("SELECT COUNT(*) FROM daily_results WHERE experiment_id = ?", eid), 2 * len(days), eid)
            last_day = days[-1]
            self.assertEqual(self.one("SELECT SUM(leads) FROM daily_results WHERE experiment_id = ? AND day = ?", eid, last_day), rec["looks"][-1]["n"], eid)
            a, b = (self.one("SELECT leads FROM daily_results WHERE experiment_id = ? AND day = ? AND variant = ?", eid, last_day, v) for v in "AB")
            self.assertEqual((a, b), (rec["looks"][-1]["nA"], rec["looks"][-1]["nB"]), eid)
            res = json.loads(self.one("SELECT test_results FROM daily_results WHERE experiment_id = ? AND day = ? AND variant = 'B'", eid, last_day))
            for key in ("z", "eff", "harm", "diff", "ci95", "decision", "guardrail"):
                self.assertIn(key, res, eid)
            self.assertEqual(res["decision"], rec["result"]["kind"], eid)
            mv = json.loads(self.one("SELECT metric_values FROM daily_results WHERE experiment_id = ? AND day = ? AND variant = 'A'", eid, last_day))
            self.assertAlmostEqual(mv["buylead_created_rate"], rec["looks"][-1]["rateA"])
            self.assertIn("duration_s_mean", mv)

    def test_the_decision_log_rehashes_from_the_stored_rows(self):
        for eid, e in self.demo.items():
            rows = self.q("SELECT seq, entry_hash, prev_hash, body, type, event FROM decision_log WHERE experiment_id = ? ORDER BY seq", eid)
            self.assertEqual(len(rows), len(e["record"]["ledger"]), eid)                   # nothing skipped
            prev = ledger.GENESIS
            for i, (seq, h, p, body, etype, event) in enumerate(rows):
                self.assertEqual((seq, p), (i, prev), f"{eid} #{i}")
                self.assertEqual(hashlib.sha256((prev + body).encode()).hexdigest(), h, f"{eid} #{i}")
                self.assertEqual(json.loads(body)["type"], etype)
                self.assertEqual(json.loads(body)["seq"], i)
                prev = h
            self.assertEqual(prev, e["record"]["ledger_head"], eid)
            # and the library's own verifier agrees, on entries rebuilt from the table alone
            entries = [{"body": b, "prev": p, "hash": h} for _, h, p, b, _, _ in rows]
            self.assertEqual(ledger.verify(entries), (True, None), eid)
            tampered = [dict(x) for x in entries]
            tampered[2]["body"] = tampered[2]["body"].replace("CONTINUE", "PROMOTE")
            self.assertFalse(ledger.verify(tampered)[0], eid)
            # the same chain check, in SQL: each prev_hash is the previous entry_hash
            self.assertEqual(self.one("SELECT COUNT(*) FROM decision_log a JOIN decision_log b ON b.experiment_id = a.experiment_id AND b.seq = a.seq - 1 "
                                      "WHERE a.experiment_id = ? AND a.prev_hash <> b.entry_hash", eid), 0)
            self.assertEqual(self.one("SELECT value FROM meta WHERE key = ?", f"ledger_chain_ok:{eid}"), "true")

    def test_events_are_readable(self):
        events = {r[0] for r in self.q("SELECT DISTINCT event FROM decision_log")}
        self.assertTrue({"launched", "look", "decision", "promoted", "routing_changed", "approval_requested"} <= events, events)
        reason, version = self.q("SELECT reason, version FROM decision_log WHERE experiment_id = 'demo_win' AND event = 'decision'")[0]
        self.assertIn("B beats A", reason)
        self.assertEqual(version, 1)
        kind = json.loads(self.one("SELECT evidence FROM decision_log WHERE experiment_id = 'demo_win' AND event = 'decision'"))["kind"]
        self.assertEqual(kind, "PROMOTE")
        self.assertEqual({r[0] for r in self.q("SELECT reason FROM decision_log WHERE experiment_id = 'demo_win' AND event = 'look'")} - {"CONTINUE", "PROMOTE"}, set())

    def test_export_is_idempotent_and_replaces_the_file(self):
        again = str(Path(self.tmp.name) / "again.db")
        export_db.export(again, include_past=False)
        export_db.export(again, include_past=False)                    # second run overwrites the first
        con = sqlite3.connect(again)
        try:
            self.assertEqual(dump(con), dump(self.con))
            self.assertEqual(con.execute("SELECT COUNT(*) FROM experiments").fetchone()[0], 5)
        finally:
            con.close()

    def test_no_calls_skips_the_per_lead_rows(self):
        p = str(Path(self.tmp.name) / "light.db")
        counts = export_db.export(p, include_past=False, with_calls=False)
        self.assertEqual((counts["assignments"], counts["calls"]), (0, 0))
        self.assertEqual(counts["experiments"], 5)
        self.assertEqual(counts["decision_log"], self.counts["decision_log"])
        con = sqlite3.connect(p)
        try:
            self.assertEqual(con.execute("SELECT value FROM meta WHERE key = 'determinism_check'").fetchone()[0], "skipped (--no-calls)")
        finally:
            con.close()

    def test_past_tests_are_included_without_per_lead_rows(self):
        p = str(Path(self.tmp.name) / "with_past.db")
        counts = export_db.export(p, include_past=True, with_calls=False)
        self.assertGreaterEqual(counts["experiments"], 5 + 16)
        con = sqlite3.connect(p)
        try:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM experiments WHERE id LIKE 'past\\_%' ESCAPE '\\'").fetchone()[0], 10)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM experiments WHERE kind = 'files'").fetchone()[0], 6)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM assignments").fetchone()[0], 0)
            self.assertIn("no per-lead rows", con.execute("SELECT value FROM meta WHERE key = 'past_tests_per_lead_rows'").fetchone()[0])
            self.assertEqual({r[0] for r in con.execute("SELECT DISTINCT status FROM experiments")}, {"Completed", "Stopped"})
            self.assertEqual(con.execute("SELECT COUNT(*) FROM meta WHERE key LIKE 'ledger_chain_ok:%' AND value <> 'true'").fetchone()[0], 0)
            for t, c in JSON_COLUMNS:
                self.assertEqual(con.execute(f"SELECT COUNT(*) FROM {t} WHERE {c} IS NOT NULL AND NOT json_valid({c})").fetchone()[0], 0, f"{t}.{c}")
            # every past test has a chain that re-hashes
            for (eid,) in con.execute("SELECT id FROM experiments").fetchall():
                prev = ledger.GENESIS
                for h, pv, body in con.execute("SELECT entry_hash, prev_hash, body FROM decision_log WHERE experiment_id = ? ORDER BY seq", (eid,)).fetchall():
                    self.assertEqual((pv, hashlib.sha256((prev + body).encode()).hexdigest()), (prev, h), eid)
                    prev = h
        finally:
            con.close()

    def test_cli(self):
        p = str(Path(self.tmp.name) / "cli.db")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = export_db.main(["--out", p, "--no-past", "--no-calls"])
        self.assertEqual(code, 0)
        self.assertIn("experiments", out.getvalue())
        self.assertIn("synthetic", out.getvalue())
        con = sqlite3.connect(p)
        try:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM experiments").fetchone()[0], 5)
        finally:
            con.close()


if __name__ == "__main__":
    unittest.main()
