from __future__ import annotations

import ast
from pathlib import Path
import unittest


PACKAGE = Path(__file__).resolve().parents[1] / "meeting_worker"


class BoundaryTests(unittest.TestCase):
    def test_runtime_has_no_inbound_listener(self) -> None:
        forbidden_calls = {"bind", "listen", "serve_forever", "run_server"}
        for path in PACKAGE.glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            calls = {
                node.func.attr
                for node in ast.walk(tree)
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            }
            self.assertTrue(forbidden_calls.isdisjoint(calls), f"inbound listener call found in {path.name}")

    def test_runtime_has_no_external_provider_reference(self) -> None:
        forbidden = ("assembly" + "ai", "open" + "ai", "anthropic")
        runtime = "\n".join(path.read_text(encoding="utf-8").lower() for path in PACKAGE.glob("*.py"))
        for value in forbidden:
            self.assertNotIn(value, runtime)

    def test_runtime_has_no_legacy_pipeline_dependency(self) -> None:
        forbidden = ("sidecar.services", "gpu-worker", "whisperx_server", "meeting.status")
        runtime = "\n".join(path.read_text(encoding="utf-8").lower() for path in PACKAGE.glob("*.py"))
        for value in forbidden:
            self.assertNotIn(value, runtime)


if __name__ == "__main__":
    unittest.main()
