import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const sleep = ms => new Promise(r => setTimeout(r, ms)); const errs = [];
const p = await b.newPage(); await p.setViewport({ width: 1360, height: 900 }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); }); p.on('dialog', d => d.accept());
const url = process.argv[2]; const txt = s => p.$eval(s, e => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '(missing)');
const click = async s => { await p.click(s); await sleep(250); }; const go = async h => { await p.evaluate(x => { location.hash = x; }, h); await sleep(350); };
await p.goto(url + '#/overview', { waitUntil: 'load' }); await p.evaluate(() => localStorage.clear()); await p.reload(); await sleep(500);
// 1. page structure on Live: title, filter bar, then the experiment
await go('#/live/demo_hold'); console.log('live order ->', await p.$$eval('.main #page > *', e => e.slice(0, 4).map(x => x.className.split(' ')[0] || x.tagName).join(' > ')), '| h1:', await txt('h1'));
// 2. interim range and guardrail pass/fail while running
console.log('lift tile ->', (await p.$$eval('.g4 .card', e => e[3].innerText.replace(/\s+/g, ' '))).slice(0, 140));
console.log('guard tile ->', (await txt('.g2 .card')).slice(0, 160));
for (let i = 0; i < 6; i++) { if (await p.$('#a-adv')) await click('#a-adv'); }
const liveG = await txt('.g2 .card'); console.log('hold guard (live) ->', liveG.slice(0, 170));
// 3. the same guardrail on the report and in History
await go('#/report/demo_hold'); console.log('hold guard (report) ->', (await p.$$eval('.report .check', e => e.map(x => x.innerText.replace(/\s+/g, ' ')))).slice(0, 1).join(' | ').slice(0, 170));
await go('#/live/demo_worse'); for (let i = 0; i < 5; i++) { if (await p.$('#a-adv')) await click('#a-adv'); }
console.log('worse guard (live) ->', (await txt('.g2 .card')).slice(0, 140));
await go('#/report/demo_worse'); console.log('worse report ->', (await p.$$eval('.report .check', e => e.map(x => x.innerText.replace(/\s+/g, ' ')))).slice(0, 1).join('').slice(0, 140), '| lift row:', (await p.$$eval('.report tbody tr', e => e[2].innerText.replace(/\s+/g, ' '))));
await go('#/history'); console.log('history demo_worse row ->', (await p.$$eval('tbody tr', e => e.find(r => r.innerText.includes('Make the ask limits')).innerText.replace(/\s+/g, ' '))).slice(0, 200));
// 4. library: win then held test both promoted; v3 against v2 is a real difference
await go('#/live/demo_win'); for (let i = 0; i < 6; i++) { if (await p.$('#a-adv')) await click('#a-adv'); }
await go('#/live/demo_hold'); await click('#a-approve');
await go('#/library/v3'); console.log('library v3 ->', (await txt('.card h2')).slice(0, 40), '|', (await txt('.card .sub')).slice(0, 70), '| diff lines:', (await p.$$('.diff2 .diff div')).length);
await go('#/overview'); console.log('overview note ->', await txt('p.note'));
console.log('sticky th ->', await p.evaluate(() => { go('history'); return null; }) || '', await sleep(300) || '', await p.evaluate(() => getComputedStyle(document.querySelector('th')).position + ' / wrap overflow-x: ' + getComputedStyle(document.querySelector('.tbl-wrap')).overflowX));
// 5. offline wizard: a full prompt B, then launch (replay)
await go('#/new'); await p.evaluate(() => { WZ = null; DYN.ui.wizard = null; }); await go('#/new'); await p.type('#w-name', 'My own prompt B test'); await click('#w-next');
await p.evaluate(() => { const t = document.querySelector('#w-b'); t.value = t.value.replace('would be shared over whatsapp', 'would be shared over whatsapp right after this call'); t.dispatchEvent(new Event('input')); }); await sleep(500);
console.log('prompt B diff lines ->', (await p.$$('.diff2 .diff div')).length, '|', (await txt('#w-vc')).slice(0, 60));
await click('#w-abox summary'); await sleep(300); console.log('prompt A viewer ->', await p.$eval('#w-aview textarea', e => e.value.length) + ' chars');
await click('#w-next'); await click('#w-next'); await p.select('#w-primary', 'buylead_created'); await sleep(300); await click('#w-next'); await click('#w-next'); await click('#w-launch'); await p.waitForFunction(() => location.hash.startsWith('#/live/replay-'), { timeout: 8000 }); await sleep(400);
console.log('offline launch ->', (await txt('h2')).slice(0, 40), '|', (await txt('.banner.warn')).slice(0, 70));
// 6. suggest learning
await go('#/report/demo_flat'); console.log('(learning field present):', !!(await p.$('#r-learn')));
console.log('errors:', errs.length ? [...new Set(errs)] : 'none'); await b.close();
