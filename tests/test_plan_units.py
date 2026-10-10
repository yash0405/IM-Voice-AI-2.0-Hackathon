"""The New Experiment page's pure functions (web/console/05-plan.js), tested in node against hand-computed values and against plain SQL
on the same 30-day rows (an independent check of every preview number the page shows)."""
import json
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

from picky import catalog, history, metriclib, promptlint, variants

ROOT = Path(__file__).resolve().parent.parent


def sql_cases(db: Path) -> list:
    """Each case: the metric or volume, the audience, and its numbers computed with plain SQL (written independently of metriclib)."""
    con = sqlite3.connect(str(db))
    q = lambda s, *a: con.execute(s, a).fetchone()
    seg_pr = [{"column": "hl_type", "values": ["UA", "PNSM"]}, {"column": "legal_status", "values": ["Proprietorship"]}]
    w_pr = "hl_type IN ('UA','PNSM') AND legal_status = 'Proprietorship'"
    out = []
    n, d = q("SELECT SUM(call_status = 'Answered'), COUNT(*) FROM calls")
    out.append({"name": "Answered % (calls), all traffic", "metric": {"key": "answered_pct"}, "segment": None, "num": n, "den": d, "value": n / d})
    n = q(f"SELECT COUNT(DISTINCT lead_id) FROM calls WHERE disposition = 'BuyLead created' AND {w_pr}")[0]
    d = q(f"SELECT COUNT(DISTINCT lead_id) FROM calls WHERE connected = '1' AND {w_pr}")[0]
    out.append({"name": "BuyLead created rate, HL Type UA or PNSM AND Proprietorship", "metric": {"key": "buylead_created"}, "segment": seg_pr, "num": n, "den": d, "value": n / d})
    s, k = q("SELECT SUM(call_duration), COUNT(*) FROM calls WHERE connected = '1' AND vendor = 'squadstack'")
    out.append({"name": "average call duration of answered calls, Vendor squadstack", "metric": {"key": "duration_s"}, "segment": [{"column": "vendor", "values": ["squadstack"]}], "num": s, "den": k, "value": s / k})
    n, d = q("SELECT SUM(early_hangup = 'Yes'), SUM(connected = '1') FROM calls")
    out.append({"name": "early hang-up rate of answered calls, all traffic", "metric": {"key": "early_hangup"}, "segment": None, "num": n, "den": d, "value": n / d})
    n = q("SELECT COUNT(DISTINCT lead_id) FROM calls WHERE connected = '1'")[0]
    d = q("SELECT COUNT(DISTINCT lead_id) FROM calls")[0]
    out.append({"name": "Connected % (leads), all traffic", "metric": {"key": "connected_pct"}, "segment": None, "num": n, "den": d, "value": n / d})
    custom = {"type": "rate", "name": "Busy share of unanswered calls", "direction": "lower", "num": {"unit": "calls", "where": [{"col": "call_status", "op": "is", "values": ["Busy"]}]},
              "den": {"unit": "calls", "where": [{"col": "call_status", "op": "is_not", "values": ["Answered"]}]}}
    n, d = q("SELECT SUM(call_status = 'Busy'), SUM(call_status <> 'Answered') FROM calls WHERE vertical IN ('Top Cities - Inhouse','NA')")
    out.append({"name": "a custom rate with 'is not', Vertical Top Cities - Inhouse or NA", "metric": custom, "segment": [{"column": "vertical", "values": ["Top Cities - Inhouse", "NA"]}], "num": n, "den": d, "value": n / d})
    avg_leads = {"type": "average", "name": "Talk time per lead", "direction": "lower", "col": "call_duration", "unit": "leads", "where": [{"col": "connected", "op": "is", "values": ["1"]}]}
    s, k = q("SELECT SUM(call_duration), COUNT(*) FROM calls WHERE connected = '1' AND hl_bucket = 'Top 3'")
    out.append({"name": "a custom average over leads, HL Bucket Top 3", "metric": avg_leads, "segment": [{"column": "hl_bucket", "values": ["Top 3"]}], "num": s, "den": k, "value": s / k})
    c = q(f"SELECT COUNT(DISTINCT lead_id) FROM calls WHERE connected = '1' AND {w_pr}")[0]
    out.append({"name": "connected leads a day, HL Type UA or PNSM AND Proprietorship", "kind": "volume", "segment": seg_pr, "connected": c})
    con.close()
    return out


class Catalog(unittest.TestCase):
    def test_the_disposition_list_matches_the_history(self):
        self.assertEqual(catalog.VARS["disposition"]["values"], history.DISP_VALUES)


class PlanUnits(unittest.TestCase):
    def test_pure_functions_in_node(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not available")
        base = variants.load_base()["text"]
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / "h.db"
            history.to_sqlite(db)
            specs = variants._candidates()
            fx = {"catalog": catalog.bundle([c["name"] for c in history.COLUMNS]), "history": history.bundle(), "metric_catalog": metriclib.catalog_bundle(),
                  "library": {"base_text": base, "variables": promptlint.variables(base), "base": {"hash": variants.prompt_hash(base)},
                              "edits": {k: {op: specs[k].get(op, []) for op in ("edit", "remove", "add")} for k in specs},
                              "cap_two_asks_text": variants.make_variant("cap_two_asks")["text"]},
                  "sql_cases": sql_cases(db)}
            path = Path(td) / "fixture.json"
            path.write_text(json.dumps(fx))
            r = subprocess.run([node, str(ROOT / "tests" / "browser" / "plan_units.cjs"), str(path)], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout[-4000:] + r.stderr[-2000:])
        self.assertIn(" 0 failed", r.stdout)


if __name__ == "__main__":
    unittest.main()
