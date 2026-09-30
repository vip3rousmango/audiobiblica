"""The update check and the request the app hands to the updater.

The container-swapping part cannot be tested without Docker, so it is not tested
here. What is tested is everything that decides *whether* to swap: version
comparison (which is easy to get subtly wrong), the guards that refuse an update
that cannot or should not happen, and the request file itself — the one artifact
that crosses from this process into the updater container.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from src.backend.services import updater  # noqa: E402


@pytest.fixture
def control_dir(monkeypatch, tmp_path):
    """A control directory standing in for the volume shared with the updater."""
    directory = tmp_path / "control"
    directory.mkdir()
    monkeypatch.setenv("AUDIOBIBLICA_CONTROL_DIR", str(directory))
    monkeypatch.delenv("AUDIOBIBLICA_VERSION", raising=False)
    return directory


def write_heartbeat(directory: Path, state: str = "idle", message: str = "No update running.", age_seconds: int = 0) -> None:
    beat = datetime.now(timezone.utc) - timedelta(seconds=age_seconds)
    (directory / "status.json").write_text(
        json.dumps({
            "state": state,
            "message": message,
            "target": "",
            "started_at": "",
            "finished_at": "",
            "heartbeat": beat.isoformat(),
        }),
        encoding="utf-8",
    )


@pytest.mark.parametrize(("candidate", "current", "expected"), [
    ("0.1.1", "0.1.0", True),
    ("0.1.0", "0.1.0", False),
    ("v0.2.0", "0.1.9", True),
    ("1.0.0", "0.9.9", True),
    ("0.1.0", "0.2.0", False),
    ("0.2.0", "0.2", False),      # equal, written differently
    ("0.2.1", "0.2", True),
    ("0.1.0-rc1", "0.1.0", False),  # a pre-release of the same version is not newer
    ("garbage", "0.1.0", False),    # unparseable is never "newer"
])
def test_version_comparison(candidate, current, expected):
    assert updater.is_newer(candidate, current) is expected


def test_parse_version_reads_tags():
    assert updater.parse_version("v1.2.3") == (1, 2, 3)
    assert updater.parse_version("0.10") == (0, 10)
    assert updater.parse_version("nonsense") is None


def test_no_updater_means_no_update(control_dir):
    """Without a heartbeat, the app must say why rather than offer a dead button."""
    can, reason = updater.can_update()
    assert can is False
    assert reason and "updater is not running" in reason


def test_stale_heartbeat_is_not_alive(control_dir):
    """A container that stopped writing is gone, however recently we last saw it."""
    write_heartbeat(control_dir, age_seconds=120)
    assert updater.updater_alive(updater.read_updater_status()) is False


def test_fresh_heartbeat_allows_an_update(control_dir):
    write_heartbeat(control_dir)
    assert updater.can_update() == (True, None)


def test_pinned_install_refuses_to_change_itself(control_dir, monkeypatch):
    write_heartbeat(control_dir)
    monkeypatch.setenv("AUDIOBIBLICA_VERSION", "0.1.0")
    can, reason = updater.can_update()
    assert can is False
    assert reason and "pinned to version 0.1.0" in reason


def test_request_is_written_atomically(control_dir):
    request = updater.request_update("latest")
    written = json.loads((control_dir / "request.json").read_text(encoding="utf-8"))
    assert written["target"] == "latest"
    assert written["current"] == request["current"]
    # The temporary file must not be left behind for the updater to find.
    assert not (control_dir / "request.json.tmp").exists()


def test_status_payload_reports_availability(control_dir):
    write_heartbeat(control_dir)
    payload = updater.update_status_payload({"version": "0.2.0", "url": "https://example.invalid/release"})
    assert payload["update_available"] is True
    assert payload["can_update"] is True
    assert payload["latest"] == "0.2.0"
    assert payload["updater"]["alive"] is True
    assert payload["updater"]["in_progress"] is False


def test_status_payload_without_a_release(control_dir):
    """Offline: nothing is known, so nothing is promised."""
    write_heartbeat(control_dir)
    payload = updater.update_status_payload(None)
    assert payload["latest"] is None
    assert payload["update_available"] is False


def test_start_refuses_when_up_to_date(client, control_dir, monkeypatch):
    write_heartbeat(control_dir)
    monkeypatch.setattr(updater, "_read_cache", lambda: {"version": updater.APP_VERSION, "checked_at": datetime.now(timezone.utc).isoformat()})
    response = client.post("/api/v1/update/start", json={})
    assert response.status_code == 409
    assert "up to date" in response.json()["detail"]
    assert not (control_dir / "request.json").exists()


def test_start_refuses_without_an_updater(client, control_dir, monkeypatch):
    monkeypatch.setattr(updater, "_read_cache", lambda: {"version": "9.9.9", "checked_at": datetime.now(timezone.utc).isoformat()})
    response = client.post("/api/v1/update/start", json={})
    assert response.status_code == 409
    assert "updater is not running" in response.json()["detail"]


def test_start_writes_a_request_when_it_can(client, control_dir, monkeypatch):
    write_heartbeat(control_dir)
    monkeypatch.setattr(updater, "_read_cache", lambda: {"version": "9.9.9", "checked_at": datetime.now(timezone.utc).isoformat()})
    response = client.post("/api/v1/update/start", json={})
    assert response.status_code == 200
    assert response.json() == {"status": "requested", "target": "9.9.9"}
    request = json.loads((control_dir / "request.json").read_text(encoding="utf-8"))
    assert request["target"] == "latest"       # the updater pulls :latest, not this tag
    assert request["current"] == updater.APP_VERSION


def test_status_endpoint_never_fails_offline(client, control_dir, monkeypatch):
    """The endpoint is what the interface polls during a restart: it must answer."""
    monkeypatch.setattr(updater, "_read_cache", lambda: None)
    async def no_network(force: bool = False):
        return None
    monkeypatch.setattr("src.backend.main.latest_release", no_network)
    response = client.get("/api/v1/update/status")
    assert response.status_code == 200
    body = response.json()
    assert body["current"] == updater.APP_VERSION
    assert body["latest"] is None
    assert body["update_available"] is False


def test_diagnostics_carries_the_update_check(client, control_dir):
    write_heartbeat(control_dir)
    report = client.get("/api/v1/diagnostics").json()
    ids = [check["id"] for check in report["checks"]]
    assert "update" in ids
    update_check = next(check for check in report["checks"] if check["id"] == "update")
    assert update_check["level"] in {"ok", "warn", "fail"}
    assert update_check["title"] and update_check["detail"]
