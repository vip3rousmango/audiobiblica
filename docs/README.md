# AudioBiblica Documentation

## Architecture Overview

AudioBiblica is a comprehensive audio equipment knowledge management system designed for AV specialists. It enables:

1. **PDF Ingestion & Processing** - Extract structured knowledge from equipment manuals
2. **Manufacturer Research** - Discover and scrape documentation from manufacturer websites
3. **Knowledge Base Management** - Store, organize, and search equipment information
4. **MCP Integration** - Expose knowledge to AI agents for audio equipment control

## System Components

### Backend (`src/backend/`)

- **`models/`** - Data models for equipment, manufacturers, and manuals
- **`services/`** - PDF processing and knowledge extraction
- **`scrapers/`** - Firecrawl-based manufacturer website research
- **`mcp/`** - MCP server for AI agent integration
- **`api/`** - REST API endpoints

### Frontend (`src/frontend/`)

- **Electron-based desktop application**
- **React 18 + TypeScript**
- **Zustand for state management**
- **React Router for navigation**

### MCP Server

The MCP server provides tools that AI agents (like DAW MCP) can use to:
- Search audio equipment knowledge
- Retrieve equipment specifications
- Find manuals and documentation
- Trigger manufacturer website scraping

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- Firecrawl API key (optional, for manufacturer scraping)

### Backend

```bash
cd /path/to/audiobiblica
pip install -e .[dev,backend]
uvicorn src.backend.main:app --reload
```

### Frontend

```bash
cd src/frontend
npm install
npm run dev
```

## Configuration

### Environment Variables

- `FIRECRAWL_API_KEY` - Firecrawl API key for manufacturer scraping
- `ENVIRONMENT` - Application environment (development/production)
- `DATABASE_URL` - PostgreSQL connection string

## License

MIT