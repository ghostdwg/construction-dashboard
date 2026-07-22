"""Fail-closed environment configuration for the worker client."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Mapping
from urllib.parse import urlsplit


class ConfigurationError(ValueError):
    """Raised when worker configuration is missing or unsafe."""


def _required(environment: Mapping[str, str], name: str) -> str:
    value = environment.get(name, "").strip()
    if not value:
        raise ConfigurationError(f"{name} is required")
    return value


def _positive_float(environment: Mapping[str, str], name: str, default: float) -> float:
    raw = environment.get(name, str(default)).strip()
    try:
        value = float(raw)
    except ValueError as error:
        raise ConfigurationError(f"{name} must be a number") from error
    if value <= 0:
        raise ConfigurationError(f"{name} must be greater than zero")
    return value


def _positive_int(environment: Mapping[str, str], name: str, default: int) -> int:
    raw = environment.get(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as error:
        raise ConfigurationError(f"{name} must be an integer") from error
    if value <= 0:
        raise ConfigurationError(f"{name} must be greater than zero")
    return value


def _base_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ConfigurationError("MEETING_WORKER_BASE_URL must be an absolute HTTP(S) URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ConfigurationError("MEETING_WORKER_BASE_URL must not contain credentials, a query, or a fragment")
    if parsed.path not in {"", "/"}:
        raise ConfigurationError("MEETING_WORKER_BASE_URL must be an origin without a path")
    local_hosts = {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme == "http" and parsed.hostname.lower() not in local_hosts:
        raise ConfigurationError("plain HTTP is allowed only for a loopback MEETING_WORKER_BASE_URL")
    return value.rstrip("/")


@dataclass(frozen=True)
class WorkerConfig:
    base_url: str
    worker_token: str
    worker_id: str
    processor_kind: str
    poll_interval_seconds: float
    heartbeat_interval_seconds: float
    request_timeout_seconds: float
    request_attempts: int
    backoff_initial_seconds: float
    backoff_max_seconds: float
    max_media_bytes: int
    scratch_directory: Path
    log_level: str

    @classmethod
    def from_env(cls, environment: Mapping[str, str] | None = None) -> "WorkerConfig":
        env = os.environ if environment is None else environment
        base_url = _base_url(_required(env, "MEETING_WORKER_BASE_URL"))
        worker_token = _required(env, "MEETING_WORKER_TOKEN")
        worker_id = _required(env, "MEETING_WORKER_ID")
        if len(worker_id) > 160:
            raise ConfigurationError("MEETING_WORKER_ID must contain at most 160 characters")
        processor_kind = _required(env, "MEETING_WORKER_PROCESSOR")
        if processor_kind != "deterministic_fixture":
            raise ConfigurationError("MEETING_WORKER_PROCESSOR must be deterministic_fixture in this skeleton")

        poll_interval = _positive_float(env, "MEETING_WORKER_POLL_SECONDS", 10.0)
        heartbeat_interval = _positive_float(env, "MEETING_WORKER_HEARTBEAT_SECONDS", 240.0)
        if heartbeat_interval >= 900:
            raise ConfigurationError("MEETING_WORKER_HEARTBEAT_SECONDS must be below the 900-second lease")
        request_timeout = _positive_float(env, "MEETING_WORKER_REQUEST_TIMEOUT_SECONDS", 30.0)
        request_attempts = _positive_int(env, "MEETING_WORKER_REQUEST_ATTEMPTS", 3)
        if request_attempts > 10:
            raise ConfigurationError("MEETING_WORKER_REQUEST_ATTEMPTS must not exceed 10")
        backoff_initial = _positive_float(env, "MEETING_WORKER_BACKOFF_INITIAL_SECONDS", 1.0)
        backoff_max = _positive_float(env, "MEETING_WORKER_BACKOFF_MAX_SECONDS", 60.0)
        if backoff_max < backoff_initial:
            raise ConfigurationError("MEETING_WORKER_BACKOFF_MAX_SECONDS must be at least the initial backoff")
        max_media_bytes = _positive_int(env, "MEETING_WORKER_MAX_MEDIA_BYTES", 2 * 1024 * 1024 * 1024)

        scratch = Path(env.get("MEETING_WORKER_SCRATCH_DIR", "run")).expanduser().resolve()
        if scratch == Path(scratch.anchor):
            raise ConfigurationError("MEETING_WORKER_SCRATCH_DIR must not be a filesystem root")
        log_level = env.get("MEETING_WORKER_LOG_LEVEL", "INFO").strip().upper()
        if log_level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ConfigurationError("MEETING_WORKER_LOG_LEVEL is invalid")

        return cls(
            base_url=base_url,
            worker_token=worker_token,
            worker_id=worker_id,
            processor_kind=processor_kind,
            poll_interval_seconds=poll_interval,
            heartbeat_interval_seconds=heartbeat_interval,
            request_timeout_seconds=request_timeout,
            request_attempts=request_attempts,
            backoff_initial_seconds=backoff_initial,
            backoff_max_seconds=backoff_max,
            max_media_bytes=max_media_bytes,
            scratch_directory=scratch,
            log_level=log_level,
        )
