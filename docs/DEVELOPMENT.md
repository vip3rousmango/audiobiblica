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
- **`src/components/`** — `Layout.tsx` (sidebar, header, command palette, health polling), `NanobotChat.tsx` (the AV assistant chat), `SetupChecklist.tsx` (the first-run checklist), `SetupDoctor.tsx` (the health report and its one-click fixes), `Dropdown.tsx`, `ui.tsx`, `Icon.tsx`.
- **`src/lib/api.ts`** — the typed API client, including the same-origin base URL and the central error translation described below.
- **`styles.css`** — the design tokens and every class the app uses. Styling is plain CSS with custom properties and nothing else: there is no Tailwind or PostCSS step, so a utility class would render as nothing.

### MCP server

The MCP server exposes tools over **Streamable HTTP** at `/mcp`:

- search the equipment catalog, retrieve specifications, and find manuals;
- trigger manufacturer research and structured specification extraction.

Notes that matter when working on it:

- The MCP session manager runs inside the FastAPI lifespan (`protocol_server.session_manager.run()`), so `/mcp` answers only once the app is up; starting it outside the lifespan raises `Task group is not initialized`.
- DNS-rebinding protection rejects non-local HTTP `Host` headers with `421` unless the host is in `AUDIOBIBLICA_MCP_ALLOWED_HOSTS` (defaults include `host.docker.internal:*`).
- The server is stateless (`stateless_http=True`, `json_response=True`), so clients do not track an `Mcp-Session-Id`.

### Nanobot integration (optional, advanced)

AudioBiblica's `nanobot` runtime talks to **nanobot (HKUDS/nanobot)** as its agent. The point of it is tool use: nanobot can call AudioBiblica's own read-only MCP tools (`search_equipment`, `get_equipment_specifications`, `find_manuals`, `search_manufacturer_docs`) to answer questions about your catalog, and it brings its own shell and filesystem tools for everything else.

**Which endpoint.** AudioBiblica speaks nanobot's **chat API**, which `nanobot serve` provides (default `127.0.0.1:8900`): `GET /health`, `GET /v1/models`, `POST /v1/chat/completions`. `nanobot gateway` is the separate service that serves chat apps and the WebUI; pointing AudioBiblica at the gateway's port will not answer chat requests. Nanobot's own `docker-compose.yml` runs the API as the `nanobot-api` service (`serve --host 0.0.0.0`), published on `127.0.0.1:8900`.

**Setup, in this order — the API plugin step is not optional.** Without `nanobot plugins enable api`, `nanobot serve` starts but exposes no HTTP API at all.

```bash
pip install nanobot-ai            # or use nanobot's container
nanobot onboard --wizard          # choose a provider and model
nanobot plugins enable api
nanobot agent -m "Hello!"         # proves the provider works before serving
nanobot serve                     # chat API on 127.0.0.1:8900
```

Then set the runtime in **Settings → Assistant → Runtime** to *Nanobot gateway* and check it with the *Test saved assistant* button, or run the health report in **Settings → Check my setup**.

**Model choice matters for an agent, in two ways.** A tool-using agent needs a model that reliably emits tool calls — `llama3.2:3b` answers with the *text* of a call (`{"name": "search_equipment", …}`) and never makes one, while `mistral:latest` calls the tool and reports what it returned. Nanobot's own agent prompt (system instructions plus tool schemas) is several thousand tokens before your message, so give it at least a 16k window; with a smaller one, requests fail with `ContextWindowExceededError` naming the token counts.

**Letting the agent use our tools.** Add this to `~/.nanobot/config.json`. Field names are nanobot's own (snake_case, with `extra="allow"` meaning a camelCase key is silently ignored rather than rejected — so verify, do not assume):

```json
{
  "tools": {
    "ssrf_whitelist": ["127.0.0.1/32"],
    "mcp_servers": {
      "audiobiblica": {
        "type": "streamableHttp",
        "url": "http://127.0.0.1:8000/mcp/",
        "tool_timeout": 30,
        "enabled_tools": ["search_equipment", "get_equipment_specifications", "find_manuals", "search_manufacturer_docs"]
      }
    }
  }
}
```

Three things bite here: nanobot's SSRF guard blocks loopback HTTP MCP servers unless the CIDR is whitelisted; the config is read at startup, so restart `nanobot serve` after editing it; and the tools are connected per agent run, not at startup, so a `POST /mcp/` appears in AudioBiblica's log only once the agent actually calls one. AudioBiblica's own `AUDIOBIBLICA_MCP_ALLOWED_HOSTS` default (`127.0.0.1:*`) already accepts a same-origin call.

To check the server side on its own, without an agent in the way:

```bash
curl -s -X POST http://127.0.0.1:8000/mcp/ -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_equipment","arguments":{"query":""}}}'
```

`nanobot serve`'s route to the model is its own: nanobot talks to Ollama's OpenAI-compatible endpoint, where AudioBiblica's `ASSISTANT_NUM_CTX` does not apply, so a slow agent on a laptop is usually Ollama's context length rather than the model (see the troubleshooting entry for the assistant taking a long time).

**Wire protocol notes.** AudioBiblica sends exactly one `user` message per request and no `model`, because nanobot keeps the conversation itself keyed by `session_id`; a system prompt, when there is one, is folded into that user message. This is the one place the two sides have to agree, and `src/backend/services/assistant.py` documents it next to the code.

### Updates (the updater sidecar)

Updates are applied by a second container, not by the app. `docker-compose.yml`
runs `docker:cli` with the Docker socket and the project directory mounted, and its
`entrypoint` finds `scripts/updater.sh` (beside the compose file for end users, in
`scripts/` for a checkout). It polls a control directory for a request and, when it
finds one, runs `docker compose pull audiobiblica` followed by
`docker compose up -d --no-deps audiobiblica` — the `--no-deps` and the named
service matter: the updater must not recreate the container it is running in.

The app never holds the socket. It writes and reads three files in that directory
(shared as `/control`, `AUDIOBIBLICA_CONTROL_DIR`):

| File | Written by | Contents |
| --- | --- | --- |
| `status.json` | updater | `state` (`idle` / `pulling` / `recreating` / `done` / `error`), a plain-language `message`, the target, timestamps, and a heartbeat refreshed every few seconds |
| `request.json` | app | `{target, requested_at, current}` — written through a temporary file so the updater can never read a half-written request |
| `request.running.json` | updater | the claimed request, moved here before any slow work so a restart cannot apply it twice |

`src/backend/services/updater.py` owns the app's side: the release check (GitHub's
releases API only, cached for six hours, silent when offline), version comparison,
the guards, and the request. `GET /api/v1/update/status` and
`POST /api/v1/update/start` are the API; the health report carries the same verdict
as an `update` check, and the Overview shows the notice.

The app treats a heartbeat older than 30 seconds as "the updater is gone" and says
so, rather than offering a button that would do nothing. A pinned install
(`AUDIOBIBLICA_VERSION` set) refuses to update itself and explains why.

### Running from a checkout

`docker-compose.yml` is the *user* file: it pulls the published image and does not
build anything. To run your working tree, add the overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

CI does the same, so a broken build is caught before a release rather than by
whoever pulls it.

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
| `ASSISTANT_NUM_CTX` | Context window requested from a local runtime per request. Ollama otherwise uses the model's full training context (131072 for `llama3.2`), whose KV cache is what makes small models crawl on a laptop. | `8192` |
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
git clone https://github.com/vip3rousmango/audiobiblica.git
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
