"""Structured logging with secret redaction and confidential-data-safe fields."""

from __future__ import annotations

import json
import logging
from typing import Any, Iterable


_ALLOWED_FIELDS = {
    "attempt",
    "delay_seconds",
    "error_code",
    "error_type",
    "http_status",
    "job_id",
    "percent",
    "stage",
    "worker_id",
}


class RedactingFilter(logging.Filter):
    def __init__(self, secrets: Iterable[str]) -> None:
        super().__init__()
        self._secrets = tuple(secret for secret in secrets if secret)

    def filter(self, record: logging.LogRecord) -> bool:
        rendered = record.getMessage()
        for secret in self._secrets:
            rendered = rendered.replace(secret, "[REDACTED]")
        record.msg = rendered
        record.args = ()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "level": record.levelname,
            "event": record.getMessage(),
        }
        fields = getattr(record, "structured_fields", {})
        payload.update({key: value for key, value in fields.items() if key in _ALLOWED_FIELDS})
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


class StructuredLogger:
    """Small allowlisted facade that cannot accidentally log result content."""

    def __init__(self, logger: logging.Logger) -> None:
        self._logger = logger

    def event(self, level: int, name: str, **fields: Any) -> None:
        safe_fields = {key: value for key, value in fields.items() if key in _ALLOWED_FIELDS}
        self._logger.log(level, name, extra={"structured_fields": safe_fields})

    def info(self, name: str, **fields: Any) -> None:
        self.event(logging.INFO, name, **fields)

    def warning(self, name: str, **fields: Any) -> None:
        self.event(logging.WARNING, name, **fields)

    def error(self, name: str, **fields: Any) -> None:
        self.event(logging.ERROR, name, **fields)


def configure_logging(level: str, secrets: Iterable[str], stream: Any = None) -> StructuredLogger:
    logger = logging.getLogger("groundworx.meeting_worker")
    logger.handlers.clear()
    logger.propagate = False
    logger.setLevel(getattr(logging, level))
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RedactingFilter(secrets))
    logger.addHandler(handler)
    return StructuredLogger(logger)
