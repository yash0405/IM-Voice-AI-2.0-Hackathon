// The second BRD's screens, offline: segment builder, goal cards, checklist, Save/Launch, split health, holdback, traffic map, A vs A in the browser.
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

// ---- wizard: segment builder, goal cards, checklist, draft, launch
await go('#/new'); await p.type('#w-name', 'Mumbai proprietors'); await click('#w-next'); await click('#w-next');
await p.evaluate(() => document.querySelector('input[name=w-segmode][value=segment]').click()); await sleep(250);
await p.type('#w-segtext', 'Mumbai proprietors on UA and PNS leads'); await click('#w-segread');
check('plain English becomes the exact rule', (await txt('.banner .mono')) === 'City = Mumbai AND NOB = Proprietor AND HL IN (UA, PNS)', await txt('.banner .mono'));
check('calculator says the segment is too small', (await txt('.calc')).includes('Segment too small') && (await txt('.calc')).includes('Will not finish'));
await p.evaluate(() => { document.querySelector('#w-segtext').value = 'leads that answered the call'; }); await click('#w-segread');
check('an in-call variable is refused with a reason', (await txt('#w-segmsg')).includes('decided during the call'));
await p.evaluate(() => { document.querySelector('#w-segtext').value = 'proprietors but not UA'; }); await click('#w-segread');
check('"not UA" is read as an exclusion', (await txt('.banner .mono')) === 'NOB = Proprietor AND HL IN (PUA, ENQR, PNS)', await txt('.banner .mono'));
await p.evaluate(() => { document.querySelector('#w-segtext').value = 'proprietors'; }); await click('#w-segread');
await click('#w-next'); check('goal cards: one primary, a duration guardrail, a delete button', (await p.$$('.goal-card.primary')).length === 1 && (await p.$$('[data-del="duration_s"]')).length === 1);
await click('[data-del="duration_s"]'); check('a guardrail card can be removed', (await p.$$('[data-del="duration_s"]')).length === 0);
await p.select('#w-add', 'g:early_hangup'); await sleep(300); check('a guardrail card can be added', (await p.$$('[data-del="early_hangup"]')).length === 1);
await click('[data-del="early_hangup"]'); await p.select('#w-add', 'g:duration_s'); await sleep(300);
await click('#w-next'); const dayOpts = await p.$$eval('#w-days option', e => e.map(x => x.value).join(','));
check('durations are whole weeks 7 to 28', dayOpts === '7,14,21,28', dayOpts);
await click('#w-next'); check('pre-launch checklist has five checks, all passing', (await p.$$('#w-checks .check.ok')).length === 5);
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
await go('#/new'); await p.evaluate(() => { WZ = null; DYN.ui.wizard = null; }); await go('#/new'); await p.type('#w-name', 'Second test'); for (let i = 0; i < 5; i++) await click('#w-next');
const ov = await p.$$eval('#w-checks .check', e => e.map(x => x.classList.contains('ok')));
check('a test on the same leads is refused (overlap)', ov[4] === false && await p.$eval('#w-launch', e => e.disabled), JSON.stringify(ov));

// ---- live: the segmented scenario, split health, holdback
await go('#/live/demo_segment'); check('segment chips in the header', (await txt('.exp-head')).includes('NOB: Proprietor'));
for (let i = 0; i < 6; i++) { if (await p.$('#a-adv')) await click('#a-adv'); }
const sh = await txt('#split-health');
check('split health: chi-square, both prompts = 0, balance table, segment check', ['chi-square p', 'Leads that saw both prompts', 'balanced by design', '100% of counted leads match the rule', 'Out of segment'].every(t => sh.includes(t)));
check('by-call share counts only routed calls', /By call.*achieved (29|30|31)\.\d%/.test(sh.replace('B share by call (repeat calls included)', 'By call')) || sh.includes('achieved 30') || sh.includes('achieved 29') || sh.includes('achieved 31'), sh.slice(120, 330));
check('holdback card appears after a promotion', !!(await p.$('#a-hold')));
await click('#a-hold-all'); check('holdback plays out with a plain verdict', (await txt('body')).includes('Holdback finished'));
await go('#/overview'); check('business impact appears after a promotion', (await txt('.card:has(h2)')).length > 0 && (await p.$$eval('.card .v', e => e.some(x => /^\+\d/.test(x.innerText)))));
check('traffic map has one bar per running test', (await p.$$('.tmrow')).length >= 4);
// ---- stopped / loss wording
await go('#/live/demo_worse'); for (let i = 0; i < 6; i++) { if (await p.$('#a-adv')) await click('#a-adv'); }
check('B worse stops early', (await txt('.banner')).startsWith('Stopped: B worse'));
await go('#/settings'); check('settings shows the variable catalog with the pre-call flag', (await txt('body')).includes('Known before the call?') && (await p.$$('[data-pre]')).length === 3);
await go('#/history'); check('history has a segment filter with the segment', (await p.$$eval('#h-seg option', e => e.map(x => x.innerText))).some(t => t.includes('NOB = Proprietor')));
check('no browser errors', errs.length === 0, errs.join(' | '));
await b.close(); if (fails.length) { console.log('\n' + fails.length + ' check(s) failed'); process.exit(1); } console.log('\nall checks passed');
