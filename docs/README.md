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

### Nanobot Integration (Optional Advanced AI Agent)

For enhanced AI agent capabilities beyond the standard MCP server, AudioBiblica can integrate with the **nanobot (HKUDS/nanobot)** framework. This provides:

1. **Advanced AI Agent Reasoning** - nanobot agents can answer complex AV equipment questions that go beyond simple specification lookup
2. **Enhanced Tool Access** - Full integration with AudioBiblica's equipment knowledge base and scraping capabilities
3. **Chat Interface** - WebUI access for AV specialists to interact with AudioBiblica knowledge via chat
4. **Automation** - CLI tools for automated equipment research and documentation retrieval

#### Nanobot Features Beneficial to AudioBiblica

- **Equipment Comparison** - Compare specifications across multiple audio devices (e.g., Pultec EQP-1A vs EQP-2A)
- **Legacy Research** - Automated discovery of historical or hard-to-find equipment documentation
- **Real-time Assistance** - Chat-based assistance for live A/V setup and troubleshooting
- **Knowledge Base Enhancement** - AI-powered enrichment of AudioBiblica's equipment knowledge base

#### Local Setup with Docker (NOT .dmg)

nanobot is a **Docker-based AI agent framework**, NOT a macOS .dmg application. The user should not expect to install a .dmg file. Instead:

1. **Install Docker Desktop** for your operating system
   - macOS: Download Docker Desktop from docker.com
   - Windows: Docker Desktop installer
   - Linux: docker.io installation

2. **Clone and build nanobot**

```bash
git clone https://github.com/HKUDS/nanobot.git
cd nanobot
docker compose build
```

3. **Initialize nanobot**

```bash
docker compose run --rm nanobot-cli onboard
```

4. **Configure AI providers** (add to `~/.nanobot/config.json`):

```json
{
  "providers": [
    {
      "name": "openai",
      "api_key": "your-openai-api-key",
      "models": ["gpt-4"]
    }
  ]
}
```

5. **Connect to AudioBiblica**

Since AudioBiblica already has an MCP server, nanobot can connect to it directly:

```bash
# Run nanobot gateway with AudioBiblica MCP server
# AudioBiblica's MCP server runs on localhost:8000
# nanobot will discover and integrate these tools
```

6. **Start the nanobot WebUI** (optional)

```bash
docker compose up -d nanobot-gateway
```

Access the chat interface at: `http://localhost:8765`

#### Benefits of nanobot Integration

- **Enhanced AV Expertise** - nanobot agents can provide deeper technical guidance
- **Automated Research** - Trigger equipment research without manual intervention
- **Interactive Support** - AV specialists can get real-time answers via chat
- **Knowledge Discovery** - Find connections between equipment not obvious in raw specifications

#### Integration Approach

AudioBiblica would need to:

1. Ensure the existing MCP server is accessible (AudioBiblica already has this)
2. Configure nanobot to discover AudioBiblica MCP tools
3. Set up authentication between nanobot and AudioBiblica
4. Document nanobot configuration for AV specialist usage

This integration complements rather than replaces AudioBiblica's existing MCP server, adding advanced AI capabilities while leveraging AudioBiblica's specialized audio equipment knowledge.

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- Docker Desktop (for nanobot integration)
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

### Nanobot (Optional)

```bash
git clone https://github.com/HKUDS/nanobot.git
cd nanobot
docker compose build
docker compose run --rm nanobot-cli onboard
docker compose up -d nanobot-gateway
```

## Configuration

### Environment Variables

- `FIRECRAWL_API_KEY` - Firecrawl API key for manufacturer scraping
- `ENVIRONMENT` - Application environment (development/production)
- `DATABASE_URL` - PostgreSQL connection string

## License

MIT