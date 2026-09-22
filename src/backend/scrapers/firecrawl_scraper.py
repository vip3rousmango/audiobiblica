"""Manufacturer website scraping service using Firecrawl."""

import os
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field


@dataclass
class ScrapeResult:
    """Result of scraping a manufacturer site."""
    url: str
    title: Optional[str]
    content: Optional[str]
    metadata: Dict[str, Any] = field(default_factory=dict)


class FirecrawlScraper:
    """Scrapes manufacturer websites for audio equipment documentation."""
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("FIRECRAWL_API_KEY")
        if not self.api_key:
            raise ValueError("FIRECRAWL_API_KEY is required for scraping")
        
        try:
            from firecrawl import FirecrawlApp
            self.client = FirecrawlApp(api_key=self.api_key)
        except ImportError as exc:
            raise ImportError(
                "Install firecrawl-core to use manufacturer scraping: pip install audiobiblica[scrapers]"
            ) from exc
    
    def scrape_url(self, url: str) -> ScrapeResult:
        """Scrape a single URL."""
        from firecrawl import FirecrawlApp
        
        result = self.client.scrape_url(url=url)
        return ScrapeResult(
            url=url,
            title=result.get("metadata", {}).get("title"),
            content=result.get("markdown"),
            metadata=result.get("metadata", {}),
        )
    
    def search_equipment(self, query: str, limit: int = 5) -> List[ScrapeResult]:
        """Search for equipment documentation online."""
        from firecrawl import FirecrawlApp
        
        results = self.client.search(query, limit=limit)
        scraped = []
        for result in results:
            url = result.get("url")
            if url:
                scraped.append(self.scrape_url(url))
        return scraped
    
    def find_manuals(self, manufacturer: str, model: str) -> List[ScrapeResult]:
        """Find manuals and documentation for a specific equipment model."""
        query = f"{manufacturer} {model} manual pdf"
        return self.search_equipment(query, limit=10)
