"""
Credentials vault — sidecar side.

⚠ SECURITY-CRITICAL ⚠

Reads encrypted IntegrationCredential rows from the libsql DB and decrypts
with the master key in CREDENTIAL_MASTER_KEY env var.

This module is the ONLY decryption path on the sidecar side. It is intentionally
isolated from any prompt-building code path. Plaintext credentials flow only
through Playwright login flows for the configured services.

Every decrypt() emits an audit line to /storage/audit/credentials-access.jsonl
mirroring what the Next.js side writes.
"""

import base64
import json
import os
import time
from datetime import datetime, timezone
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

CREDENTIAL_MASTER_KEY_ENV = "CREDENTIAL_MASTER_KEY"
DATABASE_URL_ENV          = "DATABASE_URL"
AUDIT_DIR                 = "/storage/audit"
AUDIT_FILE                = os.path.join(AUDIT_DIR, "credentials-access.jsonl")


_key: Optional[bytes] = None


def _master_key() -> bytes:
    global _key
    if _key is not None:
        return _key
    raw = os.getenv(CREDENTIAL_MASTER_KEY_ENV, "").strip()
    if not raw:
        raise RuntimeError(f"{CREDENTIAL_MASTER_KEY_ENV} not set")
    # Hex (64 chars) or base64
    if len(raw) == 64 and all(c in "0123456789abcdefABCDEF" for c in raw):
        key = bytes.fromhex(raw)
    else:
        key = base64.b64decode(raw)
    if len(key) != 32:
        raise RuntimeError(f"{CREDENTIAL_MASTER_KEY_ENV} must decode to 32 bytes (got {len(key)})")
    _key = key
    return key


def _audit(service: str, field: str, caller_module: str) -> None:
    try:
        os.makedirs(AUDIT_DIR, exist_ok=True)
        rec = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "service": service,
            "field": field,
            "caller_module": f"sidecar:{caller_module}",
        }
        with open(AUDIT_FILE, "a", encoding="utf8") as f:
            f.write(json.dumps(rec) + "\n")
    except Exception as e:
        # Loud but non-fatal — failing to audit must not block the read
        print(f"[credential-audit] failed to write audit event: {e}", flush=True)


def decrypt_row(row: dict, caller_module: str) -> str:
    """Decrypt one row dict from the DB. Audit-logged.

    row keys: encryptedValue, iv, authTag, algorithm, service, field
    """
    if row.get("algorithm") != "aes-256-gcm":
        raise ValueError(f"Unsupported algorithm: {row.get('algorithm')}")
    key = _master_key()
    iv = base64.b64decode(row["iv"])
    ciphertext = base64.b64decode(row["encryptedValue"])
    auth_tag = base64.b64decode(row["authTag"])
    # AESGCM expects ciphertext || tag
    aesgcm = AESGCM(key)
    plain = aesgcm.decrypt(iv, ciphertext + auth_tag, None).decode("utf8")

    _audit(row["service"], row["field"], caller_module)
    return plain


def fetch_and_decrypt(service: str, fields: list[str], caller_module: str) -> dict[str, str]:
    """Fetch all requested fields for a service and decrypt them in one pass.

    Uses the Turso HTTP API directly (POST {host}/v2/pipeline) — avoids the
    older libsql-client 0.x WSS path which doesn't work with current Turso
    instances. Returns a dict {field: plaintext}.
    """
    import httpx
    from urllib.parse import urlparse, parse_qs

    url = os.getenv(DATABASE_URL_ENV)
    if not url:
        raise RuntimeError(f"{DATABASE_URL_ENV} not set")

    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    auth_token = (qs.get("authToken") or qs.get("auth_token") or [None])[0]
    if not auth_token:
        raise RuntimeError("authToken missing from DATABASE_URL")
    pipeline_url = f"https://{parsed.netloc}/v2/pipeline"

    # Build one pipeline request with N execute statements (one per field).
    requests = [
        {
            "type": "execute",
            "stmt": {
                "sql": (
                    "SELECT service, field, encryptedValue, iv, authTag, algorithm "
                    "FROM IntegrationCredential WHERE service = ? AND field = ?"
                ),
                "args": [
                    {"type": "text", "value": service},
                    {"type": "text", "value": f},
                ],
            },
        }
        for f in fields
    ]
    requests.append({"type": "close"})

    with httpx.Client(timeout=15) as client:
        r = client.post(
            pipeline_url,
            json={"requests": requests},
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        r.raise_for_status()
        data = r.json()

    out: dict[str, str] = {}
    for f, result in zip(fields, data.get("results", [])):
        if result.get("type") != "ok":
            continue
        rows = result.get("response", {}).get("result", {}).get("rows", [])
        if not rows:
            continue
        # rows[0] is a list of column-value dicts in declaration order
        values = [cell.get("value") for cell in rows[0]]
        row = {
            "service":        values[0],
            "field":          values[1],
            "encryptedValue": values[2],
            "iv":             values[3],
            "authTag":        values[4],
            "algorithm":      values[5],
        }
        out[f] = decrypt_row(row, caller_module)

    return out


def assert_master_key_configured() -> None:
    """Use at startup to fail fast if the key is missing."""
    _master_key()
