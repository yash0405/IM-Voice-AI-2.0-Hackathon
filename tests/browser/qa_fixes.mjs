// The independent QA pass's UI findings, kept fixed. Usage: node qa_fixes.mjs <page url> [live]
import puppeteer from 'puppeteer-core';
const [url, live] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const p = await b.newPage(); await p.setViewport({ width: 1366, height: 900 }); const errs = []; p.on('pageerror', e => errs.push(e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms)); let pass = 0, fail = 0;
const ok = (c, n, i) => { if (c) { pass++; console.log('ok   ' + n); } else { fail++; console.log('FAIL ' + n + (i !== undefined ? '  ' + JSON.stringify(i).slice(0, 300) : '')); } };
const glance = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#glance dd[data-g]')].map(d => [d.dataset.g, d.textContent.trim()])));
await p.goto(url + '#/overview', { waitUntil: 'load' }); await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'load' }); await sleep(500);
const setW = async (state) => { await p.evaluate(st => { WZ = { ...wzDefaults(), name: 'qa', promptB: liveA().text + '\nx\n', audienceSet: true, primary: 'buylead_created', ui: {}, ...st }; go('new'); route(); }, state); await sleep(500); };

// 4: Custom length follows the audience unless the person edited leads a day
await setW({ step: 5, segRows: [{ column: 'vendor', values: ['squadstack'] }], lenMode: 'custom', customDays: 14 });
const g1 = await glance(); await p.evaluate(() => { WZ.segRows = []; route(); }); await sleep(400); const g2 = await glance();
ok(g1.lpd !== g2.lpd && g2.lpd === (await p.evaluate(() => String(Math.round(audienceVolume(null).perDay).toLocaleString('en-US')))), 'Custom length: leads a day follows the audience (not frozen)', { g1: g1.lpd, g2: g2.lpd });
await p.evaluate(() => { const e = document.querySelector('#w-clpd'); e.value = 500; e.dispatchEvent(new Event('change')); }); await sleep(400);
ok((await glance()).lpd === '500', 'Custom length: an edited leads a day is kept and used');
await p.evaluate(() => { WZ.segRows = [{ column: 'vendor', values: ['squadstack'] }]; route(); }); await sleep(400);
ok((await glance()).lpd === '500', 'Custom length: the edited value survives an audience change');
// 4b: a stored improvement is not reread in another unit when the primary changes type
await setW({ step: 5, lenMode: 'custom', customDays: 14, customD: 5, customDTouched: true, customDType: 'rate', primary: 'buylead_created' });
const ratePts = (await glance()).d; await p.evaluate(() => { DYN.settings.customMetrics = [{ key: 'custom_talk', name: 'Talk per lead', type: 'average', direction: 'lower', group: 'Custom', col: 'call_duration', unit: 'leads', where: [{ col: 'connected', op: 'is', values: ['1'] }] }]; WZ.primary = 'custom_talk'; route(); }); await sleep(400);
const avgD = (await glance()).d; ok(ratePts.includes('pts') && /s$/.test(avgD) && !avgD.startsWith('−5.0'), 'Custom length: a rate improvement is not reused as seconds', { ratePts, avgD });

// 12a: a primary removed from Settings is said, not hidden behind another selection
await setW({ step: 4, primary: 'custom_gone' }); const t12 = await p.evaluate(() => document.querySelector('#w-main').innerText);
ok(t12.includes('The primary goal chosen earlier was removed from Settings > Metrics') && (await p.$eval('#w-primary', e => e.value)) === '', 'Deleted primary: a note, and the dropdown shows the placeholder');
await p.evaluate(() => { WZ.step = 5; route(); }); await sleep(300); ok(!(await glance()).d.startsWith('−'), 'Deleted primary: At a glance does not borrow a guardrail\'s direction');

// 12c: a guardrail moved to secondary and back keeps its limit
await setW({ step: 4, guards: [{ key: 'early_hangup', direction: 'lower', limit: { value: 3, kind: 'pts' } }] });
await p.click('[data-mcard="guardrail:0"] .kebab summary'); await sleep(150); await p.click('[data-mmove="guardrail:0"]'); await sleep(250);
await p.click('[data-mcard="secondary:0"] .kebab summary'); await sleep(150); await p.click('[data-mmove="secondary:0"]'); await sleep(250);
ok(await p.evaluate(() => WZ.guards[0].limit.value === 3 && WZ.guards[0].limit.kind === 'pts'), 'Move: guardrail -> secondary -> guardrail keeps the edited limit');

// 12d: HL Bucket is derived from HL Type: "HL Type UA" and "HL Bucket Rest" share no lead
ok(await p.evaluate(() => !segsOverlap([{ column: 'hl_type', values: ['UA'] }], [{ column: 'hl_bucket', values: ['Rest'] }]) && segsOverlap([{ column: 'hl_type', values: ['UA'] }], [{ column: 'hl_bucket', values: ['Top 3'] }])), 'Overlap: a derived factor is read through its base factor');

// 10: the automatic share says why
await setW({ step: 4 }); await p.evaluate(() => { WZ.shareTouched = false; }); await p.click('#w-next'); await sleep(400);
ok((await p.evaluate(() => document.querySelector('#w-main').innerText)).includes('for you:'), 'Share: an automatic share shows its reason');
// 13d: an out-of-range share is told, not silently clamped
await p.evaluate(() => { const s = document.querySelector('#w-share'); s.value = 51; s.dispatchEvent(new Event('change')); }); await sleep(300);
ok(await p.evaluate(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('whole percent from 5 to 50'))), 'Share: 51% is refused with a message');

// 13a, 13b: Settings
await p.goto(url + '#/settings'); await sleep(500); const st = await p.evaluate(() => document.querySelector('#page').innerText);
ok(st.includes('BuyLead created') && !/Call disposition[^\n]*any number/.test(st) && !st.includes('fatal_flag') && st.includes('Fatal flag'), 'Settings: disposition values listed; no raw column name');

if (live) {        // 6: Live shows the same connected leads a day as the page
  await setW({ step: 6, segRows: [{ column: 'vendor', values: ['squadstack'] }], share: 0.3 });
  const pageLpd = await p.evaluate(() => Math.round(audienceVolume([{ column: 'vendor', values: ['squadstack'] }]).perDay));
  await p.click('#w-launch'); await p.waitForFunction(() => location.hash.startsWith('#/live/'), { timeout: 240000 }); await sleep(1000);
  const lv = await p.evaluate(() => document.querySelector('.exp-head').innerText);
  const m = lv.match(/about ([\d,]+) connected leads a day/); ok(m && Math.abs(+m[1].replace(/,/g, '') - pageLpd) <= 1, 'Live: connected leads a day equals the page', { lv: m && m[1], pageLpd });
}
console.log(`${pass} passed, ${fail} failed; page errors: ${errs.length ? errs.join(' | ') : 'none'}`); await b.close(); process.exit(fail || errs.length ? 1 : 0);
