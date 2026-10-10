"""Where the Sarvam platform plugs in. Nothing here talks to the network: we deliberately have not
touched the platform yet. Each hook is a tiny interface the rest of the system already uses.

1. Transcriber   - Sarvam speech-to-text (batch API supports diarization; max 20 files per job).
                   Write <idx>.json (list of {"speaker","text"}) into a folder, then:
                   python -m picky eval --transcripts DIR      (scores a tagger on real hand labels)
2. Completer     - Sarvam chat-completion model behind the auto-disposition tagger:
                   LLMEvaluator(complete=my_sarvam_chat_fn).classify(transcript)
                   Prompt template: data/evaluator_prompt.md. Mind the rate limits (tens of requests/min).
3. CallRunner    - replace TrafficSim.observe(arm, call) with a function that places or simulates a call
                   with the arm's prompt on the voice agent, then tags it. Same (logged, converted,
                   duration) return shape, so the engine, ledger and dashboard are unchanged.
Promotion today flips a local production-prompt pointer (production_before/after in the ledger). Making it
update a real agent needs the platform's agent-update API; ask the Sarvam team whether one exists.
"""
from __future__ import annotations

from typing import Callable, Protocol


class Transcriber(Protocol):
    def transcribe(self, audio_path: str) -> list[dict]: ...


Completer = Callable[[str], str]


class CallRunner(Protocol):
    def observe(self, arm: str, call: dict) -> tuple[bool, int, float]:
        """Return (logged, converted, duration_seconds) for one first call routed to `arm`."""
