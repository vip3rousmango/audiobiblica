"""Read a product or support page and reduce it to plain text.

This is the default research path: no API key, no third-party service, no cloud
account. Firecrawl (``firecrawl_service``) stays available as an optional
accelerator for deep discovery, but adding a manual by link must work on a fresh
install with nothing else configured.

Errors are returned as text rather than raised, matching ``FirecrawlService``, so
a caller can show a plain sentence to the user.
"""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx

#: Characters of readable text kept, matching the Firecrawl path's cap.
MAX_TEXT_LENGTH = 18000
#: Refuse responses larger than this before decoding them.
MAX_BYTES = 5 * 1024 * 1024
#: Redirect hops followed, each one re-validated.
MAX_REDIRECTS = 5

#: Manufacturer and support sites routinely reject a bare library user agent.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

_SKIPPED_TAGS = {
    "script",
    "style",
    "nav",
    "header",
    "footer",
    "noscript",
    "svg",
    "form",
    "template",
}
_BLOCK_TAGS = {
    "address",
    "article",
    "blockquote",
    "br",
    "div",
    "dl",
    "dt",
    "dd",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "li",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "tr",
    "ul",
}

#: A pasted link must not be able to probe the machine AudioBiblica runs on.
_BLOCKED_HOST_NAMES = {"localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"}
_BLOCKED_HOST_SUFFIXES = (".local", ".localhost", ".internal", ".home.arpa")


@dataclass
class PageRead:
    """The result of reading one page: either text, or a reason it could not be read."""

    url: str
    title: str = ""
    text: str = ""
    error: str | None = None


class _TextExtractor(HTMLParser):
    """Collect visible text, remembering the document title."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._title_parts: list[str] = []
        self._parts: list[str] = []
        self._skipped = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIPPED_TAGS:
            self._skipped += 1
        elif tag == "title":
            self._in_title = True
        elif tag in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIPPED_TAGS:
            self._skipped = max(0, self._skipped - 1)
        elif tag == "title":
            self._in_title = False
        elif tag in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._title_parts.append(data)
            return
        if self._skipped:
            return
        if data.strip():
            self._parts.append(f"{data.strip()} ")

    def result(self) -> tuple[str, str]:
        title = " ".join("".join(self._title_parts).split())
        lines = [" ".join(line.split()) for line in "".join(self._parts).splitlines()]
        return title, "\n".join(line for line in lines if line)


def _host_is_local(host: str) -> bool:
    """True for loopback, private, link-local and reserved addresses and their names."""
    name = host.strip("[]").lower()
    if name in _BLOCKED_HOST_NAMES or name.endswith(_BLOCKED_HOST_SUFFIXES):
        return True
    try:
        address = ipaddress.ip_address(name)
    except ValueError:
        return False
    return (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
    )


def _reject(url: str) -> str | None:
    """Return a plain-language reason to refuse this URL, or None when it is fine."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return "Enter a web address that starts with http:// or https://"
    if not parsed.hostname:
        return "That web address is missing the site name."
    if _host_is_local(parsed.hostname):
        return "That address points at this computer, so AudioBiblica will not open it."
    return None


def read_page(url: str) -> PageRead:
    """Fetch one page and return its readable text, or why it could not be read."""
    candidate = (url or "").strip()
    if not candidate:
        return PageRead(url=candidate, error="Paste a web address first.")

    timeout = httpx.Timeout(20.0, connect=10.0)
    location = candidate
    try:
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            response: httpx.Response | None = None
            for _ in range(MAX_REDIRECTS + 1):
                reason = _reject(location)
                if reason:
                    return PageRead(url=location, error=reason)
                response = client.get(location, headers=_HEADERS)
                target = response.headers.get("location") if response.is_redirect else None
                if target:
                    location = urljoin(location, target)
                    continue
                break
            else:
                return PageRead(url=location, error="That link redirected too many times.")
    except httpx.HTTPError as exc:
        return PageRead(url=location, error=f"Could not reach that page: {exc}")

    if response is None:
        return PageRead(url=location, error="Could not reach that page.")
    if not response.is_success:
        return PageRead(url=location, error=f"That page answered with HTTP {response.status_code}.")
    if len(response.content) > MAX_BYTES:
        return PageRead(url=location, error="That page is larger than 5 MB, which is too big to read.")

    content_type = response.headers.get("content-type", "")
    if content_type and "html" not in content_type.lower():
        return PageRead(
            url=location,
            error="That link is a file, not a web page. Download it and import it as a PDF instead.",
        )

    extractor = _TextExtractor()
    extractor.feed(response.text)
    title, text = extractor.result()
    if not text:
        return PageRead(url=str(response.url), title=title, error="That page had no readable text.")
    return PageRead(url=str(response.url), title=title, text=text[:MAX_TEXT_LENGTH])
