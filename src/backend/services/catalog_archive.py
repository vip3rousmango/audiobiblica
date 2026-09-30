"""Export and restore the whole catalog as one ZIP.

Written for the person who cannot afford to lose their studio inventory. The
archive holds a manifest, every equipment record (with its manuals and research
findings) and every imported PDF, so a catalog can be moved to another machine
or recovered after a mistake.
"""

from __future__ import annotations

import io
import json
import sqlite3
import zipfile
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from src.backend.models.equipment import Equipment, Manual
from src.backend.services.paths import manuals_dir
from src.backend.services.storage import Storage

#: Bumped only when the archive layout changes in a way import must understand.
SCHEMA_VERSION = 1
#: Kept in step with ``pyproject.toml``.
APP_VERSION = "0.1.1"

#: The one message a user sees for any unreadable file.
NOT_OURS = "This file wasn't exported by AudioBiblica."


class CatalogArchiveError(ValueError):
    """The uploaded file is not a catalog archive this version can read."""


def build_archive(storage: Storage) -> bytes:
    """Return a ZIP holding the manifest, the catalog, and every stored PDF."""
    records: list[dict] = []
    manual_total = 0
    finding_total = 0

    for item in storage.list_equipment():
        record = asdict(item)
        manuals = []
        for manual in record.get("manuals") or []:
            entry = dict(manual)
            document = storage.get_manual_document(str(entry.get("id") or ""))
            if document is not None:
                entry["document_text"] = document.content_text
                entry["document_file_name"] = document.file_name
                entry["document_path"] = document.file_path
            manuals.append(entry)
        record["manuals"] = manuals
        record["research_findings"] = list(record.get("research_findings") or [])
        manual_total += len(manuals)
        finding_total += len(record["research_findings"])
        records.append(record)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "manifest.json",
            json.dumps(
                {
                    "schema_version": SCHEMA_VERSION,
                    "exported_at": datetime.now(timezone.utc).isoformat(),
                    "app_version": APP_VERSION,
                    "counts": {
                        "equipment": len(records),
                        "manuals": manual_total,
                        "findings": finding_total,
                    },
                },
                indent=2,
            ),
        )
        archive.writestr("catalog.json", json.dumps(records, indent=2))
        for record in records:
            for manual in record["manuals"]:
                source = manual.get("document_path")
                if source and Path(source).is_file():
                    archive.write(source, f"manuals/{manual['id']}.pdf")

    return buffer.getvalue()


def restore_archive(storage: Storage, raw: bytes) -> dict[str, int]:
    """Merge an archive into the catalog, reporting what changed."""
    counts = {
        "equipment_added": 0,
        "equipment_updated": 0,
        "manuals_added": 0,
        "findings_added": 0,
        "skipped": 0,
    }
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = set(archive.namelist())
            if {"manifest.json", "catalog.json"} - names:
                raise CatalogArchiveError(NOT_OURS)
            try:
                manifest = json.loads(archive.read("manifest.json"))
                records = json.loads(archive.read("catalog.json"))
            except (ValueError, KeyError) as exc:
                raise CatalogArchiveError(NOT_OURS) from exc
            if not isinstance(manifest, dict) or manifest.get("schema_version") != SCHEMA_VERSION:
                raise CatalogArchiveError(NOT_OURS)
            if not isinstance(records, list):
                raise CatalogArchiveError(NOT_OURS)
            for record in records:
                _restore_record(storage, archive, names, record, counts)
    except zipfile.BadZipFile as exc:
        raise CatalogArchiveError(NOT_OURS) from exc
    return counts


def _restore_record(
    storage: Storage,
    archive: zipfile.ZipFile,
    names: set[str],
    record: object,
    counts: dict[str, int],
) -> None:
    if not isinstance(record, dict) or not record.get("id"):
        counts["skipped"] += 1
        return

    equipment_id = str(record["id"])
    existing = storage.get_equipment(equipment_id)
    fields = {
        "id": equipment_id,
        "name": str(record.get("name") or "Untitled"),
        "category": str(record.get("category") or "Other"),
        "manufacturer": str(record.get("manufacturer") or "Unknown"),
        "model": record.get("model"),
        "description": record.get("description"),
        "specifications": record.get("specifications") or {},
    }

    known_urls: set[str] = set()
    if existing is None:
        storage.create_equipment(Equipment(**fields, manuals=[], research_findings=[]))
        counts["equipment_added"] += 1
    else:
        storage.update_equipment(
            Equipment(
                **fields,
                manuals=list(existing.manuals or []),
                research_findings=list(existing.research_findings or []),
                archived=bool(existing.archived),
            )
        )
        counts["equipment_updated"] += 1
        known_urls = {str(manual.get("url") or "") for manual in (existing.manuals or [])}

    for manual in record.get("manuals") or []:
        if not isinstance(manual, dict) or not manual.get("id"):
            counts["skipped"] += 1
            continue
        url = str(manual.get("url") or "")
        if url and url in known_urls:
            counts["skipped"] += 1
            continue
        storage.add_manual(
            equipment_id,
            Manual(
                id=str(manual["id"]),
                equipment_id=equipment_id,
                title=str(manual.get("title") or "Untitled manual"),
                url=url,
                source=str(manual.get("source") or "import"),
                metadata=manual.get("metadata") or {},
            ),
        )
        if url:
            known_urls.add(url)
        counts["manuals_added"] += 1
        _restore_document(storage, archive, names, manual)

    for finding in record.get("research_findings") or []:
        if not isinstance(finding, dict) or not finding.get("source_url"):
            counts["skipped"] += 1
            continue
        storage.add_research_finding(equipment_id, finding)
        counts["findings_added"] += 1


def _restore_document(
    storage: Storage,
    archive: zipfile.ZipFile,
    names: set[str],
    manual: dict,
) -> None:
    member = f"manuals/{manual['id']}.pdf"
    if member not in names:
        return
    target = manuals_dir() / f"{manual['id']}.pdf"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(archive.read(member))
    try:
        storage.save_manual_document(
            str(manual["id"]),
            str(target),
            str(manual.get("document_file_name") or f"{manual['id']}.pdf"),
            str(manual.get("document_text") or ""),
        )
    except sqlite3.IntegrityError:
        # The document row already exists: the PDF bytes are restored either way.
        return
