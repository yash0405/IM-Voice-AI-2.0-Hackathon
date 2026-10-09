/* Overview (BRD): top tiles, business impact, the live prompt, what needs attention, running tests, the traffic map, recent decisions, the scorecard, the top suggestion. */

const isDemoWorld = e => !isPast(e);
function totals() {
  const t = { run: 0, win: 0, stop: 0, inc: 0, held: 0, halted: 0, running: 0, alerts: 0, month: 0 };
  EXPS().forEach(e => { const v = view(e);
    if (v.scheduled) { t.running++; return; }
    if (v.running || v.d.paused && !v.ended) { t.running++; return; }
    if (v.kind === "HOLD_FOR_APPROVAL") { t.held++; return; }
    if (!v.ended) return;
    t.run++;
    if (isDemoWorld(e) && ["STOP_HARM", "STOP_GUARDRAIL", "HALT_SRM"].includes(v.kind)) t.alerts++;
    if (isDemoWorld(e) && v.res.time && v.res.time.startsWith("2026-10")) t.month++;
    if (v.kind === "PROMOTE" || v.kind === "ROLLED_BACK") t.win++;
    else if (v.kind === "STOP_HARM" || v.kind === "LOSS" || v.kind === "STOP_GUARDRAIL" || v.kind === "STOPPED_MANUAL") t.stop++;
    else if (v.kind === "INCONCLUSIVE" || v.kind === "REJECTED") t.inc++;
    else if (v.kind === "HALT_SRM") t.halted++;
  });
  return t;
}
function liftParts(v) {
  if (!v.cur) return ["-", "No results yet"];
  const r = liftRange(v.cur, v.config);
  return [pts(v.cur.diff, 0), `${confOf(v.config)}% range ${sgn(r.lo * 100, 0)} to ${sgn(r.hi * 100, 0)} pp${r.interim ? " (interim)" : ""}`];
}
function advance(e, n = 1) {
  const v = view(e); if (v.scheduled) { toast("This test is scheduled and has not started."); return false; } if (v.ended && !(v.d.paused)) return false;
  const d = dyn(e); if (d.paused) { toast("This test is paused. Resume it first."); return false; }
  const before = view(e); d.day = Math.min(before.ld, d.day + n); saveDyn();
  const after = view(e); if (!before.decided && after.decided) toast(`${e.record.config.name}: ${KIND_LABEL[after.kind] || after.kind}`);
  return true;
}
function advanceAll() { let moved = 0; EXPS().forEach(e => { if (view(e).running && advance(e)) moved++; }); if (!moved) toast("No running tests to advance."); route(); }

/** What the live prompt gained in the test that promoted it, against the base prompt that test compared it with. Lifts of different tests do not add (each B was
    compared with the base prompt, not with the previous live one), so only the latest all-traffic promotion is shown; winners' lifts run high, so the low end is shown too. */
function businessImpact() {
  const P = productionState(), live = P.live; if (!live.expView || !live.expId) return null;
  const e = byId(live.expId), c = e.record.config, r = dayRows(e.record).pop().row, lr = liftRange(r, c), sign = c.primary_direction === "lower" ? -1 : 1, rel = sign * (r.rateB / r.rateA - 1), low = sign > 0 ? lr.lo / r.rateA : -lr.hi / r.rateA;
  return { rel, low, goal: (C.metrics.find(m => m.key === c.primary_goal) || {}).name || "the goal", since: live.time, name: live.from, id: e.id, lower: sign < 0 };
}
const needLeads = e => e.record.config.rule_set === "final_look" ? e.record.design.n_fixed : e.record.design.n_max;

/** Each running test's slice of today's traffic: outside the test, A inside it, B. */
function trafficRow(e) { const c = e.record.config, s = segShare(c.segment); return { name: c.name, out: 1 - s, a: s * (1 - c.share_b), b: s * c.share_b, seg: c.segment, e }; }
function trafficMap(list) {
  if (!list.length) return `<div class="empty">No test is running, so all traffic hears today's prompt.</div>`;
  const bar = r => { const seg = (cls, w, label) => `<span class="tm ${cls}" style="flex:${Math.max(w, 0.0001)}" title="${esc(label)}: ${pct(w, 1)}">${w >= 0.11 ? `${esc(label)} ${pct(w, 0)}` : ""}</span>`;
    return `<div class="tmrow"><div class="tmname"><a href="#/live/${encodeURIComponent(r.e.id)}">${esc(r.name)}</a> ${segChips(r.seg)}</div><div class="tmap" role="img" aria-label="${esc(r.name)}: ${pct(r.out, 0)} outside the test, ${pct(r.a, 0)} A, ${pct(r.b, 0)} B">${seg("out", r.out, "outside")}${seg("a", r.a, "A")}${seg("b", r.b, "B")}</div></div>`; };
  const main = list.filter(r => r.e.world === "main"), clash = main.flatMap((x, i) => main.slice(i + 1).filter(y => segsOverlap(x.seg || {}, y.seg || {})).map(y => [x, y]));
  return `<div class="legend" style="margin-bottom:8px"><span><i class="sw out"></i>outside the test (today's prompt)</span><span><i class="sw a"></i>A inside the test</span><span><i class="sw b"></i>B inside the test</span></div>${list.map(bar).join("")}
    ${clash.length ? `<div class="banner neg" style="margin-top:12px"><div><b>Overlap.</b> ${clash.map(([x, y]) => `${esc(x.name)} and ${esc(y.name)}`).join("; ")} include some of the same leads, so their results interfere. Finish one first.</div></div>` : `<p class="note" style="margin-top:8px">Each test replays the same history on its own, so each bar shows how that test splits its own traffic. Launches from New Experiment are checked for overlap: two tests may not include the same leads at once.</p>`}`;
}

function runningCard(e) {
  const v = view(e), c = v.config, pctDone = Math.min(100, v.day / v.win * 100), need = needLeads(e), have = v.cur ? v.cur.n : 0;
  const harm = v.cur ? (v.cur.decision === "STOP_HARM" ? ["Harm alert", "neg"] : v.cur.z <= -1.96 ? ["Watch: B looks worse", "warn"] : ["No harm signal", "pos"]) : ["No results yet", "plain"];
  return `<div class="card" style="display:grid;gap:12px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><h3><a href="#/live/${encodeURIComponent(e.id)}">${esc(c.name)}</a></h3><div class="note">${esc(e.kind === "files" ? "Results files" : e.preset || "Simulated")} · started ${fdate(e.sched_date || c.start)}</div><div style="margin-top:4px">${segChips(c.segment)}</div></div>${statusPill(v)}</div>
    <div><div style="display:flex;justify-content:space-between;font-size:13px"><span>Day <b>${v.day}</b> of ${v.win}</span><span class="muted">${nf(have)} of ${nf(need)} leads needed</span></div><div class="bar" style="margin-top:4px" title="Leads collected against leads needed"><i style="width:${Math.min(100, have / need * 100)}%"></i></div><div class="bar" style="margin-top:4px;height:4px" title="Days: ${v.day} of ${v.win}"><i style="width:${pctDone}%;background:var(--off)"></i></div></div>
    <div class="kpi" title="Interim lift of B over A. Grey until the final call: a person should not act on it."><div class="k">Current lift of B over A <span class="note">(interim, not a decision)</span></div><div class="v" style="font-size:26px;color:var(--off)">${esc(liftParts(v)[0])}</div><div class="d">${esc(liftParts(v)[1])}</div></div>
    <div>${pill(harm[0], harm[1])}</div>
    <div class="actions"><a class="btn sm" href="#/live/${encodeURIComponent(e.id)}">Open</a>${v.running ? `<button class="btn sm" data-adv="${esc(e.id)}">Advance 1 day (demo)</button>` : ""}${v.kind === "HOLD_FOR_APPROVAL" && !v.d.approval ? `<a class="btn sm primary" href="#/live/${encodeURIComponent(e.id)}">Decide</a>` : ""}${v.scheduled ? `<a class="btn sm primary" href="#/live/${encodeURIComponent(e.id)}">Scheduled</a>` : ""}</div></div>`;
}

function attention() {
  const items = [], L = (e, txt) => `<a href="#/live/${encodeURIComponent(e.id)}">${esc(e.record.config.name)}</a> ${txt}`;
  EXPS().filter(isDemoWorld).forEach(e => { const v = view(e);
    if (v.kind === "HOLD_FOR_APPROVAL" && !v.d.approval) items.push(["Approval pending", "warn", L(e, "won on the goal but needs a person to approve or reject it.")]);
    else if (["STOP_HARM", "STOP_GUARDRAIL"].includes(v.kind)) items.push(["Harm alert", "neg", L(e, "was stopped: " + (v.kind === "STOP_HARM" ? "B was clearly worse." : "a guardrail was broken.") + " Its leads are back on A.")]);
    else if (v.kind === "HALT_SRM") items.push(["Split alert", "neg", L(e, "was halted: the split or the log is broken, so nothing can be trusted.")]);
    else if (v.running && v.day >= v.win - 1 && v.day < v.win) items.push(["Ending soon", "run", L(e, `reaches its final call on day ${v.win} (now day ${v.day}).`)]);
    else if (v.running && v.cur && v.cur.z <= -1.96) items.push(["Watch", "warn", L(e, "looks worse so far. It stops only if it crosses the strict daily harm bar.")]);
    if (v.holdback && !v.holdback.done) items.push(["Holdback", "run", L(e, `is promoted; ${pct(v.holdback.all.share, 0)} of leads stay on A: day ${v.holdback.day} of ${v.holdback.all.days}.`)]);
  });
  DYN.drafts.forEach(d => items.push(["Draft", "plain", `<a href="#/new" data-open-draft="${esc(d.id)}">${esc(d.name)}</a> was saved but not launched.`]));
  return items;
}

ROUTES.overview = (el) => {
  const t = totals(), prod = productionState(), ev = allEvents().filter(x => x.type !== "Started" && x.id && byId(x.id) && !isPast(byId(x.id))).slice(0, 5), pr = C.proof, impact = businessImpact(), att = attention(), nPast = EXPS().filter(isPast).length;
  const live = EXPS().filter(e => { const v = view(e); return v.running || v.scheduled || v.d.paused && !v.ended || (v.kind === "HOLD_FOR_APPROVAL" && !v.d.approval); });
  const mapList = EXPS().filter(e => { const v = view(e); return !isPast(e) && (v.running || v.d.paused && !v.ended) && !v.scheduled; }).map(trafficRow);
  const sugg = (C.suggestions || []).filter(c => !c.disabled && !c.from_history && c.expected_pp).sort((a, b) => priority(b).score - priority(a).score)[0];
  const scoreN = t.win + t.stop + t.inc + t.halted + t.held, nSched = live.filter(e => view(e).scheduled).length;
  el.innerHTML = head("Overview", "Tests that are running, the prompt that is live, what needs attention, and how the tests have gone so far.",
    `<button class="btn" id="adv-all">Advance all running tests 1 day (demo)</button><a class="btn" href="#/import">Import results files</a><a class="btn primary" href="#/new">New experiment</a>`) +
    `<div class="grid g4" style="margin-bottom:16px">
      <div class="card kpi"><div class="k">Running tests</div><div class="v">${t.running}</div><div class="d">${nSched ? nSched + " scheduled" : "replaying historical calls"}</div></div>
      <div class="card kpi"><div class="k">Waiting for approval</div><div class="v">${t.held}</div><div class="d">${t.held ? "a person decides" : "nothing is waiting"}</div></div>
      <div class="card kpi"><div class="k">Harm alerts</div><div class="v" style="${t.alerts ? "color:#b23b3b" : ""}">${t.alerts}</div><div class="d">stopped for harm, or a broken split</div></div>
      <div class="card kpi"><div class="k">Completed this month</div><div class="v">${t.month}</div><div class="d">October, played in this demo</div></div></div>
    <div class="grid g2" style="margin-bottom:16px">
      <div class="card"><h2>Business impact</h2><div class="sub">What the live prompt gained in the test that promoted it.</div>${impact ? `<div class="kpi" style="margin-top:12px"><div class="v" style="color:${impact.rel > 0 ? "#167a70" : "var(--navy)"}">${sgn(impact.rel * 100, 1)}%</div><div class="d">${esc(impact.goal)}${impact.lower ? " (lower is better)" : ""}, measured in <a href="#/report/${encodeURIComponent(impact.id)}">${esc(impact.name)}</a> since ${esc(fdate(impact.since))}; at least <b>${sgn(impact.low * 100, 0)}%</b> at the low end of the 95% range</div></div><p class="note" style="margin-top:8px">Simulated, with a known injected effect; the lifts of winners tend to run high. Gains of different tests are not added: each test compared its B with the base prompt.</p>` : `<div class="empty" style="margin-top:12px">No change has been promoted yet in this demo. Play a winning test to its last day.</div>`}</div>
      <div class="card"><h2>Live prompt</h2><div class="sub">The version that serves callers right now.</div>
        <dl class="kv" style="margin-top:12px"><dt>Live version</dt><dd><b>${esc(prod.live.id)}</b> ${pill(prod.live.id === "v1" ? "as received" : "promoted in this demo", prod.live.id === "v1" ? "plain" : "pos")}</dd><dt>Name</dt><dd>${esc(prod.live.name)}</dd><dt>Live since</dt><dd>${prod.live.time ? esc(fdt(prod.live.time)) : "the start (the real VANI prompt)"}</dd><dt>Promoted by</dt><dd>${prod.live.expId ? `<a href="#/report/${encodeURIComponent(prod.live.expId)}">${esc(prod.live.from)}</a>` : "-"}</dd>${prod.live.expView && prod.live.expView.cur ? `<dt>Its rate in the test</dt><dd>${pct(prod.live.expView.cur.rateB, 1)} against ${pct(prod.live.expView.cur.rateA, 1)} for A</dd>` : ""}<dt>Fingerprint</dt><dd class="mono">${esc(prod.live.hash)}</dd></dl>
        <div class="actions" style="margin-top:12px"><a class="btn sm" href="#/library">Open Prompt Library</a></div></div></div>
    <div class="card" style="margin-bottom:16px"><h2>Needs attention</h2><div class="sub">Approvals, harm and split alerts, tests about to end, holdbacks, and drafts not launched.</div>${att.length ? `<div style="display:grid;gap:8px;margin-top:12px">${att.map(([k, c, txt]) => `<div style="display:flex;gap:12px;align-items:baseline"><span style="min-width:120px">${pill(k, c)}</span><span>${txt}</span></div>`).join("")}</div>` : `<div class="empty" style="margin-top:12px">Nothing needs attention.</div>`}</div>
    <h2 style="font-size:16px;font-weight:600;color:var(--navy);margin:24px 0 12px">Running tests</h2>
    ${live.length ? `<div class="grid g3">${live.map(runningCard).join("")}</div>` : `<div class="empty">No tests are running. <a href="#/new">Start a new experiment</a> or pick an idea from <a href="#/suggest">Suggest A/B Tests</a>.</div>`}
    <div class="card" style="margin-top:16px"><h2>Traffic map</h2><div class="sub">How today's traffic splits: outside the test, A and B inside it, for each running test.</div><div style="margin-top:12px">${trafficMap(mapList)}</div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>Recent decisions</h2><div class="sub">The last five events from the Decision Log.</div>
        ${ev.length ? `<div class="ledger" style="margin-top:8px">${ev.map(x => `<div class="e"><span class="note">${esc(fdt(x.ts))}</span><span><b>${esc(x.type)}</b> · ${esc(x.exp)}<br><span class="muted">${esc(x.text.length > 160 ? x.text.slice(0, 157) + "..." : x.text)}</span></span></div>`).join("")}</div>` : `<div class="empty" style="margin-top:12px">No decisions yet in this demo. Advance a running test to its last day. The Decision Log also holds the history samples.</div>`}
        <div class="actions" style="margin-top:12px"><a class="btn sm" href="#/log">Open Decision Log</a></div></div>
      <div class="card"><h2>Scorecard</h2><div class="sub">Out of ${scoreN} finished or decided tests (${nPast} are history samples): won, stopped, inconclusive.</div>
        <div class="grid g3" style="margin-top:12px"><div class="kpi"><div class="k">Won</div><div class="v">${t.win}</div><div class="d"><span class="delta up">▲</span> shipped</div></div><div class="kpi"><div class="k">Stopped</div><div class="v">${t.stop}</div><div class="d"><span class="delta down">▼</span> worse or unsafe</div></div><div class="kpi"><div class="k">Inconclusive</div><div class="v">${t.inc}</div><div class="d">no evidence${t.halted ? `; ${t.halted} halted` : ""}${t.held ? `; ${t.held} held` : ""}</div></div></div>
        <p class="note" style="margin-top:8px">Only tests played in this demo change the live prompt.</p></div></div>
    ${sugg ? `<div class="card" style="margin-top:16px"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center"><div style="max-width:760px"><h2>Top suggestion</h2><div class="sub"><b>${esc(sugg.title)}</b>: ${esc(sugg.hypothesis.length > 200 ? sugg.hypothesis.slice(0, 197) + "..." : sugg.hypothesis)}</div></div><div class="actions"><button class="btn primary" id="top-create">Create experiment</button><a class="btn" href="#/suggest">All ideas</a></div></div></div>` : ""}
    ${pr ? `<div class="card" style="margin-top:16px"><h2>A vs A check: how often is a winner wrongly declared?</h2><div class="sub">The strongest proof the statistics are sound. When A and an identical copy are compared, the right answer is always "no winner".</div>
      <div class="grid g3" style="margin-top:16px"><div class="kpi"><div class="k">Promoted although A = B</div><div class="v">${pct(pr.final_look, 1)}</div><div class="d">of ${nf(pr.runs)} engine runs; 95% range ${pct(pr.final_look_ci[0], 1)} to ${pct(pr.final_look_ci[1], 1)}; the target is 2.5% (one side of a 95% test)</div></div>
      <div class="kpi"><div class="k">Looks different either way</div><div class="v">${pr.either != null ? pct(pr.either, 1) : "-"}</div><div class="d">promoted or logged as a loss: this is the BRD's "about 5%"; a loss ships nothing</div></div>
      <div class="kpi"><div class="k">A plain p &lt; 0.05 check every day</div><div class="v">${pct(pr.naive, 1)}</div><div class="d">false winners; ${pct(pr.naive_wrong, 0)} counting false stops too</div></div></div>
      <div class="actions" style="margin-top:16px"><button class="btn primary" id="aa-run">Run 1,000 A vs A tests now</button><span class="note">in this browser, seeded, about a second; the same rules as the engine, without the call-length guardrail</span></div><div id="aa-out" style="margin-top:12px"></div>
      <div class="note" style="margin-top:8px">Simulated, with a known answer. The engine's own study: <span class="mono">python -m canary proof</span>.</div></div>` : ""}`;
  $("#adv-all").onclick = advanceAll;
  $$("[data-adv]", el).forEach(b => b.onclick = () => { const e = byId(b.dataset.adv); if (advance(e)) route(); });
  $$("[data-open-draft]", el).forEach(a => a.onclick = () => { const d = DYN.drafts.find(x => x.id === a.dataset.openDraft); if (d) WZ = { ...wzDefaults(), ...JSON.parse(JSON.stringify(d.w)) }; });
  const tc = $("#top-create"); if (tc) tc.onclick = () => createFrom(sugg);
  const ar = $("#aa-run"); if (ar) ar.onclick = () => { ar.disabled = true; ar.textContent = "Running..."; setTimeout(() => { $("#aa-out").innerHTML = aaResult(runAA(1000, Date.now() % 100000)); ar.disabled = false; ar.textContent = "Run 1,000 A vs A tests again"; }, 30); };
};

/* ---- A vs A in the browser: the one-look rule on identical prompts, a thousand times. */
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function runAA(runs, seed) {
  const s = SET(), rnd = mulberry32(seed), p = s.baseline, days = s.window_days, per = s.leads_per_day, nb = Math.round(per * s.share_b), na = per - nb, minArm = s.min_leads_per_arm, alpha = (1 - s.confidence) / 2, z95 = normPpf(1 - alpha), zh = normPpf(1 - (1 - s.harm_bar));
  const out = { runs, promote: 0, loss: 0, early: 0, naive: 0, days, per, share: s.share_b, seed };
  const z = (xa, na_, xb, nb_) => { const q = (xa + xb) / (na_ + nb_), v = q * (1 - q) * (1 / na_ + 1 / nb_); return v > 0 ? (xb / nb_ - xa / na_) / Math.sqrt(v) : 0; };
  for (let r = 0; r < runs; r++) {
    let NA = 0, XA = 0, NB = 0, XB = 0, naiveHit = false;
    for (let d = 1; d <= days; d++) {
      for (let i = 0; i < na; i++) if (rnd() < p) XA++;
      for (let i = 0; i < nb; i++) if (rnd() < p) XB++;
      NA += na; NB += nb;
      const zz = z(XA, NA, XB, NB); if (NA >= 50 && NB >= 50 && zz >= 1.96) naiveHit = true;
      if (d < days) { if (NA >= minArm && NB >= minArm && zz <= -zh) { out.early++; break; } }
      else if (zz >= z95) out.promote++; else if (zz <= -z95) out.loss++;
    }
    if (naiveHit) out.naive++;
  }
  return out;
}
function aaResult(o) {
  const row = (label, k, note) => { const ci = wilson(k, o.runs); return `<tr><td>${label}</td><td class="num"><b>${pct(k / o.runs, 1)}</b></td><td class="num">${k} of ${nf(o.runs)}</td><td class="num">${pct(ci[0], 1)} to ${pct(ci[1], 1)}</td><td class="muted">${note}</td></tr>`; };
  return `<div class="tbl-wrap"><table><thead><tr><th>Outcome when A = B (${o.days} days, ${nf(o.per)} leads a day, ${pct(o.share, 0)} to B)</th><th class="num">Rate</th><th class="num">Runs</th><th class="num">95% range</th><th>Expected</th></tr></thead><tbody>
    ${row("Wrongly promoted (a false winner)", o.promote, "about 2.5%")}${row("Logged as a loss (nothing ships)", o.loss, "about 2.5%")}${row("Looks different either way", o.promote + o.loss, "about 5%: the BRD's figure")}${row("Stopped early by the daily harm check", o.early, `at most ${((o.days - 1) * 0.1).toFixed(1)}% over ${o.days - 1} daily checks (0.1% each)`)}${row("A plain p < 0.05 check every day would crown a winner", o.naive, "the peeking trap we avoid")}</tbody></table></div><p class="note" style="margin-top:4px">Seed ${o.seed}. Different seeds give slightly different numbers: that is chance, and the 95% ranges show how much.</p>`;
}
