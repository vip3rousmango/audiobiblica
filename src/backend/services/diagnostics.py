"""The app's own health report.

Nothing here repairs anything: it reports what is wrong, and where a fix is
possible it names the one action that fixes it, so the interface can offer a
button instead of an instruction. Every check is deterministic — no model is
consulted — because a health report has to be trustworthy before it is helpful.
"""

from __future__ import annotations

import os
import platform
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from src.backend.config import get_config
from src.backend.services.catalog_archive import APP_VERSION
from src.backend.services.paths import (
    BACKUP_STALE_DAYS,
    backup_created_at,
    catalog_state,
    data_dir,
    database_path,
    list_backups,
    newest_usable_backup,
    recent_log_lines,
)
from src.backend.services.storage import get_storage


def _backup_entries(limit: int = 5) -> list[dict]:
    entries = []
    for path in list_backups()[:limit]:
        try:
            size_bytes = path.stat().st_size
        except OSError:
            continue
        entries.append({
            "name": path.name,
            "created_at": backup_created_at(path),
            "size_bytes": size_bytes,
        })
    return entries


def _missing_manual_files() -> Optional[int]:
    """How many stored PDFs a stored manual points at but that are gone.

    ``None`` when the catalog cannot be read, which is not the same as zero: the
    check reports "could not look" rather than claiming the files are fine.
    """
    try:
        storage = get_storage()
        missing = 0
        for item in storage.list_equipment():
            for stored_path in storage.get_manual_document_paths(item.id):
                if not stored_path:
                    continue
                if not Path(stored_path).exists():
                    missing += 1
        return missing
    except sqlite3.Error:
        return None


def _update_check(update: Optional[dict]) -> dict:
    """Say which version is running, and offer the update when it can be applied."""
    if not update:
        return {
            "id": "update",
            "level": "ok",
            "title": "Version",
            "detail": "AudioBiblica has not checked for a newer version yet. Open this screen from a connected machine, or use the Update notice on the Overview.",
            "fix": None,
        }
    updater = update.get("updater") or {}
    if updater.get("failed"):
        return {
            "id": "update",
            "level": "fail",
            "title": "The last update did not finish",
            "detail": f"{updater.get('message') or 'The update stopped part way.'} AudioBiblica is still running version {update['current']}. Run ./scripts/audiobiblica to try again.",
            "fix": None,
        }
    if updater.get("in_progress"):
        return {
            "id": "update",
            "level": "warn",
            "title": f"Updating to {updater.get('target') or 'the newest version'}",
            "detail": updater.get("message") or "AudioBiblica is downloading and restarting. This page will reload itself.",
            "fix": None,
        }
    if not update.get("update_available"):
        latest = update.get("latest")
        return {
            "id": "update",
            "level": "ok",
            "title": "Up to date",
            "detail": (
                f"You are running version {update['current']}, the newest published version."
                if latest
                else f"You are running version {update['current']}. No newer version is known (this check needs an internet connection)."
            ),
            "fix": None,
        }
    latest = update.get("latest")
    if update.get("can_update"):
        return {
            "id": "update",
            "level": "warn",
            "title": f"Version {latest} is available",
            "detail": f"You are running {update['current']}. Updating takes about a minute; your catalog is copied first and the app restarts itself.",
            "fix": {"kind": "update", "label": f"Update to {latest}"},
        }
    return {
        "id": "update",
        "level": "warn",
        "title": f"Version {latest} is available",
        "detail": f"You are running {update['current']}. {update.get('reason') or ''}",
        "fix": None,
    }


def _catalog_check(state: str) -> dict:
    if state == "ok":
        return {
            "id": "catalog",
            "level": "ok",
            "title": "Your catalog opens",
            "detail": f"AudioBiblica read the catalog at {database_path()} and its contents are consistent.",
            "fix": None,
        }
    fix = None
    if state == "damaged":
        snapshot = newest_usable_backup()
        if snapshot is not None:
            fix = {"kind": "restore", "label": "Restore the newest backup", "name": snapshot.name}
    detail = {
        "damaged": "The catalog at {path} is damaged, so nothing can be read from it. Restoring a copy replaces it with the last one that still opened.",
        "blocked": "The catalog at {path} could not be opened at all. Check the file's permissions and ownership, then start AudioBiblica again.",
        "missing": "There is no catalog at {path} yet. One is created the first time you add equipment.",
    }.get(state, "The catalog at {path} is not usable.")
    return {
        "id": "catalog",
        "level": "fail" if state == "damaged" else "warn",
        "title": "Your catalog needs attention",
        "detail": detail.format(path=database_path()),
        "fix": fix,
    }


def _backups_check(entries: list[dict], state: str) -> dict:
    if state != "ok":
        # Nothing can be copied from a catalog that cannot be read, so offering
        # "Back up now" here would only produce a second failure to explain.
        return {
            "id": "backups",
            "level": "warn",
            "title": "Backups are paused",
            "detail": "AudioBiblica cannot copy a catalog it cannot read. Fix the catalog first and its copies resume on the next start.",
            "fix": None,
        }
    if not entries:
        return {
            "id": "backups",
            "level": "warn",
            "title": "No catalog copies yet",
            "detail": "AudioBiblica takes its own copies of your catalog, but has not made one yet. Take one now so there is something to fall back on.",
            "fix": {"kind": "backup_now", "label": "Back up now"},
        }
    newest = entries[0]
    try:
        taken: Optional[datetime] = datetime.fromisoformat(newest["created_at"])
    except ValueError:
        taken = None
    if taken is not None and datetime.now(timezone.utc) - taken > timedelta(days=BACKUP_STALE_DAYS):
        return {
            "id": "backups",
            "level": "warn",
            "title": "Your newest copy is old",
            "detail": f"The newest copy of your catalog was taken on {taken.date().isoformat()}. Take a fresh one now.",
            "fix": {"kind": "backup_now", "label": "Back up now"},
        }
    return {
        "id": "backups",
        "level": "ok",
        "title": "Your catalog is backed up",
        "detail": f"The newest copy is {newest['name']}, taken on {newest['created_at'][:10]}.",
        "fix": None,
    }


def _assistant_runtime_check(assistant: dict) -> dict:
    if assistant["reachable"]:
        return {
            "id": "assistant_runtime",
            "level": "ok",
            "title": "The assistant is answering",
            "detail": f"AudioBiblica reached the {assistant['runtime']} assistant at its configured address.",
            "fix": None,
        }
    return {
        "id": "assistant_runtime",
        "level": "warn",
        "title": "The assistant is not answering",
        "detail": assistant["error"] or "The assistant could not be reached at its configured address.",
        "fix": {"kind": "open_settings", "section": "advanced", "label": "Open Advanced settings"},
    }


def _assistant_model_check(assistant: dict) -> dict:
    model = assistant["model"]
    if assistant["reachable"] and not assistant["model_available"]:
        return {
            "id": "assistant_model",
            "level": "warn",
            "title": "The chosen model is not installed",
            "detail": f"The assistant answered, but {model} is not among the models it serves, so it cannot reply until that model is downloaded.",
            "fix": {"kind": "download_model", "label": f"Download {model}", "model": model},
        }
    if not assistant["reachable"]:
        return {
            "id": "assistant_model",
            "level": "warn",
            "title": "Cannot check the model while the assistant is unreachable",
            "detail": f"AudioBiblica could not ask which models are installed, so it cannot say whether {model} is there.",
            "fix": {"kind": "open_settings", "section": "advanced", "label": "Open Advanced settings"},
        }
    return {
        "id": "assistant_model",
        "level": "ok",
        "title": "The chosen model is installed",
        "detail": f"{model} is available to the assistant.",
        "fix": None,
    }


def _manual_files_check(missing: Optional[int]) -> dict:
    if missing is None:
        return {
            "id": "manual_files",
            "level": "warn",
            "title": "Cannot check your imported PDFs",
            "detail": "The catalog could not be read, so AudioBiblica cannot tell which manual files are still on disk. Fix the catalog first and check again.",
            "fix": None,
        }
    if missing == 0:
        return {
            "id": "manual_files",
            "level": "ok",
            "title": "Your imported PDFs are on disk",
            "detail": "Every manual PDF you imported is still where AudioBiblica stored it.",
            "fix": None,
        }
    if missing == 1:
        detail = "1 imported manual file is no longer on disk, so its searchable text cannot be rebuilt. Import that PDF again to fix it."
    else:
        detail = f"{missing} imported manual files are no longer on disk, so their searchable text cannot be rebuilt. Import those PDFs again to fix it."
    return {
        "id": "manual_files",
        "level": "warn",
        "title": "Some imported PDFs are missing",
        "detail": detail,
        "fix": None,
    }


def collect_diagnostics(
    recovery: Optional[dict], assistant: dict, counts: Optional[dict], update: Optional[dict] = None
) -> dict:
    """Everything needed to explain what is wrong, in one JSON object.

    The caller already knows the assistant state and the catalog counts, so they
    are passed in rather than probed here — this module stays free of the web app.
    ``counts`` is ``None`` when the catalog could not be read, which is reported as
    unknown rather than as an empty catalog.
    """
    state = catalog_state(database_path())
    backups = _backup_entries()
    checks = [
        _catalog_check(state),
        _backups_check(backups, state),
        _assistant_runtime_check(assistant),
        _assistant_model_check(assistant),
        _manual_files_check(_missing_manual_files()),
        _update_check(update),
    ]
    config = get_config()
    return {
        "app_version": APP_VERSION,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "data_dir": str(data_dir()),
        "database_path": str(database_path()),
        "database_state": state,
        "catalog_recovery": recovery,
        # Always the same three keys: the interface renders "unknown" for nulls,
        # so an unreadable catalog degrades one field instead of the whole report.
        "counts": counts or {"equipment": None, "manuals": None, "findings": None},
        "backups": backups,
        "assistant": {
            "runtime": assistant["runtime"],
            "provider": assistant["provider"],
            "model": assistant["model"],
            "reachable": assistant["reachable"],
            "model_available": assistant["model_available"],
            "error": assistant["error"],
        },
        "research": {
            "firecrawl_configured": bool(config.firecrawl_api_key or os.getenv("FIRECRAWL_API_KEY")),
            "free_fetch": True,
        },
        "checks": checks,
        "recent_errors": recent_log_lines(40),
    }
