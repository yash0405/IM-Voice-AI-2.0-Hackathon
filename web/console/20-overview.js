/* Overview: running tests, the production prompt, totals, recent decisions. */

function totals() {
  const t = { run: 0, win: 0, stop: 0, inc: 0, held: 0, halted: 0, running: 0 };
  EXPS().forEach(e => { const v = view(e);
    if (v.running || v.d.paused && !v.ended) { t.running++; return; }
    if (v.kind === "HOLD_FOR_APPROVAL") { t.held++; return; }
    if (!v.ended) return;
    t.run++;
    if (v.kind === "PROMOTE" || v.kind === "ROLLED_BACK") t.win++;
    else if (v.kind === "STOP_HARM" || v.kind === "STOP_GUARDRAIL" || v.kind === "STOPPED_MANUAL") t.stop++;
    else if (v.kind === "INCONCLUSIVE" || v.kind === "REJECTED") t.inc++;
    else if (v.kind === "HALT_SRM") t.halted++;
  });
  return t;
}
function liftParts(v) {
  if (!v.cur) return ["-", "No results yet"];
  const r = liftRange(v.cur);
  return [pts(v.cur.diff, 0), `95% range ${sgn(r.lo * 100, 0)} to ${sgn(r.hi * 100, 0)} pp${r.interim ? " (interim)" : ""}`];
}
function advance(e, n = 1) {
  const v = view(e); if (v.ended && !(v.d.paused)) return false;
  const d = dyn(e); if (d.paused) { toast("This test is paused. Resume it first."); return false; }
  const before = view(e); d.day = Math.min(before.ld, d.day + n); saveDyn();
  const after = view(e); if (!before.decided && after.decided) toast(`${e.record.config.name}: ${KIND_LABEL[after.kind] || after.kind}`);
  return true;
}
function advanceAll() { let moved = 0; EXPS().forEach(e => { if (view(e).running && advance(e)) moved++; }); if (!moved) toast("No running tests to advance."); route(); }

function runningCard(e) {
  const v = view(e), c = v.config, pctDone = Math.min(100, v.day / v.win * 100);
  return `<div class="card" style="display:grid;gap:12px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><h3><a href="#/live/${encodeURIComponent(e.id)}">${esc(c.name)}</a></h3><div class="note">${esc(e.kind === "files" ? "Results files" : e.preset || "Simulated")} · started ${fdate(c.start)}</div></div>${statusPill(v)}</div>
    <div><div style="display:flex;justify-content:space-between;font-size:13px"><span>Day <b>${v.day}</b> of ${v.win}</span><span class="muted">${nf(v.cur ? v.cur.n : 0)} leads</span></div><div class="bar" style="margin-top:4px"><i style="width:${pctDone}%"></i></div></div>
    <div class="kpi" title="B's rate minus A's rate so far, in percentage points"><div class="k">Current lift of B over A</div><div class="v" style="font-size:26px">${esc(liftParts(v)[0])}</div><div class="d">${esc(liftParts(v)[1])}</div></div>
    <div class="actions"><a class="btn sm" href="#/live/${encodeURIComponent(e.id)}">Open</a>${v.running ? `<button class="btn sm" data-adv="${esc(e.id)}">Advance 1 day (demo)</button>` : ""}${v.kind === "HOLD_FOR_APPROVAL" && !v.d.approval ? `<a class="btn sm primary" href="#/live/${encodeURIComponent(e.id)}">Decide</a>` : ""}</div></div>`;
}

ROUTES.overview = (el) => {
  const t = totals(), prod = productionState(), nPast = EXPS().filter(isPast).length, ev = allEvents().filter(x => x.type !== "Started" && (!x.id || !isPast(byId(x.id)))).slice(0, 6), live = EXPS().filter(e => { const v = view(e); return v.running || v.d.paused && !v.ended || (v.kind === "HOLD_FOR_APPROVAL" && !v.d.approval); });
  const pr = C.proof;
  el.innerHTML = head("Overview", "Tests that are running, the prompt that is live, and how the tests have gone so far.",
    `<button class="btn" id="adv-all">Advance all running tests 1 day (demo)</button><a class="btn" href="#/import">Import results files</a><a class="btn primary" href="#/new">New experiment</a>`) +
    `<div class="grid g4" style="margin-bottom:16px">
      <div class="card kpi"><div class="k">Tests run</div><div class="v">${t.run}</div><div class="d">${t.running} running now${t.held ? `, ${t.held} waiting for a person` : ""}</div></div>
      <div class="card kpi"><div class="k">Promoted (wins)</div><div class="v">${t.win}</div><div class="d"><span class="delta up">▲</span> shipped to all traffic</div></div>
      <div class="card kpi"><div class="k">Stopped</div><div class="v">${t.stop}</div><div class="d"><span class="delta down">▼</span> worse, or a guardrail broken</div></div>
      <div class="card kpi"><div class="k">Inconclusive</div><div class="v">${t.inc}</div><div class="d">${t.halted ? `plus ${t.halted} halted (broken test)` : "no evidence either way"}</div></div></div>
    <p class="note" style="margin:-8px 0 16px">Totals include the ${nPast} sample tests in History. Only tests played in this demo change the live prompt.</p>
    <h2 style="font-size:16px;font-weight:600;color:var(--navy);margin:24px 0 12px">Running tests</h2>
    ${live.length ? `<div class="grid g3">${live.map(runningCard).join("")}</div>` : `<div class="empty">No tests are running. <a href="#/new">Start a new experiment</a> or pick an idea from <a href="#/suggest">Suggest A/B Tests</a>.</div>`}
    <div class="grid g2" style="margin-top:24px">
      <div class="card"><h2>Production prompt</h2><div class="sub">The version that serves callers right now.</div>
        <dl class="kv" style="margin-top:16px"><dt>Live version</dt><dd><b>${esc(prod.live.id)}</b> ${pill(prod.live.id === "v1" ? "as received" : "promoted in this demo", prod.live.id === "v1" ? "plain" : "pos")}</dd><dt>Name</dt><dd>${esc(prod.live.name)}</dd><dt>Fingerprint</dt><dd class="mono">${esc(prod.live.hash)}</dd><dt>Source</dt><dd>${esc(prod.live.from || "The real VANI buyer-side prompt")}</dd></dl>
        <div class="actions" style="margin-top:16px"><a class="btn sm" href="#/library">Open Prompt Library</a></div></div>
      <div class="card"><h2>Recent decisions</h2><div class="sub">The latest events from every test.</div>
        ${ev.length ? `<div class="ledger" style="margin-top:8px">${ev.map(x => `<div class="e"><span class="note">${esc(fdt(x.ts))}</span><span><b>${esc(x.type)}</b> · ${esc(x.exp)}<br><span class="muted">${esc(x.text)}</span></span></div>`).join("")}</div>` : `<div class="empty" style="margin-top:12px">No decisions yet in this demo. Advance a running test to its last day. The Decision Log also holds the history samples.</div>`}
        <div class="actions" style="margin-top:12px"><a class="btn sm" href="#/log">Open Decision Log</a></div></div></div>
    ${pr ? `<div class="card" style="margin-top:16px"><h2>A vs A check</h2><div class="sub">The strongest proof the statistics are sound: when A and an identical copy are compared, how often is a winner wrongly declared?</div>
      <div class="grid g3" style="margin-top:16px"><div class="kpi"><div class="k">This engine, single winner call at the end</div><div class="v">${pct(pr.final_look, 1)}</div><div class="d">of ${nf(pr.runs)} identical-prompt tests; 95% range ${pct(pr.final_look_ci[0], 1)} to ${pct(pr.final_look_ci[1], 1)}, budget 2.5%</div></div>
      <div class="kpi"><div class="k">This engine, early promote and stop</div><div class="v">${pct(pr.sequential, 1)}</div><div class="d">same traffic, 14 daily looks</div></div>
      <div class="kpi"><div class="k">A plain p &lt; 0.05 check every day</div><div class="v">${pct(pr.naive, 1)}</div><div class="d">false winners; ${pct(pr.naive_wrong, 0)} counting false stops too</div></div></div>
      <div class="note" style="margin-top:8px">Simulated, with a known answer. Re-run with <span class="mono">python -m canary proof</span>.</div></div>` : ""}`;
  $("#adv-all").onclick = advanceAll;
  $$("[data-adv]", el).forEach(b => b.onclick = () => { const e = byId(b.dataset.adv); if (advance(e)) route(); });
};
