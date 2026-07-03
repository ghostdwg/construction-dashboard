"""
Offline, mock-only fidelity tests for the migrated spec_intelligence.py (P1B-3B).

No network and no `anthropic`/`pymupdf` packages required:
  * `pymupdf` is stubbed in sys.modules (runtime-only PDF dep, absent offline).
  * A fake client is injected into the Pass 1 / Pass 2 helpers (no build_client).
  * A stub `anthropic` module is installed only where a genuine APIStatusError
    must be recognized by ai_gateway.provider_api_status_code.
  * time.sleep is captured so retry backoff / throttle are asserted without
    real sleeping.

Runnable two ways:
  * plain stdlib:  python3 sidecar/services/__tests__/test_spec_intelligence.py
  * pytest:        pytest sidecar/services/__tests__/test_spec_intelligence.py
"""
import os
import sys
import time
import types
import contextlib
from pathlib import Path

# sidecar root on sys.path so `services.*` imports resolve.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# Stub pymupdf so spec_intelligence imports offline (runtime-only dependency).
sys.modules.setdefault("pymupdf", types.ModuleType("pymupdf"))

from services import ai_gateway  # noqa: E402
from services import spec_intelligence as si  # noqa: E402


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
    def __init__(self, text, i, o, model="claude-haiku-4-5-20251001", stop_reason="end_turn"):
        self.content = [FakeTextBlock(text)]
        self.usage = FakeUsage(i, o)
        self.model = model
        self.stop_reason = stop_reason


class FakeClient:
    """Injectable client. `raises` is a per-call list; a None entry (or an empty
    list) means "return `message`", otherwise the entry is raised."""
    def __init__(self, message=None, raises=None):
        self._message = message
        self._raises = list(raises) if raises else None
        self.calls = []
        self.messages = self  # so client.messages.create reaches .create

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._raises:
            exc = self._raises.pop(0)
            if exc is not None:
                raise exc
        return self._message


class ExplodingClient:
    def __init__(self):
        self.messages = self

    def create(self, **kwargs):
        raise AssertionError("provider must NOT be called on this path")


# ---- Context managers ------------------------------------------------------
@contextlib.contextmanager
def fake_anthropic():
    """Install a stub anthropic module so a genuine APIStatusError is recognized."""
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
    """Capture time.sleep durations; spec uses `import time as _time` → time.sleep."""
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


@contextlib.contextmanager
def patched_pymupdf_open(text):
    stub = sys.modules["pymupdf"]

    class _Page:
        def get_text(self, kind):
            return text

    class _Doc:
        def __iter__(self):
            return iter([_Page()])

        def close(self):
            pass

    saved = getattr(stub, "open", None)
    stub.open = lambda path: _Doc()
    try:
        yield
    finally:
        if saved is None:
            if hasattr(stub, "open"):
                delattr(stub, "open")
        else:
            stub.open = saved


ARR = '```json\n[{"csi":"03 30 00","title":"Concrete"}]\n```'
OBJ = '```json\n{"severity":"HIGH","description":"d"}\n```'


# ===========================================================================
#  A. Direct forwarding and output fidelity
# ===========================================================================
def test_pass1_happy_path_forwarding_and_cost():
    fc = FakeClient(message=FakeMessage(ARR, 100, 50, model=si.HAIKU_MODEL))
    sections, usage = si._identify_sections("[PAGE 1]\nTOC 03 30 00", 1, fc)

    call = fc.calls[0]
    # create_message forwards model/max_tokens/system/messages verbatim; no client key.
    assert call["model"] == si.HAIKU_MODEL
    assert call["max_tokens"] == 8000
    assert call["system"] == si.IDENTIFY_SYSTEM
    assert call["messages"][0]["role"] == "user"
    assert isinstance(call["messages"][0]["content"], str)
    assert "client" not in call and "temperature" not in call

    assert sections == [{"csi": "03 30 00", "title": "Concrete"}]
    assert usage["model"] == si.HAIKU_MODEL
    assert usage["input_tokens"] == 100 and usage["output_tokens"] == 50
    assert usage["cost"] == si._cost(si.HAIKU_MODEL, 100, 50)


def test_pass2_happy_path_sonnet_haiku_and_override():
    # Sonnet division (23) → auto-routed to Sonnet.
    fc = FakeClient(message=FakeMessage(OBJ, 200, 80, model=si.SONNET_MODEL))
    analysis, usage = si._analyze_section("23 05 00", "HVAC", "some spec text", fc)
    call = fc.calls[0]
    assert call["model"] == si.SONNET_MODEL
    assert call["max_tokens"] == 2500
    assert call["system"] == si.ANALYZE_SYSTEM
    assert call["messages"][0]["content"].startswith("SECTION 23 05 00 — HVAC")
    assert analysis["severity"] == "HIGH"
    assert analysis["_model"] == "Sonnet"
    assert usage["input_tokens"] == 200 and usage["output_tokens"] == 80
    assert usage["cost"] == si._cost(si.SONNET_MODEL, 200, 80)

    # Haiku division (09) → auto-routed to Haiku.
    fc2 = FakeClient(message=FakeMessage(OBJ, 10, 5, model=si.HAIKU_MODEL))
    a2, u2 = si._analyze_section("09 21 16", "Gypsum", "text", fc2)
    assert fc2.calls[0]["model"] == si.HAIKU_MODEL
    assert a2["_model"] == "Haiku"
    assert u2["cost"] == si._cost(si.HAIKU_MODEL, 10, 5)

    # model_override forces Sonnet even for a Haiku division.
    fc3 = FakeClient(message=FakeMessage(OBJ, 1, 1, model=si.SONNET_MODEL))
    a3, u3 = si._analyze_section("09 21 16", "Gypsum", "text", fc3, model_override=si.SONNET_MODEL)
    assert fc3.calls[0]["model"] == si.SONNET_MODEL
    assert a3["_model"] == "Sonnet"


def test_split_sections_usage_and_cost_structure():
    fc = FakeClient(message=FakeMessage(OBJ, 100, 50, model=si.HAIKU_MODEL))
    with patched_pymupdf_open("SECTION body text"), patched_build_client(fc), capture_sleeps():
        os.environ["ANTHROPIC_API_KEY"] = "k"
        out = si.analyze_split_sections([
            {"csi": "23 05 00", "title": "HVAC", "pdf_path": __file__},    # Sonnet div
            {"csi": "09 21 16", "title": "Gypsum", "pdf_path": __file__},  # Haiku div
        ])
    assert out["pass1_usage"] is None
    p2 = out["pass2_usage"]
    assert p2["sections_analyzed"] == 2
    assert p2["sonnet_sections"] == 1 and p2["haiku_sections"] == 1
    assert p2["total_input"] == 200 and p2["total_output"] == 100
    expect = round(si._cost(si.SONNET_MODEL, 100, 50) + si._cost(si.HAIKU_MODEL, 100, 50), 4)
    assert p2["total_cost"] == expect
    assert out["total_cost"] == expect
    assert out["section_count"] == 2


# ===========================================================================
#  B. Retry and exception fidelity (both loops)
# ===========================================================================
def test_pass1_429_then_success():
    with fake_anthropic() as fake, capture_sleeps() as sleeps:
        fc = FakeClient(message=FakeMessage(ARR, 1, 1, model=si.HAIKU_MODEL),
                        raises=[fake.APIStatusError(429), None])
        sections, usage = si._identify_sections("[PAGE 1]", 1, fc)
    assert sleeps == [5]
    assert sections == [{"csi": "03 30 00", "title": "Concrete"}]
    assert len(fc.calls) == 2


def test_pass1_529_then_success():
    with fake_anthropic() as fake, capture_sleeps() as sleeps:
        fc = FakeClient(message=FakeMessage(ARR, 1, 1, model=si.HAIKU_MODEL),
                        raises=[fake.APIStatusError(529), None])
        sections, _ = si._identify_sections("[PAGE 1]", 1, fc)
    assert sleeps == [5]
    assert sections == [{"csi": "03 30 00", "title": "Concrete"}]


def test_pass1_five_429_reraises_original():
    with fake_anthropic() as fake, capture_sleeps() as sleeps:
        errs = [fake.APIStatusError(429) for _ in range(5)]
        fc = FakeClient(raises=list(errs))
        raised = None
        try:
            si._identify_sections("[PAGE 1]", 1, fc)
        except Exception as e:  # noqa: BLE001
            raised = e
    assert sleeps == [5, 10, 15, 20]
    assert raised is errs[4]
    assert getattr(raised, "status_code", None) == 429
    assert not isinstance(raised, RuntimeError)


def test_pass1_five_529_reraises_original():
    with fake_anthropic() as fake, capture_sleeps() as sleeps:
        errs = [fake.APIStatusError(529) for _ in range(5)]
        fc = FakeClient(raises=list(errs))
        raised = None
        try:
            si._identify_sections("[PAGE 1]", 1, fc)
        except Exception as e:  # noqa: BLE001
            raised = e
    assert sleeps == [5, 10, 15, 20]
    assert raised is errs[4]
    assert getattr(raised, "status_code", None) == 529
    assert not isinstance(raised, RuntimeError)


def test_pass1_immediate_400():
    with fake_anthropic() as fake, capture_sleeps() as sleeps:
        err = fake.APIStatusError(400)
        fc = FakeClient(raises=[err])
        raised = None
        try:
            si._identify_sections("[PAGE 1]", 1, fc)
        except Exception as e:  # noqa: BLE001
            raised = e
    assert sleeps == []
    assert raised is err and getattr(raised, "status_code", None) == 400


def test_pass1_immediate_generic():
    with fake_anthropic(), capture_sleeps() as sleeps:
        err = ValueError("boom")
        fc = FakeClient(raises=[err])
        raised = None
        try:
            si._identify_sections("[PAGE 1]", 1, fc)
        except Exception as e:  # noqa: BLE001
            raised = e
    assert sleeps == []
    assert raised is err


def test_pass2_429_then_success():
    with fake_anthropic() as fake, capture_sleeps() as sleeps:
        fc = FakeClient(message=FakeMessage('```json\n{"severity":"LOW"}\n```', 3, 2, model=si.SONNET_MODEL),
                        raises=[fake.APIStatusError(429), None])
        analysis, _ = si._analyze_section("23 05 00", "HVAC", "spec text", fc)
    assert sleeps == [5]
    assert analysis["severity"] == "LOW" and analysis["_model"] == "Sonnet"
    assert len(fc.calls) == 2


def test_pass2_five_529_reraises_original():
    with fake_anthropic() as fake, capture_sleeps() as sleeps:
        errs = [fake.APIStatusError(529) for _ in range(5)]
        fc = FakeClient(raises=list(errs))
        raised = None
        try:
            si._analyze_section("23 05 00", "HVAC", "spec text", fc)
        except Exception as e:  # noqa: BLE001
            raised = e
    assert sleeps == [5, 10, 15, 20]
    assert raised is errs[4] and getattr(raised, "status_code", None) == 529
    assert not isinstance(raised, RuntimeError)


def test_pass2_immediate_400_and_generic():
    with fake_anthropic() as fake, capture_sleeps() as sleeps:
        err = fake.APIStatusError(400)
        fc = FakeClient(raises=[err])
        raised = None
        try:
            si._analyze_section("23 05 00", "HVAC", "spec text", fc)
        except Exception as e:  # noqa: BLE001
            raised = e
    assert sleeps == [] and raised is err
    with fake_anthropic(), capture_sleeps() as sleeps2:
        gen = KeyError("x")
        fc2 = FakeClient(raises=[gen])
        raised2 = None
        try:
            si._analyze_section("23 05 00", "HVAC", "spec text", fc2)
        except Exception as e:  # noqa: BLE001
            raised2 = e
    assert sleeps2 == [] and raised2 is gen


# ===========================================================================
#  C. Fallback / null / throttle behavior
# ===========================================================================
def test_pass1_unparseable_yields_empty_and_early_return():
    fc = FakeClient(message=FakeMessage("not json at all", 5, 3, model=si.HAIKU_MODEL))
    # Helper-level: unparseable → empty section list, usage still computed.
    sections, usage = si._identify_sections("[PAGE 1]", 1, fc)
    assert sections == []
    assert usage["cost"] == si._cost(si.HAIKU_MODEL, 5, 3)

    # Pipeline-level: empty identification → early return with pass2_usage None.
    fc2 = FakeClient(message=FakeMessage("still not json", 5, 3, model=si.HAIKU_MODEL))
    with patched_pymupdf_open("some text"), patched_build_client(fc2), capture_sleeps():
        os.environ["ANTHROPIC_API_KEY"] = "k"
        out = si.run_spec_intelligence("/fake.pdf", analyze=True)
    assert out["section_count"] == 0 and out["sections"] == []
    assert out["pass2_usage"] is None
    assert out["pass1_usage"]["model"] == si.HAIKU_MODEL
    assert out["total_cost"] == out["pass1_usage"]["cost"]


def test_pass2_unparseable_fallback():
    fc = FakeClient(message=FakeMessage("not json", 7, 2, model=si.SONNET_MODEL))
    analysis, usage = si._analyze_section("23 05 00", "HVAC", "spec text", fc)
    assert analysis["_parse_error"] is True
    assert analysis["_raw"]
    assert analysis["severity"] == "HIGH"
    assert analysis["_model"] == "Sonnet"
    assert usage["input_tokens"] == 7 and usage["output_tokens"] == 2


def test_pass2_empty_section_synthetic_no_provider():
    analysis, usage = si._analyze_section("03 30 00", "Concrete", "   ", ExplodingClient())
    assert usage["input_tokens"] == 0 and usage["output_tokens"] == 0 and usage["cost"] == 0
    assert analysis["severity"] == "HIGH"
    assert any("MISSING" in f for f in analysis["flags"])


def test_pass1_none_provider_runtimeerror():
    fc = FakeClient(message=None)  # create returns None → gateway relays raw=None
    raised = None
    try:
        si._identify_sections("[PAGE 1]", 1, fc)
    except RuntimeError as e:
        raised = e
    assert raised is not None
    assert str(raised) == "Failed to identify sections after 5 retries"


def test_pass2_none_provider_runtimeerror():
    fc = FakeClient(message=None)
    raised = None
    try:
        si._analyze_section("23 05 00", "HVAC", "spec text", fc)
    except RuntimeError as e:
        raised = e
    assert raised is not None
    assert str(raised) == "Failed to analyze section 23 05 00 after 5 retries"


def test_inter_section_throttle():
    with patched_build_client(ExplodingClient()), capture_sleeps() as sleeps:
        os.environ["ANTHROPIC_API_KEY"] = "k"
        out = si.analyze_split_sections([
            {"csi": "03 30 00", "title": "A"},   # no pdf_path → empty text → no provider
            {"csi": "09 21 16", "title": "B"},
            {"csi": "23 05 00", "title": "C"},
        ])
    # Throttle sleeps 2s before every section after the first (i=1, i=2).
    assert sleeps == [2, 2]
    assert out["section_count"] == 3


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
    print(f"\ntest_spec_intelligence: {'PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    sys.exit(1 if failures else 0)
