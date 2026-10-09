#!/usr/bin/env python3
"""Ship / stop / hold / keep decision from results files, using the Canary engine (sequential test, guardrails, tamper-evident record).

This is a thin launcher: it finds the Canary project and runs `python -m canary decide` with the same arguments. Run `--help` for them all.

Where it looks for Canary (first match wins): the CANARY_HOME environment variable, then the folders above this script.
Needs Python 3.10+ with numpy and scipy (pip install numpy scipy jinja2).

Typical use (the plan flags are required: the plan must be fixed BEFORE the results are read):
  python decide.py results.csv --goal buylead_created --share-b 0.3 --baseline 0.45 --mde 0.05 --window-days 14
  python decide.py results.csv ... --through-day 5          # a test still running: results up to day 5
  python decide.py a.csv ... --a a.csv --b b.csv            # A's and B's results as two files
"""
import os
import sys
from pathlib import Path


def find_root():
    env = os.environ.get("CANARY_HOME")
    if env and (Path(env) / "canary" / "decide.py").exists():
        return Path(env)
    for p in Path(__file__).resolve().parents:
        if (p / "canary" / "decide.py").exists():
            return p
    return None


def main():
    root = find_root()
    if root is None:
        sys.exit("Canary was not found. Set CANARY_HOME to the folder that contains the 'canary' package "
                 "(the project folder this skill ships in), or use check_results.py for a single-look check that needs no engine.")
    try:
        import numpy, scipy  # noqa: F401
    except ImportError:
        sys.exit("numpy and scipy are required: pip install numpy scipy jinja2")
    sys.path.insert(0, str(root))
    from canary.__main__ import main as canary_main
    sys.argv = ["canary", "decide"] + sys.argv[1:]
    canary_main()


if __name__ == "__main__":
    main()
