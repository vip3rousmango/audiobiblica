# Repository Guidelines

Guidelines for AI coding agents working in this repository. The product's audience is musicians and
home-studio producers with no technical background; this file's audience is you.

## Project Overview

AudioBiblica is a private, local-first catalog of studio gear: devices, the PDF manuals you own, and
research notes about them, searchable by an assistant that runs on the same computer. One FastAPI
process serves a REST API, an MCP server, and the built React interface on one port.

Three promises constrain almost every change. Read them before designing something new:

1. **Local-first.** "No account. No subscription. No cloud. If your internet goes down, AudioBiblica
   doesn't notice." No new hard dependency on a paid service; Firecrawl stays optional and the
   built-in page reader is the zero-key default path.
2. **Novice-first.** "A change that makes a musician's first run harder is a regression even when it
   adds capability." Every user-visible failure is a plain sentence with a next step.
3. **Data safety.** Anything that writes to the catalog must keep working when the catalog file is
   read-only or missing, and must never delete user data on a failed operation.

## Architecture & Data Flow

```text
  browser ──► lib/api.ts request() ──► FastAPI routes (main.py, /api/v1/*)
                                          │
                                          ├── get_storage() ──► SQLite (thread-local connections)
                                          ├── services/assistant.py ──► Ollama | OpenAI | Anthropic | nanobot
                                          ├── services/page_reader.py, firecrawl_service.py ──► the web (optional)
                                          └── MCP server at /mcp ──► the same Storage, read-only tools

  updater sidecar (docker:cli, holds the Docker socket)
      ▲ request.json            │ status.json (heartbeat ~3s)
      └── app writes/reads /control ── the app itself has NO Docker access
```

- **Backend**: one module owns the HTTP surface (`src/backend/main.py`), everything reusable lives in
  `src/backend/services/*` as a plain class or function with no FastAPI imports. `src/backend/api/router.py`
  is a vestigial empty router; new routes are `@app` decorators in `main.py`, grouped by banner comment.
- **Storage**: `src/backend/services/storage.py` — SQLite with JSON blob columns parsed by `_row_to_*`
  mappers, `PRAGMA table_info`-based column migrations in an idempotent `_init_db()`, one
  `get_storage()` singleton. Timestamps are epoch floats in SQLite and ISO-8601 UTC strings outside it.
- **Assistant**: pure httpx adapters in `services/assistant.py`. The route builds a system prompt from
  `_knowledge_context()` (lexical scoring over the catalog, capped at 12 000 chars, fetched text
  labelled untrusted) and dispatches on runtime/provider.
- **MCP**: `src/backend/mcp/server.py` has two layers — a dict-dispatch `AudioBiblicaMCPServer` and a
  FastMCP Streamable HTTP app mounted at `/mcp` whose tool wrappers delegate to it.
- **Frontend**: React 18 + react-router + Vite, no state library. Every request goes through
  `request<T>()` in `src/frontend/src/lib/api.ts`; components fetch in `useEffect`/handlers with local
  `useState`/`useCallback`. Polling is always `window.setInterval` guarded by a state flag.
- **Self-update**: the UI asks `/api/v1/update/start`; the app snapshots the catalog and writes
  `request.json`; the sidecar container pulls the published image and recreates the app container; the
  page reloads when the running version changes.

### Load-bearing invariants (breaking these breaks users)

- **Startup order in the lifespan** — `configure_logging` → `migrate_legacy_database` → `recover_catalog`
  → `backup_database` → `get_storage`. Recovery must follow migration (adopt `./audiobiblica.db` first)
  and precede the first snapshot (so a damaged file is never copied over a good one).
- **`mount_ui(app)` runs last**, at the bottom of `main.py`. Its catch-all must exist after every route,
  and it must keep returning a JSON 404 for `api/*`, `mcp/*` and `health` — otherwise an unknown API
  path answers with the app's HTML and a 200, which browsers cache where JSON belongs.
- **After any catalog file swap, call `invalidate_connections()`** (`storage.py`). Connections cache the
  file header; without it the process keeps failing on the old contents.
- **Database copies go through `_copy_database`** (SQLite's backup API), never `shutil.copy2`, and
  `replace_catalog_with` writes *into* the existing file rather than renaming over the path. Both
  comments say "do not simplify this" for a reason.
- **`catalog_state() == "blocked"` is never damage** — `recover_catalog()` raises rather than touching
  the file. Unknown counts are `None`, never `0`.
- **Ollama requests must carry `options.num_ctx`** (`ASSISTANT_NUM_CTX`, default 8192). Ollama otherwise
  sizes the KV cache for the model's full training context (131072 for `llama3.2`), which turns a 3B
  model into minutes per answer.
- **The nanobot runtime sends exactly one `user` message and no `model` key**, with the system prompt
  folded into that message. That is the whole contract with the other side.
- **The page must not be cached** (`Cache-Control: no-cache` on the SPA responses) and the update check
  must not be (`no-store` on both sides). A cached page keeps loading the previous bundle.
- **The app container never gets the Docker socket.** Only the `updater` service does, and it may only
  run `compose pull` + `compose up -d --no-deps audiobiblica` (the `--no-deps` and the named service keep
  it from recreating itself).
- **`.gitignore`'s `!src/frontend/src/lib/` negation is not optional** — the Python template's `lib/`
  rule would otherwise swallow the API client.

## Key Directories

| Path | What lives there |
| --- | --- |
| `src/backend/main.py` | The HTTP surface, lifespan, Pydantic models, error handler, `mount_ui` |
| `src/backend/services/` | `paths.py` (data dir, catalog recovery, snapshots, logging), `storage.py`, `assistant.py`, `diagnostics.py`, `updater.py`, `catalog_archive.py`, `page_reader.py`, `pdf_processing.py`, `firecrawl_service.py` |
| `src/backend/mcp/` | MCP tool dispatch and the FastMCP Streamable HTTP app |
| `src/frontend/src/lib/` | `api.ts` (the single typed client + `friendlyMessage`), `useUpdate.ts` |
| `src/frontend/src/components/` | `ui.tsx` primitives, `Layout.tsx`, `SetupChecklist.tsx`, `SetupDoctor.tsx`, `UpdateNotice.tsx`, `NanobotChat.tsx` |
| `src/frontend/src/pages/` | `Dashboard`, `Library`, `ResearchAgent`, `Mcp`, `Settings` |
| `src/frontend/src/styles.css` | All styling: design tokens as CSS custom properties, kebab-case classes |
| `tests/` | `conftest.py` (shared client), `test_api_smoke.py`, `test_updater.py` |
| `scripts/` | `audiobiblica` (installer/updater/launcher), `updater.sh` (the sidecar) |
| `docs/` | `GETTING-STARTED.md`, `TROUBLESHOOTING.md`, `DEVELOPMENT.md`, `images/` |

## Development Commands

```bash
# Backend (from the repo root; docs use the project venv)
python3 -m venv venv && ./venv/bin/pip install -e ".[dev,scrapers]"
./venv/bin/python3 -m uvicorn src.backend.main:app --host 127.0.0.1 --port 8000

# Frontend (src/frontend) — dev server on 5173, proxying to 8000
npm ci && npm run dev
npm run build          # = tsc && vite build; this is also the typecheck

# The three gates CI runs
./venv/bin/python3 -m ruff check src/backend tests
./venv/bin/python3 -m pytest tests -q
cd src/frontend && npm run build

# Docker: developers and CI build from the checkout with the overlay
docker compose -f docker-compose.yml -f docker-compose.dev.yml build
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
# Users run this instead (published image, no build):
./scripts/audiobiblica
```

Release: push a `v*` tag — `.github/workflows/release.yml` runs the tests, publishes to PyPI when
`PYPI_TOKEN` is set, pushes a dual-architecture image, and attaches the wheel and sdist to the release.

## Code Conventions & Common Patterns

**Python** (`src/backend/**`)

- `from __future__ import annotations` at the top of every module; builtin generics (`dict | None`),
  no `typing.Dict`/`List` in new code.
- Module docstrings explain *why* the module exists; function docstrings are one sentence and carry the
  invariant when there is one (`storage.ensure_schema`, `catalog_state`, `backup_created_at`).
- Errors: services raise dedicated exceptions (`AssistantError`, `CatalogArchiveError`) or return the
  error as data (`PageRead.error`, `ScrapeResult.error`, `MCPToolResult.error`). Only route handlers
  raise `HTTPException`, converting service exceptions with `from exc` — 404 not found, 422
  validation/unreadable input, 502 assistant/research failure, 503 unconfigured Firecrawl.
- Singletons are always module-level `_thing: Optional[X] = None` plus `get_thing()`; mutable process
  state lives as a module global beside its owner (`_catalog_recovery`, `_model_pull`).
- Blocking work goes through `await run_in_threadpool(...)`; async httpx calls are awaited directly.
- Routes return dict envelopes (`{"equipment": [...]}`), never bare lists. Shared logic is extracted
  rather than copied (`_assistant_probe` exists so the checklist and the health report cannot disagree).

**Frontend** (`src/frontend/src/**`)

- One typed client: every fetch goes through `request<T>()` in `lib/api.ts`, with an interface per
  backend payload.
- Errors: `friendlyMessage(status, technical)` is "the one place a technical failure becomes a sentence
  a musician can act on". Add a case there instead of wording an error at a call site. `ApiError.technical`
  keeps the raw server string for the console only.
- Components use `ui.tsx` primitives (`Button`, `StatusDot`, `InlineNotice`, `Surface`, …) rather than
  new markup, and `Icon.tsx` for icons.
- CSS: single `styles.css`, design tokens on `:root`. Readable secondary text uses `--muted`; `--faint`
  is decorative only (contrast). Logical properties (`margin-inline`, `border-block-end`).
- Accessibility: visible text must be the accessible name (do not give a control an `aria-label` that
  contradicts its text), decorative markup gets `aria-hidden="true"`, and `InlineNotice` maps tone to
  `role` (alert only for danger).

**Docs and process**

- `docs/TROUBLESHOOTING.md` quotes user-visible messages verbatim; rewording a message in code means
  updating its entry.
- A behaviour change updates the README (musician-facing) or `docs/DEVELOPMENT.md` (agent-facing), and
  adds a `CHANGELOG.md` entry under `## [Unreleased]` (Keep a Changelog + SemVer).
- One logical change per commit; imperative subject under 72 characters. The PR template asks what
  changed, why, and how you verified it — "'Ran the suite' is not enough on its own".
- mypy is aspirational and deliberately not enforced. Do not add annotations to satisfy a checker and do
  not add a mypy job to CI.

## Important Files

| File | Why it matters |
| --- | --- |
| `src/backend/main.py` | Every route, the lifespan, the 500 handler with its 8-hex reference, `mount_ui` |
| `src/backend/services/paths.py` | Owns every runtime path and the whole data-safety surface |
| `src/backend/services/storage.py` | Schema + migrations, connection lifecycle, the `get_storage()` singleton |
| `src/backend/services/catalog_archive.py` | `APP_VERSION` — the version source of truth for the running app |
| `src/backend/services/updater.py` | Release check, request/heartbeat protocol with the sidecar |
| `src/frontend/src/lib/api.ts` | The single client, `ApiError`, `friendlyMessage` |
| `src/frontend/src/lib/useUpdate.ts` | Update request, progress polling, reload-on-version-change |
| `docker-compose.yml` | The shape users run: published image, pinned project name, sidecar, volumes |
| `docker-compose.dev.yml` | Pure `build: .` overlay; dev and CI run the same shape as users |
| `scripts/updater.sh` | The control-file protocol and the only Docker-touching code |
| `pyproject.toml` | Deps, version, ruff and pytest configuration |
| `.github/workflows/ci.yml` / `release.yml` | The gates and the release pipeline |

## Runtime/Tooling Preferences

- **Python ≥ 3.10** (CI tests 3.10 and 3.12; the image runs 3.12). Use the project venv at `./venv`;
  the system interpreter lacks `mcp` and fails at import.
- **Node 20** with `npm ci` (there is a lockfile; keep it in step with `package.json`). Vite 5, React 18,
  no ESLint and no frontend test runner — `npm run build` is the frontend's only check.
- **ruff is the only lint truth**: `line-length = 100`, `select = ["E4", "E7", "E9", "F", "B", "I"]`, with
  FastAPI's call-in-default idiom whitelisted for bugbear. `black` and `mypy` are declared but never run.
- **Dependencies are floors, not pins**, except `mcp>=1.28,<2` (the only upper bound; widening it is a
  compatibility claim someone has to verify). Dependabot ignores semver-major everywhere.
- **Docker**: Compose v2 syntax, two files, `name: audiobiblica` pinned so the project's volumes do not
  move when the compose file is run from a different directory. The updater sidecar is `docker:cli`.
- **Version strings live in four places** and move together: `pyproject.toml`, `APP_VERSION` in
  `catalog_archive.py`, `package.json`, `package-lock.json` — plus a `CHANGELOG.md` entry.
- **The container is the app.** The PyPI package is the API and MCP server only; it has no interface.

## Testing & QA

`pytest` with `testpaths = ["tests"]` and `addopts = "-q"`. The suite is **53 cases across two modules**;
CI runs it on Python 3.10 and 3.12, then builds the frontend, then boots the Docker bundle and curls
`/health`, `/`, `/library` and `/api/v1/equipment`.

- **One client for the whole suite.** `tests/conftest.py` provides a session-scoped `client` fixture.
  Never create a second `TestClient(app)`: routes live on the module-level app, and the MCP
  streamable-HTTP session manager can only run once per instance (`StreamableHTTPSessionManager .run()
  can only be called once`). A fresh `FastAPI()` plus `mount_ui(...)` is fine for routing tests because
  no session manager starts on it.
- **Isolation is set at import time.** conftest pins `AUDIOBIBLICA_DB_PATH`, `AUDIOBIBLICA_CONFIG_PATH`
  and `AUDIOBIBLICA_MANUAL_DIR` to a scratch directory with `os.environ.setdefault` before the app is
  imported, so per-test `monkeypatch.setenv` cannot redirect them. Only lazily-read variables
  (`AUDIOBIBLICA_CONTROL_DIR`, `AUDIOBIBLICA_UI_DIR`, `AUDIOBIBLICA_VERSION`) are safely patched per test.
- **The database is shared across the session**; records created by one test are visible to later ones.
  Never assume an empty catalog — filter by id.
- **Add a row, not a test, for a new route.** `test_routes_answer_without_server_error` is a parametrized
  table of `(method, path, body, expect)` covering every route's documented status; rows without `expect`
  assert only "not a 500" (used for endpoints that depend on the network).
- **Assert what a client observes**, not wiring: status codes, parseable shapes, absence of leaks
  (`test_firecrawl_key_is_never_echoed`), roundtrips, upsert semantics. Do not re-pin error wording
  unless the sentence is the contract.
- **Fakes are `monkeypatch.setattr`** with dotted paths (`"src.backend.main.chat_completion"`), plus
  `tmp_path` for files and `monkeypatch.setenv` for configuration. No mock library.
- Test names read `test_<subject>_<expected>`, one behaviour each, with a docstring saying why the
  behaviour matters (or how the bug was found). Modules open with what they deliberately do not cover.
- Container behaviour is not unit-tested — the updater tests cover only what decides *whether* to swap
  (version comparison, heartbeat staleness, pinned refusal, request-file atomicity). Prove the rest by
  running the bundle.
