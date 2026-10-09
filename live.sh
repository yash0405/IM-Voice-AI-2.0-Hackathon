#!/usr/bin/env bash
# Live call test on its own port (8790): hear prompt A and prompt B, give signals, get a fair result.
set -e
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
PORT="${1:-8790}"
echo "Live call test: http://127.0.0.1:$PORT"
( sleep 2; (xdg-open "http://127.0.0.1:$PORT" || open "http://127.0.0.1:$PORT" || true) >/dev/null 2>&1 ) &
python -m canary live --port "$PORT"
