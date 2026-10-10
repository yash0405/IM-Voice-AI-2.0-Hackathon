/* Charts: Chart.js (vendored in 01-vendor-chart.js). Navy and blue series with direct labels (never colour alone), thin gridlines, tooltips on hover. */

const CHART_FONT = { family: getComputedStyle(document.documentElement).getPropertyValue("--font") || "system-ui", size: 12 };
/** Charts whose canvas left the page (the screen was redrawn) are released. */
const releaseCharts = () => Object.values(Chart.instances || {}).forEach(ch => { if (!ch.canvas.isConnected) ch.destroy(); });
/** A plugin that writes the last value of A and B next to their lines, and a dashed "final call" line on the planned last day. */
const trendMarks = { id: "trendMarks", afterDatasetsDraw(ch, args, o) {
  const { ctx, chartArea: ar, scales: { x, y } } = ch; ctx.save(); ctx.font = `600 12px ${CHART_FONT.family}`;
  if (o.finalDay) { const px = x.getPixelForValue(o.finalDay - 1); ctx.strokeStyle = "#a0a7b1"; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(px, ar.top); ctx.lineTo(px, ar.bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#667085"; ctx.textAlign = "right"; ctx.fillText("final call", px - 4, ar.top + 10); }
  if (o.last) { const px = x.getPixelForValue(o.last.i) + 8, ya = y.getPixelForValue(o.last.a), yb = y.getPixelForValue(o.last.b), sep = Math.abs(ya - yb) < 14 ? 7 : 0; ctx.textAlign = "left";
    ctx.fillStyle = "#243b53"; ctx.fillText(`A ${o.last.fa}`, px, ya + 4 + (o.last.a >= o.last.b ? -sep : sep)); ctx.fillStyle = "#4c7cf3"; ctx.fillText(`B ${o.last.fb}`, px, yb + 4 + (o.last.b > o.last.a ? -sep : sep)); }
  ctx.restore(); } };

/** Cumulative goal rate of A and B by day with shaded 95% ranges. rows = [{day, row}] up to the day shown; win = planned days. */
function trendChart(el, rows, win, opts = {}) {
  if (!rows.length) { el.innerHTML = `<div class="empty">No results yet.</div>`; return; }
  releaseCharts();
  const c = opts.c || {}, avg = primaryDef(c).type === "average", fv = (x, d = 0) => fmtP(x, c, d);          // a rate is drawn in %, an average in its own unit
  const days = Array.from({ length: win }, (_, i) => i + 1), at = new Map(rows.map(({ day, row }) => [day, row]));
  const val = f => days.map(d => at.has(d) ? f(at.get(d)) : null), ci = (arm, k) => val(r => armCI(r, arm, c)[k]);
  const last = rows[rows.length - 1], lastRow = last.row;
  el.innerHTML = `<div style="position:relative;height:${opts.h || 280}px"><canvas role="img" aria-label="Cumulative ${avg ? "goal average" : "goal rate"} for A and B by day, with 95% ranges"></canvas></div>`;
  const band = (arm, col) => [{ data: ci(arm, 0), borderWidth: 0, pointRadius: 0, fill: false, spanGaps: false },
    { data: ci(arm, 1), borderWidth: 0, pointRadius: 0, backgroundColor: col, fill: "-1", spanGaps: false }];
  const line = (arm, col) => ({ label: arm === "A" ? "A (today's prompt)" : "B (new prompt)", data: val(r => r["rate" + arm]), borderColor: col, backgroundColor: "#fff", borderWidth: 2, pointRadius: 3.5, pointBorderWidth: 2, fill: false });
  new Chart($("canvas", el), {
    type: "line",
    data: { labels: days, datasets: [...band("A", "rgba(36,59,83,.14)"), ...band("B", "rgba(76,124,243,.14)"), line("A", "#243b53"), line("B", "#4c7cf3")] },
    plugins: [trendMarks],
    options: { responsive: true, maintainAspectRatio: false, animation: false, layout: { padding: { right: 64 } },
      interaction: { mode: "index", intersect: false },
      scales: { x: { title: { display: true, text: "day", font: CHART_FONT, color: "#667085" }, grid: { display: false }, ticks: { font: CHART_FONT, color: "#667085" } },
        y: { grid: { color: "#e3e7ec" }, border: { display: false }, ticks: { font: CHART_FONT, color: "#667085", callback: v => fv(v) } } },
      plugins: { legend: { display: false },
        trendMarks: { finalDay: opts.finalDay || null, last: { i: last.day - 1, a: lastRow.rateA, b: lastRow.rateB, fa: fv(lastRow.rateA), fb: fv(lastRow.rateB) } },
        tooltip: { filter: it => it.datasetIndex >= 4, callbacks: {
          title: items => `Day ${items[0].label}`,
          label: it => { const r = at.get(+it.label), arm = it.datasetIndex === 4 ? "A" : "B", [lo, hi] = armCI(r, arm, c); return `${arm}: ${fv(r["rate" + arm], 1)} (${fv(lo, 1)} to ${fv(hi, 1)})`; },
          footer: items => { const r = at.get(+items[0].label); return `leads ${nf(r.nA)} / ${nf(r.nB)}`; } } } } }
  });
}

/** False winners when A = B: Picky's rule against checking p < 0.05 every day, as two horizontal bars with their values written on them. */
function aaChart(el, picky, naive, caption = "") {
  releaseCharts();
  el.innerHTML = `<div style="position:relative;height:112px"><canvas role="img" aria-label="False winners when A equals B: Picky ${pct(picky, 1)}, checking every day ${pct(naive, 1)}"></canvas></div>${caption ? `<p class="note">${esc(caption)}</p>` : ""}`;
  const vals = [picky * 100, naive * 100], top = Math.ceil(Math.max(...vals) / 5) * 5 + 5;
  new Chart($("canvas", el), { type: "bar",
    data: { labels: ["Picky's rule", "p < 0.05 checked every day"], datasets: [{ data: vals, backgroundColor: ["#22a699", "#dc6262"], borderRadius: 4, barThickness: 24 }] },
    plugins: [{ id: "aaVals", afterDatasetsDraw(ch) { const { ctx } = ch; ctx.save(); ctx.font = `600 13px ${CHART_FONT.family}`; ctx.fillStyle = "#263238"; ctx.textBaseline = "middle";
      ch.getDatasetMeta(0).data.forEach((b, i) => ctx.fillText(`${vals[i].toFixed(1)}% false winners`, b.x + 8, b.y)); ctx.restore(); } }],
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: false, layout: { padding: { right: 130 } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { min: 0, max: top, grid: { color: "#e3e7ec" }, border: { display: false }, ticks: { callback: v => v + "%", font: CHART_FONT, color: "#667085" } },
        y: { grid: { display: false }, ticks: { font: { ...CHART_FONT, size: 13 }, color: "#263238" } } } } });
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
  const v = view(e), r = v.res, c = v.config, last = dayRows(e.record).pop().row, goal = goalName(c), avg = primaryDef(c).type === "average";
  const lr = liftRange(last, c);
  const rng = c.metrics ? ` The true difference is probably between ${fmtD(lr.lo, c, avg ? 1 : 0)} and ${fmtD(lr.hi, c, avg ? 1 : 0)}${lr.interim ? " (an interim range: the test stopped before its final call)" : ""}.` : ` The true difference is probably between ${sgn(lr.lo * 100, 0)} and ${sgn(lr.hi * 100, 0)} points${lr.interim ? " (an interim range: the test stopped before its final call)" : ""}.`;
  const nums = avg ? `Over ${v.ld} day${v.ld === 1 ? "" : "s"}, ${goal} averaged ${fmtP(last.rateB, c)} on the new prompt (${nf(last.nB)} leads) against ${fmtP(last.rateA, c)} on today's prompt (${nf(last.nA)} leads): ${fmtD(last.diff, c)}.${rng}`
    : `Over ${v.ld} day${v.ld === 1 ? "" : "s"}, ${pct(last.rateB)} of ${nf(last.dB != null ? last.dB : last.nB)} leads on the new prompt reached the goal (${goal}) against ${pct(last.rateA)} of ${nf(last.dA != null ? last.dA : last.nA)} on today's prompt: ${c.metrics ? fmtD(last.diff, c, 0) : sgn((last.rateB - last.rateA) * 100, 0) + " points"}.${rng}`;
  const g = last.guardrail ? ` Average call length was ${sgn(last.guardrail.rel_change * 100, 0)}% against a limit of +${(c.guardrail_margin * 100).toFixed(0)}%.` : c.metrics ? guardList(v).map(x => ` ${x.name}: ${x.st.value} against a limit of ${x.st.lim}.`).join("") : "";
  const src = e.kind === "files" ? " These results came from a file supplied by the voice platform." : " These results are simulated with a known injected effect; they show the engine decides correctly, not that a real prompt is better.";
  const k = v.kind;
  const verdict = { PROMOTE: "Decision: promote B to all traffic. The evidence is strong enough that luck is an unlikely explanation and the guardrail holds.", STOP_HARM: "Decision: stop B early and send its leads back to A. B is clearly worse.", LOSS: "Decision: keep A. At the final call B is significantly worse than A, so it is logged as a loss and nothing ships.", STOP_GUARDRAIL: "Decision: stop B. It breaks a guardrail even if the goal improved.",
    HOLD_FOR_APPROVAL: "Decision: hold for a person. B wins on the goal but a guardrail is not proven. Nothing has changed for callers.", INCONCLUSIVE: "Decision: inconclusive, keep A. The test found no evidence of a difference; that is not proof of none.", HALT_SRM: "Decision: halted. The test itself is broken (the split or the log), so nothing can be trusted.",
    REJECTED: "Decision: a person rejected the held change. A stays live.", ROLLED_BACK: "Decision: B was promoted and then rolled back by a person.", STOPPED_MANUAL: "Decision: a person stopped the test early." }[k] || "No decision yet.";
  const more = k === "INCONCLUSIVE" && r.more_leads && r.more_leads.options ? " " + r.more_leads.options.map(o => o.enough_already ? `There was already enough data to detect ${liftWords(o)}, so any real lift is smaller.` : `Detecting ${liftWords(o)} would take about ${nf(o.more_leads)} more leads (about ${o.more_days} days).`).slice(0, 2).join(" ") : "";
  return `${verdict} ${nums}${g}${more}${src}`;
}
