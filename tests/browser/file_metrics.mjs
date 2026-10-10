// The custom metric builder on the real columns of the data files (needs the local server: python -m canary serve --port PORT).
// Usage: node tests/browser/file_metrics.mjs http://127.0.0.1:PORT/
// Checks: the Column picker lists the file's columns grouped by file with type tags and a search box; operators follow the column type;
// "Calls over 3 min %" and "Average call duration" preview on the file; a rate is saved as a secondary metric and an average as the primary goal,
// and Duration plans on the file's baseline; Sum is refused as a primary goal; Settings lists the data files with Rescan.
import puppeteer from "puppeteer-core";

const url = process.argv[2];
if (!url || !/^https?:/.test(url)) { console.error("usage: node file_metrics.mjs http://127.0.0.1:PORT/"); process.exit(2); }
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 1000 });
const errors = []; p.on("pageerror", e => errors.push(String(e))); p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
p.on("dialog", d => d.accept());
let pass = 0, fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log("  ok  ", what); } else { fail++; console.log("  FAIL", what); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const prev = () => p.$eval("#w-cmprev", e => e.textContent).catch(() => "");
const waitPrev = async re => { for (let i = 0; i < 30; i++) { const t = await prev(); if (re.test(t)) return t; await wait(300); } return prev(); };
const pick = async (id, col) => { await p.click(`[data-fcpick="${id}"] summary`); await wait(150); await p.click(`[data-fccol="${id}"][data-col="${col}"]`); await wait(400); };

await p.goto(url + "#/overview", { waitUntil: "load" }); await p.evaluate(async () => { await fetch("/api/store/reset", { method: "POST", headers: { "X-Canary-Store": "1" }, body: "{}" }).catch(() => 0); }); await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: "load" }); await wait(1200);
await p.evaluate(() => { location.hash = "#/new"; }); await wait(600);
await p.click("[data-idea]"); await wait(500);
for (let s = 1; s < 4; s++) { await p.click("#w-next"); await wait(450); }
ok(await p.evaluate(() => WZ.step) === 4, "Step 4 Goals");

console.log("Secondary: Calls over 3 min % (a rate)");
await p.click("#w-addm"); await wait(300); await p.click('[data-ptab="custom"]'); await wait(400);
ok(!!(await p.$("#w-cm[data-fc]")), "the builder reads the data files' columns");
await p.click('[data-fcpick="num:0"] summary'); await wait(200);
const cols = await p.$$eval('[data-fccol="num:0"]', bs => bs.map(x => [x.dataset.col, x.querySelector(".ttag").textContent, x.disabled]));
ok(cols.length >= 20 && cols.some(c => c[0] === "lead_call_duration" && c[1] === "number") && cols.some(c => c[0] === "redis_bucket" && c[1] === "category") && cols.some(c => c[0] === "call_start_time" && c[1] === "date"), `every column, with its type tag (${cols.length})`);
ok(cols.filter(c => c[1] === "id").every(c => c[2]) && cols.some(c => c[0] === "client_number" && c[1] === "id"), "ID columns (the phone number too) cannot be counted");
ok(await p.$eval('[data-fcpick="num:0"] .mgroup-h', e => /dtl table data\.csv/.test(e.textContent)), "grouped by file");
await p.type('[data-fcq="num:0"]', "durat"); await wait(200);
ok(await p.$$eval('[data-fccol="num:0"]', bs => bs.filter(x => !x.hidden).map(x => x.dataset.col).join()) === "lead_call_duration", "the search box filters the columns");
await p.click('[data-fccol="num:0"][data-col="lead_call_duration"]'); await wait(400);
ok((await p.$$eval('[data-fcop="num:0"] option', os => os.map(o => o.textContent).filter(Boolean).join(" "))) === "Comparison = ≠ > ≥ < ≤ between", "number operators");
await p.select('[data-fcop="num:0"]', ">"); await wait(300);
await p.$eval('[data-fcv="num:0"]', e => { e.value = "180"; e.dispatchEvent(new Event("change", { bubbles: true })); }); await wait(300);
await p.click('input[name="w-fcden"][value="custom"]'); await wait(400);
await pick("den:0", "lead_call_status");
ok((await p.$$eval('[data-fcop="den:0"] option', os => os.map(o => o.textContent).filter(Boolean).join(" "))) === "Comparison is is not is one of", "category operators");
await p.select('[data-fcv="den:0"]', "Answered"); await wait(300);
await p.$eval("#w-cmname", e => { e.value = "Calls over 3 min %"; e.dispatchEvent(new Event("input", { bubbles: true })); }); await wait(500);
const t1 = await waitPrev(/=\s*2\.1%/);
ok(/334 ÷ 15,582 = 2\.1%/.test(t1), `live preview: ${t1.slice(0, 160)}`);
await p.click('[data-prole="secondary"]').catch(() => 0); await wait(200);
await p.click("#w-padd"); await wait(500);
ok(/Calls over 3 min %/.test(await p.$eval("main", e => e.innerText)), "saved as a secondary metric card");

console.log("Primary: Average call duration");
await p.select("#w-primary", "__custom"); await wait(500);
await p.click('[data-fctype="average"]'); await wait(400);
await pick("col", "lead_call_duration");
await p.click('[data-fcadd="where"]'); await wait(300);
await pick("where:0", "lead_call_status");
await p.select('[data-fcv="where:0"]', "Answered"); await wait(300);
await p.$eval("#w-cmname", e => { e.value = "Average call duration"; e.dispatchEvent(new Event("input", { bubbles: true })); }); await wait(500);
const t2 = await waitPrev(/41\.2 s/);
ok(/average 41\.2 s over 15,582 calls/.test(t2), `average preview: ${t2.slice(0, 160)}`);
await p.click("#w-cmsavep"); await wait(600);
ok(await p.evaluate(() => WZ.primary && metricByKey(WZ.primary, WZ.localMetrics).source === "file"), "the primary goal is the file metric");
ok(await p.evaluate(() => { const m = metricByKey(WZ.primary, WZ.localMetrics); return m.file === "dtl table data.csv" && m.col === "lead_call_duration" && m.where[0].col === "lead_call_status" && m.where[0].op === "is" && Math.abs(m.base.value - 41.24) < 0.01; }), "the full definition (file, column, operator, value) and its baseline are saved");
await p.click("#w-next"); await wait(600);
const s5 = await p.$eval("main", e => e.innerText);
ok(/41\.2/.test(s5) && /days/.test(s5), "Duration plans on the file's baseline");

console.log("Sum, validation, Settings");
await p.click('[data-step="4"]').catch(() => 0); await wait(500);
await p.select("#w-primary", "__custom"); await wait(500);
await p.click('[data-fctype="sum"]'); await wait(300);
ok(/cannot decide a test/.test(await p.$eval("#w-cm", e => e.innerText)), "Sum: the builder says it cannot decide a test");
await p.click('[data-fctype="rate"]'); await wait(300);
await pick("num:0", "lead_call_status"); await p.select('[data-fcv="num:0"]', "Answered"); await wait(300);
await p.click('input[name="w-fcden"][value="custom"]'); await wait(300);
await pick("den:0", "lead_call_duration"); await p.select('[data-fcop="den:0"]', ">"); await wait(200);
await p.$eval('[data-fcv="den:0"]', e => { e.value = "100000"; e.dispatchEvent(new Event("change", { bubbles: true })); }); await wait(300);
await p.$eval("#w-cmname", e => { e.value = "Zero den"; e.dispatchEvent(new Event("input", { bubbles: true })); }); await wait(500);
ok(/denominator is 0/i.test(await waitPrev(/denominator/i)), "validation: a denominator of 0 is refused");
await p.evaluate(() => { location.hash = "#/settings"; }); await wait(600);
await p.evaluate(() => document.querySelectorAll("details.fold").forEach(d => d.open = true)); await wait(200);
ok(/Data files/.test(await p.$eval("main", e => e.innerText)) && !!(await p.$("#s-rescan")), "Settings > Metric list: Data files and Rescan files");
await p.click("#s-rescan"); await wait(1500);
ok(await p.evaluate(() => [...document.querySelectorAll(".toast")].some(t => /1 file, \d+ columns/.test(t.textContent))), "Rescan re-reads the folder");
ok(errors.length === 0, `no page errors (${errors.length}${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""})`);
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
