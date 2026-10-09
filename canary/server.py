"""Local server: dashboard, live engine API, Label Lab. Standard library only."""
from __future__ import annotations

import json
import mimetypes
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import arena, build, labels, sarvam_pipe
from .evaluator import load_dispositions, load_schema
from .scenarios import ORDER
from .synth import benchmark_report

WEB = build.WEB
_cache: dict = {}
_lock = threading.Lock()

RUN_FIELDS = {"true_a": float, "true_b": float, "dur_mult_b": float, "log_drop_b": float, "seed": int}
CFG_FIELDS = {"share_b": float, "baseline": float, "mde": float, "guardrail_margin": float, "window_days": int,
              "leads_per_day": int, "assignment": str, "variant_b": str, "approval": str, "name": str}


def bundle_live() -> dict:
    with _lock:
        if "bundle" not in _cache:
            cached = build.OUT / "bundle.json"
            _cache["bundle"] = json.loads(cached.read_text()) if cached.exists() else build.build_bundle()
        b = dict(_cache["bundle"])
    b["live"] = True
    b["labels"] = labels.summary()
    b["auto"] = sarvam_pipe.auto_info()
    b["arena"] = arena.load()
    return b


def run_decide(body: dict) -> dict:
    """Decide from results files sent by the dashboard: {"files": [{"name", "text", "arm"}], "opts": {...}}."""
    from . import decide
    files = body.get("files") or []
    if len(files) > 4 or sum(len(f.get("text", "")) for f in files) > 12_000_000:
        raise ValueError("send at most 4 files, 12 MB in total")
    try:
        rec = decide.decide([{"name": str(f.get("name", "file")), "text": str(f.get("text", "")), "arm": f.get("arm") or None} for f in files], body.get("opts") or {})
    except decide.DataError as e:
        raise ValueError(str(e))
    meta = {"key": "files", "title": "Results from files", "story": "The test ran elsewhere; these are its results, judged by the same rules.", "expect": "-",
            "true_a": None, "true_b": None, "seed": None, "source": "files"}
    return {"meta": meta, "record": rec, "replay": {"same_decision": True, "same_ledger_head": True}}


def run_custom(body: dict) -> dict:
    sc_over, cfg_over = {}, {}
    for k, t in RUN_FIELDS.items():
        if k in body:
            sc_over[k] = t(body[k])
    for k, t in CFG_FIELDS.items():
        if k in body:
            cfg_over[k] = t(body[k])
    cfg_over["exp_id"] = "exp-custom"
    if "baseline" not in cfg_over and "true_a" in sc_over:
        cfg_over["baseline"] = round(min(max(sc_over["true_a"], 0.01), 0.9), 3)
    if cfg_over.get("window_days", 14) * cfg_over.get("leads_per_day", 600) > 60000:
        raise ValueError("window_days x leads_per_day is capped at 60,000 for the live demo")
    for k in ("true_a", "true_b"):
        if k in sc_over and not 0 < sc_over[k] < 1:
            raise ValueError(f"{k} must be between 0 and 1")
    b = build.scenario_bundle("b_wins", cfg_over=cfg_over, sc_over={**sc_over, "key": "custom",
                              "title": "Custom experiment", "story": "Your own settings; the truth is whatever you set.",
                              "expect": "-"})
    return b


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _json(self, obj, code=200):
        data = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _file(self, path: Path, ctype: str | None = None):
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype or mimetypes.guess_type(str(path))[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        try:
            if u.path in ("/", "/index.html"):
                html = (WEB / "index.html").read_text()
                html = html.replace('<script src="app.js"></script>',
                                    '<script>window.CANARY_LIVE=true;</script><script src="app.js"></script>')
                data = html.encode()
                self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
            elif u.path in ("/style.css", "/app.js", "/simple.js"):
                self._file(WEB / u.path[1:])
            elif u.path == "/api/bundle":
                self._json(bundle_live())
            elif u.path == "/api/samples":
                from . import samples
                self._json({k: {"title": v["title"], "note": v["note"], "lpd": v["lpd"], "days": v["days"]} for k, v in samples.SAMPLES.items()})
            elif (m := re.fullmatch(r"/api/sample/([a-z_]+)", u.path)):
                from . import samples
                key = m.group(1)
                if key not in samples.SAMPLES:
                    self.send_error(404)
                else:
                    self._json({"name": f"results_{key}.csv", "text": samples.to_csv(samples.make_rows(key))})
            elif u.path == "/api/labels/summary":
                self._json(labels.summary())
            elif u.path == "/api/labels/next":
                who = q.get("labeler", [""])[0]
                c = (labels.next_review(who) or labels.next_for(who)) if who else None
                self._json({"call": c, "summary": labels.summary(), "dispositions": load_dispositions(), "schema": load_schema()})
            elif u.path == "/api/evalbench":
                self._json(benchmark_report())
            elif (m := re.fullmatch(r"/api/transcript/(\d+)", u.path)):
                f = sarvam_pipe.TR / f"{int(m.group(1))}.json"
                self._json({"text": json.loads(f.read_text())["text"]} if f.exists() else {"text": None})
            elif (m := re.fullmatch(r"/arena/([a-z_]+_[AB]\.mp3)", u.path)):
                self._file(arena.ARENA / m.group(1), "audio/mpeg")
            elif (m := re.fullmatch(r"/audio/(\d+)", u.path)):
                idx = int(m.group(1))
                row = next((r for r in labels.calls() if r["idx"] == idx), None)
                if not row:
                    self.send_error(404)
                else:
                    self._file(labels.RECORDINGS / row["file"], "audio/mpeg")
            else:
                self.send_error(404)
        except Exception as e:  # pragma: no cover
            self._json({"error": str(e)}, 500)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        if n > (14_000_000 if self.path in ("/api/decide", "/api/inspect") else 20000):
            return self._json({"error": "body too large"}, 413)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/api/run":
                self._json(run_custom(body))
            elif self.path == "/api/decide":
                self._json(run_decide(body))
            elif self.path == "/api/inspect":
                from . import decide
                try:
                    self._json(decide.inspect(str(body.get("text", "")), str(body.get("name", "file"))))
                except decide.DataError as e:
                    self._json({"error": str(e)}, 400)
            elif self.path == "/api/labels":
                row = labels.add(body["idx"], body["labeler"], body["label"], body.get("note", ""), body.get("fields"), body.get("flags"))
                self._json({"ok": True, "row": row, "summary": labels.summary()})
            else:
                self.send_error(404)
        except (ValueError, KeyError, TypeError) as e:
            self._json({"error": str(e)}, 400)
        except Exception as e:  # pragma: no cover
            self._json({"error": str(e)}, 500)


def serve(port: int = 8765, host: str = "127.0.0.1"):
    threading.Thread(target=bundle_live, daemon=True).start()      # warm the cache
    srv = ThreadingHTTPServer((host, port), H)
    print(f"Canary live on http://{host}:{port}   (Ctrl+C to stop)")
    if host != "127.0.0.1":
        print("WARNING: this serves call audio to anyone on your network. Use only on the office network and stop it when labelling is done.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
