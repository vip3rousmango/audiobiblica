"""Filesystem locations for the user's catalog, configuration and backups.

Every path the app writes to at runtime resolves through this module, so a single
environment variable (``AUDIOBIBLICA_DATA_DIR``) relocates the whole catalog, and
so that a fresh install never writes into the source tree.

The per-item overrides from earlier releases keep precedence, which means an
existing install that already set ``AUDIOBIBLICA_DB_PATH`` is unaffected.
"""

from __future__ import annotations

import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

#: Number of catalog snapshots kept in ``backups/``.
BACKUP_LIMIT = 10


def data_dir() -> Path:
    """Root directory holding the catalog, config, manuals and backups."""
    return Path(os.getenv("AUDIOBIBLICA_DATA_DIR") or Path.home() / ".audiobiblica")


def database_path() -> Path:
    """SQLite catalog file."""
    return Path(os.getenv("AUDIOBIBLICA_DB_PATH") or data_dir() / "audiobiblica.db")


def config_path() -> Path:
    """JSON settings file (assistant provider, API keys, endpoints)."""
    return Path(os.getenv("AUDIOBIBLICA_CONFIG_PATH") or data_dir() / "config.json")


def manuals_dir() -> Path:
    """Uploaded manual PDFs, named by manual id."""
    return Path(os.getenv("AUDIOBIBLICA_MANUAL_DIR") or data_dir() / "manuals")


def backups_dir() -> Path:
    """Directory holding automatic catalog snapshots."""
    return data_dir() / "backups"


def migrate_legacy_database() -> Optional[Path]:
    """Adopt a ``./audiobiblica.db`` left in the working directory by an old release.

    Returns the destination path when a catalog was copied, otherwise ``None``.
    The source is left in place and never deleted: a user who prefers the old
    location can keep using it through ``AUDIOBIBLICA_DB_PATH``.
    """
    destination = database_path()
    legacy = Path.cwd() / "audiobiblica.db"
    if destination.exists() or not legacy.is_file():
        return None
    if legacy.resolve() == destination.resolve():
        return None
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(legacy, destination)
    logger.info("Moved existing catalog to %s", destination)
    return destination


def backup_database() -> Optional[Path]:
    """Snapshot the catalog beside it, keeping the :data:`BACKUP_LIMIT` newest copies.

    Returns the snapshot path, or ``None`` when there is no catalog yet (a fresh
    install has nothing to protect).
    """
    source = database_path()
    if not source.is_file():
        return None
    target_dir = backups_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    destination = target_dir / f"audiobiblica-{stamp}.db"
    shutil.copy2(source, destination)
    _prune_backups()
    logger.info("Backed up catalog to %s", destination)
    return destination


def list_backups() -> list[Path]:
    """Catalog snapshots, newest first."""
    target_dir = backups_dir()
    if not target_dir.is_dir():
        return []
    return sorted(target_dir.glob("audiobiblica-*.db"), key=lambda item: item.name, reverse=True)


def backup_created_at(path: Path) -> str:
    """ISO-8601 UTC time a snapshot was taken, read from its name.

    ``shutil.copy2`` keeps the source file's mtime, so ``stat()`` would report
    when the catalog was last written rather than when the snapshot was made.
    """
    try:
        stamp = path.stem.removeprefix("audiobiblica-")
        return datetime.strptime(stamp, "%Y%m%d-%H%M%S").replace(tzinfo=timezone.utc).isoformat()
    except ValueError:
        return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()


def _prune_backups() -> None:
    for stale in list_backups()[BACKUP_LIMIT:]:
        try:
            stale.unlink()
        except OSError:  # pragma: no cover - a locked snapshot must not break startup
            logger.warning("Could not remove old backup %s", stale)
