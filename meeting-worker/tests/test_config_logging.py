from __future__ import annotations

from io import StringIO
import json
import unittest

from meeting_worker.config import ConfigurationError, WorkerConfig
from meeting_worker.logging_utils import configure_logging


class ConfigTests(unittest.TestCase):
    @staticmethod
    def _environment(**overrides: str) -> dict[str, str]:
        environment = {
            "MEETING_WORKER_BASE_URL": "http://127.0.0.1:3000",
            "MEETING_WORKER_TOKEN": "secret",
            "MEETING_WORKER_ID": "worker-a",
            "MEETING_WORKER_PROCESSOR": "deterministic_fixture",
        }
        environment.update(overrides)
        return environment

    def test_missing_configuration_fails_closed(self) -> None:
        with self.assertRaises(ConfigurationError):
            WorkerConfig.from_env({})
        with self.assertRaisesRegex(ConfigurationError, "MEETING_WORKER_TOKEN"):
            WorkerConfig.from_env({"MEETING_WORKER_BASE_URL": "http://127.0.0.1:3000"})
        with self.assertRaisesRegex(ConfigurationError, "MEETING_WORKER_ID"):
            WorkerConfig.from_env(
                {
                    "MEETING_WORKER_BASE_URL": "http://127.0.0.1:3000",
                    "MEETING_WORKER_TOKEN": "secret",
                }
            )

    def test_non_loopback_plain_http_fails_closed(self) -> None:
        with self.assertRaisesRegex(ConfigurationError, "plain HTTP"):
            WorkerConfig.from_env(
                {
                    "MEETING_WORKER_BASE_URL": "http://worker-api.internal",
                    "MEETING_WORKER_TOKEN": "secret",
                    "MEETING_WORKER_ID": "worker-a",
                    "MEETING_WORKER_PROCESSOR": "deterministic_fixture",
                }
            )

    def test_valid_https_configuration(self) -> None:
        config = WorkerConfig.from_env(
            {
                "MEETING_WORKER_BASE_URL": "https://groundworx.internal/",
                "MEETING_WORKER_TOKEN": "secret",
                "MEETING_WORKER_ID": "worker-a",
                "MEETING_WORKER_PROCESSOR": "deterministic_fixture",
            }
        )
        self.assertEqual(config.base_url, "https://groundworx.internal")
        self.assertLess(config.heartbeat_interval_seconds, 900)

    def test_nonfinite_negative_zero_and_malformed_numbers_fail_closed(self) -> None:
        float_names = (
            "MEETING_WORKER_POLL_SECONDS",
            "MEETING_WORKER_HEARTBEAT_SECONDS",
            "MEETING_WORKER_REQUEST_TIMEOUT_SECONDS",
            "MEETING_WORKER_BACKOFF_INITIAL_SECONDS",
            "MEETING_WORKER_BACKOFF_MAX_SECONDS",
        )
        invalid_floats = ("nan", "NaN", "inf", "Infinity", "-1", "0", "+1", "1_0", "1.2.3", "1e999")
        for name in float_names:
            for value in invalid_floats:
                with self.subTest(name=name, value=value), self.assertRaises(ConfigurationError):
                    WorkerConfig.from_env(self._environment(**{name: value}))
        for name in ("MEETING_WORKER_REQUEST_ATTEMPTS", "MEETING_WORKER_MAX_MEDIA_BYTES"):
            for value in ("-1", "0", "+1", "1.0", "1_0", "not-a-number"):
                with self.subTest(name=name, value=value), self.assertRaises(ConfigurationError):
                    WorkerConfig.from_env(self._environment(**{name: value}))

    def test_numeric_maximums_fail_closed(self) -> None:
        invalid = {
            "MEETING_WORKER_POLL_SECONDS": "3600.01",
            "MEETING_WORKER_HEARTBEAT_SECONDS": "899.01",
            "MEETING_WORKER_REQUEST_TIMEOUT_SECONDS": "300.01",
            "MEETING_WORKER_REQUEST_ATTEMPTS": "11",
            "MEETING_WORKER_BACKOFF_INITIAL_SECONDS": "300.01",
            "MEETING_WORKER_BACKOFF_MAX_SECONDS": "300.01",
            "MEETING_WORKER_MAX_MEDIA_BYTES": str(2 * 1024 * 1024 * 1024 + 1),
        }
        for name, value in invalid.items():
            with self.subTest(name=name), self.assertRaises(ConfigurationError):
                WorkerConfig.from_env(self._environment(**{name: value}))

    def test_numeric_documented_bounds_are_accepted(self) -> None:
        config = WorkerConfig.from_env(
            self._environment(
                MEETING_WORKER_POLL_SECONDS="3600",
                MEETING_WORKER_HEARTBEAT_SECONDS="899",
                MEETING_WORKER_REQUEST_TIMEOUT_SECONDS="300",
                MEETING_WORKER_REQUEST_ATTEMPTS="10",
                MEETING_WORKER_BACKOFF_INITIAL_SECONDS="300",
                MEETING_WORKER_BACKOFF_MAX_SECONDS="300",
                MEETING_WORKER_MAX_MEDIA_BYTES=str(2 * 1024 * 1024 * 1024),
            )
        )
        self.assertEqual(config.backoff_max_seconds, 300)


class LoggingTests(unittest.TestCase):
    def test_worker_token_never_appears_in_logs(self) -> None:
        secret = "token-value-that-must-not-leak"
        output = StringIO()
        logger = configure_logging("INFO", (secret,), output)
        logger.info("request failed " + secret, worker_id="worker-a", transcript=secret)
        rendered = output.getvalue()
        self.assertNotIn(secret, rendered)
        payload = json.loads(rendered)
        self.assertEqual(payload["event"], "request failed [REDACTED]")
        self.assertNotIn("transcript", payload)


if __name__ == "__main__":
    unittest.main()
