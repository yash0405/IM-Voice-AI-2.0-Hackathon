// A stand-in for Sarvam's voice runtime, speaking the protocol of sarvam-conv-ai-sdk 0.0.42 (read from the SDK source):
//   GET  /api/app-runtime/orgs/:org/workspaces/:ws/apps/:app/url?interaction_type=call&version=N   (X-API-Key)  ->  {url, reference_id}
//   WS   url:  client sends client.action.interaction_start; server answers server.action.interaction_connected {interaction_id},
//        then server.event.transcription (role, content) and server.media.audio_chunk (base64 16-bit PCM), and finally server.action.interaction_end.
// It proves OUR code (proxy, page, call timing, transcript capture, signal, release); it cannot prove Sarvam's real server behaves the same.
import http from 'node:http';
import { WebSocketServer } from 'ws';

export const MOCK_KEY = 'mock-voice-key';
const silence = ms => Buffer.alloc(Math.round(16 * ms) * 2).toString('base64');       // 16 kHz mono 16-bit

export function startMock({ replyMs = 400, autoEndMs = 0 } = {}) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const m = u.pathname.match(/^\/api\/app-runtime\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps\/([^/]+)\/url$/);
    seen.push({ path: req.url, key: req.headers['x-api-key'] || '' });
    if (!m) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"detail":"Not Found"}'); }
    if (req.headers['x-api-key'] !== MOCK_KEY) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: '(401) Unauthorized', type: 'unauthorized', code: 401, data: { details: 'Invalid API key format.' } } })); }
    if (m[3] === 'missing-app') { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"detail":"app not found"}'); }
    const port = srv.address().port;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: `ws://127.0.0.1:${port}/ws?app=${m[3]}&v=${u.searchParams.get('version') || ''}`, reference_id: 'ref-' + Date.now() }));
  });
  const wss = new WebSocketServer({ server: srv, path: '/ws' });
  let n = 0;
  wss.on('connection', (ws, req) => {
    const app = new URL(req.url, 'http://x').searchParams.get('app');
    const iid = 'int-' + app + '-' + (++n);
    let audioIn = 0, replied = false;
    const send = o => { try { ws.send(JSON.stringify({ origin: 'server', timestamp: Date.now() / 1000, ...o })); } catch (e) { /* closed */ } };
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      seen.push({ ws: m.type });
      if (m.type === 'client.action.interaction_start') {
        send({ type: 'server.action.interaction_connected', interaction_id: iid });
        setTimeout(() => {
          send({ type: 'server.event.transcription', role: 'bot', content: `Namaste, kya aap stainless steel pipes ke liye call kar rahe hain? (${app})` });
          send({ type: 'server.media.audio_chunk', status: 'pending', audio_base64: silence(300) });
          send({ type: 'server.media.audio_chunk', status: 'completed', audio_base64: '' });
        }, 150);
        if (autoEndMs) setTimeout(() => send({ type: 'server.action.interaction_end' }), autoEndMs);
      } else if (m.type === 'client.media.audio_chunk') {
        audioIn++;
        if (!replied && audioIn > 3) {
          replied = true;
          setTimeout(() => { send({ type: 'server.event.transcription', role: 'user', content: 'Haan, mujhe 500 pieces chahiye.' }); send({ type: 'server.event.transcription', role: 'bot', content: 'Theek hai. Aapka naam kya hai?' }); }, replyMs);
        }
      } else if (m.type === 'client.action.interaction_end') {
        send({ type: 'server.action.interaction_end' });
      }
    });
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, seen, close: () => { wss.close(); srv.close(); } })));
}
