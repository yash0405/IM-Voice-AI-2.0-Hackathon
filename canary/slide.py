"""One-slide presentation (PS05 deliverable), generated from the same data as the dashboard."""
from __future__ import annotations

import json

from . import fixloop
from .build import DIST, OUT, scenario_bundle
from .scenarios import have_fix


def _spark(rec, w=430, h=290):
    rows = rec["looks"]
    xs = [r["n"] for r in rows]; nmax = rec["design"]["n_max"]
    sx = lambda n: 30 + n / nmax * (w - 40)
    sy = lambda v: 8 + (1 - (max(-5, min(5, v)) + 5) / 10) * (h - 28)
    pts = lambda f: " ".join(f"{sx(r['n']):.1f},{sy(f(r)):.1f}" for r in rows)
    last = rows[-1]
    return (f'<svg viewBox="0 0 {w} {h}" width="100%"><line x1="30" x2="{w - 10}" y1="{sy(0)}" y2="{sy(0)}" stroke="#c3c2b7"/>'
            f'<line x1="30" x2="{w - 10}" y1="{sy(1.96)}" y2="{sy(1.96)}" stroke="#898781" stroke-width="1"/>'
            f'<text x="{w - 12}" y="{sy(1.96) - 3}" font-size="9" fill="#6f6d68" text-anchor="end">naive 1.96</text>'
            f'<polyline fill="none" stroke="#0ca30c" stroke-width="2" points="{pts(lambda r: r["eff"])}"/>'
            f'<polyline fill="none" stroke="#d03b3b" stroke-width="2" points="{pts(lambda r: -r["harm"])}"/>'
            f'<polyline fill="none" stroke="#eb6834" stroke-width="2.6" points="{pts(lambda r: r["z"])}"/>'
            f'<circle cx="{sx(last["n"]):.1f}" cy="{sy(last["z"]):.1f}" r="5" fill="#eb6834" stroke="#fff" stroke-width="2"/>'
            f'<text x="{sx(last["n"]) - 8:.1f}" y="{sy(last["z"]) - 9:.1f}" font-size="10" font-weight="700" text-anchor="end">promoted</text>'
            f'<text x="32" y="{h - 4}" font-size="9" fill="#6f6d68">0</text><text x="{w - 10}" y="{h - 4}" font-size="9" fill="#6f6d68" text-anchor="end">{nmax:,} calls</text></svg>')


def build_slide_fixloop() -> str:
    """The earlier slide (the fix-loop story on the sequential rule). Kept as dist/one_slide_fixloop.html."""
    fixed = have_fix()
    b = scenario_bundle("fix_ships" if fixed else "b_wins"); rec = b["record"]; r = rec["result"]; last = rec["looks"][-1]; c = rec["config"]
    P = json.loads((OUT / "proof.json").read_text()); S = P["scenarios"]
    f = lambda k, m, o="PROMOTE": S[k]["methods"][m]["outcomes"].get(o, {"rate": 0})["rate"] * 100
    sp = [x for x in P["split_accuracy"] if x["n"] == 1037]
    mean = lambda key: sum(x[key]["mean_abs_err_pp"] for x in sp) / len(sp)
    st = P["stickiness"]
    if fixed:
        F = fixloop.bundle(); m = F["mine"]; E = F["evidence"] or {}; prop = F["proposal"]; lp = E.get("loops") or {}
        cf = E.get("conflicts", []); ck = E.get("edit_check") or {}
        pairs = ", ".join(f"{c['field']} {' vs '.join(str(x) for x in c['limits'])}" for c in cf)
        PS = F["prescreen"]
        pre = (f"{PS['n_pairs']} simulated buyers: gate {'passed' if PS['passed'] else 'FAILED'}" if PS and not PS.get("stale")
               else f"not run on the real prompt (about Rs {F['costs']['prescreen']['est_inr']:.0f}, optional)")
        rep3 = f"{lp['bot_repeat3']['rate']*100:.1f}%" if lp else "n/a"
        flow = (f'<div><b>1 Find</b> VANI\'s real prompt (25,000 words) contradicts itself on ask limits ({pairs}); the quality matrix grades more than 1+2 asks as fatal looping. '
                f'Only {rep3} of {lp.get("calls_with_speech", 0)} real calls loop verbatim (lower bound), so expect a safety gain, not a conversion jump.</div><i>&darr;</i>'
                f'<div><b>2 Fix</b> {prop["name"]}: {ck.get("before", "?")} contradictions &rarr; {ck.get("after", "?")}, none added (origin: {prop["origin"]})</div><i>&darr;</i>'
                f'<div><b>3 Pre-check</b> {pre}</div><i>&darr;</i>'
                f'<div><b>4 Prove</b> {F["plan"]["n_max"]:,} calls to be sure of +{F["plan"]["mde"]*100:.0f}pp; ships only if it provably wins</div><i>&darr;</i>'
                f'<div><b>Record</b> hash-chained, with the evidence behind the fix</div>')
        title, sub = "Picky - Test it, pick it, ship it: the bot finds its weak spot, fixes it, and proves the fix", "On VANI\'s real prompt and 299 real calls. The A/B engine decides; every claim is computed by re-runnable code and says how sure we are."
        wf_h = "From the real prompt to a shipped fix"
        exp_h = f"Live test of the fix (simulated outcomes, known truth A {b['meta']['true_a']*100:.1f}% / B {b['meta']['true_b']*100:.1f}%)"
    else:
        flow = ('<div>Variants A / B (prompt + small patch, versioned)</div><i>&darr;</i><div>Router: sticky split</div><i>&darr;</i><div>VANI answers the buyer</div><i>&darr;</i>'
                '<div>Auto-disposition tagger &rarr; BuyLead created? + handling time</div><i>&darr;</i><div>Monitor each look: SRM &middot; harm &middot; promote &middot; guardrail</div><i>&darr;</i><div>Hash-chained ledger</div>')
        title, sub = "Picky - Test it, pick it, ship it", "No prompt ships without proof. Try a change on a small slice of calls, ship it only if it provably wins, stop it early if it is clearly worse."
        wf_h = "Workflow"
        exp_h = f"Sample experiment (simulated, known truth A {b['meta']['true_a']*100:.0f}% / B {b['meta']['true_b']*100:.0f}%)"
    share = int(round(c["share_b"] * 100))
    html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Picky - one slide</title><style>
@page {{ size: 1280px 720px; margin: 0 }} *{{box-sizing:border-box}} body{{margin:0;background:#e9e8e3;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#0b0b0b}}
.s{{width:1280px;height:720px;margin:0 auto;background:#fcfcfb;padding:28px 36px;display:grid;grid-template-rows:auto 1fr auto;gap:14px}}
h1{{margin:0;font-size:30px;letter-spacing:-.02em}} .sub{{color:#52514e;margin-top:2px}} .cols{{display:grid;grid-template-columns:1.05fr 1fr 1.05fr;gap:18px}}
.box{{border:1px solid #e1e0d9;border-radius:12px;padding:14px 16px}} h2{{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#52514e}}
ul{{margin:0;padding-left:18px}} li{{margin:3px 0}} .kpi{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}} .kpi div{{background:#f6f5f1;border-radius:10px;padding:10px 12px}}
.kpi b{{display:block;font-size:26px;letter-spacing:-.02em}} .kpi span{{color:#52514e;font-size:12px}} .pill{{display:inline-block;background:rgba(12,163,12,.12);color:#006300;font-weight:700;padding:3px 10px;border-radius:99px;font-size:12px}}
.flow{{display:grid;gap:6px}} .flow div{{background:#f6f5f1;border-radius:8px;padding:6px 10px;font-size:12.5px}} .flow i{{display:block;text-align:center;color:#898781;line-height:1;font-style:normal}} .m{{font-family:ui-monospace,Menlo,monospace;font-size:11.5px}}
</style></head><body><div class="s">
<div><h1>{title}</h1><div class="sub">{sub}</div></div>
<div class="cols">
<div class="box"><h2>{exp_h}</h2>{_spark(rec)}
<div style="color:#52514e;font-size:11px;margin-top:2px"><b style="color:#0ca30c">&#9473;</b> promote boundary &nbsp; <b style="color:#d03b3b">&#9473;</b> stop boundary &nbsp; <b style="color:#eb6834">&#9473;</b> z of B vs A &nbsp; (peeking already paid for)</div>
<div style="margin-top:6px"><span class="pill">PROMOTED</span> at look {r['at_look']}/{r['of_looks']}, {r['calls_analysed']:,} of {r['n_max']:,} planned calls</div>
<div class="m" style="margin-top:6px">A {last['rateA']*100:.1f}% ({last['nA']:,}) &middot; B {last['rateB']*100:.1f}% ({last['nB']:,}) &middot; lift {last['diff']*100:+.1f} pp<br>95% interval {last['rci'][0]*100:+.1f} to {last['rci'][1]*100:+.1f} pp &middot; z={last['z']:.2f} &ge; {last['eff']:.2f}<br>ledger head {rec['ledger_head'][:16]}</div></div>
<div class="box"><h2>Method and decision rules (fixed before launch)</h2><ul>
<li><b>Test:</b> score z on the difference in goal rate; <b>Lan-DeMets alpha-spending</b> over {len(rec['design']['look_n'])} looks, so peeking is paid for in advance.</li>
<li><b>Sample size:</b> {rec['design']['n_max']:,} calls for 80% power at +{c['mde']*100:.0f}pp from {c['baseline']*100:.1f}% (+{(rec['design']['inflation']-1)*100:.1f}% over a single-look test).</li>
<li><b>Order of checks:</b> broken test (split or missing calls, p&lt;0.001) &rarr; harm boundary (Pocock, 2.5%) &rarr; promote boundary (O'Brien-Fleming, 2.5%) &rarr; guardrail proven.</li>
<li><b>Primary decides, guardrail vetoes:</b> average handling time may not worsen &gt;15%.</li><li><b>End of window:</b> inconclusive, nothing ships.</li>
<li><b>Split:</b> sticky per lead; balanced blocks or stateless hash; achieved vs configured reported.</li></ul></div>
<div class="box"><h2>{wf_h}</h2><div class="flow">{flow}</div></div>
</div>
<div class="kpi"><div><b>{f('aa','canary'):.1f}% vs {f('aa','naive_peek'):.1f}%</b><span>false win when A = B: Picky vs naive peeking</span></div>
<div><b>{f('srm_bug','canary'):.1f}% vs {f('srm_bug','naive_peek'):.1f}%</b><span>ships B when the test is silently broken</span></div>
<div><b>{mean('balanced'):.2f} vs {mean('naive_random'):.2f} pp</b><span>split error at ~1,000 leads: balanced vs coin flip</span></div>
<div><b>0 vs {st['naive_random']['flip_rate']*100:.1f}%</b><span>repeat calls that switch arm: Picky vs coin flip</span></div></div>
</div></body></html>"""
    DIST.mkdir(exist_ok=True)
    out = DIST / "one_slide_fixloop.html"
    out.write_text(html)
    return str(out)


def _daily(rec, w=400, h=250):
    """A and B cumulative goal rate by day (the last look of each day)."""
    days = {}
    for r in rec["looks"]:
        days[r["day"]] = r
    ds = sorted(days)
    lo = min(min(days[d]["rateA"], days[d]["rateB"]) for d in ds) - 0.04
    hi = max(max(days[d]["rateA"], days[d]["rateB"]) for d in ds) + 0.04
    sx = lambda d: 44 + (d - 0.5) / len(ds) * (w - 90)
    sy = lambda v: 12 + (1 - (v - lo) / (hi - lo)) * (h - 44)
    line = lambda key, col: f'<polyline fill="none" stroke="{col}" stroke-width="2.6" points="' + " ".join(f"{sx(d):.1f},{sy(days[d][key]):.1f}" for d in ds) + '"/>'
    grid = "".join(f'<line x1="44" x2="{w - 46}" y1="{sy(t):.1f}" y2="{sy(t):.1f}" stroke="#e3e7ec"/><text x="38" y="{sy(t) + 3:.1f}" font-size="9" fill="#667085" text-anchor="end">{t:.0%}</text>' for t in (round(lo + (hi - lo) * i / 4, 2) for i in range(5)))
    xs = "".join(f'<text x="{sx(d):.1f}" y="{h - 8}" font-size="9" fill="#667085" text-anchor="middle">{d}</text>' for d in ds)
    last = days[ds[-1]]
    return (f'<svg viewBox="0 0 {w} {h}" width="100%">{grid}{xs}{line("rateA", "#243b53")}{line("rateB", "#4c7cf3")}'
            f'<text x="{sx(ds[-1]) + 6:.1f}" y="{sy(last["rateA"]) + 4:.1f}" font-size="11" font-weight="700" fill="#243b53">A {last["rateA"]:.0%}</text>'
            f'<text x="{sx(ds[-1]) + 6:.1f}" y="{sy(last["rateB"]) + 4:.1f}" font-size="11" font-weight="700" fill="#4c7cf3">B {last["rateB"]:.0%}</text>'
            f'<text x="{w / 2}" y="{h - 0}" font-size="9" fill="#667085" text-anchor="middle">day</text></svg>')


def build_slide() -> str:
    """The required one slide, written to the second BRD: a sample result, the statistical method and decision rules, and the flow from routing to rollout."""
    from . import console
    d = next(x for x in console.DEMO if x["key"] == "demo_win")
    rec = console.run_preset(d["name"], d["variant"], d["start"], "exp-" + d["key"].replace("_", "-"), d["effect"], d["seed"])
    r, c, last = rec["result"], rec["config"], rec["looks"][-1]
    P = json.loads((OUT / "proof.json").read_text())
    aa = P.get("aa_brd") or {}
    sb = next((x for x in (P.get("split_brd") or []) if x["n"] == 7000 and x["share"] == 0.3), None)
    hb = rec.get("holdback") or {}
    pct = lambda v, k=1: f"{v * 100:.{k}f}%"
    kp = [(pct(aa["false_winner"]["rate"]) if aa else "-", f"promoted when A = B ({aa.get('runs', 0):,} runs); {pct(aa['significant_either_way']['rate']) if aa else '-'} look different either way" if aa else ""),
          (pct(aa["plain_daily_check_false_winner"]["rate"]) if aa and "plain_daily_check_false_winner" in aa else "-", "false winners from a plain daily p&lt;0.05 check"),
          (f"{sb['stratified']['mean_abs_err_pp']:.2f} pp" if sb else "-", f"B-share error at 7,000 leads (plain random {sb['hash']['mean_abs_err_pp']:.2f} pp)" if sb else ""),
          ("0", "leads that saw both prompts; A and B carry the same lead-type mix")]
    html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Picky - one slide</title><style>
@page {{ size: 1280px 720px; margin: 0 }} *{{box-sizing:border-box}} body{{margin:0;background:#f3f5f7;font:14px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#263238}}
.s{{width:1280px;height:720px;margin:0 auto;background:#fff;padding:26px 34px;display:grid;grid-template-rows:auto 1fr auto;gap:14px}}
h1{{margin:0;font-size:30px;letter-spacing:-.02em;color:#243b53}} .sub{{color:#667085;margin-top:2px}} .cols{{display:grid;grid-template-columns:1fr 1.1fr 1fr;gap:16px}}
.box{{border:1px solid #e3e7ec;border-radius:10px;padding:12px 16px}} h2{{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#667085}}
ul{{margin:0;padding-left:18px}} li{{margin:3px 0;font-size:12.5px}} .kpi{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}} .kpi div{{background:#f3f5f7;border-radius:10px;padding:10px 12px}}
.kpi b{{display:block;font-size:26px;letter-spacing:-.02em;color:#243b53}} .kpi span{{color:#667085;font-size:12px}} .pill{{display:inline-block;background:rgba(34,166,153,.14);color:#167a70;font-weight:700;padding:3px 10px;border-radius:99px;font-size:12px}}
.flow{{display:grid;gap:5px}} .flow div{{background:#f3f5f7;border-radius:8px;padding:6px 10px;font-size:12.5px}} .flow i{{display:block;text-align:center;color:#a0a7b1;line-height:1;font-style:normal}} .m{{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#667085}}
table{{border-collapse:collapse;width:100%;font-size:11.5px;margin-top:6px}} td,th{{border-top:1px solid #e3e7ec;padding:3px 6px;text-align:left}} th{{color:#667085;font-weight:600}}
</style></head><body><div class="s">
<div><h1>Picky - Test it, pick it, ship it</h1><div class="sub">No prompt change ships without proof. An A/B router in front of the voice bot and a decision engine behind it: try a change on a slice, ship it only if it provably wins, stop it early if it is clearly worse.</div></div>
<div class="cols">
<div class="box"><h2>Sample result (simulated, known truth +15%)</h2>{_daily(rec)}
<div style="margin-top:4px"><span class="pill">PROMOTED</span> at the final call, day {last['day']} of {c['window_days']}: z = {last['z']:.2f}, needed {last['eff']:.2f}</div>
<div class="m" style="margin-top:6px">A {pct(last['rateA'])} ({last['nA']:,} leads) &middot; B {pct(last['rateB'])} ({last['nB']:,} leads)<br>lift {last['diff'] * 100:+.1f} pp, 95% range {last['rci'][0] * 100:+.1f} to {last['rci'][1] * 100:+.1f} pp &middot; each lead counted once<br>Then B is production; {pct(hb.get('share', 0.05), 0)} of leads stay on A for {hb.get('days', 7)} days (a drop of {hb.get('detectable_drop_pp', '?')} pp or more would show).</div></div>
<div class="box"><h2>Method and decision rules (fixed before launch)</h2><ul>
<li><b>Unit:</b> the lead, not the call. Sticky by lead ID: nobody hears both prompts.</li>
<li><b>Split:</b> shuffled blocks of 10 inside each lead-type &times; firm-type group, so A and B carry the same mix. Segment rule shown before saving.</li>
<li><b>Winner call, once, on the last day:</b> two-proportion z-test, 95% two-sided, 80% power; duration 7 to 28 days, whole weeks.</li>
<li><b>Daily harm check:</b> B worse than A at 99.9% (one-sided) after {c['min_per_arm']:,} leads per prompt, so one bad day cannot trigger it.</li>
<li><b>Guardrails:</b> call length may not rise more than 10% (non-inferiority on the 95% range); early hang-ups. A win with a guardrail not proven is held for a person.</li></ul>
<table><tr><th>When</th><th>Evidence</th><th>Decision</th></tr><tr><td>any day</td><td>B clearly worse (99.9%)</td><td>stop, leads back to A</td></tr><tr><td>end</td><td>B better, guardrails pass</td><td>promote (or wait for approval)</td></tr><tr><td>end</td><td>B better, guardrail fails</td><td>hold for approval</td></tr><tr><td>end</td><td>no difference</td><td>inconclusive, keep A</td></tr><tr><td>end</td><td>B significantly worse</td><td>keep A, logged as a loss</td></tr></table></div>
<div class="box"><h2>Flow, from routing to rollout</h2><div class="flow">
<div><b>Lead arrives</b> with its pre-call variables</div><i>&darr;</i><div><b>Router</b> segment check &rarr; sticky &rarr; stratified block &rarr; prompt version</div><i>&darr;</i>
<div><b>Voice bot</b> loads that version; outcome and call length logged</div><i>&darr;</i><div><b>Every day</b> harm check &middot; split health (chi-square, mix balance)</div><i>&darr;</i>
<div><b>End of test</b> one winner call</div><i>&darr;</i><div><b>Promote &middot; hold &middot; stop &middot; keep A</b> with an optional approval step</div><i>&darr;</i><div><b>Decision log</b> hash-chained &middot; Prompt Library &middot; one-click rollback</div></div></div>
</div>
<div class="kpi">{''.join(f'<div><b>{a}</b><span>{b}</span></div>' for a, b in kp)}</div>
</div></body></html>"""
    DIST.mkdir(exist_ok=True)
    out = DIST / "one_slide.html"
    out.write_text(html)
    return str(out)
