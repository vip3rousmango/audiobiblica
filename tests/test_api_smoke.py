"""API smoke test for AudioBiblica.

Guards the whole HTTP surface: every route must answer its documented status for
valid and invalid input, and none may return 500 for the inputs a client can send.
Written after a missing module import silently 500'd several routes while the app
still started and passed a syntax check.

The shared client and the data paths come from conftest.py.
"""

from __future__ import annotations

import datetime
import json

import pytest


@pytest.fixture()
def equipment(client) -> str:
    response = client.post("/api/v1/equipment", json={
        "name": "Smoke Device", "manufacturer": "Smoke Co", "model": "S1",
        "category": "Outboard", "specifications": {"gain": "60 dB"},
    })
    assert response.status_code == 200, response.text
    return response.json()["equipment"]["id"]


def _pdf_bytes() -> bytes:
    """Minimal single-page PDF whose content stream contains extractable text."""
    return "\n".join([
        "%PDF-1.4",
        "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj",
        "4 0 obj<</Length 96>>stream",
        "BT /F1 12 Tf 20 140 Td (Frequency response: 20 Hz to 20 kHz) Tj 0 -20 Td (Weight: 5 kg) Tj ET",
        "endstream",
        "endobj",
        "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
        "trailer<</Root 1 0 R>>",
        "%%EOF",
    ]).encode() + b"\n"


def test_spec_extraction_captures_full_values():
    """Pattern matching must capture complete values with their units."""
    from src.backend.services.pdf_processing import pdf_processor

    features = pdf_processor.extract_features(
        "Specifications: Input voltage: 100-240 V AC, Output power: 250 W, "
        "Frequency response: 20 Hz to 20 kHz, Signal to noise: 90 dB, "
        "Total harmonic distortion: 0.01 %, Input impedance: 600 ohms, "
        "Weight: 5 kg, Dimensions: 483 x 133 x 44 mm"
    )
    assert features["output_power"] == "250 W"
    assert features["frequency_response"] == "20 Hz to 20 kHz"
    assert features["signal_to_noise"] == "90 dB"
    assert features["impedance"] == "600 ohms"
    assert features["weight"] == "5 kg"
    assert features["dimensions"] == "483 x 133 x 44 mm"


def test_manual_fallback_extraction_works():
    """The pdfminer fallback path must not raise (it previously hit a NameError)."""
    from src.backend.services.pdf_processing import pdf_processor

    text = pdf_processor._extract_text_manual(_pdf_bytes())
    assert "Frequency response" in text


# --- routes must not 500 on client input -----------------------------------

@pytest.mark.parametrize("method,path,body,expect", [
    ("GET", "/health", None, 200),
    ("GET", "/api/v1/mcp/status", None, 200),
    ("GET", "/api/v1/config/assistant", None, 200),
    ("GET", "/api/v1/config/firecrawl", None, 200),
    ("GET", "/api/v1/equipment", None, 200),
    ("GET", "/api/v1/equipment/nope", None, 404),
    ("GET", "/api/v1/equipment/nope/research-findings", None, 404),
    ("POST", "/api/v1/equipment", {}, 422),
    ("PUT", "/api/v1/equipment/nope", {"description": "x"}, 404),
    ("DELETE", "/api/v1/equipment/nope", None, 404),
    ("POST", "/api/v1/research/manufacturer", {"manufacturer": "Neve", "model": "1073"}, None),
    ("POST", "/api/v1/research/search", {"query": "neve"}, None),
    ("POST", "/api/v1/research/map", {"base_url": "https://example.com"}, None),
    ("POST", "/api/v1/mcp", {"tool_name": "search_equipment", "arguments": {}}, 200),
    ("GET", "/api/v1/setup/status", None, 200),
    ("POST", "/api/v1/setup/pull-model", {"model": ""}, 422),
    ("GET", "/api/v1/data/backups", None, 200),
    ("GET", "/api/v1/data/export", None, 200),
    ("POST", "/api/v1/research/fetch-url", {"url": "not a url"}, 200),
])
def test_routes_answer_without_server_error(client, method, path, body, expect):
    response = client.request(method, path, json=body)
    assert response.status_code != 500, f"{method} {path} -> 500: {response.text[:200]}"
    if expect is not None:
        assert response.status_code == expect, response.text


def test_mcp_bridge_rejects_malformed_payload(client):
    """A non-object JSON body must be a 4xx, never a 500."""
    response = client.post("/api/v1/mcp", json=[1, 2, 3])
    assert response.status_code == 422, response.text


# --- equipment --------------------------------------------------------------

def test_equipment_timestamps_are_iso8601(client, equipment):
    """Stored epoch floats must be surfaced as ISO-8601, matching the create response."""
    listed = client.get("/api/v1/equipment").json()["equipment"]
    record = next(item for item in listed if item["id"] == equipment)
    for field in ("created_at", "updated_at"):
        datetime.datetime.fromisoformat(record[field])
    assert record["category"] == "Outboard"


def test_update_ignores_unknown_fields(client, equipment):
    """Extra keys must not be silently echoed back as if they were stored."""
    response = client.put(f"/api/v1/equipment/{equipment}", json={"description": "changed", "id": "hijacked"})
    assert response.status_code == 200
    body = response.json()["equipment"]
    assert body["id"] == equipment
    assert body["description"] == "changed"


# --- manuals ----------------------------------------------------------------

def test_manual_upload_download_roundtrip(client, equipment):
    payload = _pdf_bytes()
    upload = client.post(
        f"/api/v1/equipment/{equipment}/manuals/upload",
        files={"file": ("manual.pdf", payload, "application/pdf")},
    )
    assert upload.status_code == 200, upload.text
    manual_id = upload.json()["manual"]["id"]
    download = client.get(f"/api/v1/equipment/{equipment}/manuals/{manual_id}/file")
    assert download.status_code == 200
    assert download.content == payload


def test_manual_upload_rejects_non_pdf(client, equipment):
    response = client.post(
        f"/api/v1/equipment/{equipment}/manuals/upload",
        files={"file": ("manual.pdf", b"not a pdf at all", "application/pdf")},
    )
    assert response.status_code == 415, response.text


# --- research findings ------------------------------------------------------

def test_research_finding_upserts_by_source_url(client, equipment):
    """Repeated research for one URL must update a single finding, not duplicate it."""
    finding = {
        "query": "smoke", "source_url": "https://example.com/a.pdf",
        "title": "A", "content": "first", "extracted_specs": {}, "confidence": 0.5, "status": "candidate",
    }
    assert client.post(f"/api/v1/equipment/{equipment}/research-findings", json=finding).status_code == 200
    finding["content"] = "second"
    assert client.post(f"/api/v1/equipment/{equipment}/research-findings", json=finding).status_code == 200

    findings = client.get(f"/api/v1/equipment/{equipment}/research-findings").json()["findings"]
    matching = [item for item in findings if item["source_url"] == finding["source_url"]]
    assert len(matching) == 1
    assert matching[0]["content"] == "second"


# --- secrets ----------------------------------------------------------------

def test_firecrawl_key_is_never_echoed(client):
    secret = "sk-live-do-not-leak-123456"
    assert client.post("/api/v1/config/firecrawl", json={"api_key": secret}).status_code == 200
    body = client.get("/api/v1/config/firecrawl").text
    assert secret not in body
    assert json.loads(body)["api_key_configured"] is True
    assert client.delete("/api/v1/config/firecrawl").status_code == 200


# --- MCP protocol -----------------------------------------------------------

def test_mcp_streamable_http_lists_and_calls_tools(client):
    headers = {"Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26"}
    init = client.post("/mcp/", headers=headers, json={
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                   "clientInfo": {"name": "pytest", "version": "1"}},
    })
    assert init.status_code == 200, init.text
    headers["MCP-Protocol-Version"] = json.loads(init.text)["result"]["protocolVersion"]

    listed = client.post("/mcp/", headers=headers, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
    tools = [tool["name"] for tool in json.loads(listed.text)["result"]["tools"]]
    assert "search_equipment" in tools

    called = client.post("/mcp/", headers=headers, json={
        "jsonrpc": "2.0", "id": 3, "method": "tools/call",
        "params": {"name": "search_equipment", "arguments": {"query": "Smoke"}},
    })
    assert called.status_code == 200, called.text
    assert "Smoke Device" in called.text


# --- assistant grounding ----------------------------------------------------

def test_assistant_prompt_includes_manual_text(client, equipment, monkeypatch):
    """Manual text must reach the model, and the prompt must use real newlines."""
    upload = client.post(
        f"/api/v1/equipment/{equipment}/manuals/upload",
        files={"file": ("manual.pdf", _pdf_bytes(), "application/pdf")},
    )
    assert upload.status_code == 200, upload.text

    captured: dict = {}

    async def fake_chat_completion(**kwargs):
        captured.update(kwargs)
        return "ok"

    monkeypatch.setattr("src.backend.main.chat_completion", fake_chat_completion)
    response = client.post("/api/v1/assistant/chat", json={
        "runtime": "builtin", "session_id": "pytest",
        "messages": [{"role": "user", "content": "What is in my Smoke Co manual?"}],
    })
    assert response.status_code == 200, response.text
    system_prompt = captured["messages"][0]["content"]
    assert "\n\n" in system_prompt
    assert "\\n" not in system_prompt
