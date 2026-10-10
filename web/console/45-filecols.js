/* The custom metric builder on the real columns of the data files in the resources folder (canary/filecatalog.py scans them; the bundle carries
   only column names, types and category values, never rows). The preview is measured on the file by the local server, so the file stays on this
   machine; the saved definition (file, column, operator, value) is what the engine, the test page and the reports read. */

const FCAT = () => (C && C.file_catalog) || { files: [], columns: [] };
const hasFileCols = () => FCAT().columns.some(c => c.linkable !== false && ["number", "category", "date", "text"].includes(c.type));
const FC_OPS = {
  number: [["=", "="], ["!=", "≠"], [">", ">"], [">=", "≥"], ["<", "<"], ["<=", "≤"], ["between", "between"]],
  category: [["is", "is"], ["is_not", "is not"], ["in", "is one of"]],
  date: [["before", "before"], ["after", "after"], ["between", "between"]],
  text: [["contains", "contains"], ["not_contains", "does not contain"]] };
const fcCol = (file, col) => FCAT().columns.find(c => c.file === file && c.column === col) || null;
const fcLabel = c => (fcCol(c.file, c.col) || { label: c.col }).label;
const fcOpWord = op => (Object.values(FC_OPS).flat().find(x => x[0] === op) || [op, op])[1];
const fcCondWords = c => { const v = c.values || []; return `${fcLabel(c)} ${fcOpWord(c.op)} ${c.op === "between" ? `${v[0]} and ${v[1]}` : c.op === "in" ? v.join(", ") : c.value != null && c.value !== "" ? c.value : v[0] || ""}`; };
/** The formula in plain words, the same way the built-in metrics read. */
function fcWords(m) {
  const unit = m.count === "leads" ? "Leads" : "Calls", side = (list, all) => list && list.length ? `${unit} where ${list.map(fcCondWords).join(" and ")}` : all;
  if (m.type === "rate") return `${side(m.num, unit)} ÷ ${side(m.den, `All ${unit.toLowerCase()}`)}`;
  return `${m.type === "sum" ? "Total" : "Average"} ${fcLabel({ file: m.file, col: m.col }).toLowerCase()} over ${unit.toLowerCase()}${m.where && m.where.length ? " where " + m.where.map(fcCondWords).join(" and ") : ""}`;
}
const newFcm = () => ({ src: "file", name: "", type: "rate", count: "calls", num: [{ file: "", col: "", op: "", value: "", values: [] }], den: [], denAll: true, file: "", col: "", where: [], direction: "higher", save: true });
/** The saved definition. It carries the baseline measured on the file, so Duration and At a glance work without the server. */
function fcDef(cm) {
  const cond = c => ({ file: c.file, col: c.col, op: c.op, value: c.value, values: (c.values || []).slice() }), first = [...cm.num, ...cm.where, { file: cm.file }].find(c => c.file) || {};
  const d = { source: "file", key: cm.key || metricKey(cm.name), name: String(cm.name || "").trim(), type: cm.type, count: cm.count, unit: cm.count, direction: cm.direction, file: cm.type === "rate" ? first.file : cm.file };
  if (cm.type === "rate") { d.num = cm.num.map(cond); d.den = cm.denAll ? [] : cm.den.map(cond); } else { d.col = cm.col; d.where = cm.where.map(cond); }
  const pv = fcPrevCached(d); if (pv && pv.ok) d.base = { value: pv.value, sd: pv.sd, num: pv.num, den: pv.den, window: pv.window };
  return d;
}
/** Checks that need no data: columns from the catalog, operators that fit the column's type, values filled in. */
function fcCheckShape(m) {
  const errs = [];
  const conds = (list, label, needOne) => {
    if (needOne && !(list || []).length) errs.push(`${label}: add at least one condition.`);
    for (const c of list || []) {
      const col = fcCol(c.file, c.col); if (!col) { errs.push(`${label}: choose a column.`); continue; }
      if (col.linkable === false) errs.push(`${label}: ${col.label} can't be linked to calls.`);
      if (!(FC_OPS[col.type] || []).some(o => o[0] === c.op)) { errs.push(`${label}: choose a comparison that fits ${col.label} (${col.type}).`); continue; }
      const vals = c.op === "between" || c.op === "in" ? c.values || [] : [c.value];
      if (!vals.length || vals.some(v => v == null || String(v).trim() === "") || (c.op === "between" && vals.length < 2)) errs.push(`${label}: fill in the value for ${col.label}.`);
      else if (col.type === "number" && vals.some(v => isNaN(+v))) errs.push(`${label}: ${col.label} needs a number.`);
      else if (col.type === "category" && vals.some(v => !(col.values || []).includes(String(v)))) errs.push(`${label}: a value is not in ${col.label}.`);
    }
  };
  const files = new Set([...(m.num || []), ...(m.den || []), ...(m.where || []), m.type === "rate" ? {} : { file: m.file }].map(c => c.file).filter(Boolean));
  if (files.size > 1) errs.push("Use columns from one file in a metric.");
  if (!String(m.name || "").trim()) errs.push("Give the metric a name.");
  else if (allMetrics().some(x => x.key !== m.key && x.name.trim().toLowerCase() === m.name.trim().toLowerCase())) errs.push("A metric with this name already exists.");
  if (m.type === "rate") { conds(m.num, "Numerator", true); conds(m.den, "Denominator", false); }
  else { const col = fcCol(m.file, m.col); if (!col) errs.push(`Choose a number column to ${m.type === "sum" ? "add up" : "average"}.`); else if (col.type !== "number") errs.push(`${col.label} is not a number column.`); conds(m.where, "Condition", false); }
  return [...new Set(errs)];
}
/* ---- the preview, measured on the file by the local server (aggregates only) */
const _fcPrev = new Map();
const fcPrevKey = d => JSON.stringify([d.type, d.count, d.num, d.den, d.file, d.col, d.where]);
const fcPrevCached = d => _fcPrev.get(fcPrevKey(d)) || null;
async function fcMeasure(d) {
  const k = fcPrevKey(d); if (_fcPrev.has(k)) return _fcPrev.get(k);
  let out;
  try { const r = await fetch("/api/filecatalog/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ def: { ...d, name: d.name || "Preview" } }) }); out = await r.json(); }
  catch (err) { out = { ok: false, errors: ["Could not reach the local server."] }; }
  if (out && (out.ok || (out.errors || []).length)) _fcPrev.set(k, out);
  return out;
}
/** Every check, for Save: the shape here, then the measured ones (denominator above 0, a rate within 0 to 100%). */
function fcCheck(m) {
  const errs = fcCheckShape(m); if (errs.length) return { ok: false, errors: errs };
  if (!LIVE) return { ok: false, errors: ["Measuring a metric on the file needs the local server (./start.sh): the file stays on this machine."] };
  const pv = fcPrevCached(m); if (!pv) return { ok: false, errors: ["Measuring on the file..."] };
  if (!pv.ok) return { ok: false, errors: pv.errors || ["The metric could not be measured."] };
  if (!(pv.den > 0)) return { ok: false, errors: ["The denominator is 0 in the last 30 days: nothing would be counted."] };
  if (m.type === "rate" && (pv.value < 0 || pv.value > 1)) return { ok: false, errors: [`This rate comes to ${(pv.value * 100).toFixed(0)}%: a rate must lie between 0 and 100%. Make the numerator count a part of the denominator.`] };
  return { ok: true, errors: [], ev: pv };
}
const fcFmt = (v, m) => v == null || isNaN(v) ? "-" : m.type === "rate" ? `${(v * 100).toFixed(1)}%` : `${(+v).toLocaleString("en-US", { maximumFractionDigits: 1 })}${(fcCol(m.file, m.col) || {}).unit ? " " + fcCol(m.file, m.col).unit : ""}`;
function fcPrevHtml(d, pv) {
  const win = pv.window ? `${fdate(pv.window.from)} to ${fdate(pv.window.to)}` : "last 30 days";
  return d.type === "rate" ? `Last 30 days (${win}), all traffic in ${esc(d.file)}: ${nf(pv.num)} ÷ ${nf(pv.den)} = <b>${fcFmt(pv.value, d)}</b>`
    : `Last 30 days (${win}), all traffic in ${esc(d.file)}: ${d.type === "sum" ? "total" : "average"} <b>${fcFmt(pv.value, d)}</b> over ${nf(pv.den)} ${d.count}`;
}
/** Fills the preview box once the server answers; the builder itself never waits. */
async function fcFillPreview(cm) {
  const box = $("#w-cmprev"); if (!box) return;
  const d = fcDef(cm), shape = fcCheckShape({ ...d, name: d.name || "x" });
  if (shape.length) { box.className = "cm-prev bad"; box.innerHTML = shape.map(esc).join("<br>"); return; }
  if (!LIVE) { box.className = "cm-prev"; box.innerHTML = `Formula: ${esc(fcWords(d))}<br><span class="note">The preview is measured on the file by the local server (./start.sh), so the file stays on this machine.</span>`; return; }
  box.className = "cm-prev"; box.innerHTML = `Formula: ${esc(fcWords(d))} · measuring on the file...`;
  const pv = await fcMeasure(d), now = $("#w-cmprev"); if (!now || fcPrevKey(fcDef(cm)) !== fcPrevKey(d)) return;
  const chk = fcCheck({ ...fcDef(cm), name: d.name || "x" });
  now.className = "cm-prev " + (chk.ok ? "" : "bad"); now.innerHTML = chk.ok ? `Formula: ${esc(fcWords(d))} · ${fcPrevHtml(d, pv)}` : chk.errors.map(esc).join("<br>");
}

/* ---- the builder */
const TTAG = t => `<span class="ttag t-${esc(t)}">${esc(t)}</span>`;
function fcColPick(id, cur, onlyNumber) {
  const files = FCAT().files, curCol = cur && cur.col ? fcCol(cur.file, cur.col) : null, open = WZ && WZ.ui.fcOpen === id;
  const usable = c => !["empty"].includes(c.type) && (!onlyNumber || c.type === "number");
  return `<details class="ms colpick" data-fcpick="${esc(id)}" ${open ? "open" : ""}><summary><span>${curCol ? `${esc(curCol.label)} ${TTAG(curCol.type)}` : onlyNumber ? "Number column" : "Column"}</span></summary><div class="ms-pop">
    <input type="search" class="ms-q" data-fcq="${esc(id)}" placeholder="Search columns" aria-label="Search columns">
    ${files.map(f => { const cols = FCAT().columns.filter(c => c.file === f.file && usable(c)); if (!cols.length) return "";
      return `<div class="cp-file"><div class="mgroup-h">${esc(f.file)}${f.linkable === false ? ` <span class="note">(can't be linked to calls)</span>` : ""}</div>${cols.map(c => { const off = c.linkable === false || c.type === "id";
        return `<button type="button" class="cp-col" data-fccol="${esc(id)}" data-file="${esc(c.file)}" data-col="${esc(c.column)}" ${off ? "disabled" : ""} title="${esc(c.linkable === false ? "Can't be linked to calls" : c.type === "id" ? "An ID: it links files, it is not counted" : c.column)}"><span>${esc(c.label)}</span>${TTAG(c.type)}</button>`; }).join("")}</div>`; }).join("")}</div></details>`;
}
function fcValue(id, c) {
  const col = fcCol(c.file, c.col); if (!col || !c.op) return `<span class="note">${col ? "Choose a comparison" : "Choose a column"}</span>`;
  const v = c.values || [];
  if (col.type === "number") return c.op === "between" ? `<input type="number" data-fcv="${id}:0" value="${esc(v[0] ?? "")}" aria-label="From" style="width:90px"> and <input type="number" data-fcv="${id}:1" value="${esc(v[1] ?? "")}" aria-label="To" style="width:90px">` : `<input type="number" data-fcv="${id}" value="${esc(c.value ?? "")}" aria-label="Value" style="width:110px">`;
  if (col.type === "date") return c.op === "between" ? `<input type="date" data-fcv="${id}:0" value="${esc(v[0] || "")}" aria-label="From"> and <input type="date" data-fcv="${id}:1" value="${esc(v[1] || "")}" aria-label="To">` : `<input type="date" data-fcv="${id}" value="${esc(c.value || "")}" aria-label="Date">`;
  if (col.type === "text") return `<input type="text" data-fcv="${id}" value="${esc(c.value || "")}" placeholder="text" aria-label="Text">`;
  if (c.op === "in") { const open = WZ && WZ.ui.fcOpen === "in:" + id;
    return `<details class="ms" data-fcin-box="${id}" ${open ? "open" : ""}><summary><span>${v.length ? esc(v.length <= 3 ? v.join(", ") : `${v.length} of ${col.values.length} selected`) : "Choose values"}</span></summary><div class="ms-pop">${col.values.map(x => `<label class="chk"><input type="checkbox" data-fcin="${id}" value="${esc(x)}" ${v.includes(x) ? "checked" : ""}> ${esc(x)}</label>`).join("")}</div></details>`; }
  return `<select data-fcv="${id}" aria-label="Value"><option value="">Value</option>${col.values.map(x => `<option ${c.value === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
}
function fcConds(side, list) {
  return `${list.map((c, i) => { const id = `${side}:${i}`, col = fcCol(c.file, c.col);
    return `<div class="cond-row">${fcColPick(id, c)}<select data-fcop="${id}" aria-label="Comparison" ${col ? "" : "disabled"}><option value="">Comparison</option>${(FC_OPS[col ? col.type : ""] || []).map(([k, n]) => `<option value="${k}" ${c.op === k ? "selected" : ""}>${n}</option>`).join("")}</select>
      ${fcValue(id, c)}<button class="x" data-fcdel="${id}" aria-label="Remove this condition" title="Remove">×</button></div>`; }).join("")}
    ${list.length < 3 ? `<button class="btn sm" data-fcadd="${side}">+ Add condition</button>` : `<span class="note">At most 3 conditions (joined with AND).</span>`}`;
}
function fcBuilder(w, cm, forPrimary) {
  const unitSel = key => `<select data-fcunit="${key}" aria-label="Count calls or leads"><option value="calls" ${cm.count === "calls" ? "selected" : ""}>calls</option><option value="leads" ${cm.count === "leads" ? "selected" : ""}>leads</option></select>`;
  const sumNote = cm.type === "sum" && forPrimary ? `<p class="note" style="color:#b23b3b">A sum grows with the number of leads each prompt gets, so it cannot decide a test. Use it as a secondary metric.</p>` : "";
  return `<div class="cm" id="w-cm" data-fc="1"><div class="form-grid">${F("Metric name", `<input type="text" id="w-cmname" value="${esc(cm.name)}" placeholder="Calls over 3 min %" maxlength="60">`)}
      <div class="field"><label>Type</label><div class="seg" role="group" aria-label="Type"><button data-fctype="rate" aria-pressed="${cm.type === "rate"}">Rate (%)</button><button data-fctype="average" aria-pressed="${cm.type === "average"}">Average</button><button data-fctype="sum" aria-pressed="${cm.type === "sum"}">Sum</button></div></div></div>
    <p class="note" style="margin:4px 0 8px">Columns come from the files in the resources folder (${FCAT().files.map(f => esc(f.file)).join(", ")}). ${info("Each file is read and its column types are inferred from the first 1,000 rows. Files are joined to calls by lead or call id. Rescan in Settings > Metrics when a file is added or changed.")}</p>
    ${cm.type === "rate" ? `<div class="cm-side"><div class="cm-lbl"><b>Numerator:</b> count of ${unitSel("num")} where</div>${fcConds("num", cm.num)}</div>
      <div class="cm-side"><div class="cm-lbl"><b>Denominator:</b> <label class="chk"><input type="radio" name="w-fcden" value="all" ${cm.denAll ? "checked" : ""}> all ${cm.count}</label> <label class="chk"><input type="radio" name="w-fcden" value="custom" ${cm.denAll ? "" : "checked"}> count of ${cm.count} where</label></div>${cm.denAll ? "" : fcConds("den", cm.den)}</div>`
    : `<div class="cm-side"><div class="cm-lbl"><b>${cm.type === "sum" ? "Total" : "Average"}</b> of ${fcColPick("col", { file: cm.file, col: cm.col }, true)} over ${unitSel("avg")} where (optional)</div>${fcConds("where", cm.where)}</div>${sumNote}`}
    <div class="field" style="margin-top:12px"><label>Better direction</label><div class="seg" role="group" aria-label="Better direction"><button data-cmdir="higher" aria-pressed="${cm.direction === "higher"}">↑ Higher is better</button><button data-cmdir="lower" aria-pressed="${cm.direction === "lower"}">↓ Lower is better</button></div></div>
    ${forPrimary ? "" : `<label class="chk" style="margin-top:12px"><input type="checkbox" id="w-cmsave" ${cm.save ? "checked" : ""}> Save to metric list for future tests</label>`}
    <div class="cm-prev" id="w-cmprev" aria-live="polite"></div></div>`;
}
/** Events of the builder, delegated on the wizard's page; `redraw` redraws the wizard. Returns true when it handled the event. */
function fcEvent(ev, w, redraw) {
  const cm = w.cm; if (!cm || cm.src !== "file") return false;
  const t = ev.target, ds = t.dataset || {}, at = id => { const [side, i] = id.split(":"); return side === "col" ? null : cm[side][+i]; };
  if (ev.type === "click") {
    const b = t.closest("[data-fctype],[data-fccol],[data-fcadd],[data-fcdel]"); if (!b) return false; ev.preventDefault();
    if (b.dataset.fctype) { cm.type = b.dataset.fctype; if (cm.type === "rate" && !cm.num.length) cm.num.push({ file: "", col: "", op: "", value: "", values: [] }); }
    else if (b.dataset.fccol) { const id = b.dataset.fccol, file = b.dataset.file, col = b.dataset.col; w.ui.fcOpen = null;
      if (id === "col") { cm.file = file; cm.col = col; } else { const c = at(id), type = (fcCol(file, col) || {}).type; Object.assign(c, { file, col, op: (FC_OPS[type] || [[""]])[0][0], value: "", values: [] }); } }
    else if (b.dataset.fcadd) cm[b.dataset.fcadd].push({ file: "", col: "", op: "", value: "", values: [] });
    else if (b.dataset.fcdel) { const [side, i] = b.dataset.fcdel.split(":"); cm[side].splice(+i, 1); }
    redraw(); return true;
  }
  if (ev.type === "input" && ds.fcq != null) { const q = t.value.trim().toLowerCase(); t.closest(".ms-pop").querySelectorAll(".cp-col").forEach(x => { x.hidden = !!q && !x.textContent.toLowerCase().includes(q) && !x.dataset.col.toLowerCase().includes(q); }); return true; }
  if (ev.type !== "change") return false;
  if (ds.fcop) { const c = at(ds.fcop); c.op = t.value; c.value = ""; c.values = []; redraw(); return true; }
  if (ds.fcv) { const [side, i, k] = ds.fcv.split(":"), c = cm[side][+i]; if (k != null) { c.values = c.values || []; c.values[+k] = t.value; } else { c.value = t.value; c.values = [t.value]; } redraw(); return true; }
  if (ds.fcin) { const c = at(ds.fcin); c.values = [...t.closest(".ms-pop").querySelectorAll("input:checked")].map(x => x.value); w.ui.fcOpen = "in:" + ds.fcin; redraw(); return true; }
  if (ds.fcunit) { cm.count = t.value; redraw(); return true; }
  if (t.name === "w-fcden") { cm.denAll = t.value === "all"; if (!cm.denAll && !cm.den.length) cm.den.push({ file: "", col: "", op: "", value: "", values: [] }); redraw(); return true; }
  return false;
}
