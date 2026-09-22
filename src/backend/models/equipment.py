"""Equipment data models."""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from datetime import datetime


@dataclass
class Manufacturer:
    """Audio equipment manufacturer."""
    name: str
    website: Optional[str] = None
    country: Optional[str] = None
    founded: Optional[int] = None
    specializations: List[str] = field(default_factory=list)


@dataclass
class EquipmentCategory:
    """Category of audio equipment."""
    name: str
    description: str = ""
    parent: Optional[str] = None  # For subcategories


@dataclass
class Equipment:
    """Single piece of audio equipment."""
    id: str
    name: str
    manufacturer: str
    model: str
    category: str
    description: Optional[str] = None
    specifications: Dict[str, Any] = field(default_factory=dict)
    manuals: List[str] = field(default_factory=list)  # Paths to PDF files
    resources: List[Dict[str, str]] = field(default_factory=list)  # URLs to online resources
    last_updated: datetime = field(default_factory=datetime.now)
    discovered_via_scrape: bool = False


@dataclass
class Manual:
    """Documented manual for equipment."""
    path: str
    title: str
    equipment_id: str
    extracted_text: Optional[str] = None
    extracted_features: Dict[str, Any] = field(default_factory=dict)
    processed_at: Optional[datetime] = None
