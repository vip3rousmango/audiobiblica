"""Working through a research plan for one device.

This is the *planned* half of research: the steps come from ``research_plan``, each one is served by a
tool, and the result of every step is recorded whether it found something, found nothing, needs a key,
or failed. Nothing is invented and nothing fails silently — a step that could not be served says so in
one sentence, which is the same honesty the diagnostics checks and the wizard's `cannot-check` are
built on.

The tools that always work are the point: the catalog the user already has, the text of the manuals
already stored, the pages already linked, and EasySchematic's keyless template catalogue. A run with no
keys at all still asks every question and reports which ones it could not answer.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx
from starlette.concurrency import run_in_threadpool

from src.backend.services.gear_scan import device_key
from src.backend.services.page_reader import read_page
from src.backend.services.paths import data_dir
from src.backend.services.providers import provider_key
from src.backend.services.search_sources import search

logger = logging.getLogger(__name__)

#: Characters of a source kept as a finding's content.
MAX_FINDING_CHARS = 4000
#: Characters of context shown around a keyword hit.
EXCERPT_CHARS = 320
#: How many known pages one step reads before giving up on finding the answer.
MAX_PAGES_PER_STEP = 3

#: EasySchematic's device catalogue, keyless. It is several megabytes, so it is kept
#: in the data directory and refreshed on this cadence rather than fetched per run.
TEMPLATES_URL = "https://api.easyschematic.live/templates"
TEMPLATES_MAX_AGE_SECONDS = 7 * 24 * 60 * 60


@dataclass(frozen=True)
class StepResult:
    """What one step produced."""

    state: str  # "done" | "empty" | "needs-key" | "failed"
    detail: str
    evidence: list[dict]
    error: Optional[str] = None

    @property
    def found_something(self) -> bool:
        return self.state == "done" and bool(self.evidence)


def _templates_path() -> Path:
    return data_dir() / "easyschematic-templates.json"


def _templates() -> list[dict]:
    """EasySchematic's device catalogue, from disk when it is fresh enough.

    Never raises: a machine that is offline, or a catalogue that changed shape, leaves the step
    without an answer rather than failing the run.
    """
    path = _templates_path()
    try:
        if path.is_file() and time.time() - path.stat().st_mtime < TEMPLATES_MAX_AGE_SECONDS:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload, list):
                return payload
    except (OSError, ValueError):
        logger.info("Could not read the cached device templates", exc_info=True)

    try:
        response = httpx.get(TEMPLATES_URL, timeout=httpx.Timeout(60.0, connect=10.0))
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.info("Could not fetch the device templates: %s", exc)
        return []
    if not isinstance(payload, list):
        return []
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
    except OSError:  # pragma: no cover - a read-only data directory must not break a run
        logger.warning("Could not cache the device templates", exc_info=True)
    return payload


def _keywords(step_title: str) -> list[str]:
    """The words a page has to contain to be answering this step."""
    words = [word for word in re.split(r"[^a-z0-9]+", step_title.casefold()) if len(word) > 3]
    return words or [step_title.casefold()]


def _excerpt(text: str, words: list[str]) -> Optional[str]:
    """The sentence-sized window around the first mention, or ``None`` when there is none."""
    lowered = text.casefold()
    for word in words:
        position = lowered.find(word)
        if position == -1:
            continue
        start = max(0, position - EXCERPT_CHARS // 2)
        end = min(len(text), position + EXCERPT_CHARS // 2)
        return " ".join(text[start:end].split())
    return None


def _query_for(name: str, manufacturer: str, model: Optional[str], step_title: str) -> str:
    """What to search for, in the words somebody would use."""
    subject = " ".join(part for part in (manufacturer, model or name) if part).strip()
    return f"{subject} {step_title}".strip()


# --- the tools ---------------------------------------------------------------


async def _catalog(storage, equipment, step, words: list[str]) -> StepResult:
    """What the user has already written down, which is the first place to look."""
    parts = [
        f"Manufacturer: {equipment.manufacturer}",
        f"Model: {equipment.model or 'not recorded'}",
        f"Category: {equipment.category}",
    ]
    if equipment.description:
        parts.append(f"Notes: {equipment.description}")
    if equipment.specifications:
        parts.append("Specifications: " + json.dumps(equipment.specifications, sort_keys=True))

    findings = await run_in_threadpool(storage.get_research_findings, equipment.id)
    reviewed = [item for item in findings if item.get("status") == "completed"]
    if reviewed:
        parts.append("Already researched: " + "; ".join(item["title"] for item in reviewed[:5]))

    text = "\n".join(parts)
    if not equipment.specifications and not equipment.description:
        return StepResult("empty", "Nothing has been written down about this device yet.", [])
    return StepResult("done", "Read from your own catalog.", [{"title": "Your catalog", "url": "", "snippet": text[:1200], "provider": "catalog"}])


async def _manual_text(storage, equipment, step, words: list[str]) -> StepResult:
    """Search the text of the manuals already stored for this device."""
    documents = await run_in_threadpool(storage.get_manual_document_texts, equipment.id)
    if not documents:
        return StepResult("empty", "No manual text is stored for this device yet.", [])

    evidence = []
    for document in documents:
        excerpt = _excerpt(document.get("content_text") or "", words)
        if excerpt:
            evidence.append(
                {
                    "title": document.get("title") or "Manual",
                    "url": document.get("url") or "",
                    "snippet": excerpt,
                    "provider": "manual_text",
                }
            )
    if not evidence:
        titles = ", ".join(document.get("title") or "a manual" for document in documents[:2])
        return StepResult("empty", f"{titles} does not mention this in as many words.", [])
    return StepResult("done", f"Found in {len(evidence)} manual(s).", evidence[:3])


async def _page_reader(storage, equipment, step, words: list[str]) -> StepResult:
    """Read the pages already known for this device.

    Discovery is a search and needs a key; reading what is already linked needs nothing, so this step
    deepens known sources rather than looking for new ones.
    """
    urls: list[str] = []
    for manual in equipment.manuals or []:
        url = str(manual.get("url") or "") if isinstance(manual, dict) else ""
        if url.startswith("http") and url not in urls:
            urls.append(url)
    for finding in await run_in_threadpool(storage.get_research_findings, equipment.id):
        url = str(finding.get("source_url") or "")
        if url.startswith("http") and url not in urls:
            urls.append(url)

    if not urls:
        return StepResult("empty", "No page is linked to this device yet, so there is nothing to read.", [])

    read_any = False
    for url in urls[:MAX_PAGES_PER_STEP]:
        page = await run_in_threadpool(read_page, url)
        if page.error:
            continue
        read_any = True
        excerpt = _excerpt(page.text or "", words)
        if excerpt:
            return StepResult(
                "done",
                f"Found on {url}.",
                [{"title": page.title or url, "url": url, "snippet": excerpt, "provider": "page_reader"}],
            )
    if read_any:
        return StepResult("empty", "The linked pages do not mention this in as many words.", [])
    return StepResult("failed", "The linked pages could not be read.", [], "Every linked page refused to load.")


async def _templates(storage, equipment, step, words: list[str]) -> StepResult:
    """EasySchematic's device catalogue: real port and connector definitions, no key needed."""
    wanted = {device_key(equipment.name, equipment.manufacturer, equipment.model or "")}
    if equipment.model:
        wanted.add(device_key(equipment.model, equipment.manufacturer, None))
    wanted.discard("")

    for template in await run_in_threadpool(_templates):
        if not isinstance(template, dict):
            continue
        keys = {
            device_key(str(template.get("label") or ""), str(template.get("manufacturer") or ""), None),
            device_key(str(template.get("label") or ""), "", None),
        }
        keys.discard("")
        if not (keys & wanted):
            continue
        ports = [port for port in (template.get("ports") or []) if isinstance(port, dict)]
        signals = sorted({str(port.get("signalType") or "") for port in ports if port.get("signalType")})
        connectors = sorted({str(port.get("connectorType") or "") for port in ports if port.get("connectorType")})
        summary = (
            f"{len(ports)} ports"
            + (f" · {', '.join(connectors)}" if connectors else "")
            + (f" · {', '.join(signals)}" if signals else "")
        )
        return StepResult(
            "done",
            f"Matched the EasySchematic template “{template.get('label')}”.",
            [
                {
                    "title": f"{template.get('manufacturer', '')} {template.get('label', '')}".strip(),
                    "url": "https://devices.easyschematic.live",
                    "snippet": summary,
                    "provider": "easyschematic_templates",
                }
            ],
        )
    return StepResult("empty", "No EasySchematic template matches this device by name.", [])


async def _keyed_search(provider_id: str, equipment, step, words: list[str]) -> StepResult:
    """A service the user brought a key for."""
    key = provider_key(provider_id) or ""
    if not key:
        return StepResult("needs-key", f"{provider_id} needs a key, which is not set up.", [])
    outcome = await search(
        provider_id, _query_for(equipment.name, equipment.manufacturer, equipment.model, step.title)
    )
    if not outcome.ok:
        return StepResult("failed", "The search could not be run.", [], outcome.error)
    if not outcome.sources:
        return StepResult("empty", "The search found nothing for this device.", [])
    return StepResult("done", f"Found {len(outcome.sources)} source(s).", [source.as_dict() for source in outcome.sources])


#: Which tool serves which step id. Anything not here is served by a keyed search named by the step's
#: `tool`, which is how the plan and this table stay in step: a step naming a service is a search.
_TOOLS = {
    "catalog": _catalog,
    "manual_text": _manual_text,
    "page_reader": _page_reader,
    "easyschematic_templates": _templates,
}


async def _run_step(storage, equipment, step: dict) -> StepResult:
    words = _keywords(step.get("title") or step.get("step_id") or "")
    tool = step.get("tool") or ""
    handler = _TOOLS.get(tool)
    if handler is not None:
        return await handler(storage, equipment, step, words)
    return await _keyed_search(tool, equipment, step, words)


def _finding_for(step: dict, result: StepResult, equipment_id: str) -> dict:
    """One reviewable finding per question asked, with the sources it rests on."""
    best = next((item for item in result.evidence if item.get("url")), result.evidence[0])
    content_lines = [result.detail]
    for item in result.evidence:
        line = f"- {item.get('title') or item.get('url')}"
        if item.get("snippet"):
            line += f": {item['snippet']}"
        content_lines.append(line)
    return {
        "id": f"run-{step['step_id']}-{int(time.time() * 1000)}",
        "query": step.get("title") or step["step_id"],
        "source_url": str(best.get("url") or ""),
        "title": step.get("title") or step["step_id"],
        "content": "\n".join(content_lines)[:MAX_FINDING_CHARS],
        "extracted_specs": {},
        "confidence": 0.6,
        # Pending, always: a run proposes, the user confirms. The same rule captures use.
        "status": "pending",
        "dimension": step.get("dimension"),
        "equipment_id": equipment_id,
    }


async def run_plan(storage, run_id: str, equipment, mode: str = "planned") -> dict:
    """Work through a run's recorded steps, recording what each one found.

    The steps come from the store rather than from the plan module, so what the interface showed
    before the run is exactly what the run does.
    """
    run = await run_in_threadpool(storage.get_research_run, run_id)
    if run is None:
        raise KeyError(run_id)

    found = needs_key = empty = failed = 0
    for step in run["steps"]:
        await run_in_threadpool(storage.update_research_step, run_id, step["step_id"], state="running", started=True)
        try:
            result = await _run_step(storage, equipment, step)
        except Exception as exc:  # a tool must never take the whole run down with it
            logger.exception("Research step %s failed", step["step_id"])
            result = StepResult("failed", "This step could not be completed.", [], str(exc))

        await run_in_threadpool(
            storage.update_research_step,
            run_id,
            step["step_id"],
            state=result.state,
            detail=result.detail,
            error=result.error,
            evidence=result.evidence,
            finished=True,
        )
        if result.found_something:
            found += 1
            await run_in_threadpool(
                storage.add_research_finding, equipment.id, _finding_for(step, result, equipment.id)
            )
        elif result.state == "needs-key":
            needs_key += 1
        elif result.state == "failed":
            failed += 1
        else:
            empty += 1

    parts = [f"{found} of {len(run['steps'])} steps found something."]
    if needs_key:
        parts.append(f"{needs_key} need a key you have not added.")
    if failed:
        parts.append(f"{failed} could not be completed.")
    if empty:
        parts.append(f"{empty} came back empty.")
    summary = " ".join(parts)

    status = "finished" if not failed else "finished-with-errors"
    await run_in_threadpool(storage.finish_research_run, run_id, status, summary)
    return {
        "run_id": run_id,
        "status": status,
        "summary": summary,
        "counts": {"found": found, "empty": empty, "needs_key": needs_key, "failed": failed},
    }
