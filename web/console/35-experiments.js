/* All experiments: one list for running, draft and finished tests (it replaces Live Experiments and History). Filters and sort live in the URL
   (#/experiments?status=running&q=...), so a filtered list can be shared or bookmarked. A row opens the test's page (#/experiments/<id>). */

const EXP_ST = [["running", "Running", "run"], ["paused", "Paused", "plain"], ["draft", "Draft", "plain"], ["scheduled", "Scheduled", "plain"], ["promoted", "Promoted", "pos"],
  ["stopped_worse", "Stopped: B worse", "neg"], ["stopped_guard", "Stopped: guardrail", "neg"], ["stopped_person", "Stopped by a person", "neg"], ["inconclusive", "Inconclusive", "plain"],
  ["held", "Held for approval", "warn"], ["rejected", "Rejected", "plain"], ["halted", "Halted", "warn"], ["rolled_back", "Rolled back", "warn"]];
const ST_LABEL = Object.fromEntries(EXP_ST.map(x => [x[0], x[1]])), ST_CLASS = Object.fromEntries(EXP_ST.map(x => [x[0], x[2]]));
const FINISHED = ["promoted", "stopped_worse", "stopped_guard", "stopped_person", "inconclusive", "rejected", "halted", "rolled_back"];
const STOPPED = ["stopped_worse", "stopped_guard", "stopped_person"];
/** Status chips above the table: the three kinds of stop count as one chip. */
const ST_CHIPS = [["Running", ["running"]], ["Paused", ["paused"]], ["Draft", ["draft"]], ["Scheduled", ["scheduled"]], ["Held for approval", ["held"]], ["Promoted", ["promoted"]], ["Stopped", STOPPED], ["Inconclusive", ["inconclusive"]], ["Rejected", ["rejected"]], ["Rolled back", ["rolled_back"]], ["Halted", ["halted"]]];
const ST_RANK = { running: 0, paused: 1, draft: 2, scheduled: 3, held: 4 };
const EXP_PAGE = 20;

function expStatus(v) {
  if (v.scheduled) return "scheduled";
  if (v.d.paused && !v.ended) return "paused";
  if (v.kind === "HOLD_FOR_APPROVAL") return "held";
  if (!v.ended) return "running";
  return { PROMOTE: "promoted", ROLLED_BACK: "rolled_back", STOP_HARM: "stopped_worse", LOSS: "stopped_worse", STOP_GUARDRAIL: "stopped_guard", STOPPED_MANUAL: "stopped_person", INCONCLUSIVE: "inconclusive", REJECTED: "rejected", HALT_SRM: "halted" }[v.kind] || "inconclusive";
}
const srcOf = e => e.kind === "files" ? "file" : isPast(e) ? "sim" : "here";
const SRC_LABEL = { here: "Played here", sim: "Simulated", file: "From file" };
const addDays = (iso, n) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString(); };

/** One row per test and per saved draft, with everything the table, the filters, the sort and the CSV need. */
function expRows() {
  const rows = EXPS().map(e => {
    const v = view(e), c = v.config, cur = v.cur, st = expStatus(v), lr = cur ? liftRange(cur, c) : null, g = guardOverall(v);
    const end = v.ended ? ((v.res && v.res.time) || addDays(c.start, v.ld - 1)) : null;
    return { id: e.id, e, v, st, name: c.name, start: c.start, end, days: v.ended ? v.ld : v.win, seg: segRules(c.segment).length > 0, aud: segRules(c.segment).length ? segDescribe(c.segment) : "All traffic",
      metricKey: c.primary_goal || primaryDef(c).key, metric: goalName(c), a: cur ? cur.rateA : null, b: cur ? cur.rateB : null, lift: cur ? cur.diff : null, lo: lr ? lr.lo : null, hi: lr ? lr.hi : null,
      guard: !cur || !guardList(v).length ? "—" : g.cls === "pos" ? "Pass" : g.cls === "neg" ? "Fail" : "—", src: srcOf(e) };
  });
  (DYN.drafts || []).forEach(d => { const w = d.w || {}, seg = segFromRows(w.segRows || []).seg, m = w.primary ? metricByKey(w.primary, w.localMetrics) : null;
    rows.push({ id: d.id, draft: d, st: "draft", name: d.name || w.name || "Untitled draft", start: d.saved || null, end: null, days: null, seg: segRules(seg).length > 0, aud: segRules(seg).length ? segDescribe(seg) : "All traffic",
      metricKey: w.primary || "", metric: m ? m.name : "—", a: null, b: null, lift: null, lo: null, hi: null, guard: "—", src: "here" }); });
  return rows;
}

/** The list's state, read from and written to the URL. */
function expState() {
  const q = CUR.query || new URLSearchParams(), list = k => (q.get(k) || "").split(",").filter(Boolean);
  let status = list("status"); if (status.includes("finished")) status = [...new Set([...status.filter(x => x !== "finished"), ...FINISHED])];
  if (status.includes("stopped")) status = [...new Set([...status.filter(x => x !== "stopped"), ...STOPPED])];
  return { q: q.get("q") || "", status, from: q.get("from") || "", to: q.get("to") || "", metric: q.get("metric") || "", aud: q.get("aud") || "", src: q.get("src") || "", sort: q.get("sort") || "", dir: +(q.get("dir") || -1), page: Math.max(0, +(q.get("page") || 1) - 1), open: q.get("open") || "" };
}
function expHref(s) {
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q); if (s.status.length) p.set("status", s.status.join(",")); if (s.from) p.set("from", s.from); if (s.to) p.set("to", s.to);
  if (s.metric) p.set("metric", s.metric); if (s.aud) p.set("aud", s.aud); if (s.src) p.set("src", s.src); if (s.sort) { p.set("sort", s.sort); p.set("dir", s.dir); } if (s.page) p.set("page", s.page + 1);
  const t = p.toString(); return "#/experiments" + (t ? "?" + t : "");
}
const expGo = s => { location.hash = expHref(s); };

function expFilter(rows, s, skipStatus) {
  const q = s.q.trim().toLowerCase();
  return rows.filter(r => {
    if (q && !(r.name + " " + ((r.e && r.e.hypothesis) || "")).toLowerCase().includes(q)) return false;
    if (!skipStatus && s.status.length && !s.status.includes(r.st)) return false;
    const day = (r.start || "").slice(0, 10);
    if (s.from && (!day || day < s.from)) return false; if (s.to && (!day || day > s.to)) return false;
    if (s.metric && r.metricKey !== s.metric) return false;
    if (s.aud === "all" && r.seg) return false; if (s.aud === "seg" && !r.seg) return false;
    if (s.src && r.src !== s.src) return false;
    return true;
  });
}
const EXP_SORT = { status: r => (ST_RANK[r.st] ?? 5) * 100 + EXP_ST.findIndex(x => x[0] === r.st), name: r => r.name.toLowerCase(), progress: r => r.start || "", aud: r => r.aud, metric: r => r.metric, ab: r => r.b ?? -1e9, lift: r => r.lift ?? -1e9, guard: r => r.guard };
function expSort(rows, s) {
  if (!s.sort) return rows.sort((x, y) => { const a = ST_RANK[x.st] ?? 5, b = ST_RANK[y.st] ?? 5; if (a !== b) return a - b; const ex = x.end || x.start || "", ey = y.end || y.start || ""; return ex < ey ? 1 : ex > ey ? -1 : 0; });
  const k = EXP_SORT[s.sort] || EXP_SORT.name;
  return rows.sort((x, y) => { const a = k(x), b = k(y); return (a < b ? -1 : a > b ? 1 : 0) * s.dir; });
}

function progressCell(r) {
  if (r.draft) return `<span class="note">Not launched</span>`;
  const v = r.v;
  if (r.st === "scheduled") return `Starts ${fdate(r.e.sched_date || r.start)}`;
  if (["running", "paused", "held"].includes(r.st)) return `<div class="rc-day"><span>${r.st === "paused" ? "Paused on day" : "Day"} <b>${v.day}</b> of ${v.win}</span></div><div class="bar thin"><i style="width:${Math.min(100, v.day / v.win * 100)}%"></i></div>${r.st === "held" ? `<div class="note">waiting for a yes</div>` : ""}`;
  return `<span style="white-space:nowrap">${fdate(r.start)} – ${fdate(r.end)}</span><div class="note">${r.days} day${r.days === 1 ? "" : "s"}</div>`;
}
function liftCell(r) {
  if (r.lift == null) return "—";
  const c = r.v.config;
  return `<b>${fmtD(r.lift, c)}</b><div class="note">${c.metrics ? rangeD(r.lo, r.hi, c) : `${sgn(r.lo * 100, 1)} to ${sgn(r.hi * 100, 1)} pp`}</div>`;
}

ROUTES.experiments = (el, arg) => {
  if (arg) {
    const d = (DYN.drafts || []).find(x => x.id === arg);
    if (d) { WZ = { ...wzDefaults(), ...JSON.parse(JSON.stringify(d.w)) }; location.replace("#/new"); return; }
    return expDetail(el, arg);
  }
  const s = expState(), all = expRows(), base = expFilter(all, s, true), rows = expSort(base.filter(r => !s.status.length || s.status.includes(r.st)), s);
  const pages = Math.max(1, Math.ceil(rows.length / EXP_PAGE)), page = Math.min(s.page, pages - 1), shown = rows.slice(page * EXP_PAGE, page * EXP_PAGE + EXP_PAGE);
  const chips = ST_CHIPS.map(([label, keys]) => [label, keys, base.filter(r => keys.includes(r.st)).length]).filter(x => x[2] > 0);
  const chipOn = keys => s.status.length && keys.every(k => s.status.includes(k)) && s.status.every(k => keys.includes(k));
  const metrics = [...new Map(all.filter(r => r.metricKey).map(r => [r.metricKey, r.metric])).entries()];
  const any = s.q || s.status.length || s.from || s.to || s.metric || s.aud || s.src;
  const th = (k, label, cls = "") => `<th class="${cls}" aria-sort="${s.sort === k ? (s.dir > 0 ? "ascending" : "descending") : "none"}"><button data-esort="${k}">${label}${s.sort === k ? (s.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`;
  const sel = (id, label, cur, opts) => `<div class="field"><label for="${id}">${label}</label><select id="${id}">${opts.map(([k, n]) => `<option value="${esc(k)}" ${cur === k ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div>`;
  const stSummary = s.status.length ? (s.status.length <= 2 ? s.status.map(k => ST_LABEL[k]).join(", ") : `${s.status.length} statuses`) : "All statuses";
  el.innerHTML = head("All experiments", "Running, draft and finished tests in one list. Open a row for its day-by-day view.", `${clockButtons()}<button class="btn" id="x-csv">Export CSV</button><a class="btn primary" href="#/new">New experiment</a>`) +
    `<div class="filters xfilters"><div class="field grow"><label for="x-q">Search</label><input type="search" id="x-q" value="${esc(s.q)}" placeholder="Search by name"></div>
      <div class="field"><label>Status</label><details class="ms" id="x-st" ${s.open === "status" ? "open" : ""}><summary><span>${esc(stSummary)}</span></summary><div class="ms-pop">${EXP_ST.map(([k, n]) => `<label class="chk"><input type="checkbox" data-xst="${k}" ${s.status.includes(k) ? "checked" : ""}> ${esc(n)}</label>`).join("")}</div></details></div>
      <div class="field"><label>Date range</label><details class="ms" id="x-dt" ${s.open === "date" ? "open" : ""}><summary><span>${s.from || s.to ? `${s.from ? fdate(s.from) : "Any"} – ${s.to ? fdate(s.to) : "Any"}` : "Any date"}</span></summary><div class="ms-pop"><label class="note">Started from<input type="date" id="x-from" value="${esc(s.from)}"></label><label class="note">to<input type="date" id="x-to" value="${esc(s.to)}"></label></div></details></div>
      ${sel("x-met", "Primary metric", s.metric, [["", "All metrics"], ...metrics])}${sel("x-aud", "Audience", s.aud, [["", "Any audience"], ["all", "All traffic"], ["seg", "Segmented"]])}${sel("x-src", "Source", s.src, [["", "Any source"], ["here", "Played here"], ["sim", "Simulated"], ["file", "From file"]])}
      <div class="field"><label>&nbsp;</label><button class="btn" id="x-clear" ${any ? "" : "disabled"}>Clear filters</button></div></div>
    <div class="st-chips">${chips.map(([label, keys, n], i) => `<button class="st-chip ${chipOn(keys) ? "on" : ""}" data-xchip="${i}">${esc(label)} <b>${n}</b></button>`).join("")}</div>
    ${shown.length ? `<div class="tbl-wrap"><table class="xtable"><thead><tr>${th("status", "Status")}${th("name", "Test name")}${th("progress", "Progress")}${th("aud", "Audience")}${th("metric", "Primary metric")}${th("ab", "A vs B", "num")}${th("lift", "Lift (range)", "num")}${th("guard", "Guardrails")}<th>Actions</th></tr></thead><tbody>
      ${shown.map(r => `<tr class="click" data-xrow="${esc(r.id)}"><td>${pill(ST_LABEL[r.st], ST_CLASS[r.st])}</td><td><b><a href="#/experiments/${encodeURIComponent(r.id)}">${esc(r.name)}</a></b> <span class="tag">${esc(SRC_LABEL[r.src])}</span></td>
        <td>${progressCell(r)}</td><td>${r.draft || !r.seg ? esc(r.aud) : segChips(r.v.config.segment)}</td><td>${esc(r.metric)}</td>
        <td class="num" style="white-space:nowrap">${r.a == null ? "—" : `${fmtP(r.a, r.v.config)} → ${fmtP(r.b, r.v.config)}`}</td><td class="num">${liftCell(r)}</td>
        <td>${r.guard === "Pass" ? pill("Pass", "pos") : r.guard === "Fail" ? pill("Fail", "neg") : `<span class="note">—</span>`}</td>
        <td>${r.draft ? `<a class="btn sm" href="#/experiments/${encodeURIComponent(r.id)}">Open</a>` : `<button class="btn sm" data-xclone="${esc(r.id)}">Clone</button>`}</td></tr>`).join("")}</tbody></table></div>
      <div class="pager"><span>${rows.length} test${rows.length === 1 ? "" : "s"}${any ? " match" : ""}</span><span><button class="btn sm" id="x-prev" ${page ? "" : "disabled"}>Previous</button> Page ${page + 1} of ${pages} <button class="btn sm" id="x-next" ${page < pages - 1 ? "" : "disabled"}>Next</button></span></div>`
      : `<div class="empty">No test matches. <button class="link" id="x-clear2">Clear the filters</button>.</div>`}`;
  const set = (patch, keepOpen) => expGo({ ...s, page: 0, open: keepOpen || "", ...patch });
  bindClock(el);
  $("#x-q").oninput = ev => { clearTimeout(window.__xq); window.__xq = setTimeout(() => { set({ q: ev.target.value }); setTimeout(() => { const n = $("#x-q"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 0); }, 300); };
  $$("[data-xst]", el).forEach(b => b.onchange = () => { const k = b.dataset.xst; set({ status: b.checked ? [...s.status, k] : s.status.filter(x => x !== k) }, "status"); });
  const fr = $("#x-from"), to = $("#x-to"); fr.onchange = () => set({ from: fr.value }, "date"); to.onchange = () => set({ to: to.value }, "date");
  $("#x-met").onchange = ev => set({ metric: ev.target.value }); $("#x-aud").onchange = ev => set({ aud: ev.target.value }); $("#x-src").onchange = ev => set({ src: ev.target.value });
  const clear = () => expGo({ q: "", status: [], from: "", to: "", metric: "", aud: "", src: "", sort: s.sort, dir: s.dir, page: 0 });
  $("#x-clear").onclick = clear; const c2 = $("#x-clear2"); if (c2) c2.onclick = clear;
  $$("[data-xchip]", el).forEach(b => b.onclick = () => { const keys = chips[+b.dataset.xchip][1]; set({ status: chipOn(keys) ? [] : keys.slice() }); });
  $$("[data-esort]", el).forEach(b => b.onclick = () => { const k = b.dataset.esort; expGo({ ...s, sort: k, dir: s.sort === k ? -s.dir : (k === "name" || k === "status" ? 1 : -1), page: 0 }); });
  $$("[data-xclone]", el).forEach(b => b.onclick = ev => { ev.stopPropagation(); cloneOf(byId(b.dataset.xclone)); });
  $$("tr[data-xrow]", el).forEach(r => r.onclick = ev => { if (!ev.target.closest("a,button")) go("experiments", r.dataset.xrow); });
  const pv = $("#x-prev"), nx = $("#x-next"); if (pv) pv.onclick = () => expGo({ ...s, page: page - 1 }); if (nx) nx.onclick = () => expGo({ ...s, page: page + 1 });
  $("#x-csv").onclick = () => download("picky_experiments.csv", toCsv(["status", "name", "source", "start", "end", "days", "audience", "primary_metric", "a", "b", "lift", "range_low", "range_high", "guardrails"],
    rows.map(r => { const avg = r.v && primaryDef(r.v.config).type === "average", val = x => x == null ? "" : avg ? (+x).toFixed(3) : (x * 100).toFixed(2);
      return [ST_LABEL[r.st], r.name, SRC_LABEL[r.src], (r.start || "").slice(0, 10), (r.end || "").slice(0, 10), r.days == null ? "" : r.days, r.aud, r.metric, val(r.a), val(r.b), val(r.lift), val(r.lo), val(r.hi), r.guard]; })));
};

/** A finished test's page opens with its final report: the decision, the numbers and the plain-English summary. */
function finalReportCard(e, v) {
  const c = v.config, cur = v.cur, lr = liftRange(cur, c), avg = primaryDef(c).type === "average";
  return `<div class="card final-rep" id="final-report" style="margin-bottom:16px"><div class="sec-row"><h2>Final report</h2><div class="actions"><button class="btn" id="a-clone">Clone</button><a class="btn" href="#/report/${encodeURIComponent(e.id)}">Print view</a></div></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">${pill(KIND_LABEL[v.kind] || v.kind, KIND_CLASS[v.kind])}<span class="note">${fdate(c.start)} · ${v.ld} day${v.ld === 1 ? "" : "s"}</span></div>
    <p style="margin-top:8px">${esc(plainSummary(e))}</p>
    <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th></th><th class="num">Leads</th><th class="num">${avg ? "Average" : "Rate"}</th><th class="num">95% range</th></tr></thead><tbody>
      <tr><td><span class="dot a"></span>A: today's prompt</td><td class="num">${nf(cur.nA)}</td><td class="num">${fmtP(cur.rateA, c)}</td><td class="num">${(([lo, hi]) => `${fmtP(lo, c)} to ${fmtP(hi, c)}`)(armCI(cur, "A", c))}</td></tr>
      <tr><td><span class="dot b"></span>B: new prompt</td><td class="num">${nf(cur.nB)}</td><td class="num">${fmtP(cur.rateB, c)}</td><td class="num">${(([lo, hi]) => `${fmtP(lo, c)} to ${fmtP(hi, c)}`)(armCI(cur, "B", c))}</td></tr>
      <tr><td><b>Lift of B over A</b></td><td></td><td class="num"><b>${fmtD(cur.diff, c)}</b></td><td class="num">${rangeD(lr.lo, lr.hi, c)}${lr.interim ? " (interim)" : ""}</td></tr></tbody></table></div></div>`;
}
