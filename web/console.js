/* GENERATED from web/console/*.js by canary.build.assemble_console_js: edit the parts, not this file. */
"use strict";
/* Canary console. Plain JS, no libraries, works offline. Every number shown comes from the bundle the Python engine produced
   (dist/canary_demo.html embeds it; live mode fetches /api/console). Demo state (how many days have been played, approvals, rollbacks)
   lives in this browser only and is reset from Settings. */

const LIVE = !!window.CANARY_LIVE;
let C = window.CONSOLE_DATA || null;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nf = n => (n == null || isNaN(n)) ? "-" : Math.round(n).toLocaleString("en-US");
const pct = (x, d = 0) => (x == null || isNaN(x)) ? "-" : (x * 100).toFixed(d) + "%";
const pts = (x, d = 1) => (x == null || isNaN(x)) ? "-" : (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(d) + " pp";
const sgn = (x, d = 1) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(d);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fdate = iso => { const d = new Date(iso); return isNaN(d) ? "-" : `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
const fdt = iso => { const d = new Date(iso); return isNaN(d) ? "-" : `${fdate(iso)}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };
const toast = (msg, ms = 3200) => { const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); };
const download = (name, text, type = "text/csv") => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
const csvCell = v => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (head, rows) => [head.map(csvCell).join(","), ...rows.map(r => r.map(csvCell).join(","))].join("\n");

/* ------------------------------------------------------------------ sha256 (pure JS: works on file://) - re-checks the decision record in the browser */
function sha256(str) {
  const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const bytes = new TextEncoder().encode(str), l = bytes.length, total = ((l + 9 + 63) >> 6) << 6, buf = new Uint8Array(total); buf.set(bytes); buf[l] = 0x80;
  const dv = new DataView(buf.buffer); dv.setUint32(total - 4, (l * 8) >>> 0); dv.setUint32(total - 8, Math.floor(l / 0x20000000));
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]), w = new Uint32Array(64), rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const s0 = rr(w[i-15],7) ^ rr(w[i-15],18) ^ (w[i-15] >>> 3), s1 = rr(w[i-2],17) ^ rr(w[i-2],19) ^ (w[i-2] >>> 10); w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0; }
    let [a, b, c, d, e, f, g, hh] = H;
    for (let i = 0; i < 64; i++) { const S1 = rr(e,6) ^ rr(e,11) ^ rr(e,25), ch = (e & f) ^ (~e & g), t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0, S0 = rr(a,2) ^ rr(a,13) ^ rr(a,22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) >>> 0; hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += hh;
  }
  return [...H].map(x => x.toString(16).padStart(8, "0")).join("");
}
function chainOk(entries) { let prev = "0".repeat(64); for (const e of entries) { if (e.prev !== prev || sha256(prev + e.body) !== e.hash) return false; prev = e.hash; } return true; }

/* ------------------------------------------------------------------ statistics helpers (display only: decisions come from the engine) */
function wilson(x, n, z = 1.96) { if (!n) return [0, 1]; const p = x / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; }
function erfc(x) { const t = 1 / (1 + 0.5 * Math.abs(x)), r = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))); return x >= 0 ? r : 2 - r; }
const normCdf = z => 0.5 * erfc(-z / Math.SQRT2);
const normPpf = p => { // Acklam's approximation
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239], b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572],
    c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783], d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425; let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
};
/** Leads needed in total to detect a lift (two proportions, one-sided alpha). `seq` adds the 6% a repeatedly checked test needs. */
function leadsNeeded(pA, lift, shareB, alpha, power, seq) {
  const pB = Math.min(Math.max(pA + lift, 1e-4), 1 - 1e-4), z = normPpf(1 - alpha) + normPpf(power), v = pA * (1 - pA) / (1 - shareB) + pB * (1 - pB) / shareB;
  return z * z * v / (lift * lift) * (seq ? 1.06 : 1);
}
function detectableLift(n, pA, shareB, alpha, power, seq) { let lo = 1e-4, hi = Math.min(0.9, 1 - pA - 1e-3); for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (leadsNeeded(pA, m, shareB, alpha, power, seq) > n) lo = m; else hi = m; } return (lo + hi) / 2; }

/* ------------------------------------------------------------------ experiments and their demo state */
const SK = "canary_console_v1";
const DYN = store.get(SK, { dyn: {}, launched: [], settings: {}, libLog: [], ui: {} });
const saveDyn = () => store.set(SK, DYN);
const SET = () => ({ ...C.defaults, ...DYN.settings });
const EXPS = () => [...C.demo, ...DYN.launched, ...C.past];
const byId = id => EXPS().find(e => e.id === id);
const isPast = e => e.id.startsWith("past_") || e.id.startsWith("files_");
const dyn = e => (DYN.dyn[e.id] = DYN.dyn[e.id] || { day: e.kind === "simulated" && e.start_day ? e.start_day : isPast(e) ? 9999 : 1, paused: false,
  approval: isPast(e) && e.record.result.kind === "HOLD_FOR_APPROVAL" ? "rejected" : null,       // history samples are already settled: a person kept A
  rolledBack: false, manualStop: false, learning: "" });

/** Day-by-day rows of a record: the last look of each day. */
function dayRows(rec) { const m = new Map(); rec.looks.forEach(r => m.set(r.day, r)); return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([day, row]) => ({ day, row })); }
const lastDay = e => { const r = dayRows(e.record); return r.length ? r[r.length - 1].day : 0; };
const windowDays = e => e.record.config.window_days;
const KIND_LABEL = { PROMOTE: "Promoted", STOP_HARM: "Stopped: B worse", STOP_GUARDRAIL: "Stopped: guardrail", HOLD_FOR_APPROVAL: "Held for approval", INCONCLUSIVE: "Inconclusive, keep A", HALT_SRM: "Halted: broken test", CONTINUE: "Running", STOPPED_MANUAL: "Stopped by a person", REJECTED: "Rejected: kept A", ROLLED_BACK: "Promoted, then rolled back" };
const KIND_CLASS = { PROMOTE: "pos", STOP_HARM: "neg", STOP_GUARDRAIL: "neg", HOLD_FOR_APPROVAL: "warn", INCONCLUSIVE: "plain", HALT_SRM: "warn", CONTINUE: "run", STOPPED_MANUAL: "neg", REJECTED: "plain", ROLLED_BACK: "warn" };

/** 95% range of the lift. The engine's range is used when it is usable (the end-of-test call, or an always-valid look); on early looks of the
    one-look rule the engine range is deliberately infinite, so a plain interim range is shown and labelled as such. */
function liftRange(row) {
  const w = row.rci ? Math.abs(row.rci[1] - row.rci[0]) : 9;
  if (row.rci && w <= 0.6 && row.eff <= 50) return { lo: row.rci[0], hi: row.rci[1], interim: false };
  const se = Math.sqrt(row.rateA * (1 - row.rateA) / Math.max(1, row.nA) + row.rateB * (1 - row.rateB) / Math.max(1, row.nB));
  return { lo: row.diff - 1.96 * se, hi: row.diff + 1.96 * se, interim: true };
}
/** One guardrail's state, used by the Live tile, the History column and the report so they can never disagree. */
function guardStatus(g, margin, kind, v) {
  const rel = kind === "rel", f = x => rel ? sgn(x * 100, 0) + "%" : sgn(x * 100, 1) + " pp", lim = rel ? "+" + (margin * 100).toFixed(0) + "%" : "+" + (margin * 100).toFixed(0) + " pp";
  if (!g) return { label: "Not enough data", cls: "warn", short: "Not proven", value: "-", range: "", lim, f };
  const lo = g.worse - 1.96 * g.se, hi = g.worse + 1.96 * g.se, bad = g.z_breach >= (v.cur ? v.cur.harm : 99), decided = v.decided;
  const stoppedElsewhere = decided && ["STOP_HARM", "HALT_SRM"].includes(v.res.kind);
  let label, cls, short;
  if (bad) { label = "\u2715 Fail: limit breached"; cls = "neg"; short = "Fail: breached"; }
  else if (stoppedElsewhere) { label = "Not evaluated: the test stopped on another rule"; cls = "plain"; short = "n/a (stopped)"; }
  else if (decided) { if (hi < margin) { label = "\u2713 Pass: proven within the limit"; cls = "pos"; short = "Pass"; } else { label = "\u2715 Not proven within the limit"; cls = "warn"; short = "Not proven"; } }
  else if (hi < margin) { label = "\u2713 Within the limit so far"; cls = "pos"; short = "Within the limit so far"; }
  else if (lo > margin) { label = "\u2715 Over the limit so far"; cls = "neg"; short = "Over the limit so far"; }
  else { label = "\u2026 Not yet proven"; cls = "warn"; short = "Not yet proven"; }
  return { label, cls, short, value: f(g.worse), range: `${f(lo)} to ${f(hi)}`, lim, f };
}
function guardList(v) {
  const c = v.config, cur = v.cur, out = [];
  if (c.secondary_role === "guardrail") out.push({ name: "Call duration", st: guardStatus(cur && cur.guardrail, c.guardrail_margin, "rel", v), g: cur && cur.guardrail });
  if (c.guard_rate) out.push({ name: c.guard_rate.replace(/_/g, " ").replace(/^./, x => x.toUpperCase()), st: guardStatus(cur && cur.guardrail2, c.guard_rate_margin, "pts", v), g: cur && cur.guardrail2 });
  return out;
}
function guardOverall(v) {
  const l = guardList(v); if (!l.length) return { short: "n/a", cls: "plain" };
  const worst = l.find(x => x.st.cls === "neg") || l.find(x => x.st.cls === "warn") || l.find(x => x.st.cls === "plain") || l[0];
  return { short: l.length > 1 && worst.st.cls !== "pos" ? worst.name + ": " + worst.st.short : worst.st.short, cls: worst.st.cls };
}

/** Everything the screens need about one experiment at its current demo day. */
function view(e) {
  const d = dyn(e), rec = e.record, res = rec.result, ld = lastDay(e), win = windowDays(e);
  const day = Math.min(d.day, Math.max(ld, 1));
  const decided = res.status !== "running" && day >= ld;                       // the engine's call becomes visible on its day
  let kind = decided ? res.kind : "CONTINUE";
  if (d.manualStop && !decided) kind = "STOPPED_MANUAL";
  if (decided && kind === "HOLD_FOR_APPROVAL" && d.approval === "approved") kind = "PROMOTE";
  if (decided && kind === "HOLD_FOR_APPROVAL" && d.approval === "rejected") kind = "REJECTED";
  if (kind === "PROMOTE" && d.rolledBack) kind = "ROLLED_BACK";
  const finished = decided && !(kind === "HOLD_FOR_APPROVAL") || d.manualStop;
  const rows = dayRows(rec).filter(r => r.day <= day);
  const cur = rows.length ? rows[rows.length - 1].row : null;
  const ended = finished || (decided && kind === "HOLD_FOR_APPROVAL");
  let status;
  if (d.manualStop && !decided) status = ["Stopped by a person", "neg"];
  else if (kind === "HOLD_FOR_APPROVAL") status = ["Ready to decide", "warn"];
  else if (ended) status = [KIND_LABEL[kind] || kind, KIND_CLASS[kind] || "plain"];
  else if (d.paused) status = ["Paused", "plain"];
  else if (cur && cur.z <= -1.96) status = ["Watch: B looks worse", "warn"];
  else status = ["On track", "run"];
  return { d, rec, res, day, ld, win, decided, kind, finished: !!finished, ended, rows, cur, status, running: !ended && !d.paused, config: rec.config };
}
/** The event that makes a held test promote (a person's approval) counts as a promotion at that time. */
function promotedExperiments() {
  const out = [];
  EXPS().filter(e => !isPast(e)).forEach(e => { const v = view(e); if (v.decided && (v.res.kind === "PROMOTE" || (v.res.kind === "HOLD_FOR_APPROVAL" && v.d.approval === "approved"))) out.push({ e, v, time: v.res.time }); });
  return out.sort((a, b) => a.time < b.time ? -1 : 1);
}

/* ------------------------------------------------------------------ events (the Decision Log): the engine's own record, plus the console's actions */
const EV_TYPES = ["Started", "Harm alert", "Stopped", "Promoted", "Approved", "Rejected", "Rolled back", "Held", "Inconclusive", "Halted", "Paused", "Resumed"];
function eventsFor(e) {
  const v = view(e), rec = e.record, out = [], name = rec.config.name, id = e.id;
  const tail = v.d.approval === "approved" ? (rec.tails || {}).approve : v.d.approval === "rejected" ? (rec.tails || {}).reject : (v.d.rolledBack ? (rec.tails || {}).rollback : null);
  const push = (ts, type, text, hash) => out.push({ ts, type, text, hash: hash ? hash.slice(0, 10) : "", exp: name, id });
  const visibleUntilDay = v.day;
  for (const ent of rec.ledger) {
    const b = JSON.parse(ent.body), p = b.payload;
    if (b.type === "look") continue;
    if (b.type === "experiment_created") { push(b.ts, "Started", `Started ${p.config.rule_set === "final_look" ? "(one winner call on the last day)" : "(early promote and early stop)"}; config version ${p.config_version} (${p.config_hash}); locked.`, ent.hash); continue; }
    if (b.type === "routing_changed" && b.seq <= 1) continue;
    if (!v.decided) continue;
    if (b.type === "decision") {
      if (p.kind === "STOP_HARM") { push(b.ts, "Harm alert", p.reason, ent.hash); }
      else if (p.kind === "STOP_GUARDRAIL") { push(b.ts, "Harm alert", "Guardrail breached. " + p.reason, ent.hash); }
      const t = { PROMOTE: "Promoted", STOP_HARM: "Stopped", STOP_GUARDRAIL: "Stopped", HOLD_FOR_APPROVAL: "Held", INCONCLUSIVE: "Inconclusive", HALT_SRM: "Halted" }[p.kind] || p.kind;
      push(b.ts, t, p.kind === "PROMOTE" || p.kind === "HOLD_FOR_APPROVAL" || p.kind === "INCONCLUSIVE" || p.kind === "HALT_SRM" ? p.reason : "B stopped; its leads go back to A.", ent.hash);
    } else if (b.type === "promotion") push(b.ts, "Promoted", `Production prompt ${p.production_before.slice(0, 7)} → ${p.production_after.slice(0, 7)} (${p.approval}).`, ent.hash);
    else if (b.type === "approval_requested") push(b.ts, "Held", "Approval requested. Callers are unaffected while a person decides.", ent.hash);
  }
  if (tail) for (const ent of tail) {
    const b = JSON.parse(ent.body), p = b.payload;
    if (b.type === "approval") push(b.ts, p.action === "approved" ? "Approved" : "Rejected", `${p.action[0].toUpperCase() + p.action.slice(1)} by ${p.by}${p.simulated ? " (a demo click)" : ""}.`, ent.hash);
    else if (b.type === "promotion") push(b.ts, "Promoted", `Production prompt ${p.production_before.slice(0, 7)} → ${p.production_after.slice(0, 7)} (${p.approval}).`, ent.hash);
    else if (b.type === "rollback") push(b.ts, "Rolled back", `${p.reason} (${p.by}${p.simulated ? ", a demo click" : ""}).`, ent.hash);
  }
  (v.d.console || []).forEach(x => out.push({ ts: x.ts, type: x.type, text: x.text, hash: "", exp: name, id }));
  return out.filter(x => x.type !== "Started" || true);
}
const allEvents = () => EXPS().flatMap(eventsFor).concat((DYN.libLog || []).map(x => ({ ...x, exp: x.exp || "Prompt Library", id: "" }))).sort((a, b) => a.ts < b.ts ? 1 : -1);
const nowTs = e => { const v = view(e); return (v.cur && v.cur.time) || e.record.config.start; };

/* ------------------------------------------------------------------ routing and shell */
const NAV = [["overview", "Overview"], ["new", "New Experiment"], ["live", "Live Experiments"], ["history", "History"], ["suggest", "Suggest A/B Tests"], ["library", "Prompt Library"], ["log", "Decision Log"], ["settings", "Settings"]];
const ROUTES = {};
let CUR = { name: "overview", arg: null };
function route() {
  const h = (location.hash || "#/overview").replace(/^#\/?/, "").split("/");
  const name = ROUTES[h[0]] ? h[0] : "overview"; CUR = { name, arg: h[1] ? decodeURIComponent(h[1]) : null };
  render();
}
const go = (name, arg) => { location.hash = "#/" + name + (arg ? "/" + encodeURIComponent(arg) : ""); };
function render() {
  const run = EXPS().filter(e => view(e).running || view(e).kind === "HOLD_FOR_APPROVAL" && !view(e).d.approval).length;
  $("#nav").innerHTML = NAV.map(([k, n]) => `<a href="#/${k}" ${CUR.name === k || (k === "history" && CUR.name === "report") ? 'aria-current="page"' : ""}><span>${n}</span>${k === "live" ? `<span class="count" title="Tests running or waiting for a person">${run}</span>` : ""}</a>`).join("");
  const fn = ROUTES[CUR.name]; $("#page").innerHTML = ""; fn($("#page"), CUR.arg);
  scrollTo(0, 0); document.title = `Canary - ${(NAV.find(n => n[0] === CUR.name) || ["", "Report"])[1]}`;
}
const head = (title, sub, actions = "") => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div><div class="actions">${actions}</div></div>`;
const pill = (txt, cls) => `<span class="pill ${cls || ""}">${esc(txt)}</span>`;
const statusPill = v => pill(v.status[0], v.status[1]);

/* a small tooltip */
const tip = (() => { const el = document.createElement("div"); el.className = "tip"; el.hidden = true; document.addEventListener("DOMContentLoaded", () => document.body.appendChild(el)); return { show(html, ev) { el.innerHTML = html; el.hidden = false; const r = el.getBoundingClientRect(); let x = ev.clientX + 14, y = ev.clientY + 14; if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14; if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14; el.style.left = x + "px"; el.style.top = y + "px"; }, hide() { el.hidden = true; } }; })();

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
  const lift = (last.rateB - last.rateA) * 100, lr = liftRange(last);
  const rng = ` The true difference is probably between ${sgn(lr.lo * 100, 0)} and ${sgn(lr.hi * 100, 0)} points${lr.interim ? " (an interim range: the test stopped before its final call)" : ""}.`;
  const nums = `Over ${v.ld} day${v.ld === 1 ? "" : "s"}, ${pct(last.rateB)} of ${nf(last.nB)} leads on the new prompt reached the goal (${goal}) against ${pct(last.rateA)} of ${nf(last.nA)} on today's prompt: ${sgn(lift, 0)} points.${rng}`;
  const g = last.guardrail ? ` Average call length was ${sgn(last.guardrail.rel_change * 100, 0)}% against a limit of +${(c.guardrail_margin * 100).toFixed(0)}%.` : "";
  const src = e.kind === "files" ? " These results came from a file supplied by the voice platform." : " These results are simulated with a known injected effect; they show the engine decides correctly, not that a real prompt is better.";
  const k = v.kind;
  const verdict = { PROMOTE: "Decision: promote B to all traffic. The evidence is strong enough that luck is an unlikely explanation and the guardrail holds.", STOP_HARM: "Decision: stop B early and send its leads back to A. B is clearly worse.", STOP_GUARDRAIL: "Decision: stop B. It breaks a guardrail even if the goal improved.",
    HOLD_FOR_APPROVAL: "Decision: hold for a person. B wins on the goal but a guardrail is not proven. Nothing has changed for callers.", INCONCLUSIVE: "Decision: inconclusive, keep A. The test found no evidence of a difference; that is not proof of none.", HALT_SRM: "Decision: halted. The test itself is broken (the split or the log), so nothing can be trusted.",
    REJECTED: "Decision: a person rejected the held change. A stays live.", ROLLED_BACK: "Decision: B was promoted and then rolled back by a person.", STOPPED_MANUAL: "Decision: a person stopped the test early." }[k] || "No decision yet.";
  const more = k === "INCONCLUSIVE" && r.more_leads && r.more_leads.options ? " " + r.more_leads.options.map(o => o.enough_already ? `There was already enough data to detect ${o.lift_pp} points, so any real lift is smaller.` : `Detecting ${o.lift_pp} points would take about ${nf(o.more_leads)} more leads (about ${o.more_days} days).`).slice(0, 2).join(" ") : "";
  return `${verdict} ${nums}${g}${more}${src}`;
}

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

/* Live Experiments: results up to yesterday, day by day, then the engine's call. Follows the spec's "Live Experiment page" table. */

const DECISION_ROWS = [
  { k: ["PROMOTE"], goal: "B significantly better", guard: "OK", dec: "Promote B to 100%" },
  { k: ["HOLD_FOR_APPROVAL"], goal: "B significantly better", guard: "Broken or not proven", dec: "Hold for approval" },
  { k: ["INCONCLUSIVE", "REJECTED"], goal: "No significant difference", guard: "Any", dec: "Inconclusive, keep A" },
  { k: ["STOP_HARM"], goal: "B clearly worse (any day)", guard: "Any", dec: "Stop B early, move its leads back to A" },
  { k: ["STOP_GUARDRAIL"], goal: "Any", guard: "Clearly broken", dec: "Stop B" },
  { k: ["HALT_SRM"], goal: "Test itself is broken", guard: "-", dec: "Halt: fix the split or the log, rerun" }];

function logAction(e, type, text) { const d = dyn(e); d.console = d.console || []; d.console.push({ ts: nowTs(e), type, text }); }

function guardTile(item) {
  const st = item.st, tipText = "A guardrail is a metric B must not make worse. It can stop B or hold it for a person even if the goal improves.";
  if (!item.g) return `<div class="card kpi" title="${tipText}"><div class="k">${esc(item.name)} (guardrail)</div><div class="v" style="font-size:26px">-</div><div class="d">Not enough data yet</div><div>${pill(st.label, st.cls)}</div></div>`;
  return `<div class="card kpi" title="${tipText}"><div class="k">${esc(item.name)} (guardrail)</div><div class="v" style="font-size:26px">${st.value}</div><div class="d">${item.name === "Call duration" ? "B's calls vs A's" : "B vs A"}; 95% range ${st.range}; limit ${st.lim}</div><div>${pill(st.label, st.cls)}</div></div>`;
}

ROUTES.live = (el, arg) => {
  const exps = EXPS(), vs = exps.map(e => [e, view(e)]);
  const order = [...vs.filter(([e, v]) => v.running), ...vs.filter(([e, v]) => v.d.paused && !v.ended), ...vs.filter(([e, v]) => v.kind === "HOLD_FOR_APPROVAL" && !v.d.approval), ...vs.filter(([e, v]) => v.ended)];
  const uniq = [...new Map(order.map(x => [x[0].id, x])).values()];
  const pick = arg ? byId(arg) : (uniq[0] || [])[0];
  if (!pick) { el.innerHTML = head("Live Experiments", "Progressive results up to yesterday, and the day-by-day decision.") + `<div class="empty">Nothing here yet. <a href="#/new">Start a new experiment</a>.</div>`; return; }
  const v = view(pick), c = v.config, rec = pick.record, cur = v.cur, d = v.d;
  const groups = [["Running", uniq.filter(([e, x]) => x.running || x.d.paused && !x.ended)], ["Waiting for a person", uniq.filter(([e, x]) => x.kind === "HOLD_FOR_APPROVAL" && !x.d.approval)], ["Finished", uniq.filter(([e, x]) => x.ended && !(x.kind === "HOLD_FOR_APPROVAL" && !x.d.approval))]];
  const sel = `<select id="live-pick" aria-label="Choose an experiment">${groups.map(([g, list]) => list.length ? `<optgroup label="${g}">${list.map(([e, x]) => `<option value="${esc(e.id)}" ${e.id === pick.id ? "selected" : ""}>${esc(e.record.config.name)} — ${esc(x.status[0])}</option>`).join("")}</optgroup>` : "").join("")}</select>`;
  const canApprove = v.kind === "HOLD_FOR_APPROVAL" && !d.approval, canRoll = v.kind === "PROMOTE" && !d.rolledBack && v.decided;
  const stat = v.ended ? `${KIND_LABEL[v.kind] || v.kind} on day ${v.ld} of ${v.win}` : d.paused ? `Paused, day ${v.day} of ${v.win}` : `Running, day ${v.day} of ${v.win}`;
  const sub = `Config <b>v${c.version || 1}</b> <span class="mono">${esc(rec.config_hash)}</span> (locked) · started ${fdate(c.start)} · ${esc(c.rule_set === "final_look" ? "one winner call at the end, strict daily harm check" : "early promote and early stop")}`;
  const replayNote = pick.replay_of ? `<div class="banner warn"><div><b>Offline replay.</b> A new test normally runs the engine, which needs the live version (<span class="mono">./start.sh</span>). Here the pre-computed ${esc(pick.preset)} run is replayed under your name; your plan fields (days, share, rules) were not applied.</div></div>` : "";
  const hdr = `<div class="exp-head"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><h2 style="font-size:20px;font-weight:600;color:var(--navy)">${esc(c.name)}</h2>${statusPill(v)}</div><p class="sub" style="color:var(--ink-2)">${esc(stat)} \u00b7 ${sub}</p>${pick.hypothesis ? `<p class="note" style="margin-top:4px">${esc(pick.hypothesis)}</p>` : ""}
    <div class="actions" style="margin:12px 0 16px">${v.running || d.paused && !v.ended ? `<button class="btn" id="a-pause">${d.paused ? "Resume" : "Pause"}</button>` : ""}${!v.ended ? `<button class="btn danger" id="a-stop">Stop</button>` : ""}
      <button class="btn primary" id="a-approve" ${canApprove ? "" : "disabled"} title="Needs a test that is held for approval">Approve</button>${canApprove ? `<button class="btn" id="a-reject">Reject</button>` : ""}<button class="btn danger" id="a-roll" ${canRoll ? "" : "disabled"} title="Needs a promoted test">Rollback</button></div></div>`;
  let banner;
  if (v.ended || v.kind === "HOLD_FOR_APPROVAL") {
    const cls = { PROMOTE: "pos", STOP_HARM: "neg", STOP_GUARDRAIL: "neg", HOLD_FOR_APPROVAL: "warn", HALT_SRM: "warn", INCONCLUSIVE: "", REJECTED: "", ROLLED_BACK: "warn", STOPPED_MANUAL: "neg" }[v.kind] || "";
    banner = `<div class="banner ${cls}" role="status"><div><b>${esc(KIND_LABEL[v.kind] || v.kind)}.</b> ${esc(v.kind === "STOPPED_MANUAL" ? "A person stopped the test." : v.res.reason)}${v.kind === "PROMOTE" && !d.rolledBack ? ` Production prompt now points at B.` : ""}</div></div>`;
  } else banner = `<div class="banner" role="status"><div><b>Results up to yesterday.</b> ${c.rule_set === "final_look" ? `Final winner call on day ${v.win}. A clearly worse B can still be stopped on any day.` : `The engine may decide on any day the evidence crosses a line; the window ends on day ${v.win}.`} Do not act on early numbers.</div></div>`;
  if (!cur) { el.innerHTML = head("Live Experiments", "Progressive results up to yesterday, then the engine's decision.", v.running ? `<button class="btn primary" id="a-adv">Advance 1 day (demo)</button>` : "") + `<div class="filters"><div class="field grow"><label for="live-pick">Experiment</label>${sel}</div></div>` + hdr + banner + `<div class="empty">No results yet. Press "Advance 1 day (demo)".</div>`; wireLive(el, pick); return; }
  const ciA = wilson(cur.xA, cur.nA), ciB = wilson(cur.xB, cur.nB), goal = (C.metrics.find(m => m.key === c.primary_goal) || {}).name || c.primary_goal.replace(/_/g, " ");
  const lr = liftRange(cur), gl = guardList(v);
  const tiles = `<div class="grid g4" style="margin-bottom:16px">
    <div class="card kpi" title="Leads in each prompt. Each lead is counted once, even if it called several times."><div class="k">Leads</div><div class="v">${nf(cur.n)}</div><div class="d"><span class="dot a"></span>A ${nf(cur.nA)} \u00b7 <span class="dot b"></span>B ${nf(cur.nB)}</div></div>
    <div class="card kpi" title="Share of leads that reached the goal under today's prompt, with its 95% range."><div class="k"><span class="dot a"></span>A: ${esc(goal)}</div><div class="v">${pct(cur.rateA, 1)}</div><div class="d">95% range ${pct(ciA[0], 1)} to ${pct(ciA[1], 1)}</div></div>
    <div class="card kpi" title="Share of leads that reached the goal under the new prompt, with its 95% range."><div class="k"><span class="dot b"></span>B: ${esc(goal)}</div><div class="v">${pct(cur.rateB, 1)}</div><div class="d">95% range ${pct(ciB[0], 1)} to ${pct(ciB[1], 1)}</div></div>
    <div class="card kpi" title="B's rate minus A's rate, in percentage points, with its 95% range. A range that includes 0 means not proven."><div class="k">Lift of B over A</div><div class="v" style="color:${cur.diff > 0 ? "#167a70" : cur.diff < 0 ? "#b23b3b" : "var(--navy)"}">${cur.diff >= 0 ? "\u25B2 " : "\u25BC "}${pts(cur.diff, 1)}</div><div class="d">95% range ${pts(lr.lo, 1)} to ${pts(lr.hi, 1)}<br><span class="muted">${lr.interim ? "interim range, not corrected for repeated looks" : c.rule_set === "final_look" ? "end-of-test range" : "always-valid range: safe to read at any look"}</span></div></div></div>
    ${gl.length ? `<div class="grid g2" style="margin-bottom:16px">${gl.map(guardTile).join("")}</div>` : ""}`;
  const dr = v.rows;
  const harmBound = cur.harm;
  const harmRows = dr.map(({ day, row }) => { const worse = row.z <= -row.harm; return `<tr><td style="white-space:nowrap">Day ${day}</td><td class="num" style="white-space:nowrap">${pts(row.diff, 1)}</td><td style="white-space:nowrap">${worse ? pill("\u2715 Yes: clearly worse", "neg") : pill("\u2713 No", "pos")}</td><td class="num" style="white-space:nowrap">${row.z.toFixed(2)} / \u2212${row.harm.toFixed(2)}</td></tr>`; }).join("");
  const sp = rec.result.split || {}, lastR = cur, shareCfg = c.share_b;
  const chi = (() => { const n = cur.nA + cur.nB, e1 = shareCfg * n, e0 = (1 - shareCfg) * n, x2 = (cur.nB - e1) ** 2 / e1 + (cur.nA - e0) ** 2 / e0; return erfc(Math.sqrt(x2 / 2)); })();
  const byCall = cur.calls ? { n: cur.calls, b: cur.exposedB / cur.calls } : null;
  const both = rec.result.stickiness && rec.result.stickiness.checkable !== false ? rec.result.stickiness.arm_changes : null;
  const needed = Math.max(0, rec.design.n_max - cur.n);
  const split = `<div class="card"><h2>Split</h2><div class="sub">Configured against achieved share of B.</div>${shareBars("By lead", shareCfg, cur.nB / cur.n, cur.n)}${byCall ? shareBars("By call (repeat calls included)", shareCfg, byCall.b, byCall.n) : `<div class="note" style="margin:8px 0">By call: not available for this source.</div>`}
    <dl class="kv" style="margin-top:8px"><dt>Split-mismatch check</dt><dd>chi-square p = <b>${chi < 0.001 ? chi.toExponential(1) : chi.toFixed(2)}</b> ${chi < 0.001 ? pill("✕ Mismatch: test is broken", "neg") : pill("✓ Healthy", "pos")}</dd>
    <dt>Leads that saw both prompts</dt><dd><b>${both == null ? "not checkable here" : nf(both)}</b> ${both === 0 ? pill("✓ Must be 0", "pos") : both > 0 ? pill("✕ Sticky split broke", "neg") : ""}</dd></dl></div>`;
  const dec = `<div class="card"><h2>At the end of the test the engine makes the call</h2><div class="sub">${v.ended ? "The row that applied is highlighted." : `Pending: ${c.rule_set === "final_look" ? "final winner call on day " + v.win : "a decision when a line is crossed, or on day " + v.win}.`}</div>
    <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Primary goal</th><th>Guardrail</th><th>Decision</th></tr></thead><tbody>${DECISION_ROWS.map(r => { const hit = v.ended && r.k.includes(v.kind === "ROLLED_BACK" ? "PROMOTE" : v.kind === "STOPPED_MANUAL" ? "" : v.kind); return `<tr ${hit ? 'style="background:var(--blue-wash)"' : ""}><td>${esc(r.goal)}</td><td>${esc(r.guard)}</td><td>${hit ? "<b>" + esc(r.dec) + "</b> ← applied" : esc(r.dec)}</td></tr>`; }).join("")}</tbody></table></div></div>`;
  const evs = eventsFor(pick).sort((a, b) => a.ts < b.ts ? -1 : 1);
  const ledger = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2>Decision record</h2><button class="btn sm" id="a-verify">Verify record in this browser</button></div><div class="sub">Every event with its time, reason and numbers. Hash-chained: an edited entry is detected.</div><div id="verify-out" class="note" style="margin-top:8px"></div>
    <div class="ledger" style="margin-top:8px">${evs.map(x => `<div class="e"><span class="note">${esc(fdt(x.ts))}</span><span><b>${esc(x.type)}</b>${x.hash ? ` <span class="mono muted">${esc(x.hash)}</span>` : ""}<br><span class="muted">${esc(x.text)}</span></span></div>`).join("")}</div></div>`;
  el.innerHTML = head("Live Experiments", "Progressive results up to yesterday, then the engine's decision.", v.running ? `<button class="btn primary" id="a-adv">Advance 1 day (demo)</button><button class="btn" id="a-end">Skip to the end</button>` : v.ended ? `<a class="btn primary" href="#/report/${encodeURIComponent(pick.id)}">View final report</a>` : "") +
    `<div class="filters"><div class="field grow"><label for="live-pick">Experiment</label>${sel}</div></div>` + replayNote + hdr + banner + tiles +
    `<div class="g-main grid" style="margin-bottom:16px"><div class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><h2 title="Cumulative goal rate for A and B by day. Shaded bands are 95% ranges.">Daily trend</h2><div class="sub">Cumulative ${esc(goal)} rate for A and B by day, with shaded 95% ranges.</div></div><button class="btn sm" id="a-csv">Export CSV</button></div>
        <div class="legend"><span><i style="border-color:var(--a)"></i>A (today's prompt)</span><span><i style="border-color:var(--b)"></i>B (new prompt)</span><span><i class="band" style="background:var(--ink-2)"></i>95% range</span></div><div id="trend"></div></div>
      <div class="card"><h2>Progress</h2><div class="sub">How much evidence the plan needs.</div><div style="margin-top:16px"><div class="kpi"><div class="k">Leads still needed to reach full strength</div><div class="v">${nf(needed)}</div><div class="d">of ${nf(rec.design.n_max)} planned; ${nf(cur.n)} so far</div></div><div class="bar" style="margin-top:8px"><i style="width:${Math.min(100, cur.n / rec.design.n_max * 100)}%"></i></div></div>
        <div class="note" style="margin-top:12px">Day ${v.day} of ${v.win}. Planned to detect a ${(c.mde * 100).toFixed(0)}-point lift from ${pct(c.baseline, 0)} with ${pct(c.power, 0)} chance.</div></div></div>
    <div class="grid g2" style="margin-bottom:16px"><div class="card"><h2>Harm monitor</h2><div class="sub">Every day: is B clearly worse, and by how much? The bar is very strict (${pct(1 - (c.alpha_harm_daily || 0.001), 1)} for the one-look rule) so one bad day does not trigger it.</div>
        <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Day</th><th class="num">B vs A (how much)</th><th>Is B clearly worse?</th><th class="num">z / stop line</th></tr></thead><tbody>${harmRows}</tbody></table></div></div>${split}</div>
    <div class="grid g2" style="margin-bottom:16px">${dec}${ledger}</div>`;
  const fd = c.rule_set === "final_look" ? v.win : null;
  const draw = () => trendChart($("#trend"), dr, v.win, { finalDay: fd });
  draw(); window.__redraw = draw;
  wireLive(el, pick);
};
window.addEventListener("resize", () => { if (CUR.name === "live" && window.__redraw) window.__redraw(); });

function wireLive(el, e) {
  const v = view(e), d = dyn(e), $1 = s => $(s, el);
  const pickEl = $1("#live-pick"); if (pickEl) pickEl.onchange = () => go("live", pickEl.value);
  const a = (id, fn) => { const b = $1(id); if (b) b.onclick = fn; };
  a("#a-adv", () => { advance(e); route(); });
  a("#a-end", () => { d.day = view(e).ld; saveDyn(); toast(`${e.record.config.name}: ${KIND_LABEL[view(e).kind] || view(e).kind}`); route(); });
  a("#a-pause", () => { d.paused = !d.paused; logAction(e, d.paused ? "Paused" : "Resumed", `${d.paused ? "Paused" : "Resumed"} by a person on day ${v.day} (a console action; the engine is not involved).`); saveDyn(); route(); });
  a("#a-stop", () => { if (!confirm("Stop this test now? B's leads go back to A and the test ends.")) return; d.manualStop = true; logAction(e, "Stopped", `Stopped by a person on day ${v.day}. B's leads go back to A (a console action).`); saveDyn(); route(); });
  a("#a-approve", () => { d.approval = "approved"; saveDyn(); toast("Approved. The click is added to the record."); route(); });
  a("#a-reject", () => { d.approval = "rejected"; saveDyn(); toast("Rejected. A stays live."); route(); });
  a("#a-roll", () => { d.rolledBack = true; saveDyn(); toast("Rolled back. The click is added to the record."); route(); });
  a("#a-csv", () => download(`${e.id}_daily.csv`, toCsv(["day", "leads_A", "goal_A", "leads_B", "goal_B", "rate_A", "rate_B", "lift_pp", "z", "stop_line"], v.rows.map(({ day, row }) => [day, row.nA, row.xA, row.nB, row.xB, row.rateA.toFixed(4), row.rateB.toFixed(4), (row.diff * 100).toFixed(2), row.z.toFixed(3), (-row.harm).toFixed(3)]))));
  a("#a-verify", () => { const tailK = d.approval === "approved" ? "approve" : d.approval === "rejected" ? "reject" : d.rolledBack ? "rollback" : null, ents = e.record.ledger.concat(tailK && e.record.tails ? e.record.tails[tailK] || [] : []); const ok = chainOk(ents); $1("#verify-out").innerHTML = ok ? `<span style="color:#167a70;font-weight:600">✓ Chain intact</span>: ${ents.length} entries re-hashed just now, head <span class="mono">${esc(ents[ents.length - 1].hash.slice(0, 12))}</span>.` : `<span style="color:#b23b3b;font-weight:600">✕ Record BROKEN</span>: an entry was changed.`; });
}

/* New Experiment: the spec's six steps. Everything is decided before launch; launching locks the setup and saves it with a version ID. */

const WSTEPS = ["Hypothesis", "Prompt B", "Audience and traffic", "Goals", "Duration and rules", "Review and launch"];
let WZ = null;
const wzDefaults = () => { const s = SET(); return { step: 1, name: "", change: "", why: "", effect: "", mode: "patch", variant: "cap_two_asks", fullText: "", share: s.share_b, segment: "all", lpd: s.leads_per_day, assignment: "balanced", metric: "buylead_created", direction: "higher",
  durOn: true, durMargin: Math.round(s.duration_margin * 100), hangOn: false, hangMargin: s.rate_margin_pp, days: s.window_days, confidence: s.confidence, rule: s.rule_set, harm: s.harm_bar, minLeads: s.min_leads_per_arm, approval: s.approval, baseline: s.baseline, mde: s.mde,
  source: "sim", preset: "win", effectRel: 15, seed: 7 }; };
function startWizard(prefill) { WZ = { ...wzDefaults(), ...(prefill || {}) }; go("new"); }

function applyOwn(base, op, anchor, find, nw) {
  const lines = base.split("\n"); if (!anchor.trim()) throw new Error("Type a phrase that identifies the line in the base prompt.");
  const hits = lines.map((l, i) => l.includes(anchor) ? i : -1).filter(i => i >= 0);
  if (hits.length !== 1) throw new Error(`That phrase matches ${hits.length} line${hits.length === 1 ? "" : "s"} in the base prompt; it must match exactly one. Make it longer or more specific.`);
  const i = hits[0];
  if (op === "replace") { if (!find || !lines[i].includes(find)) throw new Error(`"${find}" is not in that line.`); lines[i] = lines[i].replace(find, nw); }
  else if (op === "add") { if (!nw.trim()) throw new Error("Type the new line."); lines.splice(i + 1, 0, nw); }
  else lines.splice(i, 1);
  return lines.join("\n");
}
function replayFor(w) {                                  // offline: the closest pre-computed run of the spec's presets
  const eff = (w.effectRel || 0) / 100; let id = eff > 0.05 ? "demo_win" : eff < -0.05 ? "demo_worse" : "demo_flat";
  if ((w.durExtra || 0) >= 8 && eff > 0.05) id = "demo_hold"; return C.demo.find(d => d.id === id);
}
const wzPrompt = w => w.mode === "full" ? w.fullText : w.variant === "__own" ? (w.ownText || "") : "";
function baseVars() { return (C.library.variables || []); }
function varCheck(text) {
  const tags = (text.match(/{[{%][\s\S]*?[}%]}/g) || []).join(" "), missing = baseVars().filter(v => !new RegExp("\\b" + v + "\\b").test(tags));
  return { ok: missing.length === 0, missing, n: baseVars().length };
}
function diffSides(lines) {
  const L = [], R = [];
  for (const l of lines || []) {
    if (l.startsWith("---") || l.startsWith("+++")) continue;
    if (l.startsWith("@@")) { L.push(["hdr", l]); R.push(["hdr", l]); }
    else if (l.startsWith("-")) { L.push(["del", l.slice(1)]); R.push(["", ""]); }
    else if (l.startsWith("+")) { L.push(["", ""]); R.push(["add", l.slice(1)]); }
    else { L.push(["", l.slice(1)]); R.push(["", l.slice(1)]); }
  }
  const col = X => `<div class="diff">${X.map(([c, t]) => `<div class="${c}">${esc(t) || "&nbsp;"}</div>`).join("")}</div>`;
  return `<div class="diff2"><div><div class="note" style="padding:4px 8px">A: production prompt (read-only)</div>${col(L)}</div><div><div class="note" style="padding:4px 8px">B: candidate</div>${col(R)}</div></div>`;
}
function lineDiff(a, b) {                                   // client-side diff of a pasted prompt: trim the common ends, compare the middle
  const A = a.split("\n"), B = b.split("\n"); let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length; while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const out = ["@@ changed region @@"]; if (ea - s > 400 || eb - s > 400) return [...out, "-(" + (ea - s) + " lines replaced)", "+(" + (eb - s) + " lines new)"];
  for (let i = Math.max(0, s - 1); i < s; i++) out.push(" " + A[i]); for (let i = s; i < ea; i++) out.push("-" + A[i]); for (let i = s; i < eb; i++) out.push("+" + B[i]); for (let i = ea; i < Math.min(A.length, ea + 1); i++) out.push(" " + A[i]); return out;
}
function calc(w) {
  const alpha = (1 - w.confidence) / 2, seq = w.rule === "sequential", lpd = +w.lpd || 1, days = +w.days || 1, nAll = lpd * days, nB = nAll * w.share, need = leadsNeeded(w.baseline, w.mde, w.share, alpha, 0.8, seq);
  const det = detectableLift(nAll, w.baseline, w.share, alpha, 0.8, seq), cv = (C.plans || {}).duration_cv || 0.55;
  const se = cv * Math.sqrt(1 / Math.max(2, nB) + 1 / Math.max(2, nAll - nB)), gp = normCdf((w.durMargin / 100) / se - normPpf(1 - alpha));
  const half = w.mde > 0.01 ? Math.max(0.005, w.mde / 2) : w.mde, needHalf = leadsNeeded(w.baseline, half, w.share, alpha, 0.8, seq);
  return { nAll, nB, need, daysNeeded: need / lpd, det, gp, half, daysHalf: needHalf / lpd, fits: nAll >= need };
}
function wzValid(w, step) {
  if (step === 1 && !w.name.trim()) return "Give the test a name.";
  if (step === 2) { if (w.mode === "patch" && w.variant === "__own") { if (!w.ownText) return "Press Preview patch to check your edit first."; const vc = varCheck(w.ownText); if (!vc.ok) return `Prompt B no longer uses: ${vc.missing.join(", ")}.`; } else if (w.mode === "full") { if (w.fullText.trim().length < 200) return "Paste the full prompt, or start from the base prompt."; const vc = varCheck(w.fullText); if (!vc.ok) return `Prompt B no longer uses: ${vc.missing.join(", ")}.`; } else { const cand = C.library.candidates.find(c => c.key === w.variant); if (cand && !cand.variables.ok) return `This patch drops variables: ${cand.variables.dropped.join(", ")}.`; } }
  if (step === 3) { if (!(w.share >= 0.05 && w.share <= 0.5)) return "The share for B must be between 5% and 50%."; if (!(w.lpd >= 10)) return "Expected leads per day must be at least 10."; }
  if (step === 5) { if (!(w.days >= 1 && w.days <= 60)) return "Test length must be 1 to 60 days."; if (w.days * w.lpd > 60000) return "Days x leads per day is capped at 60,000 for the live demo."; if (w.baseline + w.mde >= 0.99) return "Baseline plus the smallest lift must stay below 99%."; }
  return "";
}
const F = (label, inner, hint) => `<div class="field"><label>${label}${hint ? ` <span class="hint">${hint}</span>` : ""}</label>${inner}</div>`;

function wzBody(w) {
  const s = w.step;
  if (s === 1) return `<h2>1. Hypothesis</h2><p class="sub">What are you testing, and why do you expect it to help? Saved with the test.</p><div class="form-grid" style="margin-top:16px">
    ${F("Name", `<input type="text" id="w-name" value="${esc(w.name)}" placeholder="Offer two time slots instead of asking open-ended">`)}${F("Expected effect", `<input type="text" id="w-effect" value="${esc(w.effect)}" placeholder="+10% BuyLeads">`)}
    <div class="field wide"><label>What changes</label><textarea id="w-change">${esc(w.change)}</textarea></div><div class="field wide"><label>Why</label><textarea id="w-why">${esc(w.why)}</textarea></div></div>`;
  if (s === 2) {
    const cands = C.library.candidates;
    const patch = `<div style="display:grid;gap:8px;margin-top:16px">${cands.map(c => `<label class="radio"><input type="radio" name="w-var" value="${esc(c.key)}" ${w.variant === c.key ? "checked" : ""}><div><b>${esc(c.name)}</b> <span class="tag">${esc(c.origin)}</span><span>${c.variables.ok ? "✓ every template variable is kept" : "✕ drops " + esc(c.variables.dropped.join(", "))}${c.lint_before != null ? ` · contradictions in the prompt ${c.lint_before} → ${c.lint_after}` : ""}</span></div></label>`).join("")}</div>
      <label class="radio" style="margin-top:8px"><input type="radio" name="w-var" value="__own" ${w.variant === "__own" ? "checked" : ""}><div><b>Write my own patch</b><span>Add a line, replace words, or remove a line in the base prompt.</span></div></label>
      ${w.variant === "__own" ? `<div class="card" style="background:var(--bg-2);margin-top:8px"><div class="form-grid">
        ${F("Kind of change", `<select id="w-op"><option value="replace" ${w.ownOp === "replace" || !w.ownOp ? "selected" : ""}>Replace words in a line</option><option value="add" ${w.ownOp === "add" ? "selected" : ""}>Add a line after a line</option><option value="remove" ${w.ownOp === "remove" ? "selected" : ""}>Remove a line</option></select>`)}
        ${F("A phrase from exactly one line of the base prompt", `<input type="text" id="w-anchor" value="${esc(w.ownAnchor || "")}" placeholder="for example: the assure the buyer that at the end of the call">`)}
        ${(w.ownOp || "replace") === "replace" ? F("Words to find in that line", `<input type="text" id="w-find" value="${esc(w.ownFind || "")}">`) : ""}${(w.ownOp || "replace") !== "remove" ? F((w.ownOp || "replace") === "add" ? "The new line" : "Replace them with", `<input type="text" id="w-new" value="${esc(w.ownNew || "")}">`) : ""}</div>
        <div class="actions" style="margin-top:12px"><button class="btn" id="w-apply">Preview patch</button><span id="w-own-msg" class="note"></span></div></div>
        ${w.ownText ? `<h3 style="margin:16px 0 8px">Side-by-side diff of your patch</h3>${diffSides(lineDiff(C.library.base_text, w.ownText))}<div style="margin-top:8px">${(() => { const vc = varCheck(w.ownText); return vc.ok ? `<div class="check ok"><span class="ico">\u2713</span>All ${vc.n} template variables are still used.</div>` : `<div class="check bad"><span class="ico">\u2715</span>No longer used: ${esc(vc.missing.join(", "))}.</div>`; })()}</div>` : ""}` : `<h3 style="margin:16px 0 8px">Side-by-side diff</h3>${diffSides((cands.find(c => c.key === w.variant) || {}).diff)}`}`;
    const vc = varCheck(w.fullText || ""), full = `<div style="margin-top:16px"><div class="actions" style="margin-bottom:8px"><button class="btn sm" id="w-load">Start from the base prompt</button><span class="note">${C.library.base_lines ? nf(C.library.base_lines) + " lines" : ""}</span></div><textarea id="w-full" style="min-height:200px;font-family:var(--mono);font-size:12px">${esc(w.fullText)}</textarea>
      <div style="margin-top:8px" id="w-vc"></div>${w.fullText ? `<h3 style="margin:16px 0 8px">Side-by-side diff</h3><div id="w-diff"></div>` : ""}</div>`;
    return `<h2>2. Prompt B</h2><p class="sub">A patch on the base prompt, or a full prompt. The base prompt is shown read-only. Template variables such as <span class="mono">{{ buyer_name }}</span> must still be there.</p>
      <div class="seg" style="margin-top:12px" role="group" aria-label="Kind of change"><button data-mode="patch" aria-pressed="${w.mode === "patch"}">Patch on the base prompt</button><button data-mode="full" aria-pressed="${w.mode === "full"}">Full prompt</button></div>${w.mode === "patch" ? patch : full}
      <details id="w-basebox" style="margin-top:16px"><summary style="cursor:pointer;font-weight:500">Show the base prompt (read-only)</summary><div id="w-baseview" class="note" style="margin-top:8px">Loading...</div></details>
      <div class="card" style="margin-top:16px;background:var(--bg-2)"><h3>Try it</h3><p class="sub">An optional chat box to talk to prompt B. It uses Sarvam credits, so it is switched off. The simulator does not need it.</p><textarea disabled placeholder="Chat with prompt B (off)" style="min-height:48px;margin-top:8px"></textarea></div>`;
  }
  if (s === 3) { const c = calc(w); return `<h2>3. Audience and traffic</h2><p class="sub">Who is in the test, and how much of it goes to B. Assignment is sticky by lead ID: the same lead always sees the same prompt.</p><div class="form-grid" style="margin-top:16px">
    ${F("Share of traffic to B", `<input type="range" id="w-share-r" min="5" max="50" step="5" value="${Math.round(w.share * 100)}"><input type="number" id="w-share" min="5" max="50" step="1" value="${Math.round(w.share * 100)}" style="margin-top:8px">`, "5 to 50%")}
    ${F("Expected leads per day", `<input type="number" id="w-lpd" min="10" step="100" value="${w.lpd}">`, "an assumption: replace it with yours")}
    ${F("Audience segment (optional)", `<select id="w-seg"><option value="all" selected>All leads</option><option disabled>A category (MCAT): needs a category on every call</option><option disabled>A city: needs a city on every call</option><option disabled>A lead type: needs a lead type on every call</option></select>`, "no segment data in the recordings")}
    ${F("Assignment", `<select id="w-assign"><option value="balanced" ${w.assignment === "balanced" ? "selected" : ""}>Balanced blocks (closest to the configured share)</option><option value="hash" ${w.assignment === "hash" ? "selected" : ""}>Pure hash (works with no stored state)</option></select>`)}</div>
    <div class="banner" style="margin-top:16px"><div><b>Expected leads.</b> In ${w.days} days B will get about <b>${nf(c.nB)}</b> of <b>${nf(c.nAll)}</b> leads. The leads per day come from your setting, not from historical data (none was provided).</div></div>`; }
  if (s === 4) { const goals = C.metrics.filter(m => m.role === "goal"); return `<h2>4. Goals</h2><p class="sub">One primary goal decides. Guardrails can only veto: they stop or hold B even if the goal improves.</p><div class="form-grid" style="margin-top:16px">
    ${F("Primary goal", `<select id="w-metric">${goals.map(m => `<option value="${esc(m.key)}" ${w.metric === m.key ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select>`, "any disposition can be a goal")}${F("Which direction is better", `<select id="w-dir"><option value="higher" ${w.direction === "higher" ? "selected" : ""}>Higher is better</option><option value="lower" ${w.direction === "lower" ? "selected" : ""}>Lower is better</option></select>`)}</div>
    <h3 style="margin:24px 0 8px">Guardrails</h3><div style="display:grid;gap:8px">
      <label class="radio" style="cursor:default"><input type="checkbox" id="w-dur" ${w.durOn ? "checked" : ""}><div><b>Call duration</b><span>B must not be longer than A by more than <input type="number" id="w-durm" min="1" max="100" value="${w.durMargin}" style="width:72px;display:inline-block;min-height:28px;padding:2px 8px"> %. Compared as a ratio of averages, with a range.</span></div></label>
      <label class="radio" style="cursor:default"><input type="checkbox" id="w-hang" ${w.hangOn ? "checked" : ""}><div><b>Early hang-ups</b><span>Calls under 15 seconds must not rise by more than <input type="number" id="w-hangm" min="1" max="20" value="${w.hangMargin}" style="width:72px;display:inline-block;min-height:28px;padding:2px 8px"> points. (The 15-second cut-off is our assumption.)</span></div></label>
      <label class="radio" style="cursor:not-allowed;opacity:.6"><input type="checkbox" disabled><div><b>Fatal calls (quality matrix)</b><span>Needs a fatal-call flag on every call: available from result files that carry it.</span></div></label></div>
    <p class="note" style="margin-top:12px">Conflict rule: the primary goal decides; a guardrail can only veto or hold. If B wins but a guardrail is not proven, the decision is held for approval.</p>`; }
  if (s === 5) { const c = calc(w); return `<h2>5. Duration and rules</h2><p class="sub">The rules are fixed before launch so results cannot be bent to fit.</p><div class="form-grid" style="margin-top:16px">
    ${F("Test length (days)", `<input type="number" id="w-days" min="1" max="60" value="${w.days}">`)}${F("Confidence", `<select id="w-conf">${[0.9, 0.95, 0.99].map(x => `<option value="${x}" ${w.confidence === x ? "selected" : ""}>${x * 100}%</option>`).join("")}</select>`)}
    ${F("Expected rate under A (baseline)", `<input type="number" id="w-base" min="1" max="98" step="1" value="${Math.round(w.baseline * 100)}">`, "% - needed to size the test")}${F("Smallest lift worth detecting", `<input type="number" id="w-mde" min="1" max="50" step="1" value="${Math.round(w.mde * 100)}">`, "points")}
    ${F("Minimum leads in each arm before any decision", `<input type="number" id="w-min" min="20" value="${w.minLeads}">`)}${F("Approval mode", `<select id="w-appr"><option value="auto" ${w.approval === "auto" ? "selected" : ""}>Automatic: a win is promoted</option><option value="manual" ${w.approval === "manual" ? "selected" : ""}>Manual: a person approves every win</option></select>`, "both paths are logged")}</div>
    <h3 style="margin:24px 0 8px">Decision rule</h3><div style="display:grid;gap:8px"><label class="radio"><input type="radio" name="w-rule" value="final_look" ${w.rule === "final_look" ? "checked" : ""}><div><b>One winner call at the end, plus a strict daily harm check</b><span>The spec's rule: a two-proportion test at ${pct(w.confidence, 0)} once, on the last day (no correction for repeated looks is needed). Every day a ${pct(w.harm, 1)} bar catches a clearly worse B.</span></div></label>
      <label class="radio"><input type="radio" name="w-rule" value="sequential" ${w.rule === "sequential" ? "checked" : ""}><div><b>Early promote and early stop (sequential)</b><span>May promote or stop on any day using boundaries built for repeated looks. Measured on identical simulated traffic: it promotes about 15% sooner and stops a clearly worse B in 98% of runs, against 89% for the one-look rule. Needs about 6% more data.</span></div></label></div>
    <div class="form-grid" style="margin-top:16px">${F("Daily harm bar", `<select id="w-harm">${[0.99, 0.995, 0.999].map(x => `<option value="${x}" ${w.harm === x ? "selected" : ""}>${(x * 100).toFixed(1)}%</option>`).join("")}</select>`, "one-look rule only")}</div>
    <div class="card" style="margin-top:24px;background:var(--bg-2)"><h3>Live calculator</h3><p style="margin-top:8px">B will get about <b>${nf(c.nB)}</b> leads in ${w.days} days (${nf(c.nAll)} in all at ${nf(w.lpd)} a day). It can detect a lift of <b>${(c.det * 100).toFixed(1)} points</b> or more with ${pct(0.8, 0)} chance. To detect <b>${(w.mde * 100).toFixed(0)} points</b> you need about <b>${nf(c.need)}</b> leads, which is <b>${c.daysNeeded.toFixed(1)} days</b>${c.half !== w.mde ? `; to detect ${(c.half * 100).toFixed(1)} points you would need ${c.daysHalf.toFixed(0)} days` : ""}.</p>
      <div class="banner ${c.fits ? "pos" : "warn"}" style="margin:12px 0 0"><div>${c.fits ? `<b>This test can finish.</b> The window holds enough leads for a ${(w.mde * 100).toFixed(0)}-point lift.` : `<b>Too short to detect a ${(w.mde * 100).toFixed(0)}-point lift.</b> Run about ${Math.ceil(c.daysNeeded)} days, send B more traffic (up to 50%), or aim for a bigger lift.`}</div></div>
      <p class="note" style="margin-top:8px">${w.durOn ? `Chance that a B which changes nothing is proven within the ${w.durMargin}% call-length limit: <b>${pct(c.gp, 0)}</b>${c.gp < 0.7 ? " (low: the guardrail may be held for approval even for a real win)" : ""}.` : ""} ${w.rule === "sequential" ? "Includes the 6% a repeatedly checked test needs." : ""}</p></div>`; }
  const c = calc(w), gname = (C.metrics.find(m => m.key === w.metric) || {}).name || w.metric, cand = C.library.candidates.find(x => x.key === w.variant);
  return `<h2>6. Review and launch</h2><p class="sub">Launching locks the setup and saves it with a version ID. Any later change creates a new version.</p>
    <dl class="kv" style="margin-top:16px"><dt>Name</dt><dd><b>${esc(w.name || "-")}</b></dd><dt>Prompt B</dt><dd>${w.mode === "full" ? "A full prompt you pasted" : w.variant === "__own" ? "Your own patch on the base prompt" : esc(cand ? cand.name : w.variant)}</dd><dt>Traffic</dt><dd>${pct(w.share, 0)} to B, sticky by lead, ${esc(w.assignment)} assignment; about ${nf(w.lpd)} leads a day</dd>
      <dt>Primary goal</dt><dd>${esc(gname)} (${w.direction} is better); plan: detect ${(w.mde * 100).toFixed(0)} points from ${pct(w.baseline, 0)}</dd><dt>Guardrails</dt><dd>${[w.durOn ? `call duration ≤ +${w.durMargin}%` : "", w.hangOn ? `early hang-ups ≤ +${w.hangMargin} points` : ""].filter(Boolean).join("; ") || "none"}</dd>
      <dt>Rules</dt><dd>${w.days} days, ${pct(w.confidence, 0)} confidence, ${w.rule === "final_look" ? `one winner call at the end + daily ${pct(w.harm, 1)} harm check` : "early promote and early stop"}, min ${w.minLeads} leads per arm, approval ${w.approval}</dd><dt>Can it finish?</dt><dd>${c.fits ? pill("✓ Yes", "pos") : pill("Too short for the planned lift", "warn")}</dd></dl>
    <h3 style="margin:24px 0 8px">Where do the results come from?</h3><div style="display:grid;gap:8px"><label class="radio"><input type="radio" name="w-src" value="sim" ${w.source === "sim" ? "checked" : ""}><div><b>Simulator (demo only)</b><span>The call outcomes are simulated with a known effect you set, so you can check the engine decides correctly. Call lengths are resampled from the 713 real recordings.</span></div></label>
      <label class="radio"><input type="radio" name="w-src" value="files" ${w.source === "files" ? "checked" : ""}><div><b>Results files from the voice platform</b><span>The test runs elsewhere; you give Canary the A and B results and it decides with the plan above.</span></div></label></div>
    ${w.source === "sim" ? `<div class="form-grid" style="margin-top:16px"><div class="field wide"><label>Simulation settings (demo only)</label><div class="seg" role="group" aria-label="Preset">${[["win", "B wins (+15%)"], ["worse", "B worse (−15%)"], ["flat", "Flat (0%)"], ["custom", "Custom"]].map(([k, n]) => `<button data-preset="${k}" aria-pressed="${w.preset === k}">${n}</button>`).join("")}</div></div>
      ${F("B's true effect (relative)", `<input type="number" id="w-eff" step="1" value="${w.effectRel}" ${w.preset === "custom" ? "" : "disabled"}>`, "% of A's rate")}${F("Random seed", `<input type="number" id="w-seed" value="${w.seed}">`, "same seed, same run")}${F("B's calls are longer by (%)", `<input type="number" id="w-dx" step="1" value="${w.durExtra || 0}">`, "to test the call-length guardrail")}</div>`
      : `<div class="banner" style="margin-top:16px"><div>Your plan above is used when the files are read. Next: choose the files on the import screen.</div></div>`}
    ${!LIVE && w.source === "sim" ? `<div class="banner warn" style="margin-top:16px"><div><b>Offline.</b> Launching here replays the closest pre-computed run (B wins, B worse, flat, or a win with longer calls) under your name; your plan fields are not applied. Run <span class="mono">./start.sh</span> to run your own settings through the engine.</div></div>` : ""}
    <div id="w-err" class="note" style="color:#b23b3b;margin-top:12px"></div>`;
}

ROUTES.new = (el) => {
  if (!WZ) WZ = { ...wzDefaults(), ...(DYN.ui.wizard || {}) };
  const w = WZ; w.step = Math.min(6, Math.max(1, w.step));
  const c = calc(w);
  el.innerHTML = head("New Experiment", "Six steps. Everything is decided before launch; once launched, the setup is locked and saved with a version ID, so results cannot be bent to fit.") +
    `<div class="g-main grid"><div class="card" style="min-height:420px">${wzBody(w)}<div class="actions" style="margin-top:24px;justify-content:space-between"><div>${w.step > 1 ? `<button class="btn" id="w-back">Back</button>` : ""}</div><div class="actions">${w.step < 6 ? `<button class="btn primary" id="w-next">Next</button>` : `<button class="btn primary" id="w-launch">${w.source === "files" ? "Continue to import" : "Launch experiment"}</button>`}</div></div></div>
      <div class="grid"><div class="card"><div class="stepper" role="list">${WSTEPS.map((n, i) => `<button class="step ${i + 1 < w.step ? "done" : ""}" role="listitem" data-step="${i + 1}" ${i + 1 === w.step ? 'aria-current="step"' : ""}><span class="n">${i + 1 < w.step ? "✓" : i + 1}</span>${esc(n)}</button>`).join("")}</div></div>
      <div class="card"><h3>At a glance</h3><dl class="kv" style="margin-top:8px;grid-template-columns:110px 1fr"><dt>B gets</dt><dd>${pct(w.share, 0)} of leads</dd><dt>Window</dt><dd>${w.days} days</dd><dt>Leads</dt><dd>${nf(c.nAll)} (B ${nf(c.nB)})</dd><dt>Detects</dt><dd>${(c.det * 100).toFixed(1)} pp or more</dd><dt>Can finish</dt><dd>${c.fits ? "✓ yes" : "no: too short"}</dd></dl></div></div></div>`;
  bindWizard(el, w);
};
function bindWizard(el, w) {
  const $1 = s => $(s, el), val = (id, f = x => x) => { const e = $1(id); return e ? f(e.value) : undefined; };
  const sync = () => {
    if (w.step === 1) { w.name = val("#w-name", x => x); w.effect = val("#w-effect", x => x); w.change = val("#w-change", x => x); w.why = val("#w-why", x => x); }
    if (w.step === 2) { const r = $("input[name=w-var]:checked", el); if (r) w.variant = r.value; if ($1("#w-full")) w.fullText = $1("#w-full").value;
      if ($1("#w-anchor")) { w.ownOp = $1("#w-op").value; w.ownAnchor = $1("#w-anchor").value; w.ownFind = $1("#w-find") ? $1("#w-find").value : ""; w.ownNew = $1("#w-new") ? $1("#w-new").value : ""; } }
    if (w.step === 3) { w.share = Math.min(0.5, Math.max(0.05, val("#w-share", Number) / 100)); w.lpd = val("#w-lpd", Number); w.assignment = val("#w-assign", x => x); }
    if (w.step === 4) { w.metric = val("#w-metric", x => x); w.direction = val("#w-dir", x => x); w.durOn = $1("#w-dur").checked; w.durMargin = val("#w-durm", Number); w.hangOn = $1("#w-hang").checked; w.hangMargin = val("#w-hangm", Number); }
    if (w.step === 5) { w.days = val("#w-days", Number); w.confidence = val("#w-conf", Number); w.baseline = val("#w-base", Number) / 100; w.mde = val("#w-mde", Number) / 100; w.minLeads = val("#w-min", Number); w.approval = val("#w-appr", x => x); const r = $("input[name=w-rule]:checked", el); if (r) w.rule = r.value; w.harm = val("#w-harm", Number); }
    if (w.step === 6) { const r = $("input[name=w-src]:checked", el); if (r) w.source = r.value; if ($1("#w-eff")) w.effectRel = +$1("#w-eff").value; if ($1("#w-seed")) w.seed = +$1("#w-seed").value; if ($1("#w-dx")) w.durExtra = +$1("#w-dx").value; }
    DYN.ui.wizard = w; saveDyn();
  };
  const rerender = () => { sync(); route(); };
  $$("[data-step]", el).forEach(b => b.onclick = () => { sync(); const t = +b.dataset.step; for (let s = w.step; s < t; s++) { const m = wzValid(w, s); if (m) { toast(m); return; } } w.step = t; route(); });
  const nx = $1("#w-next"); if (nx) nx.onclick = () => { sync(); const m = wzValid(w, w.step); if (m) { toast(m); return; } w.step++; route(); };
  const bk = $1("#w-back"); if (bk) bk.onclick = () => { sync(); w.step--; route(); };
  $$("[data-mode]", el).forEach(b => b.onclick = () => { sync(); w.mode = b.dataset.mode; route(); });
  $$("[data-preset]", el).forEach(b => b.onclick = () => { sync(); w.preset = b.dataset.preset; if (w.preset !== "custom") w.effectRel = { win: 15, worse: -15, flat: 0 }[w.preset]; route(); });
  $$("input[name=w-var],input[name=w-rule],input[name=w-src]", el).forEach(r => r.onchange = rerender);
  ["#w-share", "#w-lpd", "#w-days", "#w-conf", "#w-base", "#w-mde", "#w-durm", "#w-dur", "#w-harm"].forEach(id => { const e = $1(id); if (e) e.onchange = rerender; });
  const sr = $1("#w-share-r"); if (sr) { sr.oninput = () => { $1("#w-share").value = sr.value; }; sr.onchange = () => { $1("#w-share").value = sr.value; rerender(); }; }
  const op = $1("#w-op"); if (op) op.onchange = () => { sync(); w.ownText = ""; route(); };
  const ap = $1("#w-apply"); if (ap) ap.onclick = () => { sync(); try { w.ownText = applyOwn(C.library.base_text, w.ownOp || "replace", w.ownAnchor, w.ownFind, w.ownNew); DYN.ui.wizard = w; saveDyn(); route(); } catch (err) { $1("#w-own-msg").style.color = "#b23b3b"; $1("#w-own-msg").textContent = err.message; } };
  const bb = $1("#w-basebox"); if (bb) bb.ontoggle = () => { if (bb.open) $1("#w-baseview").innerHTML = `<textarea readonly style="min-height:260px;font-family:var(--mono);font-size:12px">${esc(C.library.base_text || "")}</textarea>`; };
  const load = $1("#w-load"); if (load) load.onclick = () => { $1("#w-full").value = C.library.base_text || ""; sync(); route(); };
  const full = $1("#w-full"); if (full) { const upd = () => { const t = full.value, vc = varCheck(t); $1("#w-vc").innerHTML = t ? (vc.ok ? `<div class="check ok"><span class="ico">✓</span>All ${vc.n} template variables are still used.</div>` : `<div class="check bad"><span class="ico">✕</span>No longer used: ${esc(vc.missing.join(", "))}. A prompt that drops a variable would never receive that value.</div>`) : ""; const dd = $1("#w-diff"); if (dd && C.library.base_text) dd.innerHTML = diffSides(lineDiff(C.library.base_text, t)); }; full.oninput = upd; upd(); }
  const L = $1("#w-launch"); if (L) L.onclick = async () => {
    sync(); for (let s = 1; s <= 5; s++) { const m = wzValid(w, s); if (m) { w.step = s; toast(m); route(); return; } }
    if (w.source === "files") { DYN.ui.importPlan = { baseline: w.baseline, share_b: w.share, mde: w.mde, window_days: w.days, rule_set: w.rule, name: w.name }; saveDyn(); go("import"); return; }
    if (!LIVE) {
      const src = replayFor(w), rec = JSON.parse(JSON.stringify(src.record)); rec.config.name = w.name;
      const id = "replay-" + Date.now(), exp = { id, kind: "simulated", preset: src.preset, replay_of: src.id, hypothesis: [w.change, w.why, w.effect && "Expected: " + w.effect].filter(Boolean).join(" "), truth: src.truth, start_day: 1, record: rec };
      DYN.launched.unshift(exp); DYN.dyn[id] = { day: 1, paused: false, approval: null, rolledBack: false, manualStop: false, learning: "" }; WZ = null; DYN.ui.wizard = null; saveDyn();
      toast("Launched offline: replaying the closest pre-computed run.", 4200); go("live", id); return;
    }
    L.disabled = true; L.innerHTML = `<span class="spin"></span> Running the engine...`;
    try {
      const body = { name: w.name, hypothesis: [w.change, w.why, w.effect && "Expected: " + w.effect].filter(Boolean).join(" "), variant_b: w.variant, share_b: w.share, baseline: w.baseline, mde: w.mde, window_days: w.days, leads_per_day: w.lpd,
        rule_set: w.rule, confidence: w.confidence, harm_bar: w.harm, duration_margin: w.durMargin / 100, duration_on: w.durOn, approval: w.approval, min_leads_per_arm: w.minLeads, early_hangup: w.hangOn, rate_margin_pp: w.hangMargin,
        effect_rel: w.effectRel / 100, dur_mult: 1 + (w.durExtra || 0) / 100, seed: w.seed, preset: { win: "B wins", worse: "B worse", flat: "Flat", custom: "Custom" }[w.preset], start: new Date(2026, 9, 9, 9).toISOString().slice(0, 19), full_prompt: wzPrompt(w) };
      const r = await fetch("/api/wizard", { method: "POST", body: JSON.stringify(body) }), j = await r.json(); if (j.error) throw new Error(j.error);
      j.start_day = 1; DYN.launched.unshift(j); DYN.dyn[j.id] = { day: 1, paused: false, approval: null, rolledBack: false, manualStop: false, learning: "" }; WZ = null; DYN.ui.wizard = null; saveDyn();
      toast(`Launched and locked: config version ${j.record.config.version || 1} (${j.record.config_hash}).`, 4200); go("live", j.id);
    } catch (err) { L.disabled = false; L.textContent = "Launch experiment"; $1("#w-err").textContent = String(err.message || err); }
  };
}

/* History: every finished test with its frozen report. Report: the one-page final report for a test. */

const HFILT = DYN.ui.hist || { q: "", dec: "all", metric: "all", seg: "all", sort: "start", dir: -1, page: 0 };
const PAGE = 8;
function guardWord(v) { const g = guardOverall(v); return [g.short, g.cls]; }
const DEC_GROUP = { PROMOTE: "promoted", ROLLED_BACK: "promoted", STOP_HARM: "stopped", STOP_GUARDRAIL: "stopped", STOPPED_MANUAL: "stopped", INCONCLUSIVE: "inconclusive", REJECTED: "inconclusive", HOLD_FOR_APPROVAL: "held", HALT_SRM: "halted" };
function histRows() {
  return EXPS().map(e => ({ e, v: view(e) })).filter(({ v }) => v.ended).filter(({ e, v }) => {
    const q = HFILT.q.trim().toLowerCase();
    if (q && !(e.record.config.name + " " + (e.hypothesis || "") + " " + (dyn(e).learning || "") + " " + (e.preset || "")).toLowerCase().includes(q)) return false;
    if (HFILT.dec !== "all" && DEC_GROUP[v.kind] !== HFILT.dec) return false;
    if (HFILT.metric !== "all" && e.record.config.primary_goal !== HFILT.metric) return false;
    return true;
  });
}
function cloneOf(e) {
  const c = e.record.config, cand = C.library.candidates.find(x => x.key === c.variant_b);
  startWizard({ name: c.name + " (re-run)", change: e.hypothesis || "", variant: cand ? cand.key : "cap_two_asks", share: Math.min(0.5, c.share_b), lpd: c.leads_per_day, days: c.window_days, rule: c.rule_set, baseline: c.baseline, mde: c.mde, confidence: 1 - 2 * c.alpha,
    durMargin: Math.round(c.guardrail_margin * 100), approval: c.approval, step: 1, preset: e.truth && e.truth.effect_rel != null ? (e.truth.effect_rel > 0 ? "win" : e.truth.effect_rel < 0 ? "worse" : "flat") : "win" });
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
      <div class="field"><label for="h-met">Metric</label><select id="h-met"><option value="all">All metrics</option>${metrics.map(m => `<option value="${esc(m)}" ${HFILT.metric === m ? "selected" : ""}>${esc((C.metrics.find(x => x.key === m) || {}).name || m)}</option>`).join("")}</select></div>
      <div class="field"><label for="h-seg">Segment</label><select id="h-seg" disabled title="No segment data in the recordings"><option>All leads</option></select></div></div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr>${th("name", "Test")}${th("start", "Dates")}<th>The change</th>${th("lift", "Primary lift (range)", "num")}${th("dec", "Decision")}<th>Guardrail</th><th>Learning</th><th></th></tr></thead><tbody>${rows.map(({ e, v }) => { const c = v.config, g = guardWord(v), cur = v.cur, lr = cur && liftRange(cur);
      return `<tr class="click" data-rep="${esc(e.id)}"><td><b><a href="#/report/${encodeURIComponent(e.id)}">${esc(c.name)}</a></b><div class="note">${esc(e.kind === "files" ? "Results files" : "Simulated")}${e.preset && e.kind !== "files" ? " · " + esc(e.preset) : ""}</div></td><td style="white-space:nowrap">${fdate(c.start)}<div class="note">${v.ld} day${v.ld === 1 ? "" : "s"}</div></td>
        <td style="max-width:260px"><span class="muted">${esc(e.kind === "files" ? "Results from " + ((e.record.source && e.record.source.files) || []).join(", ") : ((e.record.variants.B || {}).name) || "")}</span></td><td class="num">${cur ? `<b>${pts(cur.diff, 1)}</b><div class="note">${sgn(lr.lo * 100, 1)} to ${sgn(lr.hi * 100, 1)}${lr.interim ? " (interim)" : ""}</div>` : "-"}</td>
        <td>${pill(KIND_LABEL[v.kind] || v.kind, KIND_CLASS[v.kind])}</td><td>${pill(g[0], g[1])}</td><td class="note" style="max-width:160px">${esc(dyn(e).learning || "")}</td><td><button class="btn sm" data-clone="${esc(e.id)}">Clone</button></td></tr>`; }).join("")}</tbody></table></div>
      <div class="pager"><span>${all.length} test${all.length === 1 ? "" : "s"}${HFILT.q || HFILT.dec !== "all" || HFILT.metric !== "all" ? " match" : ""}</span><span><button class="btn sm" id="h-prev" ${HFILT.page ? "" : "disabled"}>Previous</button> Page ${HFILT.page + 1} of ${pages} <button class="btn sm" id="h-next" ${HFILT.page < pages - 1 ? "" : "disabled"}>Next</button></span></div>`
      : `<div class="empty">No finished tests match. Clear the filters, or advance a running test to its last day.</div>`}`;
  const save = () => { DYN.ui.hist = HFILT; saveDyn(); };
  $("#h-q").oninput = ev => { HFILT.q = ev.target.value; HFILT.page = 0; save(); clearTimeout(window.__hq); window.__hq = setTimeout(() => { const pos = ev.target.selectionStart; route(); const n = $("#h-q"); n.focus(); n.setSelectionRange(pos, pos); }, 250); };
  $("#h-dec").onchange = ev => { HFILT.dec = ev.target.value; HFILT.page = 0; save(); route(); };
  $("#h-met").onchange = ev => { HFILT.metric = ev.target.value; HFILT.page = 0; save(); route(); };
  $$("[data-sort]", el).forEach(b => b.onclick = () => { const k = b.dataset.sort; HFILT.dir = HFILT.sort === k ? -HFILT.dir : (k === "name" ? 1 : -1); HFILT.sort = k; save(); route(); });
  $$("[data-clone]", el).forEach(b => b.onclick = ev => { ev.stopPropagation(); cloneOf(byId(b.dataset.clone)); });
  $$("tr[data-rep]", el).forEach(r => r.onclick = ev => { if (!ev.target.closest("a,button")) go("report", r.dataset.rep); });
  const pv = $("#h-prev"), nx = $("#h-next"); if (pv) pv.onclick = () => { HFILT.page--; save(); route(); }; if (nx) nx.onclick = () => { HFILT.page++; save(); route(); };
  $("#h-csv").onclick = () => download("canary_history.csv", toCsv(["name", "start", "days", "source", "change", "lift_pp", "range_low_pp", "range_high_pp", "decision", "guardrail", "learning"], all.map(({ e, v }) => [v.config.name, v.config.start.slice(0, 10), v.ld, e.kind, (e.record.variants.B || {}).name, v.cur ? (v.cur.diff * 100).toFixed(2) : "", v.cur ? (liftRange(v.cur).lo * 100).toFixed(2) : "", v.cur ? (liftRange(v.cur).hi * 100).toFixed(2) : "", KIND_LABEL[v.kind] || v.kind, guardWord(v)[0], dyn(e).learning || ""])));
};

ROUTES.report = (el, id) => {
  const e = byId(id); if (!e) { el.innerHTML = head("Report", "") + `<div class="empty">That test was not found. <a href="#/history">Back to History</a>.</div>`; return; }
  const v = view(e), c = v.config, rec = e.record, cur = v.cur;
  if (!v.ended || !cur) { el.innerHTML = head(c.name, "The final report is written when the test ends.") + `<div class="empty">This test has not ended yet (${esc(v.status[0])}). <a href="#/live/${encodeURIComponent(e.id)}">Open it in Live Experiments</a>.</div>`; return; }
  const ciA = wilson(cur.xA, cur.nA), ciB = wilson(cur.xB, cur.nB), lr = liftRange(cur), gl = guardList(v), goal = (C.metrics.find(m => m.key === c.primary_goal) || {}).name || c.primary_goal.replace(/_/g, " ");
  const tailK = v.d.approval === "approved" ? "approve" : v.d.approval === "rejected" ? "reject" : v.d.rolledBack ? "rollback" : null, ents = rec.ledger.concat(tailK && rec.tails ? rec.tails[tailK] || [] : []);
  const sugg = ["slot options work", "longer intro hurts", "small effect: needs more leads", "call length is the catch", "broken tracking: rerun"];
  el.innerHTML = head("Final report", "A frozen, one-page record of this test.", `<a class="btn" href="#/history">Back to History</a><button class="btn" id="r-clone">Clone and re-run</button><button class="btn" id="r-csv">Export CSV</button><button class="btn primary" onclick="print()">Print</button>`) +
    `<div class="report card"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><h2 style="margin:0;font-size:20px">${esc(c.name)}</h2>${pill(KIND_LABEL[v.kind] || v.kind, KIND_CLASS[v.kind])}</div>
      <p class="note">${fdate(c.start)} · ${v.ld} day${v.ld === 1 ? "" : "s"} · config v${c.version || 1} <span class="mono">${esc(rec.config_hash)}</span> · ${esc(e.kind === "files" ? "results supplied as files" : "simulated results")}</p>
      ${e.hypothesis ? `<p>${esc(e.hypothesis)}</p>` : ""}
      <h2>Decision</h2><p>${esc(v.kind === "STOPPED_MANUAL" ? "A person stopped the test early." : v.res.reason)}${v.d.approval ? ` A person ${v.d.approval} it.` : ""}${v.d.rolledBack ? " It was then rolled back by a person." : ""}</p>
      <h2>In plain words</h2><p>${esc(plainSummary(e))}</p>
      <h2>The numbers</h2><div class="tbl-wrap"><table><thead><tr><th></th><th class="num">Leads</th><th class="num">Goal reached</th><th class="num">Rate</th><th class="num">95% range</th></tr></thead><tbody>
        <tr><td><span class="dot a"></span>A: today's prompt</td><td class="num">${nf(cur.nA)}</td><td class="num">${nf(cur.xA)}</td><td class="num">${pct(cur.rateA, 1)}</td><td class="num">${pct(ciA[0], 1)} to ${pct(ciA[1], 1)}</td></tr>
        <tr><td><span class="dot b"></span>B: new prompt</td><td class="num">${nf(cur.nB)}</td><td class="num">${nf(cur.xB)}</td><td class="num">${pct(cur.rateB, 1)}</td><td class="num">${pct(ciB[0], 1)} to ${pct(ciB[1], 1)}</td></tr>
        <tr><td><b>Lift of B over A</b></td><td></td><td></td><td class="num"><b>${pts(cur.diff, 1)}</b></td><td class="num">${pts(lr.lo, 1)} to ${pts(lr.hi, 1)}${lr.interim ? "<div class=\"note\">interim: the test stopped before its final call</div>" : ""}</td></tr></tbody></table></div>
      <h2>Safety checks</h2><div style="display:grid;gap:8px">${gl.map(x => `<div class="check ${x.st.cls === "pos" ? "ok" : x.st.cls === "neg" ? "bad" : "wait"}"><span class="ico">${x.st.cls === "pos" ? "\u2713" : x.st.cls === "neg" ? "\u2715" : "\u2026"}</span><span><b>${esc(x.name)}:</b> ${x.g ? esc(x.st.value) + " (limit " + esc(x.st.lim) + "; 95% range " + esc(x.st.range) + ")" : "not enough data"}: ${esc(x.st.label.replace(/^[\u2713\u2715\u2026]\s*/, ""))}</span></div>`).join("")}
        <div class="check ${cur.p_srm < 0.001 ? "bad" : "ok"}"><span class="ico">${cur.p_srm < 0.001 ? "\u2715" : "\u2713"}</span><span><b>Split:</b> B received ${pct(cur.nB / cur.n, 1)} of leads (configured ${pct(c.share_b, 0)}); sample-ratio p = ${cur.p_srm < 0.001 ? cur.p_srm.toExponential(1) : cur.p_srm.toFixed(2)}</span></div>
        <div class="check ${(rec.result.stickiness || {}).arm_changes ? "bad" : "ok"}"><span class="ico">${(rec.result.stickiness || {}).arm_changes ? "\u2715" : "\u2713"}</span><span><b>Sticky assignment:</b> ${(rec.result.stickiness || {}).checkable === false ? "not checkable from this source" : nf((rec.result.stickiness || {}).arm_changes) + " leads saw both prompts"}</span></div></div>
      <h2>Over time</h2><div class="legend"><span><i style="border-color:var(--a)"></i>A</span><span><i style="border-color:var(--b)"></i>B</span><span><i class="band" style="background:var(--ink-2)"></i>95% range</span></div><div id="trend"></div>
      ${v.kind === "INCONCLUSIVE" && v.res.more_leads ? `<h2>What would settle it</h2><ul>${v.res.more_leads.options.map(o => `<li>${o.enough_already ? `Already enough data to detect ${o.lift_pp} points (${esc(o.label)}): any real lift is smaller than that.` : `${nf(o.more_leads)} more leads (about ${o.more_days} days) to detect ${o.lift_pp} points (${esc(o.label)}).${o.impractical ? " Over a year of traffic: not practical." : ""}`}</li>`).join("")}</ul>` : ""}
      <h2>Learning</h2><div class="field"><label for="r-learn">One line that feeds the next suggestions</label><input type="text" id="r-learn" list="r-sugg" value="${esc(dyn(e).learning || "")}" placeholder="for example: slot options work"><datalist id="r-sugg">${sugg.map(s => `<option value="${esc(s)}">`).join("")}</datalist></div>
      <h2>Record</h2><p class="note">${ents.length} entries, head <span class="mono">${esc(ents[ents.length - 1].hash.slice(0, 16))}</span> <button class="link" id="r-ver">Re-check in this browser</button> <span id="r-vo"></span></p>
      <p class="note">${e.kind === "files" ? "These results were supplied as files; Canary advises and does not control live traffic." : "The outcomes are simulated with a known injected effect: this report shows the engine decides correctly, not that a real prompt is better."}</p></div>`;
  trendChart($("#trend"), dayRows(rec), v.win, { finalDay: c.rule_set === "final_look" ? v.win : null });
  $("#r-clone").onclick = () => cloneOf(e);
  $("#r-csv").onclick = () => download(`${e.id}_report.csv`, toCsv(["day", "leads_A", "goal_A", "leads_B", "goal_B", "rate_A", "rate_B", "lift_pp"], dayRows(rec).map(({ day, row }) => [day, row.nA, row.xA, row.nB, row.xB, row.rateA.toFixed(4), row.rateB.toFixed(4), (row.diff * 100).toFixed(2)])));
  $("#r-learn").onchange = ev => { dyn(e).learning = ev.target.value.trim(); saveDyn(); toast("Learning saved."); };
  $("#r-ver").onclick = () => { $("#r-vo").innerHTML = chainOk(ents) ? `<b style="color:#167a70">✓ intact</b>` : `<b style="color:#b23b3b">✕ broken</b>`; };
};

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

/* Suggest A/B Tests, Import results files, and start-up. */

const SF = DYN.ui.sug || { source: "all" };
function priority(c) {
  const score = (c.expected_pp || 0) * (c.ease || 0);
  return { score, label: c.disabled ? ["Unavailable", "plain"] : !c.expected_pp ? ["Follow-up", "run"] : score >= 6 ? ["High", "pos"] : score >= 3 ? ["Medium", "warn"] : ["Low", "plain"] };
}
const v_ok = e => !!e.record && e.record.config.variant_b !== "external";
function historyIdeas() {
  const out = [];
  EXPS().filter(e => ["past_fix_flat", "past_inconclusive"].includes(e.id) || !e.id.startsWith("past_") && !e.id.startsWith("files_")).forEach(e => { const v = view(e); if (v.ended && v.kind === "INCONCLUSIVE" && v.res.more_leads && e.kind !== "files") { const opt = (v.res.more_leads.options || []).find(o => !o.enough_already && !o.impractical); if (opt) out.push({ id: "past_" + e.id, source: "Past tests", title: `Re-run "${e.record.config.name}" for longer`, hypothesis: `It ended inconclusive on day ${v.ld}. Detecting ${opt.lift_pp} points would take about ${nf(opt.more_leads)} more leads (about ${opt.more_days} days). Worth it only if a lift that small matters.`, patch: e.record.variants.B.name, patch_name: e.record.variants.B.name, patch_note: "The same edit as the original test.", metric: e.record.config.primary_goal, expected: `settles whether ${opt.lift_pp} points is real`, expected_pp: 0, days: Math.round(v.ld + opt.more_days), ease: 3, caveat: "", variant: e.record.config.variant_b, e }); } });
  EXPS().forEach(e => { const l = dyn(e).learning; if (l && v_ok(e)) out.push({ id: "learn_" + e.id, source: "Past tests", title: `Follow up on "${l}"`, hypothesis: `You tagged "${e.record.config.name}" with: "${l}". Try a follow-up edit on the same idea.`, patch: e.record.variants.B.name, patch_name: e.record.variants.B.name, patch_note: "The same edit as the original test.", metric: e.record.config.primary_goal, expected: "a follow-up to what you learned", expected_pp: 0, days: null, ease: 2, caveat: "", variant: e.record.config.variant_b }); });
  return out.slice(0, 6);
}
ROUTES.suggest = (el) => {
  const base = C.suggestions.filter(c => !c.from_history), hi = historyIdeas(), all = [...base, ...hi], sources = [...new Set(all.map(c => c.source))];
  const list = all.filter(c => SF.source === "all" || c.source === SF.source), learn = EXPS().map(e => dyn(e).learning && { n: e.record.config.name, t: dyn(e).learning }).filter(Boolean);
  el.innerHTML = head("Suggest A/B Tests", "Ideas for the next tests, each with its evidence and a one-click start. Nothing is invented: where a source has no data, the card says so.") +
    `<div class="filters"><div class="field"><label for="g-src">Idea source</label><select id="g-src"><option value="all">All sources</option>${sources.map(s => `<option ${SF.source === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div><div class="field grow"><label>&nbsp;</label><span class="note">Priority = expected impact × ease. Expected effects are planning figures, not measurements.</span></div></div>
    <div class="grid g2">${list.map(c => { const p = priority(c), cand = C.library.candidates.find(x => x.key === c.variant); return `<div class="card" style="display:grid;gap:12px;${c.disabled ? "opacity:.7" : ""}"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><span class="tag">${esc(c.source)}</span><h3 style="margin-top:8px;font-size:16px">${esc(c.title)}</h3></div>${pill(p.label[0] + (c.expected_pp ? " priority" : ""), p.label[1])}</div>
      <p style="font-size:13px">${esc(c.hypothesis)}</p><dl class="kv" style="grid-template-columns:130px 1fr"><dt>Proposed patch</dt><dd>${c.patch ? esc(c.patch_name || (cand ? cand.name : c.patch)) : `<span class="muted">${esc(c.patch_note)}</span>`}${c.patch ? `<div class="note">${esc(c.patch_note)}</div>` : ""}</dd><dt>Target metric</dt><dd>${c.metric ? esc((C.metrics.find(m => m.key === c.metric) || {}).name || c.metric) : "-"}</dd><dt>Expected effect</dt><dd>${esc(c.expected)}</dd>
        <dt>Days needed</dt><dd>${c.days ? `about <b>${c.days >= 100 ? nf(c.days) : c.days}</b> days at ${nf(SET().leads_per_day)} leads a day, ${pct(SET().share_b, 0)} to B` : "-"}</dd><dt>Priority</dt><dd>${c.expected_pp ? `impact ${c.expected_pp} pp × ease ${c.ease} = ${p.score.toFixed(1)}` : "-"}</dd></dl>
      ${c.caveat ? `<p class="note">${esc(c.caveat)}</p>` : ""}<div class="actions"><button class="btn primary" data-create="${esc(c.id)}" ${c.disabled ? "disabled" : ""}>Create experiment</button></div></div>`; }).join("")}</div>
    ${learn.length ? `<div class="card" style="margin-top:16px"><h2>Learnings from History</h2><div class="sub">One line saved on each finished test. They shape the next ideas.</div><ul style="margin:8px 0 0;padding-left:20px;font-size:13px">${learn.map(l => `<li><b>${esc(l.t)}</b> <span class="muted">(${esc(l.n)})</span></li>`).join("")}</ul></div>` : ""}`;
  $("#g-src").onchange = ev => { SF.source = ev.target.value; DYN.ui.sug = SF; saveDyn(); route(); };
  $$("[data-create]", el).forEach(b => b.onclick = () => { const c = all.find(x => x.id === b.dataset.create); startWizard({ name: c.title, change: c.hypothesis, variant: c.variant || "cap_two_asks", why: c.caveat || "", effect: c.expected, days: c.days ? Math.min(60, Math.max(1, Math.ceil(c.days))) : SET().window_days, mde: c.expected_pp ? Math.max(0.01, c.expected_pp / 100) : SET().mde }); });
};

/* ------------------------------------------------------------------ Import results files: the voice test ran elsewhere; we judge its results */
let IM = { files: [], info: null, err: "" };
ROUTES.import = (el) => {
  const plan = { baseline: 0.45, share_b: 0.30, mde: 0.05, window_days: 14, rule_set: "sequential", ...(DYN.ui.importPlan || {}) };
  el.innerHTML = head("Import results files", "The voice test ran somewhere else. Give Canary the results (one row per call: lead, which prompt, what happened, call length, when) and it decides with the plan you fix here. It advises: it does not change live traffic.", `<a class="btn" href="#/new">Back to New Experiment</a>`) +
    (!LIVE ? `<div class="banner warn"><div><b>Reading your own files needs the live version.</b> Run <span class="mono">./start.sh</span>. Meanwhile, History already holds six decisions made from sample result files.</div></div>` : "") +
    `<div class="g-main grid"><div class="card"><h2>1. Choose the files</h2><div class="sub">One file with a variant column, or two files (A's results, then B's). CSV, tab-separated or JSON; column names are matched flexibly.</div>
      <div class="form-grid" style="margin-top:16px"><div class="field wide"><label for="i-files">Results file(s)</label><input type="file" id="i-files" multiple accept=".csv,.tsv,.txt,.json,.jsonl" ${LIVE ? "" : "disabled"}></div>
        <div class="field"><label for="i-two">If two files</label><select id="i-two"><option value="">One file with a variant column</option><option value="first">First file is A, second is B</option></select></div>${LIVE ? `<div class="field"><label for="i-sample">Or try a synthetic sample</label><select id="i-sample"><option value="">Choose...</option><option value="b_wins">B wins</option><option value="b_harmful">B is worse</option><option value="b_flat">No real difference</option><option value="guardrail_hold">B wins, calls longer</option><option value="early_hangup">B wins, more early hang-ups</option><option value="messy">A messy export</option></select></div>` : ""}</div>
      <div id="i-info" style="margin-top:16px"></div>
      <h2 style="margin-top:24px">2. Fix the plan</h2><div class="sub">The plan sets the decision lines. Write it down before the test starts: numbers picked after seeing results would bend the answer.</div>
      <div class="form-grid" style="margin-top:16px"><div class="field"><label for="i-name">Name</label><input type="text" id="i-name" value="${esc(plan.name || "Results from files")}"></div><div class="field"><label for="i-goal">Which outcomes count as success</label><input type="text" id="i-goal" placeholder="buylead_created"></div>
        <div class="field"><label for="i-base">Expected rate under A (%) <span class="hint">required</span></label><input type="number" id="i-base" value="${Math.round(plan.baseline * 100)}"></div><div class="field"><label for="i-share">Share of traffic sent to B (%) <span class="hint">required</span></label><input type="number" id="i-share" value="${Math.round(plan.share_b * 100)}"></div>
        <div class="field"><label for="i-days">Test length (days) <span class="hint">required</span></label><input type="number" id="i-days" value="${plan.window_days}"></div><div class="field"><label for="i-mde">Smallest lift worth detecting (points)</label><input type="number" id="i-mde" value="${Math.round(plan.mde * 100)}"></div>
        <div class="field"><label for="i-rule">Decision rule</label><select id="i-rule"><option value="sequential" ${plan.rule_set === "sequential" ? "selected" : ""}>Early promote and early stop</option><option value="final_look" ${plan.rule_set === "final_look" ? "selected" : ""}>One winner call at the end + daily harm check</option></select></div><div class="field"><label for="i-hang">Early hang-up guardrail <span class="hint">calls shorter than (seconds)</span></label><input type="number" id="i-hang" placeholder="off"></div></div>
      <div class="actions" style="margin-top:16px"><button class="btn primary" id="i-go" ${LIVE ? "" : "disabled"}>Decide</button><span id="i-err" class="note" style="color:#b23b3b"></span></div></div>
      <div class="card"><h3>What the files should look like</h3><div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Column</th><th>Why</th></tr></thead><tbody><tr><td class="mono">lead_id</td><td>count each lead once</td></tr><tr><td class="mono">variant</td><td>A or B (also control / test)</td></tr><tr><td class="mono">disposition</td><td>what happened</td></tr><tr><td class="mono">timestamp</td><td>read day by day</td></tr><tr><td class="mono">duration_s</td><td>the call-length guardrail</td></tr></tbody></table></div><p class="note" style="margin-top:8px">A daily summary also works: date, variant, leads, goal_count (plus mean and sd duration). It cannot show whether a lead saw both prompts.</p></div></div>`;
  const info = $("#i-info");
  const inspect = async () => {
    const f = IM.files[0]; if (!f) { info.innerHTML = ""; return; }
    info.innerHTML = `<span class="spin"></span> Looking at ${esc(f.name)}...`;
    try {
      const r = await fetch("/api/inspect", { method: "POST", body: JSON.stringify({ name: f.name, text: f.text }) }), j = await r.json(); if (j.error) throw new Error(j.error);
      IM.info = j; const outs = (j.outcomes || []).map(([k, n]) => `<label class="chk" style="border:1px solid var(--line);border-radius:999px;padding:2px 12px;background:var(--bg)"><input type="checkbox" data-out="${esc(k)}" ${/buylead|lead_created|converted|success|meeting|enrich/i.test(k) ? "checked" : ""}> ${esc(k)} <span class="muted">${nf(n)}</span></label>`).join(" ");
      info.innerHTML = `<div class="banner"><div><b>${nf(j.rows)} rows${j.leads ? `, ${nf(j.leads)} leads` : ""}${j.days ? `, ${j.days} days` : ""}.</b> Prompts found: ${Object.entries(j.variants || {}).map(([k, n]) => `${esc(k)} (${nf(n)})`).join(", ") || "none: use two files"}.${outs ? `<div style="margin-top:8px"><b>Tick the outcomes that count as success</b></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">${outs}</div>` : ""}${j.lead_column ? "" : `<div class="note" style="margin-top:8px">No lead id column: every call will count as its own lead.</div>`}</div></div>`;
      const sync = () => { $("#i-goal").value = $$("#i-info [data-out]").filter(c => c.checked).map(c => c.dataset.out).join(","); }; $$("#i-info [data-out]").forEach(c => c.onchange = sync); sync();
    } catch (e) { info.innerHTML = `<div class="banner neg"><div>${esc(String(e.message || e))}</div></div>`; }
  };
  const fi = $("#i-files"); fi.onchange = async () => { IM.files = await Promise.all([...fi.files].map(async f => ({ name: f.name, text: await f.text() }))); inspect(); };
  const smp = $("#i-sample"); if (smp) smp.onchange = async () => { if (!smp.value) return; const r = await fetch("/api/sample/" + smp.value), j = await r.json(); IM.files = [{ name: j.name, text: j.text }]; if (smp.value === "early_hangup") $("#i-hang").value = 15; $("#i-mde").value = 7; inspect(); };
  $("#i-go").onclick = async () => {
    const err = $("#i-err"); err.textContent = ""; if (!IM.files.length) { err.textContent = "Choose a file first."; return; }
    const two = $("#i-two").value === "first" && IM.files.length === 2, files = IM.files.map((f, i) => ({ ...f, arm: two ? (i === 0 ? "A" : "B") : null }));
    const opts = { goal: $("#i-goal").value.trim(), baseline: +$("#i-base").value / 100 || null, share_b: +$("#i-share").value / 100 || null, window_days: +$("#i-days").value || null, mde: (+$("#i-mde").value || 5) / 100, rule_set: $("#i-rule").value, guard_name: $("#i-hang").value ? "early_hangup" : "", guard_below_s: $("#i-hang").value ? +$("#i-hang").value : null, name: $("#i-name").value, exp_id: "exp-files" };
    $("#i-go").disabled = true; $("#i-go").innerHTML = `<span class="spin"></span> Deciding...`;
    try {
      const r = await fetch("/api/decide", { method: "POST", body: JSON.stringify({ files, opts }) }), j = await r.json(); if (j.error) throw new Error(j.error);
      const id = "files-" + Date.now(); const exp = { id, kind: "files", preset: "Results files", hypothesis: `Results supplied as ${IM.files.map(f => f.name).join(", ")}.`, truth: null, record: j.record, start_day: 9999 };
      DYN.launched.unshift(exp); DYN.dyn[id] = { day: 9999, paused: false, approval: null, rolledBack: false, manualStop: false, learning: "" }; saveDyn(); toast(`Decision: ${KIND_LABEL[j.record.result.kind] || j.record.result.kind}`); go("report", id);
    } catch (e) { err.textContent = String(e.message || e); $("#i-go").disabled = false; $("#i-go").textContent = "Decide"; }
  };
};

/* ------------------------------------------------------------------ start */
async function init() {
  if (LIVE) { try { C = await (await fetch("/api/console")).json(); } catch (e) { $("#page").innerHTML = `<div class="empty">Could not reach the engine.</div>`; return; } }
  $("#mode").textContent = LIVE ? "Live engine" : "Offline demo"; $("#mode").className = "pill " + (LIVE ? "pos" : "plain");
  $("#reset-link").onclick = () => go("settings");
  window.addEventListener("hashchange", route); route();
}
init();
