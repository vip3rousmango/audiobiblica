"""
SQLite-backed storage for AudioBiblica equipment data.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional

from src.backend.models.equipment import Equipment, Manual
from src.backend.services.paths import database_path


def _iso(timestamp: float | int | str | None) -> str:
    """Render a stored epoch timestamp as an ISO-8601 UTC string."""
    if timestamp is None:
        return ""
    try:
        return datetime.fromtimestamp(float(timestamp), timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return str(timestamp)

@dataclass
class StoredEquipment:
    id: str
    name: str
    category: str
    manufacturer: str
    model: Optional[str]
    description: Optional[str]
    specifications: dict
    manuals_json: str
    research_findings_json: str
    created_at: float
    updated_at: float


@dataclass
class StoredManual:
    id: str
    equipment_id: str
    title: str
    url: str
    source: str
    downloaded_at: float
    metadata_json: str


@dataclass
class StoredResearchFinding:
    id: str
    equipment_id: str
    query: str
    source_url: str
    title: str
    content: str
    extracted_specs: str
    confidence: float
    status: str
    created_at: float


@dataclass
class StoredManualDocument:
    manual_id: str
    file_path: str
    file_name: str
    content_text: str


#: Bumped whenever the catalog file is replaced under the app. A connection caches
#: the file's header, so an open one keeps failing on the old contents until it is
#: reopened; comparing this integer costs nothing per query.
_catalog_generation = 0


def invalidate_connections() -> None:
    """Force every thread to reopen the catalog on its next use."""
    global _catalog_generation
    _catalog_generation += 1


class Storage:
    """Thread-safe SQLite storage for equipment and manuals."""

    def __init__(self, db_path: str | Path | None = None):
        self.db_path = Path(db_path) if db_path else database_path()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._init_db()

    def ensure_schema(self) -> None:
        """Re-apply the schema and column migrations (idempotent).

        A restored snapshot can predate columns added since it was taken; running
        the migration again is how it catches up without a private call.
        """
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        stale = getattr(self._local, "generation", None) != _catalog_generation
        if not hasattr(self._local, "conn") or self._local.conn is None or stale:
            if getattr(self._local, "conn", None) is not None:
                self._local.conn.close()
            self._local.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
            self._local.conn.row_factory = sqlite3.Row
            self._local.conn.execute("PRAGMA foreign_keys = ON")
            self._local.generation = _catalog_generation
        return self._local.conn

    def _init_db(self) -> None:
        conn = sqlite3.connect(str(self.db_path))
        try:
            conn.execute("PRAGMA foreign_keys = ON")
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS equipment (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    category TEXT NOT NULL,
                    manufacturer TEXT NOT NULL,
                    model TEXT,
                    description TEXT,
                    specifications TEXT NOT NULL DEFAULT '{}',
                    manuals_json TEXT NOT NULL DEFAULT '[]',
                    research_findings_json TEXT NOT NULL DEFAULT '[]',
                    archived INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS manuals (
                    id TEXT PRIMARY KEY,
                    equipment_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL,
                    source TEXT NOT NULL,
                    downloaded_at REAL NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS research_findings (
                    id TEXT PRIMARY KEY,
                    equipment_id TEXT NOT NULL,
                    query TEXT NOT NULL,
                    source_url TEXT NOT NULL,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    extracted_specs TEXT NOT NULL DEFAULT '{}',
                    confidence REAL NOT NULL DEFAULT 0.5,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at REAL NOT NULL,
                    FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_equipment_manufacturer ON equipment(manufacturer);
                CREATE INDEX IF NOT EXISTS idx_equipment_category ON equipment(category);
                CREATE INDEX IF NOT EXISTS idx_manuals_equipment ON manuals(equipment_id);
                CREATE INDEX IF NOT EXISTS idx_research_findings_equipment ON research_findings(equipment_id);

                CREATE TABLE IF NOT EXISTS manual_documents (
                    manual_id TEXT PRIMARY KEY,
                    file_path TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    content_text TEXT NOT NULL,
                    FOREIGN KEY (manual_id) REFERENCES manuals(id) ON DELETE CASCADE
                );
                """
            )
            equipment_columns = {
                row[1] for row in conn.execute("PRAGMA table_info(equipment)")
            }
            if "archived" not in equipment_columns:
                conn.execute(
                    "ALTER TABLE equipment ADD COLUMN archived INTEGER NOT NULL DEFAULT 0"
                )
            if "research_findings_json" not in equipment_columns:
                conn.execute(
                    "ALTER TABLE equipment ADD COLUMN research_findings_json TEXT NOT NULL DEFAULT '[]'"
                )
            conn.commit()
        finally:
            conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        conn = self._get_conn()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    def _row_to_equipment(self, row: sqlite3.Row) -> Equipment:
        # Handle missing columns gracefully (for backward compatibility)
        keys = row.keys()
        return Equipment(
            id=row["id"],
            name=row["name"],
            category=row["category"],
            manufacturer=row["manufacturer"],
            model=row["model"] if "model" in keys else None,
            description=row["description"] if "description" in keys else None,
            specifications=json.loads(row["specifications"] or "{}"),
            manuals=json.loads(row["manuals_json"] or "[]"),
            research_findings=json.loads(row["research_findings_json"] or "[]") if "research_findings_json" in keys else [],
            archived=bool(row["archived"]) if "archived" in keys else False,
            created_at=_iso(row["created_at"]),
            updated_at=_iso(row["updated_at"]),
        )

    def _row_to_manual(self, row: sqlite3.Row) -> Manual:
        return Manual(
            id=row["id"],
            equipment_id=row["equipment_id"],
            title=row["title"],
            url=row["url"],
            source=row["source"],
            downloaded_at=_iso(row["downloaded_at"]),
            metadata=json.loads(row["metadata_json"] or "{}"),
        )

    def _row_to_research_finding(self, row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "equipment_id": row["equipment_id"],
            "query": row["query"],
            "source_url": row["source_url"],
            "title": row["title"],
            "content": row["content"],
            "extracted_specs": json.loads(row["extracted_specs"] or "{}"),
            "confidence": row["confidence"],
            "status": row["status"],
            "created_at": _iso(row["created_at"]),
        }

    def list_equipment(self) -> list[Equipment]:
        with self.transaction() as conn:
            cursor = conn.execute("SELECT * FROM equipment ORDER BY updated_at DESC")
            return [self._row_to_equipment(row) for row in cursor.fetchall()]

    def get_equipment(self, equipment_id: str) -> Optional[Equipment]:
        with self.transaction() as conn:
            cursor = conn.execute("SELECT * FROM equipment WHERE id = ?", (equipment_id,))
            row = cursor.fetchone()
            return self._row_to_equipment(row) if row else None

    def create_equipment(self, equipment: Equipment) -> Equipment:
        now = time.time()
        with self.transaction() as conn:
            conn.execute(
                """
                INSERT INTO equipment (id, name, category, manufacturer, model, description, specifications, manuals_json, research_findings_json, archived, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    equipment.id,
                    equipment.name,
                    equipment.category,
                    equipment.manufacturer,
                    equipment.model,
                    equipment.description,
                    json.dumps(equipment.specifications),
                    json.dumps([asdict(m) if hasattr(m, "__dataclass_fields__") else m for m in equipment.manuals]),
                    json.dumps(equipment.research_findings),
                    int(equipment.archived),
                    now,
                    now,
                ),
            )
        return equipment

    def update_equipment(self, equipment: Equipment) -> Equipment:
        now = time.time()
        equipment.updated_at = _iso(now)
        with self.transaction() as conn:
            conn.execute(
                """
                UPDATE equipment
                SET name = ?, category = ?, manufacturer = ?, model = ?, description = ?,
                    specifications = ?, manuals_json = ?, research_findings_json = ?,
                    archived = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    equipment.name,
                    equipment.category,
                    equipment.manufacturer,
                    equipment.model,
                    equipment.description,
                    json.dumps(equipment.specifications),
                    json.dumps([asdict(m) if hasattr(m, "__dataclass_fields__") else m for m in equipment.manuals]),
                    json.dumps(equipment.research_findings),
                    int(equipment.archived),
                    now,
                    equipment.id,
                ),
            )
        return equipment

    def delete_equipment(self, equipment_id: str) -> bool:
        with self.transaction() as conn:
            cursor = conn.execute("DELETE FROM equipment WHERE id = ?", (equipment_id,))
            return cursor.rowcount > 0

    def add_manual(self, equipment_id: str, manual: Manual) -> Manual:
        with self.transaction() as conn:
            exists = conn.execute("SELECT 1 FROM equipment WHERE id = ?", (equipment_id,)).fetchone()
            if not exists:
                raise ValueError("Equipment not found")
            conn.execute(
                """
                INSERT INTO manuals (id, equipment_id, title, url, source, downloaded_at, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    manual.id,
                    manual.equipment_id,
                    manual.title,
                    manual.url,
                    manual.source,
                    time.time(),
                    json.dumps(manual.metadata),
                ),
            )
            row = conn.execute("SELECT manuals_json FROM equipment WHERE id = ?", (equipment_id,)).fetchone()
            manuals = json.loads(row["manuals_json"] or "[]")
            manuals.append(asdict(manual))
            conn.execute(
                "UPDATE equipment SET manuals_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(manuals), time.time(), equipment_id),
            )
        return manual

    def get_manual(self, equipment_id: str, manual_id: str) -> Optional[Manual]:
        with self.transaction() as conn:
            row = conn.execute(
                "SELECT * FROM manuals WHERE id = ? AND equipment_id = ?",
                (manual_id, equipment_id),
            ).fetchone()
            return self._row_to_manual(row) if row else None

    def delete_manual(self, equipment_id: str, manual_id: str) -> bool:
        with self.transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM manuals WHERE id = ? AND equipment_id = ?",
                (manual_id, equipment_id),
            )
            if cursor.rowcount == 0:
                return False
            row = conn.execute("SELECT manuals_json FROM equipment WHERE id = ?", (equipment_id,)).fetchone()
            manuals = [manual for manual in json.loads(row["manuals_json"] or "[]") if manual.get("id") != manual_id]
            conn.execute(
                "UPDATE equipment SET manuals_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(manuals), time.time(), equipment_id),
            )
            return True

    def save_manual_document(
        self,
        manual_id: str,
        file_path: str,
        file_name: str,
        content_text: str,
    ) -> None:
        with self.transaction() as conn:
            conn.execute(
                """
                INSERT INTO manual_documents (manual_id, file_path, file_name, content_text)
                VALUES (?, ?, ?, ?)
                """,
                (manual_id, file_path, file_name, content_text),
            )

    def get_manual_document(self, manual_id: str) -> Optional[StoredManualDocument]:
        with self.transaction() as conn:
            row = conn.execute(
                "SELECT * FROM manual_documents WHERE manual_id = ?",
                (manual_id,),
            ).fetchone()
            return StoredManualDocument(**dict(row)) if row else None

    def get_manual_document_texts(self, equipment_id: str) -> list[dict[str, str]]:
        with self.transaction() as conn:
            rows = conn.execute(
                """
                SELECT m.id, m.title, m.url, d.content_text
                FROM manuals AS m
                JOIN manual_documents AS d ON d.manual_id = m.id
                WHERE m.equipment_id = ?
                ORDER BY m.downloaded_at DESC
                """,
                (equipment_id,),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_manual_document_paths(self, equipment_id: str) -> list[str]:
        with self.transaction() as conn:
            rows = conn.execute(
                """
                SELECT d.file_path
                FROM manual_documents AS d
                JOIN manuals AS m ON m.id = d.manual_id
                WHERE m.equipment_id = ?
                """,
                (equipment_id,),
            ).fetchall()
            return [row["file_path"] for row in rows]

    def add_research_finding(self, equipment_id: str, finding: dict) -> dict:
        finding = dict(finding)
        finding_id = finding.get("id") or str(uuid.uuid4())
        finding["id"] = finding_id
        finding["equipment_id"] = equipment_id
        created_at = time.time()
        with self.transaction() as conn:
            equipment = conn.execute(
                "SELECT research_findings_json FROM equipment WHERE id = ?",
                (equipment_id,),
            ).fetchone()
            if equipment is None:
                raise ValueError("Equipment not found")
            existing = None
            if finding.get("source_url"):
                existing = conn.execute(
                    """
                    SELECT id, created_at FROM research_findings
                    WHERE equipment_id = ? AND source_url = ?
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (equipment_id, finding["source_url"]),
                ).fetchone()
            if existing:
                finding_id = existing["id"]
                created_at = existing["created_at"]
                finding["id"] = finding_id
                conn.execute(
                    """
                    UPDATE research_findings SET query = ?, title = ?, content = ?,
                        extracted_specs = ?, confidence = ?, status = ?, created_at = ?
                    WHERE id = ? AND equipment_id = ?
                    """,
                    (
                        finding.get("query", ""),
                        finding.get("title", ""),
                        finding.get("content", ""),
                        json.dumps(finding.get("extracted_specs", {})),
                        finding.get("confidence", 0.5),
                        finding.get("status", "completed"),
                        time.time(),
                        finding_id,
                        equipment_id,
                    ),
                )
                created_at = time.time()
            else:
                conn.execute(
                    """
                    INSERT INTO research_findings
                        (id, equipment_id, query, source_url, title, content, extracted_specs, confidence, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        finding_id,
                        equipment_id,
                        finding.get("query", ""),
                        finding.get("source_url", ""),
                        finding.get("title", ""),
                        finding.get("content", ""),
                        json.dumps(finding.get("extracted_specs", {})),
                        finding.get("confidence", 0.5),
                        finding.get("status", "completed"),
                        created_at,
                    ),
                )
            findings = [
                item
                for item in json.loads(equipment["research_findings_json"] or "[]")
                if item.get("id") != finding_id
            ]
            findings.append({**finding, "created_at": _iso(created_at)})
            conn.execute(
                "UPDATE equipment SET research_findings_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(findings), time.time(), equipment_id),
            )
        return {**finding, "created_at": _iso(created_at)}

    def delete_research_finding(self, equipment_id: str, finding_id: str) -> bool:
        with self.transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM research_findings WHERE id = ? AND equipment_id = ?",
                (finding_id, equipment_id),
            )
            if cursor.rowcount == 0:
                return False
            equipment = conn.execute(
                "SELECT research_findings_json FROM equipment WHERE id = ?",
                (equipment_id,),
            ).fetchone()
            if equipment is not None:
                findings = [
                    item
                    for item in json.loads(equipment["research_findings_json"] or "[]")
                    if item.get("id") != finding_id
                ]
                conn.execute(
                    "UPDATE equipment SET research_findings_json = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(findings), time.time(), equipment_id),
                )
            return True

    def get_research_findings(self, equipment_id: str) -> list[dict]:
        with self.transaction() as conn:
            cursor = conn.execute(
                "SELECT * FROM research_findings WHERE equipment_id = ? ORDER BY created_at DESC",
                (equipment_id,),
            )
            return [self._row_to_research_finding(row) for row in cursor.fetchall()]



_storage: Optional[Storage] = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        _storage = Storage()
    return _storage