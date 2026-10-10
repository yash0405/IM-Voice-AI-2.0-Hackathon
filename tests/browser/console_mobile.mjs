import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const sleep = ms => new Promise(r => setTimeout(r, ms)); const errs = [];
const url = process.argv[2];
for (const [w, h] of [[390, 844], [820, 1000]]) {
  const p = await b.newPage(); await p.setViewport({ width: w, height: h }); p.on('pageerror', e => errs.push(e.message));
  await p.goto(url + '#/overview', { waitUntil: 'load' }); await p.evaluate(() => localStorage.clear());
  for (const r of ['overview', 'new', 'live/demo_hold', 'history', 'report/past_b_wins', 'suggest', 'library', 'log', 'settings', 'import']) {
    await p.goto(url + '#/' + r); await p.reload(); await sleep(350);
    const o = await p.evaluate(() => { const bad = [...document.querySelectorAll('.main *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && !e.closest('.tbl-wrap') && !e.closest('.diff') && !e.closest('.nav'); }).length; return { over: document.documentElement.scrollWidth > innerWidth + 2, bad }; });
    if (o.over || o.bad) console.log(`${w}px  ${r.padEnd(20)} horizontal overflow: page=${o.over} elements=${o.bad}`);
  }
  await p.screenshot({ path: `/tmp/picky_shots/mobile_${w}.png`, fullPage: false }); await p.close();
}
console.log('mobile/tablet check done; errors:', errs.length ? errs : 'none'); await b.close();
