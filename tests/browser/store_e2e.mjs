// The history database in the browser (picky/store.py): what one browser saves, a second browser sees; a server restart keeps it;
// a reset reaches every browser; the offline file is unchanged. Starts its own server on a throw-away database.
// Usage: node store_e2e.mjs <python with numpy> [port]       (PICKY_ROOT = the repo, when this file is run from elsewhere)
import puppeteer from 'puppeteer-core';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const [py, port = '8797'] = process.argv.slice(2);
const ROOT = process.env.PICKY_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'picky-store-')), db = path.join(dir, 'h.db'), base = `http://127.0.0.1:${port}/`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, n, i) => { if (c) { pass++; console.log('ok   ' + n); } else { fail++; console.log('FAIL ' + n + (i !== undefined ? '  ' + JSON.stringify(i).slice(0, 300) : '')); } };

let srv;
const start = async () => {
  srv = spawn(py, ['-m', 'picky', 'serve', '--port', port], { cwd: ROOT, env: { ...process.env, PICKY_DB: db }, stdio: 'ignore' });
  for (let i = 0; i < 240; i++) { try { const r = await fetch(base + 'api/store/info'); if (r.ok) return; } catch { } await sleep(500); }
  throw new Error('the server did not start');
};
const stop = async () => { const done = new Promise(r => srv.on('exit', r)); srv.kill('SIGTERM'); await done; };
const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'X-Picky-Store': '1' }, body: JSON.stringify(body) }).then(r => r.json());
const sql = q => spawnSync(py, ['-c', `import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps(c.execute(sys.argv[2]).fetchall()))`, db, q], { encoding: 'utf8' }).stdout.trim();

const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const errs = [];
const browser = async () => { const ctx = await b.createBrowserContext(), p = await ctx.newPage(); await p.setViewport({ width: 1366, height: 900 }); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return p; };
const open = async (p, hash = '#/overview') => { await p.goto(base + hash, { waitUntil: 'load' }); await p.waitForFunction(() => typeof STORE !== 'undefined' && (STORE.epoch || !STORE.on) && document.querySelector('#nav a'), { timeout: 60000 }); };
const settle = async p => { await sleep(350); await p.waitForFunction(() => !STORE.busy && !STORE.again, { timeout: 30000 }); await sleep(250); };   // the 200 ms debounce, then the save itself

try {
  await start();
  // Browser 1: play the held demo test to its end, approve it, and launch a new test through the engine
  const p1 = await browser(); await open(p1);
  ok(await p1.evaluate(() => STORE.on && $('#state-note').textContent.includes('history database')), 'Live server: the console uses the history database and says so');
  await open(p1, '#/live/demo_hold'); await p1.click('#a-end'); await sleep(300); await p1.click('#a-approve'); await settle(p1);
  ok(await p1.evaluate(() => view(byId('demo_hold')).kind === 'PROMOTE'), 'Browser 1: the held test is approved');
  await p1.evaluate(() => { WZ = { ...wzDefaults(), name: 'store e2e', promptB: liveA().text + '\nx\n', audienceSet: true, primary: 'buylead_created', ui: {}, step: 6 }; go('new'); route(); }); await sleep(500);
  await p1.click('#w-launch'); await p1.waitForFunction(() => location.hash.startsWith('#/live/'), { timeout: 240000 }); await settle(p1);
  const id = await p1.evaluate(() => decodeURIComponent(location.hash.split('/')[2]));
  ok(JSON.parse(sql("SELECT origin, status FROM experiments WHERE id = '" + id + "'"))[0]?.[0] === 'launched', 'The launched test is in the database the moment it launches', id);

  // Browser 2 (its own empty storage) sees the same history
  const p2 = await browser(); await open(p2);
  const seen = await p2.evaluate(i => ({ launched: DYN.launched.map(e => e.id), hold: view(byId('demo_hold')).kind, pb: (byId(i) || {}).prompt_b && byId(i).prompt_b.length }), id);
  ok(seen.launched.includes(id) && seen.hold === 'PROMOTE', 'Browser 2: sees the launched test and the approval', seen);
  ok(seen.pb > 1000, 'Browser 2: prompt B comes back in full (stored once by hash)', seen.pb);
  await open(p2, '#/log'); ok((await p2.evaluate(() => $('#page').innerText)).includes('Approved'), 'Browser 2: the Decision Log shows the approval');

  // A stale browser cannot undo a newer save: browser 2 opened before browser 1 rolled the winner back
  await open(p2, '#/live/demo_win'); await p2.click('#a-end'); await settle(p2);
  const p2b = await browser(); await open(p2b, '#/live/demo_win');                       // browser 2b loads now: day 7, promoted, not rolled back
  await p2.click('#a-roll'); await settle(p2);                                           // browser 2 rolls back
  await p2b.evaluate(() => { dyn(byId('demo_win')).learning = 'stale note'; saveDyn(); });
  await p2b.waitForNavigation({ timeout: 30000 }).catch(() => { }); await p2b.waitForFunction(() => typeof STORE !== 'undefined' && STORE.epoch, { timeout: 60000 }); await sleep(500);
  const st2 = await p2b.evaluate(() => ({ kind: view(byId('demo_win')).kind, note: dyn(byId('demo_win')).learning }));
  ok(st2.kind === 'ROLLED_BACK' && st2.note !== 'stale note', 'Stale browser: its save is refused, it reloads, and the rollback stands', st2);
  ok(JSON.parse(sql("SELECT rolled_back FROM test_state WHERE experiment_id = 'demo_win'"))[0][0] === 1, 'Stale browser: the database still says rolled back');

  // A browser holding an old, broken test from before the database: that test stays local, everything else still saves
  const p5 = await browser(); await p5.goto(base + '#/overview', { waitUntil: 'load' });
  await p5.evaluate(() => { const bad = { id: 'exp-old-broken', kind: 'simulated', record: { config: { name: 'old' }, looks: [], result: {}, ledger: [] } }; localStorage.setItem('picky_console_v1', JSON.stringify({ dyn: { 'exp-old-broken': { day: 1 } }, launched: [bad], settings: {}, libLog: [], ui: {} })); });
  await p5.reload({ waitUntil: 'load' }); await p5.waitForFunction(() => typeof STORE !== 'undefined' && STORE.epoch && document.querySelector('#nav a'), { timeout: 60000 });   // a real reload: the planted state is read
  await p5.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /could not be saved/.test(t.textContent)), { timeout: 15000 }).catch(() => { });
  const toasts = await p5.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
  ok(/could not be saved/.test(toasts) && await p5.evaluate(() => DYN.launched.some(e => e.id === 'exp-old-broken')), 'Old broken test: the person is told, and it stays in this browser', toasts);
  await open(p5, '#/live/demo_flat'); await p5.click('#a-pause'); await settle(p5);
  ok(JSON.parse(sql("SELECT paused FROM test_state WHERE experiment_id = 'demo_flat'"))[0][0] === 1 && JSON.parse(sql("SELECT COUNT(*) FROM experiments WHERE id = 'exp-old-broken'"))[0][0] === 0,
     'Old broken test: later clicks still save; the broken test is not in the database');
  await p5.reload({ waitUntil: 'load' }); await p5.waitForFunction(() => typeof STORE !== 'undefined' && STORE.epoch, { timeout: 60000 }); await sleep(1500);
  const after = await p5.evaluate(() => ({ kept: DYN.launched.some(e => e.id === 'exp-old-broken'), toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ') }));
  ok(after.kept && !/could not be saved/.test(after.toasts), 'Old broken test: still in this browser after a reload, and not reported again', after);

  // A restart keeps everything
  await stop(); await start();
  const p3 = await browser(); await open(p3, '#/settings'); await sleep(1500);
  const s3 = await p3.evaluate(i => ({ has: DYN.launched.some(e => e.id === i), hold: view(byId('demo_hold')).kind, card: ($('#s-store') || {}).innerText || '' }), id);
  ok(s3.has && s3.hold === 'PROMOTE', 'After a server restart: the test and the approval are still there', s3);
  ok(/Tests launched here\s*1/.test(s3.card) && s3.card.includes('SQLite'), 'Settings: the History database card shows the counts', s3.card);
  const head = await p3.evaluate(async () => { const r = await fetch('/api/store/download'); const u = new Uint8Array(await r.arrayBuffer()); return String.fromCharCode(...u.slice(0, 15)); });
  ok(head === 'SQLite format 3', 'Download gives the SQLite file', head);
  const acts = JSON.parse(sql('SELECT action FROM actions ORDER BY id')).map(r => r[0]);
  ok(['advance_day', 'approve', 'launch', 'rollback', 'pause'].every(a => acts.includes(a)), 'The click log holds the days played, the approval, the launch, the rollback and the pause', acts);

  // A reset in browser 3 reaches browser 1, which still holds the old history
  await p3.click('#s-reset'); await p3.waitForFunction(() => typeof STORE !== 'undefined' && STORE.epoch && location.hash === '#/overview', { timeout: 60000 }); await sleep(500);
  ok(await p3.evaluate(() => DYN.launched.length === 0 && view(byId('demo_hold')).kind !== 'PROMOTE'), 'Reset: browser 3 starts from the untouched demo');
  await p1.evaluate(() => { dyn(byId('demo_flat')).paused = true; saveDyn(); });
  await p1.waitForNavigation({ timeout: 30000 }).catch(() => { }); await p1.waitForFunction(() => typeof STORE !== 'undefined' && STORE.epoch, { timeout: 60000 }); await sleep(500);
  ok(await p1.evaluate(() => DYN.launched.length === 0 && !dyn(byId('demo_flat')).paused), 'Reset: browser 1 is told, reloads, and does not write its old history back');
  ok(JSON.parse(sql("SELECT COUNT(*) FROM experiments WHERE origin = 'launched'"))[0][0] === 0, 'Reset: the database holds no launched test');

  // A browser from before the database joins AFTER another browser has opened the app: it keeps its draft, custom metric and approval
  const p6 = await browser(); await open(p6, '#/settings'); await settle(p6);      // its first save is done before the reset below
  await p6.evaluate(() => { localStorage.setItem('picky_console_v1', JSON.stringify({ dyn: { demo_hold: { day: 7, paused: false, approval: 'approved', rolledBack: false, manualStop: false, learning: 'old browser' } }, launched: [],
    settings: { customMetrics: [{ key: 'x_metric', name: 'X metric', type: 'rate', direction: 'higher', group: 'Custom', num: { unit: 'leads', where: [] }, den: { unit: 'leads', where: [] } }] },
    libLog: [{ ts: '2026-10-09T10:00:00', type: 'Saved', text: 'old log', exp: 'x' }], drafts: [{ id: 'd-old', name: 'old draft' }], ui: {} })); });
  await post('api/store/reset', {});                                                     // a clean history, then browser 1 opens the app and saves a draft
  const pn = await browser(); await open(pn); await pn.evaluate(() => { saveDraft({ ...wzDefaults(), name: 'new draft' }); }); await settle(pn);   // a fresh browser (an old tab would be refused after the reset)
  await p6.reload({ waitUntil: 'load' }); await p6.waitForFunction(() => typeof STORE !== 'undefined' && STORE.epoch, { timeout: 60000 }); await settle(p6);
  const mig = await p6.evaluate(() => ({ drafts: DYN.drafts.map(d => d.name).sort(), metric: customMetrics().some(m => m.key === 'x_metric'), hold: view(byId('demo_hold')).kind }));
  ok(mig.drafts.join() === 'new draft,old draft' && mig.metric && mig.hold === 'PROMOTE', 'Older browser joins later: both drafts, its custom metric and its approval are kept', mig);
  ok(JSON.parse(sql("SELECT approval FROM test_state WHERE experiment_id = 'demo_hold'"))[0]?.[0] === 'approved', 'Older browser joins later: its approval reaches the database');

  // A browser that was closed while the history was reset elsewhere opens normally and can still save drafts
  const p7 = await browser(); await open(p7); await p7.evaluate(() => { saveDraft({ ...wzDefaults(), name: 'before reset' }); }); await settle(p7);
  const cache = await p7.evaluate(() => localStorage.getItem('picky_console_v1')); await p7.close();
  await post('api/store/reset', {});
  const p8 = await browser(); await open(p8); await settle(p8); await p8.evaluate(c => localStorage.setItem('picky_console_v1', c), cache);
  await p8.reload({ waitUntil: 'load' }); await p8.waitForFunction(() => typeof STORE !== 'undefined' && STORE.epoch && document.querySelector('#nav a'), { timeout: 60000 }); await sleep(500);
  const re = await p8.evaluate(() => { saveDraft({ ...wzDefaults(), name: 'after reset' }); return { page: $('#page').innerText.length, drafts: DYN.drafts.map(d => d.name) }; });
  await settle(p8);                                                                     // its save is done before the next browser opens
  ok(re.page > 200 && re.drafts.join() === 'after reset', 'Closed during a reset elsewhere: the page renders and a draft saves; the old draft is dropped', re);

  // A browser holding many large tests (30 x ~200 KB): they go up in parts and the browser shows no "storage full" message
  const p9 = await browser(); await open(p9);
  const many = await p9.evaluate(async () => { const big = 'y'.repeat(200000); for (let i = 0; i < 30; i++) DYN.launched.push({ ...JSON.parse(JSON.stringify(C.demo[0])), id: 'exp-bulk-' + i, prompt_b: big + i }); saveDyn();
    for (let t = 0; t < 120 && (STORE.busy || STORE.again || DYN.launched.some(e => !STORE.sent['t:' + e.id])); t++) await new Promise(r => setTimeout(r, 500));
    saveDyn(); return { toasts: [...document.querySelectorAll('.toast')].map(x => x.textContent).join(' | '), cacheChars: localStorage.getItem('picky_console_v1').length }; });
  ok(JSON.parse(sql("SELECT COUNT(*) FROM experiments WHERE id LIKE 'exp-bulk-%'"))[0][0] === 30 && !/could not|reset the demo/i.test(many.toasts) && many.cacheChars < 1e6, 'Many large tests at once: all 30 stored (sent in parts), no error, the browser cache stays small', many);
  await post('api/store/reset', {});

  // The server is out of reach for a while: the changes made meanwhile survive a reload and reach the database afterwards
  const block = async (p, on, reads = false) => { if (!p._icpt) { await p.setRequestInterception(true); p.on('request', r => (p._block && r.url().includes('/api/store') && (r.method() === 'POST' || p._reads)) ? r.abort('failed') : r.continue()); p._icpt = true; } p._block = on; p._reads = reads; };
  const p12 = await browser(); await open(p12, '#/live/demo_hold'); await p12.evaluate(() => { dyn(byId('demo_hold')).day = 3; saveDyn(); }); await settle(p12);
  await block(p12, true); await open(p12, '#/live/demo_hold'); await p12.click('#a-end'); await sleep(300); await p12.click('#a-approve'); await p12.evaluate(() => saveDraft({ ...wzDefaults(), name: 'offline draft' })); await sleep(1500);
  const warned = await p12.evaluate(() => [...document.querySelectorAll('.toast')].some(t => /Could not save/.test(t.textContent)));
  await block(p12, false); await p12.reload({ waitUntil: 'load' }); await p12.waitForFunction(() => typeof STORE !== 'undefined' && STORE.epoch, { timeout: 60000 }); await settle(p12);
  const off = await p12.evaluate(() => ({ hold: view(byId('demo_hold')).kind, draft: DYN.drafts.some(d => d.name === 'offline draft') }));
  ok(warned && off.hold === 'PROMOTE' && off.draft, 'Server out of reach: the approval and the draft made meanwhile survive a reload', { warned, ...off });
  ok(JSON.parse(sql("SELECT approval FROM test_state WHERE experiment_id = 'demo_hold'"))[0]?.[0] === 'approved' && sql("SELECT value FROM app_state WHERE key = 'drafts'").includes('offline draft'),
     'Server out of reach: once it is back, the approval and the draft reach the database');

  // An older browser's first save is cut off (tab closed, server busy): its merged drafts are not lost on the next open
  const p10 = await browser(); await block(p10, true); await p10.goto(base + '#/overview', { waitUntil: 'load' }); await p10.waitForFunction(() => typeof STORE !== 'undefined' && STORE.epoch, { timeout: 60000 }); await sleep(500);
  await p10.evaluate(() => localStorage.setItem('picky_console_v1', JSON.stringify({ dyn: {}, launched: [], settings: {}, libLog: [], drafts: [{ id: 'd-cut', name: 'cut-off draft' }], ui: {} })));
  await p10.reload({ waitUntil: 'load' }); await p10.waitForFunction(() => typeof STORE !== 'undefined' && STORE.epoch, { timeout: 60000 }); await sleep(800);
  const p11 = await p10.browserContext().newPage(); p11.on('pageerror', e => errs.push(e.message)); await p10.close(); await open(p11); await settle(p11);
  ok(await p11.evaluate(() => DYN.drafts.some(d => d.name === 'cut-off draft')) && sql("SELECT value FROM app_state WHERE key = 'drafts'").includes('cut-off draft'), 'First save cut off: the older browser\'s draft is kept and saved on the next open');

  // The database cannot even be read when the page opens: the changes made in that session are remembered and sent once it is back
  const p15 = await browser(); await open(p15); await p15.evaluate(() => { dyn(byId('demo_segment')).day = 3; saveDyn(); }); await settle(p15);
  await block(p15, true, true); await p15.reload({ waitUntil: 'load' }); await p15.waitForFunction(() => typeof STORE !== 'undefined' && STORE.track && document.querySelector('#nav a'), { timeout: 60000 });
  await p15.evaluate(() => { dyn(byId('demo_segment')).day = 7; dyn(byId('demo_segment')).learning = 'made while unreachable'; saveDyn(); saveDraft({ ...wzDefaults(), name: 'unreachable draft' }); }); await sleep(500);
  await block(p15, false); await p15.reload({ waitUntil: 'load' }); await p15.waitForFunction(() => typeof STORE !== 'undefined' && STORE.epoch, { timeout: 60000 }); await settle(p15);
  const un = await p15.evaluate(() => ({ seg: DYN.dyn.demo_segment, draft: DYN.drafts.some(d => d.name === 'unreachable draft') }));
  ok(un.seg.day === 7 && un.seg.learning === 'made while unreachable' && un.draft, 'Database unreadable when the page opened: the changes made then survive a reload', un);
  ok(sql("SELECT state FROM test_state WHERE experiment_id = 'demo_segment'").includes('made while unreachable') && sql("SELECT value FROM app_state WHERE key = 'drafts'").includes('unreachable draft'), '... reach the database once it is back');

  // Two tabs of one browser during an outage: tab B's save does not wipe tab A's unsaved change from the shared cache
  const pa = await browser(); await open(pa); await block(pa, true);
  await pa.evaluate(() => { dyn(byId('demo_flat')).day = 5; dyn(byId('demo_flat')).learning = 'tab A note'; saveDyn(); }); await sleep(800);
  const pb = await pa.browserContext().newPage(); pb.on('pageerror', e => errs.push(e.message)); await open(pb); await pb.evaluate(() => { dyn(byId('demo_win')).paused = true; saveDyn(); }); await settle(pb);
  const ab = pb.browserContext(); await pa.close(); await pb.close();                   // the same browser (one shared cache), both tabs closed
  const tabC = await ab.newPage(); tabC.on('pageerror', e => errs.push(e.message)); await open(tabC); await settle(tabC);
  const two = await tabC.evaluate(() => ({ flat: DYN.dyn.demo_flat, win: DYN.dyn.demo_win && DYN.dyn.demo_win.paused }));
  ok(two.flat && two.flat.day === 5 && two.flat.learning === 'tab A note' && two.win, 'Two tabs in an outage: tab A\'s change survives tab B\'s save and a reopen', two);
  ok(sql("SELECT state FROM test_state WHERE experiment_id = 'demo_flat'").includes('tab A note'), 'Two tabs in an outage: tab A\'s change reaches the database');

  // A brand-new browser does not touch the saved settings (no false "newer version" for the browser that saved them)
  const p13 = await browser(); await open(p13); await p13.evaluate(() => { DYN.settings = { ...DYN.settings, customMetrics: [{ key: 'm5', name: 'M5', type: 'rate', direction: 'higher', group: 'Custom', num: { unit: 'leads', where: [] }, den: { unit: 'leads', where: [] } }] }; saveDyn(); }); await settle(p13);
  const rev0 = JSON.parse(sql("SELECT rev FROM app_state WHERE key = 'settings'"))[0][0];
  const p14 = await browser(); await open(p14); await settle(p14);
  const rev1 = JSON.parse(sql("SELECT rev FROM app_state WHERE key = 'settings'"))[0][0];
  await p13.evaluate(() => { DYN.settings = { ...DYN.settings, confidence: 0.99 }; saveDyn(); }); await settle(p13);
  const conflict = await p13.evaluate(() => [...document.querySelectorAll('.toast')].some(t => /newer version/.test(t.textContent)));
  ok(rev1 === rev0 && !conflict && JSON.parse(sql("SELECT rev FROM app_state WHERE key = 'settings'"))[0][0] === rev0 + 1, 'A new browser leaves the settings alone; the owner saves again with no false conflict', { rev0, rev1, conflict });

  // The offline file has no server: unchanged behaviour
  const p4 = await browser(); await p4.goto('file://' + path.join(ROOT, 'dist', 'picky_demo.html') + '#/overview', { waitUntil: 'load' }); await sleep(800);
  ok(await p4.evaluate(() => STORE.on === false && $('#state-note').textContent.includes('kept in this browser')), 'Offline file: keeps its state in the browser, as before');
} finally {
  if (srv && srv.exitCode === null) await stop();
  await b.close(); fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed; page errors: ${errs.length ? errs.join(' | ') : 'none'}`); process.exit(fail || errs.length ? 1 : 0);
