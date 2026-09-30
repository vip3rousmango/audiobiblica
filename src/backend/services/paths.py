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
import sqlite3
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

#: Number of catalog snapshots kept in ``backups/``.
BACKUP_LIMIT = 10

#: Rotation settings for the app log (four files of 256 KiB at most).
LOG_MAX_BYTES = 262144
LOG_BACKUP_COUNT = 3

#: A snapshot older than this many days is worth warning about.
BACKUP_STALE_DAYS = 7


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


def log_path() -> Path:
    """Rolling application log, beside the catalog."""
    return data_dir() / "audiobiblica.log"


def configure_logging() -> None:
    """Send the app's own logs to a rotating file in the data directory.

    Called once per process at startup. A second call is a no-op, so a lifespan
    that runs twice cannot attach the same handler twice.
    """
    root = logging.getLogger()
    if any(isinstance(handler, RotatingFileHandler) for handler in root.handlers):
        return
    directory = data_dir()
    directory.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        log_path(), maxBytes=LOG_MAX_BYTES, backupCount=LOG_BACKUP_COUNT, encoding="utf-8"
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root.addHandler(handler)
    root.setLevel(logging.INFO)


def recent_log_lines(limit: int = 40) -> list[str]:
    """The last ``limit`` lines of the app log, oldest first. Empty when there is none."""
    try:
        content = log_path().read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    lines = content.splitlines()
    return lines[-limit:]


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


def catalog_state(path: Path) -> str:
    """One of ``"missing"``, ``"ok"``, ``"damaged"`` or ``"blocked"``.

    ``"blocked"`` means the file could not be opened at all — permissions, a lock
    held elsewhere — so it may be perfectly good and must never be treated as
    damage. Anything that opens but fails SQLite's own consistency check is
    damage.
    """
    if not path.exists():
        return "missing"
    try:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2.0)
        try:
            result = connection.execute("PRAGMA quick_check").fetchone()
        finally:
            connection.close()
    except sqlite3.OperationalError as error:
        text = str(error).lower()
        if "malformed" in text or "not a database" in text:
            return "damaged"
        logger.warning("Could not open catalog %s: %s", path, error)
        return "blocked"
    except sqlite3.DatabaseError as error:
        logger.warning("Catalog %s failed its integrity check: %s", path, error)
        return "damaged"
    if result is not None and result[0] == "ok":
        return "ok"
    return "damaged"


def quarantine_database() -> Optional[Path]:
    """Rename the catalog aside. Never deletes. Returns the new path."""
    source = database_path()
    if not source.is_file():
        return None
    # Moments matter here: a container that restart-loops quarantines a file on
    # every attempt, and two within the same second must not overwrite each other
    # — the earlier one is the user's only copy of that data.
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y%m%d-%H%M%S") + f"-{now.microsecond // 1000:03d}"
    destination = data_dir() / f"audiobiblica-broken-{stamp}.db"
    attempt = 1
    while destination.exists():
        destination = data_dir() / f"audiobiblica-broken-{stamp}-{attempt}.db"
        attempt += 1
    try:
        source.replace(destination)
    except OSError as error:  # a read-only directory: keep the original, copy instead
        logger.warning("Could not move %s aside (%s); copying it to %s", source, error, destination)
        shutil.copy2(source, destination)
    return destination


def _copy_database(source: Path, destination: Path) -> None:
    """Write a consistent copy of ``source`` into ``destination`` using SQLite itself.

    ``shutil.copy2`` omits the rollback journal, so a copy taken while a write is
    in flight can be a torn database that no longer opens — the very failure the
    snapshots exist to recover from. SQLite's backup API produces a
    transactionally consistent file. Do not "simplify" this back to a file copy.
    """
    source_connection = sqlite3.connect(str(source))
    destination_connection = sqlite3.connect(str(destination))
    try:
        source_connection.backup(destination_connection)
    finally:
        destination_connection.close()
        source_connection.close()


def replace_catalog_with(snapshot: Path) -> None:
    """Put ``snapshot`` in place of the live catalog.

    The snapshot is written *into* the existing file through SQLite rather than
    renamed over the path: live connections hold the inode, and replacing the
    path would leave them writing to a file nothing else can see.

    A catalog that is no longer a database has to be moved aside first — SQLite's
    backup API refuses to write into a file it cannot read. That is never a loss:
    the file was already unreadable, and it is kept, not deleted.
    """
    live = database_path()
    if live.exists() and catalog_state(live) != "ok":
        quarantine_database()
    _copy_database(snapshot, live)


def newest_usable_backup() -> Optional[Path]:
    """The newest snapshot that still opens, or ``None`` when there is none."""
    for candidate in list_backups():
        if catalog_state(candidate) == "ok":
            return candidate
    return None


def recover_catalog() -> Optional[dict]:
    """Repair what can be repaired at startup, or say what happened.

    Returns ``None`` when the catalog was missing or healthy. A damaged catalog
    is moved aside — never deleted — and the newest usable snapshot takes its
    place. An unreadable file is reported as an error instead, because moving a
    file we could not even open would destroy the user's data for nothing.
    """
    path = database_path()
    state = catalog_state(path)
    if state in {"missing", "ok"}:
        return None
    if state == "blocked":
        raise RuntimeError(
            f"AudioBiblica cannot read the catalog at {path}. Check the file's "
            "permissions and ownership, then start again. Nothing was changed."
        )
    broken = quarantine_database()
    snapshot = newest_usable_backup()
    at = datetime.now(timezone.utc).isoformat()
    if snapshot is not None:
        replace_catalog_with(snapshot)
        logger.warning("Catalog was damaged; restored %s, kept the damaged file at %s", snapshot.name, broken)
        return {"action": "restored", "broken_file": str(broken), "restored_from": snapshot.name, "at": at}
    logger.warning("Catalog was damaged and no usable snapshot exists; kept it at %s", broken)
    return {"action": "started_empty", "broken_file": str(broken), "restored_from": None, "at": at}


def backup_database() -> Optional[Path]:
    """Snapshot the catalog beside it, keeping the :data:`BACKUP_LIMIT` newest copies.

    Returns the snapshot path, or ``None`` when there is no catalog yet (a fresh
    install has nothing to protect).
    """
    source = database_path()
    if not source.is_file():
        return None
    target_dir = backups_dir()
    if catalog_state(source) != "ok":
        # Copying a file SQLite cannot read would either fail or, worse, store a
        # torn snapshot that looks like a safety net. Say so and keep the good ones.
        logger.warning("Not snapshotting %s: it cannot be read", source)
        return None
    target_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y%m%d-%H%M%S") + f"-{now.microsecond // 1000:03d}"
    destination = target_dir / f"audiobiblica-{stamp}.db"
    _copy_database(source, destination)
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

    The copy keeps the source file's mtime, so ``stat()`` would report when the
    catalog was last written rather than when the snapshot was made. Names carry
    milliseconds since this release; snapshots from before it do not.
    """
    stamp = path.stem.removeprefix("audiobiblica-")
    for fmt in ("%Y%m%d-%H%M%S-%f", "%Y%m%d-%H%M%S"):
        try:
            return datetime.strptime(stamp, fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()


def _prune_backups() -> None:
    for stale in list_backups()[BACKUP_LIMIT:]:
        try:
            stale.unlink()
        except OSError:  # pragma: no cover - a locked snapshot must not break startup
            logger.warning("Could not remove old backup %s", stale)
