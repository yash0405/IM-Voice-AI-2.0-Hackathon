"""The real VANI buyer-side prompt (Resources/Sarvam Prompt - Buyer Side VANI.docx.pdf), made usable.

  normalize(raw)   PDF text -> one logical rule per line, so a prompt edit can anchor on an exact line
  flows(text)      the four prompts inside the document: inbound redirect, enrichment, redial (name/city), redial (live seller)
  render(...)      fill the Jinja template with a call context, to get the text the model actually sees on a call
  extract(pdf)     pdftotext (poppler) -> normalize -> data/base_prompt.md

The prompt is IndiaMART's own configuration, not customer data. It never leaves this machine except as the system prompt of a
Sarvam chat call, and only when a paid step is run with --yes.
"""
from __future__ import annotations

import hashlib
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PDF = ROOT.parent / "Resources" / "Sarvam Prompt - Buyer Side VANI.docx.pdf"

_BULLET = re.compile(r"^(\s*)([●○■▪•·])\s*")
_NUMBERED = re.compile(r"^\s*\d+\.\s")
_TEMPLATE = re.compile(r"^\s*\{%-?\s*(if|elif|else|endif|set|for|endfor)\b.*%\}\s*$")
_ZW = re.compile("[​﻿‌‍\f]")

# the headings that start the other three prompts inside the document
FLOW_HEADINGS = {"enrichment": "Enrichment -", "redial_name_city": "Redial - No Name City", "redial_ast": "Redial_AST"}


def _clean(line: str) -> str:
    return _ZW.sub("", line).rstrip()


def normalize(raw: str) -> str:
    """One logical item per line. Bullets become '- ' (nested bullets are indented), wrapped lines are joined,
    Jinja control lines stay on their own line, blank lines are collapsed."""
    out: list[str] = []
    cur: str | None = None
    cur_indent = -1

    def flush():
        nonlocal cur
        if cur is not None:
            out.append(re.sub(r"\s+", " ", cur).strip() if not cur.startswith(" ") else cur.rstrip())
            cur = None

    depth_by_indent: dict[int, int] = {}
    for line in raw.splitlines():
        line = _clean(line)
        if not line.strip():
            flush()
            if out and out[-1] != "":
                out.append("")
            continue
        m = _BULLET.match(line)
        if _TEMPLATE.match(line):
            flush(); out.append(line.strip())
            continue
        if m:
            flush()
            indent = len(m.group(1))
            depth_by_indent.setdefault(indent, len(depth_by_indent))
            depth = sorted(depth_by_indent).index(indent)
            cur = "  " * depth + "- " + line[m.end():].strip()
            cur_indent = indent
            continue
        stripped = line.lstrip()
        indent = len(line) - len(stripped)
        if cur is not None and indent > cur_indent and not _NUMBERED.match(line):
            cur += " " + stripped                        # wrapped continuation of a bullet
            continue
        if cur is not None and indent == 0 and not _NUMBERED.match(line) and len(cur) > 70 and cur.rstrip()[-1:] not in ".:?!)":
            cur += " " + stripped                        # wrapped paragraph
            continue
        flush()
        cur = stripped
        cur_indent = indent - 1 if indent else -1
    flush()
    text = "\n".join(out)
    text = re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"
    # glue back Jinja tags that the PDF split from their text
    return text


def flows(text: str) -> dict[str, str]:
    """Split the document into its four prompts. The first one (inbound redirect) is everything before the first flow heading."""
    lines = text.splitlines()
    marks = []
    for name, head in FLOW_HEADINGS.items():
        for i, l in enumerate(lines):
            if l.strip().startswith(head) and len(l.strip()) <= len(head) + 4:
                marks.append((i, name)); break
    marks.sort()
    out, start, name = {}, 0, "inbound_redirect"
    for i, nxt in marks:
        out[name] = "\n".join(lines[start:i]).strip() + "\n"
        start, name = i, nxt
    out[name] = "\n".join(lines[start:]).strip() + "\n"
    return out


def extract(pdf: Path = PDF, dest: Path | None = None) -> Path:
    raw = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], check=True, capture_output=True, text=True).stdout
    (DATA / "vani_real_prompt_raw.txt").write_text(raw)
    dest = dest or DATA / "base_prompt.md"
    dest.write_text(normalize(raw))
    return dest


# ------------------------------------------------------------------------------------------------ rendering
# A plausible inbound-redirect call. Every value here is an ASSUMPTION of ours (the production system fills them from the lead),
# chosen so the branches that matter for the buyer-side flow are rendered.
DEFAULT_CTX = dict(
    bot_name="Vani", is_enrich="0", identity_revealed="0", bl_converted="0", identity_challenge_count=0, seller_ask_count=0, off_topic_counter=0,
    ast_seller_pns="", ast_flow_live="false", pcd_pitch="false", lead_type="LIVE", already_bought_handled="0",
    product_name="", quantity_unit_options='["Piece"]', specification_options='{"Size": ["Small", "Medium", "Large"]}',
    buyer_name="", updated_buyer_name="", buyer_city="", triangulation_response_value="0", triangulation_response_city="",
    language_name="hindi", seller_name="the seller", initial_message="", current_phase="REQUIREMENT CONFIRMATION", turn_intent="",
    quantity="", specifications="", quantity_asked_count=0, ast_seller_company="", ast_seller_city="",
)


def render(text: str, **ctx) -> str:
    """Render the Jinja template with a call context. Unknown variables render as empty text."""
    from jinja2 import Environment, Undefined

    class Quiet(Undefined):
        def __str__(self): return ""
        def __iter__(self): return iter(())
        def __int__(self): return 0
        def __eq__(self, o): return o in ("", None)
        def __ne__(self, o): return o not in ("", None)
        __hash__ = None

    env = Environment(undefined=Quiet, trim_blocks=False)
    env.filters["int"] = lambda v, d=0: int(v) if str(v).lstrip("-").isdigit() else d
    body = env.from_string(text).render(**{**DEFAULT_CTX, **ctx})
    return re.sub(r"\n{3,}", "\n\n", body).strip() + "\n"


def stats(text: str) -> dict:
    words = len(text.split())
    return {"lines": len(text.splitlines()), "words": words, "est_tokens": int(len(text) / 3.6),
            "sha256_12": hashlib.sha256(text.encode()).hexdigest()[:12]}
