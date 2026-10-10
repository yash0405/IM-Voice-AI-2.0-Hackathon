// The autopilot on the spec's screens, end to end in headless Chrome (offline page, or the live server).
// Usage: node tests/browser/autopilot_journey.mjs "file://$PWD/dist/picky_demo.html"        or   http://127.0.0.1:PORT/
// Checks: the spec's menu is unchanged; Overview shows the autopilot, six running tests (A and B grey until decided) and the A vs A chart; one Play
// runs every demo test to its outcome; the autopilot keeps A on the unanswered held win and rolls back the win that slips in its holdback week;
// both actions verify in the hash-chained record and are named in the Decision Log; a person can still approve; with the rollback switched off the
// alert asks a person instead; a ready idea fills every wizard step and launches; charts are Chart.js canvases; no sideways scroll on a phone;
// no page errors on any screen.
import puppeteer from "puppeteer-core";

const url = process.argv[2];
if (!url) { console.error("usage: node autopilot_journey.mjs <url>"); process.exit(2); }
const LIVE = /^https?:/.test(url);
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1366, height: 900 });
const errors = []; p.on("pageerror", e => errors.push(String(e))); p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
p.on("dialog", d => d.accept());
let pass = 0, fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log("  ok  ", what); } else { fail++; console.log("  FAIL", what); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const open = async h => { await p.evaluate(x => { location.hash = x; }, h); await wait(450); };
const text = () => p.evaluate(() => document.querySelector("main").innerText);
const kinds = () => p.evaluate(() => Object.fromEntries(EXPS().filter(e => !isPast(e)).map(e => { const v = view(e); return [e.id, { kind: v.kind, auto: !!v.d.auto, autoRoll: !!v.d.autoRoll }]; })));
const fresh = async () => {
  if (LIVE) await p.evaluate(async () => { await fetch("/api/store/reset", { method: "POST", headers: { "X-Picky-Store": "1" }, body: "{}" }).catch(() => 0); });
  await p.goto(url + "#/overview", { waitUntil: "load" }); await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: "load" }); await wait(900);
};
const settle = async () => { await p.click("#clk-play"); for (let i = 0; i < 60; i++) { await wait(600); if (await p.evaluate(() => !pending() && !PLAYER)) break; } };

console.log("Overview");
await p.goto(url + "#/overview", { waitUntil: "load" }); await fresh();
const nav = await p.$$eval("#nav > a", as => as.map(a => a.textContent.trim().replace(/\d+$/, "")));
ok(["Overview", "New Experiment", "All experiments", "Suggest A/B Tests", "Prompt Library", "Decision Log", "Settings"].every(x => nav.includes(x)) && !nav.includes("History"), `the menu, with Live Experiments and History merged (${nav.join(", ")})`);
ok(/Autopilot on/.test(await text()) && /Rolls back if B slips/.test(await text()), "the autopilot strip says what it does");
ok((await p.$$(".rcard")).length === 6, "six running tests");
ok(await p.$$eval(".rcard", cs => cs.every(c => c.querySelectorAll(".ab-bar i.grey").length === 2)), "A and B are grey until the engine decides");
ok(!(await p.$("#aa-chart")) && !/Live prompt|Scorecard|Traffic split today|Recent decisions|Top suggestion|Why the verdicts/.test(await text()), "Overview ends after Running tests: no Live prompt, Scorecard, A vs A proof, traffic split, recent decisions or top suggestion");
ok((await text()).split(/\s+/).length < 450, `Overview is short (${(await text()).split(/\s+/).length} words; it was 815)`);

console.log("Play: the autopilot runs every test to its end");
await settle();
const k = await kinds();
ok(k.demo_win.kind === "PROMOTE", "B wins: promoted");
ok(k.demo_worse.kind === "STOP_HARM", "B worse: stopped early");
ok(k.demo_flat.kind === "INCONCLUSIVE", "flat: inconclusive");
ok(k.demo_segment.kind === "PROMOTE", "segment win: promoted for its segment");
ok(k.demo_hold.kind === "REJECTED" && k.demo_hold.auto, "held win with no answer: the autopilot kept A");
ok(k.demo_fade.kind === "ROLLED_BACK" && k.demo_fade.autoRoll, "win that slips after rollout: the autopilot rolled it back");

console.log("The record");
for (const id of ["demo_fade", "demo_hold"]) {
  await open("#/experiments/" + id); await p.click("#a-verify"); await wait(400);
  ok(/Chain intact/.test(await p.$eval("#verify-out", x => x.textContent)), `${id}: chain intact with the autopilot's entry`);
}
await open("#/experiments/demo_fade");
ok(/autopilot rolled B back/.test(await text()), "the test's page says the autopilot rolled B back");
ok(!!(await p.$("#trend canvas")), "the daily trend is a chart (Chart.js)");
ok((await p.$$(".dstrip .ds")).length >= 7, "the day strip shows every day of the test");
await open("#/log");
const logText = await p.evaluate(() => [...document.querySelectorAll("td.reason")].map(t => t.title).join("\n"));
ok(/Picky autopilot: holdback alert on day \d/.test(logText) && /Picky autopilot: no answer within 2 days/.test(logText), "the Decision Log names the autopilot and its reason");
await open("#/report/demo_hold");
ok(/autopilot kept A/.test(await text()), "the final report says the autopilot kept A");

console.log("A person can still decide; with the rollback off, the alert asks a person");
await fresh();
for (let i = 0; i < 5; i++) { await p.click("#clk-next"); await wait(300); }
ok(/Approval pending/.test(await text()), "Needs attention shows the held win");
await open("#/experiments/demo_hold"); await p.click("#a-approve"); await wait(300);
ok((await kinds()).demo_hold.kind === "PROMOTE", "Approve promotes it");
await fresh();
await open("#/settings"); await p.click("#ap-roll"); await wait(300);
ok(await p.evaluate(() => AP().rollback === false), "the rollback switch turns off");
await open("#/overview"); await settle();
ok((await kinds()).demo_fade.kind === "PROMOTE", "with the switch off the autopilot does not roll back");
ok(/Holdback alert/.test(await text()), "the holdback alert is under Needs attention instead");

console.log("New Experiment: same six steps, an idea fills them");
await fresh(); await open("#/new");
ok((await p.$$(".stepper .step")).length === 6, "six steps");
await p.click("[data-idea]"); await wait(500);
ok((await p.$eval("#w-name", e => e.value)).length > 0, "a ready idea fills the name");
for (let s = 1; s < 6; s++) { await p.click("#w-next"); await wait(450); }
ok(/all 6 pass/.test(await text()) && await p.$eval("#w-launch", e => !e.disabled), "step 6: all six checks pass and Launch is enabled");
await p.click("#w-launch");
for (let i = 0; i < 60 && !(await p.evaluate(() => location.hash)).startsWith("#/experiments/"); i++) await wait(500);
ok((await p.evaluate(() => location.hash)).startsWith("#/experiments/"), "Launch opens the new test's page");

console.log("Phone width, every screen");
await p.setViewport({ width: 390, height: 844 });
for (const h of ["#/overview", "#/experiments", "#/experiments/demo_win", "#/new", "#/settings"]) { await open(h); ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no sideways scroll at 390 px: ${h}`); }
await p.setViewport({ width: 1366, height: 900 });
for (const h of ["#/overview", "#/new", "#/experiments", "#/experiments/demo_win", "#/live", "#/history", "#/suggest", "#/library", "#/log", "#/settings", "#/import", "#/report/past_b_wins", "#/report/files_b_wins"]) await open(h);
ok(errors.length === 0, `no page errors (${errors.length}${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""})`);
if (LIVE) await fresh();                                           // leave the server's history as it was found: no launched test left running
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
