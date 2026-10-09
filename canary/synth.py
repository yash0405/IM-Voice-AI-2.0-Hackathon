"""Synthetic labelled call set - because we were given recordings but no labels.

What it is for: (1) a regression test that the auto-disposition plumbing works end to end,
(2) a measured sensitivity/specificity to feed the evaluator-error study, (3) a placeholder until
real hand labels (Label Lab) exist. What it is NOT: accuracy on real calls. The scripts were written
by us, so treat the result as an optimistic bound. The `hard` set uses phrasings the rules do not list.
Scenario: VANI calls a buyer because the seller is unavailable, to capture the requirement.
"""
from __future__ import annotations

import random

from .evaluator import RuleEvaluator, metrics

OPEN = ["Namaste, main VANI bol rahi hoon IndiaMART se. Aapne {p} ke liye enquiry ki thi, kya aap abhi bhi dekh rahe hain?",
        "Hello, this is VANI from IndiaMART. You enquired about {p}. Are you still looking for it?",
        "नमस्ते, मैं इंडियामार्ट से वानी बोल रही हूँ। आपने {p} के लिए पूछा था, क्या अभी भी ज़रूरत है?"]
PRODUCTS = ["steel pipes", "cotton fabric", "LED lights", "packaging boxes", "water pumps"]
QTY = ["500 pieces", "2 ton", "1000 kg", "50 units", "200 meters"]
SPEC = ["stainless steel grade 304", "size 20 mm", "brand Philips 12 watt", "thickness 5 mm", "white colour"]
CITY = ["Mumbai", "Pune", "Delhi", "Surat", "Jaipur"]
WHEN = ["within 10 days", "urgent", "next week", "within 2 weeks", "tomorrow"]

EASY = {
    "buylead_created": ["Haan chahiye, {q} {s}, delivery {c} mein, {w} chahiye.",
                        "Yes I need {q}, {s}, deliver to {c}, required {w}.",
                        "हाँ चाहिए, {q}, {s}, डिलीवरी {c}, {w}।"],
    "partial": ["Haan chahiye, {q} chahiye bas, baaki baad mein batata hoon.",
                "Yes I need it, size {s} only, I will tell the rest later.",
                "Haan {c} mein chahiye, abhi quantity pata nahi."],
    "callback_fixed": ["Abhi main busy hoon, baad mein call kijiye.",
                       "I am in a meeting, please call back later.",
                       "अभी बिज़ी हूँ, बाद में कॉल कीजिए।"],
    "not_interested": ["Nahi chahiye ab, requirement khatam ho gayi.", "Not interested, please don't call again.",
                       "Hume zaroorat nahi hai, band karo.", "रुचि नहीं है, मत करो कॉल।"],
    "no_connect": ["The number you have dialled is currently switched off.", "Please leave your message after the beep.",
                   "hello hello", "आप जिस नंबर से संपर्क करना चाहते हैं वह उपलब्ध नहीं है"],
    "other": ["Aap kaun bol rahe ho? Seller ka number do mujhe seedha baat karni hai.",
              "Mujhe pehle seller se baat karni hai, tum kya karoge is details ka?",
              "Which company is this? Why are you asking me all this?"],
}
HARD = {
    "buylead_created": ["Das hazaar chahiye, Pune bhej dena, agle hafte tak, ISI mark wala.",
                        "Around 500, 20 mm size, Surat, I need it within 10 days.",
                        "Delhi mein chahiye {q} {w}, grade {s}.",
                        "Wahi {q} bhej do jo pehle bataya tha, Rohtak mein, parso tak.",
                        "Mujhe {q} chahiye Nashik ke liye, kal tak mil jaye to theek hai."],
    "partial": ["Bas rate bata do pehle, {c} mein chahiye.", "Kuch bhi bhej do, quantity baad mein.",
                "Mujhe {s} wala dekhna hai, abhi order nahi dena."],
    "callback_fixed": ["Abhi nahi, shaam ko baat karte hain is par.", "Thoda time dijiye, main khud phone kar lunga.",
                       "Hello? Awaaz nahi aa rahi, dobara try kijiye."],
    "not_interested": ["Mere liye ye sahi nahi hai, aap dobara phone mat kijiyega.",
                       "Order nahi chahiye, {c} wala supplier mil gaya.",
                       "Mujhe pehle se hi mil gaya, ab koi zaroorat nahi."],
    "no_connect": ["haan", "hello", "ji"],
    "other": ["Order {q} ka tha lekin delivery late hui thi pichli baar, uska kya hua?",
              "Theek hai, mujhe email par details bhej do, phir dekhta hoon."],
}


def _noise(text: str, rng: random.Random, p: float) -> str:
    out = []
    for w in text.split():
        r = rng.random()
        if r < p / 2:
            continue
        if r < p and len(w) > 3:
            i = rng.randrange(len(w) - 1)
            w = w[:i] + w[i + 1] + w[i] + w[i + 2:]
        out.append(w)
    return " ".join(out)


def make_benchmark(n: int = 400, seed: int = 7) -> list[dict]:
    rng = random.Random(seed)
    labels = list(EASY)
    rows = []
    for i in range(n):
        label = labels[i % len(labels)]
        hard = rng.random() < 0.4
        tpl = rng.choice((HARD if hard else EASY)[label])
        buyer = tpl.format(q=rng.choice(QTY), s=rng.choice(SPEC), c=rng.choice(CITY), w=rng.choice(WHEN))
        buyer = _noise(buyer, rng, rng.choice([0.0, 0.04, 0.08, 0.12]))
        turns = [{"speaker": "bot", "text": rng.choice(OPEN).format(p=rng.choice(PRODUCTS))}, {"speaker": "buyer", "text": buyer}]
        rows.append({"id": f"syn-{i:03d}", "label": label, "difficulty": "hard" if hard else "easy", "transcript": turns})
    return rows


def benchmark_report(n: int = 400, seed: int = 7) -> dict:
    rows = make_benchmark(n, seed)
    ev = RuleEvaluator()
    pred = [ev.classify(r["transcript"])["label"] for r in rows]
    truth = [r["label"] for r in rows]
    out = {"note": "SYNTHETIC scripts written by the team; optimistic bound, not accuracy on real calls",
           "n": n, "seed": seed, "overall": metrics(truth, pred)}
    for diff in ("easy", "hard"):
        idx = [i for i, r in enumerate(rows) if r["difficulty"] == diff]
        out[diff] = metrics([truth[i] for i in idx], [pred[i] for i in idx])
    out["errors"] = [{"id": r["id"], "truth": r["label"], "pred": p, "text": r["transcript"][1]["text"]}
                     for r, p in zip(rows, pred) if r["label"] != p][:12]
    return out
