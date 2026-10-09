"""Server for the live call test (its own port, separate from the main Canary console). Standard library only.

It does four jobs: serves the call page, exposes the test API (livecall.py), and holds the Sarvam Voice Agents key so the browser never
sees it. The browser SDK asks for a short-lived signed WebSocket URL; this server makes that one GET for it (the SDK's documented
`baseUrl` proxy pattern) and the browser then talks to Sarvam's voice servers directly with the signed URL.

Because this process holds a key that can start billable calls, it only answers requests addressed to 127.0.0.1/localhost, and POSTs
must come from this same page (checked with the Origin header and a JSON content type), so another web page cannot drive it.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import livecall, livestats

WEB = Path(__file__).resolve().parent.parent / "web" / "live"
RUNTIME_BASE = os.environ.get("SARVAM_VOICE_RUNTIME_BASE", "https://apps.sarvam.ai/api/app-runtime/")
ANALYTICS_BASE = os.environ.get("SARVAM_VOICE_ANALYTICS_BASE", "https://apps.sarvam.ai/api/analytics/v1/")
DEFAULT_PORT = 8790
_ID = r"[A-Za-z0-9_.:-]{1,80}"
_TABLE: dict = {}
_TABLE_LOCK = threading.Lock()
SERVER_PORT = [DEFAULT_PORT]
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "[::1]"}


def plan_table(conf: float) -> list[dict]:
    with _TABLE_LOCK:
        if conf not in _TABLE:
            _TABLE[conf] = livestats.plan_table(alpha=round(1 - conf, 2))
        return _TABLE[conf]


def _upstream(url: str, headers: dict, timeout: float = 20.0):
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("Content-Type", "application/json"), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", "application/json") if e.headers else "application/json", e.read()
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return 502, "application/json", json.dumps({"error": f"could not reach Sarvam: {getattr(e, 'reason', e)}"}).encode()


def signed_url_request(org: str, ws: str, app: str, query: dict) -> tuple[int, str, bytes]:
    key = livecall.voice_api_key()
    if not key:
        return 503, "application/json", json.dumps({"error": "SARVAM_VOICE_API_KEY is not set (see LIVE_CALL_TEST.md)"}).encode()
    q = urllib.parse.urlencode({k: v for k, v in query.items() if k in ("interaction_type", "version") and v})
    url = f"{RUNTIME_BASE}orgs/{org}/workspaces/{ws}/apps/{app}/url" + (f"?{q}" if q else "")
    return _upstream(url, {"X-API-Key": key})


def check_connection() -> dict:
    """Ask Sarvam for a signed URL for each prompt's agent, without opening it: proves the key, ids and committed versions work. Places no call."""
    con = livecall.connection()
    res = {}
    for arm in ("A", "B"):
        a = con["arms"][arm]
        if not con["key_set"]:
            res[arm] = {"ok": False, "detail": "no Voice Agents API key set"}
        elif not (con["org_id"] and con["workspace_id"] and a["app_id"]):
            res[arm] = {"ok": False, "detail": "organisation, workspace and agent id are needed"}
        else:
            code, _, body = signed_url_request(con["org_id"], con["workspace_id"], a["app_id"], {"interaction_type": "call", "version": a["version"]})
            ok = 200 <= code < 300 and b'"url"' in body
            detail = "ready" if ok else _short_error(code, body)
            res[arm] = {"ok": ok, "detail": detail}
    return {"checks": res, "all_ok": all(r["ok"] for r in res.values())}


def _short_error(code: int, body: bytes) -> str:
    """One plain sentence for the connection check; the upstream detail is appended when it is short."""
    msg = ""
    try:
        j = json.loads(body)
        err = j.get("error") if isinstance(j, dict) else None
        if isinstance(err, dict):
            msg = str((err.get("data") or {}).get("details") or err.get("message") or "")
        elif err or (isinstance(j, dict) and j.get("detail")):
            msg = str(err or j.get("detail"))
    except ValueError:
        pass
    hints = {401: "the API key was not accepted (make a Voice Agents key in indus.sarvam.ai > Settings > API Key)", 403: "the key has no access to this workspace",
             404: "organisation, workspace, agent id or committed version not found", 429: "rate limited, wait a minute", 502: "could not reach Sarvam"}
    return hints.get(code, f"error {code}") + (f" ({msg[:120]})" if msg else "")


class H(BaseHTTPRequestHandler):
    server_version = "CanaryLive/1"

    def log_message(self, *a):
        pass

    # ---- plumbing
    def _send(self, code: int, ctype: str, data: bytes, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _json(self, obj, code: int = 200):
        self._send(code, "application/json", json.dumps(obj, separators=(",", ":")).encode())

    def _host_ok(self) -> bool:
        """Only answer requests addressed to this machine (blocks DNS-rebinding pages from reaching a server that holds a key)."""
        h = (self.headers.get("Host") or "").strip().lower()
        name = h[: h.index("]") + 1] if h.startswith("[") else h.rsplit(":", 1)[0]
        return name in ALLOWED_HOSTS or getattr(self.server, "open_host", False)

    def _origin_ok(self) -> bool:
        o = self.headers.get("Origin")
        if not o:
            return True
        return urllib.parse.urlparse(o).netloc == self.headers.get("Host")

    def _static(self, rel: str):
        root = WEB.resolve()
        p = (WEB / rel).resolve()
        if root not in p.parents or not p.is_file():
            return self._send(404, "text/plain", b"not found")
        self._send(200, mimetypes.guess_type(str(p))[0] or "application/octet-stream", p.read_bytes())

    # ---- GET
    def do_GET(self):
        if not self._host_ok():
            return self._send(403, "text/plain", b"this server only answers requests addressed to localhost")
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        one = lambda k, d="": (q.get(k) or [d])[0]
        try:
            if u.path in ("/", "/index.html"):
                return self._static("index.html")
            if u.path in ("/live.css", "/live.js"):
                return self._static(u.path[1:])
            if u.path == "/vendor/sarvam-conv-ai-sdk.browser.js":
                return self._static("vendor/sarvam-conv-ai-sdk.browser.js")
            if u.path == "/api/live/state":
                con = livecall.connection()
                return self._json({"connection": con, "active": livecall.active_test(), "tests": livecall.list_tests()[-8:][::-1],
                                   "candidates": livecall.candidates(), "default_candidate": livecall.default_candidate(),
                                   "confidence": {str(int(k * 100)): v for k, v in livecall.CONFIDENCE.items()}, "limits": livecall.LIMITS, "roles": livecall.BUYER_ROLES,
                                   "port": SERVER_PORT[0]})
            if u.path == "/api/live/pair":
                return self._json(livecall.prompt_pair(one("candidate", livecall.default_candidate())))
            if u.path == "/api/live/plan":
                return self._json(livecall.plan_info(int(one("n", "10")), float(one("conf", "0.9"))))
            if u.path == "/api/live/plan_table":
                conf = float(one("conf", "0.9"))
                if round(conf, 2) not in livecall.CONFIDENCE:
                    raise livecall.LiveError("confidence must be 80, 90 or 95")
                return self._json({"rows": plan_table(round(conf, 2))})
            if (m := re.fullmatch(r"/api/live/prompt/([AB])", u.path)):
                text = livecall.agent_prompt(m.group(1), one("candidate", livecall.default_candidate()))
                return self._send(200, "text/plain; charset=utf-8", text.encode(), {"Content-Disposition": f'attachment; filename="vani_prompt_{m.group(1)}.md"'})
            if (m := re.fullmatch(r"/api/live/test/(lt-[0-9a-f-]+)", u.path)):
                return self._json(livecall.get_test(m.group(1)))
            if (m := re.fullmatch(r"/api/live/test/(lt-[0-9a-f-]+)/csv", u.path)):
                return self._send(200, "text/csv; charset=utf-8", livecall.export_csv(m.group(1)).encode(),
                                  {"Content-Disposition": f'attachment; filename="{m.group(1)}_results.csv"'})
            if (m := re.fullmatch(rf"/sarvam/orgs/({_ID})/workspaces/({_ID})/apps/({_ID})/url", u.path)):
                con = livecall.connection()
                org, ws, app = m.groups()
                if org != con["org_id"] or ws != con["workspace_id"] or app not in {con["arms"]["A"]["app_id"], con["arms"]["B"]["app_id"]}:
                    return self._json({"error": "this agent is not one of the two configured for the test"}, 403)
                code, ctype, body = signed_url_request(org, ws, app, {k: v[0] for k, v in q.items()})
                return self._send(code, ctype, body)
            if (m := re.fullmatch(r"/api/live/recording/(lt-[0-9a-f-]+)/(c\d{3})", u.path)):
                return self._recording(m.group(1), m.group(2))
            self._send(404, "text/plain", b"not found")
        except (livecall.LiveError, ValueError) as e:
            self._json({"error": str(e)}, 400)
        except Exception as e:  # pragma: no cover
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    def _recording(self, tid: str, cid: str):
        t = livecall.get_test(tid)
        if t["state"] != "released":
            return self._json({"error": "recordings open when the result is released"}, 403)
        call = next((c for c in t["calls"] if c["id"] == cid), None)
        if not call or not call.get("interaction_id") or not call.get("app_id"):
            return self._json({"error": "this call has no Sarvam interaction id (it was logged by hand)"}, 404)
        con = livecall.connection()
        key = livecall.voice_api_key()
        if not key:
            return self._json({"error": "no Voice Agents API key"}, 503)
        code, ctype, body = _upstream(f"{ANALYTICS_BASE}{con['org_id']}/{con['workspace_id']}/{call['app_id']}/recordings/{call['interaction_id']}", {"X-API-Key": key}, 30)
        if code == 200 and ctype.startswith("audio/"):
            return self._send(200, ctype, body)
        if code == 200:
            try:
                j = json.loads(body)
                url = next((v for k, v in (j.items() if isinstance(j, dict) else []) if isinstance(v, str) and v.startswith("https://") and "url" in k.lower()), None)
            except ValueError:
                url = None
            if url:
                return self._send(302, "text/plain", b"", {"Location": url})
        self._json({"error": "Sarvam did not return a playable recording for this call; open it in Sarvam > Monitor > Call Logs using the interaction id"}, 404)

    # ---- POST
    def do_POST(self):
        if not self._host_ok():
            return self._send(403, "text/plain", b"this server only answers requests addressed to localhost")
        if not self._origin_ok() or "application/json" not in (self.headers.get("Content-Type") or ""):
            return self._json({"error": "requests must come from the live call page"}, 403)
        n = int(self.headers.get("Content-Length") or 0)
        if n > 400_000:
            return self._json({"error": "body too large"}, 413)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(body, dict):
                raise livecall.LiveError("expected a JSON object")
            p = self.path.split("?")[0]
            if p == "/api/live/connection":
                return self._json(livecall.save_connection(body))
            if p == "/api/live/check":
                return self._json(check_connection())
            if p == "/api/live/test":
                return self._json(livecall.create_test(body))
            if (m := re.fullmatch(r"/api/live/test/(lt-[0-9a-f-]+)/call", p)):
                return self._json(livecall.next_call(m.group(1), str(body.get("source", "sdk"))))
            if (m := re.fullmatch(r"/api/live/test/(lt-[0-9a-f-]+)/call/(c\d{3})/(start|end|signal|void)", p)):
                tid, cid, act = m.groups()
                if act == "start":
                    return self._json(livecall.start_call(tid, cid))
                if act == "end":
                    return self._json(livecall.end_call(tid, cid, body))
                if act == "signal":
                    return self._json(livecall.signal(tid, cid, body))
                return self._json(livecall.void_call(tid, cid, str(body.get("reason", ""))))
            if (m := re.fullmatch(r"/api/live/test/(lt-[0-9a-f-]+)/abandon", p)):
                return self._json(livecall.abandon(m.group(1), str(body.get("reason", ""))))
            self._send(404, "text/plain", b"not found")
        except (livecall.LiveError, ValueError, KeyError, TypeError) as e:
            self._json({"error": str(e)}, 400)
        except Exception as e:  # pragma: no cover
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)


def serve(port: int = DEFAULT_PORT, host: str = "127.0.0.1"):
    SERVER_PORT[0] = port
    srv = ThreadingHTTPServer((host, port), H)
    srv.open_host = host not in ("127.0.0.1", "localhost")
    threading.Thread(target=lambda: [plan_table(0.9)], daemon=True).start()       # warm the pre-test table
    con = livecall.connection()
    print(f"Canary live call test on http://{host}:{port}   (Ctrl+C to stop)")
    print(f"  Sarvam Voice Agents key: {'set' if con['key_set'] else 'NOT set (add SARVAM_VOICE_API_KEY to .env; see LIVE_CALL_TEST.md)'}")
    if host not in ("127.0.0.1", "localhost"):
        print("WARNING: this server holds a Sarvam key that can start billable calls. Do not expose it beyond a network you trust.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
