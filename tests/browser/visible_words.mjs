// Visible text of every screen (and every New Experiment step), searched for words the spec says must be gone.
import puppeteer from 'puppeteer-core';
const url = process.argv[2];
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const p = await b.newPage(); await p.setViewport({ width: 1366, height: 900 }); const sleep = ms => new Promise(r => setTimeout(r, ms));
await p.goto(url + '#/overview', { waitUntil: 'load' }); await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'load' }); await sleep(500);
const bad = /\bpatch(es)?\b|lint-derived|Suggested from your hypothesis|Use the suggestion|contradictions in the prompt/i, hits = [];
const scan = async where => { const t = await p.evaluate(() => document.body.innerText); const m = t.split('\n').filter(l => bad.test(l)); if (m.length) hits.push([where, m.slice(0, 3)]); };
for (const r of ['overview', 'live/demo_win', 'live/demo_segment', 'live/demo_hold', 'history', 'report/past_b_wins', 'report/files_b_wins', 'suggest', 'library', 'library/v1', 'log', 'settings', 'import']) { await p.goto(url + '#/' + r); await sleep(400); await scan(r); }
await p.goto(url + '#/new'); await sleep(300);
await p.evaluate(() => { WZ = { ...wzDefaults(), name: 'scan', promptB: liveA().text + '\nx\n', audienceSet: true, primary: 'buylead_created' }; }); 
for (let s = 1; s <= 6; s++) { await p.evaluate(s => { WZ.step = s; route(); }, s); await sleep(300); await scan('new step ' + s); }
await p.evaluate(() => { WZ.step = 4; WZ.panel = { role: 'guardrail', tab: 'list', direction: 'lower', limit: 10, kind: 'rel', q: '' }; route(); }); await sleep(300); await scan('new step 4 panel');
console.log(hits.length ? 'HITS ' + JSON.stringify(hits) : 'zero hits on every screen and every step'); await b.close();
