#!/usr/bin/env python3
"""Build the static site, open to everyone (no password): the whole app (Python engine + data + UI) is one zip file that the
page downloads and runs in the browser with Pyodide. Nothing on the server side but static files.

    python deploy/build_static.py --out site/main --branch main --commit abc1234 [--src DIR]
"""
import argparse
import io
import subprocess
import zipfile
from pathlib import Path

SKIP_DATA = (".mp3", ".wav")
SKIP_NAMES = ("vani_real_prompt_raw.txt",)                  # not used at run time


def collect(src: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in sorted((src / "canary").glob("*.py")):
            z.write(p, f"canary/{p.name}")
        tracked = set(subprocess.run(["git", "ls-files", "data"], cwd=src, capture_output=True, text=True, check=True).stdout.split())   # only what git tracks: ignored local files (labels, transcripts, spend logs) never ship
        for p in sorted((src / "data").rglob("*")):
            if p.is_file() and p.relative_to(src).as_posix() in tracked and p.suffix not in SKIP_DATA and p.name not in SKIP_NAMES and not p.name.startswith(("sarvam_agent", "history.db")):   # history.db: the local server's own history, never shipped
                z.write(p, "data/" + p.relative_to(src / "data").as_posix())
        z.write(src / "out" / "console_bundle.json", "out/console_bundle.json")
        z.write(src / "web" / "index.html", "web/index.html")
        z.write(src / "web" / "console.css", "web/console.css")
        parts = sorted((src / "web" / "console").glob("*.js"))   # regenerate console.js exactly as canary.build.assemble_console_js does
        js = "/* GENERATED from web/console/*.js by canary.build.assemble_console_js: edit the parts, not this file. */\n" + "\n".join(p.read_text() for p in parts)
        z.writestr("web/console.js", js)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--src", default=str(Path(__file__).resolve().parent.parent))
    ap.add_argument("--branch", default="local")
    ap.add_argument("--commit", default="-")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    blob = collect(Path(a.src))
    (out / "app.zip").write_bytes(blob)
    html = (Path(__file__).resolve().parent / "static_loader.html").read_text().replace("__BRANCH__", a.branch).replace("__COMMIT__", a.commit)
    (out / "index.html").write_text(html)
    print(f"wrote {out}/index.html and app.zip ({len(blob) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
