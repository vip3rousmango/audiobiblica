"""Shared test configuration for AudioBiblica.

Two things live here because more than one test module needs them: the data paths
every module must agree on, and a single HTTP client for the whole suite.

The client is session-scoped for a real reason, not for speed: routes are
registered on the module-level app by decorators, and the MCP streamable-HTTP
session manager can only be run once per instance, so a second module creating its
own client fails with "StreamableHTTPSessionManager .run() can only be called once".
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

#: One scratch data directory for every module: importing the app binds these.
_TMP = Path(tempfile.mkdtemp(prefix="audiobiblica-tests-"))
os.environ.setdefault("AUDIOBIBLICA_DB_PATH", str(_TMP / "app.db"))
os.environ.setdefault("AUDIOBIBLICA_CONFIG_PATH", str(_TMP / "config.json"))
os.environ.setdefault("AUDIOBIBLICA_MANUAL_DIR", str(_TMP / "manuals"))
os.environ.setdefault("AUDIOBIBLICA_PHOTO_DIR", str(_TMP / "photos"))


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from src.backend.main import app

    # The client address matters: the app only trusts loopback without a pairing
    # token, and the test client's default address is not loopback.
    with TestClient(app, base_url="http://127.0.0.1:8000", client=("127.0.0.1", 51234)) as test_client:
        yield test_client


@pytest.fixture
def sample_equipment():
    """Sample equipment payload, for tests that only need a shape."""
    return {
        "id": "test-001",
        "name": "Test Amplifier",
        "manufacturer": "TestCorp",
        "model": "TC-1000",
        "category": "amplifier",
    }
