#!/usr/bin/env bash
# One command from a clean machine: venv, install, tests, proof, offline dashboard, QA report, live server.
set -e
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
python -m unittest discover -s tests
python -m canary all            # proof lab -> dist/canary_demo.html -> docs/QA_REPORT.md
echo "Offline demo: open dist/canary_demo.html   |   Live engine + Label Lab: python -m canary serve"
