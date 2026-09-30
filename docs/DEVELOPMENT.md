# Development

AudioBiblica is a local-first catalog of audio equipment, its manuals, and research notes. It pairs a FastAPI backend that owns the catalog with a React single-page frontend, and it can expose its knowledge to AI agents over MCP. Everything runs on one machine and works with no paid service or cloud account.

This document covers the architecture, the environment, and how to develop and test the app.

## Architecture overview

AudioBiblica has four layers:

1. **Catalog and storage** — a SQLite database holding equipment, manuals, and research findings, plus a folder of imported PDFs.
2. **Backend API** — FastAPI routes for the catalog, research, the assistant, and data export/import.
3. **Frontend** — a React 18 + TypeScript single-page app served by the same backend in production.
4. **Agent interface** — an MCP server exposing the catalog as tools over Streamable HTTP, plus an optional Nanobot integration that drives it.

In the packaged bundle the backend serves the built frontend from the same origin and port (`http://localhost:8000`), so the UI and API are one service. In development the two run separately.

## Component map

### Backend (`src/backend/`)

- **`main.py`** — the FastAPI app, every route, the lifespan (automatic backup and one-time legacy-catalog migration), the in-app model download task, and the mount of the MCP server and the built UI.
- **`config.py`** — settings persisted to `config.json`, written atomically with `0600` permissions. Resolution order is explicit arguments, then the user config file, then environment variables.
- **`models/`** — data models for equipment, manufacturers, and manuals.
- **`services/`** — supporting services:
  - `storage.py` — SQLite persistence for equipment, manuals, and research findings; upserts findings by source URL.
  - `paths.py` — the single source of truth for the data directory, database path, config path, manuals directory, and backups directory, plus the backup routine.
  - `assistant.py` — the assistant transport (local Ollama runtime and the Nanobot runtime), model listing, and timeout handling.
  - `page_reader.py` — the built-in page reader for the zero-key link-import path, with an SSRF guard.
  - `firecrawl_service.py` — the Firecrawl adapter for web search and research, used only when a key is configured.
- **`mcp/`** — the MCP server (Streamable HTTP) and its tool implementations.
- **`scrapers/`** — manufacturer research built on the Firecrawl service.

### Frontend (`src/frontend/`)

- **React 18 + TypeScript** with **React Router** for navigation.
- **`src/pages/`** — `Dashboard.tsx` (Overview), `Library.tsx`, `ResearchAgent.tsx`, `Settings.tsx`, `Mcp.tsx`.
- **`src/components/`** — `Layout.tsx` (sidebar, header, command palette, health polling), `NanobotChat.tsx` (the AV assistant chat), `SetupChecklist.tsx` (the first-run checklist), `Dropdown.tsx`, `ui.tsx`, `Icon.tsx`.
- **`src/lib/api.ts`** — the typed API client, including the same-origin base URL and the central error translation described below.
- **`styles.css`** — the design tokens and every class the app uses. Styling is plain CSS with custom properties; Tailwind is present in `package.json` but is **not** compiled by Vite, so do not use Tailwind utility classes — they render as nothing.

`electron-main.js` is a desktop-development entry point only; there is no packaging configuration for it.

### MCP server

The MCP server exposes tools over **Streamable HTTP** at `/mcp`:

- search the equipment catalog, retrieve specifications, and find manuals;
- trigger manufacturer research and structured specification extraction.

Notes that matter when working on it:

- The MCP session manager runs inside the FastAPI lifespan (`protocol_server.session_manager.run()`), so `/mcp` answers only once the app is up; starting it outside the lifespan raises `Task group is not initialized`.
- DNS-rebinding protection rejects non-local HTTP `Host` headers with `421` unless the host is in `AUDIOBIBLICA_MCP_ALLOWED_HOSTS` (defaults include `host.docker.internal:*`).
- The server is stateless (`stateless_http=True`, `json_response=True`), so clients do not track an `Mcp-Session-Id`.

### Nanobot integration (optional, advanced)

Beyond the MCP server, AudioBiblica can integrate with the **nanobot (HKUDS/nanobot)** framework for richer agent reasoning, extra tool access, a chat interface, and automation (for example comparing specifications across several devices or researching hard-to-find legacy documentation).

nanobot is a **Docker-based framework, not a macOS `.dmg`**. Local setup:

1. Install Docker Desktop.
2. Clone and build nanobot:

```bash
git clone https://github.com/HKUDS/nanobot.git
cd nanobot
docker compose build
docker compose run --rm nanobot-cli onboard
```

3. Configure a provider in `~/.nanobot/config.json`:

```json
{
  "providers": [
    { "name": "openai", "api_key": "your-openai-api-key", "models": ["gpt-4"] }
  ]
}
```

4. Start the gateway and point AudioBiblica at it with `NANOBOT_BASE_URL` (default `http://127.0.0.1:8900`):

```bash
docker compose up -d nanobot-gateway
```

The Nanobot WebUI, when enabled, is at `http://localhost:8765`. The integration complements the MCP server rather than replacing it.

## Environment variables

Every variable is read by the backend, except `VITE_API_BASE_URL`, which is read by the frontend at build time.

| Variable | Purpose | Default |
| --- | --- | --- |
| `AUDIOBIBLICA_DATA_DIR` | Root folder holding the catalog, config, manuals, and backups. | `~/.audiobiblica` (the image sets `/data`) |
| `AUDIOBIBLICA_UI_DIR` | Folder the backend serves the built UI from. When unset or missing, no UI is mounted and only the API answers. | unset (the image sets `/app/ui`) |
| `AUDIOBIBLICA_DB_PATH` | SQLite catalog file. Overrides `AUDIOBIBLICA_DATA_DIR`. | `AUDIOBIBLICA_DATA_DIR/audiobiblica.db` |
| `AUDIOBIBLICA_CONFIG_PATH` | JSON settings file (assistant provider, API keys, endpoints), written `0600`. Overrides `AUDIOBIBLICA_DATA_DIR`. | `AUDIOBIBLICA_DATA_DIR/config.json` |
| `AUDIOBIBLICA_MANUAL_DIR` | Directory for uploaded PDF manuals. Overrides `AUDIOBIBLICA_DATA_DIR`. | `AUDIOBIBLICA_DATA_DIR/manuals` |
| `AUDIOBIBLICA_MCP_ALLOWED_HOSTS` | Comma-separated `Host` headers the MCP endpoint accepts (DNS-rebinding protection). | `127.0.0.1:*,localhost:*,[::1]:*,host.docker.internal:*` |
| `FIRECRAWL_API_KEY` | Firecrawl key for web search and manufacturer research; can also be saved from Settings. | unset |
| `FIRECRAWL_API_URL` | Firecrawl API base URL. | Firecrawl's public endpoint |
| `OLLAMA_BASE_URL` | Local model endpoint used as the assistant default. | `http://127.0.0.1:11434` |
| `NANOBOT_BASE_URL` | Nanobot gateway exposed to the assistant runtime. | `http://127.0.0.1:8900` |
| `ASSISTANT_MODEL` | Default assistant model when none is saved in Settings. | `llama3.2:3b` |
| `ASSISTANT_TIMEOUT` | Seconds to wait for one assistant response. | `180` |
| `VITE_API_BASE_URL` | Frontend override for the backend origin, read at build time. Empty in a production build, so the UI calls whatever origin served it; `src/frontend/.env.development` sets it to `http://127.0.0.1:8000` for `npm run dev`. | empty (dev: `http://127.0.0.1:8000`) |

The per-item overrides (`AUDIOBIBLICA_DB_PATH`, `AUDIOBIBLICA_CONFIG_PATH`, `AUDIOBIBLICA_MANUAL_DIR`) win over `AUDIOBIBLICA_DATA_DIR`, so an existing install that points at a specific file keeps working.

Credentials entered in Settings are stored in `config.json` as plaintext. The API never returns them: only a masked key and an `api_key_configured` flag are exposed. The server binds to loopback by default in the source workflow.

## Assistant model handling

`GET /api/v1/assistant/models` lists the models the configured runtime actually serves, and the Settings model picker is populated from it. A saved model the runtime no longer offers is shown as `name (not available)` rather than silently swapped. For a local Ollama install, confirm availability with `ollama list` and pull what you need (`ollama pull llama3.2:3b`). Ollama can drop a connection while loading a cold model; the backend retries once automatically.

`GET /api/v1/setup/status` reports whether the runtime is reachable and whether the configured model is installed, and never raises: an unreachable runtime is reported as `reachable: false`, not an error. `POST /api/v1/setup/pull-model` starts a background download and the status endpoint reports its progress, so the UI polls instead of holding one long request.

## Error translation

Every user-visible failure is a plain sentence with a next step. The single place this happens is `friendlyMessage(status, technical)` in `src/frontend/src/lib/api.ts`, applied inside `request()` so all callers benefit. The raw server string is kept on `ApiError.technical` and logged; the friendly text becomes `message`. Add a case there rather than wording an error at a call site.

## Developer setup

Prerequisites: Python 3.10+, Node 18+ (20 recommended). Docker Desktop only if you want to run the packaged bundle.

```bash
git clone https://github.com/audiobiblica/audiobiblica.git
cd audiobiblica
python3 -m venv venv
./venv/bin/pip install -e ".[dev,scrapers]"
```

### Run the backend

```bash
./venv/bin/python3 -m uvicorn src.backend.main:app --host 127.0.0.1 --port 8000
curl http://127.0.0.1:8000/health   # {"status":"ok","version":"0.1.0"}
```

`python3 -m uvicorn …` also works after activating the virtual environment. The backend must run from the project virtual environment: the system interpreter lacks the project dependencies and fails with `ModuleNotFoundError: No module named 'mcp'`.

### Run the frontend

```bash
cd src/frontend
npm install
npm run dev   # http://localhost:5173
```

The Vite dev server is pinned to port 5173 and talks to the backend origin in `VITE_API_BASE_URL`, which `src/frontend/.env.development` sets to `http://127.0.0.1:8000`.

### Run the packaged bundle

```bash
./scripts/audiobiblica        # or: docker compose up -d --build
open http://localhost:8000
```

`AUDIOBIBLICA_UI_DIR` is what makes the backend serve the built UI; the image sets it to `/app/ui`. An optional `--profile ollama` Docker stack runs Ollama in a container, in which case set `OLLAMA_BASE_URL=http://ollama:11434` in a local `.env`.

## Tests

```bash
./venv/bin/python3 -m ruff check src/backend tests
./venv/bin/python3 -m pytest tests -q
cd src/frontend && npm run build
```

`tests/test_api_smoke.py` guards the HTTP surface: every route must answer its documented status for valid and invalid input and must never return `500` for input a client can send. It also covers the PDF upload/download round trip, specification extraction, research-finding de-duplication, secret masking, ISO-8601 timestamps, and the MCP `tools/list` + `tools/call` exchange.

Tests must be deterministic, isolated, and safe to run in one process. The module-level app and the MCP Streamable HTTP session manager can only start once, so the suite shares a single `TestClient` and points `AUDIOBIBLICA_DB_PATH`, `AUDIOBIBLICA_CONFIG_PATH`, and `AUDIOBIBLICA_MANUAL_DIR` at a temporary directory.

Type checking with mypy is **aspirational and not enforced**: there is no mypy configuration, no CI job, and the code is untyped. Do not add annotations purely to satisfy a checker, and do not add a mypy job to CI.

## Common development problems

- **`ModuleNotFoundError: No module named 'mcp'`** — you are running the system Python. Use `./venv/bin/python3` or activate the virtual environment first.
- **`[Errno 48] address already in use`** — a previous `--reload` run left its parent process holding port 8000. Find it with `lsof -nP -iTCP:8000 -sTCP:LISTEN` and stop it with `kill <pid>` before starting a new server. With Docker, run `docker compose down` first.

## License

MIT. See [../LICENSE](../LICENSE).
