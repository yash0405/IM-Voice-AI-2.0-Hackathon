"""python -m canary <command>

  demo      run the six scenarios in the terminal
  proof     run the Monte Carlo proof lab (writes out/proof.json)
  build     bundle everything into dist/canary_demo.html (works offline, no server)
  serve     live dashboard + Label Lab on http://127.0.0.1:8765
  qa        write QA_REPORT.md from out/proof.json
  slide     write dist/one_slide.html (the one-slide deliverable)
  eval      score a tagger on labelled calls (synthetic benchmark, or real labels + transcripts dir)
  arena     voice arena: Sarvam LLM + Bulbul voices play a buyer against prompt A and B (plan | run --yes --budget N)
  autolabel Sarvam speech-to-text + chat model auto-labelling, budget-capped (plan | run | status | queue | report)
  fix       the fix loop: mine real failures, Sarvam drafts a prompt edit, simulated buyers pre-screen it (mine | propose | prescreen | agent | status)
"""
import argparse
import json
import sys


def main():
    ap = argparse.ArgumentParser(prog="canary", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["demo", "proof", "build", "serve", "qa", "eval", "slide", "all", "autolabel", "arena", "fix"])
    ap.add_argument("action", nargs="?", default="plan", help="for autolabel: plan | run | status | queue | report | issues")
    ap.add_argument("--n", type=int, default=5, help="autolabel: how many calls (first N of a fixed random order)")
    ap.add_argument("--budget", type=float, default=10.0, help="autolabel: hard cap in rupees for everything spent so far")
    ap.add_argument("--diarize", action="store_true", help="autolabel: speaker diarization (Rs 45/h instead of Rs 30/h)")
    ap.add_argument("--yes", action="store_true", help="autolabel run: actually spend credits")
    ap.add_argument("--force", action="store_true", help="fix propose / arena run: regenerate even if cached")
    ap.add_argument("--runs", type=int, default=4000)
    ap.add_argument("--aa-runs", type=int, default=12000)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 so other laptops on the office network can label")
    ap.add_argument("--transcripts", help="folder of <idx>.txt transcripts for real-label evaluation")
    a = ap.parse_args()
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
                print(json.dumps(prescreen.plan(), indent=1))
                if a.action == "prescreen":
                    print("DRY RUN: nothing spent. Add --yes to spend credits.")
            else:
                print(json.dumps(prescreen.run(a.budget)))
        elif a.action == "agent":
            print("wrote", fixloop.write_agent_prompts())
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
