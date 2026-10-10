/* New Experiment: six steps on one page with the "At a glance" panel on the right: Hypothesis, Prompt B, Audience, Goals, Duration, Review.
   Everything is decided before launch; Save Test keeps an editable draft, Launch Test locks the setup (segment, prompt B, metrics and limits)
   and gives it a version ID. Every number comes from the 30-day data through the pure functions in 05-plan.js. */

const WSTEPS = ["Hypothesis", "Prompt B", "Audience", "Goals", "Duration", "Review and launch"];
let WZ = null;
DYN.drafts = DYN.drafts || [];
const wzDefaults = () => { const s = SET(); return { step: 1, name: "", change: "", why: "", effect: "", promptB: null,
  segRows: [], audienceSet: false,
  primary: REF_METRIC, guards: [{ key: "duration_s", direction: "lower", limit: { value: Math.round((s.duration_margin || 0.1) * 100), kind: "rel" } }], secondary: [], localMetrics: [],
  share: s.share_b, lenMode: "rec", size: "medium", customDays: null, customLpd: null, customD: null,
  confidence: s.confidence, minLeads: s.min_leads_per_arm, rule: s.rule_set, harm: s.harm_bar, approval: s.approval, assignment: s.assignment || "stratified",
  startDate: TODAY, source: "sim", preset: "win", effectRel: 15, seed: 7, durExtra: 0, hangExtra: 0, draftId: null, panel: null, cm: null, ui: {} }; };
function startWizard(prefill) { WZ = { ...wzDefaults(), ...(prefill || {}) }; if (WZ.segRows.length || prefill && prefill.audienceSet) WZ.audienceSet = true; go("new"); }

/* ---- prompt A: the live production prompt */
function versionText(x) {
  if (!x || x.id === "v1") return C.library.base_text || "";
  if (x.text) return x.text;
  const e = x.expId && byId(x.expId); if (e && e.prompt_b) return e.prompt_b;
  if (x.key && (C.library.edits || {})[x.key]) { try { return applyEdits(C.library.base_text, C.library.edits[x.key]); } catch (err) { return C.library.base_text || ""; } }
  return C.library.base_text || "";
}
function liveA() { const P = productionState(), L = P.live; return { id: L.id, name: L.name, hash: L.hash, text: versionText(L) }; }
const wzB = w => w.promptB == null ? liveA().text : w.promptB;
const wzSeg = w => segFromRows(w.segRows).seg;
const REF_METRIC = "buylead_created";                                         // shown until a primary goal is chosen
const wzPrimary = w => { const m = w.primary ? metricByKey(w.primary, w.localMetrics) : null; return m && w.primaryDir && !m.custom ? { ...m, direction: w.primaryDir } : m; };     // a built-in primary can take a per-test direction (w.primaryDir)
const wzRef = w => wzPrimary(w) || metricByKey(REF_METRIC);

/* ---- the plan: one call of durationPlan with this test's state (Step 5 and "At a glance" both read this) */
function wzPlan(w) {
  const seg = wzSeg(w), m = wzRef(w), base = baselineFor(m, seg), vol = audienceVolume(seg);
  const cust = w.lenMode === "custom", lpd = cust && w.customLpdTouched && w.customLpd > 0 ? +w.customLpd : vol.perDay;           // edited by the person, or from the data
  const dDefault = improvementOf(w.size, m, base.value), d = cust && w.customDTouched && w.customD > 0 && w.customDType === m.type ? (m.type === "average" ? +w.customD : w.customD / 100) : dDefault;
  const plan = durationPlan({ type: m.type, p: base.value, sd: base.sd, lpd, share: w.share, d, conf: w.confidence, days: cust ? (+w.customDays || null) : null, minLeads: w.minLeads, seq: w.rule === "sequential" });
  const dir = m.direction || "higher";
  const light = plan.tooBig ? "red" : (plan.shorter || plan.minLate) ? "amber" : "green";
  return { ...plan, seg, m, base, vol, dDefault, dir, light, target: base.value == null ? null : base.value + (dir === "lower" ? -d : d) };
}
const sizeLabel = (size, m) => { const p = { small: 2, medium: 5, large: 10 }[size], sign = m && m.direction === "lower" ? "−" : "+"; return m && m.type === "average" ? `${sign}${p}% of today's average` : `${sign}${p} pts`; };

/* ---- the plain-English duration card */
function planWords(w, P) {
  const m = P.m, avg = m.type === "average", unitW = avg ? fmtPts(P.d, m).replace(/^[+−]/, "") : `${(P.d * 100).toFixed(P.d * 100 % 1 ? 1 : 0)} points`;
  return `Your audience gets about <b>${nf(P.lpd)}</b> leads a day. Prompt B gets ${pct(P.s, 0)} of them, about <b>${nf(P.bPerDay)}</b> a day. ${avg ? `Today's average ${esc(m.name.toLowerCase())}` : `Today's ${esc(m.name)} rate`} for this audience is <b>${fmtMetric(P.base.value, m)}</b>.
    To reliably spot an improvement of ${unitW} (${fmtMetric(P.base.value, m)} → ${fmtMetric(P.target, m)}), B needs about <b>${nf(P.nB)}</b> leads.
    ${nf(P.nB)} ÷ ${nf(P.bPerDay)} = ${P.rawDays > 999 ? "999+" : P.rawDays.toFixed(1)} days, rounded up to whole weeks = <b>${P.tooBig ? "more than 28" : P.weeks} days</b>.${P.seq ? " (B's leads include about 6% extra: the early promote and stop rule looks every day.)" : ""}`;
}

/* ---- At a glance: the same numbers as Step 5, from the same function */
function glance(w) {
  if (!w.audienceSet) return `<div class="card calc" aria-live="polite"><h3>At a glance</h3><p class="note" style="margin-top:8px">Set audience and traffic to see estimates.</p></div>`;
  const P = wzPlan(w), lbl = { green: "Ready", amber: "Check this", red: "Will not finish" }[P.light];
  const msg = P.tooBig ? P.tooBigMsg : P.shorter ? "Shorter than recommended — the result may be inconclusive." : P.minLate ? `B would have fewer than ${nf(w.minLeads)} leads by the end, so no decision could be made. Raise B's share or lengthen the test.` : "This test can finish: the window holds enough leads.";
  return `<div class="card calc" aria-live="polite"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><h3>At a glance</h3><span class="light ${P.light}"><i></i>${lbl}</span></div>
    <dl class="kv" style="margin-top:8px;grid-template-columns:1fr auto" id="glance">
      <dt>Audience leads a day</dt><dd class="num" data-g="lpd">${nf(P.lpd)}</dd><dt>Prompt B gets</dt><dd class="num" data-g="bpd">${pct(P.s, 0)} · ${nf(P.bPerDay)} a day</dd>
      <dt>Today's ${esc(P.m.name)}${w.primary ? "" : " *"}</dt><dd class="num" data-g="base">${fmtMetric(P.base.value, P.m)}</dd><dt>Improvement to catch</dt><dd class="num" data-g="d">${fmtPts(P.dir === "lower" ? -P.d : P.d, P.m)}</dd>
      <dt>B needs</dt><dd class="num" data-g="nb">${nf(P.nB)} leads</dd><dt>Days needed</dt><dd class="num" data-g="days"><b>${P.rawDays > 999 ? "999+" : P.rawDays.toFixed(1)}</b> → ${P.tooBig ? "over 28" : P.weeks + " (whole weeks)"}</dd>
      <dt>Test length</dt><dd class="num" data-g="len">${P.days} days${P.custom ? " (custom)" : ""}</dd><dt>Smallest improvement it can spot</dt><dd class="num" data-g="small">${fmtPts(P.dir === "lower" ? -P.smallest : P.smallest, P.m)}</dd>
      <dt>Decisions can start</dt><dd class="num" data-g="minday">day ${P.minDay > 60 ? "60+" : P.minDay}</dd></dl>
    ${w.primary ? "" : `<p class="note" style="margin-top:4px">* until you choose a primary goal</p>`}${P.base.fallback ? `<p class="note">${esc(P.base.note)}</p>` : ""}
    <div class="banner ${P.light === "green" ? "pos" : P.light === "amber" ? "warn" : "neg"}" style="margin:12px 0 0;padding:8px 12px"><div style="font-size:13px">${esc(msg)}</div></div></div>`;
}

/* ---- a multi-select with checkboxes, "Select all" and a search box (used by the segment builder and the metric conditions) */
function msHtml(id, values, selected, placeholder) {
  const sum = selected.length ? (selected.length <= 3 ? selected.join(", ") : `${selected.length} of ${values.length} selected`) : (placeholder || "Choose values"), open = WZ && WZ.ui.openMs === id, q = (WZ && WZ.ui.msq && WZ.ui.msq[id]) || "";
  return `<details class="ms" data-ms="${esc(id)}" ${open ? "open" : ""}><summary><span>${esc(sum)}</span></summary><div class="ms-pop">
    ${values.length > 6 ? `<input type="search" class="ms-q" data-msq="${esc(id)}" value="${esc(q)}" placeholder="Search values" aria-label="Search values">` : ""}
    <label class="ms-opt ms-all"><input type="checkbox" data-msall="${esc(id)}" ${selected.length === values.length && values.length ? "checked" : ""}> <b>Select all</b></label>
    <div class="ms-list">${values.map(v => `<label class="ms-opt" ${q && !v.toLowerCase().includes(q.toLowerCase()) ? "hidden" : ""}><input type="checkbox" data-msv="${esc(id)}" value="${esc(v)}" ${selected.includes(v) ? "checked" : ""}> ${esc(v)}</label>`).join("")}</div></div></details>`;
}

/* ---- Step 3: the segment builder */
function segBuilder(w) {
  const facs = CAT().variables.filter(v => v.pre_call), used = w.segRows.map(r => r.column);
  const rows = w.segRows.map((r, i) => { const v = catVar(r.column);
    return `<div class="cond-row"><select data-segcol="${i}" aria-label="Factor"><option value="">Choose a factor</option>${facs.map(f => { const off = f.in_data === false || (used.includes(f.column) && f.column !== r.column) || ((DYN.settings || {}).preCallOff || []).includes(f.name);
        return `<option value="${esc(f.column)}" ${r.column === f.column ? "selected" : ""} ${off ? "disabled" : ""} title="${f.in_data === false ? "Not in data yet" : used.includes(f.column) && f.column !== r.column ? "Already used: a factor can be used only once" : esc(f.meaning)}">${esc(f.label)}${f.in_data === false ? " (not in data yet)" : ""}</option>`; }).join("")}</select>
      ${v ? msHtml("seg-" + i, v.values, r.values || [], "Choose values") : `<span class="note">Choose a factor first</span>`}<button class="x" data-segdel="${i}" aria-label="Remove this condition" title="Remove">×</button></div>`; }).join("");
  const left = facs.filter(f => f.in_data !== false && !used.includes(f.column)).length;
  return `<div class="seg-builder">${rows || `<p class="note" style="margin:0 0 8px">No conditions: all traffic is in the test (a neutral test).</p>`}<button class="btn sm" id="w-segadd" ${left ? "" : "disabled"} title="${left ? "" : "Every factor is already used"}">+ Add condition</button></div>`;
}
function audienceLine(w) {
  const r = segFromRows(w.segRows), vol = audienceVolume(r.seg), m = wzRef(w), b = baselineFor(m, r.seg);
  return `<div class="banner" style="margin-top:12px" id="w-segrule"><div><b>The rule.</b> ${esc(segDescribe(r.seg))}<br>
    <span id="w-segline">≈ <b>${nf(vol.perDay)}</b> leads/day · today's ${esc(m.name)} ${m.type === "average" ? "average" : "rate"} <b>${fmtMetric(b.value, m)}</b> (last 30 days)${w.primary ? "" : ` <span class="muted">(shown until you choose a primary goal)</span>`}</span>${b.fallback ? `<br><span class="note">${esc(b.note)}</span>` : ""}
    ${r.errors.length ? `<div style="margin-top:6px;color:#b23b3b">${r.errors.map(esc).join("<br>")}</div>` : ""}</div></div>`;
}

/* ---- Step 4: metric cards, the add-metric panel and the custom-metric builder */
const roleName = r => r === "guardrail" ? "Guardrail" : r === "secondary" ? "Secondary" : "Primary";
function usedKeys(w) { return [w.primary, ...w.guards.map(g => g.key), ...w.secondary.map(s => s.key)].filter(Boolean); }
function metricCard(w, role, i) {
  const item = role === "guardrail" ? w.guards[i] : w.secondary[i], m = metricByKey(item.key, w.localMetrics); if (!m) return "";
  const b = baselineFor(m, wzSeg(w)), other = role === "guardrail" ? "secondary" : "guardrail", full = roleFull(w, other);
  return `<div class="goal-card mcard" data-mcard="${role}:${i}" tabindex="0" role="button" aria-label="Edit ${esc(m.name)}"><span class="role ${role === "guardrail" ? "g" : "s"}">${roleName(role)}</span>
    <div class="mcard-tools"><details class="kebab"><summary aria-label="More actions for ${esc(m.name)}" title="More">⋯</summary><div class="menu"><button data-mmove="${role}:${i}" ${full ? "disabled" : ""} title="${full ? "Max reached — more metrics mean more false alarms." : ""}">Move to ${other}</button></div></details><button class="x" data-mdel="${role}:${i}" aria-label="Remove ${esc(m.name)}" title="Remove">×</button></div>
    <div class="mcard-name"><b>${esc(m.name)}</b> <span class="arrow" title="${item.direction === "lower" ? "lower is better" : "higher is better"}">${item.direction === "lower" ? "↓" : "↑"}</span></div>
    <div class="def">${esc(metricWords(m))}</div><div class="meta">${role === "guardrail" ? esc(limitWords(item.limit, m, item.direction)) + " · " : ""}today ${fmtMetric(b.value, m)} for this audience</div></div>`;
}
function condRows(cm, side, list) {
  const cols = HIST().cols.filter(c => c.type === "category"), max = METRIC_CAT().max_conditions || 3;
  return `${list.map((c, i) => { const col = HIST().col[c.col], id = `cm-${side}-${i}`;
    return `<div class="cond-row"><select data-ccol="${side}:${i}" aria-label="Column"><option value="">Column</option><optgroup label="Call">${cols.filter(x => !x.factor).map(x => `<option value="${esc(x.name)}" ${c.col === x.name ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</optgroup><optgroup label="Lead">${cols.filter(x => x.factor).map(x => `<option value="${esc(x.name)}" ${c.col === x.name ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</optgroup></select>
      <select data-cop="${side}:${i}" aria-label="Comparison"><option value="is" ${c.op === "is" ? "selected" : ""}>is</option><option value="is_not" ${c.op === "is_not" ? "selected" : ""}>is not</option><option value="in" ${c.op === "in" ? "selected" : ""}>is one of</option></select>
      ${!col ? `<span class="note">Choose a column</span>` : c.op === "is" ? `<select data-cval="${side}:${i}" aria-label="Value"><option value="">Value</option>${col.values.map(v => `<option ${c.values[0] === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>` : msHtml(id, col.values, c.values || [], "Choose values")}
      <button class="x" data-cdel="${side}:${i}" aria-label="Remove this condition" title="Remove">×</button></div>`; }).join("")}
    ${list.length < max ? `<button class="btn sm" data-cadd="${side}">+ Add condition</button>` : `<span class="note">At most ${max} conditions (joined with AND).</span>`}`;
}
const newCm = () => hasFileCols() ? newFcm() : ({ name: "", type: "rate", num: { unit: "calls", where: [{ col: "", op: "is", values: [] }] }, den: { unit: "calls", where: [] }, denAll: true, col: "call_duration", unit: "calls", where: [], direction: "higher", save: true });
function cmDef(cm) {
  if (cm.src === "file") return { ...fcDef(cm), ...(cm.key ? { _edit: true } : {}) };                 // a metric on the data files' columns (45-filecols.js)
  const base = { key: cm.key || metricKey(cm.name), name: String(cm.name || "").trim(), type: cm.type, direction: cm.direction, ...(cm.key ? { _edit: true } : {}) };
  return cm.type === "rate" ? { ...base, num: { unit: cm.num.unit, where: cm.num.where }, den: cm.denAll ? { unit: "calls", where: [] } : { unit: cm.den.unit, where: cm.den.where } } : { ...base, col: cm.col, unit: cm.unit, where: cm.where };
}
function cmBuilder(w, cm, forPrimary) {
  if (cm.src === "file") return fcBuilder(w, cm, forPrimary);
  const numCols = HIST().cols.filter(c => c.type === "number"), def = cmDef(cm), chk = metricCheck(def), seg = wzSeg(w);
  let prev = "";
  if (chk.ok) { const ev = baselineFor(def, seg); prev = def.type === "rate" ? `Formula: ${esc(metricWords(def))} · Last 30 days: ${nf(ev.num)} ÷ ${nf(ev.den)} = <b>${fmtMetric(ev.value, def)}</b>` : `Formula: ${esc(metricWords(def))} · Last 30 days: <b>${fmtMetric(ev.value, def)}</b> over ${nf(ev.den)} ${def.unit}`; if (ev.fallback) prev += ` <span class="note">(${esc(ev.note)})</span>`; }
  return `<div class="cm" id="w-cm"><div class="form-grid">${F("Metric name", `<input type="text" id="w-cmname" value="${esc(cm.name)}" placeholder="Answered %" maxlength="60">`)}
      <div class="field"><label>Type</label><div class="seg" role="group" aria-label="Type"><button data-cmtype="rate" aria-pressed="${cm.type === "rate"}">Rate (%)</button><button data-cmtype="average" aria-pressed="${cm.type === "average"}">Average</button></div></div></div>
    ${cm.type === "rate" ? `<div class="cm-side"><div class="cm-lbl"><b>Numerator:</b> count of <select data-cmunit="num" aria-label="Count calls or leads"><option value="calls" ${cm.num.unit === "calls" ? "selected" : ""}>calls</option><option value="leads" ${cm.num.unit === "leads" ? "selected" : ""}>leads</option></select> where</div>${condRows(cm, "num", cm.num.where)}</div>
      <div class="cm-side"><div class="cm-lbl"><b>Denominator:</b> <label class="chk"><input type="radio" name="w-cmden" value="all" ${cm.denAll ? "checked" : ""}> all calls attempted</label> <label class="chk"><input type="radio" name="w-cmden" value="custom" ${cm.denAll ? "" : "checked"}> count of</label> ${cm.denAll ? "" : `<select data-cmunit="den" aria-label="Count calls or leads"><option value="calls" ${cm.den.unit === "calls" ? "selected" : ""}>calls</option><option value="leads" ${cm.den.unit === "leads" ? "selected" : ""}>leads</option></select> where`}</div>${cm.denAll ? "" : condRows(cm, "den", cm.den.where)}</div>`
    : `<div class="cm-side"><div class="cm-lbl"><b>Average</b> of <select id="w-cmcol" aria-label="Number column">${numCols.map(c => `<option value="${esc(c.name)}" ${cm.col === c.name ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select> over <select data-cmunit="avg" aria-label="Over calls or leads"><option value="calls" ${cm.unit === "calls" ? "selected" : ""}>calls</option><option value="leads" ${cm.unit === "leads" ? "selected" : ""}>leads</option></select> where (optional)</div>${condRows(cm, "where", cm.where)}</div>`}
    <div class="field" style="margin-top:12px"><label>Better direction</label><div class="seg" role="group" aria-label="Better direction"><button data-cmdir="higher" aria-pressed="${cm.direction === "higher"}">↑ Higher is better</button><button data-cmdir="lower" aria-pressed="${cm.direction === "lower"}">↓ Lower is better</button></div></div>
    ${forPrimary ? "" : `<label class="chk" style="margin-top:12px"><input type="checkbox" id="w-cmsave" ${cm.save ? "checked" : ""}> Save to metric list for future tests</label>`}
    <div class="cm-prev ${chk.ok ? "" : "bad"}" id="w-cmprev" aria-live="polite">${chk.ok ? prev : chk.errors.map(esc).join("<br>")}</div></div>`;
}
function metricList(w, p) {
  const q = (p.q || "").trim().toLowerCase(), used = usedKeys(w).filter(k => !(p.edit && k === p.key)), seg = wzSeg(w), groups = METRIC_CAT().groups;
  const all = allMetrics(w.localMetrics).filter(m => !q || (m.name + " " + metricWords(m)).toLowerCase().includes(q));
  return `<input type="search" id="w-psearch" value="${esc(p.q || "")}" placeholder="Search metrics" aria-label="Search metrics" style="margin:12px 0 8px">
    <div class="mlist">${groups.map(g => { const list = all.filter(m => (m.group || "Custom") === g); if (!list.length) return ""; return `<div class="mgroup"><div class="mgroup-h">${esc(g)}</div>${list.map(m => { const off = used.includes(m.key) || m.available === false, ev = m.available === false ? null : baselineFor(m, seg);
      return `<label class="mrow ${off ? "off" : ""}"><input type="radio" name="w-pick" value="${esc(m.key)}" ${p.key === m.key ? "checked" : ""} ${off ? "disabled" : ""}><span class="mrow-main"><b>${esc(m.name)}</b><span class="note">${esc(metricWords(m))}</span></span><span class="num">${m.available === false ? `<span class="pill plain" title="Not in data yet">Not in data yet</span>` : used.includes(m.key) ? `<span class="pill plain">Already added</span>` : fmtMetric(ev.value, m)}</span></label>`; }).join("")}</div>`; }).join("") || `<div class="note">No metric matches.</div>`}</div>`;
}
function metricPanel(w) {
  const p = w.panel; if (!p) return "";
  const gFull = roleFull(w, "guardrail") && !(p.edit && p.origRole === "guardrail"), sFull = roleFull(w, "secondary") && !(p.edit && p.origRole === "secondary");
  const m = p.tab === "list" ? metricByKey(p.key, w.localMetrics) : (w.cm ? cmDef(w.cm) : null), err = p.err || "";
  return `<div class="card mpanel" id="w-panel" role="dialog" aria-label="${p.edit ? "Edit metric" : "Add metric"}"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3>${p.edit ? "Edit metric" : "Add metric"}</h3><button class="x" id="w-pclose" aria-label="Close">×</button></div>
    <div class="field" style="margin-top:8px"><label>Add as</label><div class="seg" role="group" aria-label="Add as"><button data-prole="guardrail" aria-pressed="${p.role === "guardrail"}" ${gFull ? "disabled" : ""} title="${gFull ? "Max reached — more metrics mean more false alarms." : "Must not get worse; can stop or hold the test"}">Guardrail</button><button data-prole="secondary" aria-pressed="${p.role === "secondary"}" ${sFull ? "disabled" : ""} title="${sFull ? "Max reached — more metrics mean more false alarms." : "Tracked and reported only"}">Secondary</button></div></div>
    ${p.edit ? "" : `<div class="tabs" role="tablist"><button role="tab" data-ptab="list" aria-selected="${p.tab === "list"}">Choose from list</button><button role="tab" data-ptab="custom" aria-selected="${p.tab === "custom"}">Create custom metric</button></div>`}
    ${p.tab === "list" ? metricList(w, p) : cmBuilder(w, w.cm || (w.cm = newCm()), false)}
    <div class="form-grid" style="margin-top:12px">${F("Direction", `<select id="w-pdir"><option value="higher" ${p.direction === "higher" ? "selected" : ""}>↑ Higher is better</option><option value="lower" ${p.direction === "lower" ? "selected" : ""}>↓ Lower is better</option></select>`)}
      ${p.role === "guardrail" ? F("Limit", `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="note">Must not get worse by more than</span><input type="number" id="w-plim" min="0.1" step="0.5" value="${esc(p.limit != null ? p.limit : 10)}" style="width:80px"><select id="w-plimk" aria-label="Limit kind"><option value="rel" ${p.kind === "rel" ? "selected" : ""}>% relative</option><option value="pts" ${p.kind === "pts" ? "selected" : ""}>${m && m.type === "average" ? (metricUnit(m) || "units") + " (absolute)" : "points"}</option></select></div>`, "required") : ""}</div>
    <div class="actions" style="margin-top:12px"><button class="btn primary" id="w-padd">${p.edit ? "Save changes" : "Add"}</button><button class="btn" id="w-pcancel">Cancel</button><span class="note" style="color:#b23b3b" id="w-perr">${esc(err)}</span></div></div>`;
}
function goalsStep(w) {
  const seg = wzSeg(w), prim = wzPrimary(w), used = usedKeys(w), outcomes = allMetrics(w.localMetrics).filter(m => m.group === "Outcome"), customs = allMetrics(w.localMetrics).filter(m => m.custom);
  const opt = m => `<option value="${esc(m.key)}" ${w.primary === m.key ? "selected" : ""} ${used.includes(m.key) && w.primary !== m.key ? "disabled" : ""}>${esc(m.name)}${used.includes(m.key) && w.primary !== m.key ? " (already added)" : ""}</option>`;
  const pb = prim ? baselineFor(prim, seg) : null, lost = w.primary && !prim;
  return `<h2>4. Goals</h2><p class="sub">One primary goal decides the test. Guardrails can stop or hold it. Secondary metrics are reported only.</p>
    <section class="goal-sec"><h3>Primary goal</h3><p class="note">Exactly one: the result the test is judged on.</p>
      <select id="w-primary" aria-label="Primary goal" style="max-width:420px"><option value="" ${prim ? "" : "selected"} disabled>Choose the main goal</option>${outcomes.map(opt).join("")}${customs.length ? `<optgroup label="Custom metrics">${customs.map(opt).join("")}</optgroup>` : ""}<option value="__custom" ${w.ui.primCustom ? "selected" : ""}>+ Custom metric</option></select>
      ${lost ? `<p class="note" style="color:#b23b3b;margin-top:8px">The primary goal chosen earlier was removed from Settings > Metrics. Choose another.</p>` : ""}
      ${w.ui.primCustom ? `<div class="card" style="background:var(--bg-2);margin-top:12px">${cmBuilder(w, w.cm || (w.cm = newCm()), true)}${w.ui.primAsk ? `<div class="banner warn" id="w-cmask" style="margin:12px 0 0"><div><b>Update the saved metric too, or only this test?</b> "${esc(w.cm.name)}" is in the metric list (Settings > Metrics).<div class="actions" style="margin-top:8px"><button class="btn primary" id="w-cmupd">Update saved metric</button><button class="btn" id="w-cmonly">Only this test</button></div></div></div>` : `<div class="actions" style="margin-top:12px"><button class="btn primary" id="w-cmsavep">${w.ui.primEditKey ? "Save changes" : "Save metric"}</button><button class="btn" id="w-cmcancel">Cancel</button></div>`}</div>`
        : prim ? `<div class="goal-card primary" id="w-primcard" style="margin-top:12px;max-width:520px"><span class="role">Primary</span>
          <div class="mcard-tools"><details class="kebab"><summary aria-label="More actions for ${esc(prim.name)}" title="More">⋯</summary><div class="menu"><button data-pedit="1">Edit</button><button data-pchange="1">Change goal</button></div></details></div>
          <div class="mcard-name"><b>${esc(prim.name)}</b> <span class="arrow" title="${prim.direction === "lower" ? "lower is better" : "higher is better"}">${prim.direction === "lower" ? "↓" : "↑"}</span></div><div class="def">${esc(metricWords(prim))}</div><div class="meta">${prim.direction === "lower" ? "lower" : "higher"} is better${w.primaryDir && !prim.custom ? " (this test)" : ""} · today ${fmtMetric(pb.value, prim)} for this audience (last 30 days)</div>
          ${w.ui.primDirEdit && !prim.custom ? `<div class="field" style="margin-top:8px"><label>Better direction for this test</label><div class="seg wz-fit" role="group" aria-label="Better direction for this test"><button data-pdir="higher" aria-pressed="${prim.direction !== "lower"}">↑ Higher is better</button><button data-pdir="lower" aria-pressed="${prim.direction === "lower"}">↓ Lower is better</button></div><div class="actions" style="margin-top:8px"><button class="btn sm" id="w-pdirdone">Done</button></div></div>` : ""}</div>` : ""}</section>
    <section class="goal-sec"><h3>Guardrails</h3><p class="note">Metrics that must not get worse; they can stop or hold a test.</p><div class="goal-row">${w.guards.map((g, i) => metricCard(w, "guardrail", i)).join("") || `<div class="note">No guardrails.</div>`}</div></section>
    <section class="goal-sec"><h3>Secondary metrics</h3><p class="note">Tracked and reported only; they never affect the decision.</p><div class="goal-row">${w.secondary.map((g, i) => metricCard(w, "secondary", i)).join("") || `<div class="note">None yet.</div>`}</div></section>
    <div class="actions" style="margin-top:16px"><button class="btn" id="w-addm" ${roleFull(w, "guardrail") && roleFull(w, "secondary") ? "disabled title=\"Max reached — more metrics mean more false alarms.\"" : ""}>+ Add metric</button><span class="note">Up to ${METRIC_CAT().limits.guardrails} guardrails and ${METRIC_CAT().limits.secondary} secondary metrics.</span></div>
    ${metricPanel(w)}`;
}

/* ---- overlap and the pre-launch checklist */
const segsOverlap = (a, b) => CAT().variables.filter(v => v.pre_call && !v.derived_from).every(v => { const x = segAllowedEff(a, v.column), y = segAllowedEff(b, v.column); return x.some(t => y.includes(t)); });     // a derived factor (HL Bucket) narrows its base (HL Type)
function runningMain() { return DYN.launched.filter(e => e.world === "main").filter(e => { const v = view(e); return v.running || v.scheduled || (v.d.paused && !v.ended); }); }
function promptState(w) { const A = liveA(), B = wzB(w), vc = varCheck(A.text, B); return { A, B, same: A.text === B, vc }; }
function checklist(w) {
  const P = wzPlan(w), ps = promptState(w), seg = wzSeg(w), segErr = segFromRows(w.segRows).errors;
  const clash = runningMain().filter(e => segsOverlap(seg, segOf(e) || []));
  const badLim = w.guards.filter(g => !(g.limit && g.limit.value > 0));
  return [
    { ok: !!wzPrimary(w), label: "Exactly one primary goal", why: wzPrimary(w) ? `${wzPrimary(w).name} decides; guardrails can only stop or hold.` : "Choose the main goal.", step: 4 },
    { ok: !ps.same && ps.vc.ok, label: "Prompt B differs from A and keeps its template variables", why: ps.same ? "Prompt B is the same as A." : !ps.vc.ok ? [ps.vc.missing.length ? "Missing: " + ps.vc.missing.map(v => `{{${v}}}`).join(", ") : "", ps.vc.added.length ? "New variable not supplied by the bot: " + ps.vc.added.map(v => `{{${v}}}`).join(", ") : ""].filter(Boolean).join("; ") : `All ${ps.vc.n} template variables are kept.`, step: 2 },
    { ok: !segErr.length && !P.tooBig, label: "The audience has enough leads for the duration", why: segErr.length ? segErr[0] : P.tooBig ? P.tooBigMsg : `${nf(P.nBd)} leads on B in ${P.days} days against ${nf(P.nB)} needed${P.shorter ? " (shorter than recommended: the result may be inconclusive)" : ""}.`, step: 3 },
    { ok: P.days >= 7 && P.days <= 28 && P.days % 7 === 0, label: "Duration is 7 to 28 days, in whole weeks", why: `${P.days} days (a full week of patterns, no endless tests).`, step: 5 },
    { ok: !badLim.length, label: "Every guardrail has a limit", why: badLim.length ? "Set a limit above 0 on every guardrail." : w.guards.length ? `${w.guards.length} guardrail${w.guards.length === 1 ? "" : "s"}, each with a limit.` : "No guardrails (allowed).", step: 4 },
    { ok: clash.length === 0, label: "No running test overlaps the same leads", why: clash.length ? `${clash.map(e => e.record.config.name).join("; ")} already runs on these leads. Finish it first, or pick a different audience.` : "Nothing else is running on these leads.", step: 3 }];
}
function wzValid(w, step) {
  if (step === 1 && !w.name.trim()) return "Give the test a name.";
  if (step === 2) { const ps = promptState(w); if (ps.same) return "Prompt B is the same as A. Make a change to continue."; if (!ps.vc.ok) return ps.vc.missing.length ? `Missing: ${ps.vc.missing.map(v => `{{${v}}}`).join(", ")}.` : `New variable not supplied by the bot: ${ps.vc.added.map(v => `{{${v}}}`).join(", ")}.`; }
  if (step === 3) { const r = segFromRows(w.segRows); if (r.errors.length) return r.errors[0]; }
  if (step === 4) { if (!wzPrimary(w)) return "Choose the main goal."; const gone = [...w.guards, ...w.secondary].filter(x => !metricByKey(x.key, w.localMetrics)); if (gone.length) { w.guards = w.guards.filter(x => metricByKey(x.key, w.localMetrics)); w.secondary = w.secondary.filter(x => metricByKey(x.key, w.localMetrics)); return "A metric in this test was removed from Settings > Metrics; it has been taken off. Check the goals again."; } if (w.ui.primCustom) return "Save the custom metric first, or cancel it."; if (w.guards.some(g => !(g.limit && g.limit.value > 0))) return "Every guardrail needs a limit above 0."; }
  if (step === 5) { const P = wzPlan(w); if (!(w.share >= 0.05 && w.share <= 0.5)) return "The share for B must be between 5% and 50%."; if (!(P.lpd >= 1)) return "Leads per day must be at least 1."; if (!(P.d > 0)) return "The improvement to catch must be above 0.";
    if (P.m.type === "rate" && (P.target <= 0 || P.target >= 1)) return "Today's rate plus the improvement must stay between 0 and 100%."; if (!(P.days >= 7 && P.days <= 28 && P.days % 7 === 0)) return "The test length must be 7, 14, 21 or 28 days.";
    if (engineLeadsPerDay(w, P) * P.days > 60000) return "Days x leads a day is capped at 60,000 for the live demo: shorten the test or narrow the audience."; }
  return "";
}
/** The engine counts every attempted lead of all traffic: the audience's connected leads a day, scaled back up (the server does the same). */
const engineLeadsPerDay = (w, P) => Math.round(P.lpd / Math.max(1e-9, segShare(P.seg) * connectShare()));
const F = (label, inner, hint) => `<div class="field"><label>${label}${hint ? ` <span class="hint">${hint}</span>` : ""}</label>${inner}</div>`;
const sideDiff = (a, b, ctx = 2) => {
  const rows = diffRows(a, b), keep = rows.map(() => false); rows.forEach((r, i) => { if (r.t !== "same") for (let k = Math.max(0, i - ctx); k <= Math.min(rows.length - 1, i + ctx); k++) keep[k] = true; });
  const L = [], R = []; let gap = false;
  rows.forEach((r, i) => { if (!keep[i]) { if (!gap) { L.push(["hdr", "…"]); R.push(["hdr", "…"]); gap = true; } return; } gap = false;
    if (r.t === "same") { L.push(["", r.a]); R.push(["", r.b]); } else if (r.t === "del") { L.push(["del", r.a]); R.push(["", ""]); } else { L.push(["", ""]); R.push(["add", r.b]); } });
  const col = X => `<div class="diff">${X.map(([c, t]) => `<div class="${c}">${esc(t) || "&nbsp;"}</div>`).join("")}</div>`;
  return `<div class="diff2"><div><div class="note" style="padding:4px 8px">A: current prompt</div>${col(L)}</div><div><div class="note" style="padding:4px 8px">B: your prompt (green = added, red = removed)</div>${col(R)}</div></div>`;
};
function diffBlock(a, b) { const st = diffStats(diffRows(a, b)); return st.same ? `<div class="banner warn" style="margin:0"><div>Prompt B is the same as A. Make a change to continue.</div></div>` : `<p class="note" style="margin-bottom:8px">${st.added} line${st.added === 1 ? "" : "s"} added, ${st.removed} removed.</p>${sideDiff(a, b)}`; }
function vcBlock(vc) {
  if (vc.ok) return `<div class="check ok"><span class="ico">✓</span>All variables kept${vc.n ? ` (${vc.n})` : ""}.</div>`;
  return (vc.missing.length ? `<div class="check warnc"><span class="ico">⚠</span>Missing: ${esc(vc.missing.map(v => `{{${v}}}`).join(", "))}</div>` : "") + (vc.added.length ? `<div class="check warnc"><span class="ico">⚠</span>New variable not supplied by the bot: ${esc(vc.added.map(v => `{{${v}}}`).join(", "))}</div>` : "");
}
function suggestShare(w) { const st = diffStats(diffRows(liveA().text, wzB(w))), n = st.added + st.removed; return n <= 12 ? { share: 0.30, why: `a small wording change (${n} changed lines): 30 to 50% is enough` } : { share: 0.10, why: `a bigger change (${n} changed lines): start with 10% to limit the risk` }; }

function wzBody(w) {
  const s = w.step;
  if (s === 1) { const ideas = (C.suggestions || []).filter(c => c.variant && !c.disabled && !c.from_history).sort((a, b) => priority(b).score - priority(a).score);
    return `<h2>1. Hypothesis</h2><p class="sub">What are you testing, and why do you expect it to help?</p>
    ${ideas.length ? `<div class="idea-chips"><span class="note">Start from a ready idea (fills every step, including prompt B):</span>${ideas.map(c => `<button class="chip" data-idea="${esc(c.id)}">${esc(c.title)}</button>`).join("")}</div>` : ""}<div class="form-grid" style="margin-top:16px">
    ${F("Name", `<input type="text" id="w-name" value="${esc(w.name)}" placeholder="Offer two time slots instead of asking open-ended">`)}${F("Expected effect", `<input type="text" id="w-effect" value="${esc(w.effect)}" placeholder="+10% BuyLeads">`)}
    <div class="field wide"><label>What changes</label><textarea id="w-change">${esc(w.change)}</textarea></div><div class="field wide"><label>Why</label><textarea id="w-why">${esc(w.why)}</textarea></div></div>`; }
  if (s === 2) {
    const ps = promptState(w);
    return `<h2>2. Prompt B</h2><p class="sub">Edit the full prompt B below; the diff and the variable check update as you type. Prompt A is the live prompt.</p>
      <details id="w-abox" style="margin-top:16px" ${w.ui.aOpen ? "open" : ""}><summary style="cursor:pointer;font-weight:500">View current prompt (A) · ${esc(ps.A.id)}: ${esc(ps.A.name)} <span class="mono muted">${esc(ps.A.hash)}</span></summary><div id="w-aview" style="margin-top:8px">${w.ui.aOpen ? `<textarea readonly class="prompt-box" rows="16" aria-label="Current prompt A (read-only)">${esc(ps.A.text)}</textarea>` : ""}</div></details>
      <div class="field" style="margin-top:16px"><label for="w-b">Prompt B <span class="hint" id="w-bcount">${nf(ps.B.length)} characters</span></label><textarea id="w-b" class="prompt-box" rows="24" spellcheck="false">${esc(ps.B)}</textarea>
        <div class="actions" style="margin-top:4px"><button class="link" id="w-reset">Reset to prompt A</button></div></div>
      <h3 style="margin:16px 0 8px">What changed</h3><div id="w-diff">${diffBlock(ps.A.text, ps.B)}</div>
      <div style="margin-top:12px;display:grid;gap:8px" id="w-vc">${vcBlock(ps.vc)}</div>
      <p class="note" style="margin-top:12px"><a href="#/suggest" target="_blank" rel="noopener">Need ideas? See Suggest A/B Tests</a></p>`;
  }
  if (s === 3) {
    const P = wzPlan(w), seg = P.seg, pc = CAT().variables.filter(v => !v.pre_call), [bs, bk] = blockFor(w.share), sp = planStrata(P.lpd * P.days / Math.max(1e-9, connectShare()), seg), shown = sp.strata.filter(r => r.expected >= 0.5).slice(0, 16);
    return `<h2>3. Audience</h2><p class="sub">Who is in the test. Leave it empty for all leads. Leads outside it keep today's prompt. ${info("Only factors known before the call can pick leads: anything decided during the call would bias the result.")}</p>
      <div style="margin-top:16px">${segBuilder(w)}</div>${audienceLine(w)}
      <p class="note" style="margin-top:8px">AND between conditions, OR within a condition's values. ${info(`Not available: ${pc.map(v => v.label).join(", ")} (known only during the call). ${(C.history || {}).note || CAT().note}`)}</p>
      ${fold("How the split is dealt", `<p class="sub">Leads are dealt inside each group (${CAT().strata.map(n => esc(catVar(n).label)).join(" × ")}) from shuffled blocks of ${bs}: with ${pct(w.share, 0)} to B each block holds ${bk} B and ${bs - bk} A in random order. Every group therefore carries exactly the configured share, so A and B get the same mix. Groups expected to hold fewer than ${CAT().min_stratum} leads are merged into "Other".</p>
        <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Group</th><th class="num">Leads expected in ${P.days} days</th><th>Split</th></tr></thead><tbody>${shown.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${nf(r.expected)}</td><td>${r.merged ? pill("merged into Other", "warn") : pill("own blocks", "pos")}</td></tr>`).join("")}</tbody></table></div>${sp.strata.length > shown.length ? `<div class="note">… and ${sp.strata.length - shown.length} more groups.</div>` : ""}`, `${sp.strata.length} groups, each with exactly ${pct(w.share, 0)} on B`)}`;
  }
  if (s === 4) return goalsStep(w);
  if (s === 5) {
    const P = wzPlan(w), m = P.m, cust = w.lenMode === "custom", avg = m.type === "average";
    const dIn = cust ? (avg ? +P.d.toFixed(1) : +(P.d * 100).toFixed(1)) : null;
    const Fh = (label, inner, help) => `<div class="field"><label>${label}</label>${inner}${help ? `<div class="note wz-help">${help}</div>` : ""}</div>`;     // label (one line), control, helper text below
    return `<div class="wz-dur"><h2>5. Duration</h2><p class="sub">Worked out for you from the last 30 days of data. Nothing needs typing.</p>
      <div class="form-grid wz-dgrid" style="margin-top:16px">${Fh("Test length", `<select id="w-len"><option value="rec" ${cust ? "" : "selected"}>Recommended: ${P.tooBig ? "over 28" : P.rec} days</option><option value="custom" ${cust ? "selected" : ""}>Custom length</option></select>`, cust ? "Set the numbers below." : "Whole weeks, 7 to 28 days.")}
        ${cust ? "" : Fh("Share of traffic to B", `<input type="number" id="w-share" min="5" max="50" step="1" value="${Math.round(w.share * 100)}">`, `Whole percent, 5 to 50%.${w.shareAuto && w.shareWhy ? ` Set to ${pct(w.share, 0)} for you: ${esc(w.shareWhy)}. Change it if you like.` : ""}`)}</div>
      ${P.tooBig ? "" : `<div class="flow" aria-hidden="true"><span><b>${nf(P.lpd)}</b> leads a day</span><span><b>${pct(w.share, 0)}</b> to B ≈ <b>${nf(P.lpd * w.share)}</b> a day</span><span>B needs <b>${nf(P.nB)}</b> leads</span><span><b>${P.days}</b> days</span></div>`}
      <div class="${P.tooBig ? "banner neg" : "plan-note"}" style="margin-top:12px" id="w-planwords"><div>${planWords(w, P)}${P.tooBig ? `<div style="margin-top:6px"><b>${esc(P.tooBigMsg)}</b></div>` : ""}${P.base.fallback ? `<div class="note" style="margin-top:6px">${esc(P.base.note)}</div>` : ""}${w.primary ? "" : `<div class="note" style="margin-top:6px">No primary goal yet: using ${esc(m.name)} until you choose one in step 4.</div>`}</div></div>
      ${cust ? "" : `<div class="field" style="margin-top:16px"><label>Improvement worth catching</label><div class="seg wz-fit" role="group" aria-label="Improvement worth catching">${["small", "medium", "large"].map(z => `<button data-size="${z}" aria-pressed="${w.size === z}">${z[0].toUpperCase() + z.slice(1)} (${esc(sizeLabel(z, { ...m, direction: P.dir }))})</button>`).join("")}</div></div>`}
      ${cust ? `<div class="card" style="background:var(--bg-2);margin-top:16px"><h3>Custom length</h3><div class="form-grid wz-dgrid" style="margin-top:8px">
          ${Fh("Leads per day", `<input type="number" id="w-clpd" min="1" step="1" value="${Math.round(P.lpd)}">`, w.customLpdTouched ? "Edited by you." : "From data; edit for planned changes.")}
          ${Fh("B share (%)", `<input type="number" id="w-share" min="5" max="50" step="1" value="${Math.round(w.share * 100)}">`, "Whole percent, 5 to 50%.")}
          ${Fh("Test days", `<select id="w-cdays">${[7, 14, 21, 28].map(d => `<option value="${d}" ${P.days === d ? "selected" : ""}>${d} days${d === P.rec && !P.tooBig ? " (recommended)" : ""}</option>`).join("")}</select>`, "Whole weeks.")}
          ${Fh(`Improvement worth catching (${avg ? metricUnit(m) || "units" : "pts"})`, `<input type="number" id="w-cd" min="0.1" step="${avg ? 0.5 : 0.5}" value="${dIn}">`, "")}</div>
        <p style="margin-top:12px" id="w-reverse">With ${P.days} days you can spot an improvement of <b>${fmtPts(P.smallest, m).replace(/^[+−]/, "")}</b> or more.</p>
        ${P.shorter ? `<div class="banner warn" style="margin:8px 0 0"><div>Shorter than recommended — the result may be inconclusive.</div></div>` : ""}</div>` : ""}
      ${P.minLate ? `<div class="banner warn" style="margin-top:12px"><div>B would have fewer than ${nf(w.minLeads)} leads by day ${P.days}, so no decision could be made (decisions start on day ${P.minDay > 60 ? "60+" : P.minDay}). Raise B's share or lengthen the test.</div></div>` : ""}
      <details style="margin-top:16px" ${w.ui.advOpen ? "open" : ""} id="w-adv"><summary style="cursor:pointer;font-weight:500">Advanced settings</summary><div class="form-grid" style="margin-top:12px">
        ${F("Confidence", `<select id="w-conf">${[0.9, 0.95, 0.99].map(x => `<option value="${x}" ${w.confidence === x ? "selected" : ""}>${x * 100}%</option>`).join("")}</select>`, "power is fixed at 80%")}
        ${F("Minimum leads per arm before any decision", `<input type="number" id="w-min" min="20" step="10" value="${w.minLeads}">`)}
        ${F(`Baseline (today's ${esc(m.name)})`, `<input type="text" id="w-base" value="${fmtMetric(P.base.value, m)}" readonly aria-readonly="true">`, P.base.fallback ? "all traffic: too little history for this audience" : "from data, last 30 days")}
        ${F("Daily harm bar", `<select id="w-harm">${[0.99, 0.995, 0.999].map(x => `<option value="${x}" ${w.harm === x ? "selected" : ""}>${(x * 100).toFixed(1)}%</option>`).join("")}</select>`, "one-look rule")}
        ${F("Approval mode", `<select id="w-appr"><option value="auto" ${w.approval === "auto" ? "selected" : ""}>Automatic: a win is promoted</option><option value="manual" ${w.approval === "manual" ? "selected" : ""}>Manual: a person approves every win</option></select>`, "both paths are logged")}
        ${F("How leads are dealt", `<select id="w-assign"><option value="stratified" ${w.assignment === "stratified" ? "selected" : ""}>Stratified blocks (the BRD's router)</option><option value="balanced" ${w.assignment === "balanced" ? "selected" : ""} ${P.seg.length ? "disabled" : ""}>Balanced blocks, no groups</option><option value="hash" ${w.assignment === "hash" ? "selected" : ""} ${P.seg.length ? "disabled" : ""}>Pure hash (no stored state)</option></select>`, P.seg.length ? "an audience needs stratified" : "")}</div>
        <div style="display:grid;gap:8px;margin-top:12px"><label class="radio"><input type="radio" name="w-rule" value="final_look" ${w.rule === "final_look" ? "checked" : ""}><div><b>One winner call at the end, plus a strict daily harm check</b><span>The BRD's rule: one test at ${pct(w.confidence, 0)} on the last day. Every day a ${pct(w.harm, 1)} bar catches a clearly worse B.</span></div></label>
          <label class="radio"><input type="radio" name="w-rule" value="sequential" ${w.rule === "sequential" ? "checked" : ""}><div><b>Early promote and early stop (sequential)</b><span>May promote or stop on any day using boundaries built for repeated looks. ${RULE_FACTS()} Needs about 6% more data.</span></div></label></div></details></div>`;
  }
  const P = wzPlan(w), ps = promptState(w), chk = checklist(w), prim = wzPrimary(w), tm = testMetrics(w), st = diffStats(diffRows(ps.A.text, ps.B)), usesHang = tm.some(x => x.key === "early_hangup");
  const ed = (n, what) => `<button class="link wz-edit" data-goto="${n}" aria-label="Edit ${what} (step ${n})">Edit</button>`;
  const mLine = x => x.m ? `<div><b>${esc(x.m.name)}</b> ${x.direction === "lower" ? "↓" : "↑"} <span class="muted">${esc(metricWords(x.m))}</span>${x.role === "guardrail" ? ` · <b>${esc(limitWords(x.limit, x.m, x.direction))}</b>` : ""}</div>` : "";
  return `<h2>6. Review and launch</h2><p class="sub">Launch locks the setup with a version ID. Save Test keeps an editable draft.</p>
    <dl class="kv wz-review" style="margin-top:16px"><dt>Name ${ed(1, "name")}</dt><dd><b>${esc(w.name || "-")}</b></dd>
      <dt>Prompt B ${ed(2, "prompt B")}</dt><dd>A full prompt: ${st.added} line${st.added === 1 ? "" : "s"} added, ${st.removed} removed against ${esc(ps.A.id)} (the live prompt). ${ps.vc.ok ? "All template variables kept." : "Template variables need fixing."}</dd>
      <dt>Audience ${ed(3, "audience")}</dt><dd>${esc(segDescribe(P.seg))} · about ${nf(P.vol.perDay)} leads a day ${info("The router checks every lead before the call and counts only those that match the rule.")}</dd>
      <dt>Primary goal ${ed(4, "primary goal")}</dt><dd>${prim ? mLine(tm[0]) + `<div class="note">today ${fmtMetric(P.base.value, prim)} · improvement to catch ${fmtPts(P.dir === "lower" ? -P.d : P.d, prim)}</div>` : "Not chosen"}</dd>
      <dt>Guardrails ${ed(4, "guardrails")}</dt><dd>${tm.filter(x => x.role === "guardrail").map(mLine).join("") || "None"}</dd>
      <dt>Secondary ${ed(4, "secondary metrics")}</dt><dd>${tm.filter(x => x.role === "secondary").map(mLine).join("") || "None"} ${info("For insight only: never used for the decision.")}</dd>
      <dt>Duration ${ed(5, "duration")}</dt><dd>${P.days} days${P.custom ? " (custom)" : " (recommended)"}, ${pct(w.share, 0)} to B, ${pct(w.confidence, 0)} confidence, decisions from ${nf(w.minLeads)} leads per arm, ${w.rule === "final_look" ? `one winner call at the end + daily ${pct(w.harm, 1)} harm check` : "early promote and early stop"}, approval ${w.approval}</dd></dl>
    ${fold("What changed in prompt B", diffBlock(ps.A.text, ps.B), `${st.added} added, ${st.removed} removed`)}
    ${fold("Show the full prompt B", `<textarea readonly class="prompt-box" rows="14" aria-label="Prompt B (read-only)">${esc(ps.B)}</textarea>`)}
    <h3 style="margin:24px 0 8px">Pre-launch checklist ${chk.every(x => x.ok) ? pill(`all ${chk.length} pass`, "pos") : pill(`${chk.filter(x => !x.ok).length} to fix`, "neg")}</h3><div class="checkgrid" id="w-checks">${chk.map(x => `<div class="check ${x.ok ? "ok" : "bad"}" title="${esc(x.why)}"><span class="ico">${x.ok ? "✓" : "✕"}</span><span>${x.ok ? esc(x.label) : `<b>${esc(x.label)}</b>: ${esc(x.why)} <button class="link" data-goto="${x.step}">Fix in step ${x.step}</button>`}</span></div>`).join("")}</div>
    <div class="form-grid" style="margin-top:16px">${F("Start date", `<input type="date" id="w-start" value="${esc(w.startDate)}" min="${TODAY}">`, w.startDate > TODAY ? "a later date makes it Scheduled" : "optional; today starts it now")}</div>
    <details class="fold" id="w-demo" ${w.ui.demoOpen || w.source === "files" ? "open" : ""}><summary><span>Where the results come from</span><span class="note">${w.source === "files" ? "results files" : `simulator (demo): ${{ win: "B wins", worse: "B worse", flat: "no difference", custom: "custom effect" }[w.preset] || w.preset}`}</span></summary><div class="fold-body"><div style="display:grid;gap:8px"><label class="radio"><input type="radio" name="w-src" value="sim" ${w.source === "sim" ? "checked" : ""}><div><b>Simulator (demo only)</b><span>Replays the 30-day history with a known effect on B, so you can check the engine decides correctly. ${info("The effect is put into B's input, never into the result. A call ends in one outcome, so when B gets more goal outcomes its other outcomes shrink in proportion: a guardrail on another disposition moves a little too.")}</span></div></label>
      <label class="radio"><input type="radio" name="w-src" value="files" ${w.source === "files" ? "checked" : ""}><div><b>Results files from the voice platform</b><span>The test runs elsewhere; you give Picky the A and B results and it decides with the plan above.</span></div></label></div>
    ${w.source === "sim" ? `<div class="form-grid" style="margin-top:16px"><div class="field wide"><label>Simulation settings (demo only)</label><div class="seg" role="group" aria-label="Preset">${(P.dir === "lower" ? [["win", "B wins (−15%)"], ["worse", "B worse (+15%)"], ["flat", "Flat (0%)"], ["custom", "Custom"]] : [["win", "B wins (+15%)"], ["worse", "B worse (−15%)"], ["flat", "Flat (0%)"], ["custom", "Custom"]]).map(([k, n]) => `<button data-preset="${k}" aria-pressed="${w.preset === k}">${n}</button>`).join("")}</div></div>
      ${F("B's true effect on the primary goal (relative)", `<input type="number" id="w-eff" step="1" value="${w.effectRel}" ${w.preset === "custom" ? "" : "disabled"}>`, "% of A's value")}${F("Random seed", `<input type="number" id="w-seed" value="${w.seed}">`, "same seed, same run")}${F("B's calls are longer by (%)", `<input type="number" id="w-dx" step="1" value="${w.durExtra || 0}">`, "to test a call-length guardrail")}${usesHang ? F("B's early hang-ups are higher by (points)", `<input type="number" id="w-hx" step="0.5" min="0" value="${w.hangExtra || 0}">`, `today ${fmtMetric(baselineFor(metricByKey("early_hangup"), P.seg).value, metricByKey("early_hangup"))} of answered calls`) : ""}</div>`
      : `<div class="banner" style="margin-top:16px"><div>Your plan above is used when the files are read. Next: choose the files on the import screen.</div></div>`}</div></details>
    ${!LIVE && w.source === "sim" ? `<div class="banner warn" style="margin-top:16px"><div><b>Offline.</b> Launch replays the closest pre-computed run under your name. Run <span class="mono">./start.sh</span> to run your exact settings. ${info("The offline file has no engine: it replays B wins, B worse, flat, a win with longer calls, or a win in one segment; your plan fields and metrics are not applied.")}</div></div>` : ""}
    <div id="w-err" class="note" style="color:#b23b3b;margin-top:12px"></div>`;
}
const RULE_FACTS = () => { const r = C.proof && C.proof.rules; return r ? `Measured on identical simulated traffic: both rules keep out a B that is 7 points worse in about ${pct(Math.min(r.harm_sequential, r.harm_final), 0)} of runs, but this one sends about ${pct(Math.max(0, r.exposure_saved), 0)} fewer calls to that B and promotes a real winner about ${r.sooner}% sooner.` : "It reacts sooner than the one-look rule."; };

function saveDraft(w) {
  const copy = JSON.parse(JSON.stringify({ ...w, panel: null, ui: {} })); copy.draftId = w.draftId || "draft-" + Date.now(); w.draftId = copy.draftId;
  const i = DYN.drafts.findIndex(d => d.id === copy.draftId), rec = { id: copy.draftId, name: w.name || "Untitled test", saved: new Date().toISOString().slice(0, 19), w: copy };
  if (i >= 0) DYN.drafts[i] = rec; else DYN.drafts.unshift(rec);
  DYN.libLog.push({ ts: rec.saved, type: "Saved", text: `Draft saved: "${rec.name}". It is editable and has not launched; nothing runs until Launch Test.`, exp: rec.name }); saveDyn();
}
function replayFor(w) {                                  // offline: the closest pre-computed run of the spec's presets
  const eff = (w.effectRel || 0) / 100; let id = eff > 0.05 ? "demo_win" : eff < -0.05 ? "demo_worse" : "demo_flat";
  if ((w.durExtra || 0) >= 8 && eff > 0.05) id = "demo_hold"; else if (eff > 0.05 && wzSeg(w).length) id = "demo_segment"; return C.demo.find(d => d.id === id);
}

ROUTES.new = (el) => {
  if (!WZ) WZ = { ...wzDefaults(), ...(DYN.ui.wizard || {}) };
  const w = WZ; w.ui = w.ui || {}; w.step = Math.min(6, Math.max(1, w.step));
  const drafts = DYN.drafts.length ? `<div class="card" style="margin-bottom:16px"><h3>Saved drafts</h3><div style="display:grid;gap:4px;margin-top:8px">${DYN.drafts.map(d => `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span><b>${esc(d.name)}</b> <span class="note">saved ${esc(fdt(d.saved))}</span></span><span class="actions"><button class="btn sm" data-draft="${esc(d.id)}">Open</button><button class="btn sm" data-draft-del="${esc(d.id)}">Delete</button></span></div>`).join("")}</div></div>` : "";
  const chk = w.step === 6 ? checklist(w) : [], allOk = chk.every(x => x.ok), last = w.step === 6, block2 = w.step === 2 && !!wzValid(w, 2);
  el.innerHTML = head("New Experiment", "Six steps. The setup is locked at launch, so results cannot be bent to fit.") + drafts +
    `<div class="g-main grid"><div class="card" style="min-height:420px" id="w-main">${wzBody(w)}<div class="actions" style="margin-top:24px;justify-content:space-between"><div>${w.step > 1 ? `<button class="btn" id="w-back">Back</button>` : ""}</div><div class="actions">${last ? `<button class="btn" id="w-save">Save Test</button><button class="btn primary" id="w-launch" ${allOk || w.source === "files" ? "" : "disabled"} title="${allOk ? "" : "Every check above must pass"}">${w.source === "files" ? "Continue to import" : w.startDate > TODAY ? "Launch Test (scheduled)" : "Launch Test"}</button>` : `<button class="btn" id="w-save">Save Test</button><button class="btn primary" id="w-next" ${block2 ? "disabled" : ""} title="${block2 ? esc(wzValid(w, 2)) : ""}">Next</button>`}</div></div></div>
      <div class="grid wz-side"><div class="card"><div class="stepper" role="list">${WSTEPS.map((n, i) => `<button class="step ${i + 1 < w.step ? "done" : ""}" role="listitem" data-step="${i + 1}" ${i + 1 === w.step ? 'aria-current="step"' : ""}><span class="n">${i + 1 < w.step ? "✓" : i + 1}</span>${esc(n)}</button>`).join("")}</div></div><div id="w-glance">${glance(w)}</div></div></div>`;
  bindWizard(el, w);
};
/** Redraw the wizard in place: no jump to the top, focus goes back to the same control. */
function wzRedraw() {
  const el = $("#page"), y = scrollY, a = document.activeElement, key = a && (a.id ? "#" + a.id : [...a.attributes].filter(x => x.name.startsWith("data-")).map(x => `[${x.name}="${CSS.escape(x.value)}"]`).join("")), pos = a && "selectionStart" in a ? a.selectionStart : null;
  ROUTES.new(el); scrollTo(0, y);
  if (key) { const n = el.querySelector(key); if (n) { n.focus({ preventScroll: true }); if (pos != null && n.setSelectionRange) try { n.setSelectionRange(pos, pos); } catch (e) { } } }
}
function bindWizard(el, w) {
  const $1 = s => $(s, el), val = id => { const e = $1(id); return e ? e.value : undefined; };
  const save = () => { DYN.ui.wizard = { ...w, panel: null }; saveDyn(); };
  const sync = () => {
    if (w.step === 1) { w.name = val("#w-name"); w.effect = val("#w-effect"); w.change = val("#w-change"); w.why = val("#w-why"); }
    if (w.step === 2 && $1("#w-b")) w.promptB = $1("#w-b").value;
    if (w.step === 5) { if ($1("#w-share")) w.share = Math.min(0.5, Math.max(0.05, Math.round(+val("#w-share") || 0) / 100)); if ($1("#w-clpd")) w.customLpd = +val("#w-clpd"); if ($1("#w-cdays")) w.customDays = +val("#w-cdays"); if ($1("#w-cd")) w.customD = +val("#w-cd");
      if ($1("#w-conf")) { w.confidence = +val("#w-conf"); w.minLeads = +val("#w-min"); w.harm = +val("#w-harm"); w.approval = val("#w-appr"); w.assignment = val("#w-assign"); } const r = $("input[name=w-rule]:checked", el); if (r) w.rule = r.value; }
    if (w.step === 6) { const r = $("input[name=w-src]:checked", el); if (r) w.source = r.value; if ($1("#w-eff")) w.effectRel = +val("#w-eff"); if ($1("#w-seed")) w.seed = +val("#w-seed"); if ($1("#w-dx")) w.durExtra = +val("#w-dx"); if ($1("#w-hx")) w.hangExtra = +val("#w-hx"); if ($1("#w-start") && val("#w-start")) w.startDate = val("#w-start"); }
    if (w.panel) { const d = $1("#w-pdir"); if (d) w.panel.direction = d.value; const l = $1("#w-plim"); if (l) w.panel.limit = +l.value; const k = $1("#w-plimk"); if (k) w.panel.kind = k.value; const q = $1("#w-psearch"); if (q) w.panel.q = q.value; const pk = $("input[name=w-pick]:checked", el); if (pk) w.panel.key = pk.value; }
    if (w.cm) { const n = $1("#w-cmname"); if (n) w.cm.name = n.value; const sv = $1("#w-cmsave"); if (sv) w.cm.save = sv.checked; }
    save();
  };
  const redraw = () => { sync(); wzRedraw(); };
  const fcEl = $1("#w-cm[data-fc]"); if (fcEl) { ["click", "change", "input"].forEach(t => fcEl.addEventListener(t, ev => fcEvent(ev, w, redraw))); fcFillPreview(w.cm); }
  const goStep = t => { sync(); for (let s = w.step; s < t; s++) { const m = wzValid(w, s); if (m) { toast(m); return; } if (s === 3) w.audienceSet = true; if (s === 4 && !w.shareTouched) { const sg = suggestShare(w); w.share = sg.share; w.shareWhy = sg.why; w.shareAuto = true; } } w.step = t; w.panel = null; save(); route(); };
  $$("[data-step]", el).forEach(b => b.onclick = () => { const t = +b.dataset.step; if (t <= w.step) { sync(); w.step = t; w.panel = null; save(); route(); } else goStep(t); });
  $$("[data-goto]", el).forEach(b => b.onclick = () => { sync(); w.step = +b.dataset.goto; save(); route(); });
  const nx = $1("#w-next"); if (nx) nx.onclick = () => goStep(w.step + 1);
  const bk = $1("#w-back"); if (bk) bk.onclick = () => { sync(); w.step--; w.panel = null; save(); route(); };
  const dm = $1("#w-demo"); if (dm) dm.ontoggle = () => { w.ui.demoOpen = dm.open; };
  $$("[data-idea]", el).forEach(b => b.onclick = () => { const c = (C.suggestions || []).find(x => x.id === b.dataset.idea); if (c) { createFrom(c); route(); } });
  const sv = $1("#w-save"); if (sv) sv.onclick = () => { sync(); if (!String(w.name || "").trim()) { toast("Give the test a name first."); w.step = 1; route(); return; } saveDraft(w); toast("Saved as a draft. You can edit it and launch it later."); wzRedraw(); };
  $$("[data-draft]", el).forEach(b => b.onclick = () => { const d = DYN.drafts.find(x => x.id === b.dataset.draft); if (d) { WZ = { ...wzDefaults(), ...JSON.parse(JSON.stringify(d.w)), ui: {} }; route(); } });
  $$("[data-draft-del]", el).forEach(b => b.onclick = () => { DYN.drafts = DYN.drafts.filter(x => x.id !== b.dataset.draftDel); saveDyn(); route(); });

  /* step 2: prompt B, live diff and variable check */
  const ab = $1("#w-abox"); if (ab) ab.ontoggle = () => { w.ui.aOpen = ab.open; if (ab.open && !$1("#w-aview").innerHTML) $1("#w-aview").innerHTML = `<textarea readonly class="prompt-box" rows="16" aria-label="Current prompt A (read-only)">${esc(liveA().text)}</textarea>`; };
  const tb = $1("#w-b"); if (tb) { let tm; tb.oninput = () => { w.promptB = tb.value; $1("#w-bcount").textContent = nf(tb.value.length) + " characters"; clearTimeout(tm); tm = setTimeout(() => { const ps = promptState(w); $1("#w-diff").innerHTML = diffBlock(ps.A.text, ps.B); $1("#w-vc").innerHTML = vcBlock(ps.vc); const m = wzValid(w, 2), n = $1("#w-next"); if (n) { n.disabled = !!m; n.title = m; } save(); }, 200); }; }
  const rs = $1("#w-reset"); if (rs) rs.onclick = () => { w.promptB = liveA().text; save(); wzRedraw(); };

  /* step 3: the segment builder */
  const sa = $1("#w-segadd"); if (sa) sa.onclick = () => { w.segRows.push({ column: "", values: [] }); redraw(); };
  $$("[data-segcol]", el).forEach(s => s.onchange = () => { const r = w.segRows[+s.dataset.segcol]; r.column = s.value; r.values = []; w.ui.openMs = "seg-" + s.dataset.segcol; redraw(); });
  $$("[data-segdel]", el).forEach(b => b.onclick = () => { w.segRows.splice(+b.dataset.segdel, 1); w.ui.openMs = null; redraw(); });

  /* multi-selects (segment values and metric condition values) */
  const msTarget = id => { if (id.startsWith("seg-")) { const r = w.segRows[+id.slice(4)]; return { get: () => r.values, set: v => r.values = v, all: (catVar(r.column) || { values: [] }).values }; }
    const [, side, i] = id.split("-"), c = cmSide(side)[+i]; return { get: () => c.values, set: v => c.values = v, all: (HIST().col[c.col] || { values: [] }).values }; };
  const cmSide = side => side === "num" ? w.cm.num.where : side === "den" ? w.cm.den.where : w.cm.where;
  $$("details.ms", el).forEach(d => d.ontoggle = () => { if (d.open) { w.ui.openMs = d.dataset.ms; $$("details.ms[open]", el).forEach(o => { if (o !== d) o.open = false; }); } else if (w.ui.openMs === d.dataset.ms) w.ui.openMs = null; });
  $$("[data-msv]", el).forEach(c => c.onchange = () => { const t = msTarget(c.dataset.msv), cur = new Set(t.get()); c.checked ? cur.add(c.value) : cur.delete(c.value); t.set(t.all.filter(x => cur.has(x))); w.ui.openMs = c.dataset.msv; redraw(); });
  $$("[data-msall]", el).forEach(c => c.onchange = () => { const t = msTarget(c.dataset.msall); t.set(c.checked ? t.all.slice() : []); w.ui.openMs = c.dataset.msall; redraw(); });
  $$("[data-msq]", el).forEach(q => q.oninput = () => { w.ui.msq = w.ui.msq || {}; w.ui.msq[q.dataset.msq] = q.value; const box = q.closest(".ms-pop"); $$(".ms-list .ms-opt", box).forEach(o => o.hidden = !!q.value && !o.textContent.toLowerCase().includes(q.value.toLowerCase())); });

  /* step 4: the primary goal, metric cards, the add-metric panel, the custom-metric builder */
  const pr = $1("#w-primary"); if (pr) pr.onchange = () => { sync(); w.ui.primAsk = false; w.ui.primEditKey = null; w.ui.primDirEdit = false; if (pr.value === "__custom") { w.ui.primCustom = true; w.cm = newCm(); } else { w.ui.primCustom = false; if (w.primary !== pr.value) w.primaryDir = null; w.primary = pr.value || null; } redraw(); };
  /* save the primary custom metric: a new one goes to the metric list; an edited one keeps its key (and asks first when it is in the list) */
  // twinOk: a per-test copy may count the same thing as the saved metric it came from
  const primDef = twinOk => { if (w.cm && w.cm.type === "sum") { toast("A sum grows with the number of leads each prompt gets, so it cannot decide a test. Use it as a secondary metric."); return null; } const def = cmDef(w.cm), tw = twinOk && metricByKey(twinOk), errs = metricCheck(def).errors.filter(e => !(tw && e === `This counts the same thing as "${tw.name}": use that metric instead.`)), dup = allMetrics(w.localMetrics).find(x => x.key !== def.key && x.name.trim().toLowerCase() === def.name.toLowerCase()); if (errs.length || dup) { toast(errs.length ? errs[0] : "A metric with this name already exists."); return null; } const keep = { ...def, group: "Custom" }; delete keep._edit; return keep; };
  const primDone = (keep, msg) => { w.primary = keep.key; w.primaryDir = null; w.ui.primCustom = false; w.ui.primAsk = false; w.ui.primEditKey = null; w.cm = null; toast(msg); redraw(); };
  const toList = keep => { DYN.settings.customMetrics = [...customMetrics().filter(x => x.key !== keep.key), keep]; };
  const cms = $1("#w-cmsavep"); if (cms) cms.onclick = () => { sync(); const keep = primDef(); if (!keep) return; const ek = w.ui.primEditKey;
    if (ek && (w.localMetrics || []).some(x => x.key === ek)) { w.localMetrics = w.localMetrics.map(x => x.key === ek ? keep : x); primDone(keep, `Saved "${keep.name}" for this test.`); return; }
    if (ek && customMetrics().some(x => x.key === ek)) { w.ui.primAsk = true; redraw(); return; }
    toList(keep); primDone(keep, `Saved "${keep.name}" to the metric list and set it as the primary goal.`); };
  const cmu = $1("#w-cmupd"); if (cmu) cmu.onclick = () => { sync(); const keep = primDef(); if (!keep) return; toList(keep); primDone(keep, `Updated "${keep.name}" in the metric list and in this test.`); };
  const cmo = $1("#w-cmonly"); if (cmo) cmo.onclick = () => { sync(); if (!/\(this test\)$/.test(w.cm.name)) w.cm.name = String(w.cm.name).trim().slice(0, 48) + " (this test)"; const orig = w.ui.primEditKey; w.cm.key = metricKey(w.cm.name) + "_" + Date.now().toString(36); const keep = primDef(orig); if (!keep) return; w.localMetrics = [...(w.localMetrics || []), keep]; primDone(keep, `Saved "${keep.name}" for this test only; the saved metric is unchanged.`); };
  const cmc = $1("#w-cmcancel"); if (cmc) cmc.onclick = () => { w.ui.primCustom = false; w.ui.primAsk = false; w.ui.primEditKey = null; w.cm = null; redraw(); };
  /* the primary card's ⋯ menu: Edit (custom: reopen the builder pre-filled; built-in: a direction for this test) and Change goal */
  const pe = $("[data-pedit]", el); if (pe) pe.onclick = ev => { ev.stopPropagation(); sync(); const m = wzPrimary(w); if (!m) return;
    if (m.custom) { const wh = x => JSON.parse(JSON.stringify(x || [])); w.cm = m.source === "file" ? { ...newFcm(), key: m.key, name: m.name, type: m.type, count: m.count || "calls", direction: m.direction || "higher", dirTouched: true, file: m.file || "", col: m.col || "", num: wh(m.num), den: wh(m.den), denAll: !(m.den || []).length, where: wh(m.where) } : m.type === "rate" ? { ...newCm(), key: m.key, name: m.name, type: "rate", direction: m.direction || "higher", dirTouched: true, num: { unit: (m.num || {}).unit || "calls", where: wh((m.num || {}).where) }, den: { unit: (m.den || {}).unit || "calls", where: wh((m.den || {}).where) }, denAll: !m.den || (m.den.unit === "calls" && !(m.den.where || []).length) }
        : { ...newCm(), key: m.key, name: m.name, type: "average", direction: m.direction || "lower", dirTouched: true, col: m.col, unit: m.unit, where: wh(m.where) };
      w.ui.primCustom = true; w.ui.primEditKey = m.key; w.ui.primAsk = false; }
    else w.ui.primDirEdit = true;
    redraw(); };
  const pchg = $("[data-pchange]", el); if (pchg) pchg.onclick = ev => { ev.stopPropagation(); const d = pchg.closest("details"); if (d) d.open = false; const s = $1("#w-primary"); if (s) { s.focus(); s.scrollIntoView({ block: "center" }); } };
  $$("[data-pdir]", el).forEach(b => b.onclick = () => { sync(); const m = metricByKey(w.primary, w.localMetrics); w.primaryDir = m && (m.direction || "higher") === b.dataset.pdir ? null : b.dataset.pdir; redraw(); });
  const pdd = $1("#w-pdirdone"); if (pdd) pdd.onclick = () => { w.ui.primDirEdit = false; redraw(); };
  const openPanel = (role, edit, idx) => { sync(); const list = role === "guardrail" ? w.guards : w.secondary, item = edit ? list[idx] : null, m = item && metricByKey(item.key, w.localMetrics);
    w.panel = { role: edit ? role : (roleFull(w, "guardrail") ? "secondary" : "guardrail"), origRole: role, idx, edit: !!edit, tab: "list", key: item ? item.key : null, direction: item ? item.direction : "lower", limit: item && item.limit ? item.limit.value : 10, kind: item && item.limit ? item.limit.kind : "rel", q: "" }; w.cm = null; if (m && !m.direction) w.panel.direction = "higher"; save(); wzRedraw(); setTimeout(() => { const p = $("#w-panel"); if (p) p.scrollIntoView({ block: "nearest" }); }, 0); };
  const am = $1("#w-addm"); if (am) am.onclick = () => openPanel("guardrail", false);
  $$("[data-mcard]", el).forEach(c => { const go2 = ev => { if (ev.target.closest("button,details,summary")) return; const [role, i] = c.dataset.mcard.split(":"); openPanel(role, true, +i); }; c.onclick = go2; c.onkeydown = ev => { if (ev.key === "Enter" && ev.target === c) go2(ev); }; });
  $$("[data-mdel]", el).forEach(b => b.onclick = ev => { ev.stopPropagation(); const [role, i] = b.dataset.mdel.split(":"); (role === "guardrail" ? w.guards : w.secondary).splice(+i, 1); w.panel = null; redraw(); });
  $$("[data-mmove]", el).forEach(b => b.onclick = ev => { ev.stopPropagation(); const [role, i] = b.dataset.mmove.split(":"), from = role === "guardrail" ? w.guards : w.secondary, to = role === "guardrail" ? "secondary" : "guardrail"; if (roleFull(w, to)) { toast("Max reached — more metrics mean more false alarms."); return; }
    const [it] = from.splice(+i, 1); if (to === "guardrail") w.guards.push({ key: it.key, direction: it.direction, limit: it.limit || { value: 10, kind: "rel" } }); else w.secondary.push({ key: it.key, direction: it.direction, limit: it.limit }); w.panel = null; redraw(); });
  $$("[data-prole]", el).forEach(b => b.onclick = () => { sync(); w.panel.role = b.dataset.prole; redraw(); });
  $$("[data-ptab]", el).forEach(b => b.onclick = () => { sync(); w.panel.tab = b.dataset.ptab; if (w.panel.tab === "custom" && !w.cm) w.cm = newCm(); redraw(); });
  $$("input[name=w-pick]", el).forEach(r => r.onchange = () => { sync(); const m = metricByKey(r.value, w.localMetrics); w.panel.key = r.value; if (m) w.panel.direction = m.direction || "higher"; save(); wzRedraw(); });
  const ps = $1("#w-psearch"); if (ps) ps.oninput = () => { w.panel.q = ps.value; clearTimeout(window.__pq); window.__pq = setTimeout(wzRedraw, 200); };
  const pc = () => { w.panel = null; w.cm = null; redraw(); }; const px = $1("#w-pclose"); if (px) px.onclick = pc; const pcc = $1("#w-pcancel"); if (pcc) pcc.onclick = pc;
  const pa = $1("#w-padd"); if (pa) pa.onclick = () => { sync(); const p = w.panel; let key = p.key;
    if (p.tab === "custom") { const def = cmDef(w.cm), chk = metricCheck(def); if (!chk.ok) { p.err = chk.errors[0]; redraw(); return; } if (def.type === "sum" && p.role !== "secondary") { p.err = "A sum grows with the number of leads each prompt gets, so it can only be a secondary metric."; redraw(); return; } const keep = { ...def, group: "Custom" }; delete keep._edit; if (w.cm.save) DYN.settings.customMetrics = [...customMetrics().filter(x => x.key !== keep.key), keep]; else w.localMetrics = [...(w.localMetrics || []).filter(x => x.key !== keep.key), keep]; key = keep.key; p.direction = def.direction; }
    if (!key) { p.err = "Choose a metric from the list."; redraw(); return; }
    if (p.role === "guardrail" && !(p.limit > 0)) { p.err = "A guardrail needs a limit above 0."; redraw(); return; }
    if (!p.edit && usedKeys(w).includes(key)) { p.err = "Already added."; redraw(); return; }
    if (roleFull(w, p.role) && !(p.edit && p.origRole === p.role)) { p.err = "Max reached — more metrics mean more false alarms."; redraw(); return; }
    const item = p.role === "guardrail" ? { key, direction: p.direction, limit: { value: +p.limit, kind: p.kind } } : { key, direction: p.direction };
    if (p.edit) (p.origRole === "guardrail" ? w.guards : w.secondary).splice(p.idx, 1);
    if (p.edit && p.origRole === p.role) (p.role === "guardrail" ? w.guards : w.secondary).splice(p.idx, 0, item); else (p.role === "guardrail" ? w.guards : w.secondary).push(item);
    w.panel = null; w.cm = null; redraw(); };
  /* the custom-metric builder's controls */
  $$("[data-cmtype]", el).forEach(b => b.onclick = () => { sync(); w.cm.type = b.dataset.cmtype; if (w.cm.type === "average" && w.cm.direction === "higher" && !w.cm.dirTouched) w.cm.direction = "lower"; redraw(); });
  $$("[data-cmdir]", el).forEach(b => b.onclick = () => { sync(); w.cm.direction = b.dataset.cmdir; w.cm.dirTouched = true; redraw(); });
  $$("[data-cmunit]", el).forEach(s => s.onchange = () => { sync(); const k = s.dataset.cmunit; if (k === "avg") w.cm.unit = s.value; else w.cm[k].unit = s.value; redraw(); });
  $$("input[name=w-cmden]", el).forEach(r => r.onchange = () => { sync(); w.cm.denAll = r.value === "all"; if (!w.cm.denAll && !w.cm.den.where.length) w.cm.den.where.push({ col: "", op: "is", values: [] }); redraw(); });
  const cc = $1("#w-cmcol"); if (cc) cc.onchange = () => { sync(); w.cm.col = cc.value; redraw(); };
  $$("[data-cadd]", el).forEach(b => b.onclick = () => { sync(); cmSide(b.dataset.cadd).push({ col: "", op: "is", values: [] }); redraw(); });
  $$("[data-cdel]", el).forEach(b => b.onclick = () => { sync(); const [side, i] = b.dataset.cdel.split(":"); cmSide(side).splice(+i, 1); redraw(); });
  $$("[data-ccol]", el).forEach(s => s.onchange = () => { sync(); const [side, i] = s.dataset.ccol.split(":"), c = cmSide(side)[+i]; c.col = s.value; c.values = []; redraw(); });
  $$("[data-cop]", el).forEach(s => s.onchange = () => { sync(); const [side, i] = s.dataset.cop.split(":"), c = cmSide(side)[+i]; c.op = s.value; if (c.op === "is" && c.values.length > 1) c.values = c.values.slice(0, 1); redraw(); });
  $$("[data-cval]", el).forEach(s => s.onchange = () => { sync(); const [side, i] = s.dataset.cval.split(":"); cmSide(side)[+i].values = s.value ? [s.value] : []; redraw(); });
  const cn = $1("#w-cmname"); if (cn) { let t; cn.oninput = () => { w.cm.name = cn.value; clearTimeout(t); t = setTimeout(() => { const prev = $1("#w-cmprev"); if (prev && w.cm.src === "file") { fcFillPreview(w.cm); return; } if (prev) { const chk = metricCheck(cmDef(w.cm)); prev.className = "cm-prev " + (chk.ok ? "" : "bad"); if (!chk.ok) prev.innerHTML = chk.errors.map(esc).join("<br>"); else wzRedraw(); } }, 300); }; }

  /* step 5: duration */
  const ln = $1("#w-len"); if (ln) ln.onchange = () => { sync(); w.lenMode = ln.value; if (w.lenMode === "custom") { const P = wzPlan({ ...w, lenMode: "rec" }); w.customDays = P.rec; w.customLpdTouched = false; w.customDTouched = false; } redraw(); };
  $$("[data-size]", el).forEach(b => b.onclick = () => { sync(); w.size = b.dataset.size; redraw(); });
  ["#w-share", "#w-clpd", "#w-cdays", "#w-cd", "#w-conf", "#w-min", "#w-harm", "#w-appr", "#w-assign", "#w-start", "#w-eff", "#w-seed", "#w-dx", "#w-hx"].forEach(id => { const e = $1(id); if (e) e.onchange = () => {
    const v = +e.value;
    if (id === "#w-share") { w.shareTouched = true; w.shareAuto = false; if (!(e.value !== "" && v >= 5 && v <= 50 && Number.isInteger(v))) toast(`B's share must be a whole percent from 5 to 50; it is set to ${Math.min(50, Math.max(5, Math.round(v) || 5))}%.`, 4500); }
    if (id === "#w-clpd") { if (v > 0) w.customLpdTouched = true; else { toast("Leads per day must be above 0; it is back to the value from the data.", 4500); w.customLpdTouched = false; } }
    if (id === "#w-cd") { const m = wzRef(w); if (v > 0) { w.customDTouched = true; w.customDType = m.type; } else { toast("The improvement to catch must be above 0; it is back to the preset.", 4500); w.customDTouched = false; } }
    if (id === "#w-min" && !(v >= 20)) toast("The minimum leads per arm must be at least 20.", 4500);
    redraw(); }; });
  $$("input[name=w-rule],input[name=w-src]", el).forEach(r => r.onchange = redraw);
  const adv = $1("#w-adv"); if (adv) adv.ontoggle = () => { w.ui.advOpen = adv.open; };
  $$("[data-preset]", el).forEach(b => b.onclick = () => { sync(); w.preset = b.dataset.preset; if (w.preset !== "custom") w.effectRel = { win: 15, worse: -15, flat: 0 }[w.preset]; redraw(); });

  /* launch */
  const L = $1("#w-launch"); if (L) L.onclick = async () => {
    sync(); for (let s = 1; s <= 5; s++) { const m = wzValid(w, s); if (m) { w.step = s; toast(m); route(); return; } }
    const P = wzPlan(w), seg = P.seg, tm = testMetrics(w), A = liveA(), B = wzB(w);
    if (w.source === "files") { DYN.ui.importPlan = { baseline: P.m.type === "rate" ? P.base.value : 0.45, share_b: w.share, mde: P.m.type === "rate" ? P.d : 0.05, window_days: P.days, rule_set: w.rule, name: w.name }; saveDyn(); go("import"); return; }
    const scheduled = w.startDate > TODAY, startIso = w.startDate + "T09:00:00";
    const finish = (exp) => { exp.world = "main"; exp.audience = seg.length ? seg : null; exp.scheduled = scheduled; exp.sched_date = scheduled ? startIso : null; exp.segment_text = segDescribe(seg); exp.prompt_b = B; exp.prompt_a = { id: A.id, hash: A.hash };
      exp.plan = { metrics: tm.map(x => ({ role: x.role, key: x.key, name: x.m.name, def: x.m, direction: x.direction, limit: x.limit || null })), days: P.days, share: w.share, improvement: P.d, baseline: P.base.value, lpd: P.lpd };
      DYN.launched.unshift(exp); DYN.dyn[exp.id] = { day: 1, paused: false, approval: null, rolledBack: false, manualStop: false, learning: "", started: !scheduled, hold: 0 };
      if (w.draftId) DYN.drafts = DYN.drafts.filter(d => d.id !== w.draftId); WZ = null; DYN.ui.wizard = null; saveDyn(); };
    if (!LIVE) {
      const src = replayFor(w), rec = JSON.parse(JSON.stringify(src.record)); rec.config.name = w.name;
      const id = "replay-" + Date.now(), exp = { id, kind: "simulated", preset: src.preset, replay_of: src.id, hypothesis: [w.change, w.why, w.effect && "Expected: " + w.effect].filter(Boolean).join(" "), truth: src.truth, start_day: 1, record: rec };
      finish(exp); toast(scheduled ? `Scheduled for ${fdate(startIso)}. Press Start now to play it in this demo.` : "Launched offline: replaying the closest pre-computed run.", 4200); go("live", id); return;
    }
    L.disabled = true; L.innerHTML = `<span class="spin"></span> Running the engine...`;
    try {
      const body = { name: w.name, hypothesis: [w.change, w.why, w.effect && "Expected: " + w.effect].filter(Boolean).join(" "), prompt_b: B, prompt_a: A.text, prompt_a_version: A.id, share_b: w.share, window_days: P.days, improvement: P.d, leads_per_day: P.lpd,
        segment: seg.length ? seg : null, metrics: tm.map(x => ({ role: x.role, ...(x.m.custom ? { def: { ...x.m, direction: x.direction } } : { key: x.key, direction: x.direction }), ...(x.role === "guardrail" ? { limit: x.limit } : {}) })),
        confidence: w.confidence, min_leads_per_arm: w.minLeads, rule_set: w.rule, harm_bar: w.harm, approval: w.approval, assignment: seg.length ? "stratified" : w.assignment,
        effect_rel: (w.preset !== "custom" && P.dir === "lower" ? -w.effectRel : w.effectRel) / 100, dur_mult: 1 + (w.durExtra || 0) / 100, hang_extra_pp: tm.some(x => x.key === "early_hangup") ? (w.hangExtra || 0) : 0, seed: w.seed, preset: { win: "B wins", worse: "B worse", flat: "Flat", custom: "Custom" }[w.preset], start: startIso };
      const r = await fetch("/api/wizard", { method: "POST", body: JSON.stringify(body) }), j = await r.json(); if (j.error) throw new Error(j.error);
      j.start_day = 1; finish(j);
      toast(scheduled ? `Scheduled for ${fdate(startIso)}; config version ${j.record.config.version || 1} (${j.record.config_hash}) is locked.` : `Launched and locked: config version ${j.record.config.version || 1} (${j.record.config_hash}).`, 4200); go("live", j.id);
    } catch (err) { L.disabled = false; L.textContent = "Launch Test"; $1("#w-err").textContent = String(err.message || err); }
  };
}
document.addEventListener("click", ev => { $$("details.ms[open],details.kebab[open]").forEach(d => { if (!d.contains(ev.target)) { d.open = false; if (WZ && WZ.ui && WZ.ui.openMs === d.dataset.ms) WZ.ui.openMs = null; } }); });
