"use strict";
/* Picky console. Plain JS that works offline; two vendored libraries (Chart.js for charts, jsdiff for the prompt diff) and the browser's Web Crypto. Every number shown comes from the bundle the Python engine produced
   (dist/picky_demo.html embeds it; live mode fetches /api/console). Demo state (launched tests, how many days have been played, approvals,
   rollbacks) is saved in the history database on the local live server (picky/store.py) and cached in this browser; the hosted copy and the
   offline file keep it in this browser only. It is reset from Settings. */

const LIVE = !!window.PICKY_LIVE;
const HOSTED = !!window.PICKY_HOSTED;
let C = window.CONSOLE_DATA || null;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nf = n => (n == null || isNaN(n)) ? "-" : Math.round(n).toLocaleString("en-US");
const pct = (x, d = 0) => (x == null || isNaN(x)) ? "-" : (x * 100).toFixed(d) + "%";
const pts = (x, d = 1) => { if (x == null || isNaN(x)) return "-"; const t = Math.abs(x * 100).toFixed(d); return (+t === 0 ? "" : x >= 0 ? "+" : "−") + t + " pp"; };
const sgn = (x, d = 1) => { const t = Math.abs(x).toFixed(d); return (+t === 0 ? "" : x >= 0 ? "+" : "−") + t; };
const confOf = c => Math.round((1 - 2 * ((c && c.alpha) || 0.025)) * 100);                  // the test's confidence, from its locked config
const zOf = c => normPpf(1 - ((c && c.alpha) || 0.025));
const isBetter = (diff, c) => c && c.primary_direction === "lower" ? diff < 0 : diff > 0;     // "better" depends on the goal's direction, not on the sign
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fdate = iso => { const d = new Date(iso); return isNaN(d) ? "-" : `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
const fdt = iso => { const d = new Date(iso); return isNaN(d) ? "-" : `${fdate(iso)}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };
const toast = (msg, ms = 3200) => { const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); };
const download = (name, text, type = "text/csv") => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
const csvCell = v => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (head, rows) => [head.map(csvCell).join(","), ...rows.map(r => r.map(csvCell).join(","))].join("\n");

/* ------------------------------------------------------------------ the decision record, re-checked in this browser with its built-in SHA-256 (Web Crypto) */
const hex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha256 = async str => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)));
/** Every entry must point at the one before and hash to its stored hash, exactly as picky/ledger.py wrote it. */
async function chainOk(entries) {
  if (!(window.crypto && crypto.subtle)) throw new Error("this page is not a secure context, so the browser offers no SHA-256 here");
  let prev = "0".repeat(64); for (const e of entries) { if (e.prev !== prev || await sha256(prev + e.body) !== e.hash) return false; prev = e.hash; } return true;
}

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

/* ------------------------------------------------------------------ the factor catalog (segment helpers are in 05-plan.js) */
const TODAY = "2026-10-09";                                   // the demo's "today": a test that starts later is Scheduled
const CAT = () => C.catalog || { variables: [], strata: [], balance: [], min_stratum: 30, min_share: 0.02 };
const catVar = n => CAT().variables.find(v => v.name === n || v.column === n);
const preCall = () => CAT().variables.filter(v => v.pre_call && !((DYN.settings || {}).preCallOff || []).includes(v.name));
const segChips = seg => segList(seg).length ? segList(seg).map(r => `<span class="tag" title="${esc(r.factor)} is ${esc(orWords(r.values))}">${esc(r.factor)}: ${esc(r.values.join(", "))}</span>`).join(" ") : `<span class="tag">All leads</span>`;
const segOf = e => e.audience || (e.record && e.record.config && e.record.config.segment) || null;       // `audience` is what the person chose when an offline launch replays another test's run

/* ------------------------------------------------------------------ experiments and their demo state */
const SK = "picky_console_v1";
/* Demo state in this browser. A prompt (about 170 KB) is kept once however many drafts and tests use it, and a full storage is reported. */
const BIG_TEXT = 20000, fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36) + "_" + s.length.toString(36); };
function loadDyn() { try { const raw = localStorage.getItem(SK); if (!raw) return null; const o = JSON.parse(raw); return o && o.packed === 2 ? JSON.parse(o.body, (k, v) => typeof v === "string" && v[0] === "\u0001" ? o.texts[v.slice(1)] : v) : o; } catch { return null; } }
const DYN = loadDyn() || { dyn: {}, launched: [], settings: {}, libLog: [], ui: {} };
let saveWarned = false;
const packDyn = obj => { const texts = {}, body = JSON.stringify(obj, (k, v) => { if (typeof v === "string" && v.length > BIG_TEXT) { const h = fnv(v); texts[h] = v; return "\u0001" + h; } return v; }); return JSON.stringify({ packed: 2, texts, body }); };
/* This browser's cache. With the history database on, a launched test the database holds is not cached a second time (a prompt is ~170 KB); and
   every change that has not reached the database yet is listed (storePending) with the version it was based on (storeRev), so a reload before
   the next save, or a server that was briefly out of reach, does not lose it. */
const storeCache = () => { const items = storeItems(); return { ...DYN, launched: DYN.launched.filter(e => !STORE.held.has(e.id)),
  storePending: Object.keys(items).filter(k => k[0] !== "t" && STORE.sent[k] !== fnv(JSON.stringify(items[k]))), storeRev: STORE.rev }; };
/** Another tab of this browser shares the cache: its changes still waiting for the database are carried over, not overwritten (unless this tab
    changed the same item too, or has seen a newer save of it). */
function withOtherTabs(c) {
  const o = loadDyn(); if (!o || o.storeEpoch !== DYN.storeEpoch || !(o.storePending || []).length) return c;
  const out = { ...c, dyn: { ...c.dyn }, storePending: [...c.storePending], storeRev: { ...c.storeRev } }, mine = new Set(c.storePending);
  for (const k of o.storePending) { const id = k.slice(2), rev = (o.storeRev || {})[k] || 0, val = k[0] === "s" ? (o.dyn || {})[id] : o[id];
    if (mine.has(k) || (STORE.rev[k] || 0) !== rev || val === undefined || JSON.stringify(val) === JSON.stringify(k[0] === "s" ? c.dyn[id] : c[id])) continue;   // nothing of theirs to keep
    if (k[0] === "s") out.dyn[id] = val; else out[id] = val; out.storePending.push(k); out.storeRev[k] = rev; }
  return out;
}
const writeCache = () => { const db = (STORE.on && STORE.epoch) || STORE.track, put = o => { try { localStorage.setItem(SK, packDyn(o)); return true; } catch { return false; } };
  if (put(db ? withOtherTabs(storeCache()) : DYN)) return;
  if (db) { const c = withOtherTabs(storeCache()), unsaved = c.launched.filter(e => !STORE.held.has(e.id) && !(DYN.storeRejected || []).includes(e.id));
    if (put({ ...c, launched: c.launched.filter(e => !STORE.sent["t:" + e.id]) })) return;          // tests already sent are on their way
    if (put({ ...c, launched: [] })) { if (unsaved.length && !saveWarned) { saveWarned = true; toast(`This browser's storage is full. ${unsaved.length} test${unsaved.length > 1 ? "s are" : " is"} being saved to the history database: keep this tab open until that is done.`, 6000); } return; } }
  if (!saveWarned) { saveWarned = true; toast(db ? "This browser's storage is full. Your tests are safe in the history database; only this browser's shortcuts are not saved." : "This browser could not save the demo state (its storage is full). Delete old drafts, or reset the demo in Settings.", 6000); } };
const saveDyn = () => { writeCache(); storeSync(); };

/* The history database (picky/store.py, one SQLite file on the live server). On the local live server every launched test, its state and every
   click is saved there, so all browsers on that server share one history and it survives a restart; this browser's copy is a cache. The hosted
   copy and the offline file have no server: they keep the state in this browser only. Only what changed since the last save is sent, with the
   version (rev) this browser last saw: a save based on an older version is refused and this browser reloads the latest. */
const APP_KEYS = ["drafts", "settings", "libLog", "libRolled"], APP_EMPTY = () => ({ drafts: [], settings: {}, libLog: [], libRolled: [] });
const STORE = { on: LIVE && !HOSTED, track: false, epoch: null, sent: {}, rev: {}, held: new Set(), timer: null, busy: false, again: false, warned: false, info: null };
const STORE_PART = 4e6;                                       // a first save from a browser with many tests goes up in parts of about 4 MB
const storeItems = () => { const out = {}, rej = new Set(DYN.storeRejected || []);       // a test the database refused stays in this browser only
  DYN.launched.forEach(e => { if (!rej.has(e.id)) out["t:" + e.id] = e; }); Object.keys(DYN.dyn).forEach(id => { if (!rej.has(id)) out["s:" + id] = DYN.dyn[id]; });
  APP_KEYS.forEach(k => { if (DYN[k] != null) out["a:" + k] = DYN[k]; }); return out; };
function storeSync() { if (!STORE.on || !STORE.epoch) return; clearTimeout(STORE.timer); STORE.timer = setTimeout(storePush, 200); }
async function storePush() {
  if (STORE.busy) { STORE.again = true; return; }
  const body = { epoch: STORE.epoch, tests: [], state: {}, app: {}, revs: {} }, sent = {}, later = new Set(); let size = 0;
  for (const [k, v] of Object.entries(storeItems())) {          // tests come first, then states, then drafts and settings
    const text = JSON.stringify(v), sg = fnv(text), id = k.slice(2); if (STORE.sent[k] === sg) continue;
    if (k[0] === "t") { if (body.tests.length && size + text.length > STORE_PART) { later.add(id); continue; } body.tests.push(v); size += text.length; }
    else if (k[0] === "s") { if (later.has(id)) continue; body.state[id] = v; body.revs[k] = STORE.rev[k] || 0; }
    else { body.app[id] = v; body.revs[k] = STORE.rev[k] || 0; }
    sent[k] = sg;
  }
  if (!Object.keys(sent).length) return;
  STORE.busy = true;
  try {
    const r = await fetch("/api/store", { method: "POST", headers: { "X-Picky-Store": "1" }, body: JSON.stringify(body) }), j = await r.json();
    if (r.status === 409) { STORE.on = false; toast(j.reset ? "The history was reset from another browser. Reloading it." : "Another browser saved a newer version of this. Loading the latest.", 4000); if (j.reset) try { localStorage.removeItem(SK); } catch { } setTimeout(() => location.reload(), 1500); return; }
    if (j.error) throw new Error(j.error);
    const rej = (j.rejected || []).map(x => x.id).filter(Boolean);
    Object.assign(STORE.sent, sent); Object.assign(STORE.rev, j.revs || {}); STORE.warned = false;
    body.tests.forEach(t => { if (!rej.includes(t.id)) STORE.held.add(t.id); });
    if (rej.length) { DYN.storeRejected = [...new Set([...(DYN.storeRejected || []), ...rej])]; toast(`${rej.length} test${rej.length > 1 ? "s" : ""} in this browser could not be saved to the history database (${j.rejected[0].error}). ${rej.length > 1 ? "They stay" : "It stays"} in this browser only.`, 7000); }
    writeCache();                                                // nothing pending any more (or less)
    if (later.size) STORE.again = true;
  } catch (e) { if (!STORE.warned) { STORE.warned = true; toast(`Could not save to the history database (${e.message || e}). The change is kept in this browser (also across a reload) and sent again with the next one.`, 6000); } }
  finally { STORE.busy = false; if (STORE.again) { STORE.again = false; storeSync(); } }
}
/** The first time a browser that was used before the database connects, both sides are kept (drafts, the library log, custom metrics). */
function storeMerge(k, srv, loc) {
  const union = (a, b, key) => [...a, ...b.filter(x => !a.some(y => key(y) === key(x)))];
  if (k === "drafts") return union(srv, loc, x => x.id);
  if (k === "libLog") return union(srv, loc, x => x.ts + "|" + x.type + "|" + x.text);
  if (k === "libRolled") return [...new Set([...srv, ...loc])];
  const cm = union(srv.customMetrics || [], loc.customMetrics || [], x => x.key);
  return { ...loc, ...srv, ...(cm.length ? { customMetrics: cm } : {}) };
}
/** On start the database's copy is read. Same history as this browser's cache: the database wins for anything both have, except a change this
    browser made that never reached the database and that nobody changed since (it is kept and sent); what only this browser has is sent up
    (on its first visit everything it has, merged). After a reset elsewhere, this browser's old cache is dropped. */
async function storeLoad() {
  if (!STORE.on) return;
  let s; try { const r = await fetch("/api/store"); s = await r.json(); if (!r.ok || s.error) throw Object.assign(new Error(s.error || r.status), { code: r.status }); }
  catch (e) { STORE.on = false; if (e.code === 403) return;                    // another computer or a tunnel: this browser keeps its own state, as before
    if (DYN.storeEpoch) {        // this browser used the database before: what changes now is remembered (pending) and sent when it is back
      STORE.track = true; STORE.rev = { ...(DYN.storeRev || {}) }; const old = new Set(DYN.storePending || []);
      Object.entries(storeItems()).forEach(([k, v]) => { if (!old.has(k)) STORE.sent[k] = fnv(JSON.stringify(v)); });
      toast("The history database could not be read. Changes made now are kept in this browser and sent when it is back: reload the page then.", 7000);
    } else toast(`The history database could not be read (${e.message || e}). This browser keeps its own state for now.`, 6000);
    return; }
  const first = !DYN.storeEpoch, same = first || DYN.storeEpoch === s.epoch, ids = new Set(s.launched.map(e => e.id)), empty = APP_EMPTY(), revs = s.revs || {};
  const pend = new Set(same && !first ? DYN.storePending || [] : []), lrev = DYN.storeRev || {}, lost = [];
  const mine = k => pend.has(k) && (revs[k] || 0) === (lrev[k] || 0);            // changed here, never saved, and nobody saved it since
  DYN.launched = [...s.launched, ...(same ? DYN.launched.filter(e => !ids.has(e.id) && !e.id.startsWith("replay-")) : [])];
  const dyn = { ...(same ? DYN.dyn : {}) };
  Object.entries(s.dyn).forEach(([id, v]) => { if (mine("s:" + id) && dyn[id]) return; if (pend.has("s:" + id)) lost.push(id); dyn[id] = v; });
  DYN.dyn = dyn;
  APP_KEYS.forEach(k => { const srv = s.app[k], loc = same ? DYN[k] : null;
    DYN[k] = srv == null ? (loc != null ? loc : empty[k]) : loc == null ? srv : first ? storeMerge(k, srv, loc) : mine("a:" + k) ? loc : srv;
    if (DYN[k] !== srv && srv != null && JSON.stringify(DYN[k]) === JSON.stringify(srv)) DYN[k] = srv;       // nothing new: nothing to send
    if (srv != null && pend.has("a:" + k) && DYN[k] === srv) lost.push(k); });
  delete DYN.storePending; delete DYN.storeRev;
  DYN.storeEpoch = STORE.epoch = s.epoch; STORE.info = s.info; STORE.rev = { ...revs };
  s.launched.forEach(e => { STORE.sent["t:" + e.id] = fnv(JSON.stringify(e)); STORE.held.add(e.id); });
  Object.entries(s.dyn).forEach(([id, v]) => { if (DYN.dyn[id] === v) STORE.sent["s:" + id] = fnv(JSON.stringify(v)); });
  APP_KEYS.forEach(k => { if (s.app[k] != null && DYN[k] === s.app[k]) STORE.sent["a:" + k] = fnv(JSON.stringify(s.app[k])); });
  if (lost.length) toast(`Changes this browser made while the history database was out of reach were replaced by newer saves from another browser (${lost.slice(0, 3).join(", ")}${lost.length > 3 ? " ..." : ""}).`, 7000);
  saveDyn();
}
const SET = () => ({ ...C.defaults, ...DYN.settings });
const EXPS = () => [...C.demo, ...DYN.launched, ...C.past];
const byId = id => EXPS().find(e => e.id === id);
const isPast = e => e.id.startsWith("past_") || e.id.startsWith("files_");
const dyn = e => (DYN.dyn[e.id] = DYN.dyn[e.id] || { day: e.kind === "simulated" && e.start_day ? e.start_day : isPast(e) ? 9999 : 1, paused: false,
  approval: isPast(e) && e.record.result.kind === "HOLD_FOR_APPROVAL" ? "rejected" : null,       // history samples are already settled: a person kept A
  rolledBack: false, manualStop: false, learning: "" });

/** Which pre-chained branch of the record the test has taken: a person's click, or the autopilot's own action (d.auto / d.autoRoll). */
const tailKey = d => d.approval === "approved" ? (d.rolledBack ? "approve_rollback" : "approve") : d.approval === "rejected" ? (d.auto ? "auto_reject" : "reject") : d.rolledBack ? (d.autoRoll ? "auto_rollback" : "rollback") : null;

/** The record's entries for that branch. A test saved before a branch existed falls back to the closest one it has. */
const tailOf = (rec, d) => { const t = (rec && rec.tails) || {}, k = tailKey(d); return (k && (t[k] || (k === "approve_rollback" ? t.approve : null))) || []; };

/** Day-by-day rows of a record: the last look of each day. */
function dayRows(rec) { const m = new Map(); rec.looks.forEach(r => m.set(r.day, r)); return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([day, row]) => ({ day, row })); }
const lastDay = e => { const r = dayRows(e.record); return r.length ? r[r.length - 1].day : 0; };
const windowDays = e => e.record.config.window_days;
const KIND_LABEL = { PROMOTE: "Promoted", STOP_HARM: "Stopped: B worse", LOSS: "Keep A: B was worse (a loss)", STOP_GUARDRAIL: "Stopped: guardrail", HOLD_FOR_APPROVAL: "Held for approval", INCONCLUSIVE: "Inconclusive, keep A", HALT_SRM: "Halted: broken test", CONTINUE: "Running", STOPPED_MANUAL: "Stopped by a person", REJECTED: "Rejected: kept A", ROLLED_BACK: "Promoted, then rolled back" };
const KIND_CLASS = { PROMOTE: "pos", STOP_HARM: "neg", LOSS: "neg", STOP_GUARDRAIL: "neg", HOLD_FOR_APPROVAL: "warn", INCONCLUSIVE: "plain", HALT_SRM: "warn", CONTINUE: "run", STOPPED_MANUAL: "neg", REJECTED: "plain", ROLLED_BACK: "warn" };

/** The primary metric of a test. Tests launched from the New Experiment page carry their locked metric list; older ones are lead-level rates. */
const primaryDef = c => { const p = ((c && c.metrics) || []).find(x => x.role === "primary"); if (p) return p.def; const m = (C.metrics || []).find(x => x.key === (c && c.primary_goal)); return { type: "rate", key: c && c.primary_goal, name: m ? m.name : String((c && c.primary_goal) || "").replace(/_/g, " "), direction: (c && c.primary_direction) || "higher", leadLevel: true }; };
const leadLevelRate = d => d.type === "rate" && (d.leadLevel || (d.num && d.den && d.num.unit === "leads" && d.den.unit === "leads"));
const goalName = c => primaryDef(c).name;
const fmtP = (v, c, d = 1) => fmtMetric(v, primaryDef(c), d);                 // a value of the primary goal: 45.1% or 69.9 s
const fmtD = (v, c, d = 1) => fmtDelta(v, primaryDef(c), d);                  // a difference: +5.0 pts or −3.2 s
const rangeD = (lo, hi, c, d = 1) => `${fmtD(lo, c, d)} to ${fmtD(hi, c, d)}`;
/** One arm's 95% range: Wilson for a lead-level rate, value +- 1.96 SE otherwise. */
function armCI(row, arm, c) {
  const d = primaryDef(c), v = row["rate" + arm], se = row["se" + arm];
  if (leadLevelRate(d) || se == null) return wilson(row["x" + arm], row["d" + arm] != null ? row["d" + arm] : row["n" + arm]);
  return [v - 1.96 * se, v + 1.96 * se];
}
/** 95% range of the lift. The engine's range is used when it is usable (the end-of-test call, or an always-valid look); on early looks of the
    one-look rule the engine range is deliberately infinite, so a plain interim range is shown and labelled as such. */
function liftRange(row, c) {
  const avg = primaryDef(c).type === "average", w = row.rci ? Math.abs(row.rci[1] - row.rci[0]) : 9e9;
  if (row.rci && (avg ? isFinite(w) && w < 1e6 : w <= 0.6) && row.eff <= 50) return { lo: row.rci[0], hi: row.rci[1], interim: false };
  const se = row.seA != null && row.seB != null ? Math.sqrt(row.seA ** 2 + row.seB ** 2) : Math.sqrt(row.rateA * (1 - row.rateA) / Math.max(1, row.dA || row.nA) + row.rateB * (1 - row.rateB) / Math.max(1, row.dB || row.nB)), z = zOf(c);
  return { lo: row.diff - z * se, hi: row.diff + z * se, interim: true };
}
/** One guardrail's state, used by the Live tile, the History column and the report so they can never disagree.
    kind: "rel" (a relative change), "pts" (points of a rate) or "units" (an average's own unit, `unit`). */
function guardStatus(g, margin, kind, v, unit) {
  const f = x => kind === "rel" ? sgn(x * 100, 0) + "%" : kind === "units" ? sgn(x, 1) + (unit ? " " + unit : "") : sgn(x * 100, 1) + " pp", lim = kind === "rel" ? "+" + (margin * 100).toFixed(0) + "%" : kind === "units" ? "+" + (+margin).toFixed(1) + (unit ? " " + unit : "") : "+" + (margin * 100).toFixed(0) + " pp";
  if (!g || g.se == null || !isFinite(g.se)) return { label: "Not enough data", cls: "warn", short: "Not proven", value: "-", range: "", lim, f };
  const zc = zOf(v.config), lo = g.worse - zc * g.se, hi = g.worse + zc * g.se, bad = g.z_breach >= (v.cur ? (v.cur.harm_g != null ? v.cur.harm_g : v.cur.harm) : 99), decided = v.decided;
  const stoppedElsewhere = decided && ["STOP_HARM", "HALT_SRM"].includes(v.res.kind);
  let label, cls, short;
  if (bad) { label = "✕ Fail: limit breached"; cls = "neg"; short = "Fail: breached"; }
  else if (stoppedElsewhere) { label = "Not evaluated: the test stopped on another rule"; cls = "plain"; short = "n/a (stopped)"; }
  else if (decided) { if (hi < margin) { label = "✓ Pass: proven within the limit"; cls = "pos"; short = "Pass"; } else { label = "✕ Not proven within the limit"; cls = "warn"; short = "Not proven"; } }
  else if (hi < margin) { label = "✓ Within the limit so far"; cls = "pos"; short = "Within the limit so far"; }
  else if (lo > margin) { label = "✕ Over the limit so far"; cls = "neg"; short = "Over the limit so far"; }
  else { label = "… Not yet proven"; cls = "warn"; short = "Not yet proven"; }
  return { label, cls, short, value: f(g.worse), range: `${f(lo)} to ${f(hi)}`, lim, f };
}
/** A test's guardrails with their state. Tests from the New Experiment page read their metric list; older ones the two fixed guardrails. */
function guardList(v) {
  const c = v.config, cur = v.cur, out = [];
  if (c.metrics) {
    c.metrics.forEach(x => { if (x.role !== "guardrail") return; const d = x.def, m = cur && (cur.metrics || []).find(y => y.key === d.key && y.role === "guardrail"), avg = d.type === "average", kind = x.limit.kind === "rel" ? "rel" : avg ? "units" : "pts";
      const margin = x.limit.kind === "rel" || !avg ? x.limit.value / 100 : x.limit.value, unit = avg ? metricUnit(d) : "";
      out.push({ name: d.name, def: d, limit: x.limit, conf: confOf(c), st: guardStatus(m ? { worse: m.worse, se: m.worse_se, z_breach: m.z_breach } : null, margin, kind, v, unit), g: m || null, metric: m || null }); });
    return out;
  }
  if (c.secondary_role === "guardrail") out.push({ name: "Call duration", conf: confOf(c), st: guardStatus(cur && cur.guardrail, c.guardrail_margin, "rel", v), g: cur && cur.guardrail });
  if (c.guard_rate) out.push({ name: c.guard_rate.replace(/_/g, " ").replace(/^./, x => x.toUpperCase()), conf: confOf(c), st: guardStatus(cur && cur.guardrail2, c.guard_rate_margin, "pts", v), g: cur && cur.guardrail2 });
  return out;
}
function guardOverall(v) {
  const l = guardList(v); if (!l.length) return { short: "n/a", cls: "plain" };
  const worst = l.find(x => x.st.cls === "neg") || l.find(x => x.st.cls === "warn") || l.find(x => x.st.cls === "plain") || l[0];
  return { short: l.length > 1 && worst.st.cls !== "pos" ? worst.name + ": " + worst.st.short : worst.st.short, cls: worst.st.cls };
}
/** Secondary metrics of a test: A against B with the 95% range of the difference. For insight only. */
function secondaryList(v) { const c = v.config, cur = v.cur; return ((c && c.metrics) || []).filter(x => x.role === "secondary").map(x => ({ def: x.def, direction: x.def.direction, m: cur && (cur.metrics || []).find(y => y.key === x.def.key && y.role === "secondary") })); }
function secondaryHtml(v) {
  const list = secondaryList(v); if (!list.length) return "";
  return `<div class="tbl-wrap"><table><thead><tr><th>Metric</th><th class="num">A: today's prompt</th><th class="num">B: new prompt</th><th class="num">B minus A (95% range)</th><th>Better</th></tr></thead><tbody>${list.map(({ def, direction, m }) => `<tr><td><b>${esc(def.name)}</b><div class="note">${esc(metricWords(def))}</div></td>
    <td class="num">${m ? fmtMetric(m.A.value, def) : "-"}</td><td class="num">${m ? fmtMetric(m.B.value, def) : "-"}</td><td class="num">${m && m.diff != null ? `<b>${fmtDelta(m.diff, def)}</b><div class="note">${fmtDelta(m.lo, def)} to ${fmtDelta(m.hi, def)}</div>` : "-"}</td><td>${direction === "lower" ? "↓ lower" : "↑ higher"}</td></tr>`).join("")}</tbody></table></div>`;
}
/** The locked metric list in plain words (Review, the final report). */
function metricsSummaryHtml(c) {
  if (!c.metrics) return `<div><b>${esc(goalName(c))}</b> (primary, ${c.primary_direction === "lower" ? "lower" : "higher"} is better)</div>${c.secondary_role === "guardrail" ? `<div><b>Call duration</b> (guardrail): must not rise by more than ${(c.guardrail_margin * 100).toFixed(0)}%</div>` : ""}${c.guard_rate ? `<div><b>${esc(c.guard_rate.replace(/_/g, " "))}</b> (guardrail): must not rise by more than ${(c.guard_rate_margin * 100).toFixed(0)} points</div>` : ""}`;
  return c.metrics.map(x => `<div><span class="tag">${x.role === "primary" ? "Primary" : x.role === "guardrail" ? "Guardrail" : "Secondary"}</span> <b>${esc(x.def.name)}</b> ${x.def.direction === "lower" ? "↓" : "↑"} <span class="muted">${esc(metricWords(x.def))}</span>${x.role === "guardrail" && x.limit ? ` · <b>${esc(limitWords(x.limit, x.def, x.def.direction))}</b>` : ""}${x.role === "secondary" ? ` <span class="note">(for insight only)</span>` : ""}</div>`).join("");
}
/** "100% of counted leads matched this rule", from the engine's re-check of every counted lead. */
function segMatchLine(rec) { const s = rec.result && rec.result.segment_check; if (!s) return ""; return `${pct(s.matching / Math.max(1, s.counted_leads), 0)} of counted leads matched this rule (${nf(s.matching)} of ${nf(s.counted_leads)}, re-read from the record)`; }

/** Everything the screens need about one experiment at its current demo day. */
function view(e) {
  const d = dyn(e), rec = e.record, res = rec.result, ld = lastDay(e), win = windowDays(e);
  const day = Math.min(d.day, Math.max(ld, 1));
  const decided = res.status !== "running" && day >= ld;                       // the engine's call becomes visible on its day
  let kind = decided ? res.kind : "CONTINUE";
  if (kind === "STOP_HARM" && res.cause === "loss_at_end") kind = "LOSS";       // the one-look rule's end-of-test call: significantly worse, kept out, logged as a loss
  if (d.manualStop && !decided) kind = "STOPPED_MANUAL";
  if (decided && kind === "HOLD_FOR_APPROVAL" && d.approval === "approved") kind = "PROMOTE";
  if (decided && kind === "HOLD_FOR_APPROVAL" && d.approval === "rejected") kind = "REJECTED";
  if (kind === "PROMOTE" && d.rolledBack) kind = "ROLLED_BACK";
  const finished = decided && !(kind === "HOLD_FOR_APPROVAL") || d.manualStop;
  const sched = !!e.scheduled && !d.started;                                   // launched for a later start date: nothing has run yet
  const rows = sched ? [] : dayRows(rec).filter(r => r.day <= day);
  const cur = rows.length ? rows[rows.length - 1].row : null;
  const ended = !sched && (finished || (decided && kind === "HOLD_FOR_APPROVAL"));
  let status;
  if (sched) status = ["Scheduled for " + fdate(rec.config.start), "plain"];
  else if (d.manualStop && !decided) status = ["Stopped by a person", "neg"];
  else if (kind === "HOLD_FOR_APPROVAL") status = ["Ready to decide", "warn"];
  else if (ended) status = [KIND_LABEL[kind] || kind, KIND_CLASS[kind] || "plain"];
  else if (d.paused) status = ["Paused", "plain"];
  else if (cur && cur.z <= -1.96) status = ["Watch: B looks worse", "warn"];
  else status = ["On track", "run"];
  const hb = rec.holdback && kind === "PROMOTE" && !d.rolledBack ? { all: rec.holdback, day: d.hold || 0, rows: rec.holdback.rows.slice(0, d.hold || 0), done: (d.hold || 0) >= rec.holdback.days } : null;   // the week after a promotion
  return { d, rec, res, day, ld, win, decided: decided && !sched, kind: sched ? "CONTINUE" : kind, finished: !!finished && !sched, ended, rows, cur, status, running: !ended && !d.paused && !sched, scheduled: sched, holdback: hb, config: rec.config };
}
/** The event that makes a held test promote (a person's approval) counts as a promotion at that time. */
function promotedExperiments() {
  const out = [];
  EXPS().filter(e => !isPast(e)).forEach(e => { const v = view(e); if (v.decided && (v.res.kind === "PROMOTE" || (v.res.kind === "HOLD_FOR_APPROVAL" && v.d.approval === "approved"))) out.push({ e, v, time: v.res.time }); });
  return out.sort((a, b) => a.time < b.time ? -1 : 1);
}

/* ------------------------------------------------------------------ events (the Decision Log): the engine's own record, plus the console's actions */
const EV_TYPES = ["Saved", "Started", "Harm alert", "Split alert", "Stopped", "Promoted", "Approved", "Rejected", "Rolled back", "Held", "Inconclusive", "Holdback", "Paused", "Resumed"];
function eventsFor(e) {
  const v = view(e), rec = e.record, out = [], name = rec.config.name, id = e.id;
  const tail = tailOf(rec, v.d);
  const push = (ts, type, text, hash) => out.push({ ts, type, text, hash: hash ? hash.slice(0, 10) : "", exp: name, id });
  const visibleUntilDay = v.day;
  for (const ent of rec.ledger) {
    const b = JSON.parse(ent.body), p = b.payload;
    if (b.type === "look") continue;
    if (b.type === "experiment_created") { push(b.ts, "Started", `Launched ${p.config.rule_set === "final_look" ? "(one winner call on the last day)" : "(early promote and early stop)"}; config version ${p.config_version} (${p.config_hash}); locked.${p.audience ? ` Audience: ${p.audience.rule} (${(p.audience.share_of_traffic * 100).toFixed(0)}% of traffic, about ${nf(p.audience.eligible_per_day)} leads a day); split dealt in blocks of ${p.audience.block}.` : ""}`, ent.hash); continue; }
    if (b.type === "routing_changed" && b.seq <= 1) continue;
    if (!v.decided) continue;
    if (b.type === "decision") {
      if (p.kind === "STOP_HARM" && p.cause !== "loss_at_end") { push(b.ts, "Harm alert", p.reason, ent.hash); }
      else if (p.kind === "STOP_GUARDRAIL") { push(b.ts, "Harm alert", "Guardrail breached. " + p.reason, ent.hash); }
      const t = { PROMOTE: "Promoted", STOP_HARM: "Stopped", STOP_GUARDRAIL: "Stopped", HOLD_FOR_APPROVAL: "Held", INCONCLUSIVE: "Inconclusive", HALT_SRM: "Split alert" }[p.kind] || p.kind;
      push(b.ts, t, p.kind === "PROMOTE" || p.kind === "HOLD_FOR_APPROVAL" || p.kind === "INCONCLUSIVE" || p.kind === "HALT_SRM" ? p.reason : (p.cause === "loss_at_end" ? "Logged as a loss: " + p.reason + ". A stays live." : "B stopped; its leads go back to A. Calls after the stop are left out of the analysis."), ent.hash);
    } else if (b.type === "promotion") push(b.ts, "Promoted", `Production prompt ${p.production_before.slice(0, 7)} → ${p.production_after.slice(0, 7)} (${p.approval}).`, ent.hash);
    else if (b.type === "approval_requested") push(b.ts, "Held", "Approval requested. Callers are unaffected while a person decides.", ent.hash);
  }
  if (tail) for (const ent of tail) {
    const b = JSON.parse(ent.body), p = b.payload;
    if (b.type === "approval") push(b.ts, p.action === "approved" ? "Approved" : "Rejected", p.policy ? `${p.by}: ${p.policy}.` : `${p.action[0].toUpperCase() + p.action.slice(1)} by ${p.by}${p.simulated ? " (a demo click)" : ""}.`, ent.hash);
    else if (b.type === "promotion") push(b.ts, "Promoted", `Production prompt ${p.production_before.slice(0, 7)} → ${p.production_after.slice(0, 7)} (${p.approval}).`, ent.hash);
    else if (b.type === "rollback") push(b.ts, "Rolled back", p.by === AUTOPILOT_BY ? `${p.by}: ${p.reason}.` : `${p.reason} (${p.by}${p.simulated ? ", a demo click" : ""}).`, ent.hash);
  }
  (v.d.console || []).forEach(x => out.push({ ts: x.ts, type: x.type, text: x.text, hash: "", exp: name, id }));
  return out.filter(x => x.type !== "Started" || true);
}
const allEvents = () => EXPS().flatMap(eventsFor).concat((DYN.libLog || []).map(x => ({ ...x, exp: x.exp || "Prompt Library", id: "" }))).sort((a, b) => a.ts < b.ts ? 1 : -1);
const nowTs = e => { const v = view(e); return (v.cur && v.cur.time) || e.record.config.start; };

/* ------------------------------------------------------------------ routing and shell */
const NAV = [["overview", "Overview"], ["new", "New Experiment"], ["experiments", "All experiments"], ["suggest", "Suggest A/B Tests"], ["library", "Prompt Library"], ["log", "Decision Log"], ["settings", "Settings"]];
const ROUTES = {};
let CUR = { name: "overview", arg: null };
function route() {
  const raw = (location.hash || "#/overview").replace(/^#\/?/, ""), qi = raw.indexOf("?"), h = (qi < 0 ? raw : raw.slice(0, qi)).split("/");
  if (h[0] === "live") { location.replace(h[1] ? "#/experiments/" + h[1] : "#/experiments?status=running"); return; }      // the old Live Experiments and History pages
  if (h[0] === "history") { location.replace("#/experiments?status=finished"); return; }
  const name = ROUTES[h[0]] ? h[0] : "overview"; CUR = { name, arg: h[1] ? decodeURIComponent(h[1]) : null, query: new URLSearchParams(qi < 0 ? "" : raw.slice(qi + 1)) };
  render();
}
const go = (name, arg) => { location.hash = "#/" + name + (arg ? "/" + encodeURIComponent(arg) : ""); };
function render() {
  const run = EXPS().filter(e => view(e).running).length;
  $("#nav").innerHTML = NAV.map(([k, n]) => `<a href="#/${k}" ${CUR.name === k || (k === "experiments" && CUR.name === "report") ? 'aria-current="page"' : ""}><span>${n}</span>${k === "experiments" ? `<span class="count" title="Running tests">${run}</span>` : ""}</a>`).join("");
  const fn = ROUTES[CUR.name]; $("#page").innerHTML = ""; fn($("#page"), CUR.arg);
  scrollTo(0, 0); document.title = `Picky - ${(NAV.find(n => n[0] === CUR.name) || ["", "Report"])[1]}`;
}
const head = (title, sub, actions = "") => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div><div class="actions">${actions}</div></div>`;
const pill = (txt, cls) => `<span class="pill ${cls || ""}">${esc(txt)}</span>`;
const statusPill = v => pill(v.status[0], v.status[1]);

/* a small tooltip */
const tip = (() => { const el = document.createElement("div"); el.className = "tip"; el.hidden = true; document.addEventListener("DOMContentLoaded", () => document.body.appendChild(el)); return { show(html, ev) { el.innerHTML = html; el.hidden = false; const r = el.getBoundingClientRect(); let x = ev.clientX + 14, y = ev.clientY + 14; if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14; if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14; el.style.left = x + "px"; el.style.top = y + "px"; }, hide() { el.hidden = true; } }; })();
