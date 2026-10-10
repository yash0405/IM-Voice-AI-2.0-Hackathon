// Visit the console the way a teammate does: through a public URL (ngrok or a hosted copy) with the team password.
//   TUNNEL_URL=https://....ngrok-free.dev TUNNEL_PASSWORD=... node tests/browser/tunnel_access.mjs
// Checks: no page without the password, every screen renders, the Live call screen is there, nothing the page asks for fails (except the
// history database, which stays on the server's own computer), and Label Lab, audio and transcripts are not reachable.
import puppeteer from 'puppeteer-core';
const url = (process.env.TUNNEL_URL || '').replace(/\/$/, ''), pw = process.env.TUNNEL_PASSWORD || '';
if (!url || !pw) { console.error('set TUNNEL_URL and TUNNEL_PASSWORD'); process.exit(2); }
let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
try {
  // 1. without the password the server answers 401 (a real browser then shows its password box; headless Chrome cannot, so ask over plain HTTP)
  const anon = await fetch(url + '/', { headers: { 'ngrok-skip-browser-warning': '1' } });
  ok(anon.status === 401 && /Basic/.test(anon.headers.get('www-authenticate') || ''), `no password: 401 with a password prompt (got ${anon.status})`);
  const wrong = await fetch(url + '/api/live/state', { headers: { 'ngrok-skip-browser-warning': '1', Authorization: 'Basic ' + Buffer.from('team:not-the-password').toString('base64') } });
  ok(wrong.status === 401, `wrong password: 401 (got ${wrong.status})`);

  // 2. with the password
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.authenticate({ username: 'team', password: pw });
  await page.setExtraHTTPHeaders({ 'ngrok-skip-browser-warning': '1' });
  const bad = [], errs = [];
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().replace(url, '')); });
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  await page.goto(url + '/', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(1500);
  const flags = await page.evaluate(() => ({ live: !!window.CANARY_LIVE, livecall: !!window.CANARY_LIVECALL, hosted: !!window.CANARY_HOSTED }));
  ok(flags.livecall && flags.hosted, `page flags: live call screen on, hosted copy (no local data) ${JSON.stringify(flags)}`);
  const routes = ['overview', 'new', 'live', 'livecall', 'history', 'import', 'suggest', 'library', 'settings'];
  for (const r of routes) {
    await page.evaluate(h => { location.hash = '#/' + h; }, r);
    await sleep(900);
    const t = await page.evaluate(() => (document.querySelector('main, #app, body') || document.body).innerText.length);
    ok(t > 200, `screen #/${r} renders (${t} characters)`);
  }
  await page.screenshot({ path: process.env.SHOT || '/tmp/tunnel_livecall.png' });
  const txt = await page.evaluate(() => document.body.innerText);
  ok(/Live call/i.test(txt), 'Live call test screen is reachable through the tunnel');
  // 3. what the page asked for and was refused
  const unexpected = bad.filter(b => !/\/api\/store|favicon/.test(b));
  ok(unexpected.length === 0, `no failed requests from the page ${JSON.stringify(unexpected)}`);
  ok(errs.length === 0, `no script errors ${JSON.stringify(errs)}`);
  // 4. local-only data is not reachable even with the password
  for (const p of ['/audio/1', '/api/transcript/1', '/api/labels/next?labeler=x', '/tools.html']) {
    const st = await page.evaluate(async u => (await fetch(u)).status, p);
    ok(st === 404, `${p} is not served through the tunnel (${st})`);
  }
} finally { await browser.close(); }
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
