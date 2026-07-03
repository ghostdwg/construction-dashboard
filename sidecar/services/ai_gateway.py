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


def build_client(api_key: Optional[str] = None) -> Any:
    """Construct the sanctioned Anthropic client — identical to what callers
    built inline before migration: ``anthropic.Anthropic(api_key=api_key)``.

    The ``anthropic`` package is imported lazily (same path ``create_message``
    uses), so importing this module never requires the package. SDK defaults are
    preserved exactly: only ``api_key`` is passed through, nothing else. This
    adds no retries, routing, classification, sanitization, logging, or policy —
    it is only a client constructor, centralized in the one sanctioned site.
    """
    import anthropic  # lazy: only needed to build a real client

    return anthropic.Anthropic(api_key=api_key)


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
    response plus verbatim usage counts. If the provider returns ``None`` it is
    passed through as ``raw=None`` (never dereferenced). See module docstring for
    guarantees."""
    if client is None:
        client = build_client(api_key)

    kwargs = {"model": model, "max_tokens": max_tokens, "messages": messages}
    if system is not None:
        kwargs["system"] = system
    if temperature is not None:
        kwargs["temperature"] = temperature

    # Provider errors propagate unchanged (status codes / exception types kept).
    raw = client.messages.create(**kwargs)

    # Transparent passthrough: if the provider returns None, relay it as-is
    # (raw=None) without dereferencing it, so callers see the same None a direct
    # SDK call would have returned. Strictly `is None`, not a general falsy check.
    if raw is None:
        return AiResult(
            text="",
            usage={"input_tokens": 0, "output_tokens": 0},
            model="",
            stop_reason=None,
            raw=None,
        )

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


def provider_api_status_code(exc: BaseException) -> Optional[int]:
    """Return an HTTP status code ONLY when ``exc`` is a genuine Anthropic
    ``APIStatusError`` that exposes one; otherwise ``None``.

    This is a TYPE check, not a duck-typed attribute probe: an unrelated
    exception that merely carries a ``status_code`` attribute (a custom error, a
    transport error, another provider's error) returns ``None``. It exists so a
    caller's retry loop can preserve the original "catch only
    ``anthropic.APIStatusError`` and inspect ``status_code``" semantics while the
    knowledge of the provider exception type lives here, in the sanctioned
    gateway — the caller no longer needs to import ``anthropic`` itself.

    The ``anthropic`` package is imported lazily; if it is unavailable the
    exception cannot be a genuine ``APIStatusError``, so this returns ``None``.
    It adds no retries, sleeping, or policy — it only classifies an exception.
    """
    try:
        import anthropic  # lazy: only the type object is needed
    except ImportError:
        return None

    if isinstance(exc, anthropic.APIStatusError):
        code = getattr(exc, "status_code", None)
        return code if isinstance(code, int) else None
    return None
