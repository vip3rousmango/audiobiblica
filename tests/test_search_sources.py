"""Looking things up in the services a user brought keys for.

Deliberately does not cover the executor that calls these, nor any live request: what is pinned here is
**how a vendor's answer becomes sources**, which is the part that breaks when a service changes shape,
and that a run would otherwise turn into silent nonsense.

The fixtures are each vendor's documented response shape. Verifying them against a live key is what the
interface's "Test" button is for — a run should never be the first place a shape mismatch shows up.
"""

from __future__ import annotations

import asyncio

import pytest

from src.backend.services.search_sources import (
    SearchOutcome,
    has_adapter,
    search,
    searchable_provider_ids,
)


@pytest.fixture()
def fetched(monkeypatch):
    """Stand in for the network, and let a test say what each service answers."""

    def install(payload, error=None):
        calls = []

        async def fake_fetch(url, *, params, headers):
            calls.append({"url": url, "params": params, "headers": headers})
            return payload, error

        monkeypatch.setattr("src.backend.services.search_sources._fetch", fake_fetch)
        return calls

    return install


BRAVE = {"web": {"results": [
    {"title": "SM7B review", "url": "https://example.com/sm7b", "description": "A dynamic mic that  needs  48V never."},
    {"title": "No URL here"},
]}}

DISCOGS = {"results": [
    {"title": "Shure SM7B", "uri": "/release/123-SM7B", "year": "2001", "label": ["Shure"], "format": ["Microphone"]},
    {"title": ""},
]}

YOUTUBE = {"items": [
    {"id": {"videoId": "abc123"}, "snippet": {"title": "SM7B on vocals", "channelTitle": "Studio A"}},
    {"id": {"channelId": "chan1"}, "snippet": {"title": "Some channel"}},
]}

REVERB = {"listings": [
    {"title": "Shure SM7B", "_links": {"web": {"href": "https://reverb.com/item/1"}}, "price": {"amount": "349.00", "currency": "USD"}},
    {"title": "No link"},
]}


def test_each_service_has_an_adapter_and_knows_when_it_does_not():
    """`has_adapter` is what stops the registry promising a search it cannot do."""
    assert searchable_provider_ids() == {"web_search", "discogs", "youtube", "reverb"}
    assert has_adapter("web_search") is True
    assert has_adapter("firecrawl") is False


def test_a_web_search_returns_sources_worth_reading(fetched):
    async def scenario():
        calls = fetched(BRAVE)
        outcome = await search("web_search", "shure sm7b", "key-1")

        assert outcome.ok and len(outcome.sources) == 1, "an item with no url is not a source"
        source = outcome.sources[0]
        assert source.title == "SM7B review" and source.url == "https://example.com/sm7b"
        assert source.snippet == "A dynamic mic that needs 48V never.", "whitespace is collapsed"
        assert source.provider == "web_search"
        assert calls[0]["headers"]["X-Subscription-Token"] == "key-1"
        assert calls[0]["params"]["q"] == "shure sm7b"

    asyncio.run(scenario())

def test_discogs_turns_an_uri_into_something_openable(fetched):
    async def scenario():
        fetched(DISCOGS)
        outcome = await search("discogs", "sm7b", "key-2")

        assert [source.url for source in outcome.sources] == ["https://www.discogs.com/release/123-SM7B"]
        assert "2001" in outcome.sources[0].snippet and "Shure" in outcome.sources[0].snippet

    asyncio.run(scenario())

def test_youtube_keeps_only_things_you_can_watch(fetched):
    async def scenario():
        fetched(YOUTUBE)
        outcome = await search("youtube", "sm7b", "key-3")

        assert [source.url for source in outcome.sources] == ["https://www.youtube.com/watch?v=abc123"]
        assert outcome.sources[0].snippet == "Studio A", "the channel is the useful context"

    asyncio.run(scenario())

def test_reverb_reports_a_price(fetched):
    async def scenario():
        fetched(REVERB)
        outcome = await search("reverb", "sm7b", "key-4")

        assert outcome.sources[0].url == "https://reverb.com/item/1"
        assert "349.00" in outcome.sources[0].snippet

    asyncio.run(scenario())

def test_a_service_that_changes_shape_is_a_sentence_not_a_crash(fetched):
    async def scenario():
        """The failure this module exists to prevent: garbage findings from an unreadable answer."""
        fetched({"web": {"results": "not a list"}})
        outcome = await search("web_search", "anything", "key-5")
        assert outcome.ok is False
        assert "did not understand" in (outcome.error or "")

    asyncio.run(scenario())

def test_a_failure_from_the_service_is_passed_through_as_a_sentence(fetched):
    async def scenario():
        fetched(None, "The service refused this key.")
        outcome = await search("web_search", "anything", "bad-key")
        assert outcome.ok is False and outcome.error == "The service refused this key."
        assert outcome.sources == []

    asyncio.run(scenario())

def test_nothing_is_asked_for_without_a_key():
    async def scenario():
        """No key means no request at all — the step should say it needs one, not try anyway."""
        outcome = await search("discogs", "sm7b", "")
        assert outcome.ok is False and "No key" in (outcome.error or "")

    asyncio.run(scenario())

def test_an_empty_result_is_not_an_error():
    async def scenario():
        """A search that found nothing has told us something: the source is silent, not broken."""
        outcome = SearchOutcome([])
        assert outcome.ok is True

    asyncio.run(scenario())
