import pytest

from whisperx_auth import check_key, ServiceAuthError


def test_missing_key_fails_closed_outside_local(monkeypatch):
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.delenv("WHISPERX_API_KEY", raising=False)
    with pytest.raises(ServiceAuthError) as exc:
        check_key(None)
    assert exc.value.status_code == 503


def test_incorrect_key_is_denied(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WHISPERX_API_KEY", "expected")
    with pytest.raises(ServiceAuthError) as exc:
        check_key("incorrect")
    assert exc.value.status_code == 401


def test_valid_key_is_accepted(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WHISPERX_API_KEY", "expected")
    check_key("expected")


def test_explicit_test_mode_allows_synthetic_requests(monkeypatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.delenv("WHISPERX_API_KEY", raising=False)
    check_key(None)
