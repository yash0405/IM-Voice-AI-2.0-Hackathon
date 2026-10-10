#!/usr/bin/env bash
# Picky on port 8790 (the team's server). Same app as ./start.sh.
set -e
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
PORT="${1:-8790}"
echo "Picky: http://127.0.0.1:$PORT"
( sleep 2; (xdg-open "http://127.0.0.1:$PORT" || open "http://127.0.0.1:$PORT" || true) >/dev/null 2>&1 ) &
python -m canary live --port "$PORT"
