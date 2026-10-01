"""Turn a photo reading into draft equipment records.

The vision model is asked for JSON and usually obliges, but "usually" is the
whole problem: a small local model wraps its answer in a sentence, adds a code
fence, or says it cannot help. Everything here is written so that a strange
answer costs a draft, never an error the user has to read — which is also why
there is no HTTP in this module and the tests can drive it with fixed strings.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Literal, Optional

from src.backend.models.equipment import Equipment

#: Categories offered to the model and to the capture page's picker.
CATEGORIES = ["Microphone", "Console", "Outboard", "Instrument", "Monitor", "Interface", "Other"]

#: Nothing longer than the column it is stored in, and nothing with newlines.
_LIMITS = {"name": 255, "manufacturer": 255, "model": 120, "description": 500}

#: What the model says when it could not read a field: as a maker's name, and as
#: the word a model writes when it means the JSON value ``null``.
_UNKNOWN = "unknown"
_PLACEHOLDERS = {"null", "none", "n/a", "unspecified", "-", _UNKNOWN}


@dataclass
class GearDraft:
    """One device the reader believes it saw in a photo."""

    name: str
    manufacturer: str
    model: Optional[str]
    category: str
    description: Optional[str]
    confidence: Optional[float]
    photo_id: Optional[str] = None
    #: Set when the catalog already holds what looks like the same device.
    existing_id: Optional[str] = None


def build_prompt(mode: Literal["item", "studio"]) -> str:
    """The instruction that goes to the vision model with a photo."""
    if mode == "studio":
        opening = (
            "You are cataloguing a recording studio from a single photograph. "
            "Report each piece of audio equipment you can identify as its own item, "
            "as a JSON array of objects."
        )
    else:
        opening = (
            "You are cataloguing one piece of audio equipment from a photograph. "
            "Report the device in the photo as a single JSON object."
        )
    return (
        f"{opening}\n"
        "Each object has exactly these keys: name, manufacturer, model, category, description, confidence.\n"
        '- "name": what a musician would call the device.\n'
        '- "manufacturer": the maker, or null when the photo does not say.\n'
        '- "model": the model number or name printed on the device, or null when it is not legible. '
        "Never invent one.\n"
        f'- "category": exactly one of {", ".join(CATEGORIES)}.\n'
        '- "description": one short sentence about what the device is.\n'
        '- "confidence": a number from 0 to 1 saying how sure you are of the identification.\n'
        "Reply with JSON and nothing else."
    )


def parse_drafts(text: str, mode: str, photo_id: str) -> list[GearDraft]:
    """Read the model's answer into drafts. An unreadable answer yields none."""
    payload = _extract_json(text)
    if payload is None:
        return []
    items = payload if isinstance(payload, list) else [payload]
    drafts: list[GearDraft] = []
    for item in items:
        draft = _draft(item, photo_id)
        if draft is not None:
            drafts.append(draft)
    if mode == "item" and len(drafts) > 1:
        # A single-item photo was asked for one device. When the model lists
        # several anyway it is usually naming the same one twice, so the answer
        # is the one it was most sure of rather than a crowd of half-guesses.
        drafts = [max(drafts, key=lambda draft: draft.confidence or 0.0)]
    return drafts


def match_existing(draft: GearDraft, equipment: list[Equipment]) -> Optional[str]:
    """The id of the catalog entry this draft is the same device as, if any.

    Compared on letters and digits only, because the same device is written
    "1073 DPX", "1073-dpx" and "1073DPX" depending on who typed it. When the
    draft names a model both sides are compared on maker plus model: a bare
    model number is not enough to claim a match.
    """
    wanted = _key(draft.name, draft.manufacturer, draft.model)
    if not wanted:
        return None
    for item in equipment:
        if _key(item.name, item.manufacturer, item.model) == wanted:
            return item.id
    return None


def _extract_json(text: str) -> object:
    """The first JSON value in an answer, fence or prose notwithstanding."""
    cleaned = re.sub(r"```[a-zA-Z]*", "", text or "").strip("` \n\t")
    pairs = [("[", "]"), ("{", "}")]
    first_array = cleaned.find("[")
    first_object = cleaned.find("{")
    if first_object != -1 and (first_array == -1 or first_object < first_array):
        pairs.reverse()
    for opener, closer in pairs:
        start = cleaned.find(opener)
        if start == -1:
            continue
        end = cleaned.rfind(closer)
        if end <= start:
            continue
        try:
            return json.loads(cleaned[start : end + 1])
        except ValueError:
            continue
    return None


def _draft(item: object, photo_id: str) -> Optional[GearDraft]:
    if not isinstance(item, dict):
        return None
    manufacturer = _field(item.get("manufacturer"), _LIMITS["manufacturer"]) or "Unknown"
    model = _field(item.get("model"), _LIMITS["model"])
    name = _field(item.get("name"), _LIMITS["name"])
    if not name:
        # A studio shot often gives a maker and a model but no name; that is a
        # perfectly good label, and better than dropping the device.
        name = " ".join(part for part in (manufacturer, model) if part).strip()
    if not name or name.casefold() in _PLACEHOLDERS:
        return None
    description = _field(item.get("description"), _LIMITS["description"])
    return GearDraft(
        name=name,
        manufacturer=manufacturer,
        model=model or None,
        category=_category(item.get("category")),
        description=description or None,
        confidence=_confidence(item.get("confidence")),
        photo_id=photo_id,
    )


def _text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def _field(value: object, limit: int) -> str:
    """A model-supplied field, with the ways a model writes "nothing" removed.

    Asked for null, a small model often answers the word "null" instead — or
    "none", or "N/A" — and a device called "Null" in the library is worse than
    one whose name was built from its maker and model.
    """
    text = _text(value, limit)
    return "" if text.casefold() in _PLACEHOLDERS else text


def _category(value: object) -> str:
    if isinstance(value, str):
        folded = " ".join(value.split()).casefold()
        for category in CATEGORIES:
            if category.casefold() == folded:
                return category
    return "Other"


def _confidence(value: object) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if 0.0 <= number <= 1.0 else None


def device_key(name: str, manufacturer: str, model: Optional[str]) -> str:
    """The comparable form of a device's identity: letters and digits, case-folded.

    Public because it is the matching rule the phone capture flow, the research runs and — via
    docs/INTEGRATION.md — the studio console all have to agree on, so that "the same device" means
    one thing.
    """
    text = f"{manufacturer} {model}" if model else name
    return re.sub(r"[^0-9a-z]+", "", text.casefold())


def _key(name: str, manufacturer: str, model: Optional[str]) -> str:
    return device_key(name, manufacturer, model)
