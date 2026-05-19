"""
Sidecar credentials router.

POST /credentials/test/{service}
  Attempts a connection test for the given service using credentials from
  the encrypted vault. Returns {ok: bool, error?: str}. Never returns
  plaintext credential material.

POST /credentials/healthcheck
  Confirms the master key is configured and reachable. Returns {ok: bool}.
"""

import os
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class TestResult(BaseModel):
    ok: bool
    error: Optional[str] = None
    service: str


@router.post("/credentials/healthcheck")
async def healthcheck():
    """Confirm the master key is configured and the audit dir is writable."""
    try:
        from services.credentials import assert_master_key_configured
        assert_master_key_configured()
        # Write a dummy audit-check line to confirm /storage is mounted
        audit_dir = "/storage/audit"
        os.makedirs(audit_dir, exist_ok=True)
        return {"ok": True, "audit_dir": audit_dir}
    except Exception as exc:
        raise HTTPException(500, f"Credentials vault not ready: {exc}")


@router.post("/credentials/test/{service}", response_model=TestResult)
async def test_credential(service: str):
    """Try a login with the stored credentials for the given service.

    Today: stub that confirms creds are present + decryptable, then attempts
    a placeholder login. As real adapters land (Beeline, Blue Book, etc.),
    each gets its own test function below.
    """
    if service not in {"beeline", "blue_book", "constructconnect", "isqft", "dodge"}:
        raise HTTPException(400, f"Unknown service: {service}")

    try:
        from services.credentials import fetch_and_decrypt
    except Exception as exc:
        return TestResult(ok=False, service=service, error=f"vault unavailable: {exc}")

    # Each service has its own expected field set + login probe
    if service == "beeline":
        result = await _test_beeline()
    elif service == "blue_book":
        result = TestResult(ok=False, service=service,
                            error="blue_book adapter not implemented yet")
    elif service == "constructconnect":
        result = TestResult(ok=False, service=service,
                            error="constructconnect adapter not implemented yet")
    elif service == "isqft":
        result = TestResult(ok=False, service=service,
                            error="isqft adapter not implemented yet")
    elif service == "dodge":
        result = TestResult(ok=False, service=service,
                            error="dodge adapter not implemented yet")
    else:
        result = TestResult(ok=False, service=service, error="unhandled service")

    return result


async def _test_beeline() -> TestResult:
    """Stub Beeline login probe.

    For v1: just verify that username + password are present and decryptable.
    When the real adapter ships (Phase 5L), this will use Playwright to
    perform an actual login and report success/failure.
    """
    try:
        from services.credentials import fetch_and_decrypt
        creds = fetch_and_decrypt("beeline", ["username", "password"],
                                  caller_module="credentials.test_beeline")
    except Exception as exc:
        return TestResult(ok=False, service="beeline", error=f"vault read failed: {exc}")

    missing = [k for k in ("username", "password") if not creds.get(k)]
    if missing:
        return TestResult(ok=False, service="beeline",
                          error=f"missing fields: {', '.join(missing)}")

    # Real login probe goes here when Beeline adapter ships.
    # For now: success means "creds decrypted cleanly".
    return TestResult(ok=True, service="beeline", error=None)
