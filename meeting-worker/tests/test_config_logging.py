from __future__ import annotations

from io import StringIO
import json
import unittest

from meeting_worker.config import ConfigurationError, WorkerConfig
from meeting_worker.logging_utils import configure_logging


class ConfigTests(unittest.TestCase):
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
