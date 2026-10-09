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


def build_slide() -> str:
    fixed = have_fix()
    b = scenario_bundle("fix_ships" if fixed else "b_wins"); rec = b["record"]; r = rec["result"]; last = rec["looks"][-1]; c = rec["config"]
    P = json.loads((OUT / "proof.json").read_text()); S = P["scenarios"]
    f = lambda k, m, o="PROMOTE": S[k]["methods"][m]["outcomes"].get(o, {"rate": 0})["rate"] * 100
    sp = [x for x in P["split_accuracy"] if x["n"] == 1037]
    mean = lambda key: sum(x[key]["mean_abs_err_pp"] for x in sp) / len(sp)
    st = P["stickiness"]
    if fixed:
        F = fixloop.bundle(); m = F["mine"]; tg = next(r for r in m["issues"] if r["key"] == m["target"]); pm = next(r for r in m["issues"] if r["key"] == m["pm_pick"])
        PS = F["prescreen"]; prop = F["proposal"]; line = prop["added"][0].lstrip("- ").strip()
        pre = (f"{PS['n_pairs']} simulated buyers: {PS['A']['converted']} vs {PS['B']['converted']} usable requirements, gate {'passed' if PS['passed'] else 'FAILED'}" if PS else "not run yet")
        flow = (f'<div><b>1 Find</b> {m["n_calls"]} real calls tagged by Sarvam. <b>{tg["name"]}</b>: {tg["converted_with"]*100:.0f}% convert vs {tg["converted_without"]*100:.0f}% without. '
                f'The most common issue ({pm["name"].lower()}) costs nothing: {pm["converted_with"]*100:.0f}% vs {pm["converted_without"]*100:.0f}%.</div><i>&darr;</i>'
                f'<div><b>2 Fix</b> Sarvam drafts one line: &ldquo;{line}&rdquo;</div><i>&darr;</i>'
                f'<div><b>3 Pre-check</b> {pre}</div><i>&darr;</i>'
                f'<div><b>4 Prove</b> sticky split, sequential test, ships only if it provably wins</div><i>&darr;</i>'
                f'<div><b>Record</b> hash-chained, with the evidence behind the fix</div>')
        title, sub = "Canary: the bot finds its weak spot, fixes it, and proves the fix", "From real VANI calls to a proven prompt change. Sarvam does the listening, the drafting and the voices; the A/B engine decides. Every claim is computed by re-runnable code."
        wf_h = "From real calls to a shipped fix"
        exp_h = f"Live test of the fix (simulated outcomes, known truth A {b['meta']['true_a']*100:.1f}% / B {b['meta']['true_b']*100:.1f}%)"
    else:
        flow = ('<div>Variants A / B (prompt + small patch, versioned)</div><i>&darr;</i><div>Router: sticky split</div><i>&darr;</i><div>VANI calls the buyer</div><i>&darr;</i>'
                '<div>Auto-disposition tagger &rarr; BuyLead created? + handling time</div><i>&darr;</i><div>Monitor each look: SRM &middot; harm &middot; promote &middot; guardrail</div><i>&darr;</i><div>Hash-chained ledger</div>')
        title, sub = "Canary: no prompt ships without proof", "Try a change on a small slice of calls, ship it only if it provably wins, stop it early if it is clearly worse."
        wf_h = "Workflow"
        exp_h = f"Sample experiment (simulated, known truth A {b['meta']['true_a']*100:.0f}% / B {b['meta']['true_b']*100:.0f}%)"
    share = int(round(c["share_b"] * 100))
    html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Canary - one slide</title><style>
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
<div class="kpi"><div><b>{f('aa','canary'):.1f}% vs {f('aa','naive_peek'):.1f}%</b><span>false win when A = B: Canary vs naive peeking</span></div>
<div><b>{f('srm_bug','canary'):.1f}% vs {f('srm_bug','naive_peek'):.1f}%</b><span>ships B when the test is silently broken</span></div>
<div><b>{mean('balanced'):.2f} vs {mean('naive_random'):.2f} pp</b><span>split error at ~1,000 leads: balanced vs coin flip</span></div>
<div><b>0 vs {st['naive_random']['flip_rate']*100:.1f}%</b><span>repeat calls that switch arm: Canary vs coin flip</span></div></div>
</div></body></html>"""
    DIST.mkdir(exist_ok=True)
    out = DIST / "one_slide.html"
    out.write_text(html)
    return str(out)
