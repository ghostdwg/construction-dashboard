"""
Offline, mock-only tests for the N3 Option-A credential migration of
`drawing_intelligence.analyze_drawings`
(docs/architecture/adr/0001-ai-credential-resolution.md).

Before this migration, `analyze_drawings` read `os.environ.get("ANTHROPIC_API_KEY", "")`
directly and built its own `anthropic.Anthropic(...)` client — one of the three
named legacy bypasses. It now accepts `api_key` as an explicit parameter (fed
by the Next.js drawing-analyze route via getSetting()) and routes client
construction through `ai_gateway.build_client()`, with no env fallback.

Neither `fitz` (PyMuPDF) nor `anthropic` needs to be installed to run this:
both are stubbed via `sys.modules` the same way `test_ai_gateway.py` stubs
`anthropic`. No real PDF, no real provider, no network.

Runnable two ways:
  * plain stdlib:  python3 sidecar/services/__tests__/test_drawing_intelligence.py
  * pytest:        pytest sidecar/services/__tests__/test_drawing_intelligence.py
"""
import json
import sys
import types
from pathlib import Path

# Put the sidecar root on sys.path so `services.*` imports resolve.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

SENTINEL = "sk-test-sentinel-do-not-use-12345"


# ---- Fake `fitz` (PyMuPDF) --------------------------------------------------
class _FakePixmap:
    def tobytes(self, fmt):
        return b"FAKE-PNG-BYTES"


class _FakePage:
    def get_text(self):
        return ""  # no discipline sheet-prefix text needed for these tests

    def get_pixmap(self, matrix=None):
        return _FakePixmap()


class _FakeDoc:
    def __init__(self, n_pages=3):
        self._pages = [_FakePage() for _ in range(n_pages)]

    def __len__(self):
        return len(self._pages)

    def __getitem__(self, idx):
        return self._pages[idx]

    def __iter__(self):
        return iter(self._pages)

    def close(self):
        pass


def _install_fake_fitz():
    fake = types.ModuleType("fitz")
    fake.open = lambda path: _FakeDoc()
    fake.Matrix = lambda *a, **kw: None
    sys.modules["fitz"] = fake


_install_fake_fitz()

from services import ai_gateway  # noqa: E402
from services import drawing_intelligence  # noqa: E402


# ---- Fake Anthropic client (installed via ai_gateway.build_client) ---------
class _FakeMessage:
    def __init__(self, text, i, o):
        self.content = [types.SimpleNamespace(type="text", text=text)]
        self.usage = types.SimpleNamespace(input_tokens=i, output_tokens=o)


class _FakeAnthropicClient:
    def __init__(self, response_text='{"projectDescription": "ok"}'):
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
        self.last_client = None

    def __call__(self, api_key=None):
        self.captured_api_keys.append(api_key)
        self.last_client = _FakeAnthropicClient()
        return self.last_client


def _patched_build_client(fake):
    original = ai_gateway.build_client
    ai_gateway.build_client = fake
    return original


def _restore_build_client(original):
    ai_gateway.build_client = original


# ---- 1. Sentinel traversal ---------------------------------------------------
def test_sentinel_traverses_to_build_client_exactly():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    try:
        result = drawing_intelligence.analyze_drawings(
            pdf_path="fake.pdf", tier=1, model="haiku", api_key=SENTINEL,
        )
    finally:
        _restore_build_client(original)

    assert fake.captured_api_keys == [SENTINEL], (
        "the exact sentinel value must reach ai_gateway.build_client, unmodified"
    )
    assert result["projectDescription"] == "ok"
    assert result["_meta"]["tier"] == 1


# ---- 2. No leakage -----------------------------------------------------------
def test_sentinel_never_leaks_into_response_or_provider_call_kwargs():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    try:
        result = drawing_intelligence.analyze_drawings(
            pdf_path="fake.pdf", tier=1, model="haiku", api_key=SENTINEL,
        )
    finally:
        _restore_build_client(original)

    serialized_result = json.dumps(result)
    assert SENTINEL not in serialized_result, "credential must never appear in the returned analysis"

    # The kwargs passed to client.messages.create (model/max_tokens/system/
    # messages) must never carry the credential — it only ever reaches
    # build_client, never the request body.
    calls = fake.last_client.calls
    assert len(calls) == 1
    assert SENTINEL not in json.dumps(calls[0], default=str)


def test_sentinel_never_leaks_into_a_thrown_error_message():
    # Even on a downstream failure (e.g. a malformed provider response), the
    # error message must never echo the credential back.
    class _BadClient:
        def __init__(self):
            self.messages = types.SimpleNamespace(create=self._create)

        def _create(self, **kwargs):
            raise RuntimeError(f"simulated provider failure for key-adjacent kwargs={kwargs}")

    def fake_build_client(api_key=None):
        return _BadClient()

    original = _patched_build_client(fake_build_client)
    raised = None
    try:
        drawing_intelligence.analyze_drawings(
            pdf_path="fake.pdf", tier=1, model="haiku", api_key=SENTINEL,
        )
    except RuntimeError as e:
        raised = e
    finally:
        _restore_build_client(original)

    assert raised is not None
    assert SENTINEL not in str(raised), "sentinel must never appear in an exception message"


# ---- 3. Fail-closed when no credential is supplied --------------------------
def test_fails_closed_with_typed_error_when_api_key_missing():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    raised = None
    try:
        drawing_intelligence.analyze_drawings(
            pdf_path="fake.pdf", tier=1, model="haiku", api_key=None,
        )
    except ValueError as e:
        raised = e
    finally:
        _restore_build_client(original)

    assert raised is not None, "missing api_key must raise a controlled ValueError, not proceed silently"
    assert "ANTHROPIC_API_KEY" in str(raised)
    assert fake.captured_api_keys == [], "build_client must never be reached when the key is missing"


# ---- 4. Real-vs-stub construction signal is unaffected ----------------------
def test_build_client_is_the_single_construction_seam_untouched_by_this_migration():
    # ai_gateway.build_client itself (the actual, un-monkeypatched function)
    # is untouched by this change — this migration only threads a parameter
    # through to it. Prove it still requires the lazily-imported `anthropic`
    # package and passes the api_key through unchanged (mirrors
    # test_ai_gateway.py's own build_client coverage).
    fake_anthropic = types.ModuleType("anthropic")
    captured = {}

    class _Anthropic:
        def __init__(self, api_key=None, **kwargs):
            captured["api_key"] = api_key

    fake_anthropic.Anthropic = _Anthropic
    saved = sys.modules.get("anthropic")
    sys.modules["anthropic"] = fake_anthropic
    try:
        client = ai_gateway.build_client(SENTINEL)
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
    print(f"\ntest_drawing_intelligence: {'PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    sys.exit(1 if failures else 0)
