/* History: every finished test with its frozen report. Report: the one-page final report for a test. */

const HFILT = DYN.ui.hist || { q: "", dec: "all", metric: "all", seg: "all", sort: "start", dir: -1, page: 0 };
const PAGE = 8;
function guardWord(v) { const g = guardOverall(v); return [g.short, g.cls]; }
const DEC_GROUP = { PROMOTE: "promoted", ROLLED_BACK: "promoted", STOP_HARM: "stopped", LOSS: "stopped", STOP_GUARDRAIL: "stopped", STOPPED_MANUAL: "stopped", INCONCLUSIVE: "inconclusive", REJECTED: "inconclusive", HOLD_FOR_APPROVAL: "held", HALT_SRM: "halted" };
function histRows() {
  return EXPS().map(e => ({ e, v: view(e) })).filter(({ v }) => v.ended).filter(({ e, v }) => {
    const q = HFILT.q.trim().toLowerCase();
    if (q && !(e.record.config.name + " " + (e.hypothesis || "") + " " + (dyn(e).learning || "") + " " + (e.preset || "")).toLowerCase().includes(q)) return false;
    if (HFILT.dec !== "all" && DEC_GROUP[v.kind] !== HFILT.dec) return false;
    if (HFILT.metric !== "all" && e.record.config.primary_goal !== HFILT.metric) return false;
    if (HFILT.seg !== "all" && segDescribe(e.record.config.segment) !== HFILT.seg) return false;
    return true;
  });
}
/** Prompt A and prompt B of a test in full, where they are known (a results file carries no prompts). */
function promptsOf(e) {
  if (e.kind === "files") return null;
  const c = e.record.config, base = C.library.base_text || "";
  const a = e.prompt_a && e.prompt_a.hash && e.prompt_a.hash !== C.library.base.hash ? versionText(productionState().versions.find(x => x.hash === e.prompt_a.hash)) : base;
  let b = e.prompt_b || null;
  if (!b && (C.library.edits || {})[c.variant_b]) { try { b = applyEdits(base, C.library.edits[c.variant_b]); } catch (err) { b = null; } }
  return b ? { a, b, aId: (e.prompt_a && e.prompt_a.id) || "v1" } : null;
}
function cloneOf(e) {
  const c = e.record.config, seg = segList(segOf(e)), pr = promptsOf(e), ms = c.metrics || [];
  const prim = ms.find(x => x.role === "primary"), keep = d => d && !metricByKey(d.key) ? [d] : [];
  startWizard({ name: c.name + " (re-run)", change: e.hypothesis || "", promptB: pr ? pr.b : null, segRows: seg.map(r => ({ column: r.column, values: r.values.slice() })), audienceSet: true,
    primary: prim ? prim.def.key : (C.metrics.some(m => m.key === c.primary_goal) ? c.primary_goal : null),
    guards: ms.length ? ms.filter(x => x.role === "guardrail").map(x => ({ key: x.def.key, direction: x.def.direction, limit: { ...x.limit } })) : (c.secondary_role === "guardrail" ? [{ key: "duration_s", direction: "lower", limit: { value: Math.round(c.guardrail_margin * 100), kind: "rel" } }] : []).concat(c.guard_rate === "early_hangup" ? [{ key: "early_hangup", direction: "lower", limit: { value: Math.round(c.guard_rate_margin * 100), kind: "pts" } }] : []),
    secondary: ms.filter(x => x.role === "secondary").map(x => ({ key: x.def.key, direction: x.def.direction })), localMetrics: ms.flatMap(x => keep(x.def)),
    share: Math.min(0.5, c.share_b), shareTouched: true, lenMode: [7, 14, 21, 28].includes(c.window_days) ? "custom" : "rec", customDays: [7, 14, 21, 28].includes(c.window_days) ? c.window_days : null, rule: c.rule_set, confidence: 1 - 2 * c.alpha,
    approval: c.approval, harm: Math.round((1 - c.alpha_harm_daily) * 1000) / 1000, minLeads: c.min_per_arm, assignment: c.assignment || "stratified", step: 1,
    preset: e.truth && e.truth.effect_rel != null ? (e.truth.effect_rel > 0 ? "win" : e.truth.effect_rel < 0 ? "worse" : "flat") : "win" });
}

ROUTES.history = (el) => {
  const all = histRows(), key = { start: x => x.e.record.config.start, lift: x => x.v.cur ? x.v.cur.diff : 0, name: x => x.e.record.config.name, dec: x => x.v.kind };
  all.sort((a, b) => { const A = key[HFILT.sort](a), B = key[HFILT.sort](b); return (A < B ? -1 : A > B ? 1 : 0) * HFILT.dir; });
  const pages = Math.max(1, Math.ceil(all.length / PAGE)); HFILT.page = Math.min(HFILT.page, pages - 1);
  const rows = all.slice(HFILT.page * PAGE, HFILT.page * PAGE + PAGE), metrics = [...new Set(EXPS().map(e => e.record.config.primary_goal))];
  const th = (k, label, cls = "") => `<th class="${cls}" aria-sort="${HFILT.sort === k ? (HFILT.dir > 0 ? "ascending" : "descending") : "none"}"><button data-sort="${k}">${label}${HFILT.sort === k ? (HFILT.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`;
  el.innerHTML = head("History", "Every finished test with its frozen report. Nothing can be edited after a test ends.", `<button class="btn" id="h-csv">Export CSV</button>`) +
    `<div class="filters"><div class="field grow"><label for="h-q">Search</label><input type="search" id="h-q" value="${esc(HFILT.q)}" placeholder="Name, change or learning"></div>
      <div class="field"><label for="h-dec">Decision</label><select id="h-dec">${[["all", "All decisions"], ["promoted", "Promoted"], ["stopped", "Stopped"], ["inconclusive", "Inconclusive"], ["held", "Held for approval"], ["halted", "Halted (broken test)"]].map(([k, n]) => `<option value="${k}" ${HFILT.dec === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="field"><label for="h-met">Metric</label><select id="h-met"><option value="all">All metrics</option>${metrics.map(m => `<option value="${esc(m)}" ${HFILT.metric === m ? "selected" : ""}>${esc(goalName(EXPS().find(e => e.record.config.primary_goal === m).record.config))}</option>`).join("")}</select></div>
      <div class="field"><label for="h-seg">Segment</label><select id="h-seg"><option value="all">All segments</option>${[...new Set(EXPS().map(e => segDescribe(e.record.config.segment)))].map(x => `<option value="${esc(x)}" ${HFILT.seg === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div></div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr>${th("name", "Test")}${th("start", "Dates")}<th>The change</th>${th("lift", "Primary lift (range)", "num")}${th("dec", "Decision")}<th>Guardrail</th><th>Learning</th><th></th></tr></thead><tbody>${rows.map(({ e, v }) => { const c = v.config, g = guardWord(v), cur = v.cur, lr = cur && liftRange(cur, c);
      return `<tr class="click" data-rep="${esc(e.id)}"><td><b><a href="#/report/${encodeURIComponent(e.id)}">${esc(c.name)}</a></b><div style="margin-top:2px">${segChips(c.segment)}</div><div class="note">${esc(e.kind === "files" ? "Results files" : "Simulated")}${e.preset && e.kind !== "files" ? " · " + esc(e.preset) : ""}</div></td><td style="white-space:nowrap">${fdate(c.start)}<div class="note">${v.ld} day${v.ld === 1 ? "" : "s"}</div></td>
        <td style="max-width:260px"><span class="muted">${esc(e.kind === "files" ? "Results from " + ((e.record.source && e.record.source.files) || []).join(", ") : ((e.record.variants.B || {}).name) || "")}</span></td><td class="num">${cur ? `<b>${fmtD(cur.diff, c)}</b><div class="note">${c.metrics ? rangeD(lr.lo, lr.hi, c) : `${sgn(lr.lo * 100, 1)} to ${sgn(lr.hi * 100, 1)}`}${lr.interim ? " (interim)" : ""}</div>` : "-"}</td>
        <td>${pill(KIND_LABEL[v.kind] || v.kind, KIND_CLASS[v.kind])}</td><td>${pill(g[0], g[1])}</td><td class="note" style="max-width:160px">${esc(dyn(e).learning || "")}</td><td><button class="btn sm" data-clone="${esc(e.id)}">Clone</button></td></tr>`; }).join("")}</tbody></table></div>
      <div class="pager"><span>${all.length} test${all.length === 1 ? "" : "s"}${HFILT.q || HFILT.dec !== "all" || HFILT.metric !== "all" || HFILT.seg !== "all" ? " match" : ""}</span><span><button class="btn sm" id="h-prev" ${HFILT.page ? "" : "disabled"}>Previous</button> Page ${HFILT.page + 1} of ${pages} <button class="btn sm" id="h-next" ${HFILT.page < pages - 1 ? "" : "disabled"}>Next</button></span></div>`
      : `<div class="empty">No finished tests match. Clear the filters, or advance a running test to its last day.</div>`}`;
  const save = () => { DYN.ui.hist = HFILT; saveDyn(); };
  $("#h-q").oninput = ev => { HFILT.q = ev.target.value; HFILT.page = 0; save(); clearTimeout(window.__hq); window.__hq = setTimeout(() => { const pos = ev.target.selectionStart; route(); const n = $("#h-q"); n.focus(); n.setSelectionRange(pos, pos); }, 250); };
  $("#h-dec").onchange = ev => { HFILT.dec = ev.target.value; HFILT.page = 0; save(); route(); };
  $("#h-met").onchange = ev => { HFILT.metric = ev.target.value; HFILT.page = 0; save(); route(); };
  $("#h-seg").onchange = ev => { HFILT.seg = ev.target.value; HFILT.page = 0; save(); route(); };
  $$("[data-sort]", el).forEach(b => b.onclick = () => { const k = b.dataset.sort; HFILT.dir = HFILT.sort === k ? -HFILT.dir : (k === "name" ? 1 : -1); HFILT.sort = k; save(); route(); });
  $$("[data-clone]", el).forEach(b => b.onclick = ev => { ev.stopPropagation(); cloneOf(byId(b.dataset.clone)); });
  $$("tr[data-rep]", el).forEach(r => r.onclick = ev => { if (!ev.target.closest("a,button")) go("report", r.dataset.rep); });
  const pv = $("#h-prev"), nx = $("#h-next"); if (pv) pv.onclick = () => { HFILT.page--; save(); route(); }; if (nx) nx.onclick = () => { HFILT.page++; save(); route(); };
  const isAvg = v => primaryDef(v.config).type === "average";          // an average's lift is in its own unit, in the last two columns
  $("#h-csv").onclick = () => download("canary_history.csv", toCsv(["name", "segment", "start", "days", "source", "change", "lift_pp", "range_low_pp", "range_high_pp", "decision", "guardrail", "learning", "lift_average", "average_unit"], all.map(({ e, v }) => [v.config.name, segDescribe(v.config.segment), v.config.start.slice(0, 10), v.ld, e.kind, (e.record.variants.B || {}).name, v.cur && !isAvg(v) ? (v.cur.diff * 100).toFixed(2) : "", v.cur && !isAvg(v) ? (liftRange(v.cur, v.config).lo * 100).toFixed(2) : "", v.cur && !isAvg(v) ? (liftRange(v.cur, v.config).hi * 100).toFixed(2) : "", KIND_LABEL[v.kind] || v.kind, guardWord(v)[0], dyn(e).learning || "", v.cur && isAvg(v) ? v.cur.diff.toFixed(3) : "", isAvg(v) ? metricUnit(primaryDef(v.config)) : ""])));
};

ROUTES.report = (el, id) => {
  const e = byId(id); if (!e) { el.innerHTML = head("Report", "") + `<div class="empty">That test was not found. <a href="#/history">Back to History</a>.</div>`; return; }
  const v = view(e), c = v.config, rec = e.record, cur = v.cur;
  if (!v.ended || !cur) { el.innerHTML = head(c.name, "The final report is written when the test ends.") + `<div class="empty">This test has not ended yet (${esc(v.status[0])}). <a href="#/live/${encodeURIComponent(e.id)}">Open it in Live Experiments</a>.</div>`; return; }
  const ciA = armCI(cur, "A", c), ciB = armCI(cur, "B", c), lr = liftRange(cur, c), gl = guardList(v), goal = goalName(c), sec = secondaryList(v), pr = promptsOf(e), avg = primaryDef(c).type === "average";
  const tailK = v.d.approval === "approved" ? "approve" : v.d.approval === "rejected" ? "reject" : v.d.rolledBack ? "rollback" : null, ents = rec.ledger.concat(tailK && rec.tails ? rec.tails[tailK] || [] : []);
  const sugg = ["slot options work", "longer intro hurts", "small effect: needs more leads", "call length is the catch", "broken tracking: rerun"];
  el.innerHTML = head("Final report", "A frozen, one-page record of this test.", `<a class="btn" href="#/history">Back to History</a><button class="btn" id="r-clone">Clone and re-run</button><button class="btn" id="r-csv">Export CSV</button><button class="btn primary" onclick="print()">Print</button>`) +
    `<div class="report card"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><h2 style="margin:0;font-size:20px">${esc(c.name)}</h2>${pill(KIND_LABEL[v.kind] || v.kind, KIND_CLASS[v.kind])}</div>
      <p class="note">${fdate(c.start)} · ${v.ld} day${v.ld === 1 ? "" : "s"} · config v${c.version || 1} <span class="mono">${esc(rec.config_hash)}</span> · ${esc(e.kind === "files" ? "results supplied as files" : "simulated results")}</p>
      ${e.hypothesis ? `<p>${esc(e.hypothesis)}</p>` : ""}
      <h2>Decision</h2><p>${esc(v.kind === "STOPPED_MANUAL" ? "A person stopped the test early." : v.res.reason)}${v.d.approval ? ` A person ${v.d.approval} it.` : ""}${v.d.rolledBack ? " It was then rolled back by a person." : ""}</p>
      <h2>In plain words</h2><p>${esc(plainSummary(e))}</p>
      <h2>The numbers</h2><div class="tbl-wrap"><table><thead><tr><th></th><th class="num">Leads</th>${cur.dA != null ? `<th class="num">${avg ? "Counted" : "In the denominator"}</th>` : ""}${avg ? "" : `<th class="num">Goal reached</th>`}<th class="num">${avg ? "Average" : "Rate"}</th><th class="num">95% range</th></tr></thead><tbody>
        <tr><td><span class="dot a"></span>A: today's prompt</td><td class="num">${nf(cur.nA)}</td>${cur.dA != null ? `<td class="num">${nf(cur.dA)}</td>` : ""}${avg ? "" : `<td class="num">${nf(cur.xA)}</td>`}<td class="num">${fmtP(cur.rateA, c)}</td><td class="num">${fmtP(ciA[0], c)} to ${fmtP(ciA[1], c)}</td></tr>
        <tr><td><span class="dot b"></span>B: new prompt</td><td class="num">${nf(cur.nB)}</td>${cur.dB != null ? `<td class="num">${nf(cur.dB)}</td>` : ""}${avg ? "" : `<td class="num">${nf(cur.xB)}</td>`}<td class="num">${fmtP(cur.rateB, c)}</td><td class="num">${fmtP(ciB[0], c)} to ${fmtP(ciB[1], c)}</td></tr>
        <tr><td><b>Lift of B over A</b></td><td></td>${cur.dA != null ? "<td></td>" : ""}${avg ? "" : "<td></td>"}<td class="num"><b>${fmtD(cur.diff, c)}</b></td><td class="num">${rangeD(lr.lo, lr.hi, c)}${lr.interim ? "<div class=\"note\">interim: the test stopped before its final call</div>" : ""}</td></tr></tbody></table></div>
      <h2>Metrics</h2><div style="display:grid;gap:4px">${metricsSummaryHtml(c)}</div>
      ${sec.length ? `<h2>Secondary (for insight only, not used for the decision)</h2>${secondaryHtml(v)}` : ""}
      <h2>Audience</h2><p>${esc(segDescribe(c.segment))}${rec.result.segment_check ? ` · ${pct(rec.result.segment_check.share_of_traffic, 0)} of traffic, about ${c.metrics ? nf(rec.result.segment_check.eligible_per_day * connectShare()) + " connected" : nf(rec.result.segment_check.eligible_per_day)} leads a day · <b>${esc(segMatchLine(rec))}</b>; ${nf(rec.result.segment_check.out_of_segment_leads)} out-of-segment leads kept today's prompt and were not counted` : ""}</p>
      <h2>Prompt B</h2>${pr ? `<p class="note">${esc((e.record.variants.B || {}).name || "")} against ${esc(pr.aId)} · fingerprint <span class="mono">${esc((e.record.variants.B || {}).hash || "")}</span></p>${diffBlock(pr.a, pr.b)}<details style="margin-top:8px"><summary style="cursor:pointer;font-weight:500">Show the full prompt B</summary><textarea readonly class="prompt-box" rows="14" style="margin-top:8px" aria-label="Prompt B (read-only)">${esc(pr.b)}</textarea></details>` : `<p class="note">${e.kind === "files" ? "The prompts are not part of a results file." : "The full text of this prompt B is not in this browser."}</p>`}
      ${cur.mix ? `<h2>Achieved lead mix</h2><div class="note" style="margin-bottom:8px">A and B should carry the same mix of lead types. Per-group results are for insight only, never for the decision.</div>${balanceHtml(cur)}` : ""}
      <h2>Safety checks</h2><div style="display:grid;gap:8px">${gl.map(x => `<div class="check ${x.st.cls === "pos" ? "ok" : x.st.cls === "neg" ? "bad" : "wait"}"><span class="ico">${x.st.cls === "pos" ? "\u2713" : x.st.cls === "neg" ? "\u2715" : "\u2026"}</span><span><b>${esc(x.name)}${x.def ? " (guardrail)" : ""}:</b> ${x.g ? esc(x.st.value) + " (limit " + esc(x.st.lim) + "; " + x.conf + "% range " + esc(x.st.range) + ")" : "not enough data"}: ${esc(x.st.label.replace(/^[\u2713\u2715\u2026]\s*/, ""))}</span></div>`).join("")}
        <div class="check ${cur.p_srm < 0.001 ? "bad" : "ok"}"><span class="ico">${cur.p_srm < 0.001 ? "\u2715" : "\u2713"}</span><span><b>Split:</b> B received ${pct(cur.nB / cur.n, 1)} of leads (configured ${pct(c.share_b, 0)}); sample-ratio p = ${cur.p_srm < 0.001 ? cur.p_srm.toExponential(1) : cur.p_srm.toFixed(2)}</span></div>
        <div class="check ${(rec.result.stickiness || {}).arm_changes ? "bad" : "ok"}"><span class="ico">${(rec.result.stickiness || {}).arm_changes ? "\u2715" : "\u2713"}</span><span><b>Sticky assignment:</b> ${(rec.result.stickiness || {}).checkable === false ? "not checkable from this source" : nf((rec.result.stickiness || {}).arm_changes) + " leads saw both prompts"}</span></div></div>
      <h2>Over time</h2><div class="legend"><span><i style="border-color:var(--a)"></i>A</span><span><i style="border-color:var(--b)"></i>B</span><span><i class="band" style="background:var(--ink-2)"></i>95% range</span></div><div id="trend"></div>
      ${v.kind === "INCONCLUSIVE" && v.res.more_leads ? `<h2>What would settle it</h2><ul>${v.res.more_leads.options.map(o => `<li>${o.enough_already ? `Already enough data to detect ${esc(liftWords(o))} (${esc(o.label)}): any real lift is smaller than that.` : `${nf(o.more_leads)} more leads (about ${o.more_days} days) to detect ${esc(liftWords(o))} (${esc(o.label)}).${o.impractical ? " Over a year of traffic: not practical." : ""}`}</li>`).join("")}</ul>` : ""}
      <h2>Learning</h2><div class="field"><label for="r-learn">One line that feeds the next suggestions</label><input type="text" id="r-learn" list="r-sugg" value="${esc(dyn(e).learning || "")}" placeholder="for example: slot options work"><datalist id="r-sugg">${sugg.map(s => `<option value="${esc(s)}">`).join("")}</datalist></div>
      <h2>Record</h2><p class="note">${ents.length} entries, head <span class="mono">${esc(ents[ents.length - 1].hash.slice(0, 16))}</span> <button class="link" id="r-ver">Re-check in this browser</button> <span id="r-vo"></span></p>
      <p class="note">${e.kind === "files" ? "These results were supplied as files; Canary advises and does not control live traffic." : "The outcomes are simulated with a known injected effect: this report shows the engine decides correctly, not that a real prompt is better."}</p></div>`;
  trendChart($("#trend"), dayRows(rec), v.win, { finalDay: c.rule_set === "final_look" ? v.win : null, c });
  $("#r-clone").onclick = () => cloneOf(e);
  $("#r-csv").onclick = () => download(`${e.id}_report.csv`, avg ? toCsv(["day", "leads_A", "counted_A", "leads_B", "counted_B", "mean_A", "mean_B", "lift_" + (metricUnit(primaryDef(c)) || "units")], dayRows(rec).map(({ day, row }) => [day, row.nA, row.dA, row.nB, row.dB, row.rateA.toFixed(3), row.rateB.toFixed(3), row.diff.toFixed(3)]))
    : toCsv(["day", "leads_A", "goal_A", "leads_B", "goal_B", "rate_A", "rate_B", "lift_pp"], dayRows(rec).map(({ day, row }) => [day, row.nA, row.xA, row.nB, row.xB, row.rateA.toFixed(4), row.rateB.toFixed(4), (row.diff * 100).toFixed(2)])));
  $("#r-learn").onchange = ev => { dyn(e).learning = ev.target.value.trim(); saveDyn(); toast("Learning saved."); };
  $("#r-ver").onclick = () => { $("#r-vo").innerHTML = chainOk(ents) ? `<b style="color:#167a70">✓ intact</b>` : `<b style="color:#b23b3b">✕ broken</b>`; };
};
