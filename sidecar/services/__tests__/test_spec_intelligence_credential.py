"""
Offline, mock-only tests for the N3 Option-A credential migration of
`spec_intelligence.run_spec_intelligence` and `spec_intelligence.analyze_split_sections`
(docs/architecture/adr/0001-ai-credential-resolution.md).

Before this migration, both entry points read `os.getenv("ANTHROPIC_API_KEY")`
directly — spec_intelligence.py was one of the "5 additional sites" ADR 0001
named as assessed-but-not-migrated in the prior N3 session (too complex for
that bounded package: two entry points, an async background-job caller, and
a currently-unreachable second router endpoint). Both now accept `api_key` as
an explicit parameter (fed by the Next.js specbook/analyze route via
lib/services/jobs/specAnalysisAutomation.ts's getSetting() call), fail closed
with a ValueError when it is missing, and build their Anthropic client through
the already-sanctioned `ai_gateway.build_client()` — unchanged by this
migration; only the source of `api_key` changed (parameter vs. env read).

`test_spec_intelligence.py` (the pre-existing fidelity suite) already covers
Pass 1 / Pass 2 request/response/retry fidelity in depth and has been updated
to pass `api_key=` explicitly instead of relying on an env var. This file is
scoped narrowly to the credential-boundary properties themselves: sentinel
traversal, no-leak, fail-closed, and the untouched build_client() seam.

Neither `pymupdf` nor `anthropic` needs to be installed to run this: pymupdf
is stubbed via sys.modules the same way test_spec_intelligence.py stubs it.
No real PDF, no real provider, no network.

Runnable two ways:
  * plain stdlib:  python3 sidecar/services/__tests__/test_spec_intelligence_credential.py
  * pytest:        pytest sidecar/services/__tests__/test_spec_intelligence_credential.py
"""
import json
import sys
import types
from pathlib import Path

# Put the sidecar root on sys.path so `services.*` imports resolve.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# Stub pymupdf so spec_intelligence imports offline (runtime-only dependency).
sys.modules.setdefault("pymupdf", types.ModuleType("pymupdf"))

from services import ai_gateway  # noqa: E402
from services import spec_intelligence as si  # noqa: E402

SENTINEL = "sk-test-sentinel-do-not-use-67890"


# ---- Fake Anthropic client (installed via ai_gateway.build_client) ---------
class _FakeMessage:
    def __init__(self, text, i, o, model=si.HAIKU_MODEL):
        self.content = [types.SimpleNamespace(type="text", text=text)]
        self.usage = types.SimpleNamespace(input_tokens=i, output_tokens=o)
        self.model = model
        self.stop_reason = "end_turn"


class _FakeAnthropicClient:
    def __init__(self, response_text='```json\n[]\n```'):
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


def _install_fake_pymupdf(text="[PAGE 1]\nSECTION 03 30 00\nCONCRETE\nEND OF SECTION"):
    stub = sys.modules["pymupdf"]

    class _Page:
        def get_text(self, kind):
            return text

    class _Doc:
        def __iter__(self):
            return iter([_Page()])

        def close(self):
            pass

    stub.open = lambda path: _Doc()


_install_fake_pymupdf()


# ---- 1. Sentinel traverses to build_client, and only there ------------------
def test_sentinel_traverses_to_build_client_exactly_analyze_split_sections():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    try:
        out = si.analyze_split_sections(
            [{"csi": "03 30 00", "title": "Concrete", "pdf_path": ""}],
            api_key=SENTINEL,
        )
    finally:
        _restore_build_client(original)

    assert fake.captured_api_keys == [SENTINEL], (
        "the exact sentinel value must reach ai_gateway.build_client, unmodified, "
        "exactly once (one client built per analyze_split_sections call)"
    )
    assert out["section_count"] == 1


def test_sentinel_traverses_to_build_client_exactly_run_spec_intelligence():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    try:
        out = si.run_spec_intelligence("/fake.pdf", analyze=True, api_key=SENTINEL)
    finally:
        _restore_build_client(original)

    assert fake.captured_api_keys == [SENTINEL]
    # Pass 1 found nothing (fake pymupdf text has no parseable JSON array from
    # this client's canned "[]" response) — early-return path, still proves
    # the credential reached build_client before any provider call was made.
    assert out["section_count"] == 0


# ---- 2. No leakage ------------------------------------------------------------
def test_sentinel_never_leaks_into_result_or_provider_call_kwargs():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    try:
        out = si.analyze_split_sections(
            [{"csi": "03 30 00", "title": "Concrete", "pdf_path": ""}],
            api_key=SENTINEL,
        )
    finally:
        _restore_build_client(original)

    serialized = json.dumps(out)
    assert SENTINEL not in serialized, "credential must never appear in the returned analysis result"

    # The kwargs passed to client.messages.create (model/max_tokens/system/
    # messages) must never carry the credential — it only ever reaches
    # build_client, never ai_gateway.create_message's request body.
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
        si.analyze_split_sections(
            [{"csi": "03 30 00", "title": "Concrete", "pdf_path": __file__}],
            api_key=SENTINEL,
        )
    except RuntimeError as e:
        raised = e
    finally:
        _restore_build_client(original)

    assert raised is not None
    assert SENTINEL not in str(raised), "sentinel must never appear in an exception message"


# ---- 3. Fail-closed when no credential is supplied ---------------------------
def test_analyze_split_sections_fails_closed_with_typed_error_when_api_key_missing():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    raised = None
    try:
        si.analyze_split_sections(
            [{"csi": "03 30 00", "title": "Concrete", "pdf_path": ""}],
            api_key=None,
        )
    except ValueError as e:
        raised = e
    finally:
        _restore_build_client(original)

    assert raised is not None, "missing api_key must raise a controlled ValueError, not proceed silently"
    assert "ANTHROPIC_API_KEY" in str(raised)
    assert fake.captured_api_keys == [], "build_client must never be reached when the key is missing"


def test_run_spec_intelligence_fails_closed_with_typed_error_when_api_key_missing():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    raised = None
    try:
        si.run_spec_intelligence("/fake.pdf", analyze=True, api_key=None)
    except ValueError as e:
        raised = e
    finally:
        _restore_build_client(original)

    assert raised is not None
    assert "ANTHROPIC_API_KEY" in str(raised)
    assert fake.captured_api_keys == []


def test_missing_api_key_error_message_is_clean_no_secret_shaped_content():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    try:
        try:
            si.analyze_split_sections([{"csi": "03 30 00", "title": "X", "pdf_path": ""}], api_key=None)
        except ValueError as e:
            msg = str(e)
    finally:
        _restore_build_client(original)

    # A clean, human-readable configuration error — not an exception dump,
    # traceback fragment, or anything resembling a partial/garbled key.
    assert msg == "ANTHROPIC_API_KEY not configured — set it in Settings → AI Configuration"
    assert "sk-" not in msg


# ---- 4. Real-vs-stub construction signal is unaffected -----------------------
def test_build_client_is_the_single_construction_seam_untouched_by_this_migration():
    # ai_gateway.build_client itself (the actual, un-monkeypatched function) is
    # untouched by this migration — spec_intelligence.py only changed *where*
    # it obtains api_key (parameter vs. os.getenv), not how the client is
    # built. Mirrors test_drawing_intelligence.py's equivalent coverage.
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
    print(f"\ntest_spec_intelligence_credential: {'PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    sys.exit(1 if failures else 0)
