"""Pairing, local-network addressing and the gate that protects the catalog.

The app runs on the user's own machine, but the container publishes its port on
every interface so a phone on the same wifi can reach it. That means "reachable"
and "trusted" are not the same thing: every request that does not come from this
computer has to present the pairing token. Everything about that token — where it
is stored, how a phone's address is turned into a URL, which origins the browser
is allowed to call from — lives here, so ``main.py`` holds the policy and this
module holds the mechanics.

Nothing in here talks to the network except :func:`lan_address`, which sends no
traffic: it connects a UDP socket to a reserved address to ask the kernel which
local interface it would use.
"""

from __future__ import annotations

import ipaddress
import os
import re
import secrets
import socket
from typing import Optional

from src.backend.config import get_config

#: Cookie a paired phone carries after its first visit with the token in the URL.
MOBILE_COOKIE = "audiobiblica_mobile"

#: Address the LAN lookup aims at. TEST-NET-1 (RFC 5737) is reserved and never
#: routed, so ``connect`` picks a route without a packet leaving the machine.
_PROBE_ADDRESS = "192.0.2.1"
_PROBE_PORT = 9

#: The vision model the capture page reads photos with, when the user has not
#: chosen one. Sized to read a panel and print on a laptop.
DEFAULT_VISION_MODEL = "qwen2.5vl:7b"


def mobile_token() -> Optional[str]:
    """The pairing token, or ``None`` when the user has never paired a phone.

    ``AUDIOBIBLICA_MOBILE_TOKEN`` wins over the stored one so a deployment can
    pin it; note that a pinned token is then not affected by
    :func:`regenerate_mobile_token`, which only writes the stored value.
    """
    return os.getenv("AUDIOBIBLICA_MOBILE_TOKEN") or get_config().get("mobile.token") or None


def regenerate_mobile_token() -> str:
    """Replace the stored token. Every phone already paired stops working."""
    token = secrets.token_urlsafe(32)
    get_config().set("mobile.token", token)
    return token


def ensure_mobile_token() -> str:
    """The pairing token, creating one on first use."""
    token = mobile_token()
    return token if token else regenerate_mobile_token()


def is_loopback(host: Optional[str]) -> bool:
    """Whether a client address is this computer.

    A missing address means the request did not arrive over TCP at all (the
    in-process test client, a unix socket); that is this computer. Anything that
    is not an IP address — a hostname, a proxy's placeholder — is not loopback:
    the safe answer for a gate is the suspicious one.
    """
    if not host:
        return True
    try:
        address = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return False
    return address.is_loopback


def is_local_host(host_header: Optional[str]) -> bool:
    """Whether a request's own ``Host`` names this computer.

    The client address is the better signal and is checked first, but a container
    does not get one: Docker publishes the port through its own forwarder, which
    rewrites the source of every arriving request to the VM gateway, so the
    machine's own browser and a phone on the wifi both arrive as the same address.

    A browser cannot forge ``Host`` — it is copied from the address bar — so a
    request that names ``localhost`` came from a page opened on this machine. What
    this gates is someone browsing to the machine's network address from another
    device; a client that sets the header by hand is deliberately lying rather
    than opportunity, which is the threat this is here to discourage.
    """
    value = (host_header or "").strip().lower()
    if not value:
        return False
    # A Host header is a name, a name:port, or an address — and an IPv6 literal is
    # either bracketed with a port or bare, where splitting on the first colon
    # would leave nothing behind.
    if value.startswith("["):
        name = value[1:].split("]", 1)[0]  # [::1]:8000
    elif value.count(":") > 1:
        name = value  # ::1
    else:
        name = value.split(":", 1)[0]
    if name in {"localhost", "::1"}:
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        return False


def lan_address() -> Optional[str]:
    """This machine's address on the local network, or ``None`` when it has none.

    ``AUDIOBIBLICA_LAN_ADDRESS`` overrides the guess for machines with several
    interfaces (docker bridges, VPNs) where the route picked is not the one the
    phone can reach.
    """
    override = (os.getenv("AUDIOBIBLICA_LAN_ADDRESS") or "").strip()
    if override:
        return override
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect((_PROBE_ADDRESS, _PROBE_PORT))
        return probe.getsockname()[0]
    except OSError:
        return None
    finally:
        probe.close()


def mobile_port() -> int:
    """The port the app is served on, as seen from the phone."""
    try:
        return int(os.getenv("AUDIOBIBLICA_PORT", "8000"))
    except ValueError:
        return 8000


def _url_host(address: str) -> str:
    """Bracket an IPv6 address so it can go in a URL."""
    return f"[{address}]" if ":" in address else address


def capture_url() -> Optional[str]:
    """The pairing URL for a phone, or ``None`` when there is no address to give.

    Calling this creates the token if there is none: showing the code is what
    pairs the phone, so the two have to happen together.
    """
    address = lan_address()
    if not address:
        return None
    return f"http://{_url_host(address)}:{mobile_port()}/capture?t={ensure_mobile_token()}"


def allowed_origin_regex() -> str:
    """Origins the browser may call the API from.

    The desktop talks to itself and the phone page is served from this same
    server, so this list exists only to stop a page somewhere else from reading
    the catalog. It is built from the same two addresses the gate trusts.
    """
    loopback = r"http://(127\.0\.0\.1|localhost|\[::1\])(:\d+)?"
    address = lan_address()
    if not address:
        return loopback
    return f"({loopback})|(http://{re.escape(_url_host(address))}(:\\d+)?)"


def vision_model() -> str:
    """The local vision model photos are read with."""
    return get_config().get(
        "assistant.vision_model",
        os.getenv("ASSISTANT_VISION_MODEL", DEFAULT_VISION_MODEL),
    )
