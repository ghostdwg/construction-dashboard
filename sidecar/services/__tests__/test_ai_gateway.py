"""
Offline, mock-only tests for the sidecar AI gateway (P1B) and the migrated
ai_extractor caller. No network, no `anthropic` package required: a fake client
is injected into the gateway, and the gateway function is monkeypatched for the
extractor test.

Runnable two ways:
  * plain stdlib:  python3 sidecar/services/__tests__/test_ai_gateway.py
  * pytest:        pytest sidecar/services/__tests__/test_ai_gateway.py
"""
import os
import sys
from pathlib import Path

# Put the sidecar root on sys.path so `services.*` imports resolve.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from services import ai_gateway  # noqa: E402
from services import ai_extractor  # noqa: E402


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


class FakeClient:
    """Mimics `anthropic.Anthropic` enough for the relay: client.messages.create."""
    def __init__(self, message=None, error=None):
        self._message = message
        self._error = error
        self.calls = []
        self.messages = self  # so `client.messages.create(...)` reaches .create

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return self._message


class FakeAPIStatusError(Exception):
    """Stands in for anthropic.APIStatusError with a preserved status_code."""
    def __init__(self, status_code):
        super().__init__(f"status {status_code}")
        self.status_code = status_code


# ---- 1. Request fidelity ---------------------------------------------------
def test_request_fidelity_minimal():
    fc = FakeClient(message=FakeMessage("hi", 10, 5))
    ai_gateway.create_message(
        model="m1", max_tokens=200,
        messages=[{"role": "user", "content": "p"}], api_key="k", client=fc,
    )
    assert fc.calls[0] == {
        "model": "m1", "max_tokens": 200,
        "messages": [{"role": "user", "content": "p"}],
    }, "system/temperature must be omitted when not provided"


def test_request_fidelity_with_system_only():
    fc = FakeClient(message=FakeMessage("hi", 1, 1))
    ai_gateway.create_message(
        model="m2", max_tokens=50, messages=[{"role": "user", "content": "p"}],
        api_key="k", system="SYS", client=fc,
    )
    assert fc.calls[0]["system"] == "SYS"
    assert "temperature" not in fc.calls[0]


# ---- 2. Response / usage fidelity -----------------------------------------
def test_response_and_usage_fidelity():
    msg = FakeMessage("hello world", 12, 7, model="mX", stop_reason="end_turn")
    fc = FakeClient(message=msg)
    r = ai_gateway.create_message(
        model="mX", max_tokens=100,
        messages=[{"role": "user", "content": "p"}], api_key="k", client=fc,
    )
    assert r.raw is msg                      # unmodified provider object
    assert r.text == "hello world"           # exact text
    assert r.usage == {"input_tokens": 12, "output_tokens": 7}  # verbatim
    assert r.model == "mX"
    assert r.stop_reason == "end_turn"


# ---- 4. Error / status fidelity -------------------------------------------
def test_error_and_status_fidelity():
    err = FakeAPIStatusError(429)
    fc = FakeClient(error=err)
    raised = None
    try:
        ai_gateway.create_message(
            model="m", max_tokens=1, messages=[{"role": "user", "content": "p"}],
            api_key="k", client=fc,
        )
    except Exception as e:  # noqa: BLE001
        raised = e
    assert raised is err, "gateway must re-raise the original provider exception"
    assert getattr(raised, "status_code", None) == 429, "status_code preserved"


# ---- 3. Parser + cost fidelity through the migrated caller -----------------
def test_ai_extractor_parser_and_cost_fidelity():
    it, ot = 100, 50
    fenced = '```json\n{"submittals": ["A"], "warranties": []}\n```'
    captured = {}

    original = ai_gateway.create_message

    def fake_create(**kwargs):
        captured.update(kwargs)
        return ai_gateway.AiResult(
            text=fenced,
            usage={"input_tokens": it, "output_tokens": ot},
            model="claude-sonnet-4-20250514",
            stop_reason="end_turn",
            raw=FakeMessage(fenced, it, ot),
        )

    ai_gateway.create_message = fake_create
    os.environ["ANTHROPIC_API_KEY"] = "test-key"
    try:
        section = {"section_number": "03 30 00", "title": "Concrete", "raw_text": "x" * 20}
        res = ai_extractor.extract_from_section(section, extract_types={"submittals"})
    finally:
        ai_gateway.create_message = original

    # Parser fidelity: fenced JSON still stripped + parsed identically.
    assert res.extractions == {"submittals": ["A"], "warranties": []}
    # Usage/cost fidelity: same formula as before migration.
    expected_cost = round(
        it * ai_extractor.SONNET_INPUT_COST + ot * ai_extractor.SONNET_OUTPUT_COST, 6
    )
    assert res.input_tokens == it and res.output_tokens == ot
    assert res.cost_usd == expected_cost
    # Request fidelity from the caller: model/max_tokens/system forwarded.
    assert captured["max_tokens"] == 2000
    assert "system" in captured and captured["model"]


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
    print(f"\ntest_ai_gateway: {'PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    sys.exit(1 if failures else 0)
