/* Charts: hand-drawn SVG, thin gridlines, navy and blue series with direct labels (never colour alone), tooltips on hover. */

const niceTicks = (lo, hi, n = 5) => { const st = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(st)), f = st / mag, s = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag, out = []; for (let v = Math.ceil(lo / s - 1e-9) * s; v <= hi + 1e-9; v += s) out.push(+v.toFixed(10)); return out; };

/** Cumulative goal rate of A and B by day with shaded 95% ranges. rows = [{day, row}] up to the day shown; win = planned days. */
function trendChart(el, rows, win, opts = {}) {
  const w = Math.max(320, el.clientWidth || 640), h = opts.h || 280, ml = 48, mr = 64, mt = 12, mb = 32;
  if (!rows.length) { el.innerHTML = `<div class="empty">No results yet.</div>`; return; }
  const pts = rows.map(({ day, row }) => ({ day, nA: row.nA, xA: row.xA, nB: row.nB, xB: row.xB, a: row.rateA, b: row.rateB, ca: wilson(row.xA, row.nA), cb: wilson(row.xB, row.nB) }));
  let lo = Math.min(...pts.map(p => Math.min(p.ca[0], p.cb[0]))), hi = Math.max(...pts.map(p => Math.max(p.ca[1], p.cb[1])));
  const pad = Math.max(0.02, (hi - lo) * 0.08); lo = Math.max(0, lo - pad); hi = Math.min(1, hi + pad);
  const yt = niceTicks(lo, hi, 5), y0 = yt[0] - 0.005 > 0 ? Math.min(lo, yt[0]) : lo, y1 = Math.max(hi, yt[yt.length - 1]);
  const sx = d => ml + (d - 0.5) / win * (w - ml - mr), sy = v => mt + (1 - (v - y0) / (y1 - y0)) * (h - mt - mb);
  const band = (key, ci, col) => { const top = pts.map(p => `${sx(p.day).toFixed(1)},${sy(p[ci][1]).toFixed(1)}`), bot = pts.slice().reverse().map(p => `${sx(p.day).toFixed(1)},${sy(p[ci][0]).toFixed(1)}`); return pts.length > 1 ? `<path d="M${top.join("L")}L${bot.join("L")}Z" fill="${col}" opacity=".14"/>` : `<line x1="${sx(pts[0].day)}" x2="${sx(pts[0].day)}" y1="${sy(pts[0][ci][0])}" y2="${sy(pts[0][ci][1])}" stroke="${col}" stroke-width="6" opacity=".25"/>`; };
  const line = (k, col) => `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${sx(p.day).toFixed(1)},${sy(p[k]).toFixed(1)}`).join("")}" fill="none" stroke="${col}" stroke-width="2"/>${pts.map(p => `<circle cx="${sx(p.day).toFixed(1)}" cy="${sy(p[k]).toFixed(1)}" r="3.5" fill="#fff" stroke="${col}" stroke-width="2"/>`).join("")}`;
  const last = pts[pts.length - 1], dy = Math.abs(sy(last.b) - sy(last.a)) < 14 ? 7 : 0;
  let g = yt.map(t => `<g class="grid"><line x1="${ml}" x2="${w - mr}" y1="${sy(t)}" y2="${sy(t)}"/></g><text x="${ml - 8}" y="${sy(t) + 4}" text-anchor="end">${(t * 100).toFixed(0)}%</text>`).join("");
  g += Array.from({ length: win }, (_, i) => i + 1).map(d => `<text x="${sx(d)}" y="${h - 10}" text-anchor="middle">${d}</text>`).join("") + `<text x="${ml}" y="${h - 10}" text-anchor="end">day</text>`;
  g += band("a", "ca", "var(--a)") + band("b", "cb", "var(--b)") + line("a", "#243b53") + line("b", "#4c7cf3");
  g += `<text x="${sx(last.day) + 10}" y="${sy(last.a) + 4 + (last.a >= last.b ? -dy : dy)}" class="lbl-a">A ${pct(last.a)}</text><text x="${sx(last.day) + 10}" y="${sy(last.b) + 4 + (last.b > last.a ? -dy : dy)}" class="lbl-b">B ${pct(last.b)}</text>`;
  if (opts.finalDay) g += `<line x1="${sx(opts.finalDay)}" x2="${sx(opts.finalDay)}" y1="${mt}" y2="${h - mb}" stroke="var(--off)" stroke-dasharray="4 4"/><text x="${sx(opts.finalDay) - 4}" y="${mt + 10}" text-anchor="end">final call</text>`;
  g += `<rect class="hit" x="${ml}" y="${mt}" width="${w - ml - mr}" height="${h - mt - mb}" fill="transparent"/>`;
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${w} ${h}" height="${h}" role="img" aria-label="Cumulative goal rate for A and B by day, with 95% ranges">${g}</svg>`;
  $(".hit", el).addEventListener("mousemove", ev => { const b = ev.currentTarget.getBoundingClientRect(), d = Math.round((ev.clientX - b.left) / (w - ml - mr) * win + 0.5 - 0.5); const p = pts.find(q => q.day === Math.min(Math.max(1, d), win)) || pts[pts.length - 1];
    tip.show(`<b>Day ${p.day}</b><div class="r"><span>A</span><span>${pct(p.a, 1)} (${pct(p.ca[0], 1)} to ${pct(p.ca[1], 1)})</span></div><div class="r"><span>B</span><span>${pct(p.b, 1)} (${pct(p.cb[0], 1)} to ${pct(p.cb[1], 1)})</span></div><div class="r"><span>leads</span><span>${nf(p.nA)} / ${nf(p.nB)}</span></div>`, ev); });
  $(".hit", el).addEventListener("mouseleave", () => tip.hide());
}

/** Two horizontal bars: configured against achieved share of B. */
function shareBars(label, configured, achieved, n) {
  const w = (x) => Math.max(0.5, Math.min(100, x * 100));
  return `<div style="margin:8px 0"><div class="note" style="display:flex;justify-content:space-between"><span>${esc(label)}</span><span>${n != null ? nf(n) + " " : ""}</span></div>
    <div style="position:relative;height:16px"><div class="bar" style="height:16px"><i style="width:${w(achieved)}%;background:var(--b)"></i></div><span style="position:absolute;left:${w(configured)}%;top:-3px;height:22px;border-left:2px solid var(--navy)" title="configured ${pct(configured, 0)}"></span></div>
    <div class="note" style="display:flex;justify-content:space-between"><span>achieved <b style="color:var(--ink)">${pct(achieved, 1)}</b></span><span>configured <b style="color:var(--ink)">${pct(configured, 0)}</b> (marker)</span></div></div>`;
}

/** A plain-English summary, written from the numbers by a template (a model never writes the numbers). */
function plainSummary(e) {
  const v = view(e), r = v.res, c = v.config, last = dayRows(e.record).pop().row, goal = (C.metrics.find(m => m.key === c.primary_goal) || {}).name || c.primary_goal.replace(/_/g, " ");
  const lift = (last.rateB - last.rateA) * 100, lr = liftRange(last, c);
  const rng = ` The true difference is probably between ${sgn(lr.lo * 100, 0)} and ${sgn(lr.hi * 100, 0)} points${lr.interim ? " (an interim range: the test stopped before its final call)" : ""}.`;
  const nums = `Over ${v.ld} day${v.ld === 1 ? "" : "s"}, ${pct(last.rateB)} of ${nf(last.nB)} leads on the new prompt reached the goal (${goal}) against ${pct(last.rateA)} of ${nf(last.nA)} on today's prompt: ${sgn(lift, 0)} points.${rng}`;
  const g = last.guardrail ? ` Average call length was ${sgn(last.guardrail.rel_change * 100, 0)}% against a limit of +${(c.guardrail_margin * 100).toFixed(0)}%.` : "";
  const src = e.kind === "files" ? " These results came from a file supplied by the voice platform." : " These results are simulated with a known injected effect; they show the engine decides correctly, not that a real prompt is better.";
  const k = v.kind;
  const verdict = { PROMOTE: "Decision: promote B to all traffic. The evidence is strong enough that luck is an unlikely explanation and the guardrail holds.", STOP_HARM: "Decision: stop B early and send its leads back to A. B is clearly worse.", LOSS: "Decision: keep A. At the final call B is significantly worse than A, so it is logged as a loss and nothing ships.", STOP_GUARDRAIL: "Decision: stop B. It breaks a guardrail even if the goal improved.",
    HOLD_FOR_APPROVAL: "Decision: hold for a person. B wins on the goal but a guardrail is not proven. Nothing has changed for callers.", INCONCLUSIVE: "Decision: inconclusive, keep A. The test found no evidence of a difference; that is not proof of none.", HALT_SRM: "Decision: halted. The test itself is broken (the split or the log), so nothing can be trusted.",
    REJECTED: "Decision: a person rejected the held change. A stays live.", ROLLED_BACK: "Decision: B was promoted and then rolled back by a person.", STOPPED_MANUAL: "Decision: a person stopped the test early." }[k] || "No decision yet.";
  const more = k === "INCONCLUSIVE" && r.more_leads && r.more_leads.options ? " " + r.more_leads.options.map(o => o.enough_already ? `There was already enough data to detect ${o.lift_pp} points, so any real lift is smaller.` : `Detecting ${o.lift_pp} points would take about ${nf(o.more_leads)} more leads (about ${o.more_days} days).`).slice(0, 2).join(" ") : "";
  return `${verdict} ${nums}${g}${more}${src}`;
}
