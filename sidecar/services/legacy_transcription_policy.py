"""Fail-closed environment policy for the legacy transcription pipeline."""

import os
from collections.abc import Mapping


LEGACY_TRANSCRIPTION_GATE = "LEGACY_TRANSCRIPTION_ENABLED"
LEGACY_TRANSCRIPTION_EXTERNAL_GATE = "LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED"


def _explicitly_enabled(environment: Mapping[str, str], name: str) -> bool:
    """Only the exact lower-case literal ``true`` grants permission."""
    return environment.get(name) == "true"


def legacy_transcription_enabled(
    environment: Mapping[str, str] | None = None,
) -> bool:
    return _explicitly_enabled(
        os.environ if environment is None else environment,
        LEGACY_TRANSCRIPTION_GATE,
    )


def external_transcription_enabled(
    environment: Mapping[str, str] | None = None,
) -> bool:
    return _explicitly_enabled(
        os.environ if environment is None else environment,
        LEGACY_TRANSCRIPTION_EXTERNAL_GATE,
    )
