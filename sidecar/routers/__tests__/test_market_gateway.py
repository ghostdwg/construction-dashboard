"""
Offline, mock-only tests for the market.py transparent-gateway migration (P1B-3D).

market.py imports fastapi, pydantic, httpx, pymupdf, playwright, none of which are
installed offline — so this harness stubs them in sys.modules purely to import the
module, and patches ai_gateway.build_client at import time to capture the eager
module-level construction. The Claude path is exercised by monkeypatching
ai_gateway.create_message; Ollama and routing are exercised by monkeypatching the
module's own async helpers. No network, no DB, no live provider.

Runnable two ways:
  * plain stdlib:  python3 sidecar/routers/__tests__/test_market_gateway.py
  * pytest:        pytest sidecar/routers/__tests__/test_market_gateway.py
"""
import os
import sys
import types
import inspect
import asyncio
import contextlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


# ── Stub heavy runtime deps so market imports offline ───────────────────────
def _stub(name, **attrs):
    m = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(m, k, v)
    sys.modules[name] = m
    return m


class _HTTPException(Exception):
    def __init__(self, status_code, detail=None):
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))


class _APIRouter:
    def post(self, *a, **k):
        def deco(fn):
            return fn
        return deco


class _BaseModel:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


class _StubAnthropic:
    def __init__(self, api_key=None, **k):
        self.api_key = api_key


_stub("httpx")
_stub("pymupdf")
_stub("fastapi", APIRouter=_APIRouter, HTTPException=_HTTPException)
_stub("pydantic", BaseModel=_BaseModel)
_pw = _stub("playwright")
_pw_async = _stub("playwright.async_api", async_playwright=lambda *a, **k: None)
_pw.async_api = _pw_async
_stub("anthropic", Anthropic=_StubAnthropic,
      APIStatusError=type("APIStatusError", (Exception,), {}))

from services import ai_gateway  # noqa: E402  (real; no heavy deps)

# Capture the eager module-level build_client(...) call at import time.
_BUILD_CALLS = []
_SENTINEL_CLIENT = object()
_orig_build = ai_gateway.build_client
ai_gateway.build_client = lambda api_key=None: (_BUILD_CALLS.append(api_key) or _SENTINEL_CLIENT)
os.environ.pop("ANTHROPIC_API_KEY", None)   # so os.getenv(..., "") yields ""

from routers import market  # noqa: E402  (runs module-level build_client)

ai_gateway.build_client = _orig_build  # restore; import already captured


# ── Fakes ───────────────────────────────────────────────────────────────────
class FakeUsage:
    def __init__(self, i, o):
        self.input_tokens = i
        self.output_tokens = o


class FakeBlock:
    def __init__(self, text):
        self.text = text


class FakeMessage:
    def __init__(self, text="", it=0, ot=0, content=None):
        self.content = [FakeBlock(text)] if content is None else content
        self.usage = FakeUsage(it, ot)


@contextlib.contextmanager
def patch_create(result=None, raise_exc=None):
    calls = []

    def rec(**kwargs):
        calls.append(kwargs)
        if raise_exc is not None:
            raise raise_exc
        return result
    saved = ai_gateway.create_message
    ai_gateway.create_message = rec
    try:
        yield calls
    finally:
        ai_gateway.create_message = saved


def run(coro):
    return asyncio.run(coro)


# ===========================================================================
#  A2. Module-level construction fidelity
# ===========================================================================
def test_build_client_called_once_at_import_with_env_default():
    assert _BUILD_CALLS == [""], "build_client must be called once with os.getenv('ANTHROPIC_API_KEY','')"
    assert market.anthropic is _SENTINEL_CLIENT, "module singleton must be the build_client result"


# ===========================================================================
#  A3 / A10. Request forwarding + prompt-content boundary
# ===========================================================================
def test_scan_text_forwards_exact_request():
    doc = "COUNCIL MINUTES BODY"
    res = types.SimpleNamespace(raw=FakeMessage('{"signals":[],"relationships":[]}', 5, 3))
    with patch_create(result=res) as calls:
        run(market._scan_text(doc, None, None))
    assert len(calls) == 1
    k = calls[0]
    assert k["model"] == market.MODEL
    assert k["max_tokens"] == 4096
    assert k["system"] == market.SYSTEM_PROMPT
    assert k["messages"] == [{"role": "user", "content": market.EXTRACT_PROMPT + doc}]
    assert k["client"] is market.anthropic          # preserved singleton


def test_scan_text_prompt_excludes_hints():
    doc = "DOC TEXT"
    res = types.SimpleNamespace(raw=FakeMessage('{"signals":[],"relationships":[]}', 1, 1))
    with patch_create(result=res) as calls:
        out = run(market._scan_text(doc, "PolkCounty", "2026-01-01"))
    # Hints must NOT enter the prompt — only EXTRACT_PROMPT + doc_text.
    assert calls[0]["messages"][0]["content"] == market.EXTRACT_PROMPT + doc
    # Hints are still applied in post-processing (override), not the prompt.
    assert out["jurisdiction"] == "PolkCounty"
    assert out["document_date"] == "2026-01-01"


# ===========================================================================
#  A4. Fenced + bare JSON fidelity, usage, cost
# ===========================================================================
def _payload():
    return ('{"jurisdiction":"City X","document_date":"2026-02-02",'
            '"signals":[{"headline":"Job"}],'
            '"relationships":[{"from_name":"GC","to_name":"Sub"}]}')


def test_bare_json_fidelity_and_cost():
    it, ot = 1000, 200
    res = types.SimpleNamespace(raw=FakeMessage(_payload(), it, ot))
    with patch_create(result=res):
        out = run(market._scan_text("doc", None, None))
    assert out["signals"] == [{"headline": "Job"}]
    assert out["relationships"] == [{"from_name": "GC", "to_name": "Sub"}]
    assert out["jurisdiction"] == "City X"
    assert out["document_date"] == "2026-02-02"
    assert out["input_tokens"] == it and out["output_tokens"] == ot
    assert out["cost_usd"] == round((it * 3 + ot * 15) / 1_000_000, 4)


def test_fenced_json_fidelity():
    body = "```json\n" + _payload() + "\n```"
    res = types.SimpleNamespace(raw=FakeMessage(body, 10, 5))
    with patch_create(result=res):
        out = run(market._scan_text("doc", None, None))
    assert out["signals"] == [{"headline": "Job"}]
    assert out["jurisdiction"] == "City X"


# ===========================================================================
#  A5 / A6. Parse-failure and provider-error contracts
# ===========================================================================
def test_malformed_json_raises_500_invalid_json():
    res = types.SimpleNamespace(raw=FakeMessage("not json at all", 1, 1))
    raised = None
    with patch_create(result=res):
        try:
            run(market._scan_text("doc", None, None))
        except market.HTTPException as e:
            raised = e
    assert raised is not None and raised.status_code == 500
    assert "invalid JSON" in str(raised.detail)


def test_provider_error_raises_500_claude_api_error():
    raised = None
    with patch_create(raise_exc=RuntimeError("boom")):
        try:
            run(market._scan_text("doc", None, None))
        except market.HTTPException as e:
            raised = e
    assert raised is not None and raised.status_code == 500
    assert "Claude API error" in str(raised.detail)


# ===========================================================================
#  A7 / A8. None-raw and empty-content preserved (NOT improved)
# ===========================================================================
def test_none_raw_surfaces_attributeerror():
    res = types.SimpleNamespace(raw=None)   # gateway null passthrough
    raised = None
    with patch_create(result=res):
        try:
            run(market._scan_text("doc", None, None))
        except AttributeError as e:
            raised = e
        except market.HTTPException as e:  # must NOT be swallowed as HTTPException
            raised = e
    assert isinstance(raised, AttributeError)


def test_empty_content_surfaces_indexerror():
    res = types.SimpleNamespace(raw=FakeMessage(content=[]))
    raised = None
    with patch_create(result=res):
        try:
            run(market._scan_text("doc", None, None))
        except IndexError as e:
            raised = e
    assert isinstance(raised, IndexError)


# ===========================================================================
#  B9. Engine-selection / routing invariance
# ===========================================================================
def _req(text="some text", engine="claude", model=None):
    return market.AnalyzeTextRequest(text=text, engine=engine, model=model,
                                     jurisdiction=None, source_date=None)


def test_analyze_text_ollama_does_not_call_create_message():
    async def fake_ollama(doc_text, model):
        return {"parsed": {"signals": [], "jurisdiction": None, "document_date": None},
                "model": "qwen2.5:14b", "cost_usd": 0.0,
                "input_tokens": 0, "output_tokens": 0}
    saved = market._analyze_with_ollama
    market._analyze_with_ollama = fake_ollama
    try:
        with patch_create(result=types.SimpleNamespace(raw=FakeMessage("{}", 0, 0))) as calls:
            resp = run(market.analyze_text(_req(engine="ollama")))
        assert calls == []                       # create_message NOT reached
        assert resp.engine == "ollama"
    finally:
        market._analyze_with_ollama = saved


def test_analyze_text_claude_reaches_scan_text():
    hit = {"called": False}

    async def fake_scan(doc_text, jur, sd):
        hit["called"] = True
        return {"signals": [], "relationships": [], "jurisdiction": None,
                "document_date": None, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
    saved = market._scan_text
    market._scan_text = fake_scan
    try:
        resp = run(market.analyze_text(_req(engine="claude")))
        assert hit["called"] is True
        assert resp.engine == "claude" and resp.model == market.MODEL
    finally:
        market._scan_text = saved


def test_analyze_text_invalid_engine_400():
    raised = None
    try:
        run(market.analyze_text(_req(engine="banana")))
    except market.HTTPException as e:
        raised = e
    assert raised is not None and raised.status_code == 400


# ===========================================================================
#  C11. No-persistence boundary (source-level)
# ===========================================================================
def test_scan_text_has_no_db_write():
    src = inspect.getsource(market._scan_text)
    for marker in ("commit(", ".execute(", "session", "prisma", "INSERT", "sqlalchemy"):
        assert marker not in src, f"_scan_text must not perform persistence ({marker})"


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
    print(f"\ntest_market_gateway: {'PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    sys.exit(1 if failures else 0)
