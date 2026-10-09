"""Local server: dashboard, live engine API, Label Lab. Standard library only."""
from __future__ import annotations

import base64
import hmac
import json
import math
import mimetypes
import os
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

# Hosted mode (public internet, e.g. Render): only the engine screens are served. The Label Lab, call audio, transcripts, the
# Sarvam spend ledger and the proof lab stay off, and a password is required. Set by serve(hosted=True) or CANARY_HOSTED=1.
HOSTED = {"on": False, "password": None}
HOSTED_GET = ("/", "/index.html", "/console.css", "/console.js", "/api/console", "/api/samples")
HOSTED_POST = ("/api/wizard", "/api/decide", "/api/inspect")
HOSTED_MAX_BODY = 4_000_000                         # the free instance has 512 MB of memory
_heavy = threading.BoundedSemaphore(2)              # at most two simulations/file decisions at once; the rest get a polite 503


def build_info() -> dict:
    """Which branch and commit this server is running (Render sets these; a local run reports 'local')."""
    return {"branch": os.environ.get("RENDER_GIT_BRANCH") or "local", "commit": (os.environ.get("RENDER_GIT_COMMIT") or "")[:7] or "-"}

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


MAX_PROMPT = 400_000
MIN_AUDIENCE_CONNECTED = 200       # fewer connected leads than this in the audience's 30 days: its own value is too noisy, the all-traffic value is used
MIN_WINDOW_LEADS = 200             # fewer connected leads than this over the whole test window: refused


def _resolve_metrics(items) -> list:
    """The wizard's metric list -> the locked list [{"role", "def", "limit"}]: built-ins by key, custom metrics by definition (metriclib)."""
    from . import metriclib
    from .engine import MAX_GUARDRAILS, MAX_SECONDARY, ROLES
    if not isinstance(items, list) or not items:
        raise ValueError("choose the metrics: one primary metric, up to 3 guardrails and up to 5 secondary metrics")
    if any(not isinstance(it, dict) or it.get("role") not in ROLES for it in items):
        raise ValueError("each metric's role must be primary, guardrail or secondary")
    roles = [it["role"] for it in items]
    if roles.count("primary") != 1:
        raise ValueError("choose exactly one primary metric (it decides the test)")
    if roles.count("guardrail") > MAX_GUARDRAILS:
        raise ValueError(f"at most {MAX_GUARDRAILS} guardrails")
    if roles.count("secondary") > MAX_SECONDARY:
        raise ValueError(f"at most {MAX_SECONDARY} secondary metrics")
    out = []
    for it in items:
        if it.get("key") and it.get("def"):
            raise ValueError("give a metric either a built-in key or a custom definition, not both")
        if it.get("key"):
            m = metriclib.BY_KEY.get(str(it["key"]))
            if m is None:
                raise ValueError(f"unknown metric {str(it['key'])[:60]!r}")
            if m.get("available") is False:
                raise ValueError(f"{m['name']}: Not in data yet")
            d = metriclib.definition(m)
        elif isinstance(it.get("def"), dict):
            d = metriclib.validate(it["def"])                    # columns from the data only; denominator above 0; a rate between 0 and 100%
            if d["key"] in metriclib.BY_KEY:
                raise ValueError(f"{d['name']}: '{d['key']}' is a built-in metric's key; give the custom metric another name")
        else:
            raise ValueError("each metric needs a built-in key or a custom definition")
        lim = None
        if it["role"] == "guardrail":
            l = it.get("limit")
            if not isinstance(l, dict) or l.get("kind") not in ("rel", "pts"):
                raise ValueError(f"guardrail {d['name']}: set a limit, relative (rel, in %) or absolute (pts: points for a rate, the metric's units for an average)")
            try:
                v = float(l.get("value"))
            except (TypeError, ValueError):
                v = float("nan")
            if not (v > 0 and math.isfinite(v)):
                raise ValueError(f"guardrail {d['name']}: the limit must be a number above 0")
            lim = {"value": v, "kind": l["kind"]}
        out.append({"role": it["role"], "def": d, "limit": lim})
    seen, same = {}, {}
    for m in out:
        d = m["def"]
        if d["key"] in seen:
            raise ValueError(f"{d['name']} is chosen twice: each metric can have one role only")
        seen[d["key"]] = 1
        body = json.dumps({k: v for k, v in d.items() if k not in ("key", "name", "direction")}, sort_keys=True)
        if body in same:
            raise ValueError(f"{d['name']} and {same[body]} count the same thing: keep one of them")
        same[body] = d["name"]
    order = {r: i for i, r in enumerate(ROLES)}
    return sorted(out, key=lambda m: order[m["role"]])           # primary, guardrails, secondary (stable inside a role)


def _prompts(body: dict, name: str) -> tuple:
    """Prompt B (full text, required) and the live prompt A (optional full text). Template variables must match exactly. Returns (variant_b, variant_a)."""
    from . import promptlint, variants as _v
    b = body.get("prompt_b")
    if not isinstance(b, str) or not b.strip():
        raise ValueError("paste the full text of prompt B")
    a = body.get("prompt_a")
    if a is not None and not isinstance(a, str):
        raise ValueError("prompt A must be text")
    if len(b) > MAX_PROMPT or len(a or "") > MAX_PROMPT:
        raise ValueError(f"a prompt is too long ({MAX_PROMPT:,} characters at most)")
    base = _v.load_base()
    live = a if (a and a.strip() and _v.prompt_hash(a) != base["hash"]) else None
    rep = promptlint.variable_report(live or base["text"], b)
    if rep["dropped"]:
        raise ValueError("prompt B no longer uses these template variables: " + ", ".join(rep["dropped"])
                         + " (every {{ variable }} of prompt A must stay in prompt B)")
    if rep["added"]:
        raise ValueError("prompt B adds template variables that prompt A does not have: " + ", ".join(rep["added"])
                         + " (the calling system fills only the variables prompt A uses)")
    version = re.sub(r"[^A-Za-z0-9._-]", "", str(body.get("prompt_a_version") or ""))[:20] or "live"
    return _v.register_text(name, b), (_v.register_live(f"Production prompt {version}", live) if live else "")


def run_wizard(body: dict) -> dict:
    """Launch a new simulated experiment from the New Experiment wizard. Returns the experiment as the console stores it.

    The body (see the New Experiment spec): name, hypothesis, prompt_b (full text), prompt_a (full text of the live prompt, optional),
    prompt_a_version, share_b, window_days, improvement (absolute: 0.05 = 5 points for a rate, metric units for an average), leads_per_day
    (CONNECTED leads a day in the audience), segment, metrics [{role, key | def, limit}], confidence, min_leads_per_arm, rule_set, harm_bar,
    approval, assignment, and the simulated truth: effect_rel (on the primary), dur_mult, hang_extra_pp, seed, preset, start.
    The current value of the primary and its spread are recomputed here from the 30-day history (canary/history.py)."""
    from . import catalog, console, history, metriclib
    from .engine import run_experiment
    from .simulator import HistorySim

    def num(k, d, t=float):
        v = body.get(k)
        try:
            return t(d if v is None or v == "" else v)
        except (TypeError, ValueError):
            raise ValueError(f"{k} must be a number")

    win, share = num("window_days", 7, int), num("share_b", 0.30)
    if win not in (7, 14, 21, 28):
        raise ValueError("test length must be 7, 14, 21 or 28 days: whole weeks cover a full week of patterns, and a longer test drags on")
    if not 0.05 - 1e-9 <= share <= 0.5 + 1e-9 or abs(share * 100 - round(share * 100)) > 1e-6:
        raise ValueError("the share of leads that get B must be a whole percent between 5% and 50%")
    effect = num("effect_rel", 0.0)
    if not -0.9 <= effect <= 3.0:
        raise ValueError("the simulated effect must be between -90% and +300%")
    dur_mult, hang = num("dur_mult", 1.0), num("hang_extra_pp", 0.0)
    if not 0.2 <= dur_mult <= 5 or not 0 <= hang <= 50:
        raise ValueError("the simulated call-length change must be between x0.2 and x5, and the extra early hang-ups between 0 and 50 points")
    conf, harm_bar = num("confidence", 0.95), num("harm_bar", 0.999)
    if not 0.5 < conf < 1 or not 0.9 <= harm_bar < 1:
        raise ValueError("confidence must be between 50% and 100%, the daily harm bar between 90% and 100%")
    min_leads = num("min_leads_per_arm", console.DEFAULTS["min_leads_per_arm"], int)
    if not 1 <= min_leads <= 1_000_000:
        raise ValueError("the minimum leads per prompt must be at least 1")
    seed = num("seed", 7, int)

    seg = catalog.validate_segment(body.get("segment"))            # raises a plain message for an in-call factor or a segment that is too small
    metrics = _resolve_metrics(body.get("metrics"))
    prim = metrics[0]["def"]
    name = str(body.get("name") or "New experiment")[:120]
    variant_b, variant_a = _prompts(body, name)

    # today's value and spread of the primary, from the data: the audience's own 30 days, or all traffic when the audience is too thin
    aud = history.audience(seg)
    ev, note = metriclib.evaluate(prim, seg), ""
    if seg and aud["connected"] < MIN_AUDIENCE_CONNECTED:
        ev = metriclib.evaluate(prim)
        note = (f"Only {aud['connected']} connected leads in this audience in the last {aud['days']} days (fewer than {MIN_AUDIENCE_CONNECTED}), "
                f"so today's value of {prim['name']} is the all-traffic value.")
    if ev["value"] is None or not ev["leads"]:
        raise ValueError(f"{prim['name']} counts nothing in the last {aud['days']} days")
    avg = prim["type"] == "average"
    if body.get("improvement") in (None, "") and avg:
        raise ValueError(f"set the improvement to detect, in {prim['name']}'s own units")
    mde = num("improvement", console.DEFAULTS["improvement_pts"] / 100)
    if not mde > 0:
        raise ValueError("the improvement to detect must be above 0")

    # volume: the page shows CONNECTED leads a day in the audience; the engine's leads_per_day is ALL traffic, ATTEMPTED leads a day
    lpd_conn = num("leads_per_day", round(aud["connected_per_day"]))
    if not 1 <= lpd_conn <= 20000:
        raise ValueError("1-20,000 leads a day; days x leads a day is capped at 60,000 for the live demo")
    if win * lpd_conn < MIN_WINDOW_LEADS:
        raise ValueError("this audience has too few leads for the window: widen it, raise leads per day or lengthen the test")
    lpd_all = max(1, int(round(lpd_conn / (catalog.segment_share(seg) * aud["p_connected_all"]))))
    if win * lpd_all > 60000:
        raise ValueError(f"1-20,000 leads a day; days x leads a day is capped at 60,000 for the live demo (this test would simulate {win} days x {lpd_all:,} "
                         f"leads a day of all traffic)")

    exp_id = "exp-" + "".join(ch for ch in name.lower().replace(" ", "-") if ch.isalnum() or ch == "-")[:40] + "-" + str(seed)
    from datetime import datetime
    start = str(body.get("start") or datetime(2026, 10, 9, 9).isoformat(timespec="seconds"))
    over = dict(share_b=share, baseline=round(ev["value"], 6), mde=mde, window_days=win, leads_per_day=lpd_all,
                rule_set=str(body.get("rule_set", "final_look")), alpha=(1 - conf) / 2, alpha_harm_daily=1 - harm_bar,
                approval=str(body.get("approval", "auto")), min_per_arm=min_leads, assignment=str(body.get("assignment", "stratified")),
                metrics=metrics, primary_sd=round(ev["sd"], 6) if avg and ev["sd"] else 0.0,
                primary_units_per_lead=round(ev["den"] / ev["leads"], 6), variant_a=variant_a)
    if seg:
        over.update(segment=seg, assignment="stratified")
    cfg = console.demo_config(name, variant_b, start, exp_id, **over)
    sim = HistorySim(prim, effect, seed, dur_mult_b=dur_mult, hang_extra=hang / 100.0)
    rec = run_experiment(cfg, sim)
    return {"id": exp_id, "kind": "simulated", "preset": str(body.get("preset", "Custom")), "hypothesis": str(body.get("hypothesis", ""))[:600],
            "truth": {"effect_rel": effect, "true_a": round(sim.sc.true_a, 6), "true_b": round(sim.sc.true_b, 6) if sim.sc.true_b is not None else None},
            "baseline_note": note, "record": console.slim(rec)}


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

    def _gate(self, path: str, allowed: tuple) -> bool:
        """Hosted mode only: password check, then the allowlist. Returns True when the request may go on (else it has answered)."""
        if not HOSTED["on"]:
            return True
        if path == "/healthz":
            self._json({"ok": True, **build_info()})
            return False
        got = self.headers.get("Authorization", "")
        ok = False
        if got.startswith("Basic "):
            try:
                pw = base64.b64decode(got[6:]).decode("utf8", "replace").partition(":")[2]
                ok = hmac.compare_digest(pw.encode(), HOSTED["password"].encode())
            except Exception:
                ok = False
        if not ok:
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="Canary (team access)", charset="UTF-8"')
            self.send_header("Content-Length", "0")
            self.end_headers()
            return False
        if path not in allowed and not re.fullmatch(r"/api/sample/[a-z_]+", path):
            self.send_error(404)
            return False
        return True

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if not self._gate(u.path, HOSTED_GET):
            return
        try:
            if u.path in ("/", "/index.html", "/tools.html"):
                html = (WEB / ("tools.html" if u.path == "/tools.html" else "index.html")).read_text()
                flag = "window.CANARY_LIVE=true;" + ("window.CANARY_HOSTED=true;" if HOSTED["on"] else "")
                html = html.replace('<script src="app.js"></script>', f'<script>{flag}</script><script src="app.js"></script>')
                html = html.replace('<script src="console.js"></script>', f'<script>{flag}</script><script src="console.js"></script>')
                if HOSTED["on"]:
                    b = build_info()
                    html = html.replace("</body>", f'<div style="position:fixed;right:8px;bottom:6px;font:11px/1 system-ui,sans-serif;color:#627d98;background:#ffffffd9;padding:3px 6px;border-radius:6px">branch {b["branch"]} &middot; {b["commit"]}</div></body>')
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
        if not self._gate(urlparse(self.path).path, HOSTED_POST):
            return
        n = int(self.headers.get("Content-Length", 0))
        if n > (14_000_000 if self.path in ("/api/decide", "/api/inspect") else 1_000_000 if self.path == "/api/wizard" else 20000) or (HOSTED["on"] and n > HOSTED_MAX_BODY):
            return self._json({"error": "body too large"}, 413)
        if HOSTED["on"] and not _heavy.acquire(blocking=False):
            return self._json({"error": "The server is busy with other people's runs. Try again in a few seconds."}, 503)
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
        finally:
            if HOSTED["on"]:
                _heavy.release()


def serve(port: int = 8765, host: str = "127.0.0.1", hosted: bool = False):
    hosted = hosted or os.environ.get("CANARY_HOSTED") == "1"
    if hosted:
        pw = os.environ.get("CANARY_PASSWORD", "")
        if len(pw) < 8:
            sys.exit("Hosted mode needs CANARY_PASSWORD (at least 8 characters). Refusing to start an open server.")
        HOSTED.update(on=True, password=pw)
    build.assemble_console_js()
    if not hosted:                                                  # hosted mode never touches labels, spend or audio
        threading.Thread(target=bundle_live, daemon=True).start()   # warm the caches
    threading.Thread(target=console_live, daemon=True).start()
    srv = ThreadingHTTPServer((host, port), H)
    print(f"Canary live on http://{host}:{port}   (Ctrl+C to stop)" + ("   [hosted mode: password required, Label Lab/audio/transcripts off]" if hosted else ""))
    if host != "127.0.0.1" and not hosted:
        print("WARNING: this serves call audio to anyone on your network. Use only on the office network and stop it when labelling is done.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
