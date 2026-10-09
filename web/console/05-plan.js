/* Pure functions for the New Experiment page and the screens that show its tests: segments, the 30-day history, metrics, the duration plan,
   and the prompt checks (variables, diff). No DOM here: tests/browser/plan_units.cjs loads this file whole and unit-tests it.
   Reads the bundle (`C`) and the saved settings (`DYN`) only when a function is called. */

/* ------------------------------------------------------------------ segments: [{factor, column, values}], AND between rules, OR within one */
const PLAN_CAT = () => (C && C.catalog) || { variables: [], strata: [], balance: [], min_stratum: 30, min_share: 0.02 };
const catCol = col => PLAN_CAT().variables.find(v => v.column === col || v.name === col);
const catOrder = col => PLAN_CAT().variables.findIndex(v => v.column === col || v.name === col);
/** Any saved form of a segment (the JSON list, or the earlier {rules:[{var, values}]}) as the JSON list, in catalog order. */
function segList(seg) {
  const raw = !seg ? [] : Array.isArray(seg) ? seg : (seg.rules || []);
  return raw.map(r => { const col = r.column || r.var, v = catCol(col); return { factor: v ? v.label : (r.factor || col), column: col, values: v ? v.values.filter(x => (r.values || []).includes(x)) : (r.values || []) }; })
    .sort((a, b) => catOrder(a.column) - catOrder(b.column));
}
const segRules = segList;
function segAllowed(seg, col) { const r = segList(seg).find(x => x.column === col); return r ? r.values : (catCol(col) || { values: [] }).values; }
/** Values of a drawn factor that can occur once the rules on factors derived from it (HL Bucket from HL Type) apply too. */
function segAllowedEff(seg, col) {
  let ok = segAllowed(seg, col);
  for (const d of PLAN_CAT().variables) if (d.derived_from === col && d.derive) { const okd = segAllowed(seg, d.column); ok = ok.filter(x => okd.includes(d.derive[x])); }
  return ok;
}
/** Share of all traffic the segment matches (drawn factors are independent; a derived factor narrows its base factor). */
function segShare(seg) {
  let s = 1;
  for (const v of PLAN_CAT().variables) { if (!v.pre_call || v.derived_from || !v.mix) continue; const ok = segAllowedEff(seg, v.column); s *= v.values.reduce((a, x, i) => a + (ok.includes(x) ? v.mix[i] : 0), 0); }
  return s;
}
const orWords = vals => vals.length === 1 ? vals[0] : vals.slice(0, -1).join(", ") + " or " + vals[vals.length - 1];
/** The rule in plain words: "Leads where HL Type is UA or PNSM AND Legal Status is Proprietorship". */
function segDescribe(seg) { const rs = segList(seg); return rs.length ? "Leads where " + rs.map(r => `${r.factor} is ${orWords(r.values)}`).join(" AND ") : "All traffic (neutral test)"; }
const segWords = segDescribe;
/** The builder's rows as the saved JSON, with every problem in plain words. A factor can be used only once; a row needs a factor and a value. */
function segFromRows(rows) {
  const errors = [], seen = new Set(), out = [];
  for (const r of rows || []) {
    if (!r.column) { errors.push("Choose a factor in every condition, or remove the empty one."); continue; }
    const v = catCol(r.column); if (!v || !v.pre_call) { errors.push(`${r.column} cannot pick leads (it is not known before the call).`); continue; }
    if (v.in_data === false) { errors.push(`${v.label} is not in the data yet.`); continue; }
    if (seen.has(r.column)) { errors.push(`${v.label} is used twice: a factor can be used only once.`); continue; }
    seen.add(r.column);
    const vals = v.values.filter(x => (r.values || []).includes(x));
    if (!vals.length) { errors.push(`Choose at least one value for ${v.label}.`); continue; }
    out.push({ factor: v.label, column: v.column, values: vals });
  }
  const seg = segList(out), share = segShare(seg);
  if (!errors.length && seg.length && share === 0) errors.push("No lead can match this rule: the conditions contradict each other (for example an HL Type outside the chosen HL Bucket).");
  else if (!errors.length && seg.length && share < PLAN_CAT().min_share) errors.push(`This audience is only ${(share * 100).toFixed(1)}% of traffic. Widen it (at least ${Math.round(PLAN_CAT().min_share * 100)}%).`);
  return { seg, errors, share };
}
/** Does a lead's factors match the segment? (`get(col)` returns the lead's value) */
const segMatch = (seg, get) => segList(seg).every(r => r.values.includes(get(r.column)));
function planStrata(eligTotal, seg) {                       // the strata the router deals blocks into; small ones merge into "Other"
  const names = PLAN_CAT().strata, lists = names.map(n => segAllowedEff(seg, n));
  const prob = (n, val) => { const v = catCol(n), ok = segAllowedEff(seg, n), tot = v.values.reduce((a, x, i) => a + (ok.includes(x) ? v.mix[i] : 0), 0); return ok.includes(val) && tot ? v.mix[v.values.indexOf(val)] / tot : 0; };
  let rows = [[]]; lists.forEach(l => { rows = rows.flatMap(r => l.map(x => [...r, x])); });
  const out = rows.map(k => ({ label: k.join(" x "), expected: eligTotal * k.reduce((p, val, i) => p * prob(names[i], val), 1) })); out.forEach(r => r.merged = r.expected < PLAN_CAT().min_stratum && out.length > 1);
  return { strata: out, merged: out.filter(r => r.merged).map(r => r.label) };
}
const blockFor = share => { for (const size of [10, 20, 40, 50, 100]) { const k = share * size; if (Math.abs(k - Math.round(k)) < 1e-9 && Math.round(k) >= 1) return [size, Math.round(k)]; } return [100, Math.max(1, Math.round(share * 100))]; };

/* ------------------------------------------------------------------ the 30-day history (decoded once from the bundle's fixed-width string) */
let _HIST = null;
function HIST() {
  if (_HIST) return _HIST;
  const h = (C && C.history) || null;
  if (!h || !h.leads) return (_HIST = { n: 0, days: 30, cols: [], col: {}, factors: [], pats: [], f: [], day: [], pat: [], disp: [], dur: [], conn: [] });
  const A = h.alphabet, code = {}; for (let i = 0; i < A.length; i++) code[A[i]] = i;
  const n = h.n_leads, W = h.width, F = h.factors.length, f = h.factors.map(() => new Uint8Array(n)), day = new Uint8Array(n), pat = new Uint8Array(n), disp = new Uint8Array(n), dur = new Uint16Array(n), conn = new Uint8Array(n), s = h.leads;
  for (let i = 0; i < n; i++) {
    const o = i * W; day[i] = code[s[o]];
    for (let k = 0; k < F; k++) f[k][i] = code[s[o + 1 + k]];
    pat[i] = code[s[o + 1 + F]]; disp[i] = code[s[o + 2 + F]]; dur[i] = code[s[o + 3 + F]] * 62 + code[s[o + 4 + F]];
    const p = h.patterns[pat[i]]; conn[i] = p[p.length - 1] === "Answered" ? 1 : 0;
  }
  const col = {}; h.columns.forEach(c => col[c.name] = c);
  return (_HIST = { n, days: h.days, start: h.start, end: h.end, cols: h.columns, col, factors: h.factors, fidx: Object.fromEntries(h.factors.map((x, k) => [x, k])), pats: h.patterns, dispVals: h.dispositions, noConnect: h.no_connect, hang: h.early_hangup_s, f, day, pat, disp, dur, conn, synthetic: h.synthetic, note: h.note });
}
const histHas = col => !!HIST().col[col];
/** Value of a column for lead i, attempt a (call level). Factors are lead level; only the answered attempt has a length and a disposition. */
function callVal(H, i, a, col) {
  if (col in H.fidx) return (catCol(col) || { values: [] }).values[H.f[H.fidx[col]][i]];
  const st = H.pats[H.pat[i]][a], ans = st === "Answered";
  if (col === "call_status") return st;
  if (col === "connected") return ans ? "1" : "0";
  if (col === "disposition") return ans ? H.dispVals[H.disp[i]] : H.noConnect;
  if (col === "early_hangup") return ans && H.dur[i] < H.hang ? "Yes" : "No";
  if (col === "call_duration") return ans ? H.dur[i] : 0;
  return undefined;
}
const condOk = (c, v) => c.op === "is_not" ? !c.values.includes(v) : c.values.includes(v);
/** Leads in the segment, as indexes into the history (cached per segment). */
const _segIdx = new Map();
function segLeads(seg) {
  const H = HIST(), key = JSON.stringify(segList(seg)); if (_segIdx.has(key)) return _segIdx.get(key);
  const rs = segList(seg).map(r => ({ k: H.fidx[r.column], ok: new Set(r.values.map(x => (catCol(r.column) || { values: [] }).values.indexOf(x))) }));
  const out = []; for (let i = 0; i < H.n; i++) if (rs.every(r => r.k != null && r.ok.has(H.f[r.k][i]))) out.push(i);
  if (_segIdx.size > 200) _segIdx.clear(); _segIdx.set(key, out); return out;
}
/** Connected leads a day in the audience over the 30 days, and how many there were in all. */
function audienceVolume(seg) { const H = HIST(), idx = segLeads(seg); let c = 0; for (const i of idx) c += H.conn[i]; return { connected: c, perDay: c / (H.days || 30), leads: idx.length }; }
/** Share of history leads that connected (all traffic): turns connected leads into attempted leads for the engine. */
function connectShare() { const H = HIST(); let c = 0; for (let i = 0; i < H.n; i++) c += H.conn[i]; return H.n ? c / H.n : 1; }

/* ------------------------------------------------------------------ metrics: one definition format for built-in and custom metrics */
const METRIC_CAT = () => (C && C.metric_catalog) || { builtin: [], columns: [], ops: [], max_conditions: 3, groups: [], limits: { guardrails: 3, secondary: 5 } };
const customMetrics = () => ((typeof DYN !== "undefined" && DYN.settings && DYN.settings.customMetrics) || []);
/** Every metric a test can use: the built-ins, the custom ones saved in Settings > Metrics, and `extra` (kept for one test only). */
function allMetrics(extra) { const seen = new Set(), out = []; for (const m of [...METRIC_CAT().builtin, ...customMetrics().map(m => ({ ...m, group: "Custom", custom: true })), ...(extra || []).map(m => ({ ...m, group: "Custom", custom: true, local: true }))]) { if (!seen.has(m.key)) { seen.add(m.key); out.push(m); } } return out; }
const metricByKey = (k, extra) => allMetrics(extra).find(m => m.key === k) || null;
const colLabel = c => (HIST().col[c] || catCol(c) || { label: c }).label;
const condWords = c => c.op === "is_not" ? `${colLabel(c.col)} is not ${c.values.length > 1 ? "any of " + c.values.join(", ") : c.values[0]}` : `${colLabel(c.col)} is ${orWords(c.values)}`;
const sideWords = (side, all) => side.where && side.where.length ? `${side.unit === "calls" ? "Calls" : "Leads"} where ${side.where.map(condWords).join(" and ")}` : (all || `All ${side.unit === "calls" ? "calls" : "leads"} attempted`);
/** The formula in plain words: "Calls where Call status is Answered ÷ All calls attempted". */
function metricWords(m) {
  if (!m) return "";
  if (m.type === "average") return `Average ${colLabel(m.col).toLowerCase()} over ${m.unit === "leads" ? "leads (first matching call)" : "calls"}${m.where && m.where.length ? " where " + m.where.map(condWords).join(" and ") : ""}`;
  return `${sideWords(m.num)} ÷ ${sideWords(m.den)}`;
}
const metricUnit = m => m && m.type === "average" ? ((HIST().col[m.col] || {}).unit || "") : "%";
/** A value of the metric as people read it: 45.1% for a rate, 69.9 s for an average. */
const fmtMetric = (v, m, d = 1) => v == null || isNaN(v) ? "-" : m && m.type === "average" ? `${(+v).toFixed(d)}${metricUnit(m) ? " " + metricUnit(m) : ""}` : `${(v * 100).toFixed(d)}%`;
/** A difference of the metric: +5.0 pp for a rate (the dashboard's unit), −3.2 s for an average. `fmtPts` says "pts", as the New Experiment page does. */
const fmtDelta = (v, m, d = 1, word = "pp") => { if (v == null || isNaN(v)) return "-"; const avg = m && m.type === "average", t = Math.abs(avg ? v : v * 100).toFixed(d); return (+t === 0 ? "" : v >= 0 ? "+" : "−") + t + (avg ? (metricUnit(m) ? " " + metricUnit(m) : "") : " " + word); };
const fmtPts = (v, m, d = 1) => fmtDelta(v, m, d, "pts");

/** The metric on the last 30 days for an audience: numerator, denominator, value, the spread of one unit (sqrt(p(1-p)) or the SD), leads. */
const _evalCache = new Map();
function metricEval(m, seg) {
  const key = JSON.stringify([m.type, m.num, m.den, m.col, m.unit, m.where, segList(seg)]); if (_evalCache.has(key)) return _evalCache.get(key);
  const H = HIST(), idx = segLeads(seg);
  let sn = 0, sd = 0, vs = 0, vq = 0, vk = 0;
  const hit = (where, i, a) => (where || []).every(c => condOk(c, callVal(H, i, a, c.col)));
  for (const i of idx) {
    const nA = H.pats[H.pat[i]].length;
    if (m.type === "rate") {
      let cn = 0, cd = 0; for (let a = 0; a < nA; a++) { if (hit(m.num.where, i, a)) cn++; if (hit(m.den.where, i, a)) cd++; }
      sn += m.num.unit === "calls" ? cn : cn ? 1 : 0; sd += m.den.unit === "calls" ? cd : cd ? 1 : 0;
    } else {
      for (let a = 0; a < nA; a++) if (hit(m.where, i, a)) { const x = +callVal(H, i, a, m.col); sn += x; sd += 1; vs += x; vq += x * x; vk++; if (m.unit === "leads") break; }
    }
  }
  const value = sd ? sn / sd : null;
  const spread = m.type === "rate" ? (value != null && value >= 0 && value <= 1 ? Math.sqrt(value * (1 - value)) : null) : (vk > 1 ? Math.sqrt(Math.max(0, (vq - vs * vs / vk) / (vk - 1))) : null);
  const out = { num: sn, den: sd, value, sd: spread, leads: idx.length };
  if (_evalCache.size > 500) _evalCache.clear(); _evalCache.set(key, out); return out;
}
/** Today's value for an audience; an audience with fewer than 200 connected leads in the 30 days uses the all-traffic value instead. */
function baselineFor(m, seg) {
  const vol = audienceVolume(seg), few = segList(seg).length > 0 && vol.connected < 200, ev = metricEval(m, few ? null : seg);
  return { ...ev, fallback: few, note: few ? "Too little history for this audience; using overall rate." : "" };
}
/** Checks a metric definition: columns from the data only, at most 3 conditions a side, a denominator above 0, a rate within 0 to 100%. */
function metricCheck(m) {
  const errs = [], mc = METRIC_CAT(), H = HIST(), max = mc.max_conditions || 3;
  if (!m || !String(m.name || "").trim()) errs.push("Give the metric a name.");
  else if (String(m.name).length > 60) errs.push("The name is too long (60 characters at most).");
  else if (allMetrics().some(x => x.key !== m.key && x.name.trim().toLowerCase() === String(m.name).trim().toLowerCase())) errs.push("A metric with this name already exists.");
  const conds = (list, label, needOne) => {
    if (needOne && !(list || []).length) errs.push(`${label}: add at least one condition.`);
    if ((list || []).length > max) errs.push(`${label}: at most ${max} conditions.`);
    for (const c of list || []) {
      const col = H.col[c.col]; if (!col) { errs.push(`${label}: choose a column from the data.`); continue; }
      if (col.type !== "category") errs.push(`${label}: ${col.label} is a number; pick a column with a list of values.`);
      if (!["is", "is_not", "in"].includes(c.op)) errs.push(`${label}: choose is, is not or is one of.`);
      if (!(c.values || []).length) errs.push(`${label}: choose a value for ${col.label}.`);
      else if (c.values.some(v => !col.values.includes(v))) errs.push(`${label}: a value is not in ${col.label}.`);
    }
  };
  if (!m || !["rate", "average"].includes(m.type)) errs.push("Choose Rate (%) or Average.");
  else if (m.type === "rate") { conds(m.num && m.num.where, "Numerator", true); conds(m.den && m.den.where, "Denominator", false); if (!m.num || !["calls", "leads"].includes(m.num.unit) || !m.den || !["calls", "leads"].includes(m.den.unit)) errs.push("Count calls or leads on both sides."); }
  else { const col = H.col[m.col]; if (!col) errs.push("Choose a number column to average."); else if (col.type !== "number") errs.push(`${col.label} is not a number column.`); if (!["calls", "leads"].includes(m.unit)) errs.push("Average over calls or leads."); conds(m.where, "Condition", false); }
  if (m && !["higher", "lower"].includes(m.direction)) errs.push("Choose whether higher or lower is better.");
  let ev = null;
  if (!errs.length) { ev = metricEval(m, null); if (!(ev.den > 0)) errs.push("The denominator is 0 on the last 30 days: nothing would be counted."); else if (m.type === "rate" && (ev.value < 0 || ev.value > 1)) errs.push(`This rate comes to ${(ev.value * 100).toFixed(0)}%: a rate must lie between 0 and 100%. Make the numerator count a part of the denominator.`); }
  return { ok: !errs.length, errors: [...new Set(errs)], ev };
}
/** A metric key from its name: custom_answered_pct. */
const metricKey = name => "custom_" + String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);

/** The test's metric list, in the order the engine reads it: the primary, the guardrails, then the secondary metrics. */
function testMetrics(w) {
  const out = []; const ex = w.localMetrics || [];
  if (w.primary) out.push({ role: "primary", key: w.primary, m: metricByKey(w.primary, ex), direction: (metricByKey(w.primary, ex) || {}).direction });
  for (const g of w.guards || []) out.push({ role: "guardrail", key: g.key, m: metricByKey(g.key, ex), direction: g.direction, limit: g.limit });
  for (const s of w.secondary || []) out.push({ role: "secondary", key: s.key, m: metricByKey(s.key, ex), direction: s.direction });
  return out.filter(x => x.m);                                                  // a metric removed from Settings since the draft was saved drops out
}
/** Roles have limits: 3 guardrails and 5 secondary metrics (the pre-added guardrail counts). */
const roleFull = (w, role) => role === "guardrail" ? (w.guards || []).length >= METRIC_CAT().limits.guardrails : (w.secondary || []).length >= METRIC_CAT().limits.secondary;
const limitWords = (l, m) => !l ? "" : `must not get worse by more than ${l.value}${l.kind === "rel" ? "%" : m && m.type === "average" ? " " + (metricUnit(m) || "units") : " points"}`;

/* ------------------------------------------------------------------ the duration plan: ONE function for Step 5 and the "At a glance" panel */
const Z_CONF = { 0.9: 1.645, 0.95: 1.96, 0.99: 2.576 }, Z_POWER = 0.84;     // 95% two-sided and 80% power give (1.96 + 0.84)^2 = 7.84
const zConf = conf => Z_CONF[conf] || normPpf(1 - (1 - conf) / 2);
/** n_B = (z + 0.84)^2 x spread^2 / ((1 - s) x d^2); days = ceil(n_B / (leads a day x s)), rounded up to whole weeks, at least 7; over 28 = too small.
    Reverse: the smallest improvement a given length can spot = (z + 0.84) x sqrt(spread^2 x (1/n_A + 1/n_B)).
    `spread` is sqrt(p(1-p)) for a rate and the metric's standard deviation for an average. */
function durationPlan(x) {
  const conf = x.conf || 0.95, z = zConf(conf), k = (z + Z_POWER) ** 2, s = x.share, lpd = x.lpd, d = Math.abs(x.d);
  const spread2 = x.type === "average" ? (x.sd || 0) ** 2 : x.p * (1 - x.p);
  const nB = k * spread2 / ((1 - s) * d * d), bPerDay = lpd * s, rawDays = nB / bPerDay;
  const weeks = Math.max(7, Math.ceil(rawDays / 7 - 1e-9) * 7), tooBig = !(weeks <= 28), rec = tooBig ? 28 : weeks;
  const days = x.days ? +x.days : rec;
  const nBd = lpd * s * days, nAd = lpd * (1 - s) * days, smallest = (z + Z_POWER) * Math.sqrt(spread2 * (1 / nAd + 1 / nBd));
  const minLeads = x.minLeads || 0, minDay = minLeads ? Math.ceil(minLeads / Math.max(1e-9, Math.min(bPerDay, lpd * (1 - s)))) : 0;
  return { z, k, s, lpd, d, spread2, nB, bPerDay, rawDays, weeks, rec, tooBig, days, custom: !!x.days, shorter: !!x.days && x.days < rec, nBd, nAd, smallest, minDay, minLate: minLeads > 0 && minDay > days,
    tooBigMsg: "This audience is too small for this test. Widen the audience, raise B's share, or aim for a bigger improvement." };
}
/** Improvement presets: points for a rate, a share of today's value for an average. */
function improvementOf(size, m, base) { const pts = { small: 2, medium: 5, large: 10 }[size] || 5; return m && m.type === "average" ? (base || 0) * pts / 100 : pts / 100; }

/* ------------------------------------------------------------------ prompts: template variables, diff, and building B from a suggestion */
const JINJA_WORDS = new Set(["if", "elif", "else", "endif", "for", "endfor", "in", "not", "and", "or", "is", "set", "endset", "true", "false", "none", "True", "False", "None", "loop", "range", "macro", "endmacro", "block", "endblock", "with", "endwith", "defined", "raw", "endraw", "include", "import", "from", "as", "recursive", "filter", "endfilter", "call", "endcall"]);
/** Names of the template variables a prompt uses, inside {{ ... }} and {% ... %} tags (strings, filters, attributes and loop variables left out). */
function promptVars(text) {
  const out = new Set(), local = new Set(), tags = String(text || "").match(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g) || [];
  for (const t of tags) {
    const body = t.slice(2, -2).replace(/(["'])(?:\\.|(?!\1).)*\1/g, " ");
    const decl = body.match(/^\s*(?:for\s+([\w\s,]+?)\s+in\b|set\s+(\w+))/); if (decl) (decl[1] || decl[2]).split(",").forEach(x => local.add(x.trim()));
    const re = /([|.]\s*)?\b([A-Za-z_]\w*)\b/g; let m;
    while ((m = re.exec(body))) { if (m[1]) continue; const w = m[2]; if (!JINJA_WORDS.has(w) && !local.has(w) && !/^\d/.test(w)) out.add(w); }
  }
  return [...out].sort();
}
/** Every variable of A must still be in B, and B must not use a variable the bot does not supply. */
function varCheck(a, b) { const A = promptVars(a), B = promptVars(b); const missing = A.filter(v => !B.includes(v)), added = B.filter(v => !A.includes(v)); return { ok: !missing.length && !added.length, missing, added, n: A.length }; }
/** Myers' shortest edit script between two line arrays: fast when the prompts differ in few places. null when there are more than `maxD` differences. */
function myersOps(A, B, maxD = 4000) {
  const N = A.length, M = B.length, MAX = Math.min(N + M, maxD), off = MAX + 2, V = new Int32Array(2 * MAX + 5), trace = [];
  for (let d = 0; d <= MAX; d++) {
    trace.push(V.slice(off - d - 1, off + d + 2));                      // V before round d, indices -(d+1)..(d+1)
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) ? V[off + k + 1] : V[off + k - 1] + 1, y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; }
      V[off + k] = x;
      if (x >= N && y >= M) {                                            // walk back through the rounds
        const ops = []; let cx = N, cy = M;
        for (let dd = d; dd >= 0; dd--) {
          const t = trace[dd], at = kk => t[kk + dd + 1], kk = cx - cy;
          const pk = (kk === -dd || (kk !== dd && at(kk - 1) < at(kk + 1))) ? kk + 1 : kk - 1, px = dd === 0 ? 0 : at(pk), py = px - pk;
          while (cx > px && cy > py) { ops.push(["=", cx - 1, cy - 1]); cx--; cy--; }
          if (dd > 0) { if (cx === px) ops.push(["+", cy - 1]); else ops.push(["-", cx - 1]); cx = px; cy = py; }
        }
        return ops.reverse();
      }
    }
  }
  return null;
}
/** Line diff of A and B (common ends trimmed, then Myers on the middle). Rows: {t: "same"|"del"|"add", a, b}. */
function diffRows(a, b) {
  const A = String(a).split("\n"), B = String(b).split("\n"); let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length; while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const rows = []; for (let i = 0; i < s; i++) rows.push({ t: "same", a: A[i], b: B[i], ia: i + 1, ib: i + 1 });
  const ops = myersOps(A.slice(s, ea), B.slice(s, eb));
  if (!ops) { for (let i = s; i < ea; i++) rows.push({ t: "del", a: A[i], ia: i + 1 }); for (let j = s; j < eb; j++) rows.push({ t: "add", b: B[j], ib: j + 1 }); }
  else for (const [op, i, j] of ops) rows.push(op === "=" ? { t: "same", a: A[s + i], b: B[s + j], ia: s + i + 1, ib: s + j + 1 } : op === "-" ? { t: "del", a: A[s + i], ia: s + i + 1 } : { t: "add", b: B[s + i], ib: s + i + 1 });
  for (let i = ea, j = eb; i < A.length; i++, j++) rows.push({ t: "same", a: A[i], b: B[j], ia: i + 1, ib: j + 1 });
  return rows;
}
const diffStats = rows => ({ added: rows.filter(r => r.t === "add").length, removed: rows.filter(r => r.t === "del").length, same: rows.every(r => r.t === "same") });
/** The candidate's edits applied to a prompt (same rules as the engine: anything that does not match exactly fails, so a stale edit never silently changes nothing). */
function applyEdits(text, spec) {
  const lines = String(text).replace(/\n$/, "").split("\n");
  for (const e of (spec && spec.edit) || []) { const hits = lines.map((l, i) => l.includes(e.in_line) ? i : -1).filter(i => i >= 0); if (hits.length !== 1) throw new Error(`The suggestion's anchor "${e.in_line.slice(0, 50)}" matches ${hits.length} lines of prompt A.`); if (!lines[hits[0]].includes(e.find)) throw new Error(`"${e.find}" is not in the line the suggestion changes.`); lines[hits[0]] = lines[hits[0]].replace(e.find, e.replace); }
  for (const r of (spec && spec.remove) || []) { const i = lines.indexOf(r); if (i < 0) throw new Error("A line the suggestion removes is not in prompt A."); lines.splice(i, 1); }
  for (const ad of (spec && spec.add) || []) { const i = lines.indexOf(ad.after); if (i < 0) throw new Error("The line the suggestion adds after is not in prompt A."); lines.splice(i + 1, 0, ad.text); }
  return lines.join("\n") + "\n";
}
