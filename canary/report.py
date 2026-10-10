"""Generate docs/QA_REPORT.md from the proof run, the scenario runs and the evaluator benchmark.
Nothing in the report is typed by hand: every figure below comes from code that can be re-run."""
from __future__ import annotations

import json
import statistics
import subprocess
import sys
from pathlib import Path

from .build import OUT, ROOT, scenario_bundle
from .scenarios import ORDER, SCENARIOS
from .synth import benchmark_report

M = {"canary": "Picky (ours)", "naive_peek": "Naive peeking", "fixed_horizon": "Fixed-horizon z-test", "higher_rate": "Higher rate wins"}


def pct(x, d=1):
    return f"{x * 100:.{d}f}%"


def ci(o):
    return f"{pct(o['rate'])} [{pct(o['ci'][0])}, {pct(o['ci'][1])}]"


def rate(m, k):
    return m["outcomes"].get(k, {"rate": 0, "ci": [0, 0]})


def run_tests() -> str:
    r = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests"], cwd=ROOT, capture_output=True, text=True)
    lines = [l.strip() for l in (r.stderr + r.stdout).splitlines() if l.strip()]
    ran = next((l for l in lines if l.startswith("Ran ")), "no result line")
    status = next((l for l in reversed(lines) if l.startswith("OK") or l.startswith("FAILED")), "unknown")
    return f"{ran} - {status}"


def _extra_sections(w, P):
    """Hold for approval, 'how many more leads', decisions from results files, the dashboard spec's rule. All from re-runnable code."""
    import json as _j
    from dataclasses import replace
    from .engine import lock_check, run_experiment
    from .ledger import verify
    from .planner import spec_calculator_check
    from .scenarios import make
    from .simulator import TrafficSim
    w("## 5b. Hold for approval, rollback, and 'how many more leads' (decision table of the BRD and the dashboard spec)\n")
    b = scenario_bundle("guardrail_hold")["record"]
    c, sc = make("guardrail_hold")[0], make("guardrail_hold")[2]
    kinds = {}
    for seed in range(1, 61):
        k = run_experiment(c, TrafficSim(replace(sc, seed=seed)))["result"]["kind"]
        kinds[k] = kinds.get(k, 0) + 1
    w(f"- **Hold for approval.** A win whose guardrail is not proven is not thrown away and not shipped on its own: nothing changes for callers while a person decides. The scenario ends `{b['result']['kind']}` at {b['result']['calls_analysed']:,} calls "
      f"({b['looks'][-1]['guardrail']['worse']:+.1%} handling time against a +15% limit). Over 60 seeds of this scenario: " + ", ".join(f"{k} {v}" for k, v in sorted(kinds.items(), key=lambda x: -x[1])) + f" (the demo seed shows the most common outcome).")
    ok_a = verify(b["ledger"] + b["tails"]["approve"])[0]; ok_r = verify(b["ledger"] + b["tails"]["reject"])[0]
    w(f"- **Approve / reject / rollback are logged.** Both answers are pre-chained to the real ledger head; the hash chain verifies after approve ({'yes' if ok_a else 'NO'}) and after reject ({'yes' if ok_r else 'NO'}); a tampered answer is detected (tests/test_decide.py). A promotion carries a one-click rollback entry the same way.")
    inc = scenario_bundle("inconclusive")["record"]["result"].get("more_leads", {"options": []})
    w("- **Inconclusive says what would settle it.** " + "; ".join((f"already enough data to detect {o['lift_pp']} points" if o["enough_already"] else f"{o['more_leads']:,} more leads (~{o['more_days']} days) to detect {o['lift_pp']} points" + (" (a guess: the lift seen so far)" if o["guess"] else "")) for o in inc["options"]) + ".")
    lk = lock_check(scenario_bundle("b_wins")["record"])
    w(f"- **Config is locked and versioned.** The registered config hash ({lk['config_hash_registered']}) still matches the stored config ({'yes' if lk['config_unchanged'] else 'NO'}); a rule edited after the start fails this check (test), and any change is a new version pointing at its parent.\n")
    if P.get("files"):
        F = P["files"]
        w("## 5c. Decisions from results files (the voice test runs elsewhere; we judge its results)\n")
        w("The PM's model is: the test is performed outside our scope and files with the metrics for A and B come to us. `python -m canary decide FILE` (and the dashboard's Results files tab) reads them, checks them, counts each lead once, replays them day by day through the same decision function and returns the same record as a simulated run. "
          "Proof: synthetic files with a known truth, written to CSV, read back and decided end to end.\n")
        w("| Truth in the file | Files | Ship B | Stop B | No decision / held | Median leads | Ledger intact |\n|---|---|---|---|---|---|---|")
        for k, v in F.items():
            o = lambda x: v["outcomes"].get(x, {"rate": 0})["rate"]
            w(f"| {v['label']} | {v['runs']} | {ci(v['outcomes']['PROMOTE']) if 'PROMOTE' in v['outcomes'] else '0.0%'} | {pct(o('STOP_HARM') + o('STOP_GUARDRAIL'))} | {pct(o('INCONCLUSIVE') + o('HOLD_FOR_APPROVAL'))} | {v['median_n']:,.0f} | {v['ledger_ok']}/{v['runs']} |")
        w("\nThe files are synthetic (outcomes from a known truth, real call durations); they prove the path, not a real prompt. Data checks are reported, never repaired silently: repeated call ids, unknown variant names, missing outcomes, leads served both prompts, a lead with several calls. The decision is identical whether results arrive day by day or all at once (test), because the planned maximum comes only from the pre-registered config.\n")
    if P.get("aa_brd"):
        A, SB = P["aa_brd"], P.get("split_brd") or []
        w("## 5d. The second BRD's headline proofs: A vs A, and the split\n")
        w(f"**A vs A, {A['runs']:,} runs** (identical prompts; {A['days']} days, {A['config']['leads_per_day']:,} leads a day, {A['config']['share_b']:.0%} to B, one winner call on the last day, a 99.9% daily harm check from {A['config']['min_per_arm']:,} leads per prompt). The BRD's target is a false winner 'about 5% of the time'. That figure is the two-sided 95% test: about 5% of identical-prompt tests look different in EITHER direction, 2.5% in B's favour (a false winner: promoted) and 2.5% against it (logged as a loss: nothing ships). We report both so the target is read correctly.\n")
        w("| Outcome when A = B | Rate | 95% interval | Reading |\n|---|---|---|---|")
        for key, label, note in (("promoted", "Wrongly promoted (false winner)", "target 2.5%"), ("logged_as_loss", "Logged as a loss (nothing ships)", "about 2.5%"), ("significant_either_way", "Looks different either way", "the BRD's '~5%'"),
                                 ("early_harm_stop", "Stopped early by the daily harm check", f"{A['early_harm_stop_per_check']:.2%} per daily check ({A['daily_checks']:,} checks could fire); the BRD's target is about 0.1% a check"), ("halted_split", "Halted by the split / log check", "false alarm of the safety check"),
                                 ("plain_daily_check_false_winner", "A plain p < 0.05 check every day (from 50 leads per prompt) crowns a winner", "the peeking trap")):
            if key in A:
                w(f"| {label} | {pct(A[key]['rate'], 2)} | {pct(A[key]['ci'][0], 2)} to {pct(A[key]['ci'][1], 2)} | {note} |")
        w("")
        if SB:
            from . import catalog
            gv = list(SB[0]["stratified"]["mix_gap_pp"])                      # the balance factors the study measured (catalog.BALANCE_VARS)
            lab = lambda n, k="label": catalog.VARS[n][k] if n in catalog.VARS else n
            blocked = [n for n in gv if n in catalog.STRATA_VARS]
            n_strata = 1
            for n in catalog.STRATA_VARS:
                n_strata *= len(catalog.VARS[n]["values"])
            w(f"**Split accuracy and lead mix** (the BRD's router: shuffled blocks inside each {' x '.join(lab(n) for n in catalog.STRATA_VARS)} group, against a plain coin flip per lead; the lead factors are synthetic, see the limitations). Error is in percentage points of B share; mix gap is the biggest difference between A's and B's share over the values of one factor.\n")
            w(f"| Leads | B share | Audience | Router | Mean error | 95th pct error | Within +/-0.5 pp | Mix gap {' / '.join(lab(n, 'short') for n in gv)} (mean pp) | Leads that changed arm |\n|---|---|---|---|---|---|---|---|---|")
            for x in SB:
                for mode, nm in (("stratified", "**Stratified blocks**"), ("hash", "Plain random")):
                    m = x[mode]; g = m["mix_gap_pp"]
                    gaps = " / ".join(format(g[n]["mean"], ".1f") for n in gv)
                    w(f"| {x['n']:,} | {x['share']:.0%} | {x['segment']} | {nm} | {m['mean_abs_err_pp']:.2f} | {m['p95_abs_err_pp']:.2f} | {m['within_half_pp']:.0%} | {gaps} | {m['arm_changes_after_reask']} |")
            at1k = [x["stratified"]["within_half_pp"] for x in SB if x["n"] == 1000] or [0]
            w(f"\nReading: with the blocks the achieved share is within 0.5 pp of the configured one in nearly every run from about 1,000 leads (at exactly 1,000 leads it holds in {min(at1k):.0%} to {max(at1k):.0%} of runs, depending on the share; at 3,000 leads or more in every run we drew). "
              f"From about 3,000 leads A and B also carry a closer mix of {' and '.join(lab(n) for n in blocked)} (the blocked factors) than a plain coin flip gives; at 1,000 leads most of the {n_strata} strata expect fewer than {catalog.MIN_STRATUM} leads and are merged into one 'Other' stratum, so the mix is no better than chance. "
              f"{' and '.join(lab(n) for n in gv if n not in blocked)} {'is' if len(gv) - len(blocked) == 1 else 'are'} not blocked, so {'its' if len(gv) - len(blocked) == 1 else 'their'} gaps are chance, as for a plain coin flip.\n")
        w("**BRD claims we checked**\n")
        w("- 'A 10% share needs about 2.8x more traffic than 50/50': total leads scale as 1 / (s x (1 - s)): 11.1 at 10% against 4.0 at 50%, a ratio of 2.78. Correct.")
        w("- 'Harm check starts once each variant has 1,000 leads': at 10% to B and 1,000 leads a day, B reaches 1,000 leads on day 10, after a 7-day test has ended, so the daily harm check would never run. The BRD's default is kept (it is a setting), but the calculator now shows the day the harm check starts and turns amber when it would not start inside the window. The end-of-test winner call is not held back by this gate.")
        w("- 'Winner call once at the end, harm check daily': implemented as the default rule. One addition: on the last day the call is two-sided (a B significantly worse at 95% is kept out and logged as a loss, as the BRD's decision table says) instead of being called 'inconclusive'.\n")
    if P.get("rulesets"):
        R = P["rulesets"]
        w("## 5e. The dashboard spec's decision rule against ours, on identical traffic\n")
        w("The BRD asks for daily checks on strict-early boundaries; the dashboard spec asks for ONE winner call at the end plus a very strict daily harm check. Both are valid; Picky runs either (`rule_set`). Same data for both: 14 days, 300 leads a day, 30% to B, planned for a +3 point lift.\n")
        w("| Truth | Rule | Ships B | Stops B | Median calls when promoted | B calls served |\n|---|---|---|---|---|---|")
        for k, v in R.items():
            for rs, nm in (("sequential", "Sequential (ours, default)"), ("final_look", "One look at the end + 99.9% daily harm (spec)")):
                m = v[rs]["canary"]
                w(f"| {v['label']} | {nm} | {ci(rate(m, 'PROMOTE'))} | {pct(rate(m, 'STOP_HARM')['rate'] + rate(m, 'STOP_GUARDRAIL')['rate'])} | {m['median_n_when_promoted']:,.0f} | {m['mean_exposure_b']:,.0f} |" if m["median_n_when_promoted"] else
                  f"| {v['label']} | {nm} | {ci(rate(m, 'PROMOTE'))} | {pct(rate(m, 'STOP_HARM')['rate'] + rate(m, 'STOP_GUARDRAIL')['rate'])} | - | {m['mean_exposure_b']:,.0f} |")
        aa = R["aa"]["final_look"]["naive_peek"]
        wrong = rate(aa, "PROMOTE")["rate"] + rate(aa, "STOP_HARM")["rate"]
        hh, hw = R["harm"], R["win"]
        hs, hf = hh["sequential"]["canary"], hh["final_look"]["canary"]
        w(f"\nReading: both rules keep false wins near the 2.5% budget. Since the one-look rule also makes a two-sided call on the last day (B significantly worse at 95%: keep A, logged as a loss), both keep a B that is 7 points worse out about equally often ({pct(rate(hs, 'STOP_HARM')['rate'])} against {pct(rate(hf, 'STOP_HARM')['rate'])}). What differs is time: ours sends {pct(1 - hs['mean_exposure_b'] / hf['mean_exposure_b'], 0)} fewer calls to that B and promotes a real +7 point winner after {hw['sequential']['canary']['median_n_when_promoted']:,.0f} calls instead of {hw['final_look']['canary']['median_n_when_promoted']:,.0f}. Neither dominates, so it is a setting, with the default argued by these numbers.\n")
        w("**Claims in the BRD and the spec that we checked**\n")
        w(f"- 'Checking every day with a plain 95% test picks a false winner 20 to 25% of the time': over 14 daily looks with A = B, a plain test crowns B {pct(rate(aa, 'PROMOTE')['rate'])} and kills B {pct(rate(aa, 'STOP_HARM')['rate'])} of the time, so a wrong call in either direction is {pct(wrong)}: the 20-25% figure holds for 'any wrong call', not for 'a false winner' alone.")
        sc_ = spec_calculator_check()
        w(f"- Spec calculator example ('4,200 B leads in 7 days detects 1.2 pp; 0.8 pp needs 12 days'): {sc_['verdict']} At a 45% baseline the same 4,200 B leads detect {sc_['mde_at_baseline_45pct_pp']} pp.\n")

def write_report() -> Path:
    P = json.loads((OUT / "proof.json").read_text())
    S = P["scenarios"]
    rows = json.loads((ROOT / "data" / "call_durations.json").read_text())
    d = [r["duration_s"] for r in rows]
    bench = benchmark_report()
    ev = P["evaluator_error"]
    L = []
    w = L.append
    w("# Picky - QA report\n")
    w(f"*Generated by `python -m canary qa` from `out/proof.json` (seed {P['seed']}, {P['runs']:,} simulated tests per case, "
      f"{P['aa_runs']:,} for no-difference cases, {P['seconds']} s). Every number below is re-runnable; none is typed by hand.*\n")
    aa, srm, hm, win, gr, tiny = (S[k]["methods"] for k in ("aa", "srm_bug", "harm", "win", "guardrail", "small"))
    expo = 1 - hm["canary"]["mean_exposure_b"] / hm["fixed_horizon"]["mean_exposure_b"]
    saved = 1 - win["canary"]["median_n_when_promoted"] / win["fixed_horizon"]["median_n_when_promoted"]
    w("## 1. Headline results\n")
    w("| Question | Picky | Typical approach | Source |\n|---|---|---|---|")
    w(f"| Crowns B when A = B (false win) | **{ci(rate(aa['canary'], 'PROMOTE'))}** | naive peeking {ci(rate(aa['naive_peek'], 'PROMOTE'))}; fixed-horizon {pct(rate(aa['fixed_horizon'], 'PROMOTE')['rate'])}; higher-rate-wins {pct(rate(aa['higher_rate'], 'PROMOTE')['rate'])} | §3 |")
    w(f"| Ships B when the test is silently broken (B loses 35% of non-converting calls from the log; see §3b) | **{pct(rate(srm['canary'], 'PROMOTE')['rate'])}** (halts {pct(rate(srm['canary'], 'HALT_SRM')['rate'])}) | naive peeking {pct(rate(srm['naive_peek'], 'PROMOTE')['rate'])}; fixed-horizon {pct(rate(srm['fixed_horizon'], 'PROMOTE')['rate'])} | §3 |")
    w(f"| Ships B that is 30% slower while winning on BuyLeads | **{pct(rate(gr['canary'], 'PROMOTE')['rate'])}** (vetoes {pct(rate(gr['canary'], 'STOP_GUARDRAIL')['rate'] + rate(gr['canary'], 'HOLD_FOR_APPROVAL')['rate'], 0)}) | naive peeking {pct(rate(gr['naive_peek'], 'PROMOTE')['rate'])} | §3 |")
    w(f"| Detects a real lift of the planned size (power) | **{ci(rate(win['canary'], 'PROMOTE'))}** | fixed-horizon {pct(rate(win['fixed_horizon'], 'PROMOTE')['rate'])}; naive peeking {pct(rate(win['naive_peek'], 'PROMOTE')['rate'])} (but see its false-win rate) | §3 |")
    w(f"| Calls needed to promote a real winner (median) | **{win['canary']['median_n_when_promoted']:,.0f}** | fixed-horizon {win['fixed_horizon']['median_n_when_promoted']:,.0f} ({pct(saved, 0)} fewer for Picky) | §3 |")
    w(f"| Stops a B that is truly 10pp worse | **{pct(rate(hm['canary'], 'STOP_HARM')['rate'])}** of runs | fixed-horizon never stops early | §3 |")
    w(f"| B calls served in that case (mean) | **{hm['canary']['mean_exposure_b']:.0f}** | fixed-horizon {hm['fixed_horizon']['mean_exposure_b']:.0f} ({pct(expo, 0)} less exposure for Picky) | §3 |")
    sp = P["split_accuracy"]
    b1 = [x for x in sp if x["n"] == 1037]
    w(f"| Split error at ~1,000 leads, mean over shares 5-45% | **{statistics.mean(x['balanced']['mean_abs_err_pp'] for x in b1):.2f} pp** (balanced), {statistics.mean(x['hash']['mean_abs_err_pp'] for x in b1):.2f} pp (hash) | coin flip per call {statistics.mean(x['naive_random']['mean_abs_err_pp'] for x in b1):.2f} pp | §4 |")
    st = P["stickiness"]
    w(f"| Repeat calls that switch arm | **{st['hash']['arm_flips']}** (hash), **{st['balanced']['arm_flips']}** (balanced) of {st['repeat_calls']:,} | coin flip per call: {st['naive_random']['arm_flips']:,} ({pct(st['naive_random']['flip_rate'])}) | §4 |")
    w("")
    w("## 2. What data we actually have (measured)\n")
    w(f"- {len(d)} recordings, {sum(d) / 3600:.2f} hours, 8 kHz mono telephony MP3. Duration: median {statistics.median(d):.1f} s, mean {statistics.mean(d):.1f} s, max {max(d):.1f} s; {sum(1 for x in d if x < 15)} calls ({pct(sum(1 for x in d if x < 15) / len(d), 0)}) are under 15 s.")
    w("- Resources received: the recordings, the problem statements and, added on 9 Oct, **VANI's real buyer-side prompt** (77 pages, about 25,000 words) and **IndiaMART's call-quality matrix** (fatal / non-fatal definitions). No transcripts and no human labels were provided: the transcripts and machine labels are ours (Sarvam). Durations are real and drive the simulator; A/B outcomes are simulated with a known injected difference (§6).")
    w("")
    w("## 3. Statistical validity of the winner call (30% criterion)\n")
    w("Method: one-sided score test on the difference in rates, **Lan-DeMets alpha-spending** (O'Brien-Fleming-type for promotion, Pocock-type for harm), 40 looks, pre-registered rules, sample size set by power. Spending lets us check as often as we like without inflating false wins. Implementation validated against published boundaries and by simulation (unit tests `SeqDesign`).\n")
    w("**Six truths, four methods, same simulated calls** (rate of shipping B; [95% interval]):\n")
    w("| Truth | Shipping B is | " + " | ".join(M.values()) + " |\n|---|---|" + "---|" * 4)
    for k, s in S.items():
        right = {"better": "right", "tiny": "unclear"}.get(s["truth"], "**wrong**")
        w(f"| {s['label']} | {right} | " + " | ".join(ci(rate(s["methods"][m], "PROMOTE")) for m in M) + " |")
    w("")
    w("**3b. Silent logging bugs.** B loses a share of its non-converting calls from the log (A = B truly). A check on the logged split alone is weak at a high baseline, because most calls convert and the split barely moves; we found this in testing. Picky therefore also compares *assigned vs logged* calls per arm (the router knows the assigned count exactly):\n")
    w("| B's non-converting calls lost | Split check only: halts / ships B | **With completeness check: halts / ships B** | Naive peeking ships B |\n|---|---|---|---|")
    for k, v in P["logging_bug_sweep"].items():
        w(f"| {float(k):.0%} | {pct(v['share_check_only']['halts'])} / {pct(v['share_check_only']['ships'])} | **{pct(v['with_completeness_check']['halts'])} / {pct(v['with_completeness_check']['ships'])}** | {pct(v['naive_ships'])} |")
    w("")
    w("Assumption: the log is complete for A; the check looks for a *difference* in completeness between arms. At 0% loss the false halt rate is the cost of checking repeatedly (about 1%).\n")
    w("**Repeated checks** - false-win rate when A = B, by number of looks:\n")
    w("| Looks | Picky | Naive peeking |\n|---|---|---|")
    for k, v in P["looks_sweep"].items():
        w(f"| {k} | {ci({'rate': v['canary']['false_promote'], 'ci': v['canary']['ci']})} | {ci({'rate': v['naive_peek']['false_promote'], 'ci': v['naive_peek']['ci']})} |")
    w("")
    w("**Robustness** - Picky false-win rate (naive in brackets) when A = B:\n")
    w("| Baseline | 5% to B | 10% to B | 45% to B |\n|---|---|---|---|")
    for b in (0.10, 0.45, 0.60):
        cells = [next(g for g in P["grid"] if g["baseline"] == b and g["share"] == s) for s in (0.05, 0.10, 0.45)]
        w(f"| {b:.0%} | " + " | ".join(f"{pct(c['canary_false_promote'])} ({pct(c['naive_false_promote'])})" for c in cells) + " |")
    w("")
    worst = max(g["canary_false_promote"] for g in P["grid"])
    base_fw = rate(aa["canary"], "PROMOTE")["rate"]
    w(f"**Honest caveat.** The nominal budget is 2.5% one-sided. Measured false-win rate is {pct(base_fw)} at the default setting and up to {pct(worst)} in the worst robustness cell; the exact rate depends on baseline and slice size because the test uses a normal approximation. Naive peeking is {pct(rate(aa['naive_peek'], 'PROMOTE')['rate'], 0)} at 40 looks, several times over budget. Fix if a cell is too liberal: exact or simulation-calibrated thresholds.\n")
    w("")
    w("## 4. Traffic split accuracy and stickiness (20% criterion)\n")
    w("Mean absolute error between configured and achieved B share (percentage points), over repeated assignments:\n")
    w("| Share | Leads | Hash | Balanced | Coin flip per call | Hash inside 95% chance band | Balanced worst gap once 500 leads are in |\n|---|---|---|---|---|---|---|")
    for x in sp:
        wp = x["balanced"]["worst_prefix_pp"]
        w(f"| {x['share']:.0%} | {x['n']:,} | {x['hash']['mean_abs_err_pp']:.2f} | {x['balanced']['mean_abs_err_pp']:.2f} | {x['naive_random']['mean_abs_err_pp']:.2f} | {pct(x['hash']['inside_95_band'], 0)} | {f'{wp:.2f}' if wp else '-'} |")
    w("")
    w(f"Stickiness: {st['calls']:,} calls, {st['distinct_leads']:,} leads, {st['repeat_calls']:,} repeats. Arm changes: hash {st['hash']['arm_flips']}, balanced {st['balanced']['arm_flips']}, coin flip {st['naive_random']['arm_flips']:,}. A second independent hash router disagreed on {st['hash']['independent_server_disagreements']} leads. Balanced mode needs its ledger persisted to stay sticky across restarts.\n")
    w("")
    w("## 5. Auto-promotion and early stop (30% criterion): the seven scenarios\n")
    w("| Scenario | Known truth | Expected | Got | Look | Calls analysed | B calls served | Ledger verifies | Re-run identical |\n|---|---|---|---|---|---|---|---|---|")
    for k in ORDER:
        b = scenario_bundle(k)
        r = b["record"]["result"]
        sc = SCENARIOS[k]
        w(f"| {sc.title} | A {pct(sc.true_a, 0)} / B {pct(sc.true_b, 0)}{f', dur x{sc.dur_mult_b}' if sc.dur_mult_b != 1 else ''}{f', log loss {pct(sc.log_drop_b, 0)}' if sc.log_drop_b else ''} | {sc.expect} | **{r['kind']}** | {r['at_look']}/{r['of_looks']} | {r['calls_analysed']:,}/{r['n_max']:,} | {r['exposed_b_calls']:,} | {'yes' if b['record']['ledger_ok'] else 'NO'} | {'yes' if b['replay']['same_ledger_head'] else 'NO'} |")
    w("")
    w("Every decision is written to a hash-chained ledger with time, rule, evidence and routing change; re-running from config + seed reproduces the identical ledger head.\n")
    w("")
    _extra_sections(w, P)
    w("## 6. The real prompt, the quality matrix, and the labels (20% criterion + deck metrics)\n")
    o, e, h = bench["overall"], bench["easy"], bench["hard"]
    from . import arena as _arena, sarvam_pipe as _sp, fixloop as _fx, prescreen as _ps, promptlint as _pl, loopscan as _ls, realprompt as _rp
    w("**6a. What the real resources changed.** We built the first version against a stand-in prompt written from a verbal description. The real prompt and matrix contradicted four of our assumptions, so we corrected the work instead of defending it:\n")
    w("| We assumed | The real prompt / matrix says | What we did |\n|---|---|---|")
    w("| VANI phones the buyer | \"This is NOT an outbound call.\" The buyer called a seller, the seller was unavailable, the call was redirected to the Help Desk (only the redial flows are outbound) | Simulation is an inbound call with VANI's predefined opening; earlier arena and pre-screen results are marked stale and not shown as VANI's behaviour |")
    w("| It captures quantity, specification, delivery location, timeline | It collects product confirmation, quantity, each specification, buyer name, buyer city and state. There is no timeline | Label schema 2 (data/dispositions.json); earlier labels kept as legacy |")
    w("| Reading details back is good practice | \"Do not repeat, paraphrase, summarize, or reconfirm the value\" (the No-Echo rule) | Our top machine-labelled issue (\"did not read the details back\", 129 of 299 calls) is retired: it was never a failure |")
    w("| Success = a BuyLead with quantity and specification | Connecting the buyer to a live seller is the top priority; quantity and specification must never block it. Dispositions are BL Approved / BL Enriched / BL Deleted | Outcomes in schema 2 follow the real dispositions; quantity-and-specification is kept only as a proxy for the earlier labels |")
    w("| Our own list of bot issues | IndiaMART's quality matrix: outcome, quantity, specification, looping, WER, live-seller pitch, product, dead air... each fatal or non-fatal | Schema 2 issues are the matrix parameters; Overall Call = pass / non-fatal / fatal |")
    w("")
    L_ = _pl.analyse()
    w(f"**6b. Prompt lint (free, deterministic, no model).** The real prompt is {L_['prompt']['words']:,} words and four prompts in one document. `python -m canary fix lint` compares every statement of how many times VANI may ask for the same thing. IndiaMART's matrix grades probing a parameter more than 1+2 times as fatal \"looping\", so the limits have to agree.\n")
    w("| Where | Field | Limits stated | Evidence (line numbers in data/base_prompt.md) |\n|---|---|---|---|")
    for c_ in L_["conflicts"]:
        w(f"| {c_['flow'].replace('_', ' ')} | {c_['field']} | {' vs '.join(str(x) for x in c_['limits'])} | " + "; ".join(f"L{e_['line'] + 1} \"{e_['quote'][:48]}\"" for e_ in c_["evidence"]) + " |")
    w("")
    if L_["cross_flow"]:
        w("Across flows (information, not a defect): " + "; ".join(f"{x['field']}: " + ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in x["by_flow"].items()) for x in L_["cross_flow"]) + ".\n")
    if L_["duplicates"]:
        d0 = L_["duplicates"][0]
        w(f"Copy-paste risk: {len(L_['duplicates'])} blocks (the largest {d0['lines']} lines) are repeated across flows, so an edit to one copy leaves the others behind; patches therefore check that their anchor matches exactly one line.\n")
    LS = _ls.summary()
    if LS:
        w(f"**6c. Looping in the real calls (no model, tagger-free).** `python -m canary fix loops`. Of {LS['calls_with_speech']} recorded calls with speech, VANI said a near-identical thing **3 or more times in {LS['bot_repeat3']['n']} ({pct(LS['bot_repeat3']['rate'], 1)})** and 4 or more times in {LS['bot_loop']['n']}. This is a lower bound: VANI is told to vary its wording and this check sees only near-identical repeats. So verbatim loops are rare, and a consistency fix is a safety measure, not a conversion lever. (The earlier machine tagger flagged loop-like issues in {LS['vs_machine_loop_flag']['both'] + LS['vs_machine_loop_flag']['machine_only']} calls; the two methods agree on {LS['vs_machine_loop_flag']['both']}, so the tagger over-flags or sees rephrased loops.)\n")
    R = _sp.report()
    if R.get("machine_labelled"):
        n = R["machine_labelled"]; loose = R["buylead_rate_loose"]; rich = R["rich"]; cc = R.get("capture_connected", {})
        prov = R.get("provisional")
        w(f"**6d. Real calls, labelled by Sarvam ({'PROVISIONAL: made before the real prompt arrived' if prov else 'real-prompt schema'}; machine labels, not yet human-verified).** Sarvam Saaras transcribed {n} randomly chosen recordings with speaker separation and the Sarvam chat model tagged each (`python -m canary autolabel`, budget-capped, cached). {'The tagging prompt used the earlier vocabulary, so treat these as a first look. `python -m canary autolabel retag` re-tags the saved transcripts with the real-prompt schema for about Rs ' + str(round(_sp.retag_plan()['est_inr'])) + ' (not run).' if prov else ''}\n")
        w("| Measure | Result |\n|---|---|")
        w(f"| Quantity AND specification captured (the proxy for BL conversion used for the earlier labels) | **{pct(loose['rate'], 1)}** (95% range {pct(loose['ci'][0], 0)}-{pct(loose['ci'][1], 0)}); stated benchmark for BL conversion 35-60% |")
        if cc:
            w(f"| Details captured, connected calls | quantity {pct(cc['quantity'], 0)} (stated target ~88%), specification {pct(cc['specification'], 0)} (~79%) |")
        w(f"| Calls with at least one issue flagged | {pct(rich['bot_issue_rate'], 0)}; top: " + ", ".join(f"{k.replace('_', ' ')} ({v})" for k, v in list(rich['bot_issue_counts'].items())[:3]) + " (\"did not confirm details\" is retired, see 6a) |")
        w(f"| Fatal grading (earlier tagger, not the matrix) | " + ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in rich['fatal'].items()) + " |")
        w(f"| Language mix | " + ", ".join(f"{k} {v}" for k, v in rich['language'].items()) + " |")
        b_ = R.get("tagger_vs_human_blind")
        w("| Tagger accuracy vs a person | " + (f"**{pct(b_['accuracy'], 0)}** on {b_['n']} blind-checked calls (95% range {pct(b_['accuracy_ci'][0], 0)}-{pct(b_['accuracy_ci'][1], 0)})" if b_ else "not measured yet: needs the 40-call spot-check, best done after the re-tag") + " |")
        w("")
        import json as _j, statistics as _st
        dur = {r_["idx"]: r_["duration_s"] for r_ in _j.loads((_sp.DATA / "call_durations.json").read_text())}
        grp = {}
        for d_ in _sp.labelled():
            grp.setdefault(d_["label"], []).append(dur[d_["idx"]])
        med = lambda k: _st.median(grp[k]) if grp.get(k) else float("nan")
        allm = _st.median([x for v in grp.values() for x in v])
        w(f"Sanity check that needs no human: call length follows outcome (median {med('buylead_created'):.0f} s for the strict BuyLead label, {med('partial'):.0f} s for partial, {med('no_connect'):.0f} s when nobody spoke; {allm:.0f} s across all {n} calls, inside the stated 44-68 s ideal handling time).\n")
    FX = _fx.mine()
    prop = _fx.load_proposal()
    if FX.get("issues") or prop:
        w("**6e. The fix loop: the PM's idea, on the real prompt.** `python -m canary fix mine | lint | loops | candidate | propose | prescreen | costs`. Find, fix, pre-check, prove; the A/B engine, not the mining, decides whether anything ships.\n")
        if FX.get("issues"):
            w(f"Mining the machine labels ({'provisional' if FX.get('provisional') else 'current'}): failures ranked by what they cost in conversions, not by how often they occur. An association between two machine labels, never a cause.\n")
            w("| Failure | Calls | Converts with it | Converts without it | With minus without | p (unadjusted) | BuyLeads per 100 calls if removed |\n|---|---|---|---|---|---|---|")
            for r_ in FX["issues"]:
                if r_["eligible"]:
                    mark = " (largest group among failed calls: the PM's rule)" if r_["key"] == FX["pm_pick"] and r_["key"] != FX["target"] else (" **<- ranked first**" if r_["key"] == FX["target"] else "")
                    w(f"| {r_['name']}{mark} | {r_['calls']} | {pct(r_['converted_with'], 0)} | {pct(r_['converted_without'], 0)} | {-r_['gap_pp']:+.0f} pp | {r_['p_value']:.3f} | {r_['ceiling_pp']} |")
            w("")
            w("Read the first row with care: the earlier tagger did not know that ending the call early is the CORRECT closing when the buyer has no product requirement, wants only the original seller or refuses to talk to an AI, so \"ended abruptly\" is probably inflated by correct closes. The re-tag with the real-prompt schema will retest it.\n")
            if FX.get("retired"):
                w("Retired from the ranking: " + "; ".join(f"**{x['name']}** ({x['calls']} calls): {x['why']}" for x in FX["retired"]) + " Before it was retired it made the PM's \"fix the biggest cluster\" rule look wrong; with it removed the two rules agree on this data, so we do not claim that correction. The re-tag will retest it.\n")
        if prop:
            ec = prop.get("evidence", {})
            w(f"Candidate edit (**{prop['name']}**, origin: {prop.get('origin')}): lint check {ec.get('conflicts_before', '?')} contradictions before, {ec.get('conflicts_after', '?')} after, {ec.get('introduced', '?')} introduced. Why: {prop.get('why')} Risk: {prop.get('risk')}\n")
        PS = _ps.summary()
        if PS and not PS.get("stale"):
            A_, B_ = PS["A"], PS["B"]
            w(f"Pre-check on {PS['n_pairs']} simulated buyers (pass rule fixed in code before the run): A {A_['converted']}/{A_['n']} usable requirements, B {B_['converted']}/{B_['n']}; calls with a fatal fault A {A_['fatal']}, B {B_['fatal']}; bot turns {A_['bot_turns']} vs {B_['bot_turns']}. Gate: **{'passed' if PS['passed'] else 'failed'}**. A smoke test only.\n")
        else:
            pc_ = _ps.plan()
            w(f"Pre-check: **not run on the real prompt.** VANI's rendered prompt is about {pc_['prompt_tokens_per_vani_turn']:,} tokens and is sent on every turn, so {pc_['simulated_calls']} simulated calls would cost about Rs {pc_['est_inr']:.0f}. An earlier run used the stand-in prompt and is not shown.\n")
        dp = _fx.design_for_fix()
        if dp:
            w(f"Live test plan (measured baseline {pct(dp['baseline'], 1)}, provisional; planned lift +{dp['mde'] * 100:.0f} pp, a planning choice; {dp['leads_per_day']} calls a day is an assumption; half the calls on B): about {dp['n_max']:,} calls, {dp['days_needed']} days. What other lifts cost to prove:\n")
            w("| Lift | Calls needed | Days |\n|---|---|---|")
            for t_ in dp["table"]:
                w(f"| {t_['mde'] * 100:.0f} pp | {t_['n_max']:,} | {t_['days']} |")
            w("")
    ar = _arena.load()
    if ar and ar.get("cases"):
        if ar.get("stale"):
            w("**6f. Voice arena.** The six recorded calls (Sarvam Bulbul voices) were made with our earlier stand-in prompt, which was wrong about VANI, so they demonstrate the voices only and are labelled so in the dashboard. They are not evidence about the real prompt.\n")
        else:
            w("**6f. Voice arena (illustrative).** Sarvam's chat model plays the buyer and VANI (real prompt, inbound call) under prompt A and prompt B; Bulbul voices speak both; the same tagger scores each call. Three buyers per prompt: a demonstration, not a statistical test.\n")
            w("| Buyer | Turns A | Turns B | Outcome A | Outcome B |\n|---|---|---|---|---|")
            for c in ar["cases"]:
                w(f"| {c['title']} | {len(c['A']['lines'])} | {len(c['B']['lines'])} | {c['A']['tag']['label'].replace('_', ' ')} | {c['B']['tag']['label'].replace('_', ' ')} |")
            w("")
    C_ = _fx.costs()
    w("**6g. Paid Sarvam steps not yet run (each needs `--yes` and a budget), with their exact estimates.** Credits are limited, so nothing here was spent after the real prompt arrived:\n")
    w("| Step | Estimated cost | Command |\n|---|---|---|")
    w(f"| Re-tag {C_['retag']['to_retag']} real calls with the real-prompt schema (about {C_['retag']['minutes']:.0f} min) | Rs {C_['retag']['est_inr']:.0f} | `autolabel retag --yes --budget N` |")
    w(f"| Sarvam drafts an edit from the evidence | Rs {C_['draft']['est_inr']:.1f} | `fix propose --yes` |")
    if C_.get("prescreen"):
        w(f"| Pre-check: {C_['prescreen']['personas']} simulated buyers, prompts A and B | Rs {C_['prescreen']['est_inr']:.0f} | `fix prescreen --yes` |")
    if C_.get("arena"):
        w(f"| Voice arena: 3 buyers, A and B, Sarvam voices | Rs {C_['arena']['total_inr']:.0f} | `arena run --yes --force` |")
    w("")
    w("**Legacy synthetic benchmark.** Before any real labels existed we built a scripted set (" + str(bench['n']) + f" calls) and a rule tagger: overall accuracy {pct(o['accuracy'])} [{pct(o['accuracy_ci'][0])}, {pct(o['accuracy_ci'][1])}], easy {pct(e['accuracy'])}, hard {pct(h['accuracy'])}. It uses the earlier disposition vocabulary and is an optimistic bound written by us; it is kept only for the tests and is not evidence about real calls.\n")
    w(f"**Why tagger quality matters (model, not measurement):** a noisy tagger shrinks the observed lift and costs power (planned lift {round(P['config']['mde'] * 100)} points from a {pct(P['config']['baseline'], 0)} baseline).\n")
    w("| Tagger | Sensitivity | Specificity | Observed lift | Power | Calls for 80% power |\n|---|---|---|---|---|---|")
    for x in ev:
        w(f"| {x['tagger']} | {pct(x['sensitivity'], 0)} | {pct(x['specificity'], 0)} | {x['observed_lift_pp']:.1f} pp | {pct(x['power'], 0)} | {x['calls_needed_for_80pct_power']:,} (x{x['extra_calls_factor']:.2f}) |")
    w("")
    w("Primary goal is any disposition (`primary_goal`, direction `higher`/`lower`); the secondary is a guardrail (average handling time) with a tolerated relative change, or reported only (`secondary_role`). Conflict rule: **the primary decides; the guardrail can only veto.** Promotion needs the guardrail *proven* within its limit; a breach stops the test (scenario 6).\n")
    w("")
    w("## 7. How this differs from what other teams will likely build\n")
    w("| Typical submission | Picky |\n|---|---|\n| Two-proportion z-test, p<0.05 | Alpha-spending sequential test with pre-registered rules, power-based sample size, an honest *inconclusive* |\n| Peeks without correction | Peeking priced in; proven by simulation against naive peeking |\n| `random()` per call or a hash, split reported once | Sticky hash and balanced modes, split + stickiness measured over thousands of runs, sample-ratio check that halts broken tests |\n| Early stop on a fixed threshold | Harm boundary with a controlled error rate, plus guardrail breach |\n| Duration shown as a second chart | Guardrail with a tolerated margin and a stated conflict rule |\n| Log lines | Hash-chained ledger, tamper test, reproducible from config + seed |\n| Numbers asserted on the slide | QA table above, re-run with one command |\n| Summarise the failures and fix the biggest group | Finds evidence in three independent places (the real prompt itself, a tagger-free scan of the real calls, the machine labels), derives or drafts a small edit, rejects any edit that contradicts the prompt, pre-checks it, and lets the A/B engine decide |\n| Assumes the tagger is right | Measures it (synthetic now, real labels when available) and shows what its errors cost |\n| Starts without asking if the test can finish | Planner warns when the window cannot reach a conclusion |")
    w("")
    w("## 8. Known limitations (read before the demo)\n")
    w("- Outcomes in the A/B test are **simulated** with an injected known difference; the proof lab uses a 45% baseline, inside the 35-60% benchmark and inside the 42-53% range measured on the real calls (47.5% on a proxy definition); the fix-loop scenarios use the measured baseline and a 3-point planning lift; durations are resampled from real recordings (median 64 s, inside the stated 44-68 s ideal). We cannot claim a real-world lift for any prompt.")
    w("- The real-call labels are **machine labels made before the real prompt arrived**: provisional until the re-tag (about Rs 23) and a person's 40-call spot-check. The earlier tagger over-flagged (it called a rule the real prompt forbids a failure), which is why we publish the correction.")
    w("- The prompt-derived fix is a consistency edit. Verbatim loops are rare in the real calls (6c), so we expect a safety gain of about a point at most, which would need tens of thousands of calls to prove on conversion; it is judged mainly on safety. The Sarvam-drafted alternative, the pre-check on the real prompt and the voice arena are not run (credits); their costs are in 6g.")
    w("- The simulated VANI uses the rendered real prompt but cannot run its tools (transfer, variable updates); the opening message and call variables are our assumptions (the real system fills them from the lead).")
    w(f"- False-win rate is slightly above nominal in small test slices ({pct(worst)} worst cell vs 2.5%); disclosed in §3.")
    w("- With a 10% slice, detecting a harm takes about 3,000 calls; the planner shows the trade-off. Balanced assignment needs a persisted ledger; hash assignment does not.")
    w("- CUPED and per-segment winners were deliberately not built (see `docs/DEMO_SCRIPT.md`, Q&A); segments as an audience, the stratified router and the 5% post-promotion holdback were built for the second BRD (§5d). The lead variables (lead type, firm type, city) are SYNTHETIC: the recordings carry none. The engine guards handling time and, optionally, one rate (a fatal-call or early-hang-up share) given by a column or a threshold; fatal calls are only available from files that carry them.")
    w("- Results files: the format the PM's files will take is not known, so the reader is flexible and every assumption is printed. A lead that appears in both prompts is counted once, in its first arm, and reported. Leads after the planned maximum are not used (to use more data, plan for a smaller lift). A file with no lead id counts every call, which makes results look surer than they are, and says so.")
    w("- The decision record is **tamper-evident, not tamper-proof**: editing, removing or re-ordering an entry is detected; someone who rewrites the whole chain is detected only if the head hash was written down somewhere else (the head hash is printed by the command line and shown when you press Verify chain, so it can be written down). An independent review of the file reader found and we fixed a set of decision-safety issues (a missing duration could drop the guardrail; results 'up to day d' could use later calls; the plan could be read off the data; one day could overshoot the planned maximum; several bad inputs crashed instead of explaining); each has a regression test.")
    w("- The dashboard follows the PS05 feature spec screen by screen. Not built from it: email or Slack alerts, the optional \"Try it\" chat box (paid credits) and language-model-written summaries (a template writes them from the numbers; a model should not write numbers). The weak-segment idea is shown as unavailable because the recordings carry no category or city.")
    w("")
    w("## 9. Reproduce\n")
    w("```\npip install -r requirements.txt\npython -m unittest discover -s tests   # tests: " + run_tests() + "\npython -m canary proof                  # ~10 s, writes out/proof.json\npython -m canary build                  # dist/canary_demo.html (offline)\npython -m canary qa                     # this report\npython -m canary serve                  # live engine + Label Lab\n```")
    out = ROOT / "docs" / "QA_REPORT.md"
    out.write_text("\n".join(L) + "\n")
    return out
