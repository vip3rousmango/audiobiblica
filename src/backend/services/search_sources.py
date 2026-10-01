"""Looking something up in a service the user brought a key for.

Four providers, one shape of answer: a list of places to read further. Each returns its errors as a
sentence rather than raising, like ``page_reader`` and ``FirecrawlService``, so a research step can
record "Discogs refused the key" against the step instead of failing the run.

The response shapes are each vendor's documented one. That documentation is the only thing that could
be wrong here, which is why the interface can test a key with one call: if a provider changes shape,
the honest failure is visible before a run depends on it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

import httpx

#: How many results a step asks for. Enough to be useful, few enough to read.
DEFAULT_LIMIT = 5

_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


@dataclass(frozen=True)
class Source:
    """One place worth reading, as a research step records it."""

    title: str
    url: str
    snippet: str
    provider: str

    def as_dict(self) -> dict:
        return {"title": self.title, "url": self.url, "snippet": self.snippet, "provider": self.provider}


@dataclass(frozen=True)
class SearchOutcome:
    """What a lookup found, or why it could not."""

    sources: list[Source]
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.error is None


def _text(value: object, limit: int = 400) -> str:
    """A vendor's string, trimmed, with anything unusable reduced to nothing."""
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


async def _fetch(url: str, *, params: dict, headers: dict) -> tuple[Optional[dict], Optional[str]]:
    """One GET, with the failures a user can act on turned into sentences."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.get(url, params=params, headers=headers)
    except httpx.HTTPError as exc:
        return None, f"Could not reach the service: {exc}"
    if response.status_code in (401, 403):
        return None, "The service refused this key."
    if not response.is_success:
        return None, f"The service answered HTTP {response.status_code}."
    try:
        payload = response.json()
    except ValueError:
        return None, "The service answered with something that was not JSON."
    if not isinstance(payload, dict):
        return None, "The service answered with an unexpected shape."
    return payload, None


def _brave(payload: dict, query: str) -> list[Source]:
    found = []
    for item in (payload.get("web") or {}).get("results") or []:
        url = _text(item.get("url"), 500)
        if not url:
            continue
        found.append(Source(_text(item.get("title")) or url, url, _text(item.get("description")), "web_search"))
    return found


def _discogs(payload: dict, query: str) -> list[Source]:
    found = []
    for item in payload.get("results") or []:
        uri = _text(item.get("uri"), 300)
        title = _text(item.get("title"))
        if not title or not uri:
            continue
        facts = [
            _text(item.get("year"), 8),
            _text((item.get("label") or [""])[0] if item.get("label") else "", 80),
            " / ".join(_text(entry, 40) for entry in (item.get("format") or [])[:3]),
        ]
        found.append(
            Source(title, f"https://www.discogs.com{uri}", " · ".join(part for part in facts if part), "discogs")
        )
    return found


def _youtube(payload: dict, query: str) -> list[Source]:
    found = []
    for item in payload.get("items") or []:
        video_id = _text(((item.get("id") or {}) if isinstance(item.get("id"), dict) else {}).get("videoId"), 40)
        snippet = item.get("snippet") or {}
        if not video_id:
            continue  # a channel or playlist result, which is not something to watch
        found.append(
            Source(
                _text(snippet.get("title")) or video_id,
                f"https://www.youtube.com/watch?v={video_id}",
                _text(snippet.get("channelTitle")),
                "youtube",
            )
        )
    return found


def _reverb(payload: dict, query: str) -> list[Source]:
    found = []
    for item in payload.get("listings") or []:
        links = item.get("_links") or {}
        url = _text((links.get("web") or {}).get("href") if isinstance(links.get("web"), dict) else "", 500)
        title = _text(item.get("title"))
        if not title or not url:
            continue
        price = item.get("price") or {}
        amount = price.get("amount") if isinstance(price, dict) else None
        currency = _text(price.get("currency"), 8) if isinstance(price, dict) else ""
        found.append(
            Source(title, url, f"{amount} {currency}".strip() if amount else "", "reverb")
        )
    return found


@dataclass(frozen=True)
class _Adapter:
    url: str
    params: Callable[[str, str, int], dict]
    headers: Callable[[str], dict]
    parse: Callable[[dict, str], list[Source]]


_ADAPTERS: dict[str, _Adapter] = {
    "web_search": _Adapter(
        url="https://api.search.brave.com/res/v1/web/search",
        params=lambda query, key, limit: {"q": query, "count": limit},
        headers=lambda key: {"X-Subscription-Token": key, "Accept": "application/json"},
        parse=_brave,
    ),
    "discogs": _Adapter(
        url="https://api.discogs.com/database/search",
        params=lambda query, key, limit: {"q": query, "type": "release", "per_page": limit, "token": key},
        headers=lambda key: {"User-Agent": "AudioBiblica/0.1 (+https://github.com/vip3rousmango/audiobiblica)"},
        parse=_discogs,
    ),
    "youtube": _Adapter(
        url="https://www.googleapis.com/youtube/v3/search",
        params=lambda query, key, limit: {"part": "snippet", "q": query, "type": "video", "maxResults": limit, "key": key},
        headers=lambda key: {},
        parse=_youtube,
    ),
    "reverb": _Adapter(
        url="https://api.reverb.com/api/listings",
        params=lambda query, key, limit: {"query": query, "per_page": limit},
        headers=lambda key: {"Authorization": f"Bearer {key}", "Accept": "application/hal+json", "Accept-Version": "3.0"},
        parse=_reverb,
    ),
}


def has_adapter(provider_id: str) -> bool:
    """Whether this service can actually be searched — the registry promises nothing else."""
    return provider_id in _ADAPTERS


def searchable_provider_ids() -> set[str]:
    return set(_ADAPTERS)


async def search(provider_id: str, query: str, key: str, limit: int = DEFAULT_LIMIT) -> SearchOutcome:
    """Look something up, and say what went wrong if it could not."""
    adapter = _ADAPTERS.get(provider_id)
    if adapter is None:
        return SearchOutcome([], f"Nothing here knows how to search {provider_id} yet.")
    if not key:
        return SearchOutcome([], "No key for this service.")
    payload, error = await _fetch(
        adapter.url,
        params=adapter.params(query, key, limit),
        headers=adapter.headers(key),
    )
    if payload is None:
        return SearchOutcome([], error)
    try:
        sources = adapter.parse(payload, query)[:limit]
    except (AttributeError, TypeError, KeyError, IndexError):
        return SearchOutcome([], "The service answered in a shape we did not understand.")
    if not sources:
        return SearchOutcome([], None)
    return SearchOutcome(sources)
