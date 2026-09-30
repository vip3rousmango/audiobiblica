"""Test configuration for AudioBiblica."""

import sys
from pathlib import Path

import pytest

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

@pytest.fixture
def sample_equipment():
    """Sample equipment for testing."""
    return {
        "id": "test-001",
        "name": "Test Amplifier",
        "manufacturer": "TestCorp",
        "model": "TC-1000",
        "category": "amplifier",
    }