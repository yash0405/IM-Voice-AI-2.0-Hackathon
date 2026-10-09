"""Decisions from results files, hold-for-approval, versioning, the spec's single-look rule. No network, no Sarvam."""
import json
import unittest
from dataclasses import replace

from canary import decide, engine, samples
from canary.engine import Config, build_design, lock_check, run_experiment
from canary.ledger import verify
from canary.scenarios import make
from canary.simulator import TrafficSim

BASE = dict(goal="buylead_created", share_b=0.3, baseline=0.45, mde=0.07, window_days=14)


def files(key, **over):
    return [{"name": f"results_{key}.csv", "text": samples.to_csv(samples.make_rows(key, **over)), "arm": None}]


class FileDecisions(unittest.TestCase):
    def test_each_sample_gives_its_expected_decision(self):
        want = {"b_wins": "PROMOTE", "b_harmful": "STOP_HARM", "b_flat": "INCONCLUSIVE", "guardrail_hold": "HOLD_FOR_APPROVAL"}
        for key, kind in want.items():
            rec = decide.decide(files(key), BASE)
            self.assertEqual(rec["result"]["kind"], kind, key)
            self.assertTrue(rec["ledger_ok"])

    def test_rate_guardrail_stops_a_win_with_more_early_hangups(self):
        rec = decide.decide(files("early_hangup"), {**BASE, "guard_name": "early_hangup", "guard_below_s": 15})
        self.assertEqual(rec["result"]["kind"], "STOP_GUARDRAIL")
        self.assertIn("early_hangup", rec["result"]["reason"])

    def test_two_separate_files_for_a_and_b(self):
        rows = samples.make_rows("b_wins")
        a = [r for r in rows if r["variant"] == "A"]
        b = [r for r in rows if r["variant"] == "B"]
        for r in a + b:
            r.pop("variant")
        rec = decide.decide([{"name": "a.csv", "text": samples.to_csv([{**r, "variant": ""} for r in a]), "arm": "A"},
                             {"name": "b.csv", "text": samples.to_csv([{**r, "variant": ""} for r in b]), "arm": "B"}], BASE)
        self.assertEqual(rec["result"]["kind"], "PROMOTE")

    def test_daily_summary_file(self):
        text = samples.to_daily_csv(samples.make_rows("b_wins"))
        rec = decide.decide([{"name": "daily.csv", "text": text, "arm": None}], BASE)
        self.assertEqual(rec["result"]["kind"], "PROMOTE")
        self.assertTrue(any("cannot show whether any lead saw both prompts" in w for w in rec["source"]["warnings"]))

    def test_other_formats_and_names(self):
        rows = samples.make_rows("b_wins", lpd=60, days=14)
        as_json = json.dumps([{"Lead ID": r["lead_id"], "Prompt": "control" if r["variant"] == "A" else "test", "Outcome": r["disposition"],
                               "Call Time": r["timestamp"], "AHT": r["duration_s"]} for r in rows])
        rec = decide.decide([{"name": "x.json", "text": as_json, "arm": None}], {**BASE, "mde": 0.15})
        self.assertIn(rec["result"]["kind"], {"PROMOTE", "INCONCLUSIVE"})      # parsed: different names, JSON, control/test
        self.assertEqual(rec["source"]["arms"]["A"] + rec["source"]["arms"]["B"], rec["source"]["leads"])

    def test_a_running_test_is_not_decided_early_without_evidence(self):
        rec = decide.decide(files("b_flat"), {**BASE, "through_day": 5})
        self.assertEqual(rec["result"]["kind"], "CONTINUE")
        self.assertEqual(rec["result"]["status"], "running")
        self.assertEqual(rec["result"]["days_seen"], 5)

    def test_early_decision_is_the_same_as_on_the_full_file(self):
        """Results up to the day of the decision give the same decision: nothing later in the file leaks in."""
        full = decide.decide(files("b_harmful"), BASE)
        day = full["looks"][-1]["day"]
        part = decide.decide(files("b_harmful"), {**BASE, "through_day": day})
        self.assertEqual(part["result"]["kind"], full["result"]["kind"])
        self.assertEqual(part["result"]["calls_analysed"], full["result"]["calls_analysed"])

    def test_messy_file_is_cleaned_and_every_problem_is_reported(self):
        rec = decide.decide(files("messy"), BASE)
        notes = " | ".join(rec["source"]["warnings"])
        for needle in ("repeated call ids", "unknown variant", "no outcome", "BOTH prompts"):
            self.assertIn(needle, notes)
        self.assertGreater(rec["source"]["leads_in_both_arms"], 0)

    def test_leads_are_counted_once(self):
        rows = samples.make_rows("b_wins", lpd=50, days=3)
        rec = decide.decide(files("b_wins", lpd=50, days=3), {**BASE, "mde": 0.2})
        self.assertEqual(rec["source"]["leads"], len({r["lead_id"] for r in rows}))
        self.assertGreater(rec["source"]["calls_used"], rec["source"]["leads"])

    def test_unusable_files_say_what_to_fix(self):
        with self.assertRaises(decide.DataError) as e:
            decide.decide(files("b_wins"), {"share_b": 0.3, "baseline": 0.45, "window_days": 14})
        self.assertIn("which outcome counts as the goal", str(e.exception))
        with self.assertRaises(decide.DataError):
            decide.decide([{"name": "e.csv", "text": "", "arm": None}], BASE)
        with self.assertRaises(decide.DataError) as e:
            decide.decide([{"name": "x.csv", "text": "lead_id,disposition\nL1,buylead_created\n", "arm": None}], BASE)
        self.assertIn("which prompt", str(e.exception))
        with self.assertRaises(decide.DataError) as e:
            only_a = [r for r in samples.make_rows("b_wins", lpd=20, days=3) if r["variant"] == "A"]
            decide.decide([{"name": "a.csv", "text": samples.to_csv(only_a), "arm": None}], BASE)
        self.assertIn("both prompts", str(e.exception))

    def test_decision_is_repeatable(self):
        a = decide.decide(files("b_wins"), BASE)
        b = decide.decide(files("b_wins"), BASE)
        self.assertEqual(a["ledger_head"], b["ledger_head"])


class HoldAndRollback(unittest.TestCase):
    def test_guardrail_hold_scenario_asks_for_approval_and_both_answers_are_logged(self):
        cfg, sim, sc = make("guardrail_hold")
        rec = run_experiment(cfg, sim)
        self.assertEqual(rec["result"]["kind"], "HOLD_FOR_APPROVAL")
        self.assertEqual(rec["result"]["routing_after"]["B"], cfg.share_b)         # callers are unaffected while a person decides
        self.assertEqual(rec["result"]["production_after"], rec["result"]["production_before"])
        ap, rj = rec["tails"]["approve"], rec["tails"]["reject"]
        ok, _ = verify(rec["ledger"] + ap)
        self.assertTrue(ok)
        ok, _ = verify(rec["ledger"] + rj)
        self.assertTrue(ok)
        kinds = [json.loads(e["body"])["type"] for e in ap]
        self.assertEqual(kinds, ["approval", "promotion", "routing_changed"])

    def test_tampering_with_a_tail_is_detected(self):
        cfg, sim, sc = make("guardrail_hold")
        rec = run_experiment(cfg, sim)
        bad = [dict(e) for e in rec["tails"]["approve"]]
        bad[0]["body"] = bad[0]["body"].replace("approved", "rejected")
        self.assertFalse(verify(rec["ledger"] + bad)[0])

    def test_promotion_can_be_rolled_back_and_the_rollback_is_logged(self):
        cfg, sim, sc = make("b_wins")
        rec = run_experiment(cfg, sim)
        self.assertEqual(rec["result"]["kind"], "PROMOTE")
        rb = rec["tails"]["rollback"]
        self.assertTrue(verify(rec["ledger"] + rb)[0])
        self.assertEqual(json.loads(rb[0]["body"])["type"], "rollback")

    def test_manual_approval_mode_holds_every_win(self):
        cfg, sim, sc = make("b_wins")
        rec = run_experiment(Config(**{**cfg.as_dict(), "approval": "manual"}), sim)
        self.assertEqual(rec["result"]["kind"], "HOLD_FOR_APPROVAL")
        self.assertEqual(rec["result"]["hold_cause"], "manual_approval")
        self.assertEqual(rec["result"]["routing_after"]["A"], 1 - cfg.share_b)


class MoreLeads(unittest.TestCase):
    def test_inconclusive_says_how_many_more_leads_settle_it(self):
        rec = decide.decide(files("b_flat"), BASE)
        m = rec["result"]["more_leads"]
        self.assertTrue(m["options"])
        pend = [o for o in m["options"] if not o["enough_already"]]
        self.assertTrue(pend)
        for o in pend:
            self.assertGreater(o["more_leads"], 0)
            self.assertGreater(o["more_days"], 0)
        # a smaller lift always needs more leads than a bigger one
        self.assertEqual(sorted(pend, key=lambda o: o["lift_pp"], reverse=True), pend)
        self.assertEqual(sorted(pend, key=lambda o: o["more_leads"]), pend)

    def test_simulated_inconclusive_scenario_also_carries_it(self):
        cfg, sim, sc = make("inconclusive")
        rec = run_experiment(cfg, sim)
        self.assertIn("more_leads", rec["result"])


class SingleLookRule(unittest.TestCase):
    def test_boundaries_match_the_spec(self):
        cfg = Config(rule_set="final_look", window_days=7, leads_per_day=600, share_b=0.5, secondary_role="none")
        d = build_design(cfg)
        self.assertEqual(len(d.look_n), 7)
        self.assertTrue(all(e >= engine.NEVER_Z for e in d.eff[:-1]))            # no early promotion
        self.assertAlmostEqual(d.eff[-1], 1.96, places=2)                       # 95% at the end
        self.assertAlmostEqual(d.harm[0], 3.09, places=2)                       # 99.9% daily harm bar

    def test_it_runs_end_to_end_and_never_promotes_before_the_last_day(self):
        cfg, sim, sc = make("b_wins")
        rec = run_experiment(Config(**{**cfg.as_dict(), "rule_set": "final_look", "share_b": 0.3, "mde": 0.05}), sim)
        self.assertEqual(rec["result"]["kind"], "PROMOTE")
        self.assertEqual(rec["result"]["at_look"], rec["result"]["of_looks"])
        self.assertTrue(rec["ledger_ok"])


class FadedWin(unittest.TestCase):
    def _design(self):
        cfg = Config(secondary_role="none", share_b=0.5, baseline=0.45, mde=0.07, window_days=14, leads_per_day=300, loss_check=False)
        return cfg, build_design(cfg)

    def _counts(self, n, rate_a, rate_b):
        c = engine.Counts()
        c.nA = c.aA = n // 2; c.nB = c.aB = n - n // 2
        c.xA = round(c.nA * rate_a); c.xB = round(c.nB * rate_b)
        return c

    def test_a_win_that_faded_below_the_line_is_not_shipped(self):
        cfg, d = self._design()
        mon = engine.Monitor(cfg, d)
        mon.eff_at, mon.eff_z = 3, 5.0                      # the win line was crossed at look 4 ...
        last = len(d.look_n) - 1
        dec = mon.look(last, self._counts(d.look_n[last], 0.45, 0.45), final=True)      # ... but by the end there is no gap at all
        self.assertEqual(dec["kind"], "HOLD_FOR_APPROVAL")
        self.assertEqual(dec["cause"], "evidence_faded")
        self.assertIn("faded", dec["reason"])
        mid = engine.Monitor(cfg, d)
        mid.eff_at, mid.eff_z = 3, 5.0
        dec = mid.look(10, self._counts(d.look_n[10], 0.45, 0.45), final=False)         # not the end yet: keep waiting, do not ship
        self.assertEqual(dec["kind"], "CONTINUE")

    def test_a_win_that_stays_above_the_line_still_ships(self):
        cfg, d = self._design()
        mon = engine.Monitor(cfg, d)
        mon.eff_at, mon.eff_z = 3, 5.0
        last = len(d.look_n) - 1
        dec = mon.look(last, self._counts(d.look_n[last], 0.40, 0.60), final=True)
        self.assertEqual(dec["kind"], "PROMOTE")


class Versioning(unittest.TestCase):
    def test_a_change_is_a_new_version_with_a_parent(self):
        c1 = Config()
        c2 = c1.new_version(share_b=0.2)
        self.assertEqual((c2.version, c2.parent_hash), (2, c1.hash()))
        self.assertNotEqual(c1.hash(), c2.hash())

    def test_lock_check_catches_a_rule_changed_after_the_start(self):
        cfg, sim, sc = make("b_wins")
        rec = run_experiment(cfg, sim)
        self.assertTrue(lock_check(rec)["config_unchanged"])
        rec["config"]["guardrail_margin"] = 0.50          # bend the rules after the fact
        self.assertFalse(lock_check(rec)["config_unchanged"])


class SpecNumbers(unittest.TestCase):
    def test_spec_calculator_example_is_internally_inconsistent(self):
        from canary.planner import spec_calculator_check
        c = spec_calculator_check()
        self.assertGreater(c["days_needed_for_0_8pp"], 15)          # the spec says 12
        self.assertLess(c["baseline_that_gives_1_2pp"], 0.10)


HAND = dict(goal="buylead_created", share_b=0.3, baseline=0.45, mde=0.07, window_days=14)


def _csv(rows, fields=None):
    return samples.to_csv(rows) if fields is None else "\n".join([",".join(fields)] + [",".join(str(r.get(f, "")) for f in fields) for r in rows])


def _mod(key, fn, **kw):
    rows = samples.make_rows(key, **kw)
    fn(rows)
    return [{"name": "x.csv", "text": samples.to_csv(rows), "arm": None}]


class FileSafety(unittest.TestCase):
    """Each test here reproduces a bug an independent reviewer found in the first version of the file reader."""

    def test_the_plan_must_be_given_up_front(self):
        for missing in ("baseline", "share_b", "window_days"):
            o = {k: v for k, v in BASE.items() if k != missing}
            with self.assertRaises(decide.DataError) as e:
                decide.decide(files("b_wins"), o)
            self.assertIn("plan", str(e.exception))

    def test_a_missing_or_unusable_duration_never_lets_a_win_ship(self):
        def blank_one(rows): rows[5]["duration_s"] = ""
        rec = decide.decide(_mod("b_wins", blank_one), BASE)
        self.assertEqual(rec["result"]["kind"], "HOLD_FOR_APPROVAL")
        self.assertIn("could not be evaluated", rec["result"]["reason"])
        for bad in ("0", "-5", "60"):
            def setall(rows, v=bad):
                for r in rows: r["duration_s"] = v
            self.assertNotEqual(decide.decide(_mod("b_wins", setall), BASE)["result"]["kind"], "PROMOTE", bad)

    def test_a_guardrail_column_with_text_is_refused(self):
        def text(rows):
            for r in rows: r["early"] = "hangup" if r["duration_s"] < 15 else "ok"
        rows = samples.make_rows("early_hangup")
        text(rows)
        f = [{"name": "x.csv", "text": samples.to_csv(rows).replace("connected", "connected,early", 1) if False else "call_id,lead_id,timestamp,variant,disposition,duration_s,early\n" +
              "\n".join(f"{r['call_id']},{r['lead_id']},{r['timestamp']},{r['variant']},{r['disposition']},{r['duration_s']},{r['early']}" for r in rows), "arm": None}]
        with self.assertRaises(decide.DataError) as e:
            decide.decide(f, {**BASE, "guard_name": "early_hangup", "guard_column": "early"})
        self.assertIn("not yes/no", str(e.exception))

    def test_results_up_to_day_d_never_use_calls_after_day_d(self):
        """A later conversion must not change an earlier look: every partial run equals the same prefix of the full run."""
        def late_conversions(rows):
            first = {}
            for r in rows: first.setdefault(r["lead_id"], r)
            extra = []
            for lead, r in list(first.items())[:1200]:
                if r["variant"] == "B" and r["disposition"] != "buylead_created" and r["timestamp"] < "2026-10-17":
                    extra.append({**r, "call_id": r["call_id"] + "late", "timestamp": "2026-10-25 11:00:00", "disposition": "buylead_created", "duration_s": 600.0})
            rows.extend(extra)
        files_ = _mod("b_flat", late_conversions)
        full = decide.decide(files_, {**BASE, "mde": 0.03})
        for d in (2, 4, 6):
            part = decide.decide(files_, {**BASE, "mde": 0.03, "through_day": d})
            for a, b in zip(part["looks"], full["looks"]):
                self.assertEqual((a["n"], a["xA"], a["xB"], round(a["z"], 9), a["eff"]), (b["n"], b["xA"], b["xB"], round(b["z"], 9), b["eff"]), f"through_day={d}")

    def test_a_blank_goal_cell_is_not_a_non_conversion(self):
        def blank_b(rows):
            for r in rows:
                if r["variant"] == "B" and r["disposition"] == "buylead_created": r["disposition"] = ""
        rec = decide.decide(_mod("b_wins", blank_b), BASE)
        self.assertTrue(any("no outcome" in w for w in rec["source"]["warnings"]))
        self.assertNotEqual(rec["result"]["kind"], "STOP_HARM")

    def test_a_goal_that_matches_nothing_is_refused_and_a_zero_one_column_does_not_override_it(self):
        with self.assertRaises(decide.DataError) as e:
            decide.decide(files("b_wins"), {**BASE, "goal": "buylead"})
        self.assertIn("none of the dispositions you named", str(e.exception))
        rows = samples.make_rows("b_wins")
        text = "call_id,lead_id,timestamp,variant,disposition,duration_s,success\n" + "\n".join(
            f"{r['call_id']},{r['lead_id']},{r['timestamp']},{r['variant']},{r['disposition']},{r['duration_s']},1" for r in rows)
        rec = decide.decide([{"name": "x.csv", "text": text, "arm": None}], BASE)
        self.assertEqual(rec["result"]["kind"], "PROMOTE")
        self.assertTrue(any("ignored because you named" in w for w in rec["source"]["warnings"]))

    def test_direction_words_and_the_lower_is_better_plan(self):
        rec = decide.decide(files("b_harmful"), {**BASE, "direction": "Higher"})
        self.assertEqual(rec["result"]["kind"], "STOP_HARM")
        with self.assertRaises(decide.DataError):
            decide.decide(files("b_harmful"), {**BASE, "direction": "sideways"})
        from canary.engine import Config, build_design
        from canary import seqdesign
        d = build_design(Config(primary_direction="lower", baseline=0.9, mde=0.05, share_b=0.3, secondary_role="none"))
        self.assertEqual(d.n_max, seqdesign.plan_sample_size(0.9, -0.05, 0.3, 0.025, 0.8, 40)["n_max"])
        with self.assertRaises(ValueError):
            Config(primary_direction="up").validate()

    def test_hostile_input_gives_a_plain_message_never_a_crash(self):
        daily = "date,variant,leads,goal_count\n2026-10-12,A,100,40\n2026-10-12,B,50,25\n2026-10-13,A,0,0\n2026-10-13,B,0,0\n"
        rec = decide.decide([{"name": "h.csv", "text": daily, "arm": None}], BASE)                          # a last day with no leads is skipped, not a crash
        self.assertIn(rec["result"]["kind"], {"CONTINUE", "INCONCLUSIVE"})
        cases = [
            ("date,variant,leads,goal_count\n2026-10-12,A,-5,1\n2026-10-12,B,5,1\n", {}),                 # negative counts
            ("date,variant,leads,goal_count\n2026-10-12,A,5,1\n2026-10-12,A,5,1\n2026-10-12,B,5,1\n", {}),  # two rows for one day and prompt
            ("date,variant,leads,goal_count\n20261399,A,5,1\n20261399,B,5,1\n", {}),                       # a nonsense day
            ("[{'a':", {}), ("{" * 200000, {}), ("a,b\r1,2\r", {}),                                        # broken JSON, deep JSON, odd line ends
        ]
        for text, extra in cases:
            with self.assertRaises(decide.DataError):
                decide.decide([{"name": "h.csv", "text": text, "arm": None}], {**BASE, **extra})
        for bad in ({"through_day": -3}, {"window_days": -1}, {"share_b": 0}, {"share_b": 0.8}, {"mde": 0}, {"baseline": 1.5}, {"start": "junk"}):
            with self.assertRaises(decide.DataError, msg=str(bad)):
                decide.decide(files("b_wins"), {**BASE, **bad})
        def huge(rows): rows[3]["duration_s"] = "1e200"
        rec = decide.decide(_mod("b_wins", huge), BASE)                                                   # an absurd duration is left out and reported
        self.assertTrue(any("not usable" in w for w in rec["source"]["warnings"]))

    def test_untimed_file_with_an_awkward_size_does_not_crash(self):
        for n in (801, 810, 819):
            rows = samples.make_rows("b_wins", lpd=n // 14 + 1, days=14)[:n]
            text = "lead_id,variant,disposition,duration_s\n" + "\n".join(f"{r['lead_id']},{r['variant']},{r['disposition']},{r['duration_s']}" for r in rows)
            rec = decide.decide([{"name": "u.csv", "text": text, "arm": None}], BASE)
            self.assertIn(rec["result"]["kind"], {"PROMOTE", "CONTINUE", "INCONCLUSIVE", "HOLD_FOR_APPROVAL", "STOP_HARM", "HALT_SRM", "STOP_GUARDRAIL"})

    def test_placeholder_lead_ids_are_not_merged_into_one_lead(self):
        def nullify(rows):
            for r in rows[:500]: r["lead_id"] = "NULL"
        rec = decide.decide(_mod("b_wins", nullify), BASE)
        n_real = len({r["lead_id"] for r in samples.make_rows("b_wins")}) - 1
        self.assertGreaterEqual(rec["source"]["leads"], n_real)
        self.assertTrue(any("no usable lead id" in w for w in rec["source"]["warnings"]))

    def test_date_and_time_in_separate_columns_are_read(self):
        rows = samples.make_rows("b_wins", lpd=60, days=14)
        text = "lead_id,date,time,variant,disposition,duration_s\n" + "\n".join(
            f"{r['lead_id']},{r['timestamp'][:10]},{r['timestamp'][11:]},{r['variant']},{r['disposition']},{r['duration_s']}" for r in rows)
        rec = decide.decide([{"name": "x.csv", "text": text, "arm": None}], {**BASE, "mde": 0.2})
        self.assertTrue(rec["source"]["has_time"])
        self.assertGreater(rec["looks"][-1]["day"], 1)

    def test_time_zones_and_epochs_do_not_depend_on_the_server(self):
        from datetime import datetime
        self.assertEqual(decide.parse_time("2026-10-12T01:00:00+05:30"), datetime(2026, 10, 11, 19, 30))
        self.assertEqual(decide.parse_time("1760000000"), datetime(2025, 10, 9, 8, 53, 20))

    def test_never_more_leads_than_the_plan_and_the_reported_day_is_the_real_one(self):
        rec = decide.decide(files("b_wins", lpd=600), BASE)
        self.assertLessEqual(rec["result"]["calls_analysed"], rec["design"]["n_max"])
        self.assertEqual(rec["result"]["days_seen"], rec["looks"][-1]["day"])
        self.assertTrue(any("not used" in w for w in rec["source"]["warnings"]))

    def test_records_are_strict_json(self):
        rec = decide.decide(files("b_wins"), BASE)
        json.dumps(rec, allow_nan=False)

    def test_a_lead_counts_only_calls_of_its_own_arm(self):
        base = [{"call_id": f"c{i}", "lead_id": f"L{i}", "timestamp": "2026-10-12 10:00:00", "variant": "A" if i % 2 else "B", "disposition": "other", "duration_s": 60} for i in range(200)]
        base.append({"call_id": "x1", "lead_id": "L1", "timestamp": "2026-10-13 10:00:00", "variant": "B", "disposition": "buylead_created", "duration_s": 60})   # L1 is A's lead
        rec = decide.decide([{"name": "x.csv", "text": samples.to_csv(base), "arm": None}], {**BASE, "mde": 0.3})
        self.assertEqual(rec["looks"][-1]["xA"] + rec["looks"][-1]["xB"], 0)
        self.assertEqual(rec["source"]["leads_in_both_arms"], 1)

    def test_what_the_goal_and_guardrail_mean_is_part_of_the_locked_config(self):
        a = decide.decide(files("early_hangup"), {**BASE, "guard_name": "early_hangup", "guard_below_s": 15})
        b = decide.decide(files("early_hangup"), {**BASE, "guard_name": "early_hangup", "guard_below_s": 5})
        self.assertNotEqual(a["config_hash"], b["config_hash"])
        self.assertEqual(a["source"]["files_sha256"], b["source"]["files_sha256"])
        self.assertTrue(engine.lock_check(a)["ok"])

    def test_an_impractical_answer_is_labelled_as_such(self):
        rec = decide.decide(files("b_flat"), {**BASE, "mde": 0.0005, "baseline": 0.45})
        opts = rec["result"].get("more_leads", {}).get("options", [])
        if opts:
            self.assertTrue(all("impractical" in o for o in opts))


if __name__ == "__main__":
    unittest.main()
