"""Voice arena: hear the two prompts handle the same buyer.

For each buyer persona, Sarvam's chat model plays the buyer and plays VANI under prompt A (today's real prompt) and prompt B
(the candidate). The call is an INBOUND redirect, as in production: the buyer called a seller, the seller was unavailable, and VANI
answers with its predefined opening. VANI's instructions are the REAL prompt, rendered for the call. Every line is spoken with
Sarvam Bulbul voices, the full call is saved as one mp3, and the same Sarvam tagger that labels the real recordings scores it.
Everything is generated once and cached, so the demo plays offline.  python -m picky arena plan | run [--yes --budget N]

The real prompt is long (about 20,000 tokens rendered), so a simulated call costs about Rs 4 in tokens before any voice: see plan().
Results made with a different base prompt are marked stale and are never presented as the current prompt's behaviour.

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
from . import realprompt as rp
from .variants import make_variant, load_base

ARENA = sp.DATA / "arena"
LEDGER = sp.DATA / "arena_spend.json"
TTS_INR_PER_1K_CHARS = 3.0           # Bulbul v3, from sarvam.ai/api-pricing
BOT_VOICE, TTS_MODEL = "ritu", "bulbul:v3"
MAX_TURNS = 7
CHAT_MAX_TOKENS = 160

PERSONAS = [
    {"key": "cooperative", "title": "Cooperative buyer", "voice": "rahul", "name": "Rajesh Kumar", "product": "stainless steel pipes", "live_seller": True,
     "brief": "Knows exactly what he wants and answers every question helpfully.",
     "facts": "You enquired about stainless steel pipes. You need 500 pieces, size 20 mm, grade 304. Delivery to Pune. You need it within 10 days.",
     "behaviour": "Friendly and clear. Answer only the question you are asked."},
    {"key": "busy", "title": "Busy buyer", "voice": "aditya", "name": "Sunil Patel", "product": "LED street lights", "live_seller": False,
     "brief": "Short on time, gives one detail at a time, impatient with long questions.",
     "facts": "You enquired about LED street lights. You need 200 units, 40 watt. Delivery to Surat. You need them next week.",
     "behaviour": "Busy and a little impatient. Very short answers. If a question has two parts, answer only one part."},
    {"key": "unsure", "title": "Unsure buyer", "voice": "amit", "name": "Vikram Singh", "product": "packaging boxes", "live_seller": True,
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


def sim_prompt(variant_text: str, persona: dict) -> str:
    """What VANI is told on this call: the real inbound-redirect prompt, rendered for the persona's product and for whether a live seller is available."""
    live = bool(persona.get("live_seller"))
    return rp.render(rp.flows(variant_text)["inbound_redirect"], product_name=persona.get("product", ""), buyer_name="",
                     ast_seller_pns="9100000000" if live else "", ast_flow_live="true" if live else "false",
                     ast_seller_company="a verified seller", ast_seller_city="Delhi", initial_message=opening(persona))


def opening(persona: dict) -> str:
    """The predefined opening VANI has already said when the buyer first speaks. ASSUMPTION: the real initial_message comes from IndiaMART's system."""
    return f"नमस्ते! क्या आप {persona.get('product', 'इस product')} की requirement के लिए call कर रहे हैं?"


def sim_cost(n_calls: int, voice: bool = False) -> dict:
    """Free estimate. The real prompt is sent on every VANI turn, so tokens, not voice, dominate."""
    pt = int(len(rp.render(rp.flows(load_base()["text"])["inbound_redirect"], product_name="x", ast_seller_pns="1", ast_flow_live="true")) / 3.6)
    bot_in = n_calls * MAX_TURNS * (pt + 500)
    bot_out = n_calls * MAX_TURNS * 70
    buyer_in = n_calls * MAX_TURNS * 450
    tag = sp.llm_cost(n_calls * 2300, n_calls * 350)
    llm = sp.llm_cost(bot_in + buyer_in, bot_out + n_calls * MAX_TURNS * 40) + tag
    tts = n_calls * MAX_TURNS * 2 * 95 / 1000 * TTS_INR_PER_1K_CHARS if voice else 0.0
    return {"calls": n_calls, "prompt_tokens_per_vani_turn": pt, "llm_inr": round(llm, 2), "tts_inr": round(tts, 2), "total_inr": round(llm + tts, 2),
            "chat_requests": n_calls * MAX_TURNS * 2}


def plan() -> dict:
    n_calls = len(PERSONAS) * 2
    return {**sim_cost(n_calls, voice=True), "already_spent_inr": round(spent(), 2)}


BOT_SUFFIX = ("\n\n## Simulation\nThis is a live phone call and no tools exist: never output tool calls, variable updates, JSON or notes. Speak natural Hinglish "
              "(Hindi words in Devanagari, English words in Latin script) so it can be read aloud. Reply with ONLY the words you say, at most two short sentences. "
              "When the call reaches a closing path, end your last sentence with [END]. Never write placeholders or square brackets.")


def buyer_system(p: dict) -> str:
    return (f"You are playing a BUYER on a phone call. You called a seller from the IndiaMART app about {p.get('product', 'a product')}; the seller did not answer "
            f"and an IndiaMART assistant (a voice bot) now speaks to you.\n"
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
        """bot_prompt is the already-rendered VANI prompt. VANI's predefined opening is the first line, as on a real redirected call."""
        op = opening(persona)
        lines = [{"speaker": "bot", "text": op}]
        system = bot_prompt + BOT_SUFFIX + f"\n\nThe predefined opening message has already been said to the buyer: {op}"
        for _ in range(MAX_TURNS):
            buyer_hist = [{"role": "user" if l["speaker"] == "bot" else "assistant", "content": l["text"]} for l in lines]
            buyer = self._chat(buyer_system(persona), buyer_hist)
            if not buyer:
                break
            lines.append({"speaker": "buyer", "text": buyer})
            bot_hist = [{"role": "user" if l["speaker"] == "buyer" else "assistant", "content": l["text"]} for l in lines[1:]]
            bot = self._chat(system, bot_hist)
            end = "[END]" in bot
            bot = bot.replace("[END]", "").strip()
            if bot:
                lines.append({"speaker": "bot", "text": bot})
            if end or not bot:
                break
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
            variant = "fix_candidate" if (sp.DATA / "proposal.json").exists() else "reconcile_limits"
        bv = make_variant(variant)
        base = load_base()
        variants = {"A": base["text"], "B": bv["text"]}
        if data.get("base_hash") not in (None, base["hash"]):
            data = {"cases": []}                                  # results made with another base prompt are never mixed in
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
                lines = self.simulate(sim_prompt(variants[arm], p), p)
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
            data["base_hash"], data["base_version"] = base["hash"], load_base()["version"]
            data["generated"] = time.strftime("%Y-%m-%d %H:%M")
            data["note"] = ("Illustrative: Sarvam chat model plays the buyer and VANI, Bulbul speaks both, the Sarvam tagger scores the call. "
                            "Three buyers per prompt is a demonstration, not a statistical test.")
            f.write_text(json.dumps(data, ensure_ascii=False, indent=1))
        return {"cases": len(data["cases"]), "spent_inr": round(spent(), 2)}


def chars_cost(n: int) -> float:
    return n / 1000 * TTS_INR_PER_1K_CHARS


def load() -> dict | None:
    f = ARENA / "arena.json"
    if not f.exists():
        return None
    d = json.loads(f.read_text())
    d["stale"] = d.get("base_hash") != load_base()["hash"]          # made with a different (e.g. the earlier stand-in) base prompt
    return d
