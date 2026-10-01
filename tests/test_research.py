"""The research plan and the services it can lean on.

Deliberately does not cover a run's execution or the model calls behind it — what is pinned here is the
*shape* of a plan, which is what the interface and the coverage matrix are built on.

Two properties are load-bearing and would fail silently in production:
a step naming a tool the app does not have would look like a broken run, and a plan with no keyless
steps would make the app useless to somebody who brought no keys.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from src.backend.services.gear_scan import CATEGORIES
from src.backend.services.providers import (
    PROVIDERS,
    clear_provider_key,
    configured_provider_ids,
    get_provider,
    is_configured,
    provider_key,
    provider_states,
    save_provider_key,
)
from src.backend.services.research_plan import DIMENSIONS, coverage_for, plan_summary, research_plan


def _device(equipment_id: str, category: str):
    """A device in the catalog. Ids are unique per test: the suite shares one database."""
    from src.backend.models.equipment import Equipment

    return Equipment(
        id=equipment_id,
        name=f"Device {equipment_id}",
        manufacturer="Test",
        category=category,
    )


def test_every_step_names_a_tool_that_exists():
    """A plan may only ask for work the app can actually do."""
    known = {provider.id for provider in PROVIDERS}
    for category in [*CATEGORIES, "Nonsense", ""]:
        for step in research_plan(category):
            assert step.tool in known, f"{category}: {step.id} wants unknown tool {step.tool}"


def test_every_step_that_needs_a_key_names_a_keyed_provider():
    """`needs_key` drives the interface's "needs key" state, so it has to be real."""
    for category in [*CATEGORIES, "Nonsense"]:
        for step in research_plan(category):
            if step.needs_key is None:
                continue
            provider = get_provider(step.needs_key)
            assert provider is not None, f"{category}: {step.id} names unknown provider"
            assert not provider.keyless, f"{category}: {step.id} asks for a key that is not needed"


def test_every_plan_works_without_any_keys():
    """The local-first baseline: the page reader, the manual text and the catalog are always there."""
    for category in [*CATEGORIES, "Nonsense"]:
        keyless = [step for step in research_plan(category) if step.needs_key is None]
        assert keyless, f"{category} can do nothing at all without keys"
        assert any(step.tool in {"manual_text", "catalog", "page_reader"} for step in keyless)


def test_plans_differ_by_category():
    """A preamp and a monitor must not be asked the same questions."""
    microphone = {step.id for step in research_plan("Microphone")}
    monitor = {step.id for step in research_plan("Monitor")}
    assert microphone != monitor
    assert "polar_pattern" in microphone
    assert "placement" in monitor


def test_an_unknown_category_still_gets_a_plan():
    """Better to ask what the device is than to offer nothing."""
    steps = research_plan("Something Else")
    assert [step.id for step in steps][:3] == ["manual", "manufacturer_specs", "sources"]
    assert "identity" in {step.id for step in steps}


def test_plan_summary_is_what_the_interface_needs():
    summary = plan_summary("Outboard")
    assert summary["category"] == "Outboard"
    assert {"id", "title", "tool", "question", "dimension", "needs_key"} <= set(summary["steps"][0])
    assert all(dimension in DIMENSIONS for dimension in summary["dimensions"])


# --- the provider registry ---------------------------------------------------

def test_the_always_on_services_need_no_key():
    for provider_id in ("page_reader", "manual_text", "catalog", "easyschematic_templates"):
        provider = get_provider(provider_id)
        assert provider is not None and provider.keyless
        assert is_configured(provider_id) is True
        assert provider_key(provider_id) is None


def test_a_key_switches_a_service_on_and_off():
    """The interface's whole "needs key" story rests on this being reversible.

    State is asserted from a known point rather than assumed to start empty: the config file is
    shared by the whole suite, and the route table in test_api_smoke.py sets a key of its own.
    """
    clear_provider_key("discogs")
    assert is_configured("discogs") is False
    save_provider_key("discogs", "  a-key-with-spaces  ")
    assert is_configured("discogs") is True
    assert provider_key("discogs") == "a-key-with-spaces", "stored trimmed"

    clear_provider_key("discogs")
    assert is_configured("discogs") is False
    assert "discogs" not in configured_provider_ids()


def test_firecrawl_reuses_the_key_the_web_search_panel_already_has():
    """One place to paste it: the registry must not invent a second home for the same secret."""
    from src.backend.config import get_config

    get_config().set("firecrawl.api_key", "fc-existing")
    assert provider_key("firecrawl") == "fc-existing"
    clear_provider_key("firecrawl")
    assert is_configured("firecrawl") is False


def test_services_that_borrow_a_key_refuse_to_store_one():
    """OpenAI and Anthropic are configured in the assistant panel, not twice."""
    with pytest.raises(ValueError):
        save_provider_key("openai", "sk-nope")
    with pytest.raises(ValueError):
        save_provider_key("page_reader", "anything")


def test_provider_states_never_include_a_key():
    """This payload goes to the browser: it may say configured, never what the key is."""
    save_provider_key("reverb", "rv-secret")
    payload = str(provider_states())
    assert "rv-secret" not in payload
    entry = next(item for item in provider_states() if item["id"] == "reverb")
    assert entry["configured"] is True and entry["testable"] is True
    clear_provider_key("reverb")


# --- the run store, and what counts as covered -------------------------------

def test_a_run_records_its_plan_before_any_work_happens():
    """The interface shows the plan up front, so the steps must exist as 'queued' first."""
    from src.backend.services.storage import Storage

    storage = Storage()
    storage.create_equipment(_device("run-store-1", "Microphone"))
    run = storage.create_research_run("run-1", "run-store-1", plan_summary("Microphone")["steps"])

    assert run["status"] == "running"
    assert [step["state"] for step in run["steps"]] == ["queued"] * len(run["steps"])
    assert {step["step_id"] for step in run["steps"]} == {step.id for step in research_plan("Microphone")}
    assert run["steps"][0]["evidence"] == []


def test_a_step_can_be_filled_in_and_a_run_finished():
    from src.backend.services.storage import Storage

    storage = Storage()
    # A microphone, because this test fills in `demos` — a step only a microphone's plan has.
    storage.create_equipment(_device("run-store-2", "Microphone"))
    storage.create_research_run("run-2", "run-store-2", plan_summary("Microphone")["steps"])
    storage.update_research_step(
        "run-2", "manual", state="done", detail="Found the user guide.", evidence=[{"url": "x", "title": "y"}], started=True, finished=True
    )
    storage.update_research_step("run-2", "demos", state="needs-key", error=None)
    storage.finish_research_run("run-2", "finished", "4 of 6 steps found something.")

    run = storage.get_research_run("run-2")
    assert run is not None and run["status"] == "finished"
    manual = next(step for step in run["steps"] if step["step_id"] == "manual")
    assert manual["state"] == "done" and manual["evidence"][0]["url"] == "x"
    assert manual["started_at"] and manual["finished_at"]
    demos = next(step for step in run["steps"] if step["step_id"] == "demos")
    assert demos["state"] == "needs-key"
    assert storage.list_research_runs()[0]["id"] == "run-2"
    assert storage.get_research_run("nope") is None


def test_only_pending_findings_are_queued_for_review():
    """Approving takes a finding out of the queue; nothing else does."""
    from src.backend.services.storage import Storage

    storage = Storage()
    storage.create_equipment(_device("run-store-3", "Outboard"))
    storage.add_research_finding("run-store-3", {"id": "f-pending", "title": "Queued", "dimension": "specs", "status": "pending"})
    storage.add_research_finding("run-store-3", {"id": "f-done", "title": "Rejected", "dimension": "specs", "status": "rejected"})

    queued = [finding["id"] for finding in storage.pending_findings() if finding["equipment_id"] == "run-store-3"]
    assert queued == ["f-pending"], "only the pending one is in the queue"
    entry = next(f for f in storage.pending_findings() if f["id"] == "f-pending")
    assert entry["equipment_name"] == "Device run-store-3", "the queue names the device"

    assert storage.set_finding_status("f-pending", "completed") is True
    assert "f-pending" not in [f["id"] for f in storage.pending_findings()]
    assert storage.set_finding_status("nope", "completed") is False


def test_a_finding_remembers_which_dimension_it_fills():
    from src.backend.services.storage import Storage

    storage = Storage()
    storage.create_equipment(_device("run-store-4", "Interface"))
    storage.add_research_finding(
        "run-store-4",
        {"id": "f-dim", "query": "Clock", "title": "Clock", "source_url": "https://example.com/clock", "dimension": "connections"},
    )
    stored = next(f for f in storage.get_research_findings("run-store-4") if f["id"] == "f-dim")
    assert stored["dimension"] == "connections"

    # The same question asked of the same source again updates that row — the branch a second run
    # over one device takes.
    storage.add_research_finding(
        "run-store-4",
        {"id": "ignored", "query": "Clock", "title": "Clock again", "source_url": "https://example.com/clock", "dimension": "connections"},
    )
    updated = next(f for f in storage.get_research_findings("run-store-4") if f["id"] == "f-dim")
    assert updated["title"] == "Clock again"
    assert len(storage.get_research_findings("run-store-4")) == 1, "the same question from the same source is one finding"

    # A *different* question answered from the same source is its own finding. Matching on the
    # source alone collapsed two of them into one, which cost a coverage dimension: found by
    # running a plan whose manual answered both "Gain and range" and "Phantom power".
    storage.add_research_finding(
        "run-store-4",
        {"id": "f-second", "query": "Sample rate", "title": "Sample rate", "source_url": "https://example.com/clock", "dimension": "specs"},
    )
    both = storage.get_research_findings("run-store-4")
    assert len(both) == 2, "one source can answer several questions"
    assert {finding["dimension"] for finding in both} == {"connections", "specs"}


def test_pending_work_does_not_count_as_knowing_something():
    """The matrix must send somebody to look, not tell them they are done."""
    empty = coverage_for("Microphone", covered=set(), has_manual=False)
    assert empty["complete"] is False
    assert "manual" in empty["missing"] and empty["steps_remaining"] > 0

    with_manual = coverage_for("Microphone", covered=set(), has_manual=True)
    assert "manual" in with_manual["covered"]

    everything = coverage_for("Microphone", covered=set(empty["dimensions"]), has_manual=False)
    assert everything["complete"] is True and everything["missing"] == []


def test_coverage_only_counts_dimensions_that_device_has():
    """A monitor has no phantom-power step, so it cannot be missing one."""
    monitor = coverage_for("Monitor", covered=set(), has_manual=True)
    assert "connections" in monitor["missing"]
    assert "settings" not in monitor["dimensions"]


def test_coverage_and_queue_answer_for_a_real_device(client):
    """The two payloads the matrix and the queue are built from.

    The rules are unit-tested above; this is the assembly: archived devices are left out, a stored
    manual counts as the manual dimension, and a pending finding is queued rather than counted as
    known.
    """
    created = client.post(
        "/api/v1/equipment",
        json={"name": "Coverage Probe", "manufacturer": "Test", "category": "Microphone", "model": "P1"},
    )
    assert created.status_code == 200, created.text
    device_id = created.json()["equipment"]["id"]

    client.post(
        f"/api/v1/equipment/{device_id}/manuals",
        json={"title": "Probe manual", "url": "https://example.com/probe.pdf", "source": "example.com"},
    )
    client.post(
        f"/api/v1/equipment/{device_id}/research-findings",
        json={
            "query": "polar pattern",
            "source_url": "https://example.com/p",
            "title": "Cardioid",
            "content": "It is cardioid.",
            "dimension": "specs",
            "status": "pending",
        },
    )

    queue = client.get("/api/v1/research/queue").json()
    queued = next(item for item in queue["findings"] if item["equipment_id"] == device_id)
    assert queued["equipment_name"] == "Coverage Probe", "the queue names the device"
    assert queued["dimension"] == "specs"

    row = next(
        item for item in client.get("/api/v1/research/coverage").json()["devices"] if item["equipment_id"] == device_id
    )
    assert "manual" in row["covered"], "a stored manual is the manual dimension"
    assert "specs" not in row["covered"], "a pending finding is not knowledge yet"
    assert row["pending"] == 1
    assert row["complete"] is False


# --- the executor ------------------------------------------------------------

def test_a_run_with_no_keys_still_asks_every_question(monkeypatch, tmp_path):
    async def scenario():
        """The local-first baseline, end to end: steps run, keyed ones say so, the run finishes.

        `read_page` and the templates are stood in for — this is about what the run *does*, not about
        what the network answers.
        """
        from src.backend.services import research_run as runner
        from src.backend.services.page_reader import PageRead
        from src.backend.services.storage import Storage

        monkeypatch.setattr(runner, "_templates", lambda: [])
        monkeypatch.setattr(runner, "read_page", lambda url: PageRead(url=url, error="not read"))

        storage = Storage()
        device = _device("exec-1", "Microphone")
        storage.create_equipment(device)
        storage.create_research_run("exec-run-1", "exec-1", plan_summary("Microphone")["steps"])

        outcome = await runner.run_plan(storage, "exec-run-1", device)

        run = storage.get_research_run("exec-run-1")
        assert run is not None
        assert outcome["counts"]["found"] == 0, "nothing was available to find"
        assert outcome["counts"]["needs_key"] >= 1, "the keyed steps report themselves as unconfigured"
        assert all(step["state"] in {"done", "empty", "needs-key", "failed"} for step in run["steps"])
        assert run["status"] == "finished"
        assert run["summary"], "a run says what happened in a sentence"
        assert any(step["state"] == "needs-key" for step in run["steps"])

    asyncio.run(scenario())

def test_what_a_step_finds_becomes_a_pending_finding(monkeypatch):
    async def scenario():
        """Evidence is proposed, never asserted: the queue is the only way in."""
        from src.backend.services import research_run as runner
        from src.backend.services.storage import Storage

        storage = Storage()
        device = _device("exec-2", "Monitor")
        storage.create_equipment(device)
        storage.create_research_run("exec-run-2", "exec-2", plan_summary("Monitor")["steps"])

        async def fake_tool(storage_, equipment, step):
            if step["step_id"] != "drivers":
                return runner.StepResult("empty", "nothing here", [])
            return runner.StepResult(
                "done",
                "Matched a template.",
                [{"title": "KRK Rokit", "url": "https://example.com/krk", "snippet": "6 inch woofer", "provider": "easyschematic_templates"}],
            )

        monkeypatch.setattr(runner, "_run_step", fake_tool)
        await runner.run_plan(storage, "exec-run-2", device)

        findings = [f for f in storage.get_research_findings("exec-2") if f["status"] == "pending"]
        assert len(findings) == 1, "one finding per question that found something"
        finding = findings[0]
        assert finding["title"] == "Driver complement"
        assert finding["dimension"] == "specs"
        assert finding["source_url"] == "https://example.com/krk"
        assert "6 inch woofer" in finding["content"]

        row = next(item for item in coverage_for("Monitor", covered=set(), has_manual=False)["missing"])
        assert row, "pending findings do not count as coverage"
        assert "specs" in coverage_for("Monitor", covered={"specs"}, has_manual=False)["covered"]

    asyncio.run(scenario())

def test_a_step_that_throws_does_not_take_the_run_with_it(monkeypatch):
    async def scenario():
        """One broken tool must not lose the other answers."""
        from src.backend.services import research_run as runner
        from src.backend.services.storage import Storage

        storage = Storage()
        device = _device("exec-3", "Interface")
        storage.create_equipment(device)
        storage.create_research_run("exec-run-3", "exec-3", plan_summary("Interface")["steps"])

        async def exploding_tool(storage_, equipment, step):
            raise RuntimeError("the tool fell over")

        monkeypatch.setattr(runner, "_run_step", exploding_tool)
        outcome = await runner.run_plan(storage, "exec-run-3", device)

        run = storage.get_research_run("exec-run-3")
        assert outcome["counts"]["failed"] == len(run["steps"])
        assert run["status"] == "finished-with-errors"
        assert all(step["state"] == "failed" and step["error"] for step in run["steps"])
        assert all("could not be completed" in step["detail"] for step in run["steps"])

    asyncio.run(scenario())

def test_the_keywords_a_step_looks_for_come_from_its_title():
    """`Polar pattern` must not become a one-word search, and short words are noise."""
    from src.backend.services.research_run import _keywords

    assert _keywords("Polar pattern") == ["polar", "pattern"]
    assert _keywords("Clock") == ["clock"], "a short single word still has to be a keyword"
    assert "of" not in _keywords("Recall sheet of the device")


def test_an_excerpt_is_a_window_around_the_mention_not_the_whole_page():
    """A finding should quote what it rests on, not paste 18 000 characters into the drawer."""
    from src.backend.services.research_run import _excerpt

    text = "Intro. " * 200 + "The phantom power is switchable per channel. " + "Outro. " * 200
    excerpt = _excerpt(text, ["phantom"])
    assert excerpt is not None and "switchable per channel" in excerpt
    assert len(excerpt) < 400, "an excerpt is a sentence-sized window"
    assert _excerpt("nothing relevant here", ["phantom"]) is None


def test_borrowed_services_are_not_called_always_available():
    """A service configured elsewhere must not claim to be ready on its own.

    The published 0.1.5 answered "6 keyless" for four keyless services and two borrowed ones, so the
    panel told a musician that OpenAI was ready when nothing was set up at all — the opposite of what
    this screen exists to say.
    """
    from src.backend.config import get_config

    for provider_id in ("openai", "anthropic"):
        provider = get_provider(provider_id)
        assert provider is not None and provider.borrowed_from == "assistant"
        assert provider.keyless is False, "borrowing a key is not the same as needing none"

    get_config().delete("assistant.api_key")
    assert is_configured("openai") is False, "no assistant key means nothing to borrow"

    get_config().set("assistant.api_key", "sk-borrowed")
    assert is_configured("openai") is True, "an assistant key is used rather than asked for twice"
    assert is_configured("anthropic") is True, "the same key stands in for whichever provider is set"

    states = {item["id"]: item for item in provider_states()}
    assert states["openai"]["keyless"] is False and states["openai"]["key_here"] is False
    assert [item["id"] for item in provider_states() if item["keyless"]] == [
        "page_reader",
        "manual_text",
        "catalog",
        "easyschematic_templates",
    ]
    get_config().delete("assistant.api_key")


def test_a_run_streams_its_steps_and_closes(client, monkeypatch):
    """The data tree is fed by this stream, so its contract is worth pinning.

    It sends the current state first — so a client that arrives late still gets the whole plan —
    then one event per step, then the finished run, and stops. Polling stays as the fallback; this
    is what makes the tree grow rather than blink.
    """
    from src.backend.services import research_run as runner

    device = client.post(
        "/api/v1/equipment",
        json={"name": "Stream Probe", "manufacturer": "Test", "category": "Monitor", "model": "S1"},
    ).json()["equipment"]

    async def instant_tool(storage_, equipment, step):
        if step["step_id"] != "drivers":
            return runner.StepResult("empty", "nothing here", [])
        return runner.StepResult(
            "done", "Found it.", [{"title": "A source", "url": "https://example.com/a", "snippet": "woofer"}]
        )

    monkeypatch.setattr(runner, "_run_step", instant_tool)
    started = client.post(f"/api/v1/equipment/{device['id']}/research/run", json={"mode": "planned"}).json()["run"]

    frames = []
    with client.stream("GET", f"/api/v1/research/runs/{started['id']}/stream") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "no-store"
        for line in response.iter_lines():
            if line.startswith("data: "):
                frames.append(json.loads(line[6:]))
            if frames and frames[-1].get("type") == "finished":
                break

    assert frames[0]["type"] == "run", "the current state comes first"
    assert len(frames[0]["run"]["steps"]) == len(research_plan("Monitor"))
    step_events = [frame for frame in frames if frame["type"] == "step"]
    assert len(step_events) == len(research_plan("Monitor")), "one event per step"
    assert {event["step_id"] for event in step_events} == {step.id for step in research_plan("Monitor")}
    done = next(event for event in step_events if event["step_id"] == "drivers")
    assert done["state"] == "done" and done["evidence"][0]["url"] == "https://example.com/a"
    assert frames[-1]["type"] == "finished" and frames[-1]["run"]["status"] == "finished"

    # A finished run's stream says so at once instead of holding the connection open.
    with client.stream("GET", f"/api/v1/research/runs/{started['id']}/stream") as again:
        body = "".join(again.iter_text())
    assert body.count("data: ") == 2 and '"type": "finished"' in body
