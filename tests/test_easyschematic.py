"""The EasySchematic authoring, export surface, and the installer's stop-at-detection promise.

These tests deliberately do not cover a live EasySchematic: detection and export are proven against
the vocabulary and the file shape EasySchematic's own import accepts, and the installer's
"never a second install" guarantee is proven against a mock library answering on the real port.
What an actual EasySchematic does with the JSON is its own contract; ours is that we never send it
a word its import would refuse, and never install it twice.
"""

from __future__ import annotations

import json
import socketserver
import subprocess
import threading
from http.server import BaseHTTPRequestHandler
from pathlib import Path

from src.backend.services.easyschematic import (
    CATEGORY_DEVICE_TYPE,
    CONNECTOR_LABELS,
    ES_CONNECTOR_TYPES,
    ES_DEVICE_TYPE_CATEGORY,
    ES_DIRECTIONS,
    ES_SIGNAL_TYPES,
    build_devices,
    catalog_rows,
    connector_label,
    install_script_text,
    suggested_ports,
)

INTERFACE = {
    "id": "iface-1",
    "name": "Scarlett 2i2",
    "category": "Interface",
    "manufacturer": "Focusrite",
    "model": "2i2 3rd Gen",
}

PORTS = [
    {"label": "Input 1", "signalType": "analog-audio", "connectorType": "combo-xlr-trs", "direction": "input"},
    {"label": "To computer", "signalType": "usb", "connectorType": "usb-c", "direction": "bidirectional"},
]


def test_vocabulary_is_the_one_their_import_checks():
    # Frozen from their source rather than fetched at runtime, so export works with no install.
    assert "wired-mic" in ES_DEVICE_TYPE_CATEGORY
    assert "computer" in ES_DEVICE_TYPE_CATEGORY
    assert ES_DEVICE_TYPE_CATEGORY["wired-mic"] == "Microphones"
    assert "thunderbolt" in ES_SIGNAL_TYPES
    assert "combo-xlr-trs" in ES_CONNECTOR_TYPES
    assert {"input", "output", "bidirectional", "passthrough"} <= set(ES_DIRECTIONS)


def test_categories_map_to_device_kinds_that_exist():
    for kind in CATEGORY_DEVICE_TYPE.values():
        if kind is None:
            continue
        assert kind in ES_DEVICE_TYPE_CATEGORY


def test_authoring_keeps_the_real_ports_and_names_them():
    export = build_devices([INTERFACE], ports_by_id={"iface-1": PORTS})
    device = export["devices"][0]
    assert device["label"] == "Scarlett 2i2"
    assert device["deviceType"] == "audio-interface"
    assert device["ports"] == [
        {"id": "port-1", "label": "Input 1", "signalType": "analog-audio", "direction": "input", "connectorType": "combo-xlr-trs"},
        {"id": "port-2", "label": "To computer", "signalType": "usb", "direction": "bidirectional", "connectorType": "usb-c"},
    ]
    # The words that must find this device: maker, model, and every socket name, one word each.
    terms = [term.lower() for term in device["searchTerms"]]
    for needed in ("scarlett", "2i2", "focusrite", "to", "computer", "input", "1"):
        assert needed in terms
    assert export["warnings"] == []
    assert export["skipped"] == []


def test_unmapped_category_is_skipped_with_its_reason():
    laptop = {"id": "laptop-1", "name": "M1 laptop", "category": "Other", "manufacturer": "Apple", "model": "MacBook"}
    export = build_devices([laptop])
    assert export["devices"] == []
    assert export["skipped"] == [
        {"id": "laptop-1", "name": "M1 laptop", "reason": "Pick a device kind before sending it."}
    ]


def test_explicit_device_type_sends_the_laptop():
    # The user's own example: a laptop is not a Mac Mini, and the sender's choice decides.
    laptop = {"id": "laptop-1", "name": "M1 laptop", "category": "Other", "manufacturer": "Apple", "model": "MacBook"}
    export = build_devices([laptop], device_types_by_id={"laptop-1": "computer"})
    assert export["devices"][0]["deviceType"] == "computer"
    assert export["skipped"] == []


def test_a_port_outside_the_vocabulary_is_left_out_with_a_sentence():
    bogus = {"label": "Speakon out", "signalType": "speaker-level", "connectorType": "bogus", "direction": "output"}
    export = build_devices([INTERFACE], ports_by_id={"iface-1": [*PORTS, bogus]})
    assert len(export["devices"][0]["ports"]) == 2
    assert len(export["warnings"]) == 1
    assert "Speakon out" in export["warnings"][0]
    assert "bogus" in export["warnings"][0]


def test_no_ports_warns_the_sender_plainly():
    export = build_devices([INTERFACE])
    assert export["devices"][0]["ports"] == []
    assert any("no ports" in warning for warning in export["warnings"])


def test_missing_manufacturer_is_generic_and_missing_model_is_only_said_for_branded_gear():
    # No manufacturer -> Generic, and a generic device is complete without a model number.
    generic = {"id": "g-1", "name": "Mystery box", "category": "Interface", "manufacturer": "", "model": ""}
    export = build_devices([generic])
    device = export["devices"][0]
    assert device["manufacturer"] == "Generic"
    assert device["modelNumber"] is None
    assert not any("no model number" in warning for warning in export["warnings"])

    branded = {"id": "g-2", "name": "Lunchbox", "category": "Interface", "manufacturer": "Focusrite", "model": ""}
    export_branded = build_devices([branded])
    assert any("no model number" in warning for warning in export_branded["warnings"])


def test_suggested_ports_fall_back_to_one_input_and_labels_fall_back_to_slug():
    assert suggested_ports("audio-interface")[0]["connectorType"] == "combo-xlr-trs"
    assert suggested_ports("bogus-kind") == [
        {"label": "Input", "connectorType": "combo-xlr-trs", "signalType": "analog-audio", "direction": "input"}
    ]
    assert connector_label("xlr-3") == "XLR-3"
    assert connector_label("some-new-jack") == "Some New Jack"
    assert len(CONNECTOR_LABELS) < 50  # curated, not the whole 90


def test_catalog_rows_include_unarchived_and_report_missing_ids():
    from src.backend.services.storage import get_storage

    created = get_storage().create_equipment(_equipment())
    rows, missing = catalog_rows([created.id, "does-not-exist"])
    ids = {row["id"] for row in rows}
    assert created.id in ids
    assert missing == [{"id": "does-not-exist", "name": "does-not-exist", "reason": "No such device in the catalog."}]
    rows_all, missing_all = catalog_rows()
    assert len(rows_all) >= len(rows)
    assert missing_all == []


def _equipment():
    from src.backend.models.equipment import Equipment

    return Equipment(
        id="es-test-iface",
        name="Test ES interface",
        category="Interface",
        manufacturer="Focusrite",
        model="TestModel",
    )


# --- the HTTP surface ----------------------------------------------------------------------------
def test_export_endpoints_hold_the_envelope(client):
    created = client.post(
        "/api/v1/equipment",
        json={"name": "ES surface test", "manufacturer": "Focusrite", "category": "Interface", "model": "TestModel"},
    ).json()["equipment"]

    posted = client.post(
        "/api/v1/easyschematic/export",
        json={
            "ids": [created["id"]],
            "ports": {
                created["id"]: [
                    {"label": "Input 1", "signalType": "analog-audio", "connectorType": "xlr-3", "direction": "input"}
                ]
            },
            "device_types": {},
        },
    )
    assert posted.status_code == 200
    envelope = posted.json()
    assert envelope["devices"][0]["label"] == "ES surface test"
    assert envelope["devices"][0]["ports"][0]["connectorType"] == "xlr-3"
    assert set(envelope) == {"devices", "skipped", "warnings"}

    downloaded = client.get(f"/api/v1/easyschematic/export?ids={created['id']}&download=1")
    assert downloaded.status_code == 200
    assert downloaded.headers["content-disposition"] == 'attachment; filename="audiobiblica-devices.json"'
    assert json.loads(downloaded.text)["devices"][0]["label"] == "ES surface test"


def test_export_of_an_unknown_id_skips_instead_of_failing(client):
    response = client.post(
        "/api/v1/easyschematic/export", json={"ids": ["nope"], "ports": {}, "device_types": {}}
    )
    assert response.status_code == 200
    assert response.json()["skipped"] == [
        {"id": "nope", "name": "nope", "reason": "No such device in the catalog."}
    ]


def test_suggest_endpoint_returns_a_choice_and_the_vocabulary(client):
    created = client.post(
        "/api/v1/equipment",
        json={"name": "Suggester", "manufacturer": "Focusrite", "category": "Other", "model": "X"},
    ).json()["equipment"]
    suggestion = client.get(f"/api/v1/easyschematic/suggest?equipment_id={created['id']}")
    assert suggestion.status_code == 200
    payload = suggestion.json()
    assert payload["suggested_device_type"] is None  # "Other" is too broad to guess
    assert payload["ports"] == []
    vocab = payload["vocabulary"]
    assert vocab["device_types"]["computer"] == "Sources"
    assert "xlr-3" in vocab["connectors"]
    assert "analog-audio" in vocab["signals"]
    missing = client.get("/api/v1/easyschematic/suggest?equipment_id=nope")
    assert missing.status_code == 404

    # The editor re-asks with a kind; a computer's draft ports are not an interface's.
    kinded = client.get(f"/api/v1/easyschematic/suggest?equipment_id={created['id']}&device_type=computer")
    assert kinded.status_code == 200
    kinded_payload = kinded.json()
    assert kinded_payload["suggested_device_type"] == "computer"
    assert [port["connectorType"] for port in kinded_payload["ports"]][:2] == ["usb-c", "hdmi"]


def test_status_endpoint_answers_with_pieces_and_advice(client):
    # Whatever is running on this machine — often nothing — the answer is shape-stable.
    response = client.get("/api/v1/easyschematic/status")
    assert response.status_code == 200
    payload = response.json()
    assert set(payload["detected"]) == {"ui", "api", "mcp"}
    assert "running" in payload and "advice" in payload and "install" in payload
    assert payload["install"]["one_line"].startswith("bash <(curl")


def test_install_script_is_served_and_says_who_it_is(client):
    response = client.get("/api/v1/easyschematic/install-script")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert "duremovich/EasySchematic" in response.text
    assert response.text == install_script_text()


def test_installer_stops_when_one_is_already_answering(tmp_path):
    """The no-double-install guarantee, proven with a mock library on the real port.

    Found the hard way: a pipeline-based check and a `grep -q` that closed the pipe early made the
    installer walk straight past a running EasySchematic and clone a second one.
    """
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/templates":
                body = b'[{"id":"mock","deviceType":"audio-interface"}]'
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, *args):
            pass

    try:
        httpd = socketserver.TCPServer(("127.0.0.1", 8787), Handler)
    except OSError:
        # Something (a real EasySchematic, usually) already owns the port; the guarantee still holds
        # because the script must then detect *that* one — but this test environment cannot prove
        # it, and must not fight it.
        return
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        source_dir = tmp_path / "would-have-cloned"
        script = Path(__file__).resolve().parents[1] / "src/backend/services/easyschematic_install.sh"
        result = subprocess.run(
            ["bash", str(script)],
            capture_output=True,
            text=True,
            timeout=30,
            env={
                "PATH": "/usr/bin:/bin:/usr/local/bin",
                "HOME": str(tmp_path),
                "EASYSCHEMATIC_SOURCE_DIR": str(source_dir),
                "EASYSCHEMATIC_RUNTIME_DIR": str(tmp_path / "runtime"),
            },
        )
        assert result.returncode == 0, result.stdout
        assert "already answering" in result.stdout
        assert not source_dir.exists()
    finally:
        httpd.shutdown()
        thread.join(timeout=5)