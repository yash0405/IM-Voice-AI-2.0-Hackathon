// End-to-end check of the New Experiment page (#/new): Steps 2 to 6, "At a glance", Suggest A/B Tests pre-fill, with screenshots.
// Usage: node new_experiment_e2e.mjs <page url (file:// or http://)> <screenshot dir> [live]
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const [url, out, live] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const p = await b.newPage(); await p.setViewport({ width: 1366, height: 900 });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, name, info) => { if (c) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 400) : '')); } };
const shot = async n => p.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const txt = s => p.$eval(s, e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const click = async s => { await p.click(s); await sleep(250); };
const openMs = async id => { await p.evaluate(id => { const d = document.querySelector(`details[data-ms="${id}"]`); if (d && !d.open) d.querySelector('summary').click(); }, id); await sleep(200); };
const glance = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#glance dd[data-g]')].map(d => [d.dataset.g, d.textContent.trim()])));

await p.goto(url + '#/overview', { waitUntil: 'load' }); await p.evaluate(() => localStorage.clear());
await p.goto(url + '#/new'); await p.reload({ waitUntil: 'load' }); await sleep(400);
await p.evaluate(() => { C.file_catalog = { files: [], columns: [] }; });      // the builder without data files (the fallback); file_metrics.mjs covers the files' columns

/* Step 1 (unchanged) */
ok((await txt('#w-glance')).includes('Set audience and traffic to see estimates.'), 'At a glance: hidden until the audience is set');
await p.type('#w-name', 'Cap every ask at two (E2E)'); await shot('01_step1');
await click('#w-next');

/* Step 2: full prompt only */
ok((await txt('#w-main h2')) === '2. Prompt B', 'Step 2 title');
ok((await txt('#w-main .sub')).startsWith('Edit the full prompt B below; the diff and the variable check update as you type.'), 'Step 2 helper text');
const s2 = await p.evaluate(() => ({ toggle: !!document.querySelector('[data-mode]'), radios: document.querySelectorAll('input[name=w-var]').length, words: /patch|lint-derived|contradictions in the prompt/i.test(document.querySelector('#w-main').innerText),
  rows: +document.querySelector('#w-b').getAttribute('rows'), mono: getComputedStyle(document.querySelector('#w-b')).fontFamily, resize: getComputedStyle(document.querySelector('#w-b')).resize, same: document.querySelector('#w-b').value.length > 1000 }));
ok(!s2.toggle && !s2.radios && !s2.words, 'Step 2: no patch toggle, no patch cards, no patch/lint wording', s2);
ok(s2.rows >= 20 && /mono|Menlo|Consolas/i.test(s2.mono) && s2.resize !== 'none' && s2.same, 'Step 2: one large monospace resizable textarea, pre-filled with prompt A', s2);
ok((await txt('#w-diff')).includes('Prompt B is the same as A. Make a change to continue.'), 'Step 2: identical prompts say so');
ok(await p.$eval('#w-next', e => e.disabled), 'Step 2: Next is disabled while B = A');
ok((await txt('#w-vc')).includes('All variables kept'), 'Step 2: variable check passes on A');
ok((await txt('#w-bcount')).includes('characters'), 'Step 2: character count');
await click('#w-abox summary'); ok((await p.$eval('#w-aview textarea', e => e.readOnly && e.value.length > 1000).catch(() => false)), 'Step 2: "View current prompt (A)" is collapsed by default and read-only when opened');
ok((await txt('#w-abox summary')).includes('v1'), 'Step 2: prompt A shows its version');
await shot('02_step2_same');
// edit: replace a limit and add a line -> diff shows red and green, Next enabled
await p.evaluate(() => { const t = document.querySelector('#w-b'); t.value = t.value.replace('quantity = 3', 'quantity = 2') + '\nNever ask for the same detail more than twice.\n'; t.dispatchEvent(new Event('input')); }); await sleep(600);
const d2 = await p.evaluate(() => ({ add: document.querySelectorAll('#w-diff .diff .add').length, del: document.querySelectorAll('#w-diff .diff .del').length, next: document.querySelector('#w-next').disabled, vc: document.querySelector('#w-vc').innerText }));
ok(d2.add >= 2 && d2.del >= 1 && !d2.next && d2.vc.includes('All variables kept'), 'Step 2: side-by-side diff (green added, red removed) and Next enabled', d2);
await shot('03_step2_diff');
// drop a variable and add a new one -> amber warnings, Next blocked
await p.evaluate(() => { const t = document.querySelector('#w-b'); t.value = t.value.split('buyer_city').join('buyer_town'); t.dispatchEvent(new Event('input')); }); await sleep(600);
const v2 = await p.evaluate(() => ({ t: document.querySelector('#w-vc').innerText, next: document.querySelector('#w-next').disabled, amber: document.querySelectorAll('#w-vc .warnc').length }));
ok(v2.t.includes('Missing: {{buyer_city}}') && v2.t.includes('New variable not supplied by the bot: {{buyer_town}}') && v2.next && v2.amber === 2, 'Step 2: missing and new variables are amber and block Next', v2);
await shot('04_step2_variables');
await click('#w-save'); const drafts = await p.evaluate(() => DYN.drafts);
ok(await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('picky_console_v1')); return o.packed === 2 && Object.keys(o.texts).length >= 1; }), 'Storage: the big prompt text is stored once, by reference');
ok(drafts.length === 1 && drafts[0].w.promptB.includes('buyer_town'), 'Step 2: Save Test saves B as typed even when the checks fail');
ok((await p.$$eval('a[href="#/suggest"][target=_blank]', a => a.length)) === 1 && !(await p.$('#w-main [data-create]')), 'Step 2: "Need ideas?" link opens Suggest in a new view; no suggestion cards here');
await p.evaluate(() => { const t = document.querySelector('#w-b'); t.value = t.value.split('buyer_town').join('buyer_city'); t.dispatchEvent(new Event('input')); }); await sleep(600);
ok(!(await p.$eval('#w-next', e => e.disabled)), 'Step 2: fixed prompt enables Next again');
await click('#w-next');

/* Step 3: segment builder */
ok((await txt('#w-segrule')).includes('All traffic (neutral test)'), 'Step 3: no rows = all traffic (neutral test)');
const vol0 = await txt('#w-segline');
await click('#w-segadd'); await p.select('select[data-segcol="0"]', 'hl_type'); await sleep(300);
await openMs('seg-0');
ok(!!(await p.$('details[data-ms="seg-0"] [data-msall]')) && !!(await p.$('details[data-ms="seg-0"] .ms-q')), 'Step 3: values multi-select has "Select all" and a search box');
await p.type('details[data-ms="seg-0"] .ms-q', 'PNS'); await sleep(200);
const vis = await p.$$eval('details[data-ms="seg-0"] .ms-list .ms-opt', o => o.filter(x => !x.hidden).map(x => x.textContent.trim()));
ok(vis.length >= 2 && vis.every(v => v.includes('PNS')), 'Step 3: the search box filters values', vis);
await click('details[data-ms="seg-0"] input[data-msv="seg-0"][value="PNSM"]');
await p.evaluate(() => { const q = document.querySelector('details[data-ms="seg-0"] .ms-q'); q.value = ''; q.dispatchEvent(new Event('input')); }); await sleep(150);
await click('details[data-ms="seg-0"] input[data-msv="seg-0"][value="UA"]');
await click('#w-segadd');
const dis = await p.$$eval('select[data-segcol="1"] option', o => o.filter(x => x.disabled).map(x => x.value));
ok(dis.includes('hl_type'), 'Step 3: a factor can be used only once (used factors are disabled)', dis);
await p.select('select[data-segcol="1"]', 'legal_status'); await sleep(300); await openMs('seg-1'); await click('input[data-msv="seg-1"][value="Proprietorship"]');
await click('#w-segadd'); await p.select('select[data-segcol="2"]', 'vertical'); await sleep(300); await openMs('seg-2'); await click('input[data-msv="seg-2"][value="Top Cities - Inhouse"]');
await p.click('h2'); await sleep(200);
const rule = await txt('#w-segrule');
ok(rule.includes('Leads where HL Type is UA or PNSM AND Legal Status is Proprietorship AND Vertical is Top Cities - Inhouse'), 'Step 3: the rule in plain words', rule);
ok(/≈ [\d,]+ leads\/day · today's BuyLead created rate [\d.]+% \(last 30 days\)/.test(rule) && (await txt('#w-segline')) !== vol0, 'Step 3: live leads/day and today\'s rate update with the audience', rule);
await shot('05_step3_builder');
await p.click('[data-segdel="2"]'); await sleep(300);
ok((await txt('#w-segrule')).includes('Leads where HL Type is UA or PNSM AND Legal Status is Proprietorship ≈'), 'Step 3: × removes a condition and the rule updates', await txt('#w-segrule'));
const vol3 = await txt('#w-segline');
await click('#w-next');
ok(!(await txt('#w-glance')).includes('Set audience'), 'At a glance: shows estimates once the audience is set');

/* Step 4: goals */
const s4 = await p.evaluate(() => ({ prim: document.querySelector('#w-primary').value, ph: document.querySelector('#w-primary option[value=""]').textContent, guards: [...document.querySelectorAll('[data-mcard^="guardrail"]')].map(c => c.innerText), banner: /Suggested from your hypothesis|Use the suggestion/.test(document.querySelector('#w-main').innerText), secs: [...document.querySelectorAll('.goal-sec h3')].map(h => h.textContent) }));
ok(s4.prim === 'buylead_created' && s4.ph === 'Choose the main goal', 'Step 4: primary goal is pre-filled with BuyLead created (the placeholder is still there)', s4);
ok(s4.guards.length === 1 && /Call duration/.test(s4.guards[0]) && /must not rise by more than 10%/.test(s4.guards[0]), 'Step 4: one pre-added guardrail, call duration +10%', s4.guards);
ok(!s4.banner, 'Step 4: the "Suggested from your hypothesis" banner is gone');
ok(JSON.stringify(s4.secs) === JSON.stringify(['Primary goal', 'Guardrails', 'Secondary metrics']), 'Step 4: three sections in order', s4.secs);
await shot('06_step4_defaults');
await p.select('#w-primary', ''); await sleep(300);
await click('#w-next'); ok((await txt('#w-main h2')) === '4. Goals', 'Step 4: Next is refused without a primary goal');
// custom primary: Busy share of unanswered calls (rate) -> saved to the metric list
await p.select('#w-primary', '__custom'); await sleep(300);
await p.type('#w-cmname', 'Answered again'); await sleep(400);
await p.select('select[data-ccol="num:0"]', 'call_status'); await sleep(250); await p.select('select[data-cval="num:0"]', 'Answered'); await sleep(400);
ok((await txt('#w-cmprev')).includes('This counts the same thing as "Answered %"'), 'Step 4: a custom metric that duplicates a built-in is refused', await txt('#w-cmprev'));
await p.evaluate(() => { const n = document.querySelector('#w-cmname'); n.value = 'Busy share of all calls'; n.dispatchEvent(new Event('input')); }); await sleep(500);
await p.select('select[data-cval="num:0"]', 'Busy'); await sleep(300); await click('[data-cmdir="lower"]');
await click('[data-cadd="num"]'); await p.select('select[data-ccol="num:1"]', 'call_status'); await sleep(200);
const prevTxt = await txt('#w-cmprev');
await click('[data-cdel="num:1"]');
await shot('07_step4_custom_primary_form');
const prev = await txt('#w-cmprev');
ok(/Formula: Calls where Call status is Busy ÷ All calls attempted · Last 30 days: [\d,]+ ÷ [\d,]+ = [\d.]+%/.test(prev), 'Step 4: custom metric live preview with the formula and last-30-day numbers', prev);
await click('#w-cmsavep');
ok((await p.$eval('#w-primary', e => e.selectedOptions[0].textContent)) === 'Busy share of all calls', 'Step 4: "Save metric" sets the custom metric as the primary goal');
ok((await p.evaluate(() => DYN.settings.customMetrics.map(m => m.name))).includes('Busy share of all calls'), 'Step 4: the custom metric is saved to Settings > Metrics');
// built-in primary instead
await p.select('#w-primary', 'buylead_created'); await sleep(300);
// add a guardrail from the list
await click('#w-addm');
ok((await p.$eval('[data-prole="guardrail"]', e => e.getAttribute('aria-pressed'))) === 'true' && !!(await p.$('[data-ptab="list"]')) && !!(await p.$('[data-ptab="custom"]')), 'Panel: "Add as" toggle and the two tabs');
const groups = await p.$$eval('.mgroup-h', h => h.map(x => x.textContent)); ok(['Outcome', 'Call quality', 'Reach', 'Custom'].every(g => groups.includes(g)), 'Panel: list grouped Outcome / Call quality / Reach / Custom', groups);
const used = await p.$$eval('.mrow', r => r.filter(x => x.querySelector('input').disabled).map(x => x.innerText));
ok(used.some(t => /Call duration/.test(t) && /Already added/.test(t)) && used.some(t => /BuyLead created/.test(t) && /Already added/.test(t)), 'Panel: metrics already used are disabled with "Already added"', used);
ok(used.some(t => /Fatal calls/.test(t) && /Not in data yet/.test(t)), 'Panel: a metric with no data column is disabled');
await p.type('#w-psearch', 'hang'); await sleep(500); ok((await p.$$eval('.mrow', r => r.length)) === 1, 'Panel: the list is searchable');
await click('input[name=w-pick][value="early_hangup"]'); ok((await p.$eval('#w-pdir', e => e.value)) === 'lower', 'Panel: picking a metric keeps its own direction (early hang-ups: lower is better)');
await p.evaluate(() => { document.querySelector('#w-plim').value = 2; document.querySelector('#w-plimk').value = 'pts'; }); await shot('08_panel_list');
await click('#w-padd');
ok((await p.$$('[data-mcard^="guardrail"]')).length === 2, 'Panel: "Add" adds a guardrail card');
// add a secondary: custom metric with "save" ticked
await click('#w-addm'); await click('[data-prole="secondary"]'); await click('[data-ptab="custom"]');
await p.type('#w-cmname', 'Busy share of unanswered calls'); await sleep(300);
await p.select('select[data-ccol="num:0"]', 'call_status'); await sleep(250); await p.select('select[data-cval="num:0"]', 'Busy'); await sleep(250);
await click('input[name=w-cmden][value="custom"]'); await p.select('select[data-ccol="den:0"]', 'call_status'); await sleep(250); await p.select('select[data-cop="den:0"]', 'is_not'); await sleep(250);
await openMs('cm-den-0'); await click('input[data-msv="cm-den-0"][value="Answered"]'); await p.click('#w-panel h3'); await sleep(200);
await click('[data-cmdir="lower"]');
ok(await p.$eval('#w-cmsave', e => e.checked), 'Panel: "Save to metric list for future tests" is ticked by default');
await shot('09_panel_custom'); await click('#w-padd');
ok((await p.$$('[data-mcard^="secondary"]')).length === 1, 'Panel: custom secondary metric added');
// a secondary from the list, then an average custom guardrail
await click('#w-addm'); await click('[data-prole="secondary"]'); await click('input[name=w-pick][value="answered_pct"]');
ok((await p.$eval('#w-pdir', e => e.value)) === 'higher', 'Panel: Answered % keeps higher is better (the QA finding)'); await click('#w-padd');
ok(await p.evaluate(() => WZ.secondary.find(s => s.key === 'answered_pct').direction === 'higher'), 'Panel: the saved direction is the metric\'s own');
await click('#w-addm'); await click('[data-ptab="custom"]'); await p.type('#w-cmname', 'Talk time per lead'); await sleep(300); await click('[data-cmtype="average"]'); await p.select('select[data-cmunit="avg"]', 'leads'); await sleep(300); await click('[data-cadd="where"]'); await p.select('select[data-ccol="where:0"]', 'connected'); await sleep(250); await p.select('select[data-cval="where:0"]', '1'); await sleep(300);
ok(/Formula: Average call duration over leads \(first matching call\) where Connected is 1 · Last 30 days: [\d.]+ s/.test(await txt('#w-cmprev')), 'Panel: an Average custom metric previews in seconds', await txt('#w-cmprev'));
await p.evaluate(() => { document.querySelector('#w-plim').value = 8; }); await click('#w-padd');
const cards = await p.$$eval('[data-mcard]', c => c.map(x => x.dataset.mcard + ' ' + x.innerText.replace(/\s+/g, ' ')));
ok(cards.filter(c => c.startsWith('guardrail')).length === 3 && cards.filter(c => c.startsWith('secondary')).length === 2, 'Cards: 3 guardrails and 2 secondary metrics', cards);
ok(cards.some(c => /Early hang-ups/.test(c) && /must not rise by more than 2 points/.test(c)) && cards.some(c => /Talk time per lead/.test(c) && /8%/.test(c)), 'Cards: show limit, formula and today\'s value', cards);
// limits: guardrails are full
await click('#w-addm'); const gdis = await p.$eval('[data-prole="guardrail"]', e => ({ d: e.disabled, t: e.title }));
ok(gdis.d && gdis.t === 'Max reached — more metrics mean more false alarms.', 'Limits: guardrail role disabled at 3, with the tooltip', gdis); await click('#w-pclose');
// edit a card: click opens the panel pre-filled
await p.evaluate(() => document.querySelector('[data-mcard="guardrail:1"]').click()); await sleep(300);
ok((await txt('#w-panel h3')) === 'Edit metric' && (await p.$eval('#w-plim', e => e.value)) === '2', 'Edit: clicking a card reopens the panel pre-filled');
await p.evaluate(() => { document.querySelector('#w-plim').value = 3; }); await click('#w-padd');
ok((await txt('[data-mcard="guardrail:1"]')).includes('3 points'), 'Edit: the change is saved');
// move: guardrail -> secondary via the ⋯ menu, and back
await p.click('[data-mcard="guardrail:2"] .kebab summary'); await sleep(150); await shot('10_step4_menu');
await p.click('[data-mmove="guardrail:2"]'); await sleep(250);
ok((await p.$$('[data-mcard^="guardrail"]')).length === 2 && (await p.$$('[data-mcard^="secondary"]')).length === 3, 'Move: guardrail -> secondary');
// remove
await p.click('[data-mdel="secondary:2"]'); await sleep(250);
ok((await p.$$('[data-mcard^="secondary"]')).length === 2, 'Remove: × removes a card');
await shot('11_step4_final');
const glance4 = await glance();
await click('#w-next');

/* Step 5: duration */
const s5 = await p.evaluate(() => ({ len: document.querySelector('#w-len').selectedOptions[0].textContent, words: document.querySelector('#w-planwords').innerText, adv: document.querySelector('#w-adv').open, conf: document.querySelector('#w-conf').value, min: document.querySelector('#w-min').value, base: document.querySelector('#w-base').readOnly }));
ok(/^Recommended: \d+ days$/.test(s5.len), 'Step 5: "Recommended: N days" is the default', s5.len);
ok(/Your audience gets about [\d,]+ leads a day\. Prompt B gets \d+% of them, about [\d,]+ a day\. Today's BuyLead created rate for this audience is [\d.]+%\. To reliably spot an improvement of 5 points \([\d.]+% → [\d.]+%\), B needs about [\d,]+ leads\. [\d,]+ ÷ [\d,]+ = [\d.]+ days, rounded up to whole weeks = \d+ days\./.test(s5.words), 'Step 5: the plain-English card', s5.words);
ok(!s5.adv && s5.conf === '0.95' && s5.min === '500' && s5.base, 'Step 5: Advanced settings collapsed: 95%, 500 leads per arm, read-only baseline', s5);
const g5 = await glance(), m5 = s5.words.match(/B needs about ([\d,]+) leads/)[1], d5 = s5.words.match(/= (\d+) days\.$/)[1];
ok(g5.nb === m5 + ' leads' && (g5.len.startsWith(d5 + ' days') || +g5.len.split(' ')[0] === Math.min(28, +d5)), 'At a glance equals Step 5 (B needs, days)', { g5, m5, d5 });
await shot('12_step5_default');
// recalc: lift
await click('[data-size="large"]'); const g5b = await glance(); ok(g5b.nb !== g5.nb && (await txt('#w-planwords')).includes('improvement of 10 points'), 'Step 5: changing the improvement recalculates', { before: g5.nb, after: g5b.nb });
await click('[data-size="medium"]');
// recalc: B share
await p.evaluate(() => { const s = document.querySelector('#w-share'); s.value = 20; s.dispatchEvent(new Event('change')); }); await sleep(400);
const g5c = await glance(); ok(g5c.bpd.startsWith('20%') && g5c.days !== g5.days, 'Step 5: changing B\'s share recalculates', { before: g5, after: g5c });
// custom length
await p.select('#w-len', 'custom'); await sleep(400);
const c5 = await p.evaluate(() => ({ lpd: !!document.querySelector('#w-clpd'), share: !!document.querySelector('#w-share'), days: !!document.querySelector('#w-cdays'), d: document.querySelector('#w-cd') && document.querySelector('#w-cd').value, rev: document.querySelector('#w-reverse') && document.querySelector('#w-reverse').innerText }));
ok(c5.lpd && c5.share && c5.days && c5.d === '5' && /With \d+ days you can spot an improvement of [\d.]+ pts or more\./.test(c5.rev), 'Custom length: editable leads/day, B share, days, improvement; live reverse line', c5);
await p.select('#w-cdays', '7'); await sleep(400);
const c5b = await p.evaluate(() => ({ warn: document.querySelector('#w-main').innerText.includes('Shorter than recommended — the result may be inconclusive.'), rev: document.querySelector('#w-reverse').innerText }));
const g5d = await glance(); ok(g5d.len === '7 days (custom)' && c5b.rev.includes(g5d.small.replace(/^\+/, '')), 'Custom length: At a glance shows the same days and smallest improvement', { g5d, rev: c5b.rev });
ok(c5b.warn || (await txt('#w-planwords')).includes('= 7 days'), 'Custom length: amber warning when shorter than recommended', c5b);
await shot('13_step5_custom');
await p.select('#w-len', 'rec'); await sleep(300);
// recalc: segment (back to step 3, widen), and goal (step 4)
const before = await glance(); await click('[data-step="3"]'); await p.click('[data-segdel="1"]'); await sleep(300); await click('[data-step="5"]');
const afterSeg = await glance(); ok(afterSeg.lpd !== before.lpd, 'Step 5 recalculates after the audience changes', { before: before.lpd, after: afterSeg.lpd });
await click('[data-step="3"]'); await click('#w-segadd'); await p.select('select[data-segcol="1"]', 'legal_status'); await sleep(300); await openMs('seg-1'); await click('input[data-msv="seg-1"][value="Proprietorship"]'); await p.click('h2'); await sleep(200); await click('[data-step="5"]');
ok((await glance()).lpd === before.lpd, 'Step 5: back to the same audience gives the same numbers');
await click('[data-step="4"]'); await p.select('#w-primary', 'meeting_fixed'); await sleep(300); await click('[data-step="5"]');
const afterGoal = await glance(); ok(afterGoal.base !== afterSeg.base && (await txt('#w-planwords')).includes('Meeting Fixed'), 'Step 5 recalculates after the primary goal changes', { before: afterSeg.base, after: afterGoal.base });
await click('[data-step="4"]'); await p.select('#w-primary', 'buylead_created'); await sleep(300); await click('[data-step="5"]');
await p.evaluate(() => { const s = document.querySelector('#w-share'); s.value = 30; s.dispatchEvent(new Event('change')); }); await sleep(400);
ok((await glance()).bpd.startsWith('30%'), 'Step 5: B share back to 30% (At a glance follows)');
await click('#w-next');

/* Step 6: review */
const r6 = await p.evaluate(() => document.querySelector('#w-main').innerText);
const r6h = await p.$eval('#w-main', e => e.innerHTML);
ok(/Leads where HL Type is UA or PNSM AND Legal Status is Proprietorship/.test(r6) && /leads a day/.test(r6) && r6h.includes('counts only those that match the rule'), 'Review: the audience in words, leads a day, and the counting rule one hover away');
ok(r6.includes('BuyLead created') && r6.includes('Early hang-ups') && /must not rise by more than 3 points/.test(r6) && r6.includes('Busy share of unanswered calls') && r6h.includes('For insight only'), 'Review: primary, guardrails with formula and limit, secondary');
ok(!/patch/i.test(r6) && r6.includes('What changed in prompt B') && !!(await p.$('#w-main .diff2')), 'Review: prompt B diff shown, no "patch" wording');
const chk = await p.$$eval('#w-checks .check', c => c.map(x => x.className + ' ' + x.innerText));
ok(chk.length === 6 && chk.every(c => c.includes(' ok')), 'Review: every pre-launch check passes', chk);
await shot('14_step6_review');

/* Launch (live engine only) */
if (live) {
  await p.click('[data-preset="win"]'); await sleep(200);
  await p.click('#w-launch'); await p.waitForFunction(() => location.hash.startsWith('#/live/'), { timeout: 180000 }); await sleep(800);
  const lv = await p.evaluate(() => document.querySelector('#page').innerText);
  ok(/Leads where HL Type is UA or PNSM AND Legal Status is Proprietorship/.test(lv) && /100% of counted leads matched this rule/.test(lv), 'Live: audience and "100% of counted leads matched this rule"');
  ok(lv.includes('Secondary (for insight only, not used for the decision)'), 'Live: the Secondary section');
  await shot('15_live'); await p.click('#a-end').catch(() => {}); await sleep(800); await shot('16_live_end');
}

/* Suggest A/B Tests -> "Create experiment" pre-fills the FULL prompt B */
await p.goto(url + '#/suggest'); await sleep(400);
await p.click('[data-create="loops"]'); await sleep(500); await click('#w-next');
const sg = await p.evaluate(() => { const b = document.querySelector('#w-b').value; return { len: b.length, two: b.includes('quantity = 2'), diff: document.querySelectorAll('#w-diff .add').length, vc: document.querySelector('#w-vc').innerText }; });
ok(sg.len > 100000 && sg.two && sg.diff > 0 && sg.vc.includes('All variables kept'), 'Suggest: "Create experiment" pre-fills the full prompt B (A with the suggestion applied)', sg);
await shot('17_suggest_prefill');
console.log(`${pass} passed, ${fail} failed; page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
await b.close(); process.exit(fail || errs.length ? 1 : 0);
