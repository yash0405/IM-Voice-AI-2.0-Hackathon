#!/usr/bin/env bash
# One command for everyone: sets itself up, then opens Picky in your browser.
set -e
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
python -m picky build > /dev/null
echo "Picky is starting. If the browser does not open, go to http://127.0.0.1:8765"
( sleep 3; (xdg-open http://127.0.0.1:8765 || open http://127.0.0.1:8765 || true) >/dev/null 2>&1 ) &
python -m picky serve
