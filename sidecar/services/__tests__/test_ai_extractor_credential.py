"""
Offline, mock-only tests for the Option-A credential migration of
`ai_extractor.extract_from_section` and `ai_extractor.extract_from_sections`
(docs/architecture/adr/0001-ai-credential-resolution.md,
docs/architecture/adr/0002-remaining-sidecar-credential-targets.md).

Before this migration, both entry points read `os.getenv("ANTHROPIC_API_KEY")`
directly. ai_extractor.py never constructed its own Anthropic client — it
always relayed through `ai_gateway.create_message(..., api_key=api_key)`,
which itself calls `ai_gateway.build_client(api_key)` whenever no `client` is
injected. That means the migration here is a pure credential-source change
(parameter vs. env read); the client-construction boundary
(`ai_gateway.build_client`) is untouched, and it is still the seam these
tests patch to observe exactly what reaches the provider-construction call.

Both `ai_extractor.py` router entry points
(`POST /parse/specs/ai` and `POST /parse/specs/async` in
sidecar/routers/parse.py) currently have zero live Next.js callers (verified
by grep across app/ and lib/ for `specs/ai` / `specs/async` path fragments —
see ADR 0002 §1.1); this migration is done proactively so no future caller
can silently resurrect the env-only bypass.

`test_ai_gateway.py`'s `test_ai_extractor_parser_and_cost_fidelity` already
covers request/response/parser/cost fidelity through the migrated caller
(updated to pass `api_key=` explicitly instead of relying on an env var).
This file is scoped to the credential-boundary properties themselves:
sentinel traversal, no-leak, fail-closed, and the untouched
`build_client()`/stub-mode seam.

Runnable two ways:
  * plain stdlib:  python3 sidecar/services/__tests__/test_ai_extractor_credential.py
  * pytest:        pytest sidecar/services/__tests__/test_ai_extractor_credential.py
"""
import json
import sys
import types
from pathlib import Path

# Put the sidecar root on sys.path so `services.*` imports resolve.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from services import ai_gateway  # noqa: E402
from services import ai_extractor  # noqa: E402

SENTINEL = "sk-test-sentinel-do-not-use-ai-extractor"


# ---- Fake Anthropic client (installed via ai_gateway.build_client) ---------
class _FakeMessage:
    def __init__(self, text, i, o, model="claude-sonnet-4-20250514"):
        self.content = [types.SimpleNamespace(type="text", text=text)]
        self.usage = types.SimpleNamespace(input_tokens=i, output_tokens=o)
        self.model = model
        self.stop_reason = "end_turn"


class _FakeAnthropicClient:
    def __init__(self, response_text='```json\n{"submittals": []}\n```'):
        self.calls = []
        self._response_text = response_text
        self.messages = types.SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        return _FakeMessage(self._response_text, 10, 5)


class _FakeBuildClient:
    """Records every api_key it was called with; returns a fresh FakeClient."""

    def __init__(self):
        self.captured_api_keys = []
        self.clients = []

    def __call__(self, api_key=None):
        self.captured_api_keys.append(api_key)
        c = _FakeAnthropicClient()
        self.clients.append(c)
        return c


def _patched_build_client(fake):
    original = ai_gateway.build_client
    ai_gateway.build_client = fake
    return original


def _restore_build_client(original):
    ai_gateway.build_client = original


_SECTION = {"section_number": "03 30 00", "title": "Concrete", "raw_text": "x" * 20}


# ---- 1. Sentinel traverses to build_client, and only there ------------------
def test_sentinel_traverses_to_build_client_exactly_extract_from_section():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    try:
        result = ai_extractor.extract_from_section(
            _SECTION, extract_types={"submittals"}, api_key=SENTINEL
        )
    finally:
        _restore_build_client(original)

    assert fake.captured_api_keys == [SENTINEL], (
        "the exact sentinel value must reach ai_gateway.build_client (via "
        "create_message's internal client construction), unmodified, "
        "exactly once for a single extract_from_section call"
    )
    assert result.extractions == {"submittals": []}


def test_sentinel_traverses_to_build_client_exactly_extract_from_sections():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    try:
        out = ai_extractor.extract_from_sections(
            [_SECTION, {**_SECTION, "section_number": "07 00 00", "title": "Thermal"}],
            extract_types={"submittals"},
            api_key=SENTINEL,
        )
    finally:
        _restore_build_client(original)

    # One client build per section processed (no client hoisting/caching —
    # matches pre-migration behavior, where every extract_from_section call
    # independently reached ai_gateway.create_message with just an api_key).
    assert fake.captured_api_keys == [SENTINEL, SENTINEL]
    assert len(out["sections"]) == 2


# ---- 2. No leakage ------------------------------------------------------------
def test_sentinel_never_leaks_into_result_or_provider_call_kwargs():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    try:
        result = ai_extractor.extract_from_section(
            _SECTION, extract_types={"submittals"}, api_key=SENTINEL
        )
        out = ai_extractor.extract_from_sections(
            [_SECTION], extract_types={"submittals"}, api_key=SENTINEL
        )
    finally:
        _restore_build_client(original)

    serialized = json.dumps(result.extractions) + json.dumps(out)
    assert SENTINEL not in serialized, "credential must never appear in returned results"

    # kwargs passed to client.messages.create (model/max_tokens/system/
    # messages) must never carry the credential — it only ever reaches
    # build_client, never the provider request body.
    for client in fake.clients:
        for call in client.calls:
            assert SENTINEL not in json.dumps(call, default=str)


def test_sentinel_never_leaks_into_a_thrown_error_message():
    class _BadClient:
        def __init__(self):
            self.messages = types.SimpleNamespace(create=self._create)

        def _create(self, **kwargs):
            raise RuntimeError(f"simulated provider failure kwargs={kwargs}")

    def fake_build_client(api_key=None):
        return _BadClient()

    original = _patched_build_client(fake_build_client)
    raised = None
    try:
        ai_extractor.extract_from_section(
            _SECTION, extract_types={"submittals"}, api_key=SENTINEL
        )
    except RuntimeError as e:
        raised = e
    finally:
        _restore_build_client(original)

    assert raised is not None
    assert SENTINEL not in str(raised), "sentinel must never appear in an exception message"


# ---- 3. Fail-closed when no credential is supplied ---------------------------
def test_extract_from_section_fails_closed_with_typed_error_when_api_key_missing():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    raised = None
    try:
        ai_extractor.extract_from_section(_SECTION, extract_types={"submittals"}, api_key=None)
    except ValueError as e:
        raised = e
    finally:
        _restore_build_client(original)

    assert raised is not None, "missing api_key must raise a controlled ValueError, not proceed silently"
    assert "ANTHROPIC_API_KEY" in str(raised)
    assert fake.captured_api_keys == [], "build_client must never be reached when the key is missing"


def test_extract_from_sections_fails_closed_before_processing_any_section():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    raised = None
    try:
        ai_extractor.extract_from_sections(
            [_SECTION, _SECTION, _SECTION], extract_types={"submittals"}, api_key=None
        )
    except ValueError as e:
        raised = e
    finally:
        _restore_build_client(original)

    assert raised is not None
    assert "ANTHROPIC_API_KEY" in str(raised)
    assert fake.captured_api_keys == [], (
        "fail-closed check must happen before the loop — no section should be "
        "processed and no client should be built when the key is missing"
    )


def test_missing_api_key_error_message_is_clean_no_secret_shaped_content():
    try:
        ai_extractor.extract_from_section(_SECTION, extract_types={"submittals"}, api_key=None)
        msg = None
    except ValueError as e:
        msg = str(e)

    assert msg == "ANTHROPIC_API_KEY not configured — set it in Settings → AI Configuration"
    assert "sk-" not in msg


# ---- 4. Existing stub-mode behavior is unchanged ------------------------------
def test_stub_mode_detection_and_response_shape_unchanged():
    # Stub-mode detection for ai_extractor has always lived at the
    # ai_gateway.create_message layer (client injection / monkeypatching the
    # module-level function), not inside ai_extractor.py itself — this
    # migration does not touch that signal. This mirrors
    # test_ai_gateway.py's test_ai_extractor_parser_and_cost_fidelity (a
    # pre-existing test, now updated to pass api_key= explicitly instead of
    # relying on os.environ, but otherwise identical in shape/assertions).
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
            raw=_FakeMessage(fenced, it, ot),
        )

    ai_gateway.create_message = fake_create
    try:
        res = ai_extractor.extract_from_section(
            _SECTION, extract_types={"submittals"}, api_key="test-key"
        )
    finally:
        ai_gateway.create_message = original

    # Same stub response shape as before the migration: fenced JSON parsed,
    # usage/cost fidelity preserved, request fields forwarded.
    assert res.extractions == {"submittals": ["A"], "warranties": []}
    expected_cost = round(
        it * ai_extractor.SONNET_INPUT_COST + ot * ai_extractor.SONNET_OUTPUT_COST, 6
    )
    assert res.input_tokens == it and res.output_tokens == ot
    assert res.cost_usd == expected_cost
    assert captured["max_tokens"] == 2000
    assert "system" in captured and captured["model"]
    assert captured["api_key"] == "test-key"  # now sourced from the parameter, not env


# ---- 5. build_client is the single, untouched construction seam --------------
def test_build_client_is_the_single_construction_seam_untouched_by_this_migration():
    # ai_gateway.build_client itself (the actual, un-monkeypatched function) is
    # untouched by this migration — ai_extractor.py only changed *where* it
    # obtains api_key (parameter vs. os.getenv), not how the client is built.
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
    print(f"\ntest_ai_extractor_credential: {'PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    sys.exit(1 if failures else 0)
