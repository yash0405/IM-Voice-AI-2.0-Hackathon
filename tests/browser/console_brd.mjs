// The second BRD's screens, offline: segment builder, goals, checklist, Save/Launch, split health, holdback, traffic map, A vs A in the browser.
// Usage: node tests/browser/console_brd.mjs "file://$PWD/dist/canary_demo.html"      (exit code 1 if any check fails)
import puppeteer from 'puppeteer-core';
import fs from 'fs'; fs.mkdirSync('/tmp/canary_shots', { recursive: true });
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const sleep = ms => new Promise(r => setTimeout(r, ms)); const errs = [], fails = [];
const p = await b.newPage(); await p.setViewport({ width: 1360, height: 900 });
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); }); p.on('dialog', d => d.accept());
const url = process.argv[2];
const txt = s => p.$eval(s, e => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '(missing)');
const click = async s => { await p.click(s); await sleep(300); };
const go = async h => { await p.evaluate(x => { location.hash = x; }, h); await sleep(400); };
const check = (name, ok, extra = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); if (!ok) fails.push(name); };
await p.goto(url + '#/overview', { waitUntil: 'load' }); await p.evaluate(() => localStorage.clear()); await p.reload(); await sleep(600);

// ---- overview blocks
const tiles = await p.$$eval('.g4 .card .k', e => e.map(x => x.innerText));
check('overview tiles are the BRD four', ['Running tests', 'Waiting for approval', 'Harm alerts', 'Completed this month'].every((t, i) => tiles[i] === t), tiles.join(' / '));
const h2s = await p.$$eval('.card h2', e => e.map(x => x.innerText));
for (const t of ['Business impact', 'Live prompt', 'Needs attention', 'Traffic map', 'Recent decisions', 'Scorecard', 'Top suggestion']) check('overview has ' + t, h2s.includes(t));
check('five scenario tests are running', (await p.$$('.g3 > .card')).length === 5);
check('running cards show the lift grey and interim', (await p.$$eval('.g3 > .card .kpi .v', e => e.length > 0 && e.every(x => getComputedStyle(x).color.includes('160')))) );
await click('#aa-run'); await sleep(3500); const aa = await txt('#aa-out');
const rates = [...aa.matchAll(/(\d+\.\d)% (\d+) of 1,000/g)].map(m => +m[1]);
check('A vs A in the browser: false winner under 5% and either-way under 8%', rates.length >= 3 && rates[0] < 5 && rates[2] < 8, aa.slice(100, 260));

// ---- wizard: segment builder, goals, checklist, draft, launch (every step in detail: tests/browser/new_experiment_e2e.mjs)
const openMs = async id => { await p.evaluate(id => { const d = document.querySelector(`details[data-ms="${id}"]`); if (d && !d.open) d.querySelector('summary').click(); }, id); await sleep(200); };
await go('#/new'); await p.type('#w-name', 'Proprietors, ask twice'); await click('#w-next');
await p.evaluate(() => { const t = document.querySelector('#w-b'); t.value = t.value.replace('quantity = 3', 'quantity = 2'); t.dispatchEvent(new Event('input')); }); await sleep(500); await click('#w-next');
await click('#w-segadd'); await p.select('select[data-segcol="0"]', 'legal_status'); await sleep(300); await openMs('seg-0'); await click('input[data-msv="seg-0"][value="Proprietorship"]');
check('the builder shows the rule in plain words', (await txt('#w-segrule')).includes('Leads where Legal Status is Proprietorship'), await txt('#w-segrule'));
check('in-call variables cannot pick leads', !(await p.$$eval('select[data-segcol="0"] option', o => o.some(x => x.value === 'disposition' || x.value === 'call_duration'))));
await click('#w-next'); check('goals: empty primary, a duration guardrail with a remove button', (await p.$eval('#w-primary', e => e.value)) === '' && (await p.$$('[data-mdel="guardrail:0"]')).length === 1);
await p.select('#w-primary', 'buylead_created'); await sleep(300);
await click('[data-mdel="guardrail:0"]'); check('a guardrail card can be removed', (await p.$$('[data-mcard^="guardrail"]')).length === 0);
await click('#w-addm'); await click('input[name=w-pick][value="duration_s"]'); await click('#w-padd'); check('a guardrail card can be added', (await p.$$('[data-mcard^="guardrail"]')).length === 1);
await click('#w-next'); await p.select('#w-len', 'custom'); await sleep(300); const dayOpts = await p.$$eval('#w-cdays option', e => e.map(x => x.value).join(','));
check('durations are whole weeks 7 to 28', dayOpts === '7,14,21,28', dayOpts); await p.select('#w-len', 'rec'); await sleep(300);
await click('#w-next'); check('pre-launch checklist has six checks, all passing', (await p.$$('#w-checks .check.ok')).length === 6, await txt('#w-checks'));
await click('#w-save'); check('Save Test keeps a draft', (await txt('.card h3')).includes('Saved drafts'));
await go('#/overview'); check('the draft shows under Needs attention', (await txt('.card:has(h2)')).length > 0 && (await p.$$eval('.pill', e => e.some(x => x.innerText === 'Draft'))));
await go('#/new'); await p.evaluate(() => document.querySelector('[data-draft]').click()); await sleep(300);
for (let i = 0; i < 5; i++) { if (await p.$('#w-next')) await click('#w-next'); }
await p.evaluate(() => { document.querySelector('[data-preset="win"]').click(); }); await sleep(250);
await p.$eval('#w-start', e => { e.value = '2026-10-12'; e.dispatchEvent(new Event('change')); }); await sleep(400);
check('a later start date makes the launch scheduled', (await txt('#w-launch')).includes('scheduled'));
await click('#w-launch'); await sleep(600);
check('a scheduled test shows Start now and cannot advance', !!(await p.$('#a-start')) && !(await p.$('#a-adv')), await txt('.exp-head .sub'));
await click('#a-start'); check('Start now runs it', !!(await p.$('#a-adv')));
// overlap: a second launch on the same leads is refused
await go('#/new'); await p.evaluate(() => { WZ = null; DYN.ui.wizard = null; }); await go('#/new'); await p.type('#w-name', 'Second test'); await click('#w-next');
await p.evaluate(() => { const t = document.querySelector('#w-b'); t.value = t.value + '\nOne more line.\n'; t.dispatchEvent(new Event('input')); }); await sleep(500); await click('#w-next'); await click('#w-next');
await p.select('#w-primary', 'buylead_created'); await sleep(300); await click('#w-next'); await click('#w-next');
const ov = await p.$$eval('#w-checks .check', e => e.map(x => x.classList.contains('ok')));
check('a test on the same leads is refused (overlap)', ov[5] === false && await p.$eval('#w-launch', e => e.disabled), JSON.stringify(ov));

// ---- live: the segmented scenario, split health, holdback
await go('#/live/demo_segment'); check('segment chips in the header', (await txt('.exp-head')).includes('Legal Status: Proprietorship'));
for (let i = 0; i < 6; i++) { if (await p.$('#a-adv')) await click('#a-adv'); }
const sh = await txt('#split-health');
check('split health: chi-square, both prompts = 0, balance table, segment check', ['chi-square p', 'Leads that saw both prompts', 'balanced by design', '100% of counted leads matched this rule', 'Out of segment'].every(t => sh.includes(t)));
check('by-call share counts only routed calls', /By call.*achieved (29|30|31)\.\d%/.test(sh.replace('B share by call (repeat calls included)', 'By call')) || sh.includes('achieved 30') || sh.includes('achieved 29') || sh.includes('achieved 31'), sh.slice(120, 330));
check('holdback card appears after a promotion', !!(await p.$('#a-hold')));
await click('#a-hold-all'); check('holdback plays out with a plain verdict', (await txt('body')).includes('Holdback finished'));
await go('#/overview'); check('business impact appears after a promotion', (await txt('.card:has(h2)')).length > 0 && (await p.$$eval('.card .v', e => e.some(x => /^\+\d/.test(x.innerText)))));
check('traffic map has one bar per running test', (await p.$$('.tmrow')).length >= 4);
// ---- stopped / loss wording
await go('#/live/demo_worse'); for (let i = 0; i < 6; i++) { if (await p.$('#a-adv')) await click('#a-adv'); }
check('B worse stops early', (await txt('.banner')).startsWith('Stopped: B worse'));
await go('#/settings'); check('settings shows the variable catalog with the pre-call flag', (await txt('body')).includes('Known before the call?') && (await p.$$('[data-pre]')).length === 8);
await go('#/history'); check('history has a segment filter with the segment', (await p.$$eval('#h-seg option', e => e.map(x => x.innerText))).some(t => t.includes('Leads where Legal Status is Proprietorship')));
check('no browser errors', errs.length === 0, errs.join(' | '));
await b.close(); if (fails.length) { console.log('\n' + fails.length + ' check(s) failed'); process.exit(1); } console.log('\nall checks passed');
