"""Who gets in: the gate that protects the catalog from other machines.

Deliberately does not cover the pairing flow from a real phone or the vision model
behind it — what is tested here is which requests are let through, which is the
part that has broken in practice.

This module exists because of a bug the published image showed and no test did:
Docker publishes the port through its own forwarder, which rewrites the source of
every arriving request to the VM gateway. The client address therefore says the
same thing for the machine's own browser as for a phone on the wifi, and the gate
answered its owner with 401 — a lockout, on the only install path most users have.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.backend.main import create_app, mount_ui
from src.backend.services.mobile import (
    MOBILE_COOKIE,
    ensure_mobile_token,
    is_local_host,
    is_loopback,
)

#: What Docker Desktop's port forwarder presents as the client, for every request
#: that arrives through a published port — from the machine itself or from the LAN.
DOCKER_FORWARDER = ("192.168.65.1", 51234)

#: The two host names a request can carry, and what they mean.
LOCAL_HOST = "http://localhost:8000"
NETWORK_HOST = "http://10.0.0.50:8000"

REFUSED = "only reachable from the computer it runs on"


PROBE = "/probe"


def gated_client(base_url: str, address: tuple[str, int] = DOCKER_FORWARDER) -> TestClient:
    """A client of its own, because the address it presents is the thing under test.

    The routes live on the module-level app, registered by decorators, and a second
    client on that app cannot start the MCP session manager twice. So this builds a
    fresh app — which carries the gate — and gives it one route of its own to answer
    on, which is what makes "let through" observable as 200 rather than as a 404.
    """
    application = create_app()

    @application.get(PROBE)
    async def probe() -> dict:
        return {"ok": True}

    mount_ui(application)
    return TestClient(application, base_url=base_url, client=address)


def test_the_machines_own_browser_is_trusted_through_the_forwarder():
    """`http://localhost:8000` in the owner's browser must not be answered with 401.

    This is the regression: the address is Docker's gateway, so the host name is
    the only thing left that says which machine the page was opened on.
    """
    with gated_client(LOCAL_HOST) as client:
        assert client.get(PROBE).status_code == 200, "the owner's own browser was refused"


def test_a_browser_at_the_network_address_needs_the_token():
    """A page opened at the machine's network address is somebody else's browser."""
    with gated_client(NETWORK_HOST) as client:
        refused = client.get(PROBE)
        assert refused.status_code == 401
        assert REFUSED in refused.json()["detail"]

    # A host name that merely contains the word is not the machine.
    with gated_client("http://localhost.example.com:8000") as client:
        assert client.get(PROBE).status_code == 401


def test_the_pairing_link_gets_a_phone_through():
    """The token in the URL, then the cookie it sets, are what a phone uses."""
    token = ensure_mobile_token()
    with gated_client(NETWORK_HOST) as client:
        paired = client.get(f"{PROBE}?t={token}")
        assert paired.status_code == 200, paired.text
        assert MOBILE_COOKIE in paired.headers.get("set-cookie", "")

        marked = client.cookies.get(MOBILE_COOKIE)
        assert marked == token
        assert client.get(PROBE).status_code == 200

    with gated_client(NETWORK_HOST) as client:
        assert client.get(f"{PROBE}?t=wrong").status_code == 401
        client.cookies.set(MOBILE_COOKIE, "wrong")
        assert client.get(PROBE).status_code == 401


def test_loopback_is_still_trusted_without_a_token():
    """The host install and the container's own healthcheck both come from loopback."""
    with gated_client(NETWORK_HOST, address=("127.0.0.1", 51234)) as client:
        assert client.get(PROBE).status_code == 200


@pytest.mark.parametrize(
    "host,expected",
    [
        ("localhost", True),
        ("localhost:8000", True),
        ("LOCALHOST:8000", True),
        ("127.0.0.1", True),
        ("127.0.0.1:8000", True),
        ("127.0.0.53:8000", True),
        ("[::1]:8000", True),
        ("::1", True),
        ("10.0.0.50:8000", False),
        ("localhost.example.com:8000", False),
        ("notlocalhost", False),
        ("example.com", False),
        ("", False),
        (None, False),
    ],
)
def test_local_host_recognises_only_this_machine(host, expected):
    assert is_local_host(host) is expected


def test_loopback_treats_a_missing_address_as_this_machine():
    """No address means the request never crossed a network — in-process or a socket."""
    assert is_loopback(None) is True
    assert is_loopback("::1") is True
    assert is_loopback("192.168.65.1") is False
    assert is_loopback("localhost") is False, "a name in a client field is not a guarantee"


def test_mobile_status_says_where_the_pairing_address_came_from(client, monkeypatch):
    """Settings shows a code only when the address was chosen, never when it was guessed.

    Inside a container the guess returns the container's own address, which no phone
    can reach — so the interface needs to be told the difference, or it offers a code
    that fails for a reason nobody can see.
    """
    monkeypatch.setenv("AUDIOBIBLICA_LAN_ADDRESS", "192.168.7.7")
    chosen = client.get("/api/v1/mobile/status").json()
    assert chosen["address"] == "192.168.7.7"
    assert chosen["address_source"] == "override"
    assert "192.168.7.7:8000/capture?t=" in chosen["url"]

    monkeypatch.delenv("AUDIOBIBLICA_LAN_ADDRESS")
    guessed = client.get("/api/v1/mobile/status").json()
    assert guessed["address_source"] == "guessed"
    # A bool either way: the suite runs on a machine here, but inside a container
    # this is True and that is what the interface keys off.
    assert isinstance(guessed["in_container"], bool)
