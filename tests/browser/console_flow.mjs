import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const sleep = ms => new Promise(r => setTimeout(r, ms)); const errs = [];
const p = await b.newPage(); await p.setViewport({ width: 1360, height: 900 });
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
p.on('dialog', d => d.accept());
const url = process.argv[2]; import fs from 'fs'; fs.mkdirSync('/tmp/canary_shots', { recursive: true });
const shot = n => p.screenshot({ path: `/tmp/canary_shots/${n}.png`, fullPage: true });
const txt = (s) => p.$eval(s, e => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '(missing)');
const click = async s => { await p.click(s); await sleep(250); };
const go = async h => { await p.evaluate(x => { location.hash = x; }, h); await sleep(350); };
await p.goto(url + '#/overview', { waitUntil: 'load' }); await p.evaluate(() => localStorage.clear()); await p.reload(); await sleep(500);
console.log('start: tests run / running ->', await txt('.g4 .card:nth-child(1) .v'), '/', (await p.$$('.g3 .card')).length, 'running cards; production ->', await txt('.kv dd'));
// the spec's demo: advance each of the three tests day by day
await go('#/live/demo_win'); console.log('win day:', await txt('.page-head .sub'));
for (let i = 0; i < 5; i++) await click('#a-adv');
console.log('win after 5 days ->', await txt('.banner'));
await shot('live_win_done');
await click('#a-roll'); console.log('live rollback -> events:', (await p.$$eval('.ledger .e b', e => e.map(x => x.innerText))).join(', '));
await go('#/live/demo_worse'); for (let i = 0; i < 6; i++) { if (await p.$('#a-adv')) await click('#a-adv'); }
console.log('worse ->', await txt('.banner')); await shot('live_worse_done');
await go('#/live/demo_flat'); for (let i = 0; i < 6; i++) { if (await p.$('#a-adv')) await click('#a-adv'); }
console.log('flat ->', (await txt('.banner')).slice(0, 140));
await go('#/report/demo_flat'); console.log('flat report ->', (await txt('.report h2')), '|', (await p.$$eval('.report h2', e => e.map(x => x.innerText))).join(' / ')); await shot('report_flat');
// the bonus scenario: a win with calls too long is held for a person
await go('#/live'); console.log('live groups ->', await p.$$eval('#live-pick optgroup', e => e.map(x => x.label + ':' + x.children.length).join(', ')));
await go('#/live/demo_hold'); for (let i = 0; i < 6; i++) { if (await p.$('#a-adv')) await click('#a-adv'); }
console.log('held ->', (await txt('.banner')).slice(0, 120), '| approve enabled:', await p.$eval('#a-approve', e => !e.disabled)); await shot('live_hold');
await click('#a-approve'); console.log('after approve ->', (await txt('.banner')).slice(0, 70)); await click('#a-verify'); console.log('verify ->', await txt('#verify-out'));
await go('#/library'); console.log('library live ->', (await txt('.banner')).slice(0, 60), '| rows:', (await p.$$('tbody tr')).length); await shot('library_after');
await click('[data-roll]'); console.log('library rollback -> banner:', (await txt('.banner')).slice(0, 60));
await go('#/overview'); console.log('overview totals ->', await p.$$eval('.g4 .card .v', e => e.map(x => x.innerText).join(' / ')), '| production:', await txt('.kv dd'));
await go('#/log'); console.log('log ->', await txt('.pager span')); await shot('log_after');
// history: filter, search, clone
await go('#/history'); await p.select('#h-dec', 'promoted'); await sleep(300); console.log('history promoted ->', await txt('.pager span'));
await p.select('#h-dec', 'all'); await sleep(300); await click('[data-clone]'); console.log('clone -> wizard:', await txt('h1'), '| name prefilled:', await p.$eval('#w-name', e => e.value));
// wizard walk (every step in detail: tests/browser/new_experiment_e2e.mjs)
await click('#w-next'); console.log('step 2 ->', await txt('.card h2')); console.log('prompt B prefilled:', (await p.$eval('#w-b', e => e.value.length)) > 1000);
await p.evaluate(() => { const t = document.querySelector('#w-b'); t.value = t.value.replace(/buyer_name/g, 'NAME'); t.dispatchEvent(new Event('input')); }); await sleep(500); console.log('after removing a variable ->', await txt('#w-vc')); await shot('wizard_vars');
await p.evaluate(() => { const t = document.querySelector('#w-b'); t.value = t.value.replace(/NAME/g, 'buyer_name') + '\nOne more line.\n'; t.dispatchEvent(new Event('input')); }); await sleep(500); console.log('diff shown:', (await p.$$('.diff2')).length);
await click('#w-next'); console.log('step 3 ->', await txt('.card h2'));
await click('#w-next'); console.log('step 4 ->', await txt('.card h2')); await p.select('#w-primary', 'buylead_created'); await sleep(300); await click('#w-next'); console.log('step 5 ->', await txt('.card h2')); console.log('plan ->', (await txt('#w-planwords')).slice(0, 220)); await shot('wizard_step5');
await click('#w-next'); console.log('step 6 ->', await txt('.card h2')); await click('#w-launch'); await p.waitForFunction(() => location.hash.startsWith('#/live/replay-'), { timeout: 8000 }); await sleep(300); console.log('offline launch ->', (await txt('.banner.warn')).slice(0, 60));
console.log('errors:', errs.length ? [...new Set(errs)] : 'none');
await b.close();
