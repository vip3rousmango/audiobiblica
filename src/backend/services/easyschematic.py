"""Author EasySchematic device templates from catalog devices, and probe a local install.

EasySchematic is the drawing tool the studio console runs: a device library with a fixed vocabulary
of signal types, connectors and device kinds, and an in-app import that accepts one template or an
array of them as JSON. AudioBiblica knows the user's *actual* gear — an M1 laptop with its own I/O,
not "Mac Mini" — so this module turns a catalog row plus its real ports into the template JSON that
import accepts. The vocabulary is frozen here, with its provenance in the comment below, because
authoring must not depend on the other app being present, and the same frozen table is what lets us
validate before the user ever pastes the file.

Nothing in this module writes into EasySchematic. Export is a download, detection is a probe, and
installation is a script the user chooses to run. That is this project's data-safety line, drawn for
one more app.
"""

from __future__ import annotations

import re
import socket
from pathlib import Path

import httpx

# ---------------------------------------------------------------------------
# The vocabulary, extracted from EasySchematic's own source rather than invented here:
#   device kinds   <checkout>/src/deviceTypeCategories.ts   `DEVICE_TYPE_TO_CATEGORY`   (commit 57724b3)
#   signal types   <checkout>/src/types.ts                  `export type SignalType`
#   connectors     <checkout>/src/types.ts                  `export type ConnectorType`
#   directions     <checkout>/src/types.ts                  `export type PortDirection`
# Its JSON import rejects anything outside these lists, so a word that is not here is a mistake we
# would otherwise let the user paste and only then watch be refused. Validating first lets the
# export carry an explanation instead.
ES_DEVICE_TYPE_CATEGORY: dict[str, str] = {
    "24vdc-power-supply": "Control",
    "access-point": "Networking",
    "adapter": "Processing",
    "amplifier": "Amplifiers",
    "antenna": "Wireless",
    "antenna-distribution": "Wireless",
    "assistive-listening": "Audio",
    "audio-bar": "Audio",
    "audio-dsp": "Audio",
    "audio-embedder": "Audio I/O",
    "audio-interface": "Audio I/O",
    "audio-matrix": "Audio",
    "audio-meter": "Monitoring",
    "audio-mixer": "Mixing Consoles",
    "audio-over-cat-extender": "Audio",
    "audio-splitter": "Audio I/O",
    "av-over-ip": "Networking",
    "avoip-decoder": "Networking",
    "avoip-encoder": "Networking",
    "battery": "Infrastructure",
    "bus-power-supply": "Control",
    "button-panel": "Control",
    "cable-accessory": "Cable Accessories",
    "camera": "Sources",
    "camera-ccu": "Sources",
    "camera-tracker": "Sources",
    "capture-card": "Processing",
    "change-over": "Expansion Cards",
    "charging-station": "Microphones",
    "chromakey": "Processing",
    "cloud-service": "Cloud Services",
    "codec": "Codecs",
    "commentary-box": "Intercom",
    "company-switch": "Infrastructure",
    "computer": "Sources",
    "conference-system": "Audio",
    "conferencing-bridge": "Networking",
    "control-expansion": "Control",
    "control-processor": "Control",
    "controller": "Control",
    "converter": "Processing",
    "da": "Distribution",
    "dali-power-supply-and-line-break": "Lighting",
    "di-box": "Audio",
    "digital-signage-player": "Media Servers",
    "display": "Displays",
    "dmx-node": "Lighting",
    "dmx-splitter": "Lighting",
    "dock": "Peripherals",
    "door-strike": "Monitoring",
    "dry-contact": "Control",
    "equalizer": "Audio",
    "expansion-card": "Expansion Cards",
    "expansion-chassis": "Audio Expansion",
    "external-storage": "Storage",
    "fiber-transmitter": "KVM / Extenders",
    "fog-machine": "Lighting",
    "frame": "Infrastructure",
    "frame-sync": "Processing",
    "gateway": "Control",
    "graphics": "Sources",
    "hard-drive": "Storage",
    "hdbaset-extender": "KVM / Extenders",
    "hdmi-extender": "KVM / Extenders",
    "hdmi-splitter": "Distribution",
    "headphone-amplifier": "Audio",
    "iem-transmitter": "Microphones",
    "intercom": "Intercom",
    "intercom-transceiver": "Intercom",
    "interpreter-desk": "Intercom",
    "keyboard": "Peripherals",
    "keypad": "Control",
    "kvm-extender": "KVM / Extenders",
    "led-cabinet": "LED Video",
    "led-fixture": "Lighting",
    "led-processor": "LED Video",
    "lighting-console": "Lighting",
    "lighting-processor": "Lighting",
    "lighting-relay": "Lighting",
    "magnetic-sensor": "Monitoring",
    "media-player": "Sources",
    "media-server": "Media Servers",
    "midi-device": "Control",
    "monitor": "Displays",
    "monitor-controller": "Audio",
    "mouse": "Peripherals",
    "moving-light": "Lighting",
    "mtr-pc": "Codecs",
    "multiviewer": "Processing",
    "nas": "Storage",
    "ndi-decoder": "Networking",
    "ndi-encoder": "Networking",
    "network-router": "Networking",
    "network-switch": "Networking",
    "network-wifi": "Networking",
    "occupancy-sensor": "Control",
    "patch-panel": "Infrastructure",
    "pattern-generator": "Sources",
    "personal-monitor": "Audio",
    "phone-hybrid": "Intercom",
    "pir-sensor": "Control",
    "power-distribution": "Infrastructure",
    "power-mixer": "Powered Mixers",
    "power-supply": "Infrastructure",
    "presentation-system": "Switching",
    "projector": "Projection",
    "ptz-camera": "Sources",
    "ptz-controller": "Control",
    "recorder": "Recording",
    "rf-to-ethernet-integrator": "Networking",
    "router": "Switching",
    "scaler": "Processing",
    "screen": "Projection",
    "siren": "Monitoring",
    "speaker": "Speakers",
    "stage-box": "Audio I/O",
    "storage-media": "Storage Media",
    "streaming-decoder": "Networking",
    "streaming-encoder": "Networking",
    "streaming-transceiver": "Networking",
    "studio-monitor": "Speakers",
    "subwoofer": "Speakers",
    "switcher": "Switching",
    "sync-generator": "Control",
    "synthesizer": "Audio",
    "table-box": "Cable Accessories",
    "tally-system": "Control",
    "timecode-generator": "Control",
    "touch-controller": "Control",
    "touch-screen": "Control",
    "turret-camera": "Monitoring",
    "tv": "Displays",
    "ups": "Infrastructure",
    "usb-extender": "KVM / Extenders",
    "v-lock": "Monitoring",
    "video-bar": "Codecs",
    "video-scope": "Monitoring",
    "video-transceiver": "Networking",
    "video-wall-controller": "Distribution",
    "wall-plate": "Infrastructure",
    "wired-mic": "Microphones",
    "wireless-mic-receiver": "Microphones",
    "wireless-presentation": "Switching",
    "wireless-video": "Wireless",
}

ES_SIGNAL_TYPES: frozenset[str] = frozenset((
    "adat",
    "aes",
    "aes50",
    "aes67",
    "analog-audio",
    "artnet",
    "avb",
    "blu-link",
    "bluetooth",
    "component-video",
    "composite",
    "contact-closure",
    "control-voltage",
    "cresnet",
    "custom",
    "dante",
    "dars",
    "digilink",
    "displayport",
    "dmx",
    "dsnake",
    "dvi",
    "dx5",
    "dxlink",
    "ebus",
    "ethernet",
    "extron-exp",
    "fiber",
    "fibreace",
    "genlock",
    "gigaace",
    "gpio",
    "gps",
    "hdbaset",
    "hdmi",
    "ir",
    "madi",
    "midi",
    "mpeg-ts",
    "ndi",
    "nlight",
    "pots",
    "power",
    "power-ground",
    "power-l1",
    "power-l2",
    "power-l3",
    "power-neutral",
    "rf",
    "rs422",
    "rs485",
    "rtmp",
    "rtsp",
    "s-video",
    "sacn",
    "sdi",
    "sensor",
    "serial",
    "slink",
    "soundgrid",
    "spdif",
    "speaker-level",
    "srt",
    "st2110",
    "stageconnect",
    "tally",
    "thunderbolt",
    "timecode",
    "ultranet",
    "usb",
    "vga",
    "wordclock",
    "ydif",
))

ES_CONNECTOR_TYPES: frozenset[str] = frozenset((
    "banana",
    "barrel",
    "binding-post",
    "binding-post-banana",
    "bnc",
    "cam-lok",
    "combo-xlr-trs",
    "d-hole-insert",
    "d-tap",
    "db15",
    "db25",
    "db37",
    "db7w2",
    "db9",
    "digilink",
    "din-5",
    "displayport",
    "dvi",
    "edison",
    "ethercon",
    "europlug",
    "f-connector",
    "french-power",
    "hdmi",
    "iec",
    "iec-c15",
    "iec-c20",
    "iec-c5",
    "iec-c7",
    "krone-idc",
    "kycon-4pin",
    "l21-30",
    "l5-20",
    "l6-20",
    "l6-30",
    "lc",
    "lemo-2pin",
    "lemo-4pin",
    "lemo-5pin",
    "micro-hdmi",
    "mini-din-4",
    "mini-din-7",
    "mini-din-8",
    "mini-displayport",
    "mini-hdmi",
    "mini-xlr",
    "mpo",
    "multipin",
    "none",
    "opticalcon",
    "other",
    "pcie-6pin",
    "phoenix",
    "powercon",
    "powercon-true1",
    "punch-down-110",
    "punch-down-66",
    "qsfp",
    "qsfp28",
    "rca",
    "reverse-tnc",
    "rj11",
    "rj12",
    "rj45",
    "sc",
    "schuko",
    "sfp",
    "sma",
    "socapex",
    "solder-cup",
    "speakon",
    "st",
    "terminal-block",
    "toslink",
    "trs-2.5mm",
    "trs-eighth",
    "trs-quarter",
    "ts-quarter",
    "uk-power",
    "usb-a",
    "usb-b",
    "usb-c",
    "usb-micro",
    "usb-mini",
    "v-mount",
    "vga",
    "wireless",
    "xlr-3",
    "xlr-4",
    "xlr-5",
))

ES_DIRECTIONS: frozenset[str] = frozenset(("input", "output", "bidirectional", "passthrough"))

#: Human names for the connectors a studio actually meets; anything else falls back to the slug,
#: which is honest enough for a pick list the user double-checks by hand.
CONNECTOR_LABELS: dict[str, str] = {
    "xlr-3": "XLR-3",
    "xlr-4": "XLR-4",
    "xlr-5": "XLR-5",
    "combo-xlr-trs": "XLR/TRS combo",
    "trs-quarter": '1/4\" TRS',
    "ts-quarter": '1/4\" TS',
    "trs-eighth": "3.5 mm TRS",
    "trs-2.5mm": "2.5 mm TRS",
    "mini-xlr": "Mini XLR",
    "rca": "RCA",
    "toslink": "Toslink",
    "din-5": "DIN-5 (MIDI)",
    "usb-a": "USB-A",
    "usb-b": "USB-B",
    "usb-c": "USB-C",
    "usb-mini": "USB Mini",
    "usb-micro": "USB Micro",
    "rj45": "RJ45 (Ethernet)",
    "ethercon": "EtherCON",
    "speakon": "Speakon",
    "iec": "IEC (mains)",
    "edison": "Edison (mains)",
    "banana": "Banana plug",
    "binding-post": "Binding post",
    "barrel": "Barrel (DC)",
    "db25": "DB25",
    "db9": "DB9",
    "phoenix": "Phoenix block",
    "terminal-block": "Terminal block",
    "hdmi": "HDMI",
    "displayport": "DisplayPort",
    "bnc": "BNC",
    "wireless": "Wireless",
    "none": "No connector",
    "other": "Other",
}

def connector_label(slug: str) -> str:
    """The name a connector is shown by; falls back to the slug, spaced and capitalised."""
    return CONNECTOR_LABELS.get(slug, slug.replace("-", " ").title())

#: AudioBiblica category -> the closest EasySchematic device kind, or None when the category is too
#: broad to guess. "Outboard -> equalizer" would be false for a compressor, and the vocabulary has
#: no laptop at all, so those stay None and the sender picks; the panel's suggested default makes
#: that one click.
CATEGORY_DEVICE_TYPE: dict[str, str | None] = {
    "Microphone": "wired-mic",
    "Interface": "audio-interface",
    "Monitor": "speaker",
    "Console": "audio-mixer",
    "Instrument": None,
    "Outboard": None,
    "Other": None,
}

#: First-draft ports per device kind, shown in the editor and replaced freely. Starting points,
#: not claims about the user's gear.
_SUGGESTED_PORTS: dict[str, list[tuple[str, str, str, str]]] = {
    "wired-mic": [("Mic out", "xlr-3", "analog-audio", "output")],
    "audio-interface": [
        ("Input 1", "combo-xlr-trs", "analog-audio", "input"),
        ("Input 2", "combo-xlr-trs", "analog-audio", "input"),
        ("Line out", "trs-quarter", "analog-audio", "output"),
        ("Headphones", "trs-quarter", "analog-audio", "output"),
        ("To computer", "usb-c", "usb", "bidirectional"),
    ],
    "speaker": [("Input", "xlr-3", "analog-audio", "input")],
    "audio-mixer": [
        ("Mic in", "xlr-3", "analog-audio", "input"),
        ("Main out L", "xlr-3", "analog-audio", "output"),
        ("Main out R", "xlr-3", "analog-audio", "output"),
    ],
    "computer": [
        ("USB-C", "usb-c", "thunderbolt", "bidirectional"),
        ("HDMI", "hdmi", "hdmi", "output"),
        ("Headphones", "trs-eighth", "analog-audio", "output"),
        ("Power in", "barrel", "power", "input"),
    ],
    "wireless-mic-receiver": [("Audio out", "xlr-3", "analog-audio", "output")],
    "audio-dsp": [("In", "xlr-3", "analog-audio", "input"), ("Out", "xlr-3", "analog-audio", "output")],
    "equalizer": [("In", "xlr-3", "analog-audio", "input"), ("Out", "xlr-3", "analog-audio", "output")],
    "amplifier": [("Speaker out", "speakon", "speaker-level", "output")],
    "headphone-amplifier": [("Headphone out", "trs-quarter", "analog-audio", "output")],
    "synthesizer": [("Main out", "ts-quarter", "analog-audio", "output")],
}

_MAX_STRING = 200  # their validator's ceiling for labels and model numbers
_MAX_SEARCH_TERMS = 20


def suggested_device_type(category: str, name: str, model: str | None) -> str | None:
    """The device kind to pre-select in the editor, or None when the sender must pick.

    A keyboard instrument is the one Instrument the vocabulary has; everything else in that
    category is a speaker or a string, so the word test is deliberately narrow.
    """
    default = CATEGORY_DEVICE_TYPE.get(category)
    if default is not None:
        return default
    if category == "Instrument" and re.search(r"synth|wurlitzer|mellotron|drum machine", f"{name} {model}", re.I):
        return "synthesizer"
    return None


def suggested_ports(device_type: str) -> list[dict]:
    """A category-shaped first draft of ports, for the editor's starting state."""
    rows = _SUGGESTED_PORTS.get(device_type) or [("Input", "combo-xlr-trs", "analog-audio", "input")]
    return [
        {"label": label, "connectorType": connector, "signalType": signal, "direction": direction}
        for label, connector, signal, direction in rows
    ]


def _validated_port(raw: dict, number: int) -> tuple[dict | None, str | None]:
    """One editor port turned into import JSON, or the sentence explaining why it was left out."""
    label = str(raw.get("label") or "").strip() or f"Port {number}"
    if len(label) > _MAX_STRING:
        return None, f"'{label[:40]}…' was left out: labels are 200 characters at most."
    signal = raw.get("signalType")
    if signal not in ES_SIGNAL_TYPES:
        return None, f"'{label}' was left out: {signal or 'missing'} is not a signal EasySchematic knows."
    connector = raw.get("connectorType")
    if connector not in ES_CONNECTOR_TYPES:
        return None, (
            f"'{label}' was left out: {connector or 'missing'} is not a connector it knows."
        )
    direction = raw.get("direction") or "input"
    if direction not in ES_DIRECTIONS:
        return None, f"'{label}' was left out: {direction} is not a direction it knows."
    return {
        "id": f"port-{number}",
        "label": label,
        "signalType": signal,
        "direction": direction,
        "connectorType": connector,
    }, None


def _search_terms(equipment: dict, ports: list[dict]) -> list[str]:
    """Words that must find this device: its names, and what each port is called."""
    words: list[str] = []
    for field in (equipment.get("name"), equipment.get("manufacturer"), equipment.get("model")):
        words.extend(re.findall(r"[a-z0-9.'/+-]+", str(field or "").lower()))
    for port in ports:
        words.extend(re.findall(r"[a-z0-9.'/+-]+", port["label"].lower()))
    seen: set[str] = set()
    terms: list[str] = []
    for word in words:
        if word not in seen:
            seen.add(word)
            terms.append(word)
    return terms[:_MAX_SEARCH_TERMS]


def build_devices(
    equipment: list[dict],
    ports_by_id: dict[str, list[dict]] | None = None,
    device_types_by_id: dict[str, str] | None = None,
) -> dict:
    """The export payload: import-ready templates plus everything skipped, and why.

    A port that does not validate is left out with a sentence naming it; a device is skipped whole
    only when nothing can say what kind of thing it is — the one field their import will not
    derive for us.
    """
    ports_by_id = ports_by_id or {}
    device_types_by_id = device_types_by_id or {}
    devices: list[dict] = []
    skipped: list[dict] = []
    warnings: list[str] = []

    for item in equipment:
        eid = item.get("id") or item.get("name")
        device_type = device_types_by_id.get(eid) or suggested_device_type(
            item.get("category", "Other"), item.get("name", ""), item.get("model")
        )
        if not device_type or device_type not in ES_DEVICE_TYPE_CATEGORY:
            skipped.append(
                {"id": eid, "name": item.get("name") or "", "reason": "Pick a device kind before sending it."}
            )
            continue

        ports: list[dict] = []
        for number, raw in enumerate(ports_by_id.get(eid, []), start=1):
            port, problem = _validated_port(raw, number)
            if problem:
                warnings.append(problem)
            elif port:
                ports.append(port)

        name = str(item.get("name") or "").strip()[:200]
        manufacturer = str(item.get("manufacturer") or "Generic")[:200]
        model = str(item.get("model") or "")[:200]
        if not model and manufacturer != "Generic":
            warnings.append(f"{name or 'A device'} has no model number; EasySchematic may ask for one.")

        devices.append(
            {
                "label": name,
                "deviceType": device_type,
                "manufacturer": manufacturer,
                "modelNumber": model or None,
                "searchTerms": _search_terms(item, ports),
                "ports": ports,
            }
        )
        if not ports:
            warnings.append(
                f"{name or 'A device'} was sent with no ports; draw its sockets for it to be "
                "searched by them."
            )

    return {"devices": devices, "skipped": skipped, "warnings": warnings}


# ---------------------------------------------------------------------------
# Detecting a local install. The app usually runs in a container, and inside one, "localhost" is
# the container — so the probe walks the loopback names and then the container's gate to the host.
# The same lesson as `/api/v1/service/info`, applied to one more service.
_UI_HOSTS = ("127.0.0.1", "localhost", "host.docker.internal")
_UI_PORT = 8080
_API_PORT = 8787
_MCP_PORT = 8765


async def probe_easyschematic(timeout: float = 2.0) -> dict:
    """What part of a local EasySchematic is actually there, as pieces and a sentence."""
    ui: dict | None = None
    api: dict | None = None
    mcp: dict | None = None

    async with httpx.AsyncClient(timeout=timeout) as client:
        for host in _UI_HOSTS:
            try:
                response = await client.get(f"http://{host}:{_UI_PORT}/")
            except (httpx.HTTPError, OSError):
                continue
            if 200 <= response.status_code < 400:
                ui = {"up": True, "url": f"http://{host}:{_UI_PORT}"}
                break
        for host in _UI_HOSTS:
            for path in ("/templates", "/health"):
                try:
                    response = await client.get(f"http://{host}:{_API_PORT}{path}")
                except (httpx.HTTPError, OSError):
                    continue
                if 200 <= response.status_code < 400:
                    templates = None
                    if path == "/templates":
                        try:
                            payload = response.json()
                            if isinstance(payload, list):
                                templates = len(payload)
                        except ValueError:
                            pass
                    api = {
                        "up": True,
                        "url": f"http://{host}:{_API_PORT}",
                        "templates": templates,
                    }
                    break
            if api:
                break

    for host in _UI_HOSTS:
        try:
            with socket.create_connection((host, _MCP_PORT), timeout=min(timeout, 2.0)):
                mcp = {"up": True, "url": f"ws://{host}:{_MCP_PORT}"}
                break
        except (OSError, socket.gaierror):
            continue

    running = bool(ui or api)
    return {
        "detected": {"ui": ui, "api": api, "mcp": mcp},
        "running": running,
        "advice": _advice(ui, api),
        "install": install_advice(),
    }


def _advice(ui: dict | None, api: dict | None) -> str:
    if ui:
        return (
            f"EasySchematic is running on this computer ({ui['url']}). We will use it and never "
            "install a second one."
        )
    if api:
        return (
            "EasySchematic's device library is answering on this computer, though its app is not "
            "open. Start it, or keep exporting and open the file wherever you draw."
        )
    return (
        "No EasySchematic is answering on this computer. Exports still work; the JSON opens in "
        "any EasySchematic. To run one here, use the install command below — it checks first "
        "and never installs a second copy."
    )


def install_advice() -> dict:
    """The option to run EasySchematic locally: what it does, and the one command that does it."""
    return {
        "script_path": "/api/v1/easyschematic/install-script",
        "one_line": "bash <(curl -fsSL {origin}/api/v1/easyschematic/install-script)",
        "steps": [
            "Checks for an existing EasySchematic first and stops, untouched, if one answers.",
            "Clones the open-source app from GitHub into ~/EasySchematic (reusing an existing checkout).",
            "Seeds its offline device library, then builds and starts its app on port 8080.",
            "Needs git, a recent Node, and Docker Desktop; the first build takes a few minutes.",
        ],
    }


def install_script_text() -> str:
    """The scaffold script, kept as a real file beside this module: one source, one copy."""
    return Path(__file__).with_name("easyschematic_install.sh").read_text()


def catalog_rows(ids: list[str] | None = None) -> tuple[list[dict], list[dict]]:
    """Catalog rows for the exporter: the asked-for devices — or every non-archived one — plus the
    asked-for ids that do not exist, as skips with a reason. One read-out, shared by the route and
    the MCP tool; a bulk export where one device vanished mid-click still delivers the other nine.
    """
    from src.backend.services.storage import get_storage

    storage = get_storage()
    missing: list[dict] = []
    if not ids:
        chosen = [item for item in storage.list_equipment() if not item.archived]
    else:
        chosen = []
        for raw_id in ids:
            item = storage.get_equipment(raw_id)
            if item is None:
                missing.append({"id": raw_id, "name": raw_id, "reason": "No such device in the catalog."})
            else:
                chosen.append(item)
    rows = [
        {
            "id": item.id,
            "name": item.name,
            "category": item.category,
            "manufacturer": item.manufacturer,
            "model": item.model,
        }
        for item in chosen
    ]
    return rows, missing
