"""Check for a new release, and ask the updater sidecar to apply it.

Nothing here pulls an image or restarts a container. The app writes a request into
a directory shared with the updater container, which is the only process holding
the Docker socket, and reads back the progress that container writes there. So the
worst an attacker who reaches the web interface can do is ask for the update the
user's own install would take — not run anything.

The update check talks to the GitHub releases API, and only that: one request for
the newest release tag, cached on disk, and silence when it cannot be reached. The
app is expected to work offline, so a failed check is never an error the user sees.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import httpx

from src.backend.services.catalog_archive import APP_VERSION
from src.backend.services.paths import data_dir

logger = logging.getLogger(__name__)

#: Where the API reports the newest release.
RELEASES_API = "https://api.github.com/repos/vip3rousmango/audiobiblica/releases/latest"

#: How long a release check is trusted before asking GitHub again.
CHECK_TTL = timedelta(hours=6)

#: How stale the updater's heartbeat may be before the app treats it as gone.
HEARTBEAT_LIMIT = timedelta(seconds=30)


def control_dir() -> Path:
    """Directory shared with the updater container (a plain folder when running from source)."""
    return Path(os.getenv("AUDIOBIBLICA_CONTROL_DIR") or data_dir() / "update")


def _check_cache_path() -> Path:
    return data_dir() / "update-check.json"


def _pinned_version() -> Optional[str]:
    """The version the user pinned in .env, or ``None`` for the newest release."""
    version = (os.getenv("AUDIOBIBLICA_VERSION") or "").strip()
    if not version or version == "latest":
        return None
    return version


def parse_version(text: str) -> Optional[tuple[int, ...]]:
    """``v0.1.2`` → ``(0, 1, 2)``; anything without digits → ``None``."""
    cleaned = text.strip().lstrip("vV")
    parts = cleaned.split("-")[0].split(".")  # ignore a pre-release suffix
    numbers = []
    for part in parts:
        if not part.isdigit():
            return None
        numbers.append(int(part))
    return tuple(numbers) if numbers else None


def is_newer(candidate: str, current: str) -> bool:
    """True when ``candidate`` is a later version than ``current``."""
    newer, older = parse_version(candidate), parse_version(current)
    if newer is None or older is None:
        return False
    # Compare equal-length tuples: (0, 2) is not older than (0, 1, 9).
    length = max(len(newer), len(older))
    return newer + (0,) * (length - len(newer)) > older + (0,) * (length - len(older))


def _read_cache() -> Optional[dict[str, Any]]:
    try:
        cached = json.loads(_check_cache_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return cached if isinstance(cached, dict) else None


def _write_cache(payload: dict[str, Any]) -> None:
    try:
        _check_cache_path().write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError:  # pragma: no cover - a read-only data directory must not break the check
        logger.warning("Could not cache the update check", exc_info=True)


def cached_release() -> Optional[dict[str, Any]]:
    """The last release check that was stored, or ``None``. Never touches the network."""
    return _read_cache()


async def latest_release(force: bool = False) -> Optional[dict[str, Any]]:
    """The newest published release, cached for :data:`CHECK_TTL`.

    Returns ``None`` when GitHub cannot be reached and nothing is cached — an
    offline machine simply has nothing to say about updates.
    """
    cached = _read_cache()
    if cached and not force:
        checked_at = cached.get("checked_at")
        try:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(str(checked_at))
        except (TypeError, ValueError):
            age = CHECK_TTL
        if age < CHECK_TTL:
            return cached

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(6.0, connect=4.0)) as client:
            response = await client.get(RELEASES_API, headers={"Accept": "application/vnd.github+json"})
            response.raise_for_status()
            release = response.json()
    except (httpx.HTTPError, ValueError) as error:
        logger.info("Update check skipped: %s", error)
        return cached  # stale information beats no information, and never an error

    payload = {
        "version": str(release.get("tag_name", "")).lstrip("vV"),
        "name": release.get("name") or release.get("tag_name"),
        "url": release.get("html_url"),
        "published_at": release.get("published_at"),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
    _write_cache(payload)
    return payload


def read_updater_status() -> Optional[dict[str, Any]]:
    """What the updater container last reported, or ``None`` when there is none."""
    try:
        status = json.loads((control_dir() / "status.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return status if isinstance(status, dict) else None


def updater_alive(status: Optional[dict[str, Any]]) -> bool:
    """Whether the updater wrote its heartbeat recently enough to trust."""
    if not status:
        return False
    try:
        beat = datetime.fromisoformat(str(status.get("heartbeat")))
    except (TypeError, ValueError):
        return False
    if beat.tzinfo is None:
        beat = beat.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - beat < HEARTBEAT_LIMIT


def can_update() -> tuple[bool, Optional[str]]:
    """Whether an update can be applied here, and if not, why — in plain words."""
    pinned = _pinned_version()
    if pinned:
        return False, (
            f"This copy is pinned to version {pinned}, so AudioBiblica will not change it. "
            "Remove AUDIOBIBLICA_VERSION from your .env file to receive updates again."
        )
    if not updater_alive(read_updater_status()):
        return False, (
            "The updater is not running, so AudioBiblica cannot restart itself. "
            "Start the app with ./scripts/audiobiblica to get it back."
        )
    return True, None


def request_update(target: Optional[str] = None) -> dict[str, Any]:
    """Ask the updater to install a version. The updater claims the file itself."""
    directory = control_dir()
    directory.mkdir(parents=True, exist_ok=True)
    request = {
        "target": target or "latest",
        "requested_at": datetime.now(timezone.utc).isoformat(),
        "current": APP_VERSION,
    }
    # Written through a temporary file so the updater never reads a half-written
    # request and starts pulling on a truncated document.
    temporary = directory / "request.json.tmp"
    temporary.write_text(json.dumps(request), encoding="utf-8")
    temporary.replace(directory / "request.json")
    logger.info("Update requested: %s (running %s)", request["target"], APP_VERSION)
    return request


def update_status_payload(release: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Everything the interface needs to describe and offer an update."""
    allowed, reason = can_update()
    latest = (release or {}).get("version") or None
    status = read_updater_status()
    alive = updater_alive(status)
    state = str((status or {}).get("state") or "idle")
    return {
        "current": APP_VERSION,
        "latest": latest,
        "update_available": bool(latest and is_newer(latest, APP_VERSION)),
        "release_url": (release or {}).get("url"),
        "published_at": (release or {}).get("published_at"),
        "pinned_version": _pinned_version(),
        "can_update": allowed,
        "reason": reason,
        "updater": {
            "alive": alive,
            "state": state if alive else "absent",
            "message": (status or {}).get("message") or "",
            "target": (status or {}).get("target") or None,
            "started_at": (status or {}).get("started_at") or None,
            "finished_at": (status or {}).get("finished_at") or None,
            "in_progress": alive and state in {"pulling", "recreating"},
            "failed": alive and state == "error",
        },
    }
