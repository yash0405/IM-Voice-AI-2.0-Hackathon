"""New Experiment overhaul: the 30-day history, the metric definitions (checked against plain SQL), the engine's metrics path, the history
simulator and the wizard endpoint. No network, no Sarvam credits; the history is the labelled synthetic placeholder."""
import json
import math
import sqlite3
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from canary import catalog, history, metriclib, promptlint, server, variants
from canary.engine import Config, lock_check, run_experiment
from canary.simulator import HistorySim, _key, _pool_contrib

B = metriclib.BY_KEY
D = lambda k: metriclib.definition(B[k])
P = lambda d: {"role": "primary", "def": d, "limit": None}
G = lambda d, v, k: {"role": "guardrail", "def": d, "limit": {"value": v, "kind": k}}
S = lambda d: {"role": "secondary", "def": d, "limit": None}
ANSWERED = [{"col": "call_status", "op": "is", "values": ["Answered"]}]
AVG_LEN = {"name": "Answered call length", "type": "average", "direction": "lower", "col": "call_duration", "unit": "calls", "where": ANSWERED}
MEET_CB = {"name": "Meeting or callback", "type": "rate", "direction": "higher",
           "num": {"unit": "leads", "where": [{"col": "disposition", "op": "in", "values": ["Meeting Fixed", "Callback Fixed"]}]},
           "den": {"unit": "leads", "where": [{"col": "connected", "op": "is", "values": ["1"]}]}}
SEG_UA = [{"column": "hl_type", "values": ["UA", "PNSM"]}, {"column": "legal_status", "values": ["Proprietorship"]}]
_EV: dict = {}


def ev(defn, seg=None):
    key = json.dumps([defn, seg], sort_keys=True)
    if key not in _EV:
        _EV[key] = metriclib.evaluate(defn, seg)
    return _EV[key]


def run(metrics, effect=0.0, seed=1, dur_mult=1.0, hang=0.0, lpd=1030, window=7, share=0.3, min_per_arm=500, mde=None, **over):
    """One simulated test on the metrics path: baseline, spread and units from the history, like the wizard does."""
    prim = metrics[0]["def"]
    e = ev(prim)
    avg = prim["type"] == "average"
    cfg = Config(exp_id=f"t-{seed}", metrics=metrics, baseline=round(e["value"], 6), mde=mde or (0.1 * e["value"] if avg else 0.05),
                 primary_sd=e["sd"] if avg else 0.0, primary_units_per_lead=e["den"] / e["leads"], share_b=share, window_days=window, leads_per_day=lpd,
                 rule_set="final_look", alpha=0.025, alpha_harm_daily=0.001, min_per_arm=min_per_arm, assignment="balanced", **over)
    return run_experiment(cfg, HistorySim(prim, effect, seed, dur_mult, hang))


# ---------------------------------------------------------------------------- the 30-day history

class History(unittest.TestCase):
    def test_deterministic(self):
        self.assertEqual(history.leads.__wrapped__(), history.leads())          # generated again from scratch: the same leads
        self.assertEqual(history.lead_calls(history.leads()[5]), history.lead_calls(history.leads()[5]))

    def test_about_a_thousand_connected_leads_a_day(self):
        a = history.audience()
        self.assertEqual(a["days"], 30)
        self.assertAlmostEqual(a["connected_per_day"], 1000, delta=30)
        days = {L["date"] for L in history.leads()}
        self.assertEqual(len(days), 30)

    def test_bundle_is_13_characters_a_lead_and_decodes_back(self):
        b = history.bundle()
        n = len(history.leads())
        self.assertEqual(b["width"], 13)
        self.assertEqual(len(b["leads"]), 13 * n)
        A, fac, start = b["alphabet"], b["factors"], date.fromisoformat(b["start"])
        for i in (0, 1, 777, 12345, n - 1):
            ch = b["leads"][13 * i:13 * i + 13]
            L = history.leads()[i]
            got = {"date": (start + timedelta(days=A.index(ch[0]))).isoformat(),
                   **{f: catalog.VARS[f]["values"][A.index(ch[1 + j])] for j, f in enumerate(fac)},
                   "attempts": tuple(b["patterns"][A.index(ch[9])]), "disposition": b["dispositions"][A.index(ch[10])],
                   "call_duration": A.index(ch[11]) * 62 + A.index(ch[12])}
            self.assertEqual(got, {k: L[k] for k in got}, i)


# ---------------------------------------------------------------------------- metric definitions

class Validators(unittest.TestCase):
    def rate(self, num, den, nu="leads", du="leads"):
        return {"name": "x", "type": "rate", "num": {"unit": nu, "where": num}, "den": {"unit": du, "where": den}}

    def bad(self, m, words):
        with self.assertRaises(ValueError) as e:
            metriclib.validate(m)
        self.assertIn(words, str(e.exception))

    def test_denominator_0(self):
        self.bad(self.rate(ANSWERED, [{"col": "disposition", "op": "is", "values": ["Nobody spoke"]}, {"col": "connected", "op": "is", "values": ["1"]}]),
                 "denominator is 0")

    def test_rate_outside_0_to_100(self):
        missed = [{"col": "connected", "op": "is", "values": ["0"]}]               # missed calls over never-connected leads: about 3 per lead
        self.bad(self.rate(missed, missed, nu="calls", du="leads"), "between 0 and 100%")

    def test_only_columns_from_the_data(self):
        self.bad(self.rate([{"col": "city", "op": "is", "values": ["Mumbai"]}], []), "not a column in the data")
        self.bad(self.rate([{"col": "call_duration", "op": "is", "values": ["10"]}], []), "is a number")
        self.bad(self.rate([{"col": "disposition", "op": "is", "values": ["Sold"]}], []), "not a value of")

    def test_at_most_3_conditions(self):
        c = [{"col": "connected", "op": "is", "values": ["1"]}] * 4
        self.bad(self.rate(ANSWERED, c), "at most 3 conditions")

    def test_average_needs_a_number_column(self):
        self.bad({"name": "x", "type": "average", "col": "disposition", "unit": "calls", "where": []}, "not a number column")

    def test_a_good_definition_is_cleaned(self):
        m = metriclib.validate(MEET_CB)
        self.assertEqual(m["key"], "custom_meeting_or_callback")
        self.assertEqual(m["num"]["where"][0]["op"], "in")
        self.assertTrue(0 < metriclib.evaluate(m)["value"] < 1)


class SqlCheck(unittest.TestCase):
    """Every number the page and the engine read from the history, recomputed with plain SQL written independently of metriclib."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        path = Path(cls.tmp.name) / "history.db"
        history.to_sqlite(path)
        cls.con = sqlite3.connect(str(path))

    @classmethod
    def tearDownClass(cls):
        cls.con.close()
        cls.tmp.cleanup()

    def sql(self, q):
        return self.con.execute(q).fetchone()

    def same(self, got, num, den):
        self.assertEqual(got["num"], num)
        self.assertEqual(got["den"], den)
        self.assertAlmostEqual(got["value"], num / den, delta=1e-9)

    def test_answered_pct_all_traffic(self):
        num, den = self.sql("SELECT SUM(call_status = 'Answered'), COUNT(*) FROM calls")
        self.same(ev(D("answered_pct")), num, den)

    def test_buylead_rate_for_a_segment(self):
        seg = catalog.validate_segment(SEG_UA)
        self.assertEqual(catalog.describe(seg), "Leads where HL Type is UA or PNSM AND Legal Status is Proprietorship")
        w = "hl_type IN ('UA', 'PNSM') AND legal_status = 'Proprietorship'"
        num = self.sql(f"SELECT COUNT(DISTINCT lead_id) FROM calls WHERE disposition = 'BuyLead created' AND {w}")[0]
        den = self.sql(f"SELECT COUNT(DISTINCT lead_id) FROM calls WHERE connected = '1' AND {w}")[0]
        self.same(ev(D("buylead_created"), seg), num, den)

    def test_average_answered_call_length_for_one_vendor(self):
        seg = catalog.validate_segment([{"column": "vendor", "values": ["squadstack"]}])
        s, n, s2 = self.sql("SELECT SUM(call_duration), COUNT(*), SUM(call_duration * call_duration) FROM calls WHERE call_status = 'Answered' AND vendor = 'squadstack'")
        got = ev(metriclib.validate(AVG_LEN), seg)
        self.same(got, s, n)
        self.assertAlmostEqual(got["sd"], math.sqrt((s2 - s * s / n) / (n - 1)), delta=1e-6)

    def test_early_hangup_rate(self):
        num, den = self.sql("SELECT SUM(call_status = 'Answered' AND call_duration < 15), SUM(call_status = 'Answered') FROM calls")
        self.same(ev(D("early_hangup")), num, den)

    def test_connected_leads_a_day_for_a_segment(self):
        seg = catalog.validate_segment(SEG_UA)
        w = "hl_type IN ('UA', 'PNSM') AND legal_status = 'Proprietorship'"
        conn = self.sql(f"SELECT COUNT(DISTINCT lead_id) FROM calls WHERE connected = '1' AND {w}")[0]
        days = self.sql("SELECT COUNT(DISTINCT date) FROM calls")[0]
        self.assertEqual(ev(D("connected_pct"), seg)["num"], conn)
        self.assertEqual(history.audience(seg)["connected"], conn)
        self.assertAlmostEqual(history.audience(seg)["connected_per_day"], conn / days, delta=1e-9)


# ---------------------------------------------------------------------------- the history simulator

class Simulator(unittest.TestCase):
    def test_the_expected_ratio_is_exactly_the_target(self):
        for d, eff in ((D("buylead_created"), 0.15), (D("early_hangup"), -0.20), (D("answered_pct"), -0.10)):
            sim = HistorySim(d, eff, 1)
            self.assertAlmostEqual(sim.sc.true_a, ev(d)["value"], delta=1e-12)
            self.assertAlmostEqual(sim.sc.true_b, sim.sc.true_a * (1 + eff), delta=1e-12)
            nums, dens = _pool_contrib(_key(d))                                         # B's draw weights, summed directly: the closed form for q holds
            en = sum(sim._w[cl] * nums[i] for cl in ("N", "S", "F") for i in getattr(sim, cl))
            ed = sum(sim._w[cl] * dens[i] for cl in ("N", "S", "F") for i in getattr(sim, cl))
            self.assertAlmostEqual(en / ed, sim.sc.true_a * (1 + eff), delta=1e-9)

    def test_out_of_reach_effects_are_refused(self):
        with self.assertRaises(ValueError) as e:                                         # at most 1 / 1.35 calls are answered even if every lead connects
            HistorySim(D("answered_pct"), 0.15, 1)
        self.assertIn("out of reach", str(e.exception))

    def test_draws_follow_the_target(self):
        from types import SimpleNamespace
        d = D("early_hangup")
        sim = HistorySim(d, -0.20, 4)
        list(sim.calls(SimpleNamespace(window_days=1, leads_per_day=1), SimpleNamespace(capacity=20000)))
        fac = catalog.lead_vars("L0000001")
        num = den = 0
        for i in range(60000):
            n_, d_ = metriclib.contrib(d, sim.observe_rows("B", {"i": i, "lead": "L0000001", "attrs": fac}))
            num += n_; den += d_
        se = math.sqrt(sim.sc.true_b * (1 - sim.sc.true_b) / den)
        self.assertAlmostEqual(num / den, sim.sc.true_b, delta=4 * se)

    def test_an_average_effect_and_longer_calls(self):
        sim = HistorySim(metriclib.validate(AVG_LEN), -0.15, 1)
        self.assertAlmostEqual(sim.sc.true_b, sim.sc.true_a * 0.85, delta=1e-9)
        both = HistorySim(D("duration_s"), 0.0, 1, dur_mult_b=1.2, hang_extra=0.05)      # B: calls 20% longer, 5% of answered calls cut short
        shorts = [L["call_duration"] for L in history.leads() if L["connected"] and L["call_duration"] < history.EARLY_HANGUP_S]
        # one answered call per connected lead, so the expected length is a plain mixture
        self.assertAlmostEqual(both.sc.true_b, 0.95 * 1.2 * both.sc.true_a + 0.05 * sum(shorts) / len(shorts), delta=1e-9)


# ---------------------------------------------------------------------------- the engine's metrics path

class EngineMetricsPath(unittest.TestCase):
    def test_a_custom_rate_primary_promotes(self):
        rec = run([P(metriclib.validate(MEET_CB))], effect=0.15, window=14, lpd=1500, mde=0.03)
        r, last = rec["result"], rec["looks"][-1]
        self.assertEqual(r["kind"], "PROMOTE")
        self.assertIn("Meeting or callback", r["reason"])                              # metrics are named by name, not key
        self.assertEqual((last["xA"], last["dA"]), (round(last["xA"]), round(last["dA"])))       # a lead-level rate: whole counts, the two-proportion test
        self.assertAlmostEqual(last["rateA"], last["xA"] / last["dA"])
        self.assertLess(last["dA"], last["nA"])                                         # the denominator counts connected leads only
        self.assertIsNone(last["guardrail"])
        self.assertIn("holdback", rec)                                                  # a rate primary keeps the holdback week

    def test_an_average_primary_promotes(self):
        rec = run([P(metriclib.validate(AVG_LEN))], effect=-0.15)
        r, last = rec["result"], rec["looks"][-1]
        self.assertEqual(r["kind"], "PROMOTE")
        self.assertLess(last["rateB"], last["rateA"])
        self.assertGreater(last["z"], 1.96)                                             # lower is better: z is signed so that a win is positive
        self.assertAlmostEqual(last["ci95"][1] - last["ci95"][0], 2 * 1.96 * math.sqrt(last["seA"] ** 2 + last["seB"] ** 2), delta=1e-9)
        self.assertNotIn("holdback", rec)                                               # the holdback week is a proportion check
        self.assertEqual(rec["config"]["primary_type"], "average")

    def test_a_guardrail_breach_stops_b(self):
        rec = run([P(D("buylead_created")), G(D("duration_s"), 10, "rel")], effect=0.15, dur_mult=1.4)
        r = rec["result"]
        self.assertEqual(r["kind"], "STOP_GUARDRAIL")
        self.assertLess(r["at_look"], 7)                                                # caught by the daily check
        self.assertIn("Call duration", r["reason"])
        g = next(m for m in rec["looks"][-1]["metrics"] if m["role"] == "guardrail")
        self.assertGreaterEqual(g["z_breach"], rec["looks"][-1]["harm_g"])

    def test_a_guardrail_not_proven_holds_b(self):
        rec = run([P(D("buylead_created")), G(D("duration_s"), 10, "rel")], effect=0.15, dur_mult=1.12)
        r = rec["result"]
        self.assertEqual(r["kind"], "HOLD_FOR_APPROVAL")
        self.assertIn("was not proven within +10%", r["reason"])
        g = next(m for m in rec["looks"][-1]["metrics"] if m["role"] == "guardrail")
        self.assertGreaterEqual(g["upper"], g["margin"])

    def test_points_limit_on_an_average_is_in_its_units(self):
        rec = run([P(D("buylead_created")), G(D("duration_s"), 5, "pts")], effect=0.15, dur_mult=1.4)
        self.assertEqual(rec["result"]["kind"], "STOP_GUARDRAIL")
        self.assertIn("(tolerated +5 s)", rec["result"]["reason"])
        g = next(m for m in rec["looks"][-1]["metrics"] if m["role"] == "guardrail")
        self.assertAlmostEqual(g["margin"], 5.0)

    def test_secondary_metrics_are_reported_and_never_decide(self):
        base = [P(D("buylead_created")), G(D("duration_s"), 10, "rel")]
        a = run(base, effect=0.15, dur_mult=1.12)
        b = run(base + [S(D("early_hangup")), S(metriclib.validate(MEET_CB))], effect=0.15, dur_mult=1.12)
        self.assertEqual((a["result"]["kind"], a["result"]["reason"]), (b["result"]["kind"], b["result"]["reason"]))
        self.assertEqual([l["z"] for l in a["looks"]], [l["z"] for l in b["looks"]])
        roles = [m["role"] for m in b["looks"][-1]["metrics"]]
        self.assertEqual(roles, ["primary", "guardrail", "secondary", "secondary"])
        sec = b["looks"][-1]["metrics"][2]
        for k in ("value", "num", "den", "n", "se"):
            self.assertIn(k, sec["A"])
        self.assertAlmostEqual(sec["hi"] - sec["lo"], 2 * 1.96 * sec["se"], delta=1e-12)
        self.assertNotEqual(a["config_hash"], b["config_hash"])                         # the metric list is part of the locked config

    def test_the_minimum_leads_gate_blocks_the_final_call(self):
        rec = run([P(D("buylead_created"))], effect=0.5, lpd=300, share=0.1, min_per_arm=500)
        r, last = rec["result"], rec["looks"][-1]
        self.assertLess(last["nB"], 500)
        self.assertEqual(r["kind"], "INCONCLUSIVE")
        self.assertIn("fewer than 500 leads", r["reason"])

    def test_a_vs_a_rarely_promotes(self):
        kinds, avg_len, hang = [], metriclib.validate(AVG_LEN), D("early_hangup")
        for s in range(200):                                                            # an average and a call-level rate: both use the delta method
            prim = avg_len if s % 2 == 0 else hang
            kinds.append(run([P(prim)], 0.0, seed=9000 + s, lpd=300, min_per_arm=100, mde=10 if s % 2 == 0 else 0.05)["result"]["kind"])
        self.assertLess(kinds.count("PROMOTE") / 200, 0.06)

    def test_bad_metric_lists_are_refused(self):
        bl, dur = D("buylead_created"), D("duration_s")
        for mets, words in (([G(dur, 10, "rel")], "exactly one primary"), ([P(bl), P(dur)], "exactly one primary"),
                            ([P(bl)] + [G(dur, 10, "rel")] * 4, "at most 3 guardrails"), ([P(bl), {"role": "guardrail", "def": dur, "limit": None}], "set a limit"),
                            ([P(bl), S(bl)], "used twice")):
            with self.assertRaises(ValueError) as e:
                Config(metrics=mets).validate()
            self.assertIn(words, str(e.exception))


# ---------------------------------------------------------------------------- the wizard endpoint

def body(**over):
    base = variants.load_base()["text"]
    return {"name": "Metrics test", "prompt_b": base.replace("buyer name = 3", "buyer name = 2"), "share_b": 0.3, "window_days": 7, "improvement": 0.03,
            "leads_per_day": 1000, "metrics": [{"role": "primary", "def": MEET_CB}, {"role": "guardrail", "def": AVG_LEN, "limit": {"value": 10, "kind": "rel"}},
                                               {"role": "secondary", "key": "early_hangup"}], "effect_rel": 0.15, "seed": 6, **over}


class WizardMetrics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = server.run_wizard(body())

    def test_the_metric_list_is_locked_into_the_config(self):
        rec = self.r["record"]
        roles = [(m["role"], m["def"]["key"]) for m in rec["config"]["metrics"]]
        self.assertEqual(roles, [("primary", "custom_meeting_or_callback"), ("guardrail", "custom_answered_call_length"), ("secondary", "early_hangup")])
        self.assertEqual(rec["config"]["primary_goal"], "custom_meeting_or_callback")
        self.assertEqual(rec["config"]["secondary_role"], "none")
        self.assertAlmostEqual(rec["config"]["baseline"], ev(metriclib.validate(MEET_CB))["value"], delta=1e-6)
        self.assertTrue(lock_check(rec)["ok"])
        self.assertEqual([m["key"] for m in rec["looks"][-1]["metrics"]], ["custom_meeting_or_callback", "custom_answered_call_length", "early_hangup"])
        self.assertAlmostEqual(self.r["truth"]["true_b"], self.r["truth"]["true_a"] * 1.15, delta=1e-5)

    def test_the_engine_volume_matches_the_page(self):
        cfg = Config(**self.r["record"]["config"])
        p = history.audience()["p_connected_all"]
        self.assertAlmostEqual(cfg.eligible_per_day * p, 1000, delta=1)                # connected leads a day in the audience, as the page showed

    def test_a_changed_limit_changes_the_hash(self):
        b = body()
        b["metrics"][1]["limit"] = {"value": 12, "kind": "rel"}
        self.assertNotEqual(server.run_wizard(b)["record"]["config_hash"], self.r["record"]["config_hash"])

    def test_template_variables_must_match_prompt_a(self):
        base = variants.load_base()["text"]
        v = promptlint.variables(base)[0]
        with self.assertRaises(ValueError) as e:
            server.run_wizard(body(prompt_b=base.replace(v, "renamed_variable")))
        self.assertIn("no longer uses", str(e.exception))
        self.assertIn(v, str(e.exception))
        with self.assertRaises(ValueError) as e:
            server.run_wizard(body(prompt_b=base + "\nSay hello to {{ brand_new_variable }}.\n"))
        self.assertIn("brand_new_variable", str(e.exception))
        with self.assertRaises(ValueError):
            server.run_wizard(body(prompt_b=""))

    def test_metric_list_limits(self):
        g = {"role": "guardrail", "key": "duration_s", "limit": {"value": 10, "kind": "rel"}}
        mets = [{"role": "primary", "key": "buylead_created"}] + [dict(g, key=k) for k in ("duration_s", "early_hangup", "answered_pct", "connected_pct")]
        for m, words in ((mets, "at most 3 guardrails"), ([{"role": "primary", "key": "buylead_created"}, {"role": "secondary", "key": "buylead_created"}], "chosen twice"),
                         ([{"role": "primary", "key": "fatal_call"}], "Not in data yet"), ([{"role": "primary", "key": "buylead_created"}, dict(g, limit={"value": 0, "kind": "rel"})], "above 0"),
                         ([{"role": "primary", "key": "buylead_created"}, dict(g, limit=None)], "set a limit")):
            with self.assertRaises(ValueError) as e:
                server.run_wizard(body(metrics=m))
            self.assertIn(words, str(e.exception))

    def test_a_segment(self):
        r = server.run_wizard(body(segment=[{"factor": "Legal Status", "column": "legal_status", "values": ["Proprietorship"]}], leads_per_day=400))
        sc = r["record"]["result"]["segment_check"]
        self.assertEqual(sc["matching"], sc["counted_leads"])
        self.assertEqual(sc["rule"], "Leads where Legal Status is Proprietorship")
        self.assertEqual(r["baseline_note"], "")

    def test_a_thin_audience_uses_the_all_traffic_value(self):
        old = server.MIN_AUDIENCE_CONNECTED
        server.MIN_AUDIENCE_CONNECTED = 10 ** 9
        try:
            r = server.run_wizard(body(segment=[{"column": "vendor", "values": ["squadstack"]}], metrics=[{"role": "primary", "key": "buylead_created"}]))
        finally:
            server.MIN_AUDIENCE_CONNECTED = old
        self.assertIn("all-traffic value", r["baseline_note"])
        self.assertAlmostEqual(r["record"]["config"]["baseline"], ev(D("buylead_created"))["value"], delta=1e-6)

    def test_the_live_prompt_a(self):
        base = variants.load_base()["text"]
        live = base + "\nLive-only closing line.\n"
        r = server.run_wizard(body(prompt_a=live, prompt_a_version="v2", prompt_b=live.replace("buyer name = 3", "buyer name = 2"),
                                   metrics=[{"role": "primary", "key": "buylead_created"}], improvement=0.05))
        rec = r["record"]
        self.assertEqual(rec["variants"]["A"]["name"], "Production prompt v2")
        self.assertEqual(rec["result"]["production_before"], variants.prompt_hash(live))
        self.assertFalse(any("Live-only" in line for line in rec["variants"]["B"]["diff"]))      # the diff is against the live prompt
        self.assertEqual(rec["config"]["variant_a"], "live_" + variants.prompt_hash(live))

    def test_an_average_primary_needs_an_improvement_in_its_units(self):
        with self.assertRaises(ValueError) as e:
            server.run_wizard(body(metrics=[{"role": "primary", "def": AVG_LEN}], improvement=None))
        self.assertIn("own units", str(e.exception))
        r = server.run_wizard(body(metrics=[{"role": "primary", "def": AVG_LEN}], improvement=7, effect_rel=-0.15))
        self.assertEqual(r["record"]["result"]["kind"], "PROMOTE")
        self.assertGreater(r["record"]["config"]["primary_sd"], 0)


if __name__ == "__main__":
    unittest.main()
