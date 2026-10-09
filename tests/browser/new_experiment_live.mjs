// Downstream check through the LIVE engine: launch (1) a custom RATE primary with a custom AVERAGE guardrail and custom secondaries on a segment,
// and (2) a custom AVERAGE primary; confirm the config is saved and locked, then that Live, History, the final report and the Prompt Library render
// the audience, the metrics, prompt B and the diff. Usage: node new_experiment_live.mjs http://127.0.0.1:8765/ <screenshot dir>
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const [url, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1366, height: 900 });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
const canon = x => JSON.stringify(x, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(q => [q, v[q]])) : v);   // key order does not matter (the record keeps keys sorted)
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, name, info) => { if (c) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 500) : '')); } };
const shot = n => p.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const body = () => p.evaluate(() => document.querySelector('#page').innerText);
await p.goto(url + '#/overview', { waitUntil: 'load' }); await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'load' }); await sleep(800);

const C1 = { key: 'custom_meeting_or_callback', name: 'Meeting or callback', type: 'rate', direction: 'higher', group: 'Custom', num: { unit: 'leads', where: [{ col: 'disposition', op: 'in', values: ['Meeting Fixed', 'Callback Fixed'] }] }, den: { unit: 'leads', where: [{ col: 'connected', op: 'is', values: ['1'] }] } };
const C2 = { key: 'custom_talk_time_per_lead', name: 'Talk time per lead', type: 'average', direction: 'lower', group: 'Custom', col: 'call_duration', unit: 'leads', where: [{ col: 'connected', op: 'is', values: ['1'] }] };
const C3 = { key: 'custom_busy_share', name: 'Busy share of unanswered calls', type: 'rate', direction: 'lower', group: 'Custom', num: { unit: 'calls', where: [{ col: 'call_status', op: 'is', values: ['Busy'] }] }, den: { unit: 'calls', where: [{ col: 'call_status', op: 'is_not', values: ['Answered'] }] } };

async function launch(name, state) {
  await p.evaluate((name, state, defs) => {
    DYN.settings.customMetrics = defs; saveDyn();
    const A = liveA().text; WZ = { ...wzDefaults(), name, promptB: A.replace('quantity = 3', 'quantity = 2'), audienceSet: true, ...state, step: 6, ui: {} }; go('new'); route();
  }, name, state, [C1, C2, C3]); await sleep(800);
  const chk = await p.$$eval('#w-checks .check', c => c.map(x => x.className.includes(' ok')));
  ok(chk.every(Boolean), `${name}: every pre-launch check passes`, await p.$eval('#w-checks', e => e.innerText));
  await p.click('#w-launch'); await p.waitForFunction(() => location.hash.startsWith('#/live/'), { timeout: 240000 }); await sleep(1200);
  return p.evaluate(() => { const e = DYN.launched[0]; return { id: e.id, config: e.record.config, hash: e.record.config_hash, created: JSON.parse(e.record.ledger[0].body).payload, result: e.record.result, prompt: (e.prompt_b || '').length, cur: e.record.looks[e.record.looks.length - 1] }; });
}

/* 1: a custom rate primary, a custom average guardrail, custom secondaries, on a segment */
const r1 = await launch('Custom rate primary (live check)', { segRows: [{ column: 'hl_type', values: ['UA', 'PNSM'] }], primary: C1.key,
  guards: [{ key: 'duration_s', direction: 'lower', limit: { value: 10, kind: 'rel' } }, { key: C2.key, direction: 'lower', limit: { value: 10, kind: 'rel' } }], secondary: [{ key: C3.key, direction: 'lower' }, { key: 'answered_pct', direction: 'higher' }],
  share: 0.3, preset: 'custom', effectRel: 40, seed: 11 });
const m1 = r1.config.metrics || [];
ok(m1.length === 5 && m1[0].role === 'primary' && m1[0].def.name === 'Meeting or callback' && m1.some(x => x.role === 'guardrail' && x.def.type === 'average' && x.limit.value === 10 && x.limit.kind === 'rel') && m1.filter(x => x.role === 'secondary').length === 2, 'config: all metric definitions (role, formula, direction, limit) are saved', m1.map(x => [x.role, x.def.name, x.limit]));
ok(r1.config.config_locked !== false && r1.created.config_locked === true && r1.hash && r1.config.version === 1 && canon(r1.created.config.metrics) === canon(r1.config.metrics) && r1.created.config_hash === r1.hash, 'config: locked at launch, with its hash and version, and the metrics are inside the locked config');
ok(JSON.stringify(r1.config.segment) === JSON.stringify([{ factor: 'HL Type', column: 'hl_type', values: ['UA', 'PNSM'] }]), 'config: the segment is saved as [{factor, column, values}]', r1.config.segment);
ok(r1.prompt > 100000, 'the full prompt B text is kept with the test');
ok(r1.cur.metrics && r1.cur.metrics.length === 5 && r1.cur.metrics.every(x => x.A && x.B), 'engine: every look carries all five metrics for A and B');
let t = await body();
ok(t.includes('Leads where HL Type is UA or PNSM') && /100% of counted leads matched this rule/.test(t), 'Live: audience in words and "100% of counted leads matched this rule"');
ok(t.includes('Talk time per lead (guardrail)') && t.includes('Secondary (for insight only, not used for the decision)') && t.includes('Busy share of unanswered calls'), 'Live: the custom guardrail tile and the Secondary section');
await shot('live1');
if (await p.$('#a-end')) { await p.click('#a-end'); await sleep(1200); }
t = await body(); ok(/Promoted|Inconclusive|Held|Stopped|Keep A/.test(t), 'Live: the engine decides on the last day', t.slice(0, 200)); await shot('live1_end');
await p.evaluate(id => { location.hash = '#/report/' + id; }, r1.id); await sleep(1000); t = await body();
ok(t.includes('Metrics') && t.includes('Meeting or callback') && t.includes('must not rise by more than 10%') && t.includes('Secondary (for insight only, not used for the decision)') && /Prompt B[\s\S]*added/.test(t) && /100% of counted leads matched this rule/.test(t) && !/patch/i.test(t), 'Report: metrics with limits, the Secondary section, prompt B with its diff, the audience line; no "patch" wording');
ok(!!(await p.$('.report .diff2')), 'Report: the A-vs-B diff is drawn'); await shot('report1');
await p.evaluate(() => { location.hash = '#/history'; }); await sleep(800); t = await body();
ok(t.includes('Custom rate primary (live check)') && t.includes('HL Type: UA, PNSM'), 'History: the test is listed with its audience'); await shot('history');

/* 2: a custom average primary (lower is better) */
await p.evaluate(() => { location.hash = '#/overview'; }); await sleep(500);
const r2 = await launch('Custom average primary (live check)', { segRows: [], primary: C2.key, guards: [{ key: 'early_hangup', direction: 'lower', limit: { value: 2, kind: 'pts' } }], secondary: [{ key: 'buylead_created', direction: 'higher' }], share: 0.3, preset: 'win', effectRel: 15, seed: 5 });
ok(r2.config.primary_type === 'average' && r2.config.metrics[0].def.type === 'average' && r2.config.primary_sd > 0 && r2.config.baseline > 20, 'config: an average primary is saved with its baseline and spread from data', { b: r2.config.baseline, sd: r2.config.primary_sd });
t = await body(); ok(/A: Talk time per lead\s+[\d.]+ s/.test(t) && /Lift of B over A[\s\S]{0,40}[▲▼] [+−][\d.]+ s/.test(t), 'Live: an average primary is shown in seconds', t.slice(t.indexOf('A: Talk'), t.indexOf('A: Talk') + 200));
await shot('live2'); if (await p.$('#a-end')) { await p.click('#a-end'); await sleep(1200); }
await p.evaluate(id => { location.hash = '#/report/' + id; }, r2.id); await sleep(1000); t = await body();
ok(/Average/.test(t) && / s to [\d.]+ s/.test(t) && t.includes('Early hang-ups') && t.includes('Secondary (for insight only, not used for the decision)'), 'Report: an average primary in seconds, its guardrail and secondary'); await shot('report2');
const k2 = await p.evaluate(() => view(DYN.launched[0]).kind); console.log('decision 2:', k2);

/* Prompt Library: a promoted test's version shows prompt B in full and the diff */
const promoted = await p.evaluate(() => promotedExperiments().map(x => x.e.id));
await p.evaluate(() => { location.hash = '#/library'; }); await sleep(800);
const vers = await p.$$eval('tr[data-ver]', r => r.map(x => x.dataset.ver));
if (vers.length > 1) { await p.click(`tr[data-ver="${vers[0]}"]`); await sleep(600); }
t = await body(); ok(t.includes('Show the full prompt') && !!(await p.$('#page .diff2')) && !/patch|lint-derived/i.test(t), 'Prompt Library: full prompt and diff for the selected version; no patch or lint wording', { vers, promoted });
await shot('library');
console.log(`${pass} passed, ${fail} failed; page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
await b.close(); process.exit(fail || errs.length ? 1 : 0);
