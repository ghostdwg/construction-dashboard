"""
Offline, mock-only fidelity tests for the migrated submittal_intelligence.py
(P1B-3C).

No network and no `anthropic` package required. The function builds its own
client via ai_gateway.build_client, so tests monkeypatch build_client to inject a
fake client. A stub `anthropic` module is installed only where a genuine
APIStatusError must be recognized by ai_gateway.provider_api_status_code, and
time.sleep is captured so backoff is asserted without real sleeping.

Runnable two ways:
  * plain stdlib:  python3 sidecar/services/__tests__/test_submittal_intelligence.py
  * pytest:        pytest sidecar/services/__tests__/test_submittal_intelligence.py
"""
import os
import sys
import time
import types
import contextlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from services import ai_gateway  # noqa: E402
from services import submittal_intelligence as si  # noqa: E402


# ---- Fakes -----------------------------------------------------------------
class FakeTextBlock:
    def __init__(self, text):
        self.type = "text"
        self.text = text


class FakeUsage:
    def __init__(self, i, o):
        self.input_tokens = i
        self.output_tokens = o


class FakeMessage:
    def __init__(self, text, i, o, model=si.SONNET_MODEL, stop_reason="end_turn"):
        self.content = [FakeTextBlock(text)]
        self.usage = FakeUsage(i, o)
        self.model = model
        self.stop_reason = stop_reason


class FakeClient:
    def __init__(self, message=None, raises=None):
        self._message = message
        self._raises = list(raises) if raises else None
        self.calls = []
        self.messages = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._raises:
            exc = self._raises.pop(0)
            if exc is not None:
                raise exc
        return self._message


# ---- Context managers ------------------------------------------------------
@contextlib.contextmanager
def fake_anthropic():
    mod = types.ModuleType("anthropic")

    class APIError(Exception):
        pass

    class APIStatusError(APIError):
        def __init__(self, status_code, message="status"):
            super().__init__(message)
            self.status_code = status_code

    mod.APIError = APIError
    mod.APIStatusError = APIStatusError
    saved = sys.modules.get("anthropic")
    sys.modules["anthropic"] = mod
    try:
        yield mod
    finally:
        if saved is not None:
            sys.modules["anthropic"] = saved
        else:
            sys.modules.pop("anthropic", None)


@contextlib.contextmanager
def capture_sleeps():
    rec = []
    saved = time.sleep
    time.sleep = lambda s: rec.append(s)
    try:
        yield rec
    finally:
        time.sleep = saved


@contextlib.contextmanager
def patched_build_client(client):
    saved = ai_gateway.build_client
    ai_gateway.build_client = lambda api_key=None: client
    try:
        yield
    finally:
        ai_gateway.build_client = saved


SPEC = [{"csi": "03 30 00", "title": "Concrete"}, {"csi": "09 21 16", "title": "Gypsum"}]
DRAW = {"projectDescription": "Medical fit-out", "specialSystems": ["VRF", "BAS"]}
OBJ = ('```json\n{"drawing_submittals":[{"type":"SHOP_DRAWING","title":"BAS – Shop Drawings"}],'
       '"spec_coverage_gaps":["BAS Controls"],"project_summary":"Drawing-sourced BAS scope."}\n```')


@contextlib.contextmanager
def _with_key():
    saved = os.environ.get("ANTHROPIC_API_KEY")
    os.environ["ANTHROPIC_API_KEY"] = "k"
    try:
        yield
    finally:
        if saved is None:
            os.environ.pop("ANTHROPIC_API_KEY", None)
        else:
            os.environ["ANTHROPIC_API_KEY"] = saved


# ===========================================================================
#  A. Request and output fidelity
# ===========================================================================
def test_happy_path_forwarding_and_cost():
    fc = FakeClient(message=FakeMessage(OBJ, 100, 50))
    with patched_build_client(fc), capture_sleeps(), _with_key():
        out = si.generate_submittal_intelligence(SPEC, DRAW, model="opus")  # model ignored

    call = fc.calls[0]
    assert call["model"] == si.SONNET_MODEL          # hardcoded Sonnet even when model="opus"
    assert call["max_tokens"] == 4_000
    assert call["system"] == si.SYSTEM_PROMPT
    assert "client" not in call and "temperature" not in call
    content = call["messages"][0]["content"]
    assert "SPEC SECTIONS ALREADY COVERED (2):" in content
    assert "03 30 00 — Concrete" in content
    assert "DRAWING SET ANALYSIS:" in content
    assert "Medical fit-out" in content and "VRF, BAS" in content

    assert out["drawing_submittals"] == [{"type": "SHOP_DRAWING", "title": "BAS – Shop Drawings"}]
    assert out["spec_coverage_gaps"] == ["BAS Controls"]
    assert out["project_summary"] == "Drawing-sourced BAS scope."
    assert out["input_tokens"] == 100 and out["output_tokens"] == 50
    # Mirror the source's exact expression (rate constants, same operation order)
    # so the borderline round(0.00105, 4) matches bit-for-bit.
    rin = si.COST_RATES[si.SONNET_MODEL]["input"]
    rout = si.COST_RATES[si.SONNET_MODEL]["output"]
    assert out["cost_usd"] == round(100 * rin + 50 * rout, 4)


def test_bare_and_fenced_json_both_parse():
    bare = '{"drawing_submittals":[{"title":"X"}],"spec_coverage_gaps":[],"project_summary":"p"}'
    for body in (OBJ, bare):
        fc = FakeClient(message=FakeMessage(body, 1, 1))
        with patched_build_client(fc), capture_sleeps(), _with_key():
            out = si.generate_submittal_intelligence(SPEC, DRAW)
        assert isinstance(out["drawing_submittals"], list) and out["drawing_submittals"]


def test_missing_keys_use_defaults():
    fc = FakeClient(message=FakeMessage('{"project_summary":"only summary"}', 2, 3))
    with patched_build_client(fc), capture_sleeps(), _with_key():
        out = si.generate_submittal_intelligence(SPEC, DRAW)
    assert out["drawing_submittals"] == []          # .get default
    assert out["spec_coverage_gaps"] == []          # .get default
    assert out["project_summary"] == "only summary"


def test_malformed_json_all_empty_but_usage_populated():
    fc = FakeClient(message=FakeMessage("not json at all", 11, 7))
    with patched_build_client(fc), capture_sleeps(), _with_key():
        out = si.generate_submittal_intelligence(SPEC, DRAW)
    assert out["drawing_submittals"] == [] and out["spec_coverage_gaps"] == []
    assert out["project_summary"] == ""
    assert out["input_tokens"] == 11 and out["output_tokens"] == 7
    rin = si.COST_RATES[si.SONNET_MODEL]["input"]
    rout = si.COST_RATES[si.SONNET_MODEL]["output"]
    assert out["cost_usd"] == round(11 * rin + 7 * rout, 4)


# ===========================================================================
#  B. Retry and error fidelity
# ===========================================================================
def _run(fc):
    with patched_build_client(fc), _with_key():
        return si.generate_submittal_intelligence(SPEC, DRAW)


def test_429_then_success():
    with fake_anthropic() as fake, capture_sleeps() as sleeps:
        fc = FakeClient(message=FakeMessage(OBJ, 1, 1), raises=[fake.APIStatusError(429), None])
        out = _run(fc)
    assert sleeps == [5]
    assert out["spec_coverage_gaps"] == ["BAS Controls"]
    assert len(fc.calls) == 2


def test_529_then_success():
    with fake_anthropic() as fake, capture_sleeps() as sleeps:
        fc = FakeClient(message=FakeMessage(OBJ, 1, 1), raises=[fake.APIStatusError(529), None])
        out = _run(fc)
    assert sleeps == [5]
    assert out["project_summary"] == "Drawing-sourced BAS scope."


def test_three_429_reraises_original():
    with fake_anthropic() as fake, capture_sleeps() as sleeps:
        errs = [fake.APIStatusError(429) for _ in range(3)]
        fc = FakeClient(raises=list(errs))
        raised = None
        try:
            _run(fc)
        except Exception as e:  # noqa: BLE001
            raised = e
    assert sleeps == [5, 10]
    assert raised is errs[2] and getattr(raised, "status_code", None) == 429
    assert not isinstance(raised, RuntimeError)


def test_three_529_reraises_original():
    with fake_anthropic() as fake, capture_sleeps() as sleeps:
        errs = [fake.APIStatusError(529) for _ in range(3)]
        fc = FakeClient(raises=list(errs))
        raised = None
        try:
            _run(fc)
        except Exception as e:  # noqa: BLE001
            raised = e
    assert sleeps == [5, 10]
    assert raised is errs[2] and getattr(raised, "status_code", None) == 529
    assert not isinstance(raised, RuntimeError)


def test_immediate_400():
    with fake_anthropic() as fake, capture_sleeps() as sleeps:
        err = fake.APIStatusError(400)
        fc = FakeClient(raises=[err])
        raised = None
        try:
            _run(fc)
        except Exception as e:  # noqa: BLE001
            raised = e
    assert sleeps == [] and raised is err


def test_immediate_generic():
    with fake_anthropic(), capture_sleeps() as sleeps:
        err = ValueError("boom")
        fc = FakeClient(raises=[err])
        raised = None
        try:
            _run(fc)
        except Exception as e:  # noqa: BLE001
            raised = e
    assert sleeps == [] and raised is err


# ===========================================================================
#  C. Existing guards
# ===========================================================================
def test_missing_api_key_raises_before_build():
    saved = os.environ.pop("ANTHROPIC_API_KEY", None)
    # build_client must NOT be reached; make it explode if it is.
    def boom(api_key=None):
        raise AssertionError("build_client must not be called without a key")
    orig = ai_gateway.build_client
    ai_gateway.build_client = boom
    raised = None
    try:
        si.generate_submittal_intelligence(SPEC, DRAW)
    except ValueError as e:
        raised = e
    finally:
        ai_gateway.build_client = orig
        if saved is not None:
            os.environ["ANTHROPIC_API_KEY"] = saved
    assert raised is not None
    assert str(raised) == "ANTHROPIC_API_KEY not configured"


def test_none_provider_return_runtimeerror():
    fc = FakeClient(message=None)  # create returns None → gateway relays raw=None
    raised = None
    try:
        _run(fc)
    except RuntimeError as e:
        raised = e
    assert raised is not None
    assert str(raised) == "Failed to get drawing intelligence after 3 retries"


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
    print(f"\ntest_submittal_intelligence: {'PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    sys.exit(1 if failures else 0)
