// All experiments (Live Experiments + History merged) and the time-control clean-up, in headless Chrome.
// Usage: node tests/browser/all_experiments.mjs "file://$PWD/dist/canary_demo.html"
import puppeteer from "puppeteer-core";

const url = process.argv[2];
if (!url) { console.error("usage: node all_experiments.mjs <url>"); process.exit(2); }
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
const errors = []; p.on("pageerror", e => errors.push(String(e))); p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
p.on("dialog", d => d.accept());
let pass = 0, fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log("  ok  ", what); } else { fail++; console.log("  FAIL", what); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const open = async h => { await p.evaluate(x => { location.hash = x; }, h); await wait(450); };
const text = () => p.evaluate(() => document.querySelector("main").innerText);
const hash = () => p.evaluate(() => location.hash);
await p.goto(url + "#/overview", { waitUntil: "load" }); await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: "load" }); await wait(900);

console.log("Menu and Overview");
const nav = await p.$$eval("#nav > a", as => as.map(a => a.textContent.trim()));
ok(nav.some(x => /^All experiments\d+$/.test(x)) && !nav.some(x => /Live Experiments|^History/.test(x)), `one "All experiments" item (${nav.join(", ")})`);
ok(await p.$eval('#nav a[href="#/experiments"] .count', x => x.textContent) === "6", "badge = 6 running tests");
ok((await p.$$(".tiles .tile")).length === 3 && !/Waiting for approval/.test(await text()), "Overview: three tiles, no approval tile");
ok(!(await p.$("[data-adv]")), "no Advance 1 day on the running cards");
ok(await p.$$eval("main h2", hs => hs.map(h => h.textContent.trim()).join("|")) === "Running tests" && !(await p.$("main .lp, main #aa-chart, main .sugg1, main .stack")), "Overview: nothing below Running tests (no Live prompt, Scorecard, A vs A, traffic split, decisions, suggestion)");
ok(await p.$$eval(".rcard a", as => as.every(a => !a.getAttribute("href").startsWith("#/live/"))), "cards link to #/experiments/<id>");
await p.click("#clk-next"); await wait(400);
ok(await p.evaluate(() => [...document.querySelectorAll(".toast")].some(t => /^Day advanced for 6 running tests\./.test(t.textContent))), "Next day toast: Day advanced for 6 running tests.");

console.log("Old routes redirect");
await open("#/live"); ok(/^#\/experiments\?status=running$/.test(await hash()), "#/live → #/experiments?status=running");
await open("#/history"); ok(/^#\/experiments\?status=finished$/.test(await hash()), "#/history → #/experiments?status=finished");
ok(await p.$$eval(".xtable tbody tr", rs => rs.length > 0 && rs.every(r => !/Running|Draft|Paused|Scheduled/.test(r.cells[0].textContent))), "finished filter shows only finished tests");
await open("#/live/demo_win"); ok((await hash()) === "#/experiments/demo_win", "#/live/<id> → #/experiments/<id>");

console.log("List page");
await open("#/experiments");
const heads = await p.$$eval(".xtable thead th", t => t.map(x => x.textContent.replace(/[▲▼]/g, "").trim()));
ok(heads.join("|") === "Status|Test name|Progress|Audience|Primary metric|A vs B|Lift (range)|Guardrails|Actions", `columns (${heads.join(" | ")})`);
const st = await p.$$eval(".xtable tbody tr", rs => rs.map(r => r.cells[0].textContent.trim()));
ok(st.slice(0, 6).every(x => x === "Running"), "running tests first (default sort)");
ok(/Day \d+ of \d+/.test(await p.$eval(".xtable tbody tr", r => r.cells[2].textContent)), "running progress: Day N of M with a bar");
ok(!!(await p.$("#x-q")) && !!(await p.$("#x-st")) && !!(await p.$("#x-dt")) && !!(await p.$("#x-met")) && !!(await p.$("#x-aud")) && !!(await p.$("#x-src")) && !!(await p.$("#x-clear")), "filter bar: search, status, date, metric, audience, source, clear");
ok(await p.$eval(".xfilters", f => { const r = [...f.children].map(c => c.getBoundingClientRect()); return r.every(x => x.top < r[0].bottom && Math.abs(x.bottom - r[0].bottom) < 2); }), "filters on one line at 1440 px");
const chips = await p.$$eval(".st-chip", cs => cs.map(c => c.textContent.trim()));
ok(chips.some(c => /^Running 6$/.test(c)), `status chips with counts (${chips.join(" · ")})`);
await p.evaluate(() => [...document.querySelectorAll(".st-chip")].find(c => /^Running/.test(c.textContent)).click()); await wait(400);
ok(/status=running/.test(await hash()) && (await p.$$(".xtable tbody tr")).length === 6, "a chip filters, and the filter is in the URL");
await p.reload({ waitUntil: "load" }); await wait(700);
ok((await p.$$(".xtable tbody tr")).length === 6, "the filter survives a reload (kept in the URL)");
await p.click("#x-clear"); await wait(400);
await p.click('[data-esort="name"]'); await wait(400);
const names = await p.$$eval(".xtable tbody tr", rs => rs.map(r => r.cells[1].querySelector("a").textContent.toLowerCase()));
ok(/sort=name/.test(await hash()) && names.every((x, i) => !i || names[i - 1] <= x), "a column sorts, and the sort is in the URL");
await p.select("#x-src", "file"); await wait(400);
ok(await p.$$eval(".xtable tbody tr", rs => rs.length > 0 && rs.every(r => /From file/.test(r.cells[1].textContent))), "source filter: From file");
await p.click("#x-clear"); await wait(400);
await p.type("#x-q", "warmer"); await wait(900);
ok(await p.$$eval(".xtable tbody tr", rs => rs.length >= 1 && rs.every(r => /warmer/i.test(r.cells[1].textContent))), "search by name");
await p.click("#x-clear"); await wait(400);
ok(!!(await p.$("#x-csv")) && !!(await p.$("#clk-next")) && !!(await p.$("#clk-play")), "Export CSV and the clock in the page header");
const total = +(await p.$eval(".pager span", s => s.textContent.match(/\d+/)[0]));
ok((await p.$$(".xtable tbody tr")).length === Math.min(20, total), `20 rows a page (${total} tests)`);

console.log("A test's page");
await p.evaluate(() => [...document.querySelectorAll(".xtable tbody tr")].find(r => /Running/.test(r.cells[0].textContent)).cells[2].click()); await wait(500);
ok(/^#\/experiments\/demo_/.test(await hash()), "a row opens #/experiments/<id>");
ok(!(await p.$("#live-pick")) && /← All experiments/.test(await text()), "no dropdown; a back link instead");
ok(!!(await p.$("#a-pause")) && !!(await p.$("#a-stop")) && !(await p.$("#a-adv")) && !!(await p.$("#a-end")), "running: Pause and Stop; Skip to the end; no Advance this test 1 day");
await open("#/experiments/past_b_wins");
ok(!!(await p.$("#final-report")) && /Final report/.test(await text()) && !!(await p.$("#a-clone")), "finished: Final report at the top, with Clone");
ok(!(await p.$("#a-pause")) && !(await p.$("#a-stop")), "finished: read-only (no Pause or Stop)");
ok(!!(await p.$("#trend canvas")) && !!(await p.$("#split-health")) && !!(await p.$("#record")), "same detail below: trend, split health, decision record");
await p.click("#a-clone"); await wait(500);
ok((await hash()) === "#/new" && /\(re-run\)/.test(await p.$eval("#w-name", e => e.value)), "Clone opens New Experiment with the test loaded");

console.log("Drafts");
await p.evaluate(() => { WZ = { ...wzDefaults(), name: "Draft for the list test", step: 2 }; saveDraft(WZ); });
await open("#/experiments?status=draft");
ok(await p.$$eval(".xtable tbody tr", rs => rs.some(r => /Draft for the list test/.test(r.textContent) && /Draft/.test(r.cells[0].textContent))), "a saved draft is listed as Draft");
await p.evaluate(() => [...document.querySelectorAll(".xtable tbody tr")].find(r => /Draft for the list test/.test(r.textContent)).cells[2].click()); await wait(600);
ok((await hash()) === "#/new" && (await p.evaluate(() => WZ.name)) === "Draft for the list test", "a draft opens New Experiment with the draft loaded");

console.log("Links");
await open("#/log");
ok(await p.$$eval("main a", as => as.every(a => !/^#\/(live|report|history)/.test(a.getAttribute("href") || ""))), "Decision Log links point to #/experiments/<id>");
await open("#/library");
ok(await p.$$eval("main a", as => as.every(a => !/^#\/(live|report|history)/.test(a.getAttribute("href") || ""))), "Prompt Library links point to #/experiments/<id>");
for (const w of [1280, 1024, 390]) { await p.setViewport({ width: w, height: 900 }); await open("#/experiments"); ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no sideways page scroll at ${w} px`); }
ok(errors.length === 0, `no page errors (${errors.length}${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""})`);
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
