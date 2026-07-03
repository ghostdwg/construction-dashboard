"""
Offline, mock-only fidelity tests for the migrated schedule_intelligence caller
(P1B-2). No network and no `anthropic` package required: ai_gateway.create_message
is monkeypatched, so the real gateway/client is never constructed.

These assert that routing schedule generation through the transparent gateway
preserves — byte-for-byte — the prior behavior:
  * request forwarding (resolved model id, max_tokens=8000, system, messages)
  * JSON extraction via the real _extract_json (embedded object, no fences)
  * cost math and token passthrough (same COST_RATES formula as before)
  * exception behavior on unparseable output (RuntimeError)

Runnable two ways:
  * plain stdlib:  python3 sidecar/services/__tests__/test_schedule_intelligence.py
  * pytest:        pytest sidecar/services/__tests__/test_schedule_intelligence.py
"""
import os
import sys
from pathlib import Path

# Put the sidecar root on sys.path so `services.*` imports resolve.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from services import ai_gateway  # noqa: E402
from services import schedule_intelligence as si  # noqa: E402


# ---- Fakes (no real provider) ---------------------------------------------
class FakeTextBlock:
    def __init__(self, text):
        self.type = "text"
        self.text = text


class FakeUsage:
    def __init__(self, i, o):
        self.input_tokens = i
        self.output_tokens = o


class FakeMessage:
    def __init__(self, text, i, o, model="claude-sonnet-4-6", stop_reason="end_turn"):
        self.content = [FakeTextBlock(text)]
        self.usage = FakeUsage(i, o)
        self.model = model
        self.stop_reason = stop_reason


def _patched_gateway(returns_text, it, ot, captured, model="claude-sonnet-4-6"):
    """Return a fake ai_gateway.create_message capturing kwargs and returning
    an AiResult whose .raw mimics the provider Message the caller reads."""
    def fake_create(**kwargs):
        captured.update(kwargs)
        return ai_gateway.AiResult(
            text=returns_text,
            usage={"input_tokens": it, "output_tokens": ot},
            model=model,
            stop_reason="end_turn",
            raw=FakeMessage(returns_text, it, ot, model=model),
        )
    return fake_create


SAMPLE_SECTIONS = [
    {"csi": "03 30 00", "title": "Cast-in-Place Concrete", "ai_extractions": None},
    {"csi": "05 12 00", "title": "Structural Steel", "ai_extractions": None},
]


# ---- 1. Request forwarding + parser + cost fidelity (sonnet) ----------------
def test_request_parser_and_cost_fidelity():
    it, ot = 1234, 567
    # Real Claude output shape: prose around an embedded JSON object, no fences.
    body = (
        'Here is the calibration.\n'
        '{"project_summary": "s", "estimated_weeks": 40, '
        '"activity_overrides": [{"code": "P3090", "duration_days": 12}], '
        '"new_activities": [], "procurement_activities": []}\n'
        'End of analysis.'
    )
    captured = {}
    original = ai_gateway.create_message
    ai_gateway.create_message = _patched_gateway(body, it, ot, captured)
    os.environ["ANTHROPIC_API_KEY"] = "test-key"
    try:
        out = si.generate_schedule_intelligence(SAMPLE_SECTIONS, None, "sonnet")
    finally:
        ai_gateway.create_message = original

    # Parser fidelity: real _extract_json pulled the embedded object out intact.
    assert out["estimated_weeks"] == 40
    assert out["project_summary"] == "s"
    assert out["activity_overrides"] == [{"code": "P3090", "duration_days": 12}]
    assert out["new_activities"] == [] and out["procurement_activities"] == []

    # Token passthrough + cost math: identical to pre-migration formula.
    rates = si.COST_RATES["claude-sonnet-4-6"]
    expected_cost = round(it * rates["input"] + ot * rates["output"], 4)
    assert out["input_tokens"] == it and out["output_tokens"] == ot
    assert out["cost_usd"] == expected_cost

    # Request forwarding: model resolved via MODEL_MAP, max_tokens + system kept.
    assert captured["model"] == si.MODEL_MAP["sonnet"]
    assert captured["max_tokens"] == 8_000
    assert captured["system"] == si.SYSTEM_PROMPT
    assert captured["messages"][0]["role"] == "user"
    assert captured["api_key"] == "test-key"


# ---- 2. Model-map resolution fidelity (opus alias) -------------------------
def test_model_alias_resolution():
    captured = {}
    body = '{"activity_overrides": [], "new_activities": [], "procurement_activities": []}'
    original = ai_gateway.create_message
    ai_gateway.create_message = _patched_gateway(body, 1, 1, captured, model="claude-opus-4-6")
    os.environ["ANTHROPIC_API_KEY"] = "test-key"
    try:
        si.generate_schedule_intelligence(SAMPLE_SECTIONS, None, "opus46")
    finally:
        ai_gateway.create_message = original
    assert captured["model"] == "claude-opus-4-6"


# ---- 3. Unparseable-output exception fidelity ------------------------------
def test_unparseable_raises_runtimeerror():
    captured = {}
    original = ai_gateway.create_message
    ai_gateway.create_message = _patched_gateway("no json here at all", 1, 1, captured)
    os.environ["ANTHROPIC_API_KEY"] = "test-key"
    raised = None
    try:
        si.generate_schedule_intelligence(SAMPLE_SECTIONS, None, "sonnet")
    except RuntimeError as e:
        raised = e
    finally:
        ai_gateway.create_message = original
    assert raised is not None, "unparseable output must raise RuntimeError as before"


# ---- 4. Missing-key guard is unchanged (never reaches gateway) -------------
def test_missing_api_key_raises_before_gateway():
    captured = {}
    original = ai_gateway.create_message
    ai_gateway.create_message = _patched_gateway("{}", 1, 1, captured)
    saved = os.environ.pop("ANTHROPIC_API_KEY", None)
    raised = None
    try:
        si.generate_schedule_intelligence(SAMPLE_SECTIONS, None, "sonnet")
    except RuntimeError as e:
        raised = e
    finally:
        ai_gateway.create_message = original
        if saved is not None:
            os.environ["ANTHROPIC_API_KEY"] = saved
    assert raised is not None, "missing key must raise before any gateway call"
    assert captured == {}, "gateway must not be called when key is absent"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failures = 0
    for t in tests:
        try:
            t()
            print(f"  ok:   {t.__name__}")
        except AssertionError as e:
            failures += 1
            print(f"  FAIL: {t.__name__}: {e}")
    print(f"\ntest_schedule_intelligence: {'PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    sys.exit(1 if failures else 0)
