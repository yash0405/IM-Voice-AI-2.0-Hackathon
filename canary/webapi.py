"""Browser entry point (Pyodide): the engine calls the live server makes, without HTTP. The hosted static site calls handle()."""
from __future__ import annotations

import json
import re


def handle(method: str, path: str, body_text: str = "") -> tuple[int, str]:
    """Same routes and limits as server.py hosted mode. Returns (status, json text)."""
    from . import samples, server
    try:
        if method == "GET":
            if path == "/api/console":
                return 200, json.dumps(server.console_live(), separators=(",", ":"))
            if path == "/api/samples":
                return 200, json.dumps({k: {"title": v["title"], "note": v["note"], "lpd": v["lpd"], "days": v["days"]} for k, v in samples.SAMPLES.items()})
            m = re.fullmatch(r"/api/sample/([a-z_]+)", path)
            if m and m.group(1) in samples.SAMPLES:
                key = m.group(1)
                return 200, json.dumps({"name": f"results_{key}.csv", "text": samples.to_csv(samples.make_rows(key))})
        elif method == "POST" and path in ("/api/wizard", "/api/decide", "/api/inspect"):
            if len(body_text) > server.HOSTED_MAX_BODY:
                return 413, '{"error":"body too large"}'
            body = json.loads(body_text or "{}")
            if path == "/api/wizard":
                return 200, json.dumps(server.run_wizard(body), separators=(",", ":"))
            if path == "/api/decide":
                return 200, json.dumps(server.run_decide(body), separators=(",", ":"))
            from . import decide
            try:
                return 200, json.dumps(decide.inspect(str(body.get("text", "")), str(body.get("name", "file"))))
            except decide.DataError as e:
                return 400, json.dumps({"error": str(e)})
        return 404, '{"error":"not available in the hosted copy"}'
    except (ValueError, KeyError, TypeError) as e:
        return 400, json.dumps({"error": str(e)})
    except Exception as e:  # pragma: no cover
        return 500, json.dumps({"error": str(e)})
