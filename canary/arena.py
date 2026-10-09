"""Voice arena: hear the two prompts handle the same buyer.

For each buyer persona, Sarvam's chat model plays the buyer and plays VANI under prompt A (today's) and prompt B
(the candidate). Every line is spoken with Sarvam Bulbul voices, the full call is saved as one mp3, and the same
Sarvam tagger that labels the real recordings scores it. Everything is generated once and cached, so the demo plays
offline.  python -m canary arena plan | run [--yes --budget N] | status

Honest framing: three personas per prompt is a demonstration, not a statistical test. The A/B engine proves the
statistics; the arena lets a judge HEAR the difference and see the auto-disposition working end to end.
Credit protection: nothing is spent without --yes; a hard rupee budget; results are cached; separate spend ledger.
"""
from __future__ import annotations

import base64
import json
import threading
import time
from pathlib import Path

from . import sarvam_pipe as sp
from .variants import make_variant, load_base

ARENA = sp.DATA / "arena"
LEDGER = sp.DATA / "arena_spend.json"
TTS_INR_PER_1K_CHARS = 3.0           # Bulbul v3, from sarvam.ai/api-pricing
BOT_VOICE, TTS_MODEL = "ritu", "bulbul:v3"
MAX_TURNS = 7
CHAT_MAX_TOKENS = 160

PERSONAS = [
    {"key": "cooperative", "title": "Cooperative buyer", "voice": "rahul", "name": "Rajesh Kumar", "product": "stainless steel pipes",
     "brief": "Knows exactly what he wants and answers every question helpfully.",
     "facts": "You enquired about stainless steel pipes. You need 500 pieces, size 20 mm, grade 304. Delivery to Pune. You need it within 10 days.",
     "behaviour": "Friendly and clear. Answer only the question you are asked."},
    {"key": "busy", "title": "Busy buyer", "voice": "aditya", "name": "Sunil Patel", "product": "LED street lights",
     "brief": "Short on time, gives one detail at a time, impatient with long questions.",
     "facts": "You enquired about LED street lights. You need 200 units, 40 watt. Delivery to Surat. You need them next week.",
     "behaviour": "Busy and a little impatient. Very short answers. If a question has two parts, answer only one part."},
    {"key": "unsure", "title": "Unsure buyer", "voice": "amit", "name": "Vikram Singh", "product": "packaging boxes",
     "brief": "Does not know the quantity yet and keeps asking about price.",
     "facts": "You enquired about packaging boxes. You are not sure of the quantity (maybe a few thousand). Size 12x10x8 inch. Delivery to Jaipur. No fixed date.",
     "behaviour": "Hesitant. You ask about the price once or twice. You give details only if the assistant is patient."},
]


class BudgetExceeded(RuntimeError):
    pass


_LEDGER_LOCK = threading.Lock()      # the pre-screen runs two workers; the ledger is a read-modify-write file


def _spend(kind: str, inr: float, **info) -> None:
    with _LEDGER_LOCK:
        cur = json.loads(LEDGER.read_text()) if LEDGER.exists() else {"inr": 0.0, "events": []}
        cur["inr"] = round(cur["inr"] + inr, 4)
        cur["events"].append({"ts": int(time.time()), "kind": kind, "inr": round(inr, 4), **info})
        tmp = LEDGER.with_suffix(".tmp")
        tmp.write_text(json.dumps(cur, indent=1))
        tmp.replace(LEDGER)


def spent() -> float:
    with _LEDGER_LOCK:
        return json.loads(LEDGER.read_text())["inr"] if LEDGER.exists() else 0.0


def plan() -> dict:
    n_calls = len(PERSONAS) * 2
    chat_in = n_calls * MAX_TURNS * 2 * 1100
    chat_out = n_calls * MAX_TURNS * 2 * 60
    chars = n_calls * MAX_TURNS * 2 * 95
    tag = sp.llm_cost(n_calls * 1300, n_calls * 350)
    llm = sp.llm_cost(chat_in, chat_out)
    tts = chars / 1000 * TTS_INR_PER_1K_CHARS
    return {"calls": n_calls, "chat_requests": n_calls * MAX_TURNS * 2, "tts_chars": chars, "llm_inr": round(llm + tag, 2),
            "tts_inr": round(tts, 2), "total_inr": round(llm + tag + tts, 2), "already_spent_inr": round(spent(), 2)}


BOT_SUFFIX = ("\n\n## Live call\nYou are speaking on a live phone call. Speak natural Hinglish: Hindi words in Devanagari, English words in "
              "Latin script, so it can be read aloud. Reply with ONLY the words you say, at most two short sentences. "
              "When the call is finished, end your last sentence with [END]. "
              "Never write placeholders or square brackets: use the lead details you are given.")


def lead_context(p: dict) -> str:
    """On a real call VANI is given the buyer's name and the enquired product. The simulated VANI gets the same."""
    if not p.get("name") and not p.get("product"):
        return ""
    return f"\n\nLead details for this call: buyer name: {p.get('name', 'unknown')}; product enquired: {p.get('product', 'unknown')}."


def buyer_system(p: dict) -> str:
    return (f"You are playing a BUYER on a phone call. An IndiaMART assistant has called you about an enquiry you sent.\n"
            f"Facts you know: {p['facts']}\nBehaviour: {p['behaviour']}\n"
            "Rules: speak natural Hinglish (Hindi words in Devanagari, English words in Latin), one short sentence, answer ONLY what is asked, "
            "never volunteer other details, never say you are an AI. Reply with ONLY your spoken words.")


class Arena:
    def __init__(self, client=None, sleep=time.sleep):
        self.pipe = sp.Pipe(client, sleep=sleep)
        self.client, self.sleep = self.pipe.client, sleep

    def _chat(self, system: str, history: list[dict]) -> str:
        msgs = [{"role": "system", "content": system}] + history
        for attempt in range(1, 4):
            try:
                r = self.client.chat.completions(model=sp.LLM_MODEL, temperature=0.4, max_tokens=CHAT_MAX_TOKENS, reasoning_effort=None,
                                                 messages=msgs, seed=7)
                break
            except Exception as e:
                if "429" in str(e) and attempt < 3:
                    self.sleep(20 * attempt); continue
                raise
        u = getattr(r, "usage", None)
        _spend("llm", sp.llm_cost(getattr(u, "prompt_tokens", 0) or 0, getattr(u, "completion_tokens", 0) or 0),
               **{"in": getattr(u, "prompt_tokens", 0) or 0, "out": getattr(u, "completion_tokens", 0) or 0})
        self.sleep(sp.LLM_GAP_S)
        return (r.choices[0].message.content or "").strip()

    def simulate(self, bot_prompt: str, persona: dict) -> list[dict]:
        lines = [{"speaker": "buyer", "text": "हेलो?"}]
        for _ in range(MAX_TURNS):
            bot_hist = [{"role": "user" if l["speaker"] == "buyer" else "assistant", "content": l["text"]} for l in lines]
            bot = self._chat(bot_prompt + BOT_SUFFIX + lead_context(persona), bot_hist)
            end = "[END]" in bot
            bot = bot.replace("[END]", "").strip()
            if bot:
                lines.append({"speaker": "bot", "text": bot})
            if end or not bot:
                break
            buyer_hist = [{"role": "user" if l["speaker"] == "bot" else "assistant", "content": l["text"]} for l in lines]
            buyer = self._chat(buyer_system(persona), buyer_hist)
            if buyer:
                lines.append({"speaker": "buyer", "text": buyer})
        return lines

    def speak(self, lines: list[dict], persona: dict, out_path: Path) -> int:
        chars, audio = 0, b""
        for l in lines:
            voice = BOT_VOICE if l["speaker"] == "bot" else persona["voice"]
            r = self.client.text_to_speech.convert(text=l["text"], language_code="hi-IN", speaker=voice, model=TTS_MODEL,
                                                   output_audio_codec="mp3", speech_sample_rate=22050)
            audio += base64.b64decode(r.audios[0])
            chars += len(l["text"])
            _spend("tts", chars_cost(len(l["text"])), chars=len(l["text"]))
        out_path.write_bytes(audio)
        return chars

    def run(self, budget: float, force: bool = False, variant: str | None = None) -> dict:
        """Generate what is missing. A is today's prompt; B is the candidate (the AI-drafted fix when one exists).
        If B changed since the last run, only the B calls are regenerated (A is kept)."""
        ARENA.mkdir(parents=True, exist_ok=True)
        f = ARENA / "arena.json"
        data = json.loads(f.read_text()) if f.exists() and not force else {"cases": []}
        if variant is None:
            variant = "ai_fix" if (sp.DATA / "proposal.json").exists() else "ask_together"
        bv = make_variant(variant)
        variants = {"A": load_base()["text"], "B": bv["text"]}
        cases = {c["key"]: c for c in data["cases"]}
        for p in PERSONAS:
            case = cases.get(p["key"]) or {"key": p["key"], "title": p["title"], "brief": p["brief"]}
            need = [arm for arm in ("A", "B") if arm not in case or (arm == "B" and case.get("b_variant") != variant)]
            if not need:
                continue
            est = plan()["total_inr"] / len(PERSONAS) * len(need) / 2
            if spent() + est > budget:
                print(f"STOP: next case (~Rs {est:.2f}) would exceed the Rs {budget:.2f} arena budget.")
                break
            for arm in need:
                lines = self.simulate(variants[arm], p)
                audio = ARENA / f"{p['key']}_{arm}.mp3"
                chars = self.speak(lines, p, audio)
                text = "\n".join(f"[Speaker {0 if l['speaker'] == 'bot' else 1}] {l['text']}" for l in lines)
                tag = self.pipe.tag_text(text, ledger=_spend)
                tag.pop("raw_reply", None)
                case[arm] = {"audio": f"arena/{audio.name}", "lines": lines, "chars": chars, "tag": tag}
                if arm == "B":
                    case["b_variant"] = variant
                print(f"{p['key']} {arm}: {len(lines)} lines, {chars} chars, outcome={tag['label']}, spent Rs {spent():.2f}")
            cases[p["key"]] = case
            data["cases"] = [cases[k["key"]] for k in PERSONAS if k["key"] in cases]
            data["b_variant"], data["b_name"], data["b_origin"] = variant, bv["name"], bv["origin"]
            data["generated"] = time.strftime("%Y-%m-%d %H:%M")
            data["note"] = ("Illustrative: Sarvam chat model plays the buyer and VANI, Bulbul speaks both, the Sarvam tagger scores the call. "
                            "Three buyers per prompt is a demonstration, not a statistical test.")
            f.write_text(json.dumps(data, ensure_ascii=False, indent=1))
        return {"cases": len(data["cases"]), "spent_inr": round(spent(), 2)}


def chars_cost(n: int) -> float:
    return n / 1000 * TTS_INR_PER_1K_CHARS


def load() -> dict | None:
    f = ARENA / "arena.json"
    return json.loads(f.read_text()) if f.exists() else None
