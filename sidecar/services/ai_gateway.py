"""
Single AI gateway (P1B) — a TRANSPARENT, behavior-preserving relay for
Anthropic Messages calls in the sidecar.

It intentionally does NOT: normalize model ids, validate routing, sanitize/
redact/classify content, change retry/timeout behavior, compute cost, or alter
API keys. Callers keep all prompt assembly, response parsing, retry loops,
cost math, and error handling exactly as before. Provider exceptions (including
``anthropic.APIStatusError`` with its ``status_code``) propagate unchanged.

The ``anthropic`` package is imported lazily and only when a real client must
be constructed, so this module — and callers that inject a client in tests —
import without the package installed.

This is the ONE sanctioned site that constructs a provider client; the P0
guardrail allow-lists this file and forbids direct provider construction
elsewhere.
"""
from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class AiResult:
    text: str
    usage: dict  # {"input_tokens": int, "output_tokens": int} — verbatim
    model: str
    stop_reason: Optional[str]
    raw: Any  # unmodified provider Message object


def create_message(
    *,
    model: str,
    max_tokens: int,
    messages: list,
    api_key: Optional[str] = None,
    system: Optional[str] = None,
    temperature: Optional[float] = None,
    client: Any = None,
) -> AiResult:
    """Relay a single Anthropic Messages request unchanged and return the raw
    response plus verbatim usage counts. See module docstring for guarantees."""
    if client is None:
        import anthropic  # lazy: only needed to build a real client

        client = anthropic.Anthropic(api_key=api_key)

    kwargs = {"model": model, "max_tokens": max_tokens, "messages": messages}
    if system is not None:
        kwargs["system"] = system
    if temperature is not None:
        kwargs["temperature"] = temperature

    # Provider errors propagate unchanged (status codes / exception types kept).
    raw = client.messages.create(**kwargs)

    text = "".join(
        getattr(b, "text", "")
        for b in raw.content
        if getattr(b, "type", None) == "text"
    )
    return AiResult(
        text=text,
        usage={
            "input_tokens": raw.usage.input_tokens,
            "output_tokens": raw.usage.output_tokens,
        },
        model=raw.model,
        stop_reason=getattr(raw, "stop_reason", None),
        raw=raw,
    )
