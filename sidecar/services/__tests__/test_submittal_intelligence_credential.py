"""
Offline, mock-only tests for the Option-A credential migration of
`submittal_intelligence.generate_submittal_intelligence`
(docs/architecture/adr/0001-ai-credential-resolution.md and
docs/architecture/adr/0002-remaining-sidecar-credential-targets.md, which
extends the Option-A decision to submittal_intelligence.py specifically).

Before this migration, generate_submittal_intelligence() read
os.getenv("ANTHROPIC_API_KEY") directly (though it already built its client
via the sanctioned ai_gateway.build_client() — only the source of api_key
changed, from env to an explicit parameter). It is invoked from
sidecar/routers/parse.py's POST /parse/submittals/generate, an async
background-job route matching the precedent set by
spec_intelligence.analyze_split_sections() / /parse/specs/analyze_split:
the credential is resolved once, TS-side (app/api/bids/[id]/submittals/
generate-ai/route.ts, via getSetting()), forwarded as `api_key` in the
initial sidecar request body, and threaded through the background
asyncio task (_run_submittals_generate) into this function as a plain
function argument — never written into the in-memory _jobs[job_id] record.
Unlike the analyze_split precedent, this job type has no callback_url /
callback payload at all (results are retrieved by polling
GET /parse/submittals/status/{job_id}), so there is no callback-leak surface
to guard here.

`test_submittal_intelligence.py` (the pre-existing fidelity suite) already
covers request/response/retry fidelity in depth and has been updated to pass
`api_key=` explicitly instead of relying on an env var. This file is scoped
narrowly to the credential-boundary properties themselves: sentinel
traversal, no-leak, fail-closed, and the untouched build_client() seam.

No real provider, no network.

Runnable two ways:
  * plain stdlib:  python3 sidecar/services/__tests__/test_submittal_intelligence_credential.py
  * pytest:        pytest sidecar/services/__tests__/test_submittal_intelligence_credential.py
"""
import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from services import ai_gateway  # noqa: E402
from services import submittal_intelligence as si  # noqa: E402

SENTINEL = "sk-test-sentinel-do-not-use-submittal"

SPEC = [{"csi": "03 30 00", "title": "Concrete"}]
DRAW = {"projectDescription": "Medical fit-out", "specialSystems": ["VRF", "BAS"]}
OBJ = ('```json\n{"drawing_submittals":[{"type":"SHOP_DRAWING","title":"BAS – Shop Drawings"}],'
       '"spec_coverage_gaps":["BAS Controls"],"project_summary":"Drawing-sourced BAS scope."}\n```')


# ---- Fake Anthropic client (installed via ai_gateway.build_client) ---------
class _FakeMessage:
    def __init__(self, text, i, o, model=si.SONNET_MODEL):
        self.content = [types.SimpleNamespace(type="text", text=text)]
        self.usage = types.SimpleNamespace(input_tokens=i, output_tokens=o)
        self.model = model
        self.stop_reason = "end_turn"


class _FakeAnthropicClient:
    def __init__(self, response_text=OBJ):
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


# ---- 1. Sentinel traverses to build_client, and only there ------------------
def test_sentinel_traverses_to_build_client_exactly():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    try:
        out = si.generate_submittal_intelligence(SPEC, DRAW, api_key=SENTINEL)
    finally:
        _restore_build_client(original)

    assert fake.captured_api_keys == [SENTINEL], (
        "the exact sentinel value must reach ai_gateway.build_client, unmodified, "
        "exactly once"
    )
    assert out["spec_coverage_gaps"] == ["BAS Controls"]


# ---- 2. No leakage ------------------------------------------------------------
def test_sentinel_never_leaks_into_result_or_provider_call_kwargs():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    try:
        out = si.generate_submittal_intelligence(SPEC, DRAW, api_key=SENTINEL)
    finally:
        _restore_build_client(original)

    serialized = json.dumps(out)
    assert SENTINEL not in serialized, "credential must never appear in the returned result"

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
        si.generate_submittal_intelligence(SPEC, DRAW, api_key=SENTINEL)
    except RuntimeError as e:
        raised = e
    finally:
        _restore_build_client(original)

    assert raised is not None
    assert SENTINEL not in str(raised), "sentinel must never appear in an exception message"


def test_sentinel_never_leaks_into_simulated_jobs_dict_or_callback_payload():
    """Mirrors what sidecar/routers/parse.py's _run_submittals_generate does:
    stash the return value into a plain dict standing in for _jobs[job_id],
    and build the would-be callback payload shape. Neither may ever contain
    the sentinel. (This job type has no real callback_url in the current
    contract — this test guards the shape defensively in case one is added
    later.)"""
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    try:
        result = si.generate_submittal_intelligence(SPEC, DRAW, api_key=SENTINEL)
    finally:
        _restore_build_client(original)

    simulated_jobs_dict = {
        "status": "complete",
        "progress": 100,
        "result": result,
        "error": None,
        "type": "submittals_generate",
    }
    simulated_callback_payload = {
        "job_id": "fake-job-id",
        "status": "complete",
        "result": result,
    }
    assert SENTINEL not in json.dumps(simulated_jobs_dict)
    assert SENTINEL not in json.dumps(simulated_callback_payload)


# ---- 3. Fail-closed when no credential is supplied ---------------------------
def test_fails_closed_with_typed_error_when_api_key_missing():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    raised = None
    try:
        si.generate_submittal_intelligence(SPEC, DRAW, api_key=None)
    except ValueError as e:
        raised = e
    finally:
        _restore_build_client(original)

    assert raised is not None, "missing api_key must raise a controlled ValueError, not proceed silently"
    assert "ANTHROPIC_API_KEY" in str(raised)
    assert fake.captured_api_keys == [], "build_client must never be reached when the key is missing"


def test_fails_closed_when_api_key_is_empty_string():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    raised = None
    try:
        si.generate_submittal_intelligence(SPEC, DRAW, api_key="")
    except ValueError as e:
        raised = e
    finally:
        _restore_build_client(original)

    assert raised is not None
    assert fake.captured_api_keys == []


def test_missing_api_key_error_message_is_clean_no_secret_shaped_content():
    fake = _FakeBuildClient()
    original = _patched_build_client(fake)
    try:
        try:
            si.generate_submittal_intelligence(SPEC, DRAW, api_key=None)
        except ValueError as e:
            msg = str(e)
    finally:
        _restore_build_client(original)

    assert msg == "ANTHROPIC_API_KEY not configured — set it in Settings → AI Configuration"
    assert "sk-" not in msg


# ---- 4. Real-vs-stub construction signal is unaffected -----------------------
def test_build_client_is_the_single_construction_seam_untouched_by_this_migration():
    # ai_gateway.build_client itself (the actual, un-monkeypatched function) is
    # untouched by this migration — submittal_intelligence.py only changed
    # *where* it obtains api_key (parameter vs. os.getenv), not how the
    # client is built.
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
    print(f"\ntest_submittal_intelligence_credential: {'PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    sys.exit(1 if failures else 0)
