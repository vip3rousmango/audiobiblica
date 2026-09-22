from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Equipment:
    """
    Core equipment entity for AudioBiblica.

    Attributes:
        id: Unique identifier.
        name: Human-readable equipment name.
        category: Equipment category.
        manufacturer: Manufacturer reference.
        model: Model number or name.
        description: Brief description.
        specifications: Equipment specifications.
        manuals: Associated manuals.
        created_at: Creation timestamp.
        updated_at: Last update timestamp.
    """

    id: str
    name: str
    category: str
    manufacturer: str
    model: Optional[str] = None
    description: Optional[str] = None
    specifications: dict = field(default_factory=dict)
    manuals: list = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""


@dataclass
class EquipmentCategory:
    """
    Category for grouping equipment.
    """

    name: str
    description: Optional[str] = None


@dataclass
class Manufacturer:
    """
    Manufacturer entity.
    """

    name: str
    website: Optional[str] = None
    country: Optional[str] = None
    description: Optional[str] = None


@dataclass
class Manual:
    """
    Manual entity representing a PDF or guide associated with equipment.
    """

    id: str
    equipment_id: str
    title: str
    url: str
    source: str
    downloaded_at: str = ""
    metadata: dict = field(default_factory=dict)
