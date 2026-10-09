#!/usr/bin/env python3
"""Build the password-protected static site: the whole app (Python engine + data + UI) is one AES-256-GCM encrypted file that the
page decrypts in the browser with the password, then runs the real engine in Pyodide. Nothing on the server side but static files.

    CANARY_PASSWORD=... python deploy/build_static.py --out site/main --branch main --commit abc1234 [--src DIR]
"""
import argparse
import io
import os
import shutil
import sys
import zipfile
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

MAGIC, ITER = b"CNRY1", 600_000
SKIP_DATA = (".mp3", ".wav")
SKIP_NAMES = ("vani_real_prompt_raw.txt",)                  # not used at run time


def collect(src: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in sorted((src / "canary").glob("*.py")):
            z.write(p, f"canary/{p.name}")
        for p in sorted((src / "data").rglob("*")):
            if p.is_file() and p.suffix not in SKIP_DATA and p.name not in SKIP_NAMES and not p.name.startswith(("sarvam_agent", "history.db")):   # history.db: the local server's own history, never shipped
                z.write(p, "data/" + p.relative_to(src / "data").as_posix())
        z.write(src / "out" / "console_bundle.json", "out/console_bundle.json")
        z.write(src / "web" / "index.html", "web/index.html")
        z.write(src / "web" / "console.css", "web/console.css")
        parts = sorted((src / "web" / "console").glob("*.js"))   # regenerate console.js exactly as canary.build.assemble_console_js does
        js = "/* GENERATED from web/console/*.js by canary.build.assemble_console_js: edit the parts, not this file. */\n" + "\n".join(p.read_text() for p in parts)
        z.writestr("web/console.js", js)
    return buf.getvalue()


def encrypt(data: bytes, password: str) -> bytes:
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(password.encode())
    return MAGIC + salt + iv + AESGCM(key).encrypt(iv, data, MAGIC)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--src", default=str(Path(__file__).resolve().parent.parent))
    ap.add_argument("--branch", default="local")
    ap.add_argument("--commit", default="-")
    a = ap.parse_args()
    pw = os.environ.get("CANARY_PASSWORD", "")
    if len(pw) < 8:
        sys.exit("CANARY_PASSWORD (8+ characters) is required")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    blob = encrypt(collect(Path(a.src)), pw)
    (out / "app.enc").write_bytes(blob)
    html = (Path(__file__).resolve().parent / "static_loader.html").read_text().replace("__BRANCH__", a.branch).replace("__COMMIT__", a.commit)
    (out / "index.html").write_text(html)
    print(f"wrote {out}/index.html and app.enc ({len(blob) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
