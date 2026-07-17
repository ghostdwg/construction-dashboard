import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from sidecar_auth import service_auth_error  # noqa: E402


def test_missing_key_fails_closed_outside_local(monkeypatch):
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.delenv("SIDECAR_API_KEY", raising=False)
    assert service_auth_error(None) == (503, "Service authentication is not configured")


def test_incorrect_key_is_denied(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SIDECAR_API_KEY", "expected")
    assert service_auth_error("incorrect")[0] == 401


def test_valid_key_is_accepted(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SIDECAR_API_KEY", "expected")
    assert service_auth_error("expected") is None


def test_explicit_test_mode_allows_synthetic_requests(monkeypatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.delenv("SIDECAR_API_KEY", raising=False)
    assert service_auth_error(None) is None
