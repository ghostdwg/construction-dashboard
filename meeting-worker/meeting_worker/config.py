"""Fail-closed environment configuration for the worker client."""

from __future__ import annotations

from dataclasses import dataclass
import math
import os
from pathlib import Path
import re
from typing import Mapping
from urllib.parse import urlsplit


class ConfigurationError(ValueError):
    """Raised when worker configuration is missing or unsafe."""


_DECIMAL = re.compile(r"^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$")
_INTEGER = re.compile(r"^(?:0|[1-9][0-9]*)$")
MAX_POLL_SECONDS = 3_600.0
MAX_REQUEST_TIMEOUT_SECONDS = 300.0
MAX_BACKOFF_SECONDS = 300.0
MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024
MIN_DELAY_SECONDS = 0.01


def _required(environment: Mapping[str, str], name: str) -> str:
    value = environment.get(name, "").strip()
    if not value:
        raise ConfigurationError(f"{name} is required")
    return value


def _bounded_float(
    environment: Mapping[str, str],
    name: str,
    default: float,
    *,
    minimum: float,
    maximum: float,
) -> float:
    raw = environment.get(name, str(default)).strip()
    if not _DECIMAL.fullmatch(raw):
        raise ConfigurationError(f"{name} must be a finite decimal number")
    try:
        value = float(raw)
    except (ValueError, OverflowError) as error:
        raise ConfigurationError(f"{name} must be a finite decimal number") from error
    if not math.isfinite(value):
        raise ConfigurationError(f"{name} must be finite")
    if value < minimum or value > maximum:
        raise ConfigurationError(f"{name} must be between {minimum:g} and {maximum:g}")
    return value


def _bounded_int(environment: Mapping[str, str], name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw = environment.get(name, str(default)).strip()
    if not _INTEGER.fullmatch(raw):
        raise ConfigurationError(f"{name} must be a decimal integer")
    try:
        value = int(raw)
    except (ValueError, OverflowError) as error:
        raise ConfigurationError(f"{name} must be a decimal integer") from error
    if value < minimum or value > maximum:
        raise ConfigurationError(f"{name} must be between {minimum} and {maximum}")
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

        poll_interval = _bounded_float(
            env, "MEETING_WORKER_POLL_SECONDS", 10.0, minimum=MIN_DELAY_SECONDS, maximum=MAX_POLL_SECONDS
        )
        heartbeat_interval = _bounded_float(
            env, "MEETING_WORKER_HEARTBEAT_SECONDS", 240.0, minimum=MIN_DELAY_SECONDS, maximum=899.0
        )
        request_timeout = _bounded_float(
            env,
            "MEETING_WORKER_REQUEST_TIMEOUT_SECONDS",
            30.0,
            minimum=MIN_DELAY_SECONDS,
            maximum=MAX_REQUEST_TIMEOUT_SECONDS,
        )
        request_attempts = _bounded_int(
            env, "MEETING_WORKER_REQUEST_ATTEMPTS", 3, minimum=1, maximum=10
        )
        backoff_initial = _bounded_float(
            env,
            "MEETING_WORKER_BACKOFF_INITIAL_SECONDS",
            1.0,
            minimum=MIN_DELAY_SECONDS,
            maximum=MAX_BACKOFF_SECONDS,
        )
        backoff_max = _bounded_float(
            env,
            "MEETING_WORKER_BACKOFF_MAX_SECONDS",
            60.0,
            minimum=MIN_DELAY_SECONDS,
            maximum=MAX_BACKOFF_SECONDS,
        )
        if backoff_max < backoff_initial:
            raise ConfigurationError("MEETING_WORKER_BACKOFF_MAX_SECONDS must be at least the initial backoff")
        max_media_bytes = _bounded_int(
            env, "MEETING_WORKER_MAX_MEDIA_BYTES", MAX_MEDIA_BYTES, minimum=1, maximum=MAX_MEDIA_BYTES
        )

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
