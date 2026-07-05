"""
N3 — grep-based regression test for the Option-A credential migration
(docs/architecture/adr/0001-ai-credential-resolution.md).

Confirms the three originally-named legacy bypasses, plus the spec_intelligence.py
follow-on migration (one of the ADR's "5 additional sites"), no longer
independently resolve `ANTHROPIC_API_KEY` from process.env / os.getenv, and no
longer construct their own provider client directly. Pure text/regex checks
against the repo tree — no imports, no network, no DB.

Honest partial-migration note (meeting_intelligence.py): the module keeps
ONE `os.getenv("ANTHROPIC_API_KEY", "")` line for a config-status diagnostic
(`/meetings/config`'s `analysis_configured` boolean) that is not part of any
credential-resolution-for-a-provider-call path. This test asserts that
constant appears at most once in the whole file, and — more importantly —
that neither analyze function's own source body references it or any other
os.getenv/env fallback. See sidecar/services/meeting_intelligence.py's
module-level comment for the full rationale.

Runnable two ways:
  * plain stdlib:  python3 governance/guardrails/__tests__/test_n3_credential_bypass_grep.py
  * pytest:        pytest governance/guardrails/__tests__/test_n3_credential_bypass_grep.py
"""
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

ORGANIZE_WITH_AI = REPO_ROOT / "lib/services/submittal/organizeWithAi.ts"
DRAWING_INTELLIGENCE = REPO_ROOT / "sidecar/services/drawing_intelligence.py"
MEETING_INTELLIGENCE = REPO_ROOT / "sidecar/services/meeting_intelligence.py"
SPEC_INTELLIGENCE = REPO_ROOT / "sidecar/services/spec_intelligence.py"
SPEC_ANALYSIS_AUTOMATION = REPO_ROOT / "lib/services/jobs/specAnalysisAutomation.ts"


def _read(path: Path) -> str:
    assert path.exists(), f"expected file not found: {path}"
    return path.read_text(encoding="utf-8")


def _extract_python_function(source: str, name: str) -> str:
    """Grab a top-level `def name(...):` body up to the next top-level def/EOF.
    Simple indentation-based slice — sufficient for this file's flat structure."""
    lines = source.splitlines()
    start = None
    for i, line in enumerate(lines):
        if re.match(rf"^(async )?def {re.escape(name)}\(", line):
            start = i
            break
    assert start is not None, f"could not find function {name!r} in source"
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if re.match(r"^(async )?def \w+\(", lines[j]):
            end = j
            break
    return "\n".join(lines[start:end])


# ---- organizeWithAi.ts -------------------------------------------------------
def test_organize_with_ai_has_no_direct_env_or_client_construction():
    src = _read(ORGANIZE_WITH_AI)
    assert "process.env.ANTHROPIC_API_KEY" not in src, (
        "organizeWithAi.ts must no longer read process.env.ANTHROPIC_API_KEY directly"
    )
    assert "new Anthropic(" not in src, (
        "organizeWithAi.ts must no longer construct its own Anthropic client"
    )
    assert '"@anthropic-ai/sdk"' not in src, (
        "organizeWithAi.ts must no longer import the Anthropic SDK directly"
    )
    assert "getSetting(\"ANTHROPIC_API_KEY\")" in src, (
        "organizeWithAi.ts must resolve the credential via getSetting()"
    )
    assert 'from "@/lib/services/ai/gateway"' in src, (
        "organizeWithAi.ts must route the call through the sanctioned gateway"
    )


# ---- drawing_intelligence.py --------------------------------------------------
def test_drawing_intelligence_has_no_direct_env_or_client_construction():
    src = _read(DRAWING_INTELLIGENCE)
    assert "os.environ.get(\"ANTHROPIC_API_KEY\"" not in src
    assert "os.getenv(\"ANTHROPIC_API_KEY\"" not in src
    assert "anthropic.Anthropic(" not in src, (
        "drawing_intelligence.py must no longer construct anthropic.Anthropic() directly"
    )
    assert "import anthropic" not in src, (
        "drawing_intelligence.py must no longer import anthropic directly"
    )
    assert "ai_gateway.build_client(" in src, (
        "drawing_intelligence.py must construct its client via the sanctioned ai_gateway.build_client()"
    )
    assert "api_key: Optional[str] = None" in src, (
        "analyze_drawings must accept api_key as an explicit parameter"
    )


# ---- meeting_intelligence.py --------------------------------------------------
def test_meeting_intelligence_named_functions_have_no_env_fallback_or_direct_construction():
    src = _read(MEETING_INTELLIGENCE)

    assert "anthropic.Anthropic(" not in src, (
        "meeting_intelligence.py must no longer construct anthropic.Anthropic() directly"
    )
    assert "import anthropic" not in src, (
        "meeting_intelligence.py must no longer import anthropic directly"
    )
    assert "ai_gateway.build_client(" in src

    # The Option-C hybrid this ADR explicitly rejects must be gone.
    assert "effective_key" not in src, (
        "the `effective_key = api_key or ANTHROPIC_API_KEY` hybrid must be fully removed"
    )
    assert "api_key or ANTHROPIC_API_KEY" not in src

    ctx_fn = _extract_python_function(src, "analyze_meeting_with_context")
    legacy_fn = _extract_python_function(src, "analyze_meeting_transcript")

    for fn_src, fn_name in [(ctx_fn, "analyze_meeting_with_context"), (legacy_fn, "analyze_meeting_transcript")]:
        assert "os.getenv" not in fn_src, f"{fn_name} must not read os.getenv itself"
        assert "os.environ" not in fn_src, f"{fn_name} must not read os.environ itself"
        # Docstrings/error-message strings are allowed to mention the env var
        # name for human readability (e.g. "ANTHROPIC_API_KEY not configured");
        # what must be absent is any *code reference* to the module-level
        # constant as a fallback value (an identifier used bare, not inside a
        # quoted string).
        code_only = re.sub(r'""".*?"""', "", fn_src, flags=re.DOTALL)
        code_only = re.sub(r'"[^"\n]*"|\'[^\'\n]*\'', "", code_only)
        assert "ANTHROPIC_API_KEY" not in code_only, (
            f"{fn_name} must not reference the module-level ANTHROPIC_API_KEY "
            "constant as a fallback value in code — api_key must be the sole source"
        )

    # Documented, honest residual: exactly one os.getenv("ANTHROPIC_API_KEY", ...)
    # line remains — the module-level constant used solely by the
    # /meetings/config diagnostic endpoint, not by either analyze function.
    residual_hits = len(re.findall(r'os\.getenv\("ANTHROPIC_API_KEY"', src))
    assert residual_hits == 1, (
        f"expected exactly 1 residual os.getenv(\"ANTHROPIC_API_KEY\" reference "
        f"(the /meetings/config diagnostic constant), found {residual_hits}"
    )


# ---- spec_intelligence.py (N3 follow-on — ADR 0001 §6's "5 additional sites") --
def test_spec_intelligence_has_no_direct_env_read_in_migrated_execution_path():
    src = _read(SPEC_INTELLIGENCE)

    assert "os.getenv(\"ANTHROPIC_API_KEY\"" not in src, (
        "spec_intelligence.py must no longer read os.getenv(\"ANTHROPIC_API_KEY\") anywhere"
    )
    assert "os.environ.get(\"ANTHROPIC_API_KEY\"" not in src
    assert "os.environ[\"ANTHROPIC_API_KEY\"]" not in src
    assert "anthropic.Anthropic(" not in src, (
        "spec_intelligence.py must not construct anthropic.Anthropic() directly"
    )
    assert "import anthropic" not in src, (
        "spec_intelligence.py must not import anthropic directly"
    )
    assert "ai_gateway.build_client(" in src, (
        "spec_intelligence.py must construct its client via the sanctioned ai_gateway.build_client()"
    )

    # Both migrated entry points take api_key as an explicit parameter.
    analyze_split_fn = _extract_python_function(src, "analyze_split_sections")
    run_pipeline_fn = _extract_python_function(src, "run_spec_intelligence")

    for fn_src, fn_name in [
        (analyze_split_fn, "analyze_split_sections"),
        (run_pipeline_fn, "run_spec_intelligence"),
    ]:
        assert "api_key: Optional[str] = None" in fn_src, (
            f"{fn_name} must accept api_key as an explicit Optional[str] parameter"
        )
        assert "os.getenv" not in fn_src, f"{fn_name} must not read os.getenv itself"
        assert "os.environ" not in fn_src, f"{fn_name} must not read os.environ itself"

    # No residual os.getenv("ANTHROPIC_API_KEY" anywhere in this file at all —
    # unlike meeting_intelligence.py, spec_intelligence.py has no diagnostic
    # constant that needs one to remain.
    assert len(re.findall(r'os\.getenv\("ANTHROPIC_API_KEY"', src)) == 0


# ---- specAnalysisAutomation.ts (TS half of the spec_intelligence.py fix) -----
def test_spec_analysis_automation_resolves_via_get_setting_and_forwards_api_key():
    src = _read(SPEC_ANALYSIS_AUTOMATION)

    assert "process.env.ANTHROPIC_API_KEY" not in src, (
        "specAnalysisAutomation.ts must never read process.env.ANTHROPIC_API_KEY directly"
    )
    assert 'getSetting("ANTHROPIC_API_KEY")' in src, (
        "specAnalysisAutomation.ts must resolve the credential via getSetting()"
    )
    assert "api_key: apiKey" in src, (
        "specAnalysisAutomation.ts must forward the resolved credential to the "
        "sidecar as an explicit api_key request-body field"
    )


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
    print(f"\ntest_n3_credential_bypass_grep: {'PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    sys.exit(1 if failures else 0)
