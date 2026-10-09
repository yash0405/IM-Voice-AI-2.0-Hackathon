// Unit tests for web/console/05-plan.js (the pure functions of the New Experiment page). Run by tests/test_plan_units.py:
//   node tests/browser/plan_units.cjs <fixture.json>
// The fixture holds the catalog, the 30-day history, the metric catalog, the real prompt A and numbers computed with plain SQL.
const fs = require("fs"), path = require("path");
const fx = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const src = fs.readFileSync(path.resolve(__dirname, "..", "..", "web", "console", "05-plan.js"), "utf8");
const stubs = "const normPpf = p => { throw new Error('normPpf not needed for the table confidences'); };";
const lib = new Function("C", "DYN", stubs + src + ";return {segList, segDescribe, segFromRows, segShare, segLeads, segMatch, HIST, callVal, audienceVolume, connectShare, metricEval, baselineFor, metricCheck, metricWords, durationPlan, improvementOf, promptVars, varCheck, diffRows, diffStats, applyEdits, roleFull, testMetrics, allMetrics, fmtMetric, fmtDelta, fmtPts};")(
  { catalog: fx.catalog, history: fx.history, metric_catalog: fx.metric_catalog, library: fx.library }, { settings: {} });
let pass = 0, fail = 0;
const ok = (cond, name, info) => { if (cond) { pass++; console.log("ok   " + name); } else { fail++; console.log("FAIL " + name + (info !== undefined ? "  " + JSON.stringify(info) : "")); } };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const M = k => fx.metric_catalog.builtin.find(m => m.key === k);

/* ---- the duration formula, hand-computed */
{ const P = lib.durationPlan({ type: "rate", p: 0.45, lpd: 2140, share: 0.10, d: 0.05, conf: 0.95 });
  const nB = 7.84 * 0.45 * 0.55 / (0.9 * 0.05 * 0.05);                                   // 862.4
  ok(near(P.nB, nB), "duration: n_B = 7.84 p(1-p) / ((1-s) d^2) for 2,140/day, 45%, 10%, +5 pts", { got: P.nB, want: nB });
  ok(near(P.bPerDay, 214), "duration: B gets 214 leads a day");
  ok(near(P.rawDays, nB / 214) && P.weeks === 7 && P.days === 7 && !P.tooBig, "duration: ceil(862.4 / 214) = 5 days, rounded up to whole weeks = 7", { raw: P.rawDays, days: P.days });
  const sm = 2.8 * Math.sqrt(0.45 * 0.55 * (1 / (2140 * 0.9 * 7) + 1 / (2140 * 0.1 * 7)));
  ok(near(P.smallest, sm), "reverse: 7 days spot 2.8 sqrt(p(1-p)(1/n_A + 1/n_B))", { got: P.smallest, want: sm }); }
{ const P = lib.durationPlan({ type: "rate", p: 0.45, lpd: 300, share: 0.10, d: 0.02, conf: 0.95 });
  ok(P.tooBig && P.tooBigMsg === "This audience is too small for this test. Widen the audience, raise B's share, or aim for a bigger improvement.", "duration: over 28 days gives the too-small message", { raw: P.rawDays }); }
{ const P = lib.durationPlan({ type: "rate", p: 0.45, lpd: 100000, share: 0.30, d: 0.10, conf: 0.95 });
  ok(P.rawDays < 1 && P.days === 7, "duration: at least 7 days even when 1 day would do", { raw: P.rawDays }); }
{ const P = lib.durationPlan({ type: "rate", p: 0.45, lpd: 1000, share: 0.10, d: 0.05, conf: 0.95 });       // 862.4 / 100 = 8.6 days -> 14
  ok(P.days === 14 && P.weeks === 14, "duration: 8.6 days rounds up to 14 (whole weeks)", { raw: P.rawDays, days: P.days }); }
{ const sd = 50.4531, d = 3.5, P = lib.durationPlan({ type: "average", sd, lpd: 1000, share: 0.10, d, conf: 0.95 });
  ok(near(P.nB, 7.84 * sd * sd / (0.9 * d * d)), "duration: an average uses the metric's SD in place of sqrt(p(1-p))", { got: P.nB }); }
{ const P = lib.durationPlan({ type: "rate", p: 0.45, lpd: 2140, share: 0.10, d: 0.05, conf: 0.95, days: 7, minLeads: 500 }), Q = lib.durationPlan({ type: "rate", p: 0.45, lpd: 300, share: 0.10, d: 0.05, conf: 0.95, days: 14, minLeads: 500 });
  ok(P.custom && !P.shorter && Q.shorter, "custom length: shorter than recommended is flagged", { q: Q.rec }); }
ok(near(lib.improvementOf("small", M("buylead_created")), 0.02) && near(lib.improvementOf("large", M("duration_s"), 70), 7), "improvement presets: +2/+5/+10 pts for a rate, % of today for an average");

/* ---- the < 200-lead fallback, on the real (synthetic) history */
{ const tiny = [{ column: "hl_type", values: ["UATF"] }, { column: "gst_turnover", values: [">500Cr"] }], vol = lib.audienceVolume(tiny), b = lib.baselineFor(M("buylead_created"), tiny), all = lib.metricEval(M("buylead_created"), null);
  ok(vol.connected < 200 && b.fallback && b.note === "Too little history for this audience; using overall rate." && b.value === all.value, "fewer than 200 leads: the overall rate is used, with the note", { conn: vol.connected }); }

/* ---- metric validators */
const cond = (col, ...values) => ({ col, op: values.length > 1 ? "in" : "is", values });
{ const r = lib.metricCheck({ key: "custom_t1", name: "T1", type: "rate", direction: "higher", num: { unit: "calls", where: [cond("disposition", "BuyLead created")] }, den: { unit: "calls", where: [cond("call_status", "Busy"), cond("connected", "1")] } });
  ok(!r.ok && r.errors.some(e => /denominator is 0/.test(e)), "validator: a denominator of 0 is refused", r.errors); }
{ const r = lib.metricCheck({ key: "custom_t2", name: "T2", type: "rate", direction: "higher", num: { unit: "calls", where: [cond("call_status", "Answered", "Not answered", "Busy", "Failed")] }, den: { unit: "leads", where: [cond("connected", "1")] } });
  ok(!r.ok && r.errors.some(e => /between 0 and 100%/.test(e)), "validator: a rate outside 0-100% is refused", r.errors); }
{ const r = lib.metricCheck({ key: "custom_t3", name: "T3", type: "rate", direction: "higher", num: { unit: "calls", where: [cond("not_a_column", "x")] }, den: { unit: "calls", where: [] } });
  ok(!r.ok && r.errors.some(e => /column from the data/.test(e)), "validator: an invalid column is refused", r.errors); }
{ const r = lib.metricCheck({ key: "custom_t4", name: "T4", type: "average", direction: "lower", col: "disposition", unit: "calls", where: [] });
  ok(!r.ok && r.errors.some(e => /not a number column/.test(e)), "validator: an average of a non-number column is refused", r.errors); }
{ const r = lib.metricCheck({ key: "custom_t5", name: "T5", type: "rate", direction: "higher", num: { unit: "calls", where: [cond("connected", "1"), cond("vendor", "arrowhead"), cond("call_status", "Answered"), cond("early_hangup", "No")] }, den: { unit: "calls", where: [] } });
  ok(!r.ok && r.errors.some(e => /at most 3/.test(e)), "validator: at most 3 conditions a side", r.errors); }
{ const r = lib.metricCheck({ key: "custom_ok", name: "Answered (custom)", type: "rate", direction: "higher", num: { unit: "calls", where: [cond("call_status", "Answered")] }, den: { unit: "calls", where: [] } });
  ok(r.ok && r.ev.value > 0 && r.ev.value < 1, "validator: a sound custom rate passes", r.errors); }
ok(lib.metricWords({ type: "rate", num: { unit: "calls", where: [cond("call_status", "Answered")] }, den: { unit: "calls", where: [] } }) === "Calls where Call status is Answered ÷ All calls attempted", "formula in plain words", lib.metricWords({ type: "rate", num: { unit: "calls", where: [cond("call_status", "Answered")] }, den: { unit: "calls", where: [] } }));

/* ---- the variable check, on the real prompt A */
{ const A = fx.library.base_text, vars = lib.promptVars(A);
  ok(JSON.stringify(vars) === JSON.stringify(fx.library.variables), "variables: the scan finds the same names as the engine's Jinja parser", { js: vars, py: fx.library.variables });
  const kept = lib.varCheck(A, A + "\nOne more instruction line.\n");
  ok(kept.ok && kept.n === fx.library.variables.length, "variables: all kept");
  const miss = lib.varCheck(A, A.split("buyer_city").join("buyer_town"));
  ok(!miss.ok && miss.missing.includes("buyer_city") && miss.added.includes("buyer_town"), "variables: a missing one and a new one are both caught", { m: miss.missing, a: miss.added });
  const add = lib.varCheck(A, A + "\nSay hello to {{ seller_nickname }}.\n");
  ok(!add.ok && add.missing.length === 0 && JSON.stringify(add.added) === '["seller_nickname"]', "variables: a new variable not supplied by the bot is caught", add); }

/* ---- the diff */
{ const st0 = lib.diffStats(lib.diffRows("a\nb\nc", "a\nb\nc")), st1 = lib.diffStats(lib.diffRows("a\nb\nc", "a\nb\nX\nc")), st2 = lib.diffStats(lib.diffRows("a\nb\nc", "a\nc")), st3 = lib.diffStats(lib.diffRows("a\nb\nc", "a\nB\nc"));
  ok(st0.same && st0.added === 0 && st0.removed === 0, "diff: identical");
  ok(!st1.same && st1.added === 1 && st1.removed === 0, "diff: one line added");
  ok(!st2.same && st2.added === 0 && st2.removed === 1, "diff: one line removed");
  ok(st3.added === 1 && st3.removed === 1, "diff: one line changed = one removed + one added");
  const r = lib.diffRows("a\nb\nc", "a\nb\nX\nc"); ok(r.find(x => x.t === "add").b === "X" && r.filter(x => x.t === "same").length === 3, "diff: rows carry the text");
  const A = fx.library.base_text, L = A.split("\n"), mid = Math.floor(L.length / 2), B = [...L.slice(0, mid), L[mid] + " (edited)", ...L.slice(mid + 1)].join("\n") + "Never ask for the same detail more than twice.\n";
  const t0 = Date.now(), big = lib.diffStats(lib.diffRows(A, B)), ms = Date.now() - t0;
  ok(big.added === 2 && big.removed === 1 && ms < 1500, "diff: a change in the middle plus a line at the end of the real prompt = 2 added, 1 removed (not a whole-block replace)", { big, ms });
  const rr = lib.diffRows(A, B); ok(rr.filter(x => x.t !== "add").map(x => x.a).join("\n") === A.replace(/\n$/, "") + "\n" || rr.filter(x => x.t !== "add").length === A.split("\n").length, "diff: every line of A appears once (same or removed)"); }
{ const A = fx.library.base_text, spec = fx.library.edits.cap_two_asks, B = lib.applyEdits(A, spec);
  ok(B !== A && lib.varCheck(A, B).ok, "a suggestion applied to prompt A gives a full prompt B that keeps the variables");
  ok(B === fx.library.cap_two_asks_text, "the full prompt B built in the browser equals the engine's candidate text exactly"); }

/* ---- segments: one factor once, AND/OR, plain words */
{ const r = lib.segFromRows([{ column: "hl_type", values: ["UA"] }, { column: "hl_type", values: ["PNSM"] }]);
  ok(r.errors.some(e => /used twice/.test(e)), "segment: a factor can be used only once", r.errors);
  const r2 = lib.segFromRows([{ column: "", values: [] }]); ok(r2.errors.length === 1, "segment: an empty condition is flagged");
  const r3 = lib.segFromRows([{ column: "hl_type", values: ["TF"] }, { column: "hl_bucket", values: ["Top 3"] }]); ok(r3.errors.some(e => /contradict/.test(e)), "segment: contradicting conditions are refused", r3.errors); }
{ const seg = [{ column: "vertical", values: ["Top Cities - Inhouse"] }, { column: "hl_type", values: ["PNSM", "UA"] }, { column: "legal_status", values: ["Proprietorship"] }];
  ok(lib.segDescribe(seg) === "Leads where HL Type is UA or PNSM AND Legal Status is Proprietorship AND Vertical is Top Cities - Inhouse", "plain words: the spec's example, in catalog order", lib.segDescribe(seg));
  ok(lib.segDescribe([]) === "All traffic (neutral test)", "plain words: no rows = all traffic");
  const H = lib.HIST(), idx = lib.segLeads(seg); let manual = 0;
  for (let i = 0; i < H.n; i++) { const g = c => lib.callVal(H, i, 0, c); if ((g("hl_type") === "UA" || g("hl_type") === "PNSM") && g("legal_status") === "Proprietorship" && g("vertical") === "Top Cities - Inhouse") manual++; }
  ok(idx.length === manual && manual > 0, "AND between rules, OR within a rule: the matched leads equal a hand count", { idx: idx.length, manual });
  ok(JSON.stringify(lib.segList(seg).map(r => r.column)) === '["hl_type","legal_status","vertical"]' && lib.segList(seg)[0].factor === "HL Type", "saved JSON: [{factor, column, values}] in catalog order"); }

/* ---- caps */
{ const w = { guards: [1, 2, 3].map(() => ({ key: "duration_s" })), secondary: [1, 2, 3, 4, 5].map(() => ({ key: "answered_pct" })) };
  ok(lib.roleFull(w, "guardrail") && lib.roleFull(w, "secondary") && !lib.roleFull({ guards: [1, 2], secondary: [] }, "guardrail") && !lib.roleFull({ guards: [], secondary: [1, 2, 3, 4] }, "secondary"), "caps: 3 guardrails and 5 secondary metrics"); }

/* ---- the previews equal an independent SQL query on the same rows */
for (const c of fx.sql_cases) {
  if (c.kind === "volume") { const v = lib.audienceVolume(c.segment); ok(v.connected === c.connected && near(v.perDay, c.connected / 30), `SQL check: ${c.name}`, { js: v.connected, sql: c.connected }); continue; }
  const m = c.metric.key ? M(c.metric.key) : c.metric, e = lib.metricEval(m, c.segment);
  ok(e.num === c.num && e.den === c.den && near(e.value, c.value), `SQL check: ${c.name}`, { js: [e.num, e.den, e.value], sql: [c.num, c.den, c.value] });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
