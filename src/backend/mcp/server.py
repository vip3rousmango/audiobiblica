"""MCP server for AudioBiblica - provides knowledge retrieval for AI agents."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.concurrency import run_in_threadpool


@dataclass
class MCPToolResult:
    """Standard MCP tool result."""
    success: bool
    data: Dict[str, Any]
    error: Optional[str] = None


class AudioBiblicaMCPServer:
    """MCP server exposing AudioBiblica knowledge for agents.
    
    This server provides tools that AI agents (like DAW MCP) can use to:
    - Search audio equipment knowledge
    - Retrieve equipment specifications
    - Find manuals and documentation
    - Search manufacturer websites via Firecrawl
    - Extract structured equipment specifications
    - Crawl manufacturer sites for documentation
    
    The server is designed to be compatible with the MCP protocol and can be
    exposed via stdio or SSE transport.
    """

    def __init__(self, knowledge_base: Optional[Dict[str, Any]] = None):
        self.knowledge_base = knowledge_base or {}
        self._firecrawl = None

    def _get_firecrawl(self):
        """Lazy-load Firecrawl service."""
        if self._firecrawl is None:
            try:
                from src.backend.scrapers import get_firecrawl_service
                self._firecrawl = get_firecrawl_service()
            except Exception:
                self._firecrawl = False
        return self._firecrawl if self._firecrawl is not False else None

    async def handle_request(self, request: Dict[str, Any]) -> MCPToolResult:
        """Handle MCP requests for audio equipment knowledge."""
        tool_name = request.get("tool_name", "")
        arguments = request.get("arguments", {})

        if tool_name == "search_equipment":
            from src.backend.services.storage import get_storage

            query = str(arguments.get("query", "")).casefold().strip()
            equipment = get_storage().list_equipment()
            matches = [
                {
                    "id": item.id,
                    "name": item.name,
                    "manufacturer": item.manufacturer,
                    "model": item.model,
                    "category": item.category,
                    "description": item.description,
                    "specifications": item.specifications,
                    "manuals": item.manuals,
                }
                for item in equipment
                if not item.archived
                and (
                    not query
                    or query in " ".join(
                        str(value)
                        for value in (
                            item.name,
                            item.manufacturer,
                            item.model or "",
                            item.category,
                            item.description or "",
                            item.specifications,
                        )
                    ).casefold()
                )
            ]
            return MCPToolResult(success=True, data={"equipment": matches})
        elif tool_name == "get_equipment_specifications":
            from src.backend.services.storage import get_storage

            equipment_id = arguments.get("equipment_id")
            equipment = get_storage().get_equipment(equipment_id) if equipment_id else None
            if not equipment:
                return MCPToolResult(success=False, data={}, error="Equipment not found")
            return MCPToolResult(success=True, data={"specifications": equipment.specifications})
        elif tool_name == "find_manuals":
            manufacturer = str(arguments.get("manufacturer", "")).casefold().strip()
            model = str(arguments.get("model", "")).casefold().strip()
            return MCPToolResult(
                success=True,
                data={"manuals": self._find_manuals(manufacturer, model)},
            )
        elif tool_name == "scrape_manufacturer_site":
            firecrawl = self._get_firecrawl()
            url = str(arguments.get("url", "")).strip()
            if not firecrawl:
                return MCPToolResult(success=False, data={}, error="Firecrawl service unavailable. Configure its API key in Settings.")
            if url:
                result = await run_in_threadpool(firecrawl.scrape_url, url)
                if result.error:
                    return MCPToolResult(success=False, data={}, error=result.error)
                return MCPToolResult(success=True, data={"url": result.url, "title": result.title, "markdown": result.markdown, "metadata": result.metadata})
            manufacturer = str(arguments.get("manufacturer", "")).strip()
            model = str(arguments.get("model", "")).strip()
            if manufacturer and model:
                return await self._search_manufacturer_docs({"manufacturer": manufacturer, "model": model, "query_type": "product"})
            return MCPToolResult(success=False, data={}, error="Provide a manufacturer and model, or a product-page URL to scrape")

        # --- New Firecrawl-powered research tools ---
        elif tool_name == "search_manufacturer_docs":
            return await self._search_manufacturer_docs(arguments)
        elif tool_name == "extract_equipment_specs":
            return await self._extract_equipment_specs(arguments)
        elif tool_name == "crawl_manufacturer_site":
            return await self._crawl_manufacturer_site(arguments)
        elif tool_name == "batch_scrape_urls":
            return await self._batch_scrape_urls(arguments)
        elif tool_name == "search_web":
            return await self._search_web(arguments)
        elif tool_name == "easyschematic_status":
            return await self._easyschematic_status()
        elif tool_name == "easyschematic_export_devices":
            return self._easyschematic_export_devices(arguments)

        else:
            return MCPToolResult(
                success=False,
                data={},
                error=f"Unknown tool: {tool_name}",
            )

    async def _search_manufacturer_docs(self, arguments: Dict[str, Any]) -> MCPToolResult:
        """Search manufacturer documentation for specific equipment."""
        firecrawl = self._get_firecrawl()
        if not firecrawl:
            return MCPToolResult(
                success=False,
                data={},
                error="Firecrawl service unavailable. Set FIRECRAWL_API_KEY.",
            )

        manufacturer = arguments.get("manufacturer", "")
        model = arguments.get("model", "")
        query_type = arguments.get("query_type", "manual")  # manual, specs, product, legacy
        limit = arguments.get("limit", 10)

        if not manufacturer or not model:
            return MCPToolResult(
                success=False,
                data={},
                error="Both manufacturer and model are required",
            )

        try:
            result = await run_in_threadpool(
                firecrawl.search_manufacturer,
                manufacturer=manufacturer,
                model=model,
                query_type=query_type,
            )
            if result.error:
                return MCPToolResult(success=False, data={}, error=result.error)
            return MCPToolResult(
                success=True,
                data={
                    "manufacturer": manufacturer,
                    "model": model,
                    "query_type": query_type,
                    "results": [
                        {
                            "url": r.url,
                            "title": r.title,
                            "markdown": r.markdown,
                            "links": r.links,
                            "metadata": r.metadata,
                        }
                        for r in result.results[:limit]
                    ],
                },
            )
        except Exception as e:
            return MCPToolResult(
                success=False,
                data={},
                error=str(e),
            )

    async def _extract_equipment_specs(self, arguments: Dict[str, Any]) -> MCPToolResult:
        """Extract structured specifications from manufacturer URLs."""
        firecrawl = self._get_firecrawl()
        if not firecrawl:
            return MCPToolResult(
                success=False,
                data={},
                error="Firecrawl service unavailable. Set FIRECRAWL_API_KEY.",
            )

        manufacturer = arguments.get("manufacturer", "")
        model = arguments.get("model", "")
        urls = arguments.get("urls", [])

        if not manufacturer or not model or not urls:
            return MCPToolResult(
                success=False,
                data={},
                error="manufacturer, model, and urls are required",
            )

        try:
            result = await run_in_threadpool(
                firecrawl.extract_equipment_specs,
                urls=urls,
                manufacturer=manufacturer,
                model=model,
            )
            return MCPToolResult(
                success=True,
                data={
                    "manufacturer": manufacturer,
                    "model": model,
                    "specifications": result.data,
                    "sources": result.sources,
                    "error": result.error,
                },
            )
        except Exception as e:
            return MCPToolResult(
                success=False,
                data={},
                error=str(e),
            )

    async def _crawl_manufacturer_site(self, arguments: Dict[str, Any]) -> MCPToolResult:
        """Crawl a manufacturer site for equipment documentation."""
        firecrawl = self._get_firecrawl()
        if not firecrawl:
            return MCPToolResult(
                success=False,
                data={},
                error="Firecrawl service unavailable. Set FIRECRAWL_API_KEY.",
            )

        base_url = arguments.get("base_url", "")
        max_depth = arguments.get("max_depth", 2)
        limit = arguments.get("limit", 30)
        include_paths = arguments.get("include_paths")
        exclude_paths = arguments.get("exclude_paths")

        if not base_url:
            return MCPToolResult(
                success=False,
                data={},
                error="base_url is required",
            )

        try:
            results = await run_in_threadpool(
                firecrawl.crawl_manufacturer,
                base_url=base_url,
                max_depth=max_depth,
                limit=limit,
                include_paths=include_paths,
                exclude_paths=exclude_paths,
            )
            return MCPToolResult(
                success=True,
                data={
                    "base_url": base_url,
                    "results": [
                        {
                            "url": r.url,
                            "title": r.title,
                            "markdown": r.markdown,
                            "links": r.links,
                            "metadata": r.metadata,
                        }
                        for r in results
                    ],
                },
            )
        except Exception as e:
            return MCPToolResult(
                success=False,
                data={},
                error=str(e),
            )

    async def _batch_scrape_urls(self, arguments: Dict[str, Any]) -> MCPToolResult:
        """Scrape multiple URLs in parallel."""
        firecrawl = self._get_firecrawl()
        if not firecrawl:
            return MCPToolResult(
                success=False,
                data={},
                error="Firecrawl service unavailable. Set FIRECRAWL_API_KEY.",
            )

        urls = arguments.get("urls", [])
        if not urls:
            return MCPToolResult(
                success=False,
                data={},
                error="urls array is required",
            )

        try:
            results = await run_in_threadpool(firecrawl.batch_scrape, urls=urls)
            return MCPToolResult(
                success=True,
                data={
                    "results": [
                        {
                            "url": r.url,
                            "title": r.title,
                            "markdown": r.markdown,
                            "links": r.links,
                            "metadata": r.metadata,
                            "error": r.error,
                        }
                        for r in results
                    ],
                },
            )
        except Exception as e:
            return MCPToolResult(
                success=False,
                data={},
                error=str(e),
            )

    async def _search_web(self, arguments: Dict[str, Any]) -> MCPToolResult:
        """General web search for equipment documentation."""
        firecrawl = self._get_firecrawl()
        if not firecrawl:
            return MCPToolResult(
                success=False,
                data={},
                error="Firecrawl service unavailable. Set FIRECRAWL_API_KEY.",
            )

        query = arguments.get("query", "")
        limit = arguments.get("limit", 10)
        include_domains = arguments.get("include_domains")
        exclude_domains = arguments.get("exclude_domains")

        if not query:
            return MCPToolResult(
                success=False,
                data={},
                error="query is required",
            )

        try:
            result = await run_in_threadpool(
                firecrawl.search,
                query=query,
                limit=limit,
                include_domains=include_domains,
                exclude_domains=exclude_domains,
            )
            return MCPToolResult(
                success=True,
                data={
                    "query": result.query,
                    "results": [
                        {
                            "url": r.url,
                            "title": r.title,
                            "markdown": r.markdown,
                            "links": r.links,
                            "metadata": r.metadata,
                        }
                        for r in result.results
                    ],
                    "error": result.error,
                },
            )
        except Exception as e:
            return MCPToolResult(
                success=False,
                data={},
                error=str(e),
            )

    async def _easyschematic_status(self) -> MCPToolResult:
        """What part of the user's local EasySchematic is running, and the install option if not."""
        from src.backend.services.easyschematic import probe_easyschematic

        return MCPToolResult(success=True, data=await probe_easyschematic())

    def _easyschematic_export_devices(self, arguments: Dict[str, Any]) -> MCPToolResult:
        """Author EasySchematic device templates from catalog rows with the ports the agent supplies."""
        from src.backend.services.easyschematic import build_devices, catalog_rows

        ids = arguments.get("ids") or []
        ports = arguments.get("ports") or {}
        device_types = arguments.get("device_types") or {}
        rows, missing = catalog_rows(list(ids) or None)
        export = build_devices(rows, ports, device_types)
        export["skipped"] = [*export["skipped"], *missing]
        return MCPToolResult(success=True, data=export)

    def _find_manuals(self, manufacturer: str, model: str) -> List[Dict[str, Any]]:
        """Find saved manuals for matching equipment records."""
        from src.backend.services.storage import get_storage

        manuals = []
        for equipment in get_storage().list_equipment():
            if equipment.archived:
                continue
            if manufacturer and manufacturer not in equipment.manufacturer.casefold():
                continue
            if model and model not in (equipment.model or "").casefold():
                continue
            for manual in equipment.manuals:
                if isinstance(manual, dict):
                    manuals.append({
                        **manual,
                        "equipment_id": equipment.id,
                        "equipment_name": equipment.name,
                    })
        return manuals



def create_mcp_protocol_server(audio_server: AudioBiblicaMCPServer) -> FastMCP:
    """Build the official Streamable HTTP MCP surface."""
    allowed_hosts = [
        host.strip()
        for host in os.getenv(
            "AUDIOBIBLICA_MCP_ALLOWED_HOSTS",
            "127.0.0.1:*,localhost:*,[::1]:*,host.docker.internal:*",
        ).split(",")
        if host.strip()
    ]
    server = FastMCP(
        "AudioBiblica",
        instructions="Search the user's AudioBiblica equipment inventory and linked manuals. Firecrawl research tools require a configured Firecrawl account.",
        streamable_http_path="/",
        stateless_http=True,
        json_response=True,
        transport_security=TransportSecuritySettings(
            allowed_hosts=allowed_hosts,
            allowed_origins=[
                "http://127.0.0.1:*",
                "http://localhost:*",
                "http://[::1]:*",
            ],
        ),
    )
    async def invoke(tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        result = await audio_server.handle_request({"tool_name": tool_name, "arguments": arguments})
        if not result.success:
            raise ValueError(result.error or f"{tool_name} failed")
        return result.data

    @server.tool()
    async def search_equipment(query: str = "") -> dict[str, Any]:
        """Search non-archived equipment by name, manufacturer, model, category, or specifications."""
        return await invoke("search_equipment", {"query": query})

    @server.tool()
    async def get_equipment_specifications(equipment_id: str) -> dict[str, Any]:
        """Read the structured specifications for one AudioBiblica equipment record."""
        return await invoke("get_equipment_specifications", {"equipment_id": equipment_id})

    @server.tool()
    async def find_manuals(manufacturer: str = "", model: str = "") -> dict[str, Any]:
        """Find saved manual links for equipment matching a manufacturer and model."""
        return await invoke("find_manuals", {"manufacturer": manufacturer, "model": model})

    @server.tool()
    async def scrape_manufacturer_site(manufacturer: str = "", model: str = "", url: str = "") -> dict[str, Any]:
        """Find a product page or scrape its URL using configured Firecrawl credentials."""
        return await invoke("scrape_manufacturer_site", {"manufacturer": manufacturer, "model": model, "url": url})

    @server.tool()
    async def search_manufacturer_docs(manufacturer: str, model: str, query_type: str = "manual", limit: int = 10) -> dict[str, Any]:
        """Search manufacturer documentation for one model. query_type can be manual, specs, product, or legacy."""
        return await invoke("search_manufacturer_docs", {"manufacturer": manufacturer, "model": model, "query_type": query_type, "limit": limit})

    @server.tool()
    async def search_web(query: str, limit: int = 10) -> dict[str, Any]:
        """Search web results for manuals, specifications, and equipment documentation."""
        return await invoke("search_web", {"query": query, "limit": limit})

    @server.tool()
    async def extract_equipment_specs(manufacturer: str, model: str, urls: list[str]) -> dict[str, Any]:
        """Extract structured specifications from the supplied manufacturer or documentation URLs."""
        return await invoke("extract_equipment_specs", {"manufacturer": manufacturer, "model": model, "urls": urls})

    @server.tool()
    async def crawl_manufacturer_site(base_url: str, max_depth: int = 2, limit: int = 50) -> dict[str, Any]:
        """Crawl a manufacturer site for support, product, manual, and legacy pages."""
        return await invoke("crawl_manufacturer_site", {"base_url": base_url, "max_depth": max_depth, "limit": limit})

    @server.tool()
    async def batch_scrape_urls(urls: list[str]) -> dict[str, Any]:
        """Scrape multiple supplied documentation URLs in one Firecrawl batch."""
        return await invoke("batch_scrape_urls", {"urls": urls})

    @server.tool()
    async def easyschematic_status() -> dict[str, Any]:
        """Check which parts of the user's local EasySchematic are running, and how to install one that is not."""
        return await invoke("easyschematic_status", {})

    @server.tool()
    async def easyschematic_export_devices(
        ids: list[str],
        ports: dict[str, Any] | None = None,
        device_types: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Author EasySchematic device templates from catalog devices with the sender's real ports.

        `ids` may be empty for the whole catalog; `ports` maps an equipment id to its port list,
        each port `{label, signalType, connectorType, direction}`; `device_types` maps an id to
        an EasySchematic device kind (see the export's own suggestions)."""
        return await invoke(
            "easyschematic_export_devices",
            {"ids": ids, "ports": ports or {}, "device_types": device_types or {}},
        )

    return server

