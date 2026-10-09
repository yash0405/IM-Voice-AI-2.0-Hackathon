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

/* ------------------------------------------------------------------ the variable catalog and segment rules (BRD section 0 and 2) */
const TODAY = "2026-10-09";                                   // the demo's "today": a test that starts later is Scheduled
const CAT = () => C.catalog || { variables: [], synonyms: {}, in_call_words: [], strata: [], balance: [], min_stratum: 30, min_share: 0.02 };
const catVar = n => CAT().variables.find(v => v.name === n);
const preCall = () => CAT().variables.filter(v => v.pre_call && !((DYN.settings || {}).preCallOff || []).includes(v.name));
const segRules = seg => (seg && seg.rules) || [];
function segShare(seg) { let s = 1; for (const r of segRules(seg)) { const v = catVar(r.var); s *= v.values.reduce((a, x, i) => a + (r.values.includes(x) ? v.mix[i] : 0), 0); } return s; }
const ruleSort = rs => rs.slice().sort((a, b) => (catVar(a.var).rule_order || 9) - (catVar(b.var).rule_order || 9));      // City, then Nature of Business, then Hot Lead type: the BRD's order
function segDescribe(seg) { if (!segRules(seg).length) return "All leads (neutral test)"; return ruleSort(segRules(seg)).map(r => { const v = catVar(r.var); return r.values.length === 1 ? `${v.short} = ${r.values[0]}` : `${v.short} IN (${r.values.join(", ")})`; }).join(" AND "); }
const segChips = seg => segRules(seg).length ? ruleSort(segRules(seg)).map(r => `<span class="tag" title="${esc(catVar(r.var).label)}">${esc(catVar(r.var).short)}: ${esc(r.values.join(", "))}</span>`).join(" ") : `<span class="tag">All leads</span>`;
const segOf = e => e.audience || (e.record && e.record.config && e.record.config.segment) || null;       // `audience` is what the person chose when an offline launch replays another test's run
function segAllowed(seg, name) { const r = segRules(seg).find(x => x.var === name); return r ? r.values : catVar(name).values; }
function planStrata(eligTotal, seg) {                          // the strata the router will deal blocks into; small ones merge into "Other"
  const names = CAT().strata, lists = names.map(n => segAllowed(seg, n)), prob = (n, val) => { const v = catVar(n), ok = segAllowed(seg, n), tot = v.values.reduce((a, x, i) => a + (ok.includes(x) ? v.mix[i] : 0), 0); return ok.includes(val) ? v.mix[v.values.indexOf(val)] / tot : 0; };
  let rows = [[]]; lists.forEach(l => { rows = rows.flatMap(r => l.map(x => [...r, x])); });
  const out = rows.map(k => ({ label: k.join(" x "), expected: eligTotal * k.reduce((p, val, i) => p * prob(names[i], val), 1) })); out.forEach(r => r.merged = r.expected < CAT().min_stratum && out.length > 1);
  return { strata: out, merged: out.filter(r => r.merged).map(r => r.label) };
}
const blockFor = share => { for (const size of [10, 20, 40, 50, 100]) { const k = share * size; if (Math.abs(k - Math.round(k)) < 1e-9 && Math.round(k) >= 1) return [size, Math.round(k)]; } return [100, Math.max(1, Math.round(share * 100))]; };
/** A rule-based reader for a plain-English audience (no language model): finds catalog values by their names, shows the exact rule for the user to confirm,
    and says which words it did NOT use. A negation ("not", "except", "excluding") covers the whole list that follows it, up to "but", a comma, or a new "in/on/from" phrase. */
function parseSegment(text) {
  const raw = String(text || "").trim(), out = { rules: [], errors: [], warnings: [], text: raw };
  let t = " " + raw.toLowerCase().replace(/[;,()|/]/g, " | ").replace(/\.(?=\s|$)/g, " ").replace(/\./g, "").replace(/\s+/g, " ").trim() + " ";
  if (!t.trim() || /^ ?(all|everyone|every lead|any)( the)?( leads?| traffic)?( ?)$/.test(t) || /^ ?(no segment|neutral|all the leads|all leads)( ?)$/.test(t)) return out;
  const cat = CAT(), hit = cat.in_call_words.find(w => t.includes(" " + w + " ") || t.includes(" " + w));
  if (hit) { out.errors.push(`"${hit}" is decided during the call, so it cannot pick leads before the call (it would bias the result). Use lead type, firm type or city.`); return out; }
  // 1. mark every catalog word in the text, with its variable, value and position
  const found = []; let masked = t;
  for (const v of preCall()) { const syn = (cat.synonyms || {})[v.name] || {};
    for (const val of v.values) for (const w of (syn[val] || []).slice().sort((a, b) => b.length - a.length)) {
      const key = w.replace(/\./g, ""), re = new RegExp("(?<=^|\\s)" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=\\s|$)", "g"); let m;
      while ((m = re.exec(masked))) { found.push({ v: v.name, val, at: m.index, len: key.length }); masked = masked.slice(0, m.index) + " ".repeat(key.length) + masked.slice(m.index + key.length); re.lastIndex = m.index + key.length; }
    } }
  found.sort((a, b) => a.at - b.at);
  // 2. walk the words: a negator turns negation on; a comma, "but" or a later preposition turns it off
  const words = []; const wre = /\S+/g; let m; while ((m = wre.exec(t))) words.push({ w: m[0], at: m.index });
  const NEG = new Set(["not", "except", "excluding", "exclude", "without", "no"]), PREP = new Set(["in", "on", "from", "with", "only", "within"]), STOP = new Set(["but", "|"]);
  let neg = false, justNeg = false; const mark = new Map();
  words.forEach(({ w, at }, i) => {
    if (w === "other" && words[i + 1] && words[i + 1].w === "than") { neg = true; justNeg = true; return; }
    if (found.some(x => at > x.at && at < x.at + x.len)) return;           // the rest of a multi-word name such as "pvt ltd"
    if (NEG.has(w)) { neg = true; justNeg = true; return; }
    if (STOP.has(w)) { neg = false; justNeg = false; return; }
    if (PREP.has(w)) { if (neg && !justNeg) neg = false; return; }
    const f = found.find(x => x.at === at); if (f) { mark.set(f, neg); justNeg = false; } else if (!["and", "or", "the", "a", "an", "of", "that", "are", "is", "be", "leads", "lead", "than", "type", "types", "city", "cities", "firm", "firms", "business", "nature", "hot", "source", "customers", "buyers", "buyer", "all", "any", "to", "who", "which", "have", "has", "having", "test", "segment", "audience", "target", "only", "please", "want", "i", "we", "run", "for", "on", "in"].includes(w)) { out.warnings.push(w); justNeg = false; }
    else if (!["and", "or", "the", "a", "an", "of", "than", "type", "types", "city", "cities", "firm", "firms", "hot", "source"].includes(w)) justNeg = false;
  });
  for (const v of preCall()) {
    const pos = [], ng = []; for (const [f, isNeg] of mark) if (f.v === v.name) (isNeg ? ng : pos).includes(f.val) || (isNeg ? ng : pos).push(f.val);
    const chosen = pos.length ? v.values.filter(x => pos.includes(x) && !ng.includes(x)) : ng.length ? v.values.filter(x => !ng.includes(x)) : [];
    if (chosen.length && chosen.length < v.values.length) out.rules.push({ var: v.name, values: chosen });
  }
  out.rules = ruleSort(out.rules);
  if (!out.rules.length) out.errors.push(`I could not find a variable from the catalog in that sentence. Try something like "Mumbai proprietors on UA and PNS leads", or use the lists.`);
  out.warnings = [...new Set(out.warnings)];
  return out;
}

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
const KIND_LABEL = { PROMOTE: "Promoted", STOP_HARM: "Stopped: B worse", LOSS: "Keep A: B was worse (a loss)", STOP_GUARDRAIL: "Stopped: guardrail", HOLD_FOR_APPROVAL: "Held for approval", INCONCLUSIVE: "Inconclusive, keep A", HALT_SRM: "Halted: broken test", CONTINUE: "Running", STOPPED_MANUAL: "Stopped by a person", REJECTED: "Rejected: kept A", ROLLED_BACK: "Promoted, then rolled back" };
const KIND_CLASS = { PROMOTE: "pos", STOP_HARM: "neg", LOSS: "neg", STOP_GUARDRAIL: "neg", HOLD_FOR_APPROVAL: "warn", INCONCLUSIVE: "plain", HALT_SRM: "warn", CONTINUE: "run", STOPPED_MANUAL: "neg", REJECTED: "plain", ROLLED_BACK: "warn" };

/** 95% range of the lift. The engine's range is used when it is usable (the end-of-test call, or an always-valid look); on early looks of the
    one-look rule the engine range is deliberately infinite, so a plain interim range is shown and labelled as such. */
function liftRange(row, c) {
  const w = row.rci ? Math.abs(row.rci[1] - row.rci[0]) : 9;
  if (row.rci && w <= 0.6 && row.eff <= 50) return { lo: row.rci[0], hi: row.rci[1], interim: false };
  const se = Math.sqrt(row.rateA * (1 - row.rateA) / Math.max(1, row.nA) + row.rateB * (1 - row.rateB) / Math.max(1, row.nB)), z = zOf(c);
  return { lo: row.diff - z * se, hi: row.diff + z * se, interim: true };
}
/** One guardrail's state, used by the Live tile, the History column and the report so they can never disagree. */
function guardStatus(g, margin, kind, v) {
  const rel = kind === "rel", f = x => rel ? sgn(x * 100, 0) + "%" : sgn(x * 100, 1) + " pp", lim = rel ? "+" + (margin * 100).toFixed(0) + "%" : "+" + (margin * 100).toFixed(0) + " pp";
  if (!g) return { label: "Not enough data", cls: "warn", short: "Not proven", value: "-", range: "", lim, f };
  const zc = zOf(v.config), lo = g.worse - zc * g.se, hi = g.worse + zc * g.se, bad = g.z_breach >= (v.cur ? (v.cur.harm_g != null ? v.cur.harm_g : v.cur.harm) : 99), decided = v.decided;
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
  if (c.secondary_role === "guardrail") out.push({ name: "Call duration", conf: confOf(c), st: guardStatus(cur && cur.guardrail, c.guardrail_margin, "rel", v), g: cur && cur.guardrail });
  if (c.guard_rate) out.push({ name: c.guard_rate.replace(/_/g, " ").replace(/^./, x => x.toUpperCase()), conf: confOf(c), st: guardStatus(cur && cur.guardrail2, c.guard_rate_margin, "pts", v), g: cur && cur.guardrail2 });
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
  const tail = v.d.approval === "approved" ? (rec.tails || {}).approve : v.d.approval === "rejected" ? (rec.tails || {}).reject : (v.d.rolledBack ? (rec.tails || {}).rollback : null);
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
  const lift = (last.rateB - last.rateA) * 100, lr = liftRange(last, c);
  const rng = ` The true difference is probably between ${sgn(lr.lo * 100, 0)} and ${sgn(lr.hi * 100, 0)} points${lr.interim ? " (an interim range: the test stopped before its final call)" : ""}.`;
  const nums = `Over ${v.ld} day${v.ld === 1 ? "" : "s"}, ${pct(last.rateB)} of ${nf(last.nB)} leads on the new prompt reached the goal (${goal}) against ${pct(last.rateA)} of ${nf(last.nA)} on today's prompt: ${sgn(lift, 0)} points.${rng}`;
  const g = last.guardrail ? ` Average call length was ${sgn(last.guardrail.rel_change * 100, 0)}% against a limit of +${(c.guardrail_margin * 100).toFixed(0)}%.` : "";
  const src = e.kind === "files" ? " These results came from a file supplied by the voice platform." : " These results are simulated with a known injected effect; they show the engine decides correctly, not that a real prompt is better.";
  const k = v.kind;
  const verdict = { PROMOTE: "Decision: promote B to all traffic. The evidence is strong enough that luck is an unlikely explanation and the guardrail holds.", STOP_HARM: "Decision: stop B early and send its leads back to A. B is clearly worse.", LOSS: "Decision: keep A. At the final call B is significantly worse than A, so it is logged as a loss and nothing ships.", STOP_GUARDRAIL: "Decision: stop B. It breaks a guardrail even if the goal improved.",
    HOLD_FOR_APPROVAL: "Decision: hold for a person. B wins on the goal but a guardrail is not proven. Nothing has changed for callers.", INCONCLUSIVE: "Decision: inconclusive, keep A. The test found no evidence of a difference; that is not proof of none.", HALT_SRM: "Decision: halted. The test itself is broken (the split or the log), so nothing can be trusted.",
    REJECTED: "Decision: a person rejected the held change. A stays live.", ROLLED_BACK: "Decision: B was promoted and then rolled back by a person.", STOPPED_MANUAL: "Decision: a person stopped the test early." }[k] || "No decision yet.";
  const more = k === "INCONCLUSIVE" && r.more_leads && r.more_leads.options ? " " + r.more_leads.options.map(o => o.enough_already ? `There was already enough data to detect ${o.lift_pp} points, so any real lift is smaller.` : `Detecting ${o.lift_pp} points would take about ${nf(o.more_leads)} more leads (about ${o.more_days} days).`).slice(0, 2).join(" ") : "";
  return `${verdict} ${nums}${g}${more}${src}`;
}

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

/* Live Experiments: results up to yesterday, day by day, then the engine's call. Follows the spec's "Live Experiment page" table. */

const DECISION_ROWS = [
  { k: ["PROMOTE"], goal: "B significantly better", guard: "OK", dec: "Promote B to 100%" },
  { k: ["HOLD_FOR_APPROVAL"], goal: "B significantly better", guard: "Broken or not proven", dec: "Hold for approval" },
  { k: ["INCONCLUSIVE", "REJECTED"], goal: "No significant difference", guard: "Any", dec: "Inconclusive, keep A" },
  { k: ["STOP_HARM"], goal: "B clearly worse (any day, 99.9%)", guard: "Any", dec: "Stop B early, move its leads back to A" },
  { k: ["LOSS"], goal: "B significantly worse (end of test, 95%)", guard: "Any", dec: "Keep A, logged as a loss" },
  { k: ["STOP_GUARDRAIL"], goal: "Any", guard: "Clearly broken", dec: "Stop B" },
  { k: ["HALT_SRM"], goal: "Test itself is broken", guard: "-", dec: "Halt: fix the split or the log, rerun" }];

function logAction(e, type, text) { const d = dyn(e); d.console = d.console || []; d.console.push({ ts: nowTs(e), type, text }); }

function guardTile(item) {
  const st = item.st, tipText = "A guardrail is a metric B must not make worse. It can stop B or hold it for a person even if the goal improves.";
  if (!item.g) return `<div class="card kpi" title="${tipText}"><div class="k">${esc(item.name)} (guardrail)</div><div class="v" style="font-size:26px">-</div><div class="d">Not enough data yet</div><div>${pill(st.label, st.cls)}</div></div>`;
  return `<div class="card kpi" title="${tipText}"><div class="k">${esc(item.name)} (guardrail)</div><div class="v" style="font-size:26px">${st.value}</div><div class="d">${item.name === "Call duration" ? "B's calls vs A's" : "B vs A"}; ${item.conf}% range ${st.range}; limit ${st.lim}</div><div>${pill(st.label, st.cls)}</div></div>`;
}


/** A against B by lead type, firm type and city: the balance table. */
function balanceHtml(cur) {
  const mix = cur && cur.mix; if (!mix) return `<div class="note">The lead mix was not recorded for this run.</div>`;
  const strat = CAT().strata, blocks = CAT().balance.map(name => {
    const vv = catVar(name), vals = vv.values.filter(x => mix[name][x][0] + mix[name][x][1] > 0), ta = vals.reduce((a, x) => a + mix[name][x][0], 0), tb = vals.reduce((a, x) => a + mix[name][x][1], 0), p = (cur.mix_p || {})[name], by = strat.includes(name);
    if (vals.length < 2 && p == null) return `<tr><td colspan="5"><b>${esc(vv.label)}</b> <span class="muted">${esc(vals[0] || "")}: every counted lead is the same, so there is nothing to balance.</span></td></tr>`;
    return `<tr class="grp"><td colspan="5"><b>${esc(vv.label)}</b> ${by ? pill("balanced by design", "pos") : pill("left to chance", "plain")} <span class="note">same-mix check p = ${p == null ? "-" : p < 0.001 ? p.toExponential(1) : p.toFixed(2)}</span></td></tr>` +
      vals.map(x => { const a = mix[name][x][0], b = mix[name][x][1], sa = ta ? a / ta : 0, sb = tb ? b / tb : 0, gap = (sb - sa) * 100; return `<tr><td>${esc(x)}</td><td class="num">${nf(a)} <span class="muted">(${pct(sa, 1)})</span></td><td class="num">${nf(b)} <span class="muted">(${pct(sb, 1)})</span></td><td class="num">${sgn(gap, 1)} pp</td><td></td></tr>`; }).join("");
  }).join("");
  return `<div class="tbl-wrap"><table><thead><tr><th>Value</th><th class="num">A leads (share)</th><th class="num">B leads (share)</th><th class="num">B minus A</th><th></th></tr></thead><tbody>${blocks}</tbody></table></div>
    <p class="note" style="margin-top:8px">${esc(CAT().strata.map(n => catVar(n).label).join(" × "))} is dealt in blocks, so those two match almost exactly. City is not blocked: its gaps are the luck of the draw, shrinking as leads grow. The lead mix is synthetic.</p>`;
}

/** The BRD's Split health: configured against achieved share by lead, call and day; the mismatch check; leads that saw both; the balance table; the segment check. */
function splitHealth(e, v) {
  const rec = e.record, c = v.config, cur = v.cur, shareCfg = c.share_b, seg = rec.result.segment_check, mix = cur.mix;
  const chi = (() => { const n = cur.nA + cur.nB, e1 = shareCfg * n, e0 = (1 - shareCfg) * n, x2 = (cur.nB - e1) ** 2 / e1 + (cur.nA - e0) ** 2 / e0; return erfc(Math.sqrt(x2 / 2)); })();
  const byCall = cur.calls ? { n: cur.calls, b: cur.exposedB / cur.calls } : null, both = rec.result.stickiness && rec.result.stickiness.checkable !== false ? rec.result.stickiness.arm_changes : null;
  const dayRowsHtml = v.rows.slice(-14).map(({ day, row }) => { const sh = row.nB / row.n; return `<tr><td>Day ${day}</td><td class="num">${nf(row.nA)}</td><td class="num">${nf(row.nB)}</td><td class="num">${pct(sh, 2)}</td><td class="num">${sgn((sh - shareCfg) * 100, 2)} pp</td></tr>`; }).join("");
  const bal = balanceHtml(cur);
  const sc = mix ? Object.values(mix)[0] : null, counted = sc ? Object.values(sc).reduce((a, ab) => a + ab[0] + ab[1], 0) : cur.n;
  const segHtml = seg ? `<div class="check ${seg.matching === seg.counted_leads ? "ok" : "bad"}"><span class="ico">${seg.matching === seg.counted_leads ? "✓" : "✕"}</span><span><b>Segment check:</b> ${pct(seg.matching / Math.max(1, seg.counted_leads), 0)} of counted leads match the rule (${nf(seg.matching)} of ${nf(seg.counted_leads)}, re-read from the whole record). <span class="mono">${esc(seg.rule)}</span></span></div>
      <div class="check ok"><span class="ico">✓</span><span><b>Out of segment:</b> ${nf(cur.oos == null ? seg.out_of_segment_leads : cur.oos)} leads so far kept today's prompt and were not counted.</span></div>` : `<div class="check ok"><span class="ico">✓</span><span><b>Segment check:</b> a neutral test: every lead is eligible and counted.</span></div>`;
  const mergedNote = (rec.result.split || {}).merged && rec.result.split.merged.length ? `<div class="note" style="margin-top:8px">Small groups merged into "Other" before splitting: ${esc(rec.result.split.merged.join(", "))}.</div>` : "";
  const blk = (rec.result.split || {}).block ? `<dt>Router</dt><dd>stratified blocks of ${rec.result.split.block} (${rec.result.split.b_slots} B per block); any group is at most ${(rec.result.split.max_stratum_off_slots || 0).toFixed(1)} leads off its share</dd>` : "";
  return `<div class="card" id="split-health" style="margin-bottom:16px"><h2>Split health</h2><div class="sub">Is the traffic split fair? Configured against achieved share, whether anyone saw both prompts, whether A and B have the same mix of leads, and whether only leads inside the segment were counted.</div>
    <div class="grid g2" style="margin-top:16px;align-items:start"><div>${shareBars("B share by lead", shareCfg, cur.nB / cur.n, cur.n)}${byCall ? shareBars("B share by call (repeat calls included)", shareCfg, byCall.b, byCall.n) : `<div class="note" style="margin:8px 0">By call: not available for this source.</div>`}
        <dl class="kv" style="margin-top:8px"><dt>Split-mismatch check</dt><dd>chi-square p = <b>${chi < 0.001 ? chi.toExponential(1) : chi.toFixed(2)}</b> ${chi < 0.001 ? pill("✕ Mismatch: test is broken", "neg") : pill("✓ Healthy", "pos")}</dd>
        <dt>Leads that saw both prompts</dt><dd><b>${both == null ? "not checkable here" : nf(both)}</b> ${both === 0 ? pill("✓ Must be 0", "pos") : both > 0 ? pill("✕ Sticky split broke", "neg") : ""}</dd>${blk}</dl>${mergedNote}
        <h3 style="margin:16px 0 8px">By day</h3><div class="tbl-wrap"><table><thead><tr><th>Day</th><th class="num">A leads</th><th class="num">B leads</th><th class="num">B share</th><th class="num">vs configured</th></tr></thead><tbody>${dayRowsHtml}</tbody></table></div>
        <div style="display:grid;gap:8px;margin-top:12px">${segHtml}</div></div>
      <div><h3 style="margin-bottom:8px">Balance: A against B by lead type, firm type and city</h3>${bal}</div></div></div>`;
}

/** The week after a promotion: 5% of leads stay on A so a regression would show. */
function holdbackCard(e, v) {
  const h = v.holdback, all = h.all, shown = h.rows, last = shown[shown.length - 1];
  const verdict = !h.done ? "" : all.alert_day ? `<div class="banner neg"><div><b>Holdback alert on day ${all.alert_day}.</b> B fell clearly below the held-back A. Consider rolling back.</div></div>` : `<div class="banner pos"><div><b>Holdback finished: no sign of loss.</b> ${all.verdict === "ahead" ? "B is still ahead of A." : "B is not below A."} The held-back slice is small: it would have caught a drop of about ${all.detectable_drop_pp} points or more (80% chance); it does not re-prove the gain.</div></div>`;
  return `<div class="card" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:flex-start"><div><h2>After the win: holdback</h2><div class="sub">B is now the production prompt. ${pct(all.share, 0)} of leads stay on A for ${all.days} days to confirm the gain holds. Day ${h.day} of ${all.days}. A slice this small can only catch a B that has turned clearly worse (a drop of about <b>${all.detectable_drop_pp} points or more</b>, caught with 80% chance); it cannot re-prove the gain.</div></div>
    <div class="actions">${h.done ? "" : `<button class="btn" id="a-hold">Play holdback day ${h.day + 1}</button><button class="btn" id="a-hold-all">Play all</button>`}</div></div>${verdict}
    ${shown.length ? `<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Day</th><th class="num">A (held back)</th><th class="num">B (production)</th><th class="num">B minus A</th><th class="num">z / alert line</th><th>Status</th></tr></thead><tbody>${shown.map(r => `<tr><td>Day ${r.day}</td><td class="num">${nf(r.nA)} · ${pct(r.rateA, 1)}</td><td class="num">${nf(r.nB)} · ${pct(r.rateB, 1)}</td><td class="num">${pts(r.diff, 1)}</td><td class="num">${r.z.toFixed(2)} / −${r.bar.toFixed(2)}</td><td>${r.alert ? pill("✕ B clearly worse", "neg") : pill("✓ No sign of loss", "pos")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty" style="margin-top:12px">No holdback days played yet. Press the button to play the first day.</div>`}</div>`;
}

ROUTES.live = (el, arg) => {
  const exps = EXPS(), vs = exps.map(e => [e, view(e)]);
  const order = [...vs.filter(([e, v]) => v.running || v.scheduled), ...vs.filter(([e, v]) => v.d.paused && !v.ended), ...vs.filter(([e, v]) => v.kind === "HOLD_FOR_APPROVAL" && !v.d.approval), ...vs.filter(([e, v]) => v.ended)];
  const uniq = [...new Map(order.map(x => [x[0].id, x])).values()];
  const pick = arg ? byId(arg) : (uniq[0] || [])[0];
  if (!pick) { el.innerHTML = head("Live Experiments", "Progressive results up to yesterday, and the day-by-day decision.") + `<div class="empty">Nothing here yet. <a href="#/new">Start a new experiment</a>.</div>`; return; }
  const v = view(pick), c = v.config, rec = pick.record, cur = v.cur, d = v.d;
  const groups = [["Running", uniq.filter(([e, x]) => x.running || x.scheduled || x.d.paused && !x.ended)], ["Waiting for a person", uniq.filter(([e, x]) => x.kind === "HOLD_FOR_APPROVAL" && !x.d.approval)], ["Finished", uniq.filter(([e, x]) => x.ended && !(x.kind === "HOLD_FOR_APPROVAL" && !x.d.approval))]];
  const sel = `<select id="live-pick" aria-label="Choose an experiment">${groups.map(([g, list]) => list.length ? `<optgroup label="${g}">${list.map(([e, x]) => `<option value="${esc(e.id)}" ${e.id === pick.id ? "selected" : ""}>${esc(e.record.config.name)} — ${esc(x.status[0])}</option>`).join("")}</optgroup>` : "").join("")}</select>`;
  const canApprove = v.kind === "HOLD_FOR_APPROVAL" && !d.approval, canRoll = v.kind === "PROMOTE" && !d.rolledBack && v.decided;
  const stat = v.scheduled ? `Scheduled for ${fdate(pick.sched_date || c.start)}` : v.ended ? `${KIND_LABEL[v.kind] || v.kind} on day ${v.ld} of ${v.win}` : d.paused ? `Paused, day ${v.day} of ${v.win}` : `Running, day ${v.day} of ${v.win}`;
  const segHead = `<p class="note" style="margin-top:4px"><b>Audience:</b> ${segChips(c.segment)} <span class="mono">${esc(segDescribe(c.segment))}</span>${rec.result.segment_check ? ` · ${pct(rec.result.segment_check.share_of_traffic, 0)} of traffic, about ${nf(rec.result.segment_check.eligible_per_day)} leads a day` : ""}</p>`;
  const sub = `Config <b>v${c.version || 1}</b> <span class="mono">${esc(rec.config_hash)}</span> (locked) · started ${fdate(c.start)} · ${esc(c.rule_set === "final_look" ? "one winner call at the end, strict daily harm check" : "early promote and early stop")}`;
  const replayNote = pick.replay_of ? `<div class="banner warn"><div><b>Offline replay.</b> A new test normally runs the engine, which needs the live version (<span class="mono">./start.sh</span>). Here the pre-computed ${esc(pick.preset)} run is replayed under your name; your plan fields (days, share, rules) were not applied.</div></div>` : "";
  const hdr = `<div class="exp-head"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><h2 style="font-size:20px;font-weight:600;color:var(--navy)">${esc(c.name)}</h2>${statusPill(v)}</div><p class="sub" style="color:var(--ink-2)">${esc(stat)} \u00b7 ${sub}</p>${pick.hypothesis ? `<p class="note" style="margin-top:4px">${esc(pick.hypothesis)}</p>` : ""}${segHead}
    <div class="actions" style="margin:12px 0 16px">${v.scheduled ? `<button class="btn primary" id="a-start">Start now (demo)</button>` : ""}${v.running || d.paused && !v.ended ? `<button class="btn" id="a-pause">${d.paused ? "Resume" : "Pause"}</button>` : ""}${!v.ended && !v.scheduled ? `<button class="btn danger" id="a-stop">Stop</button>` : ""}
      <button class="btn primary" id="a-approve" ${canApprove ? "" : "disabled"} title="Needs a test that is held for approval">Approve</button>${canApprove ? `<button class="btn" id="a-reject">Reject</button>` : ""}<button class="btn danger" id="a-roll" ${canRoll ? "" : "disabled"} title="Needs a promoted test">Rollback</button></div></div>`;
  let banner;
  if (v.ended || v.kind === "HOLD_FOR_APPROVAL") {
    const cls = { PROMOTE: "pos", STOP_HARM: "neg", LOSS: "neg", STOP_GUARDRAIL: "neg", HOLD_FOR_APPROVAL: "warn", HALT_SRM: "warn", INCONCLUSIVE: "", REJECTED: "", ROLLED_BACK: "warn", STOPPED_MANUAL: "neg" }[v.kind] || "";
    banner = `<div class="banner ${cls}" role="status"><div><b>${esc(KIND_LABEL[v.kind] || v.kind)}.</b> ${esc(v.kind === "STOPPED_MANUAL" ? "A person stopped the test." : v.res.reason)}${v.kind === "PROMOTE" && !d.rolledBack ? (segRules(c.segment).length ? ` Production prompt now points at B for ${esc(segDescribe(c.segment))} only; every other lead keeps today's prompt.` : ` Production prompt now points at B.`) : ""}</div></div>`;
  } else banner = `<div class="banner" role="status"><div><b>Results up to yesterday.</b> ${c.rule_set === "final_look" ? `Final winner call on day ${v.win}. A clearly worse B can still be stopped on any day.` : `The engine may decide on any day the evidence crosses a line; the window ends on day ${v.win}.`} Do not act on early numbers.</div></div>`;
  if (!cur) { el.innerHTML = head("Live Experiments", "Progressive results up to yesterday, then the engine's decision.", v.running ? `<button class="btn primary" id="a-adv">Advance 1 day (demo)</button>` : "") + `<div class="filters"><div class="field grow"><label for="live-pick">Experiment</label>${sel}</div></div>` + replayNote + hdr + (v.scheduled ? `<div class="banner"><div><b>Scheduled.</b> The setup is locked (version ${c.version || 1}, <span class="mono">${esc(rec.config_hash)}</span>). Nothing runs until ${esc(fdate(pick.sched_date || c.start))}. In this demo press Start now to play it.</div></div>` : banner) + `<div class="empty">${v.scheduled ? "No results yet: the test has not started." : 'No results yet. Press "Advance 1 day (demo)".'}</div>`; wireLive(el, pick); return; }
  const ciA = wilson(cur.xA, cur.nA), ciB = wilson(cur.xB, cur.nB), goal = (C.metrics.find(m => m.key === c.primary_goal) || {}).name || c.primary_goal.replace(/_/g, " ");
  const lr = liftRange(cur, c), gl = guardList(v);
  const tiles = `<div class="grid g4" style="margin-bottom:16px">
    <div class="card kpi" title="Leads in each prompt. Each lead is counted once, even if it called several times."><div class="k">Leads</div><div class="v">${nf(cur.n)}</div><div class="d"><span class="dot a"></span>A ${nf(cur.nA)} \u00b7 <span class="dot b"></span>B ${nf(cur.nB)}</div></div>
    <div class="card kpi" title="Share of leads that reached the goal under today's prompt, with its 95% range."><div class="k"><span class="dot a"></span>A: ${esc(goal)}</div><div class="v">${pct(cur.rateA, 1)}</div><div class="d">95% range ${pct(ciA[0], 1)} to ${pct(ciA[1], 1)}</div></div>
    <div class="card kpi" title="Share of leads that reached the goal under the new prompt, with its 95% range."><div class="k"><span class="dot b"></span>B: ${esc(goal)}</div><div class="v">${pct(cur.rateB, 1)}</div><div class="d">95% range ${pct(ciB[0], 1)} to ${pct(ciB[1], 1)}</div></div>
    <div class="card kpi" title="B's rate minus A's rate, in percentage points, with its ${confOf(c)}% range. A range that includes 0 means not proven. Green means better for this goal (${c.primary_direction === "lower" ? "lower is better" : "higher is better"})."><div class="k">Lift of B over A${c.primary_direction === "lower" ? " (lower is better)" : ""}</div><div class="v" style="color:${+(cur.diff * 100).toFixed(1) === 0 ? "var(--navy)" : isBetter(cur.diff, c) ? "#167a70" : "#b23b3b"}">${cur.diff >= 0 ? "\u25B2 " : "\u25BC "}${pts(cur.diff, 1)}</div><div class="d">${confOf(c)}% range ${pts(lr.lo, 1)} to ${pts(lr.hi, 1)}<br><span class="muted">${lr.interim ? "interim range, not corrected for repeated looks" : c.rule_set === "final_look" ? "end-of-test range" : "always-valid range: safe to read at any look"}</span></div></div></div>
    ${gl.length ? `<div class="grid g2" style="margin-bottom:16px">${gl.map(guardTile).join("")}</div>` : ""}`;
  const dr = v.rows;
  const harmBound = cur.harm;
  const harmRows = dr.map(({ day, row }) => { const worse = row.decision === "STOP_HARM", waiting = !worse && row.z <= -row.harm; return `<tr><td style="white-space:nowrap">Day ${day}</td><td class="num" style="white-space:nowrap">${pts(row.diff, 1)}</td><td style="white-space:nowrap">${worse ? pill("\u2715 Yes: clearly worse", "neg") : waiting ? pill("Past the bar; the check starts at " + nf(c.min_per_arm) + " leads per prompt", "warn") : pill("\u2713 No", "pos")}</td><td class="num" style="white-space:nowrap">${row.z.toFixed(2)} / \u2212${row.harm.toFixed(2)}</td></tr>`; }).join("");
  const needN = needLeads(pick), needed = Math.max(0, needN - cur.n);
  const decBody = `<div class="sub" style="margin-top:4px">${v.ended ? "The row that applied is highlighted." : `Pending: ${c.rule_set === "final_look" ? "final winner call on day " + v.win : "a decision when a line is crossed, or on day " + v.win}.`}</div>
    <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Primary goal</th><th>Guardrail</th><th>Decision</th></tr></thead><tbody>${DECISION_ROWS.map(r => { const hit = v.ended && r.k.includes(v.kind === "ROLLED_BACK" ? "PROMOTE" : v.kind === "STOPPED_MANUAL" ? "" : v.kind); return `<tr ${hit ? 'style="background:var(--blue-wash)"' : ""}><td>${esc(r.goal)}</td><td>${esc(r.guard)}</td><td>${hit ? "<b>" + esc(r.dec) + "</b> ← applied" : esc(r.dec)}</td></tr>`; }).join("")}</tbody></table></div>`;
  const evs = eventsFor(pick).sort((a, b) => a.ts < b.ts ? -1 : 1);
  const ledger = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2>Decision record</h2><button class="btn sm" id="a-verify">Verify record in this browser</button></div><div class="sub">Every event with its time, reason and numbers. Hash-chained: an edited entry is detected.</div><div id="verify-out" class="note" style="margin-top:8px"></div>
    <div class="ledger" style="margin-top:8px">${evs.map(x => `<div class="e"><span class="note">${esc(fdt(x.ts))}</span><span><b>${esc(x.type)}</b>${x.hash ? ` <span class="mono muted">${esc(x.hash)}</span>` : ""}<br><span class="muted">${esc(x.text)}</span></span></div>`).join("")}</div></div>`;
  el.innerHTML = head("Live Experiments", "Progressive results up to yesterday, then the engine's decision.", v.running ? `<button class="btn primary" id="a-adv">Advance 1 day (demo)</button><button class="btn" id="a-end">Skip to the end</button>` : v.ended ? `<a class="btn primary" href="#/report/${encodeURIComponent(pick.id)}">View final report</a>` : "") +
    `<div class="filters"><div class="field grow"><label for="live-pick">Experiment</label>${sel}</div></div>` + replayNote + hdr + banner + tiles +
    `<div class="g-main grid" style="margin-bottom:16px"><div class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><h2 title="Cumulative goal rate for A and B by day. Shaded bands are 95% ranges.">Daily trend</h2><div class="sub">Cumulative ${esc(goal)} rate for A and B by day, with shaded 95% ranges.</div></div><button class="btn sm" id="a-csv">Export CSV</button></div>
        <div class="legend"><span><i style="border-color:var(--a)"></i>A (today's prompt)</span><span><i style="border-color:var(--b)"></i>B (new prompt)</span><span><i class="band" style="background:var(--ink-2)"></i>95% range</span></div><div id="trend"></div></div>
      <div class="card"><h2>Progress</h2><div class="sub">How much evidence the plan needs.</div><div style="margin-top:16px"><div class="kpi"><div class="k">Leads still needed for the planned lift</div><div class="v">${nf(needed)}</div><div class="d">of ${nf(needN)} needed (the ${v.win}-day window holds ${nf(rec.design.n_max)}); ${nf(cur.n)} so far</div></div><div class="bar" style="margin-top:8px"><i style="width:${Math.min(100, cur.n / needN * 100)}%"></i></div></div>
        <div class="note" style="margin-top:12px">Day ${v.day} of ${v.win}. Planned to detect a ${+(c.mde * 100).toFixed(1)}-point lift from ${pct(c.baseline, 0)} with at least ${pct(c.power, 0)} chance.</div></div></div>
    <div class="grid g2" style="margin-bottom:16px"><div class="card"><h2>Harm monitor</h2><div class="sub">Every day: is B clearly worse, and by how much? The bar is very strict (${pct(1 - (c.alpha_harm_daily || 0.001), 1)} for the one-look rule) so one bad day does not trigger it.</div>
        <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Day</th><th class="num">B vs A (how much)</th><th>Is B clearly worse?</th><th class="num">z / stop line</th></tr></thead><tbody>${harmRows}</tbody></table></div></div><div class="card"><h2>Decision rule</h2><div class="sub">What the engine does at each outcome.</div>${decBody}</div></div>
    ${splitHealth(pick, v)}${v.holdback ? holdbackCard(pick, v) : ""}
    <div class="grid g2" style="margin-bottom:16px">${ledger}</div>`;
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
  a("#a-start", () => { d.started = true; logAction(e, "Started", `Started on the scheduled date (a console action: in this demo a person pressed Start now).`); saveDyn(); route(); });
  const playHold = (all) => { const vv = view(e); if (!vv.holdback) return; const H = vv.holdback.all; do { if (d.hold >= H.days) break; d.hold = (d.hold || 0) + 1; const r = H.rows[d.hold - 1];
      logAction(e, r.alert ? "Harm alert" : "Holdback", r.alert ? `Holdback day ${d.hold}: B is clearly below the held-back A (z=${r.z.toFixed(2)}, alert line −${r.bar.toFixed(2)}). Consider a rollback.` : `Holdback day ${d.hold} of ${H.days}: B ${pct(r.rateB, 1)} against A ${pct(r.rateA, 1)} (${pts(r.diff, 1)}); no sign of loss.`);
    } while (all && !H.rows[d.hold - 1].alert); if (d.hold >= H.days) logAction(e, "Holdback", H.alert_day ? `Holdback finished with an alert on day ${H.alert_day}.` : `Holdback finished: no sign of loss. The slice is small: it would have caught a drop of about ${H.detectable_drop_pp} points or more (80% chance), it does not re-prove the gain.`); saveDyn(); route(); };
  a("#a-hold", () => playHold(false)); a("#a-hold-all", () => playHold(true));
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

/* New Experiment: six steps on one page with a sticky calculator on the right (BRD): Hypothesis, Prompt B, Audience, Goals, Traffic and duration, Review.
   Everything is decided before launch; Save Test keeps an editable draft, Launch Test locks the setup and gives it a version ID. */

const WSTEPS = ["Hypothesis", "Prompt B", "Audience", "Goals", "Traffic and duration", "Review and launch"];
let WZ = null;
DYN.drafts = DYN.drafts || [];
const wzDefaults = () => { const s = SET(); return { step: 1, name: "", change: "", why: "", effect: "", mode: "patch", variant: "cap_two_asks", fullText: "",
  segMode: "all", segText: "", segRules: [], segMsg: "", share: s.share_b, lpd: s.leads_per_day, assignment: s.assignment || "stratified",
  metric: "buylead_created", direction: "higher", durOn: true, durMargin: Math.round(s.duration_margin * 100), hangOn: false, hangMargin: s.rate_margin_pp, goalsTouched: false,
  baseline: s.baseline, liftRel: Math.round((s.lift_rel || 0.10) * 100), days: s.window_days, daysAuto: true, confidence: s.confidence, rule: s.rule_set, harm: s.harm_bar, minLeads: s.min_leads_per_arm, approval: s.approval,
  startDate: TODAY, source: "sim", preset: "win", effectRel: 15, seed: 7, draftId: null }; };
function startWizard(prefill) {
  const p = { ...(prefill || {}) };
  if (p.mde != null && p.liftRel == null) { const b = p.baseline != null ? p.baseline : SET().baseline; p.liftRel = Math.max(1, Math.round(p.mde / b * 100)); delete p.mde; }
  if (p.days != null) p.daysAuto = false;
  WZ = { ...wzDefaults(), ...p }; go("new");
}
const wzSeg = w => ({ rules: w.segMode === "segment" ? w.segRules.filter(r => preCall().some(v => v.name === r.var)) : [], text: w.segText });      // a variable switched off in Settings no longer counts
const wzMde = w => Math.max(0.005, w.baseline * w.liftRel / 100);

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
  if ((w.durExtra || 0) >= 8 && eff > 0.05) id = "demo_hold"; else if (eff > 0.05 && w.segMode === "segment" && w.segRules.length) id = "demo_segment"; return C.demo.find(d => d.id === id);
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

/* ---- the calculator: how many leads, how many days, what can be detected, and a green / amber / red light */
const clampDays = d => Math.min(28, Math.max(7, Math.ceil(d / 7 - 1e-9) * 7));
function calc(w) {
  const seg = wzSeg(w), share = segShare(seg), lpd = +w.lpd || 1, elig = lpd * share, alpha = (1 - w.confidence) / 2, seq = w.rule === "sequential", mde = wzMde(w);
  const need = leadsNeeded(w.baseline, mde, w.share, alpha, 0.8, seq), rawDays = need / elig, rec = clampDays(rawDays);
  if (w.daysAuto) w.days = rec;
  const days = +w.days || 7, nAll = elig * days, nB = nAll * w.share, det = detectableLift(nAll, w.baseline, w.share, alpha, 0.8, seq), cv = (C.plans || {}).duration_cv || 0.55;
  const se = cv * Math.sqrt(1 / Math.max(2, nB) + 1 / Math.max(2, nAll - nB)), gp = normCdf((w.durMargin / 100) / se - normPpf(1 - alpha));
  const harmStart = Math.ceil(Math.max(w.minLeads / (elig * w.share), w.minLeads / (elig * (1 - w.share))));       // the day both arms have the minimum leads
  const fits = nAll >= need, tooBig = rawDays > 28;
  const light = tooBig ? "red" : (!fits || harmStart > days) ? "amber" : "green";
  const msg = tooBig ? "Segment too small. Widen the segment or raise the B share." : !fits ? `The chosen ${days} days are too short for a ${(mde * 100).toFixed(1)}-point lift: use ${rec} days.` : harmStart > days ? `The daily harm check would not start inside ${days} days (each prompt needs ${nf(w.minLeads)} leads first). Lower the minimum or raise B's share.` : "This test can finish: the window holds enough leads.";
  return { share, elig, nAll, nB, need, rawDays, rec, days, det, gp, fits, tooBig, light, msg, mde, harmStart, strata: planStrata(nAll, seg) };
}
function calcPanel(w) {
  const c = calc(w), lightLbl = { green: "Ready", amber: "Check this", red: "Will not finish" }[c.light];
  return `<div class="card calc" aria-live="polite"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><h3>Calculator</h3><span class="light ${c.light}"><i></i>${lightLbl}</span></div>
    <dl class="kv" style="margin-top:8px;grid-template-columns:1fr auto"><dt>Eligible leads a day</dt><dd class="num">${nf(c.elig)}</dd><dt>Leads in ${c.days} days</dt><dd class="num">${nf(c.nAll)}</dd><dt>of which on B</dt><dd class="num">${nf(c.nB)}</dd><dt>Baseline rate (A)</dt><dd class="num">${pct(w.baseline, 0)}</dd>
      <dt>Smallest lift it can detect</dt><dd class="num">${(c.det * 100).toFixed(1)} pts</dd><dt>Lift you want to detect</dt><dd class="num">${(c.mde * 100).toFixed(1)} pts</dd><dt>Days needed</dt><dd class="num"><b>${c.rawDays > 99 ? "99+" : c.rawDays.toFixed(1)}</b> → ${c.tooBig ? "over 28" : c.rec + " (whole weeks)"}</dd><dt>Harm check starts</dt><dd class="num">day ${c.harmStart > 60 ? "60+" : c.harmStart}</dd></dl>
    <div class="banner ${c.light === "green" ? "pos" : c.light === "amber" ? "warn" : "neg"}" style="margin:12px 0 0;padding:8px 12px"><div style="font-size:13px">${esc(c.msg)}</div></div></div>`;
}

/* ---- agent-style suggestions, done with plain rules (no language model): the share, and the goal cards */
function suggestShare(w) {
  const base = C.library.base_text || "", cand = C.library.candidates.find(x => x.key === w.variant);
  const lines = w.mode === "full" ? lineDiff(base, w.fullText || base) : w.variant === "__own" ? lineDiff(base, w.ownText || base) : ((cand || {}).diff || []);
  const n = lines.filter(l => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---")).length;
  return n <= 12 ? { share: 0.30, why: `a small wording change (${n} changed lines): 30 to 50% is enough` } : { share: 0.10, why: `a bigger change (${n} changed lines): start with 10% to limit the risk` };
}
function suggestGoals(w) {
  const t = [w.name, w.change, w.why, w.effect].join(" ").toLowerCase(), m = /call.?back/.test(t) ? "callback_fixed" : /meeting/.test(t) ? "meeting_fixed" : /enrich/.test(t) ? "bl_enriched" : "buylead_created", hang = /hang|drop|abandon|early|greeting|opening|intro|first line/.test(t);
  return { metric: m, hangOn: hang, why: `Suggested from your hypothesis: primary goal ${(C.metrics.find(x => x.key === m) || {}).name}, call length as a guardrail${hang ? ", plus early hang-ups because the change touches how the call opens" : ""}.` };
}

/* ---- overlap and the pre-launch checklist */
const segsOverlap = (a, b) => CAT().variables.filter(v => v.pre_call).every(v => { const x = segAllowed(a, v.name), y = segAllowed(b, v.name); return x.some(t => y.includes(t)); });
function runningMain() { return DYN.launched.filter(e => e.world === "main").filter(e => { const v = view(e); return v.running || v.scheduled || (v.d.paused && !v.ended); }); }
function checklist(w) {
  const c = calc(w), seg = wzSeg(w), vcOk = w.mode === "full" ? varCheck(w.fullText || "") : w.variant === "__own" ? varCheck(w.ownText || "") : { ok: ((C.library.candidates.find(x => x.key === w.variant) || { variables: { ok: true } }).variables.ok), missing: [] };
  const clash = runningMain().filter(e => segsOverlap(seg, segOf(e) || {}));
  return [
    { ok: true, label: "Exactly one primary goal", why: "The primary goal decides; guardrails can only veto.", step: 4 },
    { ok: vcOk.ok, label: "Prompt variables such as {seller_name} are intact in B", why: vcOk.ok ? `All ${baseVars().length} template variables are still used.` : `B no longer uses: ${(vcOk.missing || []).join(", ") || "a variable"}.`, step: 2 },
    { ok: c.fits && !c.tooBig, label: "The segment has enough leads for the duration", why: c.fits && !c.tooBig ? `${nf(c.nAll)} leads in ${c.days} days against ${nf(c.need)} needed.` : c.msg, step: 3 },
    { ok: c.days >= 7 && c.days <= 28 && c.days % 7 === 0, label: "Duration is 7 to 28 days, in whole weeks", why: `${c.days} days (a full week of patterns, no endless tests).`, step: 5 },
    { ok: clash.length === 0, label: "No running test overlaps the same leads", why: clash.length ? `${clash.map(e => e.record.config.name).join("; ")} already runs on these leads. Finish it first, or pick a different segment.` : "Nothing else is running on these leads.", step: 3 }];
}

function wzValid(w, step) {
  if (step === 1 && !w.name.trim()) return "Give the test a name.";
  if (step === 2) { if (w.mode === "patch" && w.variant === "__own") { if (!w.ownText) return "Press Preview patch to check your edit first."; const vc = varCheck(w.ownText); if (!vc.ok) return `Prompt B no longer uses: ${vc.missing.join(", ")}.`; } else if (w.mode === "full") { if (w.fullText.trim().length < 200) return "Paste the full prompt, or start from the base prompt."; const vc = varCheck(w.fullText); if (!vc.ok) return `Prompt B no longer uses: ${vc.missing.join(", ")}.`; } else { const cand = C.library.candidates.find(c => c.key === w.variant); if (cand && !cand.variables.ok) return `This patch drops variables: ${cand.variables.dropped.join(", ")}.`; } }
  if (step === 3) { if (w.segMode === "segment") { if (!w.segRules.length) return "Pick at least one condition, or choose All leads."; if (segShare(wzSeg(w)) < CAT().min_share) return `This segment is under ${pct(CAT().min_share, 0)} of traffic. Widen it.`; } }
  if (step === 5) { if (!(w.share >= 0.05 && w.share <= 0.5)) return "The share for B must be between 5% and 50%."; if (!(w.lpd >= 10)) return "Leads per day must be at least 10."; if (!(w.liftRel >= 1 && w.liftRel <= 100)) return "The expected lift must be between 1% and 100%."; if (w.baseline + wzMde(w) >= 0.99) return "Baseline plus the smallest lift must stay below 99%."; if (w.days * w.lpd > 60000) return "Days x leads per day is capped at 60,000 for the live demo."; }
  return "";
}
const F = (label, inner, hint) => `<div class="field"><label>${label}${hint ? ` <span class="hint">${hint}</span>` : ""}</label>${inner}</div>`;
const arrow = d => d === "lower" ? "↓" : "↑";

function goalCards(w) {
  const metrics = C.metrics, prim = metrics.find(m => m.key === w.metric) || metrics[0], segName = segRules(wzSeg(w)).length ? "this segment" : "all leads";
  const used = [w.durOn && "duration_s", w.hangOn && "early_hangup"].filter(Boolean), cardG = (key, name, def, extra) => `<div class="goal-card"><span class="role g">Guardrail</span><button class="x" data-del="${key}" aria-label="Remove ${esc(name)}" title="Remove">×</button><b>${esc(name)}</b><div class="def">${esc(def)}</div><div class="meta"><span class="arrow" title="lower is better">↓</span> ${extra}</div></div>`;
  const addG = ["duration_s", "early_hangup"].filter(k => !used.includes(k)), addGoals = metrics.filter(m => m.role === "goal" && m.key !== w.metric);
  return `<div class="goal-row"><div class="goal-card primary"><span class="role">Primary</span><b>${esc(prim.name)}</b><div class="def">${esc(prim.dispositions.length ? "Leads with at least one: " + prim.dispositions.join(", ") : prim.note)}; out of ${esc(prim.denominator)}</div>
      <div class="meta"><span class="arrow">${arrow(w.direction)}</span> <select id="w-dir" aria-label="Direction" style="width:auto;min-height:28px;padding:2px 8px"><option value="higher" ${w.direction === "higher" ? "selected" : ""}>higher is better</option><option value="lower" ${w.direction === "lower" ? "selected" : ""}>lower is better</option></select> · baseline ${pct(w.baseline, 0)} for ${segName} (assumed)</div>
      <div class="meta" style="margin-top:8px"><label for="w-swap" class="note">Swap the primary goal (it cannot be removed)</label><select id="w-swap" style="min-height:28px;padding:2px 8px">${metrics.filter(m => m.role === "goal").map(m => `<option value="${esc(m.key)}" ${w.metric === m.key ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></div></div>
    ${w.durOn ? cardG("duration_s", "Call duration", "Average talk time per lead, compared on a ratio with a range", `must not rise more than <input type="number" id="w-durm" min="1" max="100" value="${w.durMargin}" style="width:64px;display:inline-block;min-height:28px;padding:2px 8px"> %`) : ""}
    ${w.hangOn ? cardG("early_hangup", "Early hang-ups", "Calls cut in the first 15 seconds (our assumed cut-off) out of all leads", `must not rise more than <input type="number" id="w-hangm" min="1" max="20" value="${w.hangMargin}" style="width:64px;display:inline-block;min-height:28px;padding:2px 8px"> points`) : ""}
    <div class="goal-card add"><label for="w-add" class="note">Add a metric</label><select id="w-add" ${used.length >= 3 ? "disabled" : ""}><option value="">+ Add metric…</option>${addG.length && used.length < 3 ? `<optgroup label="As a guardrail">${addG.map(k => `<option value="g:${k}">${k === "duration_s" ? "Call duration" : "Early hang-ups"}</option>`).join("")}<option value="" disabled>Fatal calls (needs a flag in result files)</option></optgroup>` : ""}<optgroup label="As the primary goal (replaces the current one)">${addGoals.map(m => `<option value="p:${esc(m.key)}">${esc(m.name)}</option>`).join("")}</optgroup></select>
      <div class="note" style="margin-top:8px">One primary and up to 3 guardrails. This build computes two guardrails on simulated traffic (call duration, early hang-ups); a fatal-call guardrail works on result files that carry the flag.</div></div></div>`;
}

function segPicker(w) {
  const sel = (name, val) => w.segRules.some(r => r.var === name && r.values.includes(val));
  return preCall().map(v => `<div class="field wide"><label>${esc(v.label)} <span class="hint">${esc(v.meaning)}${w.segRules.some(r => r.var === v.name) ? "" : " · no limit"}</span></label><div class="chips">${v.values.map(val => `<label class="chip"><input type="checkbox" data-sv="${esc(v.name)}" value="${esc(val)}" ${sel(v.name, val) ? "checked" : ""}> ${esc(val)}</label>`).join("")}</div></div>`).join("");
}

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
        ${w.ownText ? `<h3 style="margin:16px 0 8px">Side-by-side diff of your patch</h3>${diffSides(lineDiff(C.library.base_text, w.ownText))}<div style="margin-top:8px">${(() => { const vc = varCheck(w.ownText); return vc.ok ? `<div class="check ok"><span class="ico">✓</span>All ${vc.n} template variables are still used.</div>` : `<div class="check bad"><span class="ico">✕</span>No longer used: ${esc(vc.missing.join(", "))}.</div>`; })()}</div>` : ""}` : `<h3 style="margin:16px 0 8px">Side-by-side diff</h3>${diffSides((cands.find(c => c.key === w.variant) || {}).diff)}`}`;
    const full = `<div style="margin-top:16px"><div class="actions" style="margin-bottom:8px"><button class="btn sm" id="w-load">Start from the base prompt</button><span class="note">${C.library.base_lines ? nf(C.library.base_lines) + " lines" : ""}</span></div><textarea id="w-full" style="min-height:200px;font-family:var(--mono);font-size:12px">${esc(w.fullText)}</textarea>
      <div style="margin-top:8px" id="w-vc"></div>${w.fullText ? `<h3 style="margin:16px 0 8px">Side-by-side diff</h3><div id="w-diff"></div>` : ""}</div>`;
    return `<h2>2. Prompt B</h2><p class="sub">A patch on the base prompt, or a full prompt. The base prompt is shown read-only. Template variables such as <span class="mono">{{ buyer_name }}</span> must still be there.</p>
      <div class="seg" style="margin-top:12px" role="group" aria-label="Kind of change"><button data-mode="patch" aria-pressed="${w.mode === "patch"}">Patch on the base prompt</button><button data-mode="full" aria-pressed="${w.mode === "full"}">Full prompt</button></div>${w.mode === "patch" ? patch : full}
      <details id="w-basebox" style="margin-top:16px"><summary style="cursor:pointer;font-weight:500">Show the base prompt (read-only)</summary><div id="w-baseview" class="note" style="margin-top:8px">Loading...</div></details>
      <div class="card" style="margin-top:16px;background:var(--bg-2)"><h3>Try it</h3><p class="sub">An optional chat box to talk to prompt B. It uses Sarvam credits, so it is switched off. The simulator does not need it.</p><textarea disabled placeholder="Chat with prompt B (off)" style="min-height:48px;margin-top:8px"></textarea></div>`;
  }
  if (s === 3) {
    const c = calc(w), seg = wzSeg(w), pc = CAT().variables.filter(v => !v.pre_call), [bs, bk] = blockFor(w.share), sp = c.strata, shown = sp.strata.slice(0, 16);
    return `<h2>3. Audience</h2><p class="sub">Who is in the test. Leads outside it keep today's prompt and are not counted. Only things known <b>before</b> the call can pick leads: anything decided during the call would bias the result.</p>
      <div style="display:grid;gap:8px;margin-top:16px"><label class="radio"><input type="radio" name="w-segmode" value="all" ${w.segMode === "all" ? "checked" : ""}><div><b>All leads (a neutral test)</b><span>Every lead is eligible and the same stratified split applies. Per-group results are shown for insight only, never for the decision.</span></div></label>
        <label class="radio"><input type="radio" name="w-segmode" value="segment" ${w.segMode === "segment" ? "checked" : ""}><div><b>A segment</b><span>Pick conditions from the lists, or describe it in plain English. The exact rule is always shown before you save.</span></div></label></div>
      ${w.segMode === "segment" ? `<div class="card" style="background:var(--bg-2);margin-top:12px"><div class="form-grid"><div class="field wide"><label for="w-segtext">Describe it in plain English <span class="hint">read by rules, not by a language model</span></label><div style="display:flex;gap:8px"><input type="text" id="w-segtext" value="${esc(w.segText)}" placeholder="Mumbai proprietors on UA and PNS leads"><button class="btn" id="w-segread">Read it</button></div><div id="w-segmsg" class="note" style="margin-top:4px;${w.segMsgBad ? "color:#b23b3b" : ""}">${esc(w.segMsg || "")}</div></div>${segPicker(w)}</div>
        <div class="note" style="margin-top:8px">Not available: ${pc.map(v => esc(v.label)).join(", ")} (known only during the call).${preCall().length === 0 ? " <b>Every variable is switched off in Settings, so no segment can be built: switch one on there.</b>" : preCall().length < CAT().variables.filter(v => v.pre_call).length ? " Switched off in Settings: " + CAT().variables.filter(v => v.pre_call && !preCall().some(p => p.name === v.name)).map(v => esc(v.label)).join(", ") + "." : ""}</div></div>` : ""}
      <div class="banner" style="margin-top:16px"><div><b>The exact rule.</b> <span class="mono">${esc(segDescribe(seg))}</span><br>${w.segMode === "segment" ? `That is <b>${pct(c.share, 1)}</b> of traffic, about <b>${nf(c.elig)}</b> eligible leads a day (of ${nf(w.lpd)} in all). ` : `All ${nf(w.lpd)} leads a day are eligible. `}<span class="muted">The lead mix is synthetic: ${esc(CAT().note)}</span></div></div>
      <div class="card" style="margin-top:16px"><h3>How the split is dealt</h3><p class="sub">Leads are dealt inside each group (${CAT().strata.map(n => esc(catVar(n).label)).join(" × ")}) from shuffled blocks of ${bs}: with ${pct(w.share, 0)} to B each block holds ${bk} B and ${bs - bk} A in random order. Every group therefore carries exactly the configured share, so A and B get the same mix. Groups expected to hold fewer than ${CAT().min_stratum} leads are merged into "Other".</p>
        <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Group</th><th class="num">Leads expected in ${c.days} days</th><th>Split</th></tr></thead><tbody>${shown.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${nf(r.expected)}</td><td>${r.merged ? pill("merged into Other", "warn") : pill("own blocks", "pos")}</td></tr>`).join("")}</tbody></table></div>${sp.strata.length > shown.length ? `<div class="note">… and ${sp.strata.length - shown.length} more groups.</div>` : ""}</div>`;
  }
  if (s === 4) { const sg = suggestGoals(w); return `<h2>4. Goals</h2><p class="sub">One primary goal decides. Guardrails can only veto: they stop or hold B even if the goal improves. Each card shows what counts, which way is better, and the baseline.</p>
    <div class="banner" style="margin-top:12px"><div>${esc(sg.why)} <button class="btn sm" id="w-sugg">Use the suggestion</button></div></div>${goalCards(w)}
    <p class="note" style="margin-top:12px">In the simulator every primary goal is generated the same way (a known effect on the rate you choose), so the goal changes the labels, not the outcome; real dispositions come from results files. Conflict rule: the primary goal decides; a guardrail can only veto or hold. If B wins but a guardrail is not proven, the decision is held for approval.</p>`; }
  if (s === 5) { const c = calc(w), sug = suggestShare(w); return `<h2>5. Traffic and duration</h2><p class="sub">How much goes to B, the lift worth detecting, and how long to run. The days are calculated, in whole weeks (7 to 28), so a full week of patterns is covered. The calculator on the right updates as you change anything.</p><div class="form-grid" style="margin-top:16px">
    ${F("Share of traffic to B", `<input type="range" id="w-share-r" min="5" max="50" step="5" value="${Math.round(w.share * 100)}"><input type="number" id="w-share" min="5" max="50" step="1" value="${Math.round(w.share * 100)}" style="margin-top:8px">`, "whole percent, 5 to 50%")}
    ${F("Expected lift (relative)", `<input type="number" id="w-lift" min="1" max="100" step="1" value="${w.liftRel}">`, `% of A's rate = ${(c.mde * 100).toFixed(1)} points. Default +10% when no similar past test exists`)}
    ${F("Expected rate under A (baseline)", `<input type="number" id="w-base" min="1" max="98" step="1" value="${Math.round(w.baseline * 100)}">`, "% - an assumption: no per-segment history was provided")}
    ${F("Leads a day, all traffic", `<input type="number" id="w-lpd" min="10" step="100" value="${w.lpd}">`, "an assumption: replace it with yours")}
    ${F("Test length", `<select id="w-days">${[7, 14, 21, 28].map(d => `<option value="${d}" ${c.days === d ? "selected" : ""}>${d} days${d === c.rec && !c.tooBig ? " (recommended)" : ""}</option>`).join("")}</select>`, w.daysAuto ? "calculated for you" : "chosen by you")}</div>
    <div class="note" style="margin-top:8px">Suggestion: ${esc(sug.why)}. <button class="btn sm" id="w-useshare">Use ${pct(sug.share, 0)}</button> You can also work it the other way: with ${c.days} days the smallest lift this test can detect is <b>${(c.det * 100).toFixed(1)} points</b>.</div>
    <details style="margin-top:16px" ${w.rulesOpen ? "open" : ""} id="w-rules"><summary style="cursor:pointer;font-weight:500">Rules (company defaults from Settings: change them for this test only)</summary><div class="form-grid" style="margin-top:12px">
      ${F("Confidence", `<select id="w-conf">${[0.9, 0.95, 0.99].map(x => `<option value="${x}" ${w.confidence === x ? "selected" : ""}>${x * 100}%</option>`).join("")}</select>`, "power is fixed at 80%")}${F("Daily harm bar", `<select id="w-harm">${[0.99, 0.995, 0.999].map(x => `<option value="${x}" ${w.harm === x ? "selected" : ""}>${(x * 100).toFixed(1)}%</option>`).join("")}</select>`, "one-look rule")}
      ${F("Minimum leads per prompt before the daily harm check", `<input type="number" id="w-min" min="20" value="${w.minLeads}">`)}${F("Approval mode", `<select id="w-appr"><option value="auto" ${w.approval === "auto" ? "selected" : ""}>Automatic: a win is promoted</option><option value="manual" ${w.approval === "manual" ? "selected" : ""}>Manual: a person approves every win</option></select>`, "both paths are logged")}
      ${F("How leads are dealt", `<select id="w-assign"><option value="stratified" ${w.assignment === "stratified" ? "selected" : ""}>Stratified blocks (the BRD's router)</option><option value="balanced" ${w.assignment === "balanced" ? "selected" : ""}>Balanced blocks, no groups</option><option value="hash" ${w.assignment === "hash" ? "selected" : ""}>Pure hash (no stored state)</option></select>`, w.segMode === "segment" ? "a segment needs stratified" : "")}</div>
      <div style="display:grid;gap:8px;margin-top:12px"><label class="radio"><input type="radio" name="w-rule" value="final_look" ${w.rule === "final_look" ? "checked" : ""}><div><b>One winner call at the end, plus a strict daily harm check</b><span>The BRD's rule: a two-proportion test at ${pct(w.confidence, 0)} once, on the last day (no correction for repeated looks is needed). Every day a ${pct(w.harm, 1)} bar catches a clearly worse B.</span></div></label>
        <label class="radio"><input type="radio" name="w-rule" value="sequential" ${w.rule === "sequential" ? "checked" : ""}><div><b>Early promote and early stop (sequential)</b><span>May promote or stop on any day using boundaries built for repeated looks. ${RULE_FACTS()} Needs about 6% more data.</span></div></label></div></details>`; }
  const c = calc(w), gname = (C.metrics.find(m => m.key === w.metric) || {}).name || w.metric, cand = C.library.candidates.find(x => x.key === w.variant), chk = checklist(w), allOk = chk.every(x => x.ok), seg = wzSeg(w);
  return `<h2>6. Review and launch</h2><p class="sub">Save Test keeps an editable draft. Launch Test locks the setup and gives it a version ID: any later change creates a new version. Launch stays disabled until every check passes.</p>
    <dl class="kv" style="margin-top:16px"><dt>Name</dt><dd><b>${esc(w.name || "-")}</b></dd><dt>Prompt B</dt><dd>${w.mode === "full" ? "A full prompt you pasted" : w.variant === "__own" ? "Your own patch on the base prompt" : esc(cand ? cand.name : w.variant)}</dd><dt>Audience</dt><dd><span class="mono">${esc(segDescribe(seg))}</span> · about ${nf(c.elig)} leads a day</dd>
      <dt>Traffic</dt><dd>${pct(w.share, 0)} to B, sticky by lead, ${esc(w.assignment)} split</dd><dt>Primary goal</dt><dd>${esc(gname)} (${w.direction} is better); plan: detect +${w.liftRel}% (${(c.mde * 100).toFixed(1)} points) from ${pct(w.baseline, 0)}</dd>
      <dt>Guardrails</dt><dd>${[w.durOn ? `call duration ≤ +${w.durMargin}%` : "", w.hangOn ? `early hang-ups ≤ +${w.hangMargin} points` : ""].filter(Boolean).join("; ") || "none"}</dd>
      <dt>Rules</dt><dd>${c.days} days, ${pct(w.confidence, 0)} confidence, ${w.rule === "final_look" ? `one winner call at the end + daily ${pct(w.harm, 1)} harm check` : "early promote and early stop"}, harm check from ${nf(w.minLeads)} leads per prompt, approval ${w.approval}</dd></dl>
    <h3 style="margin:24px 0 8px">Pre-launch checklist</h3><div style="display:grid;gap:8px" id="w-checks">${chk.map(x => `<div class="check ${x.ok ? "ok" : "bad"}"><span class="ico">${x.ok ? "✓" : "✕"}</span><span><b>${esc(x.label)}</b>: ${esc(x.why)}${x.ok ? "" : ` <button class="link" data-goto="${x.step}">Fix in step ${x.step}</button>`}</span></div>`).join("")}</div>
    <div class="form-grid" style="margin-top:16px">${F("Start date", `<input type="date" id="w-start" value="${esc(w.startDate)}" min="${TODAY}">`, w.startDate > TODAY ? "a later date makes it Scheduled" : "optional; today starts it now")}</div>
    <h3 style="margin:24px 0 8px">Where do the results come from?</h3><div style="display:grid;gap:8px"><label class="radio"><input type="radio" name="w-src" value="sim" ${w.source === "sim" ? "checked" : ""}><div><b>Simulator (demo only)</b><span>The call outcomes are simulated with a known effect you set, so you can check the engine decides correctly. The effect is put into B's input, never into the result. Call lengths are resampled from the 713 real recordings.</span></div></label>
      <label class="radio"><input type="radio" name="w-src" value="files" ${w.source === "files" ? "checked" : ""}><div><b>Results files from the voice platform</b><span>The test runs elsewhere; you give Canary the A and B results and it decides with the plan above.</span></div></label></div>
    ${w.source === "sim" ? `<div class="form-grid" style="margin-top:16px"><div class="field wide"><label>Simulation settings (demo only)</label><div class="seg" role="group" aria-label="Preset">${(w.direction === "lower" ? [["win", "B wins (rate −15%)"], ["worse", "B worse (rate +15%)"], ["flat", "Flat (0%)"], ["custom", "Custom"]] : [["win", "B wins (+15%)"], ["worse", "B worse (−15%)"], ["flat", "Flat (0%)"], ["custom", "Custom"]]).map(([k, n]) => `<button data-preset="${k}" aria-pressed="${w.preset === k}">${n}</button>`).join("")}</div></div>
      ${F("B's true effect (relative)", `<input type="number" id="w-eff" step="1" value="${w.effectRel}" ${w.preset === "custom" ? "" : "disabled"}>`, "% of A's rate")}${F("Random seed", `<input type="number" id="w-seed" value="${w.seed}">`, "same seed, same run")}${F("B's calls are longer by (%)", `<input type="number" id="w-dx" step="1" value="${w.durExtra || 0}">`, "to test the call-length guardrail")}${w.hangOn ? F("B's early hang-ups are higher by (points)", `<input type="number" id="w-hx" step="0.5" min="0" value="${w.hangExtra || 0}">`, `A's rate is ${pct(C.defaults.early_hangup_share || 0.14, 0)}, measured on the real recordings (calls under 15 s)`) : ""}</div>`
      : `<div class="banner" style="margin-top:16px"><div>Your plan above is used when the files are read. Next: choose the files on the import screen.</div></div>`}
    ${!LIVE && w.source === "sim" ? `<div class="banner warn" style="margin-top:16px"><div><b>Offline.</b> Launching here replays the closest pre-computed run (B wins, B worse, flat, a win with longer calls, or a win in one segment) under your name; your plan fields are not applied. Run <span class="mono">./start.sh</span> to run your own settings through the engine.</div></div>` : ""}
    <div id="w-err" class="note" style="color:#b23b3b;margin-top:12px"></div>`;
}
const RULE_FACTS = () => { const r = C.proof && C.proof.rules; return r ? `Measured on identical simulated traffic: both rules keep out a B that is 7 points worse in about ${pct(Math.min(r.harm_sequential, r.harm_final), 0)} of runs, but this one sends about ${pct(Math.max(0, r.exposure_saved), 0)} fewer calls to that B and promotes a real winner about ${r.sooner}% sooner.` : "It reacts sooner than the one-look rule."; };

function saveDraft(w) {
  const copy = JSON.parse(JSON.stringify(w)); copy.draftId = w.draftId || "draft-" + Date.now(); w.draftId = copy.draftId;
  const i = DYN.drafts.findIndex(d => d.id === copy.draftId), rec = { id: copy.draftId, name: w.name || "Untitled test", saved: new Date().toISOString().slice(0, 19), w: copy };
  if (i >= 0) DYN.drafts[i] = rec; else DYN.drafts.unshift(rec);
  DYN.libLog.push({ ts: rec.saved, type: "Saved", text: `Draft saved: "${rec.name}". It is editable and has not launched; nothing runs until Launch Test.`, exp: rec.name }); saveDyn();
}

ROUTES.new = (el) => {
  if (!WZ) WZ = { ...wzDefaults(), ...(DYN.ui.wizard || {}) };
  const w = WZ; w.step = Math.min(6, Math.max(1, w.step));
  const drafts = DYN.drafts.length ? `<div class="card" style="margin-bottom:16px"><h3>Saved drafts</h3><div style="display:grid;gap:4px;margin-top:8px">${DYN.drafts.map(d => `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span><b>${esc(d.name)}</b> <span class="note">saved ${esc(fdt(d.saved))}</span></span><span class="actions"><button class="btn sm" data-draft="${esc(d.id)}">Open</button><button class="btn sm" data-draft-del="${esc(d.id)}">Delete</button></span></div>`).join("")}</div></div>` : "";
  const chk = w.step === 6 ? checklist(w) : [], allOk = chk.every(x => x.ok), last = w.step === 6;
  el.innerHTML = head("New Experiment", "Six steps. Everything is decided before launch; once launched, the setup is locked and saved with a version ID, so results cannot be bent to fit.") + drafts +
    `<div class="g-main grid"><div class="card" style="min-height:420px">${wzBody(w)}<div class="actions" style="margin-top:24px;justify-content:space-between"><div>${w.step > 1 ? `<button class="btn" id="w-back">Back</button>` : ""}</div><div class="actions">${last ? `<button class="btn" id="w-save">Save Test</button><button class="btn primary" id="w-launch" ${allOk || w.source === "files" ? "" : "disabled"} title="${allOk ? "" : "Every check above must pass"}">${w.source === "files" ? "Continue to import" : w.startDate > TODAY ? "Launch Test (scheduled)" : "Launch Test"}</button>` : `<button class="btn" id="w-save">Save Test</button><button class="btn primary" id="w-next">Next</button>`}</div></div></div>
      <div class="grid wz-side"><div class="card"><div class="stepper" role="list">${WSTEPS.map((n, i) => `<button class="step ${i + 1 < w.step ? "done" : ""}" role="listitem" data-step="${i + 1}" ${i + 1 === w.step ? 'aria-current="step"' : ""}><span class="n">${i + 1 < w.step ? "✓" : i + 1}</span>${esc(n)}</button>`).join("")}</div></div>${calcPanel(w)}</div></div>`;
  bindWizard(el, w);
};
function bindWizard(el, w) {
  const $1 = s => $(s, el), val = (id, f = x => x) => { const e = $1(id); return e ? f(e.value) : undefined; };
  const sync = () => {
    if (w.step === 1) { w.name = val("#w-name", x => x); w.effect = val("#w-effect", x => x); w.change = val("#w-change", x => x); w.why = val("#w-why", x => x); }
    if (w.step === 2) { const r = $("input[name=w-var]:checked", el); if (r) w.variant = r.value; if ($1("#w-full")) w.fullText = $1("#w-full").value;
      if ($1("#w-anchor")) { w.ownOp = $1("#w-op").value; w.ownAnchor = $1("#w-anchor").value; w.ownFind = $1("#w-find") ? $1("#w-find").value : ""; w.ownNew = $1("#w-new") ? $1("#w-new").value : ""; } }
    if (w.step === 3) { const m = $("input[name=w-segmode]:checked", el); if (m) w.segMode = m.value; if ($1("#w-segtext")) w.segText = $1("#w-segtext").value;
      if ($$("[data-sv]", el).length) { const by = {}; $$("[data-sv]", el).forEach(c => { if (c.checked) (by[c.dataset.sv] = by[c.dataset.sv] || []).push(c.value); }); w.segRules = preCall().filter(v => by[v.name] && by[v.name].length && by[v.name].length < v.values.length).map(v => ({ var: v.name, values: v.values.filter(x => by[v.name].includes(x)) })); }
      if (w.segMode === "segment" && w.assignment !== "stratified") w.assignment = "stratified"; }
    if (w.step === 4) { if ($1("#w-swap")) w.metric = val("#w-swap", x => x); if ($1("#w-dir")) w.direction = val("#w-dir", x => x); if ($1("#w-durm")) w.durMargin = val("#w-durm", Number); if ($1("#w-hangm")) w.hangMargin = val("#w-hangm", Number); }
    if (w.step === 5) { w.share = Math.min(0.5, Math.max(0.05, Math.round(val("#w-share", Number)) / 100));      // whole percents: blocks cannot hold a fraction of a lead w.liftRel = val("#w-lift", Number); w.baseline = val("#w-base", Number) / 100; w.lpd = val("#w-lpd", Number); const dd = val("#w-days", Number); if (dd && dd !== w.days) { w.days = dd; w.daysAuto = false; }
      w.confidence = val("#w-conf", Number); w.harm = val("#w-harm", Number); w.minLeads = val("#w-min", Number); w.approval = val("#w-appr", x => x); w.assignment = val("#w-assign", x => x); const r = $("input[name=w-rule]:checked", el); if (r) w.rule = r.value; const rd = $1("#w-rules"); if (rd) w.rulesOpen = rd.open; }
    if (w.step === 6) { const r = $("input[name=w-src]:checked", el); if (r) w.source = r.value; if ($1("#w-eff")) w.effectRel = +$1("#w-eff").value; if ($1("#w-seed")) w.seed = +$1("#w-seed").value; if ($1("#w-dx")) w.durExtra = +$1("#w-dx").value; if ($1("#w-hx")) w.hangExtra = +$1("#w-hx").value; if ($1("#w-start") && $1("#w-start").value) w.startDate = $1("#w-start").value; }
    DYN.ui.wizard = w; saveDyn();
  };
  const rerender = () => { sync(); route(); };
  $$("[data-step]", el).forEach(b => b.onclick = () => { sync(); const t = +b.dataset.step; for (let s = w.step; s < t; s++) { const m = wzValid(w, s); if (m) { toast(m); return; } } w.step = t; route(); });
  $$("[data-goto]", el).forEach(b => b.onclick = () => { sync(); w.step = +b.dataset.goto; route(); });
  const nx = $1("#w-next"); if (nx) nx.onclick = () => { sync(); const m = wzValid(w, w.step); if (m) { toast(m); return; } if (w.step === 3 && !w.goalsTouched) { const g = suggestGoals(w); w.metric = g.metric; w.hangOn = g.hangOn; } if (w.step === 4) w.goalsTouched = true; if (w.step === 4 && w.daysAuto) { const sg = suggestShare(w); if (!w.shareTouched) w.share = sg.share; } w.step++; route(); };
  const bk = $1("#w-back"); if (bk) bk.onclick = () => { sync(); w.step--; route(); };
  const sv = $1("#w-save"); if (sv) sv.onclick = () => { sync(); if (!w.name.trim()) { toast("Give the test a name first."); w.step = 1; route(); return; } saveDraft(w); toast("Saved as a draft. You can edit it and launch it later."); route(); };
  $$("[data-draft]", el).forEach(b => b.onclick = () => { const d = DYN.drafts.find(x => x.id === b.dataset.draft); if (d) { WZ = { ...wzDefaults(), ...JSON.parse(JSON.stringify(d.w)) }; route(); } });
  $$("[data-draft-del]", el).forEach(b => b.onclick = () => { DYN.drafts = DYN.drafts.filter(x => x.id !== b.dataset.draftDel); saveDyn(); route(); });
  $$("[data-mode]", el).forEach(b => b.onclick = () => { sync(); w.mode = b.dataset.mode; route(); });
  $$("[data-preset]", el).forEach(b => b.onclick = () => { sync(); w.preset = b.dataset.preset; if (w.preset !== "custom") w.effectRel = { win: 15, worse: -15, flat: 0 }[w.preset]; route(); });
  $$("input[name=w-var],input[name=w-rule],input[name=w-src],input[name=w-segmode],[data-sv]", el).forEach(r => r.onchange = () => { if (r.dataset && r.dataset.sv) w.segMsg = ""; rerender(); });
  ["#w-share", "#w-lift", "#w-base", "#w-lpd", "#w-days", "#w-conf", "#w-harm", "#w-min", "#w-assign", "#w-appr", "#w-swap", "#w-dir", "#w-durm", "#w-hangm", "#w-start"].forEach(id => { const e = $1(id); if (e) e.onchange = () => { if (id === "#w-share") w.shareTouched = true; rerender(); }; });
  const rd = $1("#w-rules"); if (rd) rd.ontoggle = () => { w.rulesOpen = rd.open; DYN.ui.wizard = w; saveDyn(); };
  const sr = $1("#w-share-r"); if (sr) { sr.oninput = () => { $1("#w-share").value = sr.value; }; sr.onchange = () => { $1("#w-share").value = sr.value; w.shareTouched = true; rerender(); }; }
  const us = $1("#w-useshare"); if (us) us.onclick = () => { sync(); w.share = suggestShare(w).share; w.shareTouched = true; route(); };
  const sg = $1("#w-sugg"); if (sg) sg.onclick = () => { const g = suggestGoals(w); w.metric = g.metric; w.hangOn = g.hangOn; w.durOn = true; w.goalsTouched = true; route(); };
  $$("[data-del]", el).forEach(b => b.onclick = () => { sync(); if (b.dataset.del === "duration_s") w.durOn = false; else w.hangOn = false; w.goalsTouched = true; route(); });
  const add = $1("#w-add"); if (add) add.onchange = () => { sync(); const v = add.value; if (!v) return; if (v.startsWith("g:")) { if (v === "g:duration_s") w.durOn = true; else w.hangOn = true; } else w.metric = v.slice(2); w.goalsTouched = true; route(); };
  const rdb = $1("#w-segread"); if (rdb) rdb.onclick = () => { sync(); const r = parseSegment(w.segText); if (r.errors.length) { w.segMsg = r.errors[0]; w.segMsgBad = true; } else if (!r.rules.length) { w.segRules = []; w.segMsg = "Understood as: all leads. Pick conditions from the lists below if you meant a segment."; w.segMsgBad = false; } else { w.segRules = r.rules; w.segMsg = "Understood as: " + segDescribe({ rules: r.rules }) + "." + (r.warnings.length ? " I did not use these words: " + r.warnings.join(", ") + "." : "") + " Check it in the exact rule below and fix it with the lists if it is wrong."; w.segMsgBad = r.warnings.length > 0; } route(); };
  const stx = $1("#w-segtext"); if (stx) stx.onkeydown = ev => { if (ev.key === "Enter") { ev.preventDefault(); rdb.click(); } };
  const op = $1("#w-op"); if (op) op.onchange = () => { sync(); w.ownText = ""; route(); };
  const ap = $1("#w-apply"); if (ap) ap.onclick = () => { sync(); try { w.ownText = applyOwn(C.library.base_text, w.ownOp || "replace", w.ownAnchor, w.ownFind, w.ownNew); DYN.ui.wizard = w; saveDyn(); route(); } catch (err) { $1("#w-own-msg").style.color = "#b23b3b"; $1("#w-own-msg").textContent = err.message; } };
  const bb = $1("#w-basebox"); if (bb) bb.ontoggle = () => { if (bb.open) $1("#w-baseview").innerHTML = `<textarea readonly style="min-height:260px;font-family:var(--mono);font-size:12px">${esc(C.library.base_text || "")}</textarea>`; };
  const load = $1("#w-load"); if (load) load.onclick = () => { $1("#w-full").value = C.library.base_text || ""; sync(); route(); };
  const full = $1("#w-full"); if (full) { const upd = () => { const t = full.value, vc = varCheck(t); $1("#w-vc").innerHTML = t ? (vc.ok ? `<div class="check ok"><span class="ico">✓</span>All ${vc.n} template variables are still used.</div>` : `<div class="check bad"><span class="ico">✕</span>No longer used: ${esc(vc.missing.join(", "))}. A prompt that drops a variable would never receive that value.</div>`) : ""; const dd = $1("#w-diff"); if (dd && C.library.base_text) dd.innerHTML = diffSides(lineDiff(C.library.base_text, t)); }; full.oninput = upd; upd(); }
  const L = $1("#w-launch"); if (L) L.onclick = async () => {
    sync(); for (let s = 1; s <= 5; s++) { const m = wzValid(w, s); if (m) { w.step = s; toast(m); route(); return; } }
    if (w.source === "files") { DYN.ui.importPlan = { baseline: w.baseline, share_b: w.share, mde: wzMde(w), window_days: w.days, rule_set: w.rule, name: w.name }; saveDyn(); go("import"); return; }
    const c = calc(w), seg = wzSeg(w), scheduled = w.startDate > TODAY, startIso = w.startDate + "T09:00:00";
    const finish = (exp) => { exp.world = "main"; exp.audience = seg.rules.length ? { rules: seg.rules, text: seg.text } : null; exp.scheduled = scheduled; exp.sched_date = scheduled ? startIso : null; exp.segment_text = segDescribe(seg); DYN.launched.unshift(exp); DYN.dyn[exp.id] = { day: 1, paused: false, approval: null, rolledBack: false, manualStop: false, learning: "", started: !scheduled, hold: 0 };
      if (w.draftId) DYN.drafts = DYN.drafts.filter(d => d.id !== w.draftId); WZ = null; DYN.ui.wizard = null; saveDyn(); };
    if (!LIVE) {
      const src = replayFor(w), rec = JSON.parse(JSON.stringify(src.record)); rec.config.name = w.name;
      const id = "replay-" + Date.now(), exp = { id, kind: "simulated", preset: src.preset, replay_of: src.id, hypothesis: [w.change, w.why, w.effect && "Expected: " + w.effect].filter(Boolean).join(" "), truth: src.truth, start_day: 1, record: rec };
      finish(exp); toast(scheduled ? `Scheduled for ${fdate(startIso)}. Press Start now to play it in this demo.` : "Launched offline: replaying the closest pre-computed run.", 4200); go("live", id); return;
    }
    L.disabled = true; L.innerHTML = `<span class="spin"></span> Running the engine...`;
    try {
      const body = { name: w.name, hypothesis: [w.change, w.why, w.effect && "Expected: " + w.effect].filter(Boolean).join(" "), variant_b: w.variant, share_b: w.share, baseline: w.baseline, mde: wzMde(w), window_days: c.days, leads_per_day: w.lpd,
        rule_set: w.rule, confidence: w.confidence, harm_bar: w.harm, duration_margin: w.durMargin / 100, duration_on: w.durOn, approval: w.approval, min_leads_per_arm: w.minLeads, early_hangup: w.hangOn, rate_margin_pp: w.hangMargin, assignment: w.assignment,
        segment: seg.rules.length ? seg : null, primary_goal: w.metric, primary_direction: w.direction,
        effect_rel: (w.preset !== "custom" && w.direction === "lower" ? -w.effectRel : w.effectRel) / 100, dur_mult: 1 + (w.durExtra || 0) / 100, hang_extra_pp: w.hangOn ? (w.hangExtra || 0) : 0, seed: w.seed, preset: { win: "B wins", worse: "B worse", flat: "Flat", custom: "Custom" }[w.preset], start: startIso, full_prompt: wzPrompt(w) };
      const r = await fetch("/api/wizard", { method: "POST", body: JSON.stringify(body) }), j = await r.json(); if (j.error) throw new Error(j.error);
      j.start_day = 1; finish(j);
      toast(scheduled ? `Scheduled for ${fdate(startIso)}; config version ${j.record.config.version || 1} (${j.record.config_hash}) is locked.` : `Launched and locked: config version ${j.record.config.version || 1} (${j.record.config_hash}).`, 4200); go("live", j.id);
    } catch (err) { L.disabled = false; L.textContent = "Launch Test"; $1("#w-err").textContent = String(err.message || err); }
  };
}

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
function cloneOf(e) {
  const c = e.record.config, cand = C.library.candidates.find(x => x.key === c.variant_b);
  const seg = segOf(e);
  startWizard({ name: c.name + " (re-run)", change: e.hypothesis || "", variant: cand ? cand.key : "cap_two_asks", share: Math.min(0.5, c.share_b), lpd: c.leads_per_day, days: c.window_days, rule: c.rule_set, baseline: c.baseline, mde: c.mde, confidence: 1 - 2 * c.alpha,
    durMargin: Math.round(c.guardrail_margin * 100), approval: c.approval, step: 1, segMode: segRules(seg).length ? "segment" : "all", segRules: segRules(seg).map(r => ({ ...r })), segText: (seg && seg.text) || "", metric: c.primary_goal, direction: c.primary_direction || "higher",
    durOn: c.secondary_role === "guardrail", hangOn: !!c.guard_rate, hangMargin: c.guard_rate ? Math.round(c.guard_rate_margin * 100) : SET().rate_margin_pp, harm: Math.round((1 - c.alpha_harm_daily) * 1000) / 1000, minLeads: c.min_per_arm, assignment: c.assignment || "stratified", goalsTouched: true, preset: e.truth && e.truth.effect_rel != null ? (e.truth.effect_rel > 0 ? "win" : e.truth.effect_rel < 0 ? "worse" : "flat") : "win" });
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
      <div class="field"><label for="h-seg">Segment</label><select id="h-seg"><option value="all">All segments</option>${[...new Set(EXPS().map(e => segDescribe(e.record.config.segment)))].map(x => `<option value="${esc(x)}" ${HFILT.seg === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div></div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr>${th("name", "Test")}${th("start", "Dates")}<th>The change</th>${th("lift", "Primary lift (range)", "num")}${th("dec", "Decision")}<th>Guardrail</th><th>Learning</th><th></th></tr></thead><tbody>${rows.map(({ e, v }) => { const c = v.config, g = guardWord(v), cur = v.cur, lr = cur && liftRange(cur, c);
      return `<tr class="click" data-rep="${esc(e.id)}"><td><b><a href="#/report/${encodeURIComponent(e.id)}">${esc(c.name)}</a></b><div style="margin-top:2px">${segChips(c.segment)}</div><div class="note">${esc(e.kind === "files" ? "Results files" : "Simulated")}${e.preset && e.kind !== "files" ? " · " + esc(e.preset) : ""}</div></td><td style="white-space:nowrap">${fdate(c.start)}<div class="note">${v.ld} day${v.ld === 1 ? "" : "s"}</div></td>
        <td style="max-width:260px"><span class="muted">${esc(e.kind === "files" ? "Results from " + ((e.record.source && e.record.source.files) || []).join(", ") : ((e.record.variants.B || {}).name) || "")}</span></td><td class="num">${cur ? `<b>${pts(cur.diff, 1)}</b><div class="note">${sgn(lr.lo * 100, 1)} to ${sgn(lr.hi * 100, 1)}${lr.interim ? " (interim)" : ""}</div>` : "-"}</td>
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
  $("#h-csv").onclick = () => download("canary_history.csv", toCsv(["name", "segment", "start", "days", "source", "change", "lift_pp", "range_low_pp", "range_high_pp", "decision", "guardrail", "learning"], all.map(({ e, v }) => [v.config.name, segDescribe(v.config.segment), v.config.start.slice(0, 10), v.ld, e.kind, (e.record.variants.B || {}).name, v.cur ? (v.cur.diff * 100).toFixed(2) : "", v.cur ? (liftRange(v.cur).lo * 100).toFixed(2) : "", v.cur ? (liftRange(v.cur).hi * 100).toFixed(2) : "", KIND_LABEL[v.kind] || v.kind, guardWord(v)[0], dyn(e).learning || ""])));
};

ROUTES.report = (el, id) => {
  const e = byId(id); if (!e) { el.innerHTML = head("Report", "") + `<div class="empty">That test was not found. <a href="#/history">Back to History</a>.</div>`; return; }
  const v = view(e), c = v.config, rec = e.record, cur = v.cur;
  if (!v.ended || !cur) { el.innerHTML = head(c.name, "The final report is written when the test ends.") + `<div class="empty">This test has not ended yet (${esc(v.status[0])}). <a href="#/live/${encodeURIComponent(e.id)}">Open it in Live Experiments</a>.</div>`; return; }
  const ciA = wilson(cur.xA, cur.nA), ciB = wilson(cur.xB, cur.nB), lr = liftRange(cur, c), gl = guardList(v), goal = (C.metrics.find(m => m.key === c.primary_goal) || {}).name || c.primary_goal.replace(/_/g, " ");
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
      <h2>Audience</h2><p><span class="mono">${esc(segDescribe(c.segment))}</span>${rec.result.segment_check ? ` · ${pct(rec.result.segment_check.share_of_traffic, 0)} of traffic, about ${nf(rec.result.segment_check.eligible_per_day)} leads a day · ${nf(rec.result.segment_check.matching)} of ${nf(rec.result.segment_check.counted_leads)} counted leads match the rule; ${nf(rec.result.segment_check.out_of_segment_leads)} out-of-segment leads kept today's prompt and were not counted` : ""}</p>
      ${cur.mix ? `<h2>Achieved lead mix</h2><div class="note" style="margin-bottom:8px">A and B should carry the same mix of lead types. Per-group results are for insight only, never for the decision.</div>${balanceHtml(cur)}` : ""}
      <h2>Safety checks</h2><div style="display:grid;gap:8px">${gl.map(x => `<div class="check ${x.st.cls === "pos" ? "ok" : x.st.cls === "neg" ? "bad" : "wait"}"><span class="ico">${x.st.cls === "pos" ? "\u2713" : x.st.cls === "neg" ? "\u2715" : "\u2026"}</span><span><b>${esc(x.name)}:</b> ${x.g ? esc(x.st.value) + " (limit " + esc(x.st.lim) + "; " + x.conf + "% range " + esc(x.st.range) + ")" : "not enough data"}: ${esc(x.st.label.replace(/^[\u2713\u2715\u2026]\s*/, ""))}</span></div>`).join("")}
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
  const b = C.library.base, vers = [{ id: "v1", name: b.name, hash: b.hash, parent: null, from: "The real VANI buyer-side prompt, as received", time: null, by: "provided", diff: [], status: "previous", scope: null }];
  promotedExperiments().forEach(({ e, v, time }, i) => {
    const B = e.record.variants.B, id = "v" + (i + 2), by = v.res.kind === "PROMOTE" ? "automatically" : "approved by a person", seg = segOf(e);
    const rolled = v.d.rolledBack || DYN.libRolled.includes(id), scope = segRules(seg).length ? segDescribe(seg) : null;
    vers.push({ id, key: e.record.config.variant_b, name: B.name, hash: B.hash, parent: vers[vers.length - 1].id, from: e.record.config.name, expId: e.id, time, by, diff: B.diff || [], status: rolled ? "rolled back" : "previous", expView: v, scope });
  });
  // a promotion tested on one segment changes the prompt for that segment only: the all-traffic pointer moves only for promotions with no segment
  let live = vers[0]; for (const x of vers) if (x.status !== "rolled back" && !x.scope) live = x;
  vers.forEach(x => { if (x.id === live.id) x.status = "live"; else if (x.scope && x.status !== "rolled back") x.status = "live for a segment"; });
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
      <td>${pill(x.status === "live" ? "✓ Live" : x.status === "live for a segment" ? "✓ Live for a segment" : x.status === "rolled back" ? "Rolled back" : "Previous", x.status === "live" ? "pos" : x.status === "live for a segment" ? "run" : x.status === "rolled back" ? "warn" : "plain")}${x.scope ? `<div class="note mono">${esc(x.scope)} only</div>` : ""}</td><td>${(x.status === "live" || x.status === "live for a segment") && x.id !== "v1" ? `<button class="btn sm danger" data-roll="${esc(x.id)}">Rollback</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
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
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Time</th><th>Test</th><th>Event</th><th>Reason and numbers</th><th>Record</th></tr></thead><tbody>${rows.map(x => `<tr><td style="white-space:nowrap">${esc(fdt(x.ts))}</td><td>${x.id ? `<a href="#/${CUR.name === "log" ? "report" : "report"}/${encodeURIComponent(x.id)}">${esc(x.exp)}</a>` : esc(x.exp)}</td><td>${pill(x.type, { Saved: "plain", Started: "run", "Harm alert": "neg", "Split alert": "warn", Stopped: "neg", Promoted: "pos", Approved: "pos", Rejected: "plain", "Rolled back": "warn", Held: "warn", Inconclusive: "plain", Holdback: "run", Paused: "plain", Resumed: "run" }[x.type])}</td><td class="muted" style="max-width:520px">${esc(x.text)}</td><td class="mono">${x.hash ? esc(x.hash) : '<span class="note">console action</span>'}</td></tr>`).join("")}</tbody></table></div>
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
    <div class="card" style="margin-bottom:16px"><h2>Variable catalog</h2><div class="sub">Every variable the bot can receive, built once from the data and editable here. The router, the segment builder and the balance check all read this one list. Only variables known before the call can pick leads.</div>
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Variable</th><th>Meaning</th><th>Type</th><th>Allowed values (synthetic mix)</th><th>Known before the call?</th></tr></thead><tbody>${CAT().variables.map(v => `<tr><td><b>${esc(v.label)}</b><div class="mono muted">${esc(v.name)}</div></td><td>${esc(v.meaning)}</td><td>${esc(v.type)}</td><td>${v.values.length ? v.values.map((x, i) => `<span class="tag">${esc(x)}${v.mix ? " " + Math.round(v.mix[i] * 100) + "%" : ""}</span>`).join(" ") : '<span class="muted">any number</span>'}</td><td>${v.mix ? `<label class="chk"><input type="checkbox" data-pre="${esc(v.name)}" ${(SET().preCallOff || []).includes(v.name) ? "" : "checked"}> ${(SET().preCallOff || []).includes(v.name) ? "No: cannot pick leads" : "Yes: can pick leads"}</label>` : `${pill("No: decided during the call", "plain")}`}</td></tr>`).join("")}</tbody></table></div><p class="note" style="margin-top:8px">${esc(CAT().note)}</p></div>
    <div class="grid g2"><div class="card"><h2>Defaults for new tests</h2><div class="sub">Used to fill in New Experiment. The four demo tests were set up with these defaults.</div><div class="form-grid" style="margin-top:16px">
        ${f("s-conf", "Confidence", `<select id="s-conf">${[0.9, 0.95, 0.99].map(x => `<option value="${x}" ${s.confidence === x ? "selected" : ""}>${x * 100}%</option>`).join("")}</select>`)}${f("s-harm", "Harm threshold", `<select id="s-harm">${[0.99, 0.995, 0.999].map(x => `<option value="${x}" ${s.harm_bar === x ? "selected" : ""}>${(x * 100).toFixed(1)}%</option>`).join("")}</select>`, "daily check")}
        ${f("s-min", "Minimum leads per prompt before the daily harm check", `<input type="number" id="s-min" value="${s.min_leads_per_arm}">`)}${f("s-days", "Test length", `<select id="s-days">${[7, 14, 21, 28].map(d => `<option value="${d}" ${s.window_days === d ? "selected" : ""}>${d} days</option>`).join("")}</select>`, "7 to 28, whole weeks")}${f("s-share", "Share to B (%)", `<input type="number" id="s-share" value="${Math.round(s.share_b * 100)}">`)}${f("s-lift", "Expected lift (% of A's rate)", `<input type="number" id="s-lift" value="${Math.round((s.lift_rel || 0.1) * 100)}">`, "default +10%")}${f("s-dur", "Call-duration limit (%)", `<input type="number" id="s-dur" value="${Math.round(s.duration_margin * 100)}">`)}
        ${f("s-lpd", "Leads per day, all traffic", `<input type="number" id="s-lpd" value="${s.leads_per_day}">`, "an assumption")}${f("s-appr", "Approval mode", `<select id="s-appr"><option value="auto" ${s.approval === "auto" ? "selected" : ""}>Automatic</option><option value="manual" ${s.approval === "manual" ? "selected" : ""}>Manual: a person approves every win</option></select>`, "both paths are logged")}</div>
        <p class="note" style="margin-top:12px">${esc(C.defaults.leads_per_day_note)}</p><div class="actions" style="margin-top:12px"><button class="btn primary" id="s-save">Save defaults</button></div></div>
      <div class="grid"><div class="card"><h2>Overlap warning</h2><div class="sub">When two running tests include the same leads, their results interfere. A launch is refused if it would overlap a running one.</div><div style="margin-top:12px">${(() => { const m = runningMain(), c = m.flatMap((x, i) => m.slice(i + 1).filter(y => segsOverlap(segOf(x) || {}, segOf(y) || {})).map(y => [x, y])); return c.length ? `<div class="banner warn" style="margin:0"><div><b>Overlap.</b> ${c.map(([x, y]) => esc(x.record.config.name) + " and " + esc(y.record.config.name)).join("; ")} share leads. Finish one before trusting the other.</div></div>` : `<div class="banner pos" style="margin:0"><div><b>No overlap.</b> ${m.length} test${m.length === 1 ? "" : "s"} launched here ${m.length === 1 ? "is" : "are"} running. The five pre-set scenarios are separate replays of history and are exempt.</div></div>`; })()}</div></div>
        <div class="card"><h2>Tools</h2><div class="sub">For engineers and for the optional extras.</div><div class="actions" style="margin-top:12px"><a class="btn" href="#/import">Import results files</a><a class="btn" href="${LIVE ? "/tools.html" : "canary_tools.html"}">Proof lab, label calls, hear it</a></div></div>
        <div class="card"><h2>This demo</h2><div class="sub">What is real and what is simulated.</div><ul style="margin:8px 0 0;padding-left:20px;font-size:13px"><li>The demo tests use <b>simulated</b> outcomes with a known injected effect.</li><li>Call lengths are resampled from 713 <b>real</b> recordings.</li><li>Leads per day is an <b>assumption</b> (no real volume was provided).</li><li>History holds re-runs of our scenarios and sample result files.</li><li>Days played, approvals and rollbacks live in this browser only.</li></ul><div class="actions" style="margin-top:12px"><button class="btn danger" id="s-reset">Reset the demo</button></div></div></div></div>`;
  $("#s-save").onclick = () => { DYN.settings = { ...DYN.settings, confidence: +$("#s-conf").value, harm_bar: +$("#s-harm").value, min_leads_per_arm: +$("#s-min").value, window_days: +$("#s-days").value, share_b: +$("#s-share").value / 100, duration_margin: +$("#s-dur").value / 100, leads_per_day: +$("#s-lpd").value, approval: $("#s-appr").value, lift_rel: +$("#s-lift").value / 100 }; DYN.settings.mde = Math.round(SET().baseline * DYN.settings.lift_rel * 10000) / 10000; saveDyn(); WZ = null; toast("Defaults saved. New experiments will start from them."); };
  $$("[data-pre]", el).forEach(c => c.onchange = () => { const off = new Set(SET().preCallOff || []); c.checked ? off.delete(c.dataset.pre) : off.add(c.dataset.pre); DYN.settings = { ...DYN.settings, preCallOff: [...off] }; saveDyn(); route(); });
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
function createFrom(c) { startWizard({ name: c.title, change: c.hypothesis, variant: c.variant || "cap_two_asks", why: c.caveat || "", effect: c.expected, mde: c.expected_pp ? Math.max(0.01, c.expected_pp / 100) : SET().mde }); }
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
  $$("[data-create]", el).forEach(b => b.onclick = () => createFrom(all.find(x => x.id === b.dataset.create)));
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
