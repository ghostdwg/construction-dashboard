"""OPS6 — pure-helper tests for the consultant-stream renderer.

Host-runnable: exercises validate_stream_payload and summarize_stream only
(jinja2/weasyprint load lazily inside the render path, never imported here).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from services.consultant_stream_pdf import (  # noqa: E402
    MAX_OBSERVATIONS,
    MAX_PAYLOAD_BYTES,
    summarize_stream,
    validate_stream_payload,
)


def obs(state="ENTERED", **overrides):
    base = {
        "observationText": "Handrail at stair 2 not yet installed",
        "state": state,
        "consultantTargetDate": "2026-07-18",
        "registerItem": None,
        "dispositions": [],
    }
    base.update(overrides)
    return base


def payload(observations):
    return {
        "projectName": "Test Project",
        "rangeLabel": "All reports to date",
        "filterSummary": "none",
        "generatedBy": "josh@example.test",
        "generatedAt": "2026-07-13T00:00:00Z",
        "reports": [
            {
                "vendorName": "IMEG",
                "categoryLabel": "Engineer Field Report",
                "reportDate": "2026-07-01",
                "status": "ACTIVE",
                "revisionCount": 1,
                "observations": observations,
            }
        ],
    }


# ── validate_stream_payload ───────────────────────────────────────────────────

def test_valid_payload_passes():
    assert validate_stream_payload(payload([obs()])) is None


def test_zero_observations_rejected():
    assert "zero observations" in validate_stream_payload(payload([]))


def test_observation_cap_enforced():
    too_many = [obs() for _ in range(MAX_OBSERVATIONS + 1)]
    err = validate_stream_payload(payload(too_many))
    assert err is not None and f"cap is {MAX_OBSERVATIONS}" in err


def test_byte_cap_enforced():
    big = [obs(observationText="x" * 4000) for _ in range(499)]
    p = payload(big)
    import json
    if len(json.dumps(p)) > MAX_PAYLOAD_BYTES:
        err = validate_stream_payload(p)
        assert err is not None and "bytes" in err
    else:  # payload construction stayed under the byte cap — force it
        p["reports"][0]["padding"] = "y" * MAX_PAYLOAD_BYTES
        err = validate_stream_payload(p)
        assert err is not None and "bytes" in err


def test_bad_shapes_rejected_never_raise():
    assert validate_stream_payload([]) is not None
    assert validate_stream_payload({"reports": "nope"}) is not None


# ── summarize_stream ──────────────────────────────────────────────────────────

def test_summary_counts_states_responses_and_current_disposition():
    rows = [
        obs("ENTERED"),
        obs("ACCEPTED_NEW_ITEM", registerItem={"id": 7, "formalResponse": "We will fix it."}),
        obs("ACCEPTED_LINKED_ITEM", registerItem={"id": 7, "formalResponse": "We will fix it."}),
        obs("DISMISSED"),
        obs(
            "ACCEPTED_NEW_ITEM",
            registerItem={"id": 9, "formalResponse": None},
            dispositions=[
                {"dispositionType": "REJECT"},
                {"dispositionType": "APPROVE"},  # latest = current
            ],
        ),
    ]
    totals = summarize_stream(payload(rows))
    assert totals["observations"] == 5
    assert totals["open"] == 1
    assert totals["acceptedNew"] == 2
    assert totals["acceptedLinked"] == 1
    assert totals["dismissed"] == 1
    # Two observations share item #7's ONE response → counted once (zero-copy rule).
    assert totals["responded"] == 1
    # Only the LATEST disposition counts as current.
    assert totals["disposedApprove"] == 1
    assert totals["disposedReject"] == 0


def test_summary_empty_payload_is_all_zeroes():
    totals = summarize_stream({"reports": []})
    assert all(v == 0 for v in totals.values())
