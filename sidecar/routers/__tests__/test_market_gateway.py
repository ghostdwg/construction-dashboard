"""
Offline, mock-only tests for market.py's Option-A credential migration
(docs/architecture/adr/0001-ai-credential-resolution.md,
docs/architecture/adr/0002-remaining-sidecar-credential-targets.md §4).

REWRITTEN (not incrementally patched) for ADR 0002 §4: the previous version of
this file patched ai_gateway.build_client at import time to capture the EAGER
module-level client construction (`anthropic = ai_gateway.build_client(...)`).
That module-level singleton has been deliberately removed — the router now
resolves NO credential of its own and builds a call-scoped client inside
`_scan_text()` from a caller-supplied `api_key`. The singleton-capture
assertion is therefore replaced with its inverse: a proof that importing
market.py constructs NO client and reads NO ANTHROPIC_API_KEY from the
environment at import time, plus per-call construction / fail-closed / no-leak
assertions.

market.py imports fastapi, pydantic, httpx, pymupdf, playwright, none of which
are installed offline — so this harness stubs them in sys.modules purely to
import the module. The Claude path is exercised by monkeypatching
ai_gateway.create_message / ai_gateway.build_client; Ollama and routing are
exercised by monkeypatching the module's own async helpers. No network, no DB,
no live provider.

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

SENTINEL = "sk-test-sentinel-do-not-use-market"


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

# ── Prove the router constructs NO client at import time ─────────────────────
# The old singleton called build_client(os.getenv("ANTHROPIC_API_KEY","")) at
# import. Wrap build_client BEFORE importing market to capture any eager call;
# after the import the capture list must still be EMPTY, and the module must
# expose no `anthropic` attribute. This is the inverse of the assertion the
# pre-migration version of this file made.
_IMPORT_BUILD_CALLS = []
_orig_build = ai_gateway.build_client
ai_gateway.build_client = lambda api_key=None: (
    _IMPORT_BUILD_CALLS.append(api_key) or _StubAnthropic(api_key=api_key)
)
os.environ["ANTHROPIC_API_KEY"] = "env-key-that-must-never-be-read-at-import"

from routers import market  # noqa: E402  (must NOT run any build_client now)

_IMPORT_BUILD_CALLS_SNAPSHOT = list(_IMPORT_BUILD_CALLS)
ai_gateway.build_client = _orig_build  # restore
os.environ.pop("ANTHROPIC_API_KEY", None)


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


@contextlib.contextmanager
def patch_build_client():
    """Capture every build_client(api_key) call; return a fresh stub client."""
    captured = []

    def fake(api_key=None):
        c = _StubAnthropic(api_key=api_key)
        captured.append((api_key, c))
        return c
    saved = ai_gateway.build_client
    ai_gateway.build_client = fake
    try:
        yield captured
    finally:
        ai_gateway.build_client = saved


def run(coro):
    return asyncio.run(coro)


# ===========================================================================
#  MANDATORY TEST 1. No import-time provider-client construction / env read
# ===========================================================================
def test_import_constructs_no_client_and_reads_no_env():
    # The module must NOT have built a client at import time.
    assert _IMPORT_BUILD_CALLS_SNAPSHOT == [], (
        "importing market.py must NOT call ai_gateway.build_client at import "
        f"time (module-level singleton must be gone); saw {_IMPORT_BUILD_CALLS_SNAPSHOT!r}"
    )
    # The module must expose no `anthropic` singleton attribute.
    assert not hasattr(market, "anthropic"), (
        "market.py must no longer expose a module-level `anthropic` client"
    )
    # Source-level: no import-time os.getenv("ANTHROPIC_API_KEY") read.
    src = inspect.getsource(market)
    assert 'os.getenv("ANTHROPIC_API_KEY"' not in src, (
        "market.py must not read os.getenv(\"ANTHROPIC_API_KEY\") anywhere"
    )
    assert 'os.environ' not in src or 'ANTHROPIC_API_KEY' not in src.split('os.environ', 1)[1][:60], (
        "market.py must not read ANTHROPIC_API_KEY from os.environ"
    )


# ===========================================================================
#  MANDATORY TEST 2. Sentinel reaches ONLY build_client (the intended boundary)
# ===========================================================================
def test_sentinel_reaches_build_client_call_scoped():
    doc = "COUNCIL MINUTES BODY"
    res = types.SimpleNamespace(raw=FakeMessage('{"signals":[],"relationships":[]}', 5, 3))
    with patch_build_client() as built, patch_create(result=res) as calls:
        run(market._scan_text(doc, None, None, SENTINEL))

    # build_client was called exactly once, per-call, with the sentinel.
    assert [k for (k, _c) in built] == [SENTINEL], (
        "the exact sentinel must reach ai_gateway.build_client, call-scoped, once"
    )
    # The client passed into create_message is the one build_client returned.
    assert len(calls) == 1
    assert calls[0]["client"] is built[0][1], (
        "_scan_text must pass the call-scoped client (not any singleton) to create_message"
    )
    assert calls[0]["model"] == market.MODEL
    assert calls[0]["max_tokens"] == 4096
    assert calls[0]["system"] == market.SYSTEM_PROMPT
    assert calls[0]["messages"] == [{"role": "user", "content": market.EXTRACT_PROMPT + doc}]


# ===========================================================================
#  MANDATORY TEST 3. Sentinel never leaks into result / error / call kwargs
# ===========================================================================
def test_sentinel_never_leaks_into_result_or_create_kwargs():
    res = types.SimpleNamespace(raw=FakeMessage('{"signals":[{"h":1}],"relationships":[]}', 7, 2))
    with patch_build_client(), patch_create(result=res) as calls:
        out = run(market._scan_text("doc", "Ankeny", "2026-01-01", SENTINEL))

    import json as _json
    assert SENTINEL not in _json.dumps(out, default=str), (
        "credential must never appear in the returned result dict"
    )
    # The provider-call kwargs (model/max_tokens/system/messages) never carry it.
    for call in calls:
        payload = {k: v for k, v in call.items() if k != "client"}
        assert SENTINEL not in _json.dumps(payload, default=str), (
            "credential must never appear in the create_message request payload"
        )


def test_sentinel_never_leaks_into_thrown_error():
    with patch_build_client(), patch_create(raise_exc=RuntimeError("boom")):
        raised = None
        try:
            run(market._scan_text("doc", None, None, SENTINEL))
        except market.HTTPException as e:
            raised = e
    assert raised is not None and raised.status_code == 500
    assert SENTINEL not in str(raised.detail), "credential must never appear in a thrown error"


# ===========================================================================
#  MANDATORY TEST 5 (python side). Missing api_key fails closed, controlled
# ===========================================================================
def test_scan_text_fails_closed_when_api_key_missing():
    for missing in (None, ""):
        with patch_build_client() as built, patch_create(result=None) as calls:
            raised = None
            try:
                run(market._scan_text("doc", None, None, missing))
            except market.HTTPException as e:
                raised = e
        assert raised is not None, f"missing api_key={missing!r} must raise, not proceed"
        assert raised.status_code == 503
        assert "ANTHROPIC_API_KEY not configured" in str(raised.detail)
        assert built == [], "build_client must never be reached when the key is missing"
        assert calls == [], "create_message must never be reached when the key is missing"


def test_scan_text_missing_key_error_message_has_no_secret_shape():
    with patch_build_client():
        try:
            run(market._scan_text("doc", None, None, None))
        except market.HTTPException as e:
            msg = str(e.detail)
    assert msg == "ANTHROPIC_API_KEY not configured — set it in Settings → AI Configuration"
    assert "sk-" not in msg


# ===========================================================================
#  A3 / A10. Request forwarding + prompt-content boundary (hints excluded)
# ===========================================================================
def test_scan_text_prompt_excludes_hints():
    doc = "DOC TEXT"
    res = types.SimpleNamespace(raw=FakeMessage('{"signals":[],"relationships":[]}', 1, 1))
    with patch_build_client(), patch_create(result=res) as calls:
        out = run(market._scan_text(doc, "PolkCounty", "2026-01-01", SENTINEL))
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
    with patch_build_client(), patch_create(result=res):
        out = run(market._scan_text("doc", None, None, SENTINEL))
    assert out["signals"] == [{"headline": "Job"}]
    assert out["relationships"] == [{"from_name": "GC", "to_name": "Sub"}]
    assert out["jurisdiction"] == "City X"
    assert out["document_date"] == "2026-02-02"
    assert out["input_tokens"] == it and out["output_tokens"] == ot
    assert out["cost_usd"] == round((it * 3 + ot * 15) / 1_000_000, 4)


def test_fenced_json_fidelity():
    body = "```json\n" + _payload() + "\n```"
    res = types.SimpleNamespace(raw=FakeMessage(body, 10, 5))
    with patch_build_client(), patch_create(result=res):
        out = run(market._scan_text("doc", None, None, SENTINEL))
    assert out["signals"] == [{"headline": "Job"}]
    assert out["jurisdiction"] == "City X"


# ===========================================================================
#  A5 / A6. Parse-failure and provider-error contracts
# ===========================================================================
def test_malformed_json_raises_500_invalid_json():
    res = types.SimpleNamespace(raw=FakeMessage("not json at all", 1, 1))
    raised = None
    with patch_build_client(), patch_create(result=res):
        try:
            run(market._scan_text("doc", None, None, SENTINEL))
        except market.HTTPException as e:
            raised = e
    assert raised is not None and raised.status_code == 500
    assert "invalid JSON" in str(raised.detail)


def test_provider_error_raises_500_claude_api_error():
    raised = None
    with patch_build_client(), patch_create(raise_exc=RuntimeError("boom")):
        try:
            run(market._scan_text("doc", None, None, SENTINEL))
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
    with patch_build_client(), patch_create(result=res):
        try:
            run(market._scan_text("doc", None, None, SENTINEL))
        except AttributeError as e:
            raised = e
        except market.HTTPException as e:  # must NOT be swallowed as HTTPException
            raised = e
    assert isinstance(raised, AttributeError)


def test_empty_content_surfaces_indexerror():
    res = types.SimpleNamespace(raw=FakeMessage(content=[]))
    raised = None
    with patch_build_client(), patch_create(result=res):
        try:
            run(market._scan_text("doc", None, None, SENTINEL))
        except IndexError as e:
            raised = e
    assert isinstance(raised, IndexError)


# ===========================================================================
#  B9. Engine-selection / routing invariance (+ api_key threading)
# ===========================================================================
def _req(text="some text", engine="claude", model=None, api_key=SENTINEL):
    return market.AnalyzeTextRequest(text=text, engine=engine, model=model,
                                     jurisdiction=None, source_date=None,
                                     api_key=api_key)


def test_analyze_text_ollama_does_not_call_create_message():
    async def fake_ollama(doc_text, model):
        return {"parsed": {"signals": [], "jurisdiction": None, "document_date": None},
                "model": "qwen2.5:14b", "cost_usd": 0.0,
                "input_tokens": 0, "output_tokens": 0}
    saved = market._analyze_with_ollama
    market._analyze_with_ollama = fake_ollama
    try:
        # Ollama branch needs NO Anthropic key — api_key="" must still work.
        with patch_build_client() as built, patch_create(
                result=types.SimpleNamespace(raw=FakeMessage("{}", 0, 0))) as calls:
            resp = run(market.analyze_text(_req(engine="ollama", api_key="")))
        assert calls == []                       # create_message NOT reached
        assert built == []                       # build_client NOT reached
        assert resp.engine == "ollama"
    finally:
        market._analyze_with_ollama = saved


def test_analyze_text_claude_threads_api_key_to_scan_text():
    seen = {}

    async def fake_scan(doc_text, jur, sd, api_key=None):
        seen["api_key"] = api_key
        return {"signals": [], "relationships": [], "jurisdiction": None,
                "document_date": None, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
    saved = market._scan_text
    market._scan_text = fake_scan
    try:
        resp = run(market.analyze_text(_req(engine="claude", api_key=SENTINEL)))
        assert seen["api_key"] == SENTINEL, "analyze_text must forward req.api_key into _scan_text"
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
#  Endpoint-level threading: scan_document / scrape_source forward api_key
# ===========================================================================
def test_scan_document_forwards_api_key_to_scan_text():
    seen = {}

    async def fake_scan(doc_text, jur, sd, api_key=None):
        seen["api_key"] = api_key
        return {"signals": [], "relationships": [], "jurisdiction": None,
                "document_date": None, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
    saved = market._scan_text
    market._scan_text = fake_scan
    try:
        req = market.ScanRequest(url=None, text="some council text", jurisdiction=None,
                                 source_date=None, api_key=SENTINEL)
        run(market.scan_document(req))
        assert seen["api_key"] == SENTINEL
    finally:
        market._scan_text = saved


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
