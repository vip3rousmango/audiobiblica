"""Manufacturer website scraping service using Firecrawl (firecrawl.dev).

Provides search, scrape, extract, and crawl capabilities for discovering
and ingesting audio equipment documentation from manufacturer websites.

The Firecrawl SDK returns pydantic models (``SearchData``, ``Document``,
``MapData``, ``CrawlJob``), not dictionaries, so every response is normalised
through the helpers below before it reaches callers.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class ScrapeResult:
    """Result of scraping a single URL."""
    url: str
    title: Optional[str] = None
    markdown: Optional[str] = None
    html: Optional[str] = None
    links: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None


@dataclass
class SearchResult:
    """Result from a web search query."""
    query: str
    results: List[ScrapeResult] = field(default_factory=list)
    error: Optional[str] = None


@dataclass
class ExtractResult:
    """Structured extraction result from URLs."""
    data: Dict[str, Any] = field(default_factory=dict)
    sources: List[str] = field(default_factory=list)
    error: Optional[str] = None



SPECIFICATION_FIELDS = (
    "input_voltage",
    "output_voltage",
    "output_power",
    "frequency_response",
    "dimensions",
    "weight",
    "signal_to_noise",
    "total_harmonic_distortion",
    "impedance",
    "gain",
    "phantom_power",
    "connectivity",
)

# Firecrawl rejects objects described only by `additionalProperties`, so the
# specification keys are listed explicitly. They match the keys the local PDF
# extractor produces, so specs look the same whichever source filled them in.
EQUIPMENT_EXTRACTION_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "manufacturer": {"type": "string"},
        "model": {"type": "string"},
        "category": {"type": "string"},
        "description": {"type": "string"},
        "specifications": {
            "type": "object",
            "properties": {name: {"type": "string"} for name in SPECIFICATION_FIELDS},
            "description": "Only include values the page states explicitly, with units.",
        },
        "confidence": {"type": "number"},
    },
    "required": ["manufacturer", "model", "specifications"],
}

_MANUFACTURER_DOMAINS: Dict[str, List[str]] = {
    "neve": ["neve-electronics.com", "amst.com", "soundonsound.com"],
    "api": ["apiaudio.com", "apialgear.com"],
    "ssl": ["solidstatelogic.com"],
    "telefunken": ["telefunken-elektroakustik.com"],
    "akg": ["akg.com"],
    "neumann": ["neumann.com"],
    "sennheiser": ["sennheiser.com"],
    "shure": ["shure.com"],
    "electro-voice": ["electrovoice.com"],
    "yamaha": ["yamahaproaudio.com", "yamaha.com"],
    "universal audio": ["uaudio.com", "universalaudio.com"],
    "manley": ["manleylabs.com"],
    "avalon": ["avalon-design.com"],
    "dangerous": ["dangerousmusic.com"],
    "chandler": ["chandlerlimited.com"],
    "grace": ["gracedesign.com"],
    "millennia": ["millenniamusic.com"],
    "rupert neve": ["rupertneve.com", "rnndesigns.com"],
    "dbx": ["dbxpro.com"],
    "eventide": ["eventideaudio.com"],
    "lexicon": ["lexicon.com"],
    "bricasti": ["bricasti.com"],
    "tascam": ["tascam.com"],
    "fostex": ["fostexinternational.com", "fostex.jp"],
    "studer": ["studer.ch"],
    "mci": ["mci-audio.com"],
    "trident": ["tridentaudio.com"],
    "harrison": ["harrisonconsoles.com"],
    "audient": ["audient.com"],
    "focusrite": ["focusrite.com", "support.focusrite.com"],
    "presonus": ["presonus.com"],
    "m-audio": ["m-audio.com"],
    "behringer": ["behringer.com"],
    "tannoy": ["tannoy.com"],
    "genelec": ["genelec.com"],
    "adam": ["adam-audio.com"],
    "focal": ["focal.com"],
    "dynaudio": ["dynaudio.com"],
    "kali": ["kaliaudio.com"],
    "jbl": ["jblpro.com"],
}


def _field(source: Any, name: str, default: Any = None) -> Any:
    """Read one attribute from a pydantic model, dataclass, or plain mapping."""
    if source is None:
        return default
    if isinstance(source, dict):
        return source.get(name, default)
    return getattr(source, name, default)


def _metadata_dict(document: Any) -> Dict[str, Any]:
    metadata = _field(document, "metadata")
    if isinstance(metadata, dict):
        return metadata
    if hasattr(metadata, "model_dump"):
        return metadata.model_dump(exclude_none=True)
    return {}


def _document_to_result(document: Any, fallback_url: str = "") -> ScrapeResult:
    """Normalise a scraped ``Document`` (or a search hit) into a ScrapeResult."""
    metadata = _metadata_dict(document)
    markdown = _field(document, "markdown")
    if not markdown:
        markdown = _field(document, "description") or _field(document, "snippet")
    return ScrapeResult(
        url=_field(document, "url") or metadata.get("url") or metadata.get("source_url") or fallback_url,
        title=_field(document, "title") or metadata.get("title"),
        markdown=markdown,
        html=_field(document, "html") or _field(document, "raw_html"),
        links=list(_field(document, "links") or []),
        metadata=metadata,
    )


def _scrape_options(formats: List[Any], only_main_content: bool = True) -> Any:
    """Build a v2 ScrapeOptions object, or a plain dict for older SDKs."""
    try:
        from firecrawl.v2.types import ScrapeOptions
    except ImportError:
        return {"formats": formats, "only_main_content": only_main_content}
    return ScrapeOptions(formats=formats, only_main_content=only_main_content)


def _json_format(schema: Dict[str, Any], prompt: str) -> Dict[str, Any]:
    return {"type": "json", "schema": schema, "prompt": prompt}


class FirecrawlService:
    """High-level service for audio equipment research using Firecrawl."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        api_url: Optional[str] = None,
    ):
        from src.backend.config import get_config
        config = get_config()
        self.api_key = api_key or config.firecrawl_api_key or os.getenv("FIRECRAWL_API_KEY")
        self.api_url = api_url or config.firecrawl_api_url or os.getenv("FIRECRAWL_API_URL")

        if not self.api_key:
            raise ValueError("FIRECRAWL_API_KEY is required. Configure it in Settings or set FIRECRAWL_API_KEY environment variable.")

        try:
            from firecrawl import Firecrawl
        except ImportError as exc:
            raise ImportError("Install firecrawl-py: pip install firecrawl-py") from exc

        options: Dict[str, Any] = {"api_key": self.api_key}
        if self.api_url:
            options["api_url"] = self.api_url
        self._client = Firecrawl(**options)

    # ------------------------------------------------------------------
    # Search & Discovery
    # ------------------------------------------------------------------
    def search(
        self,
        query: str,
        *,
        limit: int = 10,
        include_domains: Optional[List[str]] = None,
        exclude_domains: Optional[List[str]] = None,
        categories: Optional[List[str]] = None,
        scrape_options: Optional[Dict[str, Any]] = None,
    ) -> SearchResult:
        """Search the web and return normalised results."""
        try:
            options = scrape_options or {"formats": ["markdown", "links"]}
            response = self._client.search(
                query=query,
                limit=limit,
                include_domains=include_domains,
                exclude_domains=exclude_domains,
                categories=categories,
                sources=["web"],
                scrape_options=_scrape_options(list(options.get("formats", ["markdown", "links"]))),
            )
            hits = list(_field(response, "web") or [])
            return SearchResult(query=query, results=[_document_to_result(hit) for hit in hits])
        except Exception as e:
            return SearchResult(query=query, error=str(e))

    def search_manufacturer(
        self,
        manufacturer: str,
        model: str,
        query_type: str = "manual",
    ) -> SearchResult:
        """Specialized search for manufacturer equipment."""
        queries = {
            "manual": f"{manufacturer} {model} manual specifications pdf",
            "specs": f"{manufacturer} {model} technical specifications",
            "product": f"{manufacturer} {model} product page",
            "legacy": f"{manufacturer} {model} legacy archive discontinued",
        }
        query = queries.get(query_type, queries["manual"])

        return self.search(
            query=query,
            limit=15,
            include_domains=self._get_manufacturer_domains(manufacturer) or None,
            scrape_options={"formats": ["markdown", "links"]},
        )

    def _get_manufacturer_domains(self, manufacturer: str) -> List[str]:
        """Known manufacturer domains for focused search."""
        return _MANUFACTURER_DOMAINS.get(manufacturer.lower().strip(), [])

    # ------------------------------------------------------------------
    # Scraping
    # ------------------------------------------------------------------
    def scrape_url(
        self,
        url: str,
        *,
        formats: Optional[List[str]] = None,
        only_main_content: bool = True,
        wait_for: int = 0,
        actions: Optional[List[Dict[str, Any]]] = None,
    ) -> ScrapeResult:
        """Scrape a single URL with full content extraction."""
        try:
            document = self._client.scrape(
                url=url,
                formats=formats or ["markdown", "html", "links"],
                only_main_content=only_main_content,
                wait_for=wait_for,
                actions=actions,
            )
            result = _document_to_result(document, fallback_url=url)
            result.url = result.url or url
            return result
        except Exception as e:
            return ScrapeResult(url=url, error=str(e))

    def batch_scrape(
        self,
        urls: List[str],
        *,
        formats: Optional[List[str]] = None,
        only_main_content: bool = True,
    ) -> List[ScrapeResult]:
        """Scrape multiple URLs in parallel."""
        try:
            job = self._client.batch_scrape(
                urls,
                formats=formats or ["markdown", "links"],
                only_main_content=only_main_content,
                poll_interval=3,
                wait_timeout=180,
            )
            documents = list(_field(job, "data") or [])
            results = [_document_to_result(document) for document in documents]
            returned = {result.url for result in results}
            for url in urls:
                if url not in returned:
                    results.append(ScrapeResult(url=url, error="No content returned for this URL"))
            return results
        except Exception as e:
            return [ScrapeResult(url=url, error=str(e)) for url in urls]

    # ------------------------------------------------------------------
    # Structured Extraction
    # ------------------------------------------------------------------
    def extract_equipment_specs(
        self,
        urls: List[str],
        manufacturer: str,
        model: str,
    ) -> ExtractResult:
        """Extract structured specifications from documentation URLs."""
        prompt = (
            f"Extract the technical specifications for the {manufacturer} {model} "
            "from this page. Only report values the page actually states."
        )
        try:
            job = self._client.batch_scrape(
                urls,
                formats=[_json_format(EQUIPMENT_EXTRACTION_SCHEMA, prompt), "markdown"],
                only_main_content=True,
                poll_interval=3,
                wait_timeout=240,
            )
            documents = list(_field(job, "data") or [])
            data: Dict[str, Any] = {}
            sources: List[str] = []
            for document in documents:
                payload = _field(document, "json")
                if not isinstance(payload, dict) or not payload:
                    continue
                source = _field(document, "url") or _metadata_dict(document).get("url") or ""
                if source:
                    sources.append(source)
                for key, value in payload.items():
                    if key == "specifications" and isinstance(value, dict):
                        merged = data.setdefault("specifications", {})
                        if isinstance(merged, dict):
                            merged.update({str(k): v for k, v in value.items()})
                    elif value not in (None, "", [], {}):
                        data.setdefault(key, value)
            if not data:
                return ExtractResult(data={}, sources=sources, error="No structured data was returned for these URLs")
            return ExtractResult(data=data, sources=sources)
        except Exception as e:
            return ExtractResult(data={}, sources=[], error=str(e))

    # ------------------------------------------------------------------
    # Crawling & Mapping
    # ------------------------------------------------------------------
    def crawl_manufacturer(
        self,
        base_url: str,
        *,
        max_depth: int = 2,
        limit: int = 50,
        include_paths: Optional[List[str]] = None,
        exclude_paths: Optional[List[str]] = None,
    ) -> List[ScrapeResult]:
        """Crawl a manufacturer site for equipment documentation."""
        try:
            paths = include_paths or ["/products", "/support", "/manuals", "/downloads", "/legacy"]
            job = self._client.crawl(
                base_url,
                max_discovery_depth=max_depth,
                limit=limit,
                include_paths=paths,
                exclude_paths=exclude_paths or ["/blog", "/news", "/careers", "/about", "/contact"],
                scrape_options=_scrape_options(["markdown", "links"]),
                poll_interval=3,
                timeout=180,
            )
            documents = list(_field(job, "data") or [])
            if not documents:
                return [ScrapeResult(
                    url=base_url,
                    error=f"The crawl found no pages under {', '.join(paths)}. Try another include path or a deeper crawl.",
                )]
            return [_document_to_result(document) for document in documents]
        except Exception as e:
            return [ScrapeResult(url=base_url, error=str(e))]

    def map_site(self, url: str, search: Optional[str] = None) -> Tuple[List[str], Optional[str]]:
        """List URLs on a site, reporting failures instead of returning a silent empty list."""
        try:
            response = self._client.map(url=url, search=search, limit=200)
            return list(_field(response, "links") or []), None
        except Exception as e:
            return [], str(e)


# ----------------------------------------------------------------------
# Convenience functions for backend integration
# ----------------------------------------------------------------------
_singleton: Optional[FirecrawlService] = None


def get_firecrawl_service() -> FirecrawlService:
    """Get or create the singleton FirecrawlService."""
    global _singleton
    if _singleton is None:
        _singleton = FirecrawlService()
    return _singleton


def reset_firecrawl_service() -> None:
    """Discard the cached client after Firecrawl credentials change."""
    global _singleton
    _singleton = None
