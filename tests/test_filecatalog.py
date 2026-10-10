"""The data-file column catalog and metrics over file columns (canary/filecatalog.py), on a small synthetic CSV in a temp folder."""
import csv
import math
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from canary import filecatalog as fc
from canary import metriclib

F = "calls.csv"
HEAD = ["disp_dtlid", "fk_lead_id", "call_start_time", "lead_call_status", "lead_call_duration", "disposition_id", "summary",
        "drop_reason", "client_number", "fk_click_to_call_id", "fk_other_call_id"]
BASE = datetime(2026, 9, 1, 10, 0)


def make_rows():
    rows = []
    for i in range(120):
        ans = i % 3 != 0
        d = BASE + timedelta(days=i % 40, minutes=i % 60)
        rows.append({"disp_dtlid": f"{1000 + i}.0", "fk_lead_id": f"{500 + i // 2}.0", "call_start_time": "" if i == 5 else d.strftime("%d/%m/%y %H:%M"),
                     "lead_call_status": "Answered" if ans else "NotAnswered", "lead_call_duration": f"{20 + i * 2}.0" if ans else "0.0",
                     "disposition_id": "51.0" if ans and i % 2 else "0.0", "summary": f"call summary number {i} words", "drop_reason": "",
                     "client_number": "8065584595.0", "fk_click_to_call_id": f"{77000 + i}.0", "fk_other_call_id": f"{9000 + i}.0" if i % 4 == 0 else ""})
    return rows


def write(folder: Path, name: str, head: list, rows: list):
    with open(folder / name, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=head)
        w.writeheader()
        w.writerows(rows)


def C(col, op, v):
    return {"col": col, "op": op, ("values" if isinstance(v, list) else "value"): v}


ANS = C("lead_call_status", "is", "Answered")


def rate(num, den, count="calls", name="R"):
    return {"source": "file", "file": F, "type": "rate", "count": count, "num": num, "den": den, "name": name}


def avg(col, where, count="calls", typ="average"):
    return {"source": "file", "file": F, "type": typ, "count": count, "col": col, "where": where, "name": "A"}


class FileCatalog(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.rows = make_rows()
        write(self.dir, F, HEAD, self.rows)
        write(self.dir, "notes.csv", ["region", "score"], [{"region": r, "score": s} for r, s in (("N", 1), ("S", 2), ("E", 3))])
        self.old = os.environ.get("CANARY_RESOURCES")
        os.environ["CANARY_RESOURCES"] = str(self.dir)

    def tearDown(self):
        if self.old is None:
            os.environ.pop("CANARY_RESOURCES", None)
        else:
            os.environ["CANARY_RESOURCES"] = self.old
        self.tmp.cleanup()

    # brute force over the window (offset >= 10 days of the latest date; the empty date row is out)
    def window_rows(self):
        dated = [(datetime.strptime(r["call_start_time"], "%d/%m/%y %H:%M"), r) for r in self.rows if r["call_start_time"]]
        hi = max(d for d, _ in dated)
        return [r for d, r in dated if d > hi - timedelta(days=30)]

    def col(self, cat, name, file=F):
        return next(c for c in cat["columns"] if c["column"] == name and c["file"] == file)

    def test_types(self):
        cat = fc.catalog()
        t = {c["column"]: c["type"] for c in cat["columns"] if c["file"] == F}
        self.assertEqual(t, {"disp_dtlid": "id", "fk_lead_id": "id", "call_start_time": "date", "lead_call_status": "category",
                             "lead_call_duration": "number", "disposition_id": "category", "summary": "text", "drop_reason": "empty",
                             "client_number": "id", "fk_click_to_call_id": "id", "fk_other_call_id": "id"})
        self.assertEqual(self.col(cat, "disposition_id")["values"], ["0", "51"])           # numeric codes without ".0"
        self.assertEqual(self.col(cat, "lead_call_status")["values"], ["Answered", "NotAnswered"])
        self.assertEqual(self.col(cat, "lead_call_duration")["unit"], "s")
        self.assertEqual(self.col(cat, "lead_call_duration")["label"], "Lead call duration")
        self.assertNotIn("values", self.col(cat, "summary"))

    def test_catalog_has_no_rows(self):
        cat = fc.catalog()
        blob = repr(cat)
        for r in self.rows[:5]:
            self.assertNotIn(r["summary"], blob)
            self.assertNotIn(r["fk_click_to_call_id"], blob)
        self.assertEqual(set(cat), {"files", "columns", "ops", "folder", "scanned_at"})

    def test_keys_and_unlinkable(self):
        cat = fc.catalog()
        f = {x["file"]: x for x in cat["files"]}
        self.assertEqual(f[F]["keys"], {"lead": "fk_lead_id", "call": "fk_click_to_call_id"})   # the call column with fewer empties
        self.assertTrue(f[F]["linkable"])
        self.assertEqual(f[F]["date_column"], "call_start_time")
        self.assertEqual(f[F]["rows"], 120)
        self.assertFalse(f["notes.csv"]["linkable"])
        for c in (c for c in cat["columns"] if c["file"] == "notes.csv"):
            self.assertEqual((c["linkable"], c["why"]), (False, "Can't be linked to calls"))
        self.assertEqual(fc.validate({**rate([C("region", "is", "N")], []), "file": "notes.csv"}), ["notes.csv: Can't be linked to calls"])

    def test_missing_folder(self):
        cat = fc.catalog(self.dir / "nope")
        self.assertEqual((cat["files"], cat["columns"]), ([], []))
        self.assertIn("nope", cat["missing"])

    def test_operator_type_errors(self):
        bad = [
            (rate([C("lead_call_duration", "contains", "1")], []), "does not work on Lead call duration"),
            (rate([C("lead_call_status", ">", 3)], []), "does not work on Lead call status"),
            (rate([C("call_start_time", "is", "x")], []), "does not work on Call start time"),
            (rate([C("summary", ">", 1)], []), "does not work on Summary"),
            (rate([C("client_number", "is", "x")], []), "cannot be used in a condition"),
            (rate([C("lead_call_status", "is", "Maybe")], []), "Maybe is not a value"),
            (rate([C("lead_call_duration", "between", [50, 10])], []), "must not exceed"),
            (rate([C("lead_call_duration", ">", "abc")], []), "compared with numbers"),
            (rate([C("call_start_time", "after", "10/10/26")], []), "YYYY-MM-DD"),
            (rate([C("nope", "is", "x")], []), "not a column"),
            (avg("lead_call_status", []), "not a number column"),
            (rate([], []), "at least one condition"),
            ({**rate([ANS], []), "file": "other.csv"}, "not a file"),
        ]
        for d, msg in bad:
            errs = fc.validate(d)
            self.assertTrue(any(msg in e for e in errs), (d, errs))

    def test_operators_match(self):
        n = lambda op, v: fc.cond_match(C("x", op, v), "51.0", "number")
        self.assertTrue(n("=", 51) and n(">=", 51) and n("<=", 51) and n(">", 50) and n("<", 52) and n("!=", 3) and n("between", [50, 60]))
        self.assertFalse(fc.cond_match(C("x", "<", 5), "", "number"))                     # empty never matches a number comparison
        self.assertTrue(fc.cond_match(C("x", "is", "51"), "51.0", "category"))
        self.assertTrue(fc.cond_match(C("x", "in", ["0", "51"]), "0.0", "category"))
        self.assertTrue(fc.cond_match(C("x", "is_not", "51"), "0", "category"))
        fmt = "%d/%m/%y %H:%M"
        self.assertTrue(fc.cond_match(C("d", "after", "2026-10-04"), "05/10/26 10:14", "date", fmt))
        self.assertFalse(fc.cond_match(C("d", "after", "2026-10-05"), "05/10/26 10:14", "date", fmt))
        self.assertTrue(fc.cond_match(C("d", "before", "2026-10-06"), "05/10/26 10:14", "date", fmt))
        self.assertTrue(fc.cond_match(C("d", "between", ["2026-10-05", "2026-10-05"]), "05/10/26 10:14", "date", fmt))
        self.assertFalse(fc.cond_match(C("d", "before", "2027-01-01"), "", "date", fmt))  # empty never matches a date comparison
        self.assertTrue(fc.cond_match(C("t", "contains", "HELLO"), "say hello there", "text"))
        self.assertTrue(fc.cond_match(C("t", "not_contains", "bye"), "say hello there", "text"))

    def test_window(self):
        ev = fc.evaluate(rate([ANS], []))
        w = self.window_rows()
        self.assertEqual(ev["rows_used"], len(w))
        self.assertLess(len(w), 119)
        self.assertEqual(ev["window"]["to"], "2026-10-10T10:59")
        self.assertEqual(ev["window"]["from"], "2026-09-10T10:59")
        self.assertEqual(ev["window"]["column"], "call_start_time")

    def test_rate_per_call_and_lead(self):
        w = self.window_rows()
        d = rate([C("lead_call_duration", ">", 100)], [ANS], name="Over 100 s")
        self.assertEqual(fc.validate(d), [])
        ev = fc.evaluate(d)
        num = sum(1 for r in w if float(r["lead_call_duration"]) > 100)
        den = sum(1 for r in w if r["lead_call_status"] == "Answered")
        self.assertEqual((ev["num"], ev["den"]), (num, den))
        self.assertAlmostEqual(ev["value"], num / den)
        self.assertAlmostEqual(ev["sd"], math.sqrt(num / den * (1 - num / den)))
        ev = fc.evaluate({**d, "count": "leads"})
        nl = len({r["fk_lead_id"] for r in w if float(r["lead_call_duration"]) > 100})
        dl = len({r["fk_lead_id"] for r in w if r["lead_call_status"] == "Answered"})
        self.assertEqual((ev["num"], ev["den"]), (nl, dl))
        ev = fc.evaluate(rate([ANS], []))                                                   # empty denominator = all rows
        self.assertEqual(ev["den"], len(w))

    def test_average_and_sum(self):
        w = self.window_rows()
        vals = [float(r["lead_call_duration"]) for r in w if r["lead_call_status"] == "Answered"]
        ev = fc.evaluate(avg("lead_call_duration", [ANS]))
        mu = sum(vals) / len(vals)
        self.assertAlmostEqual(ev["value"], mu)
        self.assertAlmostEqual(ev["sd"], math.sqrt(sum((x - mu) ** 2 for x in vals) / (len(vals) - 1)))
        ev = fc.evaluate(avg("lead_call_duration", [ANS], typ="sum"))
        self.assertAlmostEqual(ev["value"], sum(vals))
        # per lead: the lead's first matching row by date
        first = {}
        for r in sorted((r for r in w if r["lead_call_status"] == "Answered"), key=lambda r: datetime.strptime(r["call_start_time"], "%d/%m/%y %H:%M")):
            first.setdefault(r["fk_lead_id"], float(r["lead_call_duration"]))
        ev = fc.evaluate(avg("lead_call_duration", [ANS], count="leads"))
        self.assertEqual(ev["den"], len(first))
        self.assertAlmostEqual(ev["value"], sum(first.values()) / len(first))
        ev = fc.evaluate(avg("lead_call_duration", [ANS], count="leads", typ="sum"))
        self.assertAlmostEqual(ev["value"], sum(first.values()))

    def test_data_errors(self):
        errs = fc.validate(rate([ANS], [ANS, C("lead_call_duration", "<", 0)]))
        self.assertEqual(errs, ["The denominator is 0 on the last 30 days: nothing would be counted"])
        errs = fc.validate(rate([C("lead_call_status", "in", ["Answered", "NotAnswered"])], [ANS]))
        self.assertEqual(len(errs), 1)
        self.assertIn("Make the numerator count a part of the denominator", errs[0])
        p = fc.preview(rate([ANS], [ANS, C("lead_call_duration", "<", 0)]))
        self.assertFalse(p["ok"])
        self.assertEqual(set(p), {"ok", "errors", "num", "den", "value", "sd", "window"})

    def test_cache_and_rescan(self):
        a = fc.scan()
        b = fc.scan()
        self.assertIs(a[F]["rows"], b[F]["rows"])                                           # unchanged: not re-read
        write(self.dir, "more.csv", ["fk_lead_id", "x"], [{"fk_lead_id": "1", "x": "a"}])
        self.assertIn("more.csv", [f["file"] for f in fc.catalog()["files"]])
        self.assertIs(fc.scan()[F]["rows"], a[F]["rows"])
        (self.dir / "more.csv").unlink()
        self.assertNotIn("more.csv", [f["file"] for f in fc.rescan()["files"]])

    def test_metriclib_file_metric(self):
        d = metriclib.validate(rate([C("lead_call_duration", ">", 100)], [ANS], name="Over 100 s"))
        self.assertEqual(d["source"], "file")
        self.assertEqual(d["num"], {"unit": "calls", "where": [{"col": "call_duration", "op": ">", "values": [100.0]}]})
        self.assertEqual(d["den"]["where"], [{"col": "call_status", "op": "is", "values": ["Answered"]}])
        ev = metriclib.evaluate(d)
        self.assertAlmostEqual(ev["value"], fc.evaluate(d["file_def"])["value"])            # the baseline comes from the file
        self.assertTrue(metriclib.cond_ok(d["num"]["where"][0], {"call_duration": 150}))
        self.assertFalse(metriclib.cond_ok(d["num"]["where"][0], {"call_duration": 50}))
        with self.assertRaisesRegex(ValueError, "not in the test simulator"):
            metriclib.validate(rate([C("disposition_id", "is", "51")], [ANS]))
        with self.assertRaisesRegex(ValueError, "previewed but not used"):
            metriclib.validate(avg("lead_call_duration", [ANS], typ="sum"))
        with self.assertRaisesRegex(ValueError, "denominator is 0"):
            metriclib.validate(rate([ANS], [ANS, C("lead_call_duration", "<", 0)]))
        a = metriclib.validate(avg("lead_call_duration", [ANS]))
        self.assertEqual((a["col"], a["unit"]), ("call_duration", "calls"))

    def test_wizard_launch_uses_file_baseline(self):
        from canary import server
        from tests.test_metrics_overhaul import body
        d = rate([C("lead_call_duration", ">", 100)], [ANS], name="Over 100 s")
        r = server.run_wizard(body(name="File metric", metrics=[{"role": "primary", "def": d}, {"role": "secondary", "key": "early_hangup"}]))
        self.assertAlmostEqual(r["record"]["config"]["baseline"], round(fc.evaluate(d)["value"], 6), delta=1e-6)


REAL = Path(fc.__file__).resolve().parent.parent.parent / "Resources" / "dtl table data.csv"


@unittest.skipUnless(REAL.exists(), "the real data file is not on this machine")
class RealFile(unittest.TestCase):
    def test_two_examples(self):
        old = os.environ.pop("CANARY_RESOURCES", None)
        try:
            F2 = REAL.name
            a = {"source": "file", "file": F2, "type": "rate", "count": "calls", "name": "Calls over 3 min %",
                 "num": [C("lead_call_duration", ">", 180)], "den": [ANS]}
            b = {"source": "file", "file": F2, "type": "average", "count": "calls", "name": "Average call duration",
                 "col": "lead_call_duration", "where": [ANS]}
            for d in (a, b):
                self.assertEqual(fc.validate(d), [])
                self.assertGreater(fc.evaluate(d)["den"], 0)
            t = {c["column"]: c["type"] for c in fc.catalog()["columns"] if c["file"] == F2}
            self.assertEqual(t["client_number"], "id")
            self.assertEqual(t["lead_call_duration"], "number")
        finally:
            if old is not None:
                os.environ["CANARY_RESOURCES"] = old


if __name__ == "__main__":
    unittest.main()
