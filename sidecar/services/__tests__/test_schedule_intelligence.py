"""
Offline, mock-only fidelity tests for the migrated schedule_intelligence caller
(P1B-2, and its Option-A credential migration per ADR 0002). No network and no
`anthropic` package required: generate_schedule_intelligence() builds its own
client via ai_gateway.build_client(), so tests monkeypatch build_client to
inject a fake client (mirroring submittal_intelligence.py's precedent).

These assert that routing schedule generation through the transparent gateway
preserves — byte-for-byte — the prior behavior:
  * request forwarding (resolved model id, max_tokens=8000, system, messages)
  * JSON extraction via the real _extract_json (embedded object, no fences)
  * cost math and token passthrough (same COST_RATES formula as before)
  * exception behavior on unparseable output (RuntimeError)
  * missing-api_key guard is now a fail-closed ValueError raised before
    ai_gateway.build_client is ever reached (api_key is a caller-supplied
    parameter now, not an env read)

Runnable two ways:
  * plain stdlib:  python3 sidecar/services/__tests__/test_schedule_intelligence.py
  * pytest:        pytest sidecar/services/__tests__/test_schedule_intelligence.py
"""
import contextlib
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


class FakeClient:
    """Stands in for the real anthropic.Anthropic client returned by
    ai_gateway.build_client(). Records every kwargs dict passed to
    .messages.create(...)."""

    def __init__(self, message):
        self._message = message
        self.calls = []
        self.messages = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._message


@contextlib.contextmanager
def patched_build_client(captured_api_keys, client):
    """Monkeypatch ai_gateway.build_client to record the api_key it was
    called with and return a pre-built FakeClient instead of constructing a
    real anthropic.Anthropic() (which is not installed in this sandbox)."""
    original = ai_gateway.build_client

    def fake_build_client(api_key=None):
        captured_api_keys.append(api_key)
        return client

    ai_gateway.build_client = fake_build_client
    try:
        yield
    finally:
        ai_gateway.build_client = original


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
    fc = FakeClient(FakeMessage(body, it, ot))
    keys = []
    with patched_build_client(keys, fc):
        out = si.generate_schedule_intelligence(SAMPLE_SECTIONS, None, "sonnet", api_key="test-key")

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
    call = fc.calls[0]
    assert call["model"] == si.MODEL_MAP["sonnet"]
    assert call["max_tokens"] == 8_000
    assert call["system"] == si.SYSTEM_PROMPT
    assert call["messages"][0]["role"] == "user"

    # Credential boundary: api_key reached build_client exactly once, and is
    # never forwarded into the provider-call kwargs themselves.
    assert keys == ["test-key"]
    assert "api_key" not in call


# ---- 2. Model-map resolution fidelity (opus alias) -------------------------
def test_model_alias_resolution():
    body = '{"activity_overrides": [], "new_activities": [], "procurement_activities": []}'
    fc = FakeClient(FakeMessage(body, 1, 1, model="claude-opus-4-6"))
    keys = []
    with patched_build_client(keys, fc):
        si.generate_schedule_intelligence(SAMPLE_SECTIONS, None, "opus46", api_key="test-key")
    assert fc.calls[0]["model"] == "claude-opus-4-6"


# ---- 3. Unparseable-output exception fidelity ------------------------------
def test_unparseable_raises_runtimeerror():
    fc = FakeClient(FakeMessage("no json here at all", 1, 1))
    keys = []
    raised = None
    with patched_build_client(keys, fc):
        try:
            si.generate_schedule_intelligence(SAMPLE_SECTIONS, None, "sonnet", api_key="test-key")
        except RuntimeError as e:
            raised = e
    assert raised is not None, "unparseable output must raise RuntimeError as before"


# ---- 4. Missing-key guard fails closed before build_client is reached ------
def test_missing_api_key_raises_before_build_client():
    def boom(api_key=None):
        raise AssertionError("build_client must not be called without a key")

    original = ai_gateway.build_client
    ai_gateway.build_client = boom
    raised = None
    try:
        si.generate_schedule_intelligence(SAMPLE_SECTIONS, None, "sonnet", api_key=None)
    except ValueError as e:
        raised = e
    finally:
        ai_gateway.build_client = original
    assert raised is not None, "missing key must raise before any gateway call"
    assert str(raised) == "ANTHROPIC_API_KEY not configured — set it in Settings → AI Configuration"


def test_empty_string_api_key_also_fails_closed():
    def boom(api_key=None):
        raise AssertionError("build_client must not be called with an empty key")

    original = ai_gateway.build_client
    ai_gateway.build_client = boom
    raised = None
    try:
        si.generate_schedule_intelligence(SAMPLE_SECTIONS, None, "sonnet", api_key="")
    except ValueError as e:
        raised = e
    finally:
        ai_gateway.build_client = original
    assert raised is not None


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
