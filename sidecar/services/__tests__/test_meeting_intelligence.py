"""
Offline, mock-only tests for the N3 Option-A credential migration of
`meeting_intelligence.analyze_meeting_with_context` and
`analyze_meeting_transcript` (docs/architecture/adr/0001-ai-credential-resolution.md).

Before this migration, `analyze_meeting_with_context` computed
`effective_key = api_key or ANTHROPIC_API_KEY` — a documented but rejected
hybrid (ADR Option C) that let a caller bug silently substitute a
possibly-different env-configured key. Both functions now require an
explicit `api_key` parameter, fail closed with no value, and route client
construction through `ai_gateway.build_client()` instead of constructing
`anthropic.Anthropic(...)` directly.

No real network, no real provider: `httpx` calls are never exercised here
(only the Claude-analysis functions are under test), and `anthropic` need not
be installed — `ai_gateway.build_client` is monkeypatched directly.

Runnable two ways:
  * plain stdlib:  python3 sidecar/services/__tests__/test_meeting_intelligence.py
  * pytest:        pytest sidecar/services/__tests__/test_meeting_intelligence.py
"""
import asyncio
import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# `httpx` is only used by the transcription-side functions (not under test
# here); stub it so importing the module needs no real install, same
# approach test_ai_gateway.py uses for `anthropic`.
if "httpx" not in sys.modules:
    sys.modules["httpx"] = types.ModuleType("httpx")

from services import ai_gateway  # noqa: E402
from services import meeting_intelligence  # noqa: E402

SENTINEL = "sk-test-sentinel-do-not-use-12345"


class _FakeMessage:
    def __init__(self, text, i, o):
        self.content = [types.SimpleNamespace(type="text", text=text)]
        self.usage = types.SimpleNamespace(input_tokens=i, output_tokens=o)


class _FakeAnthropicClient:
    def __init__(self, response_text):
        self.calls = []
        self._response_text = response_text
        self.messages = types.SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        return _FakeMessage(self._response_text, 20, 10)


class _FakeBuildClient:
    def __init__(self, response_text='{"summary": "ok"}'):
        self.captured_api_keys = []
        self.last_client = None
        self._response_text = response_text

    def __call__(self, api_key=None):
        self.captured_api_keys.append(api_key)
        self.last_client = _FakeAnthropicClient(self._response_text)
        return self.last_client


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _patch(fake):
    original = ai_gateway.build_client
    ai_gateway.build_client = fake
    return original


def _restore(original):
    ai_gateway.build_client = original


# ---- 1. Sentinel traversal (analyze_meeting_with_context, the wired bypass) --
def test_sentinel_traverses_to_build_client_exactly_with_context():
    fake = _FakeBuildClient('{"section3": "overview"}')
    original = _patch(fake)
    try:
        result = _run(meeting_intelligence.analyze_meeting_with_context(
            transcript="hello world",
            project_name="Test Project",
            api_key=SENTINEL,
        ))
    finally:
        _restore(original)

    assert fake.captured_api_keys == [SENTINEL]
    assert result["analysis"]["section3"] == "overview"
    assert result["tokensUsed"] == {"input": 20, "output": 10}


def test_sentinel_traverses_to_build_client_exactly_legacy_wrapper():
    fake = _FakeBuildClient('{"summary": "ok", "actionItems": []}')
    original = _patch(fake)
    try:
        result = _run(meeting_intelligence.analyze_meeting_transcript(
            transcript="hello",
            meeting_title="Weekly OAC",
            meeting_type="GENERAL",
            project_name="Test Project",
            api_key=SENTINEL,
        ))
    finally:
        _restore(original)

    assert fake.captured_api_keys == [SENTINEL]
    assert result["summary"] == "ok"


# ---- 2. No leakage ------------------------------------------------------------
def test_sentinel_never_leaks_into_response_or_provider_call_kwargs():
    fake = _FakeBuildClient('{"section3": "overview"}')
    original = _patch(fake)
    try:
        result = _run(meeting_intelligence.analyze_meeting_with_context(
            transcript="hello world, contact info removed",
            project_name="Test Project",
            api_key=SENTINEL,
        ))
    finally:
        _restore(original)

    assert SENTINEL not in json.dumps(result)
    calls = fake.last_client.calls
    assert len(calls) == 1
    assert SENTINEL not in json.dumps(calls[0], default=str)


def test_sentinel_never_leaks_into_a_thrown_error_message():
    class _BadClient:
        def __init__(self):
            self.messages = types.SimpleNamespace(create=self._create)

        def _create(self, **kwargs):
            raise RuntimeError("simulated provider failure")

    def fake_build_client(api_key=None):
        return _BadClient()

    original = _patch(fake_build_client)
    raised = None
    try:
        _run(meeting_intelligence.analyze_meeting_with_context(
            transcript="hello",
            project_name="Test Project",
            api_key=SENTINEL,
        ))
    except RuntimeError as e:
        raised = e
    finally:
        _restore(original)

    assert raised is not None
    assert SENTINEL not in str(raised)


# ---- 3. Fail-closed when no credential is supplied — no env fallback --------
def test_analyze_with_context_fails_closed_with_no_env_fallback():
    fake = _FakeBuildClient()
    original = _patch(fake)
    # Prove there is genuinely no env fallback left: even if the sidecar
    # process happened to have ANTHROPIC_API_KEY set locally, a caller that
    # omits api_key must still fail loudly (Option A rejects Option C's
    # `effective_key = api_key or ANTHROPIC_API_KEY` hybrid).
    saved_module_const = meeting_intelligence.ANTHROPIC_API_KEY
    meeting_intelligence.ANTHROPIC_API_KEY = "sk-should-never-be-used-as-a-fallback"
    raised = None
    try:
        _run(meeting_intelligence.analyze_meeting_with_context(
            transcript="hello",
            project_name="Test Project",
            api_key=None,
        ))
    except ValueError as e:
        raised = e
    finally:
        _restore(original)
        meeting_intelligence.ANTHROPIC_API_KEY = saved_module_const

    assert raised is not None, "missing api_key must raise, never silently substitute the env var"
    assert "ANTHROPIC_API_KEY" in str(raised)
    assert fake.captured_api_keys == [], "build_client must never be reached when the key is missing"


def test_legacy_wrapper_fails_closed_when_api_key_missing():
    fake = _FakeBuildClient()
    original = _patch(fake)
    raised = None
    try:
        _run(meeting_intelligence.analyze_meeting_transcript(
            transcript="hello",
            meeting_title="t",
            meeting_type="GENERAL",
            project_name="p",
            api_key=None,
        ))
    except ValueError as e:
        raised = e
    finally:
        _restore(original)

    assert raised is not None
    assert fake.captured_api_keys == []


# ---- 4. Real-vs-stub construction signal is unaffected ----------------------
def test_build_client_seam_untouched_by_this_migration():
    fake_anthropic = types.ModuleType("anthropic")
    captured = {}

    class _Anthropic:
        def __init__(self, api_key=None, **kwargs):
            captured["api_key"] = api_key

    fake_anthropic.Anthropic = _Anthropic
    saved = sys.modules.get("anthropic")
    sys.modules["anthropic"] = fake_anthropic
    try:
        ai_gateway.build_client(SENTINEL)
        assert captured["api_key"] == SENTINEL
    finally:
        if saved is not None:
            sys.modules["anthropic"] = saved
        else:
            sys.modules.pop("anthropic", None)


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
    print(f"\ntest_meeting_intelligence: {'PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    sys.exit(1 if failures else 0)
