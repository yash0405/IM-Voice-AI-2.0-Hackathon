"""python -m canary <command>

  demo      run the six scenarios in the terminal
  proof     run the Monte Carlo proof lab (writes out/proof.json)
  build     bundle everything into dist/canary_demo.html (works offline, no server)
  serve     live dashboard + Label Lab on http://127.0.0.1:8765
  qa        write QA_REPORT.md from out/proof.json
  slide     write dist/one_slide.html (the one-slide deliverable)
  eval      score a tagger on labelled calls (synthetic benchmark, or real labels + transcripts dir)
  arena     voice arena: Sarvam LLM + Bulbul voices play a buyer against prompt A and B (plan | run --yes --budget N)
  autolabel Sarvam speech-to-text + chat model auto-labelling, budget-capped (plan | run | retag | status | queue | report | issues)
  decide    decide from results files (the test ran elsewhere): python -m canary decide results.csv --goal buylead_created --share-b 0.3
  samples   write synthetic sample results files to data/samples/
  fix       the fix loop: mine real failures, Sarvam drafts a prompt edit, simulated buyers pre-screen it (mine | lint | loops | candidate | propose | prescreen | costs | agent | status)
"""
import argparse
import json
import sys


def main():
    ap = argparse.ArgumentParser(prog="canary", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["demo", "proof", "build", "serve", "qa", "eval", "slide", "all", "autolabel", "arena", "fix", "decide", "samples"])
    ap.add_argument("action", nargs="?", default="plan", help="for autolabel: plan | run | status | queue | report | issues")
    ap.add_argument("--n", type=int, default=5, help="autolabel: how many calls (first N of a fixed random order)")
    ap.add_argument("--budget", type=float, default=10.0, help="autolabel: hard cap in rupees for everything spent so far")
    ap.add_argument("--diarize", action="store_true", help="autolabel: speaker diarization (Rs 45/h instead of Rs 30/h)")
    ap.add_argument("--yes", action="store_true", help="autolabel run: actually spend credits")
    ap.add_argument("--personas", type=int, default=12, help="fix prescreen: how many simulated buyers (each heard under prompt A and B)")
    ap.add_argument("--force", action="store_true", help="fix propose / arena run: regenerate even if cached")
    ap.add_argument("--runs", type=int, default=4000)
    ap.add_argument("--aa-runs", type=int, default=12000)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 so other laptops on the office network can label")
    ap.add_argument("--transcripts", help="folder of <idx>.txt transcripts for real-label evaluation")
    ap.add_argument("files", nargs="*", help="decide: more results files")
    d = ap.add_argument_group("decide: read results files and give the decision (no Sarvam credits, no network)")
    d.add_argument("--a", help="file with A's results (use with --b); otherwise one file with a variant column")
    d.add_argument("--b", help="file with B's results")
    d.add_argument("--goal", help="dispositions that count as the goal, comma separated (or the file has a 0/1 goal column)")
    d.add_argument("--goal-name", help="label for the goal")
    d.add_argument("--share-b", type=float, help="configured share of traffic for B, e.g. 0.3 (switches the split check on)")
    d.add_argument("--baseline", type=float, help="REQUIRED: expected goal rate under A, fixed before the test (if unknown, read A's rate from check_results.py and say the verdict is exploratory)")
    d.add_argument("--mde", type=float, help="smallest lift worth detecting, e.g. 0.05")
    d.add_argument("--window-days", type=int)
    d.add_argument("--leads-per-day", type=int)
    d.add_argument("--through-day", type=int, help="use only results up to this day (a test still running)")
    d.add_argument("--rule", choices=["sequential", "final_look"], default="sequential", help="sequential = early promote/stop (default); final_look = one winner call at the end plus a strict daily harm check")
    d.add_argument("--approval", choices=["auto", "manual"], default="auto")
    d.add_argument("--margin", type=float, help="duration guardrail: tolerated relative worsening (default 0.15)")
    d.add_argument("--guard-name", help="optional second guardrail on a rate, e.g. early_hangup")
    d.add_argument("--guard-column", help="column that is 1 when the guardrail event happened")
    d.add_argument("--guard-below-s", type=float, help="or derive it: call shorter than this many seconds")
    d.add_argument("--guard-margin", type=float, help="tolerated absolute worsening of that rate (default 0.02)")
    d.add_argument("--denominator", choices=["all", "connected"], default="all")
    d.add_argument("--complete", action="store_true", help="the test window is over: treat the last day in the file as the final look")
    d.add_argument("--json", help="also write the full record (what the dashboard shows) to this file")
    a = ap.parse_args()
    if a.cmd == "samples":
        from .samples import write_all
        for p in write_all():
            print("wrote", p)
        return
    if a.cmd == "decide":
        from . import decide as dc
        paths = [x for x in [a.action if a.action != "plan" else None] + list(a.files) if x]
        items = []
        if a.a and a.b:
            items = [{"name": a.a, "text": open(a.a, encoding="utf-8-sig").read(), "arm": "A"}, {"name": a.b, "text": open(a.b, encoding="utf-8-sig").read(), "arm": "B"}]
        else:
            items = [{"name": p, "text": open(p, encoding="utf-8-sig").read(), "arm": None} for p in paths]
        if not items:
            sys.exit("give a results file (or --a and --b). Example: python -m canary decide data/samples/results_b_wins.csv --goal buylead_created --share-b 0.3 --baseline 0.45 --mde 0.07 --window-days 14")
        opts = {"goal": a.goal, "goal_name": a.goal_name, "share_b": a.share_b, "baseline": a.baseline, "window_days": a.window_days,
                "leads_per_day": a.leads_per_day, "through_day": a.through_day, "rule_set": a.rule, "approval": a.approval,
                "guardrail_margin": a.margin, "guard_name": a.guard_name, "guard_column": a.guard_column, "guard_below_s": a.guard_below_s,
                "guard_margin": a.guard_margin, "denominator": a.denominator, "complete": True if a.complete else None}
        if a.mde is not None:
            opts["mde"] = a.mde
        try:
            rec = dc.decide(items, opts)
        except dc.DataError as e:
            sys.exit(f"cannot decide: {e}")
        print(dc.summary_text(rec))
        if a.json:
            open(a.json, "w").write(json.dumps(rec))
            print("\nwrote", a.json)
        return
    if a.cmd == "demo":
        from .build import scenario_bundle
        from .scenarios import order
        for k in order():
            b = scenario_bundle(k)
            r = b["record"]["result"]
            print(f"{k:15s} expect {b['meta']['expect']:15s} got {r['kind']:15s} at {r['calls_analysed']}/{r['n_max']} calls "
                  f"| ledger ok={b['record']['ledger_ok']} replay={b['replay']['same_ledger_head']}")
    elif a.cmd == "proof":
        from . import proof
        proof.main(a.runs, a.aa_runs)
    elif a.cmd == "build":
        from .build import build_html
        print("wrote", build_html())
    elif a.cmd == "serve":
        from .server import serve
        serve(a.port, a.host)
    elif a.cmd == "qa":
        from .report import write_report
        print("wrote", write_report())
    elif a.cmd == "autolabel":
        from . import sarvam_pipe as sp
        if a.action == "plan" or (a.action == "run" and not a.yes):
            print(json.dumps(sp.plan(a.n, a.diarize), indent=1))
            if a.action == "run":
                print("DRY RUN: nothing spent. Add --yes to spend credits.")
        elif a.action == "run":
            pipe = sp.Pipe(diarize=a.diarize)
            print(json.dumps(pipe.transcribe(a.n, a.budget)))
            print(json.dumps(pipe.tag(a.n, a.budget)))
            print(json.dumps(sp.status(), indent=1))
        elif a.action == "retag":
            print(json.dumps(sp.retag_plan(), indent=1))
            if not a.yes:
                print("DRY RUN: nothing spent. Add --yes --budget N to re-tag the cached transcripts with the real-prompt schema.")
            else:
                print(json.dumps(sp.Pipe().tag(10 ** 6, a.budget, redo=True)))
                print(json.dumps(sp.status(), indent=1))
        elif a.action == "status":
            print(json.dumps(sp.status(), indent=1))
        elif a.action == "queue":
            print(json.dumps({k: len(v) for k, v in sp.make_queue().items()}))
        elif a.action == "report":
            print(json.dumps(sp.report(), indent=1))
        elif a.action == "issues":
            print(json.dumps(sp.backlog(), indent=1))
    elif a.cmd == "arena":
        from . import arena as ar
        if a.action in ("plan", "status") or (a.action == "run" and not a.yes):
            print(json.dumps(ar.plan(), indent=1))
            if a.action == "run":
                print("DRY RUN: nothing spent. Add --yes to spend credits.")
        elif a.action == "run":
            print(json.dumps(ar.Arena().run(a.budget, force=a.force)))
    elif a.cmd == "fix":
        from . import fixloop
        if a.action == "mine":
            m = fixloop.mine()
            print(json.dumps({k: m[k] for k in ("n_calls", "n_connected", "baseline", "target", "pm_pick", "most_common")}, indent=1))
            for r in m["issues"]:
                print(f"{r['key']:27s} calls {r['calls']:3d}  converts {r['converted_with']:.0%} with / {r['converted_without']:.0%} without  gap {r['gap_pp']:+.1f}pp  p={r['p_value']:.3f}  ceiling {r['ceiling_pp']}pp")
        elif a.action == "propose":
            print(json.dumps(fixloop.propose(a.budget, yes=a.yes, force=a.force), indent=1, ensure_ascii=False))
        elif a.action in ("prescreen", "prescreen-plan"):
            from . import prescreen
            if a.action == "prescreen-plan" or not a.yes:
                print(json.dumps(prescreen.plan(a.personas), indent=1))
                if a.action == "prescreen":
                    print("DRY RUN: nothing spent. Add --yes to spend credits.")
            else:
                print(json.dumps(prescreen.run(a.budget, n=a.personas)))
        elif a.action == "agent":
            print("wrote", fixloop.write_agent_prompts())
        elif a.action == "candidate":
            c = fixloop.lint_candidate(force=True)
            print(json.dumps({k: c[k] for k in ("name", "origin", "why", "risk", "evidence")}, indent=1))
        elif a.action == "lint":
            from . import promptlint
            r = promptlint.analyse()
            print(json.dumps({"prompt": r["prompt"], "conflicts": r["conflicts"], "cross_flow": r["cross_flow"], "duplicates": r["duplicates"][:3]}, indent=1))
        elif a.action == "loops":
            from . import loopscan
            print(json.dumps(loopscan.summary(), indent=1))
        elif a.action == "costs":
            print(json.dumps(fixloop.costs(), indent=1))
        elif a.action == "status":
            from . import prescreen
            print(json.dumps(prescreen.summary(), indent=1))
    elif a.cmd == "slide":
        from .slide import build_slide
        print("wrote", build_slide())
    elif a.cmd == "eval":
        from .evalreal import run
        print(json.dumps(run(a.transcripts), indent=1))
    elif a.cmd == "all":
        from . import proof
        from .build import build_html
        from .report import write_report
        proof.main(a.runs, a.aa_runs)
        print("wrote", build_html())
        print("wrote", write_report())


if __name__ == "__main__":
    main()
