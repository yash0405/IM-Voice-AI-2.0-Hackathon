/* Prompt Library, Decision Log, Settings. */

DYN.libRolled = DYN.libRolled || [];
/** Production versions in the order they were promoted in this demo. v1 is the real prompt as received. */
function productionState() {
  const b = C.library.base, vers = [{ id: "v1", name: b.name, hash: b.hash, parent: null, from: "The real VANI buyer-side prompt, as received", time: null, by: "provided", diff: [], status: "previous" }];
  promotedExperiments().forEach(({ e, v, time }, i) => {
    const B = e.record.variants.B, id = "v" + (i + 2), by = v.res.kind === "PROMOTE" ? "automatically" : "approved by a person";
    const rolled = v.d.rolledBack || DYN.libRolled.includes(id);
    vers.push({ id, key: e.record.config.variant_b, name: B.name, hash: B.hash, parent: vers[vers.length - 1].id, from: e.record.config.name, expId: e.id, time, by, diff: B.diff || [], status: rolled ? "rolled back" : "previous", expView: v });
  });
  let live = vers[0]; for (const x of vers) if (x.status !== "rolled back") live = x;
  vers.forEach(x => { if (x.id === live.id) x.status = "live"; });
  return { versions: vers, live };
}

ROUTES.library = (el, arg) => {
  const P = productionState(), vers = P.versions.slice().reverse(), sel = P.versions.find(x => x.id === arg) || P.live, idx = P.versions.findIndex(x => x.id === sel.id), prev = idx > 0 ? P.versions[idx - 1] : null;
  const cands = C.library.candidates;
  let diffHtml = `<div class="empty">No changes to show.</div>`, diffNote = "What changed in this version, side by side.";
  if (prev) {
    const pd = prev.id !== "v1" && prev.key && sel.key ? (C.library.pair_diffs || {})[`${prev.key}>${sel.key}`] : null;
    if (prev.id === "v1") { if (sel.diff.length) diffHtml = diffSides(sel.diff); }
    else if (pd) { diffNote = `What changed between ${prev.id} and ${sel.id}, side by side.`; diffHtml = pd.length ? diffSides(pd) : `<div class="empty">The two versions are identical.</div>`; }
    else { diffNote = `A diff against ${prev.id} is not available for this version; this is its diff against the base prompt (v1).`; if (sel.diff.length) diffHtml = diffSides(sel.diff); }
  }
  el.innerHTML = head("Prompt Library", "Every prompt version, what is live, and one-click rollback.") +
    `<div class="banner"><div><b>Live now: ${esc(P.live.id)}</b> · ${esc(P.live.name)} <span class="mono">${esc(P.live.hash)}</span>. A production pointer says which version callers hear. Before each call the bot asks the router which prompt this lead gets, then loads that version.</div></div>
    <div class="tbl-wrap"><table><thead><tr><th>Version</th><th>Name</th><th>Fingerprint</th><th>From test</th><th>Promoted</th><th>Status</th><th></th></tr></thead><tbody>${vers.map(x => `<tr class="click" data-ver="${esc(x.id)}"><td><b>${esc(x.id)}</b></td><td>${esc(x.name)}</td><td class="mono">${esc(x.hash)}</td><td>${x.expId ? `<a href="#/report/${encodeURIComponent(x.expId)}">${esc(x.from)}</a>` : esc(x.from)}</td><td>${x.time ? esc(fdt(x.time)) + `<div class="note">${esc(x.by)}</div>` : "-"}</td>
      <td>${pill(x.status === "live" ? "✓ Live" : x.status === "rolled back" ? "Rolled back" : "Previous", x.status === "live" ? "pos" : x.status === "rolled back" ? "warn" : "plain")}</td><td>${x.status === "live" && x.id !== "v1" ? `<button class="btn sm danger" data-roll="${esc(x.id)}">Rollback</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
    <div class="card" style="margin-top:16px"><h2>${esc(sel.id)} against ${prev ? esc(prev.id) : "nothing (the first version)"}</h2><div class="sub">${!prev ? "This is the prompt as received. Later versions show what they changed." : diffNote}</div><div style="margin-top:12px">${diffHtml}</div></div>
    <h2 style="font-size:16px;font-weight:600;color:var(--navy);margin:24px 0 12px">Ready to test</h2><div class="grid g2">${cands.map(c => `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px"><h3>${esc(c.name)}</h3><span class="tag">${esc(c.origin)}</span></div><p class="sub">${c.variables.ok ? "✓ every template variable kept" : "✕ drops " + esc(c.variables.dropped.join(", "))}${c.lint_before != null ? ` · contradictions ${c.lint_before} → ${c.lint_after}` : ""} · fingerprint <span class="mono">${esc(c.hash)}</span></p><div class="actions" style="margin-top:12px"><button class="btn sm primary" data-test="${esc(c.key)}">Create experiment</button></div></div>`).join("")}</div>`;
  $$("tr[data-ver]", el).forEach(r => r.onclick = ev => { if (!ev.target.closest("a,button")) go("library", r.dataset.ver); });
  $$("[data-roll]", el).forEach(b => b.onclick = ev => { ev.stopPropagation(); const x = P.versions.find(q => q.id === b.dataset.roll); if (x.expView) { const dd = dyn(byId(x.expId)); dd.rolledBack = true; } else DYN.libRolled.push(x.id);
    const to = P.versions[P.versions.findIndex(q => q.id === x.id) - 1]; DYN.libLog.push({ ts: x.time || new Date().toISOString(), type: "Rolled back", text: `Rolled back ${x.id} (${x.hash.slice(0, 7)}) to ${to.id} (${to.hash.slice(0, 7)}) from the Prompt Library; callers hear ${to.id} again.`, exp: x.from }); saveDyn(); toast(`Rolled back to ${to.id}. Logged in the Decision Log.`); route(); });
  $$("[data-test]", el).forEach(b => b.onclick = () => { const c = cands.find(x => x.key === b.dataset.test); startWizard({ name: c.name, variant: c.key, change: c.name }); });
};

/* ------------------------------------------------------------------ Decision Log */
const LF = DYN.ui.log || { q: "", type: "all", exp: "all", page: 0 };
ROUTES.log = (el) => {
  const evs = allEvents().filter(x => (LF.type === "all" || x.type === LF.type) && (LF.exp === "all" || x.id === LF.exp) && (!LF.q || (x.text + x.exp + x.type).toLowerCase().includes(LF.q.toLowerCase())));
  const PG = 12, pages = Math.max(1, Math.ceil(evs.length / PG)); LF.page = Math.min(LF.page, pages - 1);
  const rows = evs.slice(LF.page * PG, LF.page * PG + PG), exps = EXPS().filter(e => eventsFor(e).length);
  el.innerHTML = head("Decision Log", "Every event with its time, reason and numbers: started, harm alert, stopped, promoted, approved, rolled back.", `<button class="btn" id="l-csv">Export CSV</button>`) +
    `<div class="filters"><div class="field grow"><label for="l-q">Search</label><input type="search" id="l-q" value="${esc(LF.q)}" placeholder="Reason, test or event"></div><div class="field"><label for="l-type">Event</label><select id="l-type"><option value="all">All events</option>${EV_TYPES.map(t => `<option ${LF.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="field"><label for="l-exp">Test</label><select id="l-exp"><option value="all">All tests</option>${exps.map(e => `<option value="${esc(e.id)}" ${LF.exp === e.id ? "selected" : ""}>${esc(e.record.config.name)}</option>`).join("")}</select></div></div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Time</th><th>Test</th><th>Event</th><th>Reason and numbers</th><th>Record</th></tr></thead><tbody>${rows.map(x => `<tr><td style="white-space:nowrap">${esc(fdt(x.ts))}</td><td>${x.id ? `<a href="#/${CUR.name === "log" ? "report" : "report"}/${encodeURIComponent(x.id)}">${esc(x.exp)}</a>` : esc(x.exp)}</td><td>${pill(x.type, { Started: "run", "Harm alert": "neg", Stopped: "neg", Promoted: "pos", Approved: "pos", Rejected: "plain", "Rolled back": "warn", Held: "warn", Inconclusive: "plain", Halted: "warn", Paused: "plain", Resumed: "run" }[x.type])}</td><td class="muted" style="max-width:520px">${esc(x.text)}</td><td class="mono">${x.hash ? esc(x.hash) : '<span class="note">console action</span>'}</td></tr>`).join("")}</tbody></table></div>
      <div class="pager"><span>${evs.length} event${evs.length === 1 ? "" : "s"}</span><span><button class="btn sm" id="l-prev" ${LF.page ? "" : "disabled"}>Previous</button> Page ${LF.page + 1} of ${pages} <button class="btn sm" id="l-next" ${LF.page < pages - 1 ? "" : "disabled"}>Next</button></span></div>` : `<div class="empty">No events match.</div>`}
    <p class="note">Events from the engine carry the first characters of their hash in the tamper-evident record. Pause, stop and library rollbacks are actions of this console and are labelled as such.</p>`;
  const save = () => { DYN.ui.log = LF; saveDyn(); };
  $("#l-q").oninput = ev => { LF.q = ev.target.value; LF.page = 0; save(); clearTimeout(window.__lq); window.__lq = setTimeout(() => { const p = ev.target.selectionStart; route(); const n = $("#l-q"); n.focus(); n.setSelectionRange(p, p); }, 250); };
  $("#l-type").onchange = ev => { LF.type = ev.target.value; LF.page = 0; save(); route(); }; $("#l-exp").onchange = ev => { LF.exp = ev.target.value; LF.page = 0; save(); route(); };
  const pv = $("#l-prev"), nx = $("#l-next"); if (pv) pv.onclick = () => { LF.page--; save(); route(); }; if (nx) nx.onclick = () => { LF.page++; save(); route(); };
  $("#l-csv").onclick = () => download("canary_decision_log.csv", toCsv(["time", "test", "event", "reason", "record_hash"], evs.map(x => [x.ts, x.exp, x.type, x.text, x.hash])));
};

/* ------------------------------------------------------------------ Settings */
ROUTES.settings = (el) => {
  const s = SET(), running = EXPS().filter(e => view(e).running);
  const f = (id, label, input, hint) => `<div class="field"><label for="${id}">${label}${hint ? ` <span class="hint">${hint}</span>` : ""}</label>${input}</div>`;
  el.innerHTML = head("Settings", "The metric list, the defaults new tests start from, and approval mode.") +
    `<div class="card" style="margin-bottom:16px"><h2>Metric list</h2><div class="sub">Name, which dispositions count, the denominator, and whether higher is better or it is a guardrail. Any disposition can be chosen as a goal.</div>
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Metric</th><th>Role</th><th>Which dispositions count</th><th>Denominator</th><th>Direction</th><th>Limit</th><th>Note</th></tr></thead><tbody>${C.metrics.map(m => `<tr><td><b>${esc(m.name)}</b><div class="mono muted">${esc(m.key)}</div></td><td>${pill(m.role === "goal" ? "Goal" : "Guardrail", m.role === "goal" ? "run" : "warn")}</td><td>${m.dispositions.length ? m.dispositions.map(d => `<span class="tag">${esc(d)}</span>`).join(" ") : '<span class="muted">computed</span>'}</td><td>${esc(m.denominator)}</td><td>${esc(m.direction)}</td><td>${esc(m.limit || "-")}</td><td class="muted" style="max-width:280px">${esc(m.note || "")}</td></tr>`).join("")}</tbody></table></div></div>
    <div class="grid g2"><div class="card"><h2>Defaults for new tests</h2><div class="sub">Used to fill in New Experiment. The four demo tests were set up with these defaults.</div><div class="form-grid" style="margin-top:16px">
        ${f("s-conf", "Confidence", `<select id="s-conf">${[0.9, 0.95, 0.99].map(x => `<option value="${x}" ${s.confidence === x ? "selected" : ""}>${x * 100}%</option>`).join("")}</select>`)}${f("s-harm", "Harm threshold", `<select id="s-harm">${[0.99, 0.995, 0.999].map(x => `<option value="${x}" ${s.harm_bar === x ? "selected" : ""}>${(x * 100).toFixed(1)}%</option>`).join("")}</select>`, "daily check")}
        ${f("s-min", "Minimum leads per arm", `<input type="number" id="s-min" value="${s.min_leads_per_arm}">`)}${f("s-days", "Test length (days)", `<input type="number" id="s-days" value="${s.window_days}">`)}${f("s-share", "Share to B (%)", `<input type="number" id="s-share" value="${Math.round(s.share_b * 100)}">`)}${f("s-dur", "Call-duration limit (%)", `<input type="number" id="s-dur" value="${Math.round(s.duration_margin * 100)}">`)}
        ${f("s-lpd", "Leads per day", `<input type="number" id="s-lpd" value="${s.leads_per_day}">`, "an assumption")}${f("s-appr", "Approval mode", `<select id="s-appr"><option value="auto" ${s.approval === "auto" ? "selected" : ""}>Automatic</option><option value="manual" ${s.approval === "manual" ? "selected" : ""}>Manual: a person approves every win</option></select>`, "both paths are logged")}</div>
        <p class="note" style="margin-top:12px">${esc(C.defaults.leads_per_day_note)}</p><div class="actions" style="margin-top:12px"><button class="btn primary" id="s-save">Save defaults</button></div></div>
      <div class="grid"><div class="card"><h2>Overlap warning</h2><div class="sub">When two running tests target the same leads, their results interfere.</div><div style="margin-top:12px">${running.length > 1 ? `<div class="banner warn" style="margin:0"><div><b>${running.length} tests are running on all leads.</b> They overlap: ${running.map(e => esc(e.record.config.name)).join("; ")}. Finish one before trusting the other, or give each a different segment (segments need per-call data we do not have).</div></div>` : `<div class="banner pos" style="margin:0"><div><b>No overlap.</b> ${running.length} test${running.length === 1 ? " is" : "s are"} running on all leads.</div></div>`}</div></div>
        <div class="card"><h2>Tools</h2><div class="sub">For engineers and for the optional extras.</div><div class="actions" style="margin-top:12px"><a class="btn" href="#/import">Import results files</a><a class="btn" href="${LIVE ? "/tools.html" : "canary_tools.html"}">Proof lab, label calls, hear it</a></div></div>
        <div class="card"><h2>This demo</h2><div class="sub">What is real and what is simulated.</div><ul style="margin:8px 0 0;padding-left:20px;font-size:13px"><li>The demo tests use <b>simulated</b> outcomes with a known injected effect.</li><li>Call lengths are resampled from 713 <b>real</b> recordings.</li><li>Leads per day is an <b>assumption</b> (no real volume was provided).</li><li>History holds re-runs of our scenarios and sample result files.</li><li>Days played, approvals and rollbacks live in this browser only.</li></ul><div class="actions" style="margin-top:12px"><button class="btn danger" id="s-reset">Reset the demo</button></div></div></div></div>`;
  $("#s-save").onclick = () => { DYN.settings = { confidence: +$("#s-conf").value, harm_bar: +$("#s-harm").value, min_leads_per_arm: +$("#s-min").value, window_days: +$("#s-days").value, share_b: +$("#s-share").value / 100, duration_margin: +$("#s-dur").value / 100, leads_per_day: +$("#s-lpd").value, approval: $("#s-appr").value }; DYN.settings.leads_per_day = +DYN.settings.leads_per_day; saveDyn(); WZ = null; toast("Defaults saved. New experiments will start from them."); };
  $("#s-reset").onclick = () => { if (!confirm("Reset the demo? Days played, approvals, rollbacks and launched tests are cleared.")) return; try { localStorage.removeItem(SK); } catch { } location.hash = "#/overview"; location.reload(); };
};
