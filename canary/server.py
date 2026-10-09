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


def console_live() -> dict:
    with _lock:
        if "console" not in _cache:
            cached = build.OUT / "console_bundle.json"
            _cache["console"] = json.loads(cached.read_text()) if cached.exists() else build.build_console_bundle()
        b = dict(_cache["console"])
    b["live"] = True
    return b


def run_wizard(body: dict) -> dict:
    """Launch a new simulated experiment from the New Experiment wizard. Returns the experiment as the console stores it."""
    from . import console
    num = lambda k, d, t=float: t(body.get(k, d))
    win, share, lpd = num("window_days", 7, int), num("share_b", 0.30), num("leads_per_day", 1000, int)
    if win not in (7, 14, 21, 28):
        raise ValueError("test length must be 7, 14, 21 or 28 days: whole weeks cover a full week of patterns, and a longer test drags on")
    if not 1 <= lpd <= 20000 or win * lpd > 60000:
        raise ValueError("1-20,000 leads a day; days x leads a day is capped at 60,000 for the live demo")
    effect = num("effect_rel", 0.0)
    if not -0.9 <= effect <= 3.0:
        raise ValueError("the simulated effect must be between -90% and +300%")
    over = dict(share_b=share, baseline=num("baseline", 0.45), mde=num("mde", 0.05), window_days=win, leads_per_day=lpd,
                rule_set=str(body.get("rule_set", "final_look")), alpha=(1 - num("confidence", 0.95)) / 2, alpha_harm_daily=1 - num("harm_bar", 0.999),
                guardrail_margin=num("duration_margin", 0.10), approval=str(body.get("approval", "auto")), min_per_arm=num("min_leads_per_arm", 1000, int),
                assignment=str(body.get("assignment", "stratified")))
    from . import catalog
    seg = catalog.validate_segment(body.get("segment"))            # raises a plain message for an in-call variable or a segment that is too small
    if seg:
        over.update(segment=seg, assignment="stratified")
        if win * lpd * catalog.segment_share(seg) < 200:
            raise ValueError("this segment has too few leads for the window: widen it, raise leads per day or lengthen the test")
    goal = str(body.get("primary_goal") or "buylead_created")
    if goal not in {m["key"] for m in console.metrics() if m["role"] == "goal"}:
        raise ValueError(f"unknown primary goal {goal!r}")
    over.update(primary_goal=goal, primary_direction="lower" if body.get("primary_direction") == "lower" else "higher")
    if body.get("duration_on") is False:
        over.update(secondary_role="none")
    if body.get("early_hangup"):
        over.update(guard_rate="early_hangup", guard_rate_margin=num("rate_margin_pp", 2) / 100.0)
    name = str(body.get("name") or "New experiment")[:120]
    exp_id = "exp-" + "".join(ch for ch in name.lower().replace(" ", "-") if ch.isalnum() or ch == "-")[:40] + "-" + str(num("seed", 7, int))
    from datetime import datetime
    start = str(body.get("start") or datetime(2026, 10, 9, 9).isoformat(timespec="seconds"))
    variant = str(body.get("variant_b", "cap_two_asks"))
    full = str(body.get("full_prompt") or "")
    if full:
        from . import promptlint, variants as _v
        if len(full) > 400_000:
            raise ValueError("the pasted prompt is too long (400,000 characters at most)")
        rep = promptlint.variable_report(_v.load_base()["text"], full)
        if not rep["ok"]:
            raise ValueError("prompt B no longer uses these template variables: " + ", ".join(rep["dropped"]))
        variant = _v.register_text(name, full)
    rec = console.run_preset(name, variant, start, exp_id, effect, num("seed", 7, int), dur_mult=num("dur_mult", 1.0), hang_extra=max(0.0, num("hang_extra_pp", 0.0)) / 100.0, **over)
    return {"id": exp_id, "kind": "simulated", "preset": str(body.get("preset", "Custom")), "hypothesis": str(body.get("hypothesis", ""))[:600],
            "truth": {"effect_rel": effect, "true_a": rec["config"]["baseline"], "true_b": round(rec["config"]["baseline"] * (1 + effect), 4)},
            "record": console.slim(rec)}


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
            if u.path in ("/", "/index.html", "/tools.html"):
                html = (WEB / ("tools.html" if u.path == "/tools.html" else "index.html")).read_text()
                html = html.replace('<script src="app.js"></script>', '<script>window.CANARY_LIVE=true;</script><script src="app.js"></script>')
                html = html.replace('<script src="console.js"></script>', '<script>window.CANARY_LIVE=true;</script><script src="console.js"></script>')
                data = html.encode()
                self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
            elif u.path in ("/style.css", "/app.js", "/simple.js", "/console.css", "/console.js"):
                self._file(WEB / u.path[1:])
            elif u.path == "/api/bundle":
                self._json(bundle_live())
            elif u.path == "/api/console":
                self._json(console_live())
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
        if n > (14_000_000 if self.path in ("/api/decide", "/api/inspect") else 1_000_000 if self.path == "/api/wizard" else 20000):
            return self._json({"error": "body too large"}, 413)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/api/run":
                self._json(run_custom(body))
            elif self.path == "/api/decide":
                self._json(run_decide(body))
            elif self.path == "/api/wizard":
                self._json(run_wizard(body))
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
    build.assemble_console_js()
    threading.Thread(target=bundle_live, daemon=True).start()      # warm the caches
    threading.Thread(target=console_live, daemon=True).start()
    srv = ThreadingHTTPServer((host, port), H)
    print(f"Canary live on http://{host}:{port}   (Ctrl+C to stop)")
    if host != "127.0.0.1":
        print("WARNING: this serves call audio to anyone on your network. Use only on the office network and stop it when labelling is done.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
