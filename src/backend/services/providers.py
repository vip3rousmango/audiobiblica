"""Optional services a research run can use, and which of them are configured.

The app works without any of these: the page reader, the manual text already stored and the catalog
itself are always available. Everything else is a key the user brings, and this module is the one
place that knows which services exist, what each unlocks, and where its key lives — so the interface
can say "this step needs a key" instead of returning an empty result and calling it research.

A key is never read back out of this module for display. Callers get a configured/not-configured
answer, which is all the interface needs and all an API should ever return.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from src.backend.config import get_config


@dataclass(frozen=True)
class Provider:
    """One optional service, and what the app can do once it is configured."""

    id: str
    label: str
    unlocks: str
    #: Config path holding the key, or ``None`` for a service that needs none.
    key_config: Optional[str] = None
    #: Where the key comes from when it is not stored under ``research.*`` — the
    #: assistant's own credentials are reused rather than asked for twice.
    borrowed_from: Optional[str] = None
    #: A "where do I get this" link, shown in Settings.
    docs: Optional[str] = None
    #: How to ask the service whether the key works: a GET, with the key placed
    #: either in a header or a query parameter. ``None`` when there is no cheap
    #: way to test it, which the interface says rather than faking a green tick.
    test_url: Optional[str] = None
    test_header: Optional[str] = None
    test_param: Optional[str] = None
    test_query: Optional[str] = None

    @property
    def keyless(self) -> bool:
        """Needs nothing at all: no key to paste, nothing to set up elsewhere.

        A service that *borrows* a key is not keyless — it is configured by the assistant panel, and
        calling it "always available" would tell somebody a service is ready when it is not. The
        published 0.1.5 answered "6 keyless" for four keyless services and two borrowed ones, which is
        how this was found.
        """
        return self.key_config is None and self.borrowed_from is None


PROVIDERS: tuple[Provider, ...] = (
    Provider(
        id="page_reader",
        label="Built-in page reader",
        unlocks="reading a product or support page with no key at all",
    ),
    Provider(
        id="manual_text",
        label="Your manuals",
        unlocks="searching the text of the PDFs and links you have already imported",
    ),
    Provider(
        id="catalog",
        label="Your catalog",
        unlocks="everything you have already written down about a device",
    ),
    Provider(
        id="easyschematic_templates",
        label="EasySchematic device templates",
        unlocks="port, connector and signal definitions for real hardware — and the device type "
        "EasySchematic needs to draw it",
        docs="https://docs.easyschematic.live/api",
    ),
    Provider(
        id="firecrawl",
        label="Firecrawl",
        unlocks="crawling a manufacturer's site, and structured extraction from its pages",
        # The same key the web-search panel has always used: one place to paste it.
        key_config="firecrawl.api_key",
        docs="https://firecrawl.dev",
    ),
    Provider(
        id="web_search",
        label="Web search",
        unlocks="reviews and specs on sites the manufacturer does not own",
        key_config="research.web_search.key",
        docs="https://brave.com/search/api/",
        test_url="https://api.search.brave.com/res/v1/web/search",
        test_header="X-Subscription-Token",
        test_query="q=audio equipment",
    ),
    Provider(
        id="discogs",
        label="Discogs",
        unlocks="the product itself — and what the market says it is worth",
        key_config="research.discogs.key",
        docs="https://www.discogs.com/developers",
        test_url="https://api.discogs.com/database/search",
        test_param="token",
        test_query="q=microphone&type=release",
    ),
    Provider(
        id="youtube",
        label="YouTube",
        unlocks="demos and reviews of that exact model, found by name",
        key_config="research.youtube.key",
        docs="https://developers.google.com/youtube/v3/getting-started",
        test_url="https://www.googleapis.com/youtube/v3/search",
        test_param="key",
        test_query="part=snippet&q=microphone&maxResults=1",
    ),
    Provider(
        id="reverb",
        label="Reverb",
        unlocks="what the gear sells for used, which is what it is worth to a studio",
        key_config="research.reverb.key",
        docs="https://www.reverb-api.com/",
        test_url="https://api.reverb.com/api/listings",
        test_header="Authorization",
        test_query="query=preamp&per_page=1",
    ),
    Provider(
        id="openai",
        label="OpenAI",
        unlocks="summarising sources the built-in reader cannot reach",
        borrowed_from="assistant",
        docs="https://platform.openai.com/api-keys",
    ),
    Provider(
        id="anthropic",
        label="Anthropic",
        unlocks="the same, for a Claude key",
        borrowed_from="assistant",
        docs="https://console.anthropic.com/",
    ),
)

_BY_ID = {provider.id: provider for provider in PROVIDERS}


def get_provider(provider_id: str) -> Optional[Provider]:
    return _BY_ID.get(provider_id)


def provider_key(provider_id: str) -> Optional[str]:
    """The key for a service, or ``None``. Never leaves the backend in a response."""
    provider = get_provider(provider_id)
    if provider is None or provider.keyless:
        return None
    if provider.borrowed_from == "assistant":
        # One key per service, not one per feature: if the assistant is set up with a
        # provider key, research may use it too.
        return get_config().get("assistant.api_key") or None
    return get_config().get(provider.key_config) or None


def is_configured(provider_id: str) -> bool:
    provider = get_provider(provider_id)
    if provider is None:
        return False
    return provider.keyless or bool(provider_key(provider_id))


def configured_provider_ids() -> set[str]:
    return {provider.id for provider in PROVIDERS if is_configured(provider.id)}


def save_provider_key(provider_id: str, key: str) -> None:
    """Store a key locally. Refuses for services that need none, or borrow one."""
    provider = get_provider(provider_id)
    if provider is None:
        raise KeyError(provider_id)
    if provider.keyless or provider.borrowed_from:
        raise ValueError(f"{provider.label} does not take a key here")
    # An empty box clears rather than storing nothing: the same "forget this" the panel's
    # Remove button does, so config.json does not accumulate empty secrets.
    trimmed = key.strip()
    if not trimmed:
        get_config().delete(provider.key_config)
        return
    get_config().set(provider.key_config, trimmed)


def clear_provider_key(provider_id: str) -> None:
    provider = get_provider(provider_id)
    if provider is None:
        raise KeyError(provider_id)
    if provider.keyless or provider.borrowed_from:
        raise ValueError(f"{provider.label} does not take a key here")
    get_config().delete(provider.key_config)


def provider_states() -> list[dict]:
    """Every service, what it unlocks, and whether it can be used — never the key."""
    states = []
    for provider in PROVIDERS:
        states.append(
            {
                "id": provider.id,
                "label": provider.label,
                "unlocks": provider.unlocks,
                "keyless": provider.keyless,
                "configured": is_configured(provider.id),
                "key_here": bool(provider.key_config) and not provider.borrowed_from,
                "borrowed_from": provider.borrowed_from,
                "docs": provider.docs,
                "testable": bool(provider.test_url),
            }
        )
    return states
