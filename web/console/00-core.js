"use strict";
/* Canary console. Plain JS, no libraries, works offline. Every number shown comes from the bundle the Python engine produced
   (dist/canary_demo.html embeds it; live mode fetches /api/console). Demo state (how many days have been played, approvals, rollbacks)
   lives in this browser only and is reset from Settings. */

const LIVE = !!window.CANARY_LIVE;
const HOSTED = !!window.CANARY_HOSTED;
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
