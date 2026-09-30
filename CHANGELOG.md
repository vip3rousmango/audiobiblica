# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-09-30

First public release.

### Added

- One-command install: a multi-stage image builds the frontend and serves it from the same origin as
  the API, so `docker compose up` opens a working app on <http://localhost:8000>.
- `scripts/audiobiblica`, which starts the bundle, waits for health, and opens the browser.
- Guided first run: `GET /api/v1/setup/status` and an in-app model download
  (`POST /api/v1/setup/pull-model`) defaulting to the small `llama3.2:3b` model.
- Built-in page reader (`POST /api/v1/research/fetch-url`): add a manual from a product or support
  page with no third-party key.
- Catalog safety: automatic snapshots at every start (the ten most recent are kept) and export/import
  of the whole catalog as a ZIP (`GET /api/v1/data/export`, `POST /api/v1/data/import`).
- One data directory shared by the catalog, settings, manuals and backups
  (`AUDIOBIBLICA_DATA_DIR`, default `~/.audiobiblica`).
- Plain-language error messages for every failing request.
- Repository hygiene: MIT `LICENSE`, contributing and security policies, issue and pull request
  templates, Dependabot updates, and CI that also builds the packaged bundle and smoke-tests it.
- PDF manual ingestion with text extraction and automatic specification discovery.
- Equipment catalog with manufacturers, categories, models and specifications, searchable in the UI.
- Research agent: manufacturer search, crawling and structured specification extraction.
- MCP server over Streamable HTTP at `/mcp`, with `tools/list` and `tools/call`.
- Hybrid assistant supporting local Ollama, OpenAI, Anthropic and the Nanobot gateway, grounded in
  your catalog.
- Web UI: overview, library with import/edit/archive/delete, research agent, AV assistant, advanced
  tools and settings.

### Changed

- The default assistant model is `llama3.2:3b` (was `llama3.1`).
- The default research path needs no API key; Firecrawl remains an optional accelerator.
- The UI no longer downloads web fonts, so it renders identically offline.
- The default SQLite catalog moved out of the working directory into the data directory. An existing
  `./audiobiblica.db` is copied there on first start and left in place.

### Removed

- The dead `audiobiblica` console-script entry point.

[Unreleased]: https://github.com/vip3rousmango/audiobiblica/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vip3rousmango/audiobiblica/releases/tag/v0.1.0
