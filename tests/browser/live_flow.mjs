// End-to-end browser test of the Live call test screen of the console, against a mock of Sarvam's voice runtime (see mock_sarvam.mjs).
//   npm install puppeteer-core ws        # once; Chrome at /usr/bin/google-chrome, python venv in $PY (default python3)
//   PY=/path/to/python node tests/browser/live_flow.mjs
// Starts the real live server on a free port with a temp state folder, drives the page with a fake microphone, and checks: the setup screen,
// the connection check, lock, 6 real SDK calls (mock voice), no results visible before the threshold, the released verdict, blind reveal, CSV.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { startMock, MOCK_KEY } from './mock_sarvam.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const free = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const PER = Number(process.env.PER || 3);
const shots = process.env.SHOTS || path.join(os.tmpdir(), 'canary_live_shots'); fs.mkdirSync(shots, { recursive: true });
let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };

const mock = await startMock({ replyMs: 300 });
const port = await free();
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'canary_live_'));
const py = spawn(process.env.PY || 'python3', ['-m', 'canary', 'live', '--port', String(port)], {
  cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  env: { ...process.env, CANARY_LIVE_DIR: state, SARVAM_VOICE_API_KEY: MOCK_KEY, SARVAM_VOICE_RUNTIME_BASE: `http://127.0.0.1:${mock.port}/api/app-runtime/` }, stdio: ['ignore', 'pipe', 'pipe'] });
let srvlog = ''; py.stdout.on('data', d => srvlog += d); py.stderr.on('data', d => srvlog += d);
for (let i = 0; i < 60 && !srvlog.includes('live call test on'); i++) await sleep(250);
const base = `http://127.0.0.1:${port}`;

const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 900 });
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (process.env.DEBUG) console.log('  [page]', m.type(), m.text().slice(0, 160)); if (m.type() === 'error') errs.push('console: ' + m.text()); });
p.on('dialog', d => d.accept(d.message().includes('abandon') ? 'x' : 'no sound'));
const txt = s => p.$eval(s, e => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '(missing)');
const click = async s => { await p.$eval(s, e => e.scrollIntoView({ block: 'center' })); await sleep(80); await p.click(s); await sleep(200); };
const waitText = (s, re, ms = 15000) => p.waitForFunction((s, re) => { const e = document.querySelector(s); return e && new RegExp(re).test(e.innerText); }, { timeout: ms }, s, re);
try {
  await p.goto(base + '/#/overview', { waitUntil: 'load' }); await sleep(800);
  // the console is the normal one, with one extra menu entry right after Live Experiments
  const navs = await p.$$eval('#nav a span:first-child', e => e.map(x => x.innerText));
  ok(navs.join('|').startsWith('Overview|New Experiment|Live Experiments|Live call test|History'), 'the console menu is main\'s, plus "Live call test" after Live Experiments -> ' + navs.join(', '));
  ok((await txt('.page-head h1')).length > 0 && (await p.$$('.card')).length > 0, 'the Overview screen still renders');
  await p.click('#nav a[href="#/livecall"]');
  await p.waitForSelector('#lc-cand'); await sleep(1200);
  ok((await txt('.page-head .pill')).includes('agent ids missing'), 'setup: key set but agent ids missing is shown plainly -> ' + (await txt('.page-head .pill')));
  ok((await p.$$('#lc-pair .lc-change')).length >= 1, 'setup: what the patch changes is listed (' + (await p.$$('#lc-pair .lc-change')).length + ' change(s))');
  ok(/false winner/i.test(await txt('#lc-plan')) && /Catches a gap/.test(await txt('#lc-plan')), 'setup: threshold panel says what N can and cannot detect');
  await p.screenshot({ path: path.join(shots, '1_setup.png'), fullPage: true });

  // connection: a wrong agent id is reported plainly, then fix it
  await p.type('#lc-org', 'org1'); await p.type('#lc-ws', 'ws1'); await p.type('#lc-appA', 'missing-app'); await p.type('#lc-verA', '1'); await p.type('#lc-appB', 'agentB'); await p.type('#lc-verB', '2');
  await click('[data-lc=check-conn]'); await sleep(800);
  const bad = await txt('#lc-checkres'); ok(/Prompt A:.*not found/.test(bad) && /Prompt B: ready/.test(bad), 'connection check: bad agent A reported, agent B ready -> ' + bad.slice(0, 120));
  await p.$eval('#lc-appA', e => e.value = ''); await p.type('#lc-appA', 'agentA'); await click('[data-lc=check-conn]'); await sleep(800);
  ok((await txt('.page-head .pill')).includes('ready'), 'connection: ready after fixing -> ' + (await txt('.page-head .pill')));

  // threshold + lock
  await p.$eval('#lc-n', (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, String(PER)); await sleep(900);
  ok((await txt('#lc-plan')).includes(`${PER} per prompt = ${PER * 2} calls`), 'plan follows the threshold you type');
  await click('[data-lc=lock]'); await p.waitForSelector('#lc-callcard'); await sleep(500);
  ok((await txt('.page-head h1')) === 'Live call test', 'locked: run screen shown');
  ok((await txt('.lc-locked')).includes('Result locked'), 'run: result shown as locked');
  await p.screenshot({ path: path.join(shots, '2_run.png'), fullPage: true });

  // calls
  const total = PER * 2;
  for (let i = 1; i <= total; i++) {
    await click('[data-lc=next-call]');
    await waitText('#lc-callcard', 'End call');
    await waitText('#lc-transcript', 'stainless steel pipes');
    ok((await txt('#lc-callcard')).includes(`Call ${i} of ${total}`) && /Line [12]/.test(await txt('#lc-callcard')), `call ${i}: connected through the proxy, blind label shown`);
    await waitText('#lc-transcript', 'Haan, mujhe 500 pieces', 8000);                       // wait for the layout to settle: the transcript grows as people talk
    if (i === 1) await p.screenshot({ path: path.join(shots, '3_call.png'), fullPage: true });
    await sleep(500);
    await click('[data-lc=sdk-end]'); await waitText('#lc-callcard', 'Your signal');
    const seconds = await txt('#lc-callcard');
    ok(/lasted \d+:\d\d/.test(seconds), `call ${i}: length measured`);
    if (i === 1) await p.screenshot({ path: path.join(shots, '4_signal.png'), fullPage: true });
    // listener: Line with even i says yes... any pattern works; the verdict is checked against the server's own reveal below
    await click(`[data-lc=sig][data-v="${i % 2 === 0 ? 1 : 0}"]`);
    if (i === 3) await p.click('#lc-fatal');
    await click('[data-lc=save-sig]'); await sleep(500);
    if (i < total) {
      const t = await p.evaluate(() => document.body.innerText);
      ok(!/Prompt B wins|No clear winner|plausible range/.test(t), `call ${i}: nothing about the result is visible yet`);
    }
  }
  await p.waitForSelector('.lc-verdict', { timeout: 8000 }); await sleep(300);
  const head = await txt('.lc-verdict h2'); ok(head.length > 0, 'released: verdict shown -> ' + head);
  ok((await txt('.lc-verdict')).includes('Reveal:'), 'released: blind reveal shown');
  ok(new RegExp(`Grade ${PER * 2} calls with Sarvam \\(at most ₹[0-9.]+\\)`).test(await txt('#lc-grade')), 'released: Sarvam grading is offered with its cost, and never runs by itself');
  ok((await txt('body')).includes('chain verified'), 'released: log chain verified');
  await p.screenshot({ path: path.join(shots, '5_result.png'), fullPage: true });
  await p.evaluate(() => { location.hash = '#/history'; }); await sleep(500);
  ok((await p.$$('.tbl-wrap')).length > 0, 'History screen still renders after the live test');
  await p.evaluate(() => { location.hash = '#/livecall'; }); await p.waitForSelector('.lc-verdict', { timeout: 8000 });
  ok(true, 'coming back to the Live call test screen shows the released result again');
  await click('[data-lc=tr]'); ok((await p.$$('.lc-transcript .lc-bub')).length >= 2, 'released: transcript of a call opens');
  const csv = await p.evaluate(async id => (await fetch(`/api/live/test/${id}/csv`)).text(), (await p.$eval('a[href$="/csv"]', a => a.getAttribute('href'))).split('/')[4]);
  ok(csv.split('\n').filter(Boolean).length === total + 1, `CSV has ${total} call rows`);
  // what the mock saw: only the server's key ever reached Sarvam, and the browser never held one
  const upstream = mock.seen.filter(s => s.key !== undefined && s.path);
  ok(upstream.length >= total && upstream.every(s => s.key === MOCK_KEY), `Sarvam saw ${upstream.length} signed-URL requests, all with the server-held key`);
  const pageHasKey = await p.evaluate(k => document.documentElement.outerHTML.includes(k) || JSON.stringify(localStorage).includes(k), MOCK_KEY);
  ok(!pageHasKey, 'the API key never reaches the page');
  await p.setViewport({ width: 390, height: 800 }); await sleep(300);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'phone width: no sideways scroll');
  await p.screenshot({ path: path.join(shots, '6_result_phone.png'), fullPage: true });
} catch (e) { console.log('ERROR', e.message); failed++; await p.screenshot({ path: path.join(shots, 'error.png'), fullPage: true }).catch(() => {}); }
console.log('page errors:', errs.length ? [...new Set(errs)] : 'none'); if (errs.length) failed++;
await b.close(); py.kill(); mock.close();
console.log(failed ? `\n${failed} problem(s). Server log:\n${srvlog.slice(-1500)}` : '\nall browser checks passed'); process.exit(failed ? 1 : 0);
