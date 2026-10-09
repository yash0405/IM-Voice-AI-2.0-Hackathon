#!/usr/bin/env python3
"""Root page of the GitHub Pages site: opens the branch deployed most recently and lists every deployed branch.
    python deploy/pages_index.py SITE_DIR SLUG BRANCH COMMIT"""
import html
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

site, slug, branch, commit = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
reg_path = site / "branches.json"
reg = json.loads(reg_path.read_text()) if reg_path.exists() else {}
reg[slug] = {"branch": branch, "commit": commit, "at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}
reg = {k: v for k, v in reg.items() if (site / k / "index.html").exists()}
reg_path.write_text(json.dumps(reg, indent=1))
rows = "".join(f'<li><a href="./{html.escape(k)}/">{html.escape(v["branch"])}</a> &middot; {html.escape(v["commit"])} &middot; {html.escape(v["at"])}</li>'
               for k, v in sorted(reg.items(), key=lambda kv: kv[1]["at"], reverse=True))
(site / "index.html").write_text(f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta http-equiv="refresh" content="0; url=./{html.escape(slug)}/"><title>Picky</title>
<style>body{{font:15px/1.6 system-ui,sans-serif;color:#243b53;background:#f3f5f7;margin:0;padding:32px 16px}}main{{max-width:560px;margin:auto}}a{{color:#4c7cf3}}</style></head>
<body><main><h1>Picky</h1><p>Opening the latest deploy (<b>{html.escape(branch)}</b> &middot; {html.escape(commit)})...</p><p>Other branches:</p><ul>{rows}</ul></main></body></html>""")
print("index ->", slug)
