# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.9] - 2026-10-01

### Added

- **Send your devices to EasySchematic the way you actually own them.** Every device's details got a
  **Send to EasySchematic** panel: it proposes the closest device kind and a starting set of ports
  (an interface starts with two inputs, an output, headphones and the computer link), and you draw
  the sockets it really has — connector, signal, direction — from the same list EasySchematic
  itself uses. One click saves the JSON its own import accepts, so an M1 laptop goes in as a laptop
  with a laptop's I/O, not as the nearest "Mac Mini". Settings gained an **EasySchematic** section:
  it names what is running next door, has a **Send the whole catalog** one-file export, and, when no
  EasySchematic is there, offers one command that installs it — a command that checks first and
  never installs a second copy on top of an existing one.
- The assistant and agents can do the same: two new MCP tools — `easyschematic_status` and
  `easyschematic_export_devices` — mirror the panel.

### Changed

- EasySchematic joined the Service information screen's probed list with the same container-aware
  check as everything else.

### Known limits, said plainly

- EasySchematic's own agent bridge cannot set ports (its Beta says so), and writing into its shared
  library is gated. The file path this release uses is the one that carries real ports; the
  panel says all of this instead of pretending otherwise.

## [Unreleased]

Nothing yet.

## [0.1.8] - 2026-10-01

### Added

- **Settings gained a Service information screen.** What is running on this computer — the app, the
  built interface, the assistant and its chosen model, the photo reader, the MCP server, the
  self-updater, the research sources, and EasySchematic — each named with an honest status and the
  address it was found on or is expected at. It also shows the address to open this catalog on this
  computer, the pairing link a phone captures, and every path AudioBiblica reads or writes (the
  database, manuals, photos, backups, logs) with a copy button. It answers "which address do I open
  on my phone" and "is my updater actually running" without a terminal.
- The EasySchematic check in that screen looks at `host.docker.internal` as well as `localhost`,
  because the app runs in a container — the first version of the check reported a running
  EasySchematic as absent.

### Fixed

- The research panel's summary counts ran together ("0 fully documented⚠" against "1 missing a
  manual"). They are a spaced row now.
- The plan headline was not a sentence: "8 steps for a Microphone — 1 need a key" is now "8 steps
  for a Microphone — two of them need a key", with the article and plural handled properly ("an
  Interface", "1 device").
- Small type was exactly too small. Chips and step metadata sat near 10 px, the threshold where
  reading turns into squinting; they moved up about a point.

## [0.1.7] - 2026-09-30

### Fixed

- **The EasySchematic template source failed on every step it served.** Port, connector, clock and
  polar-pattern questions are answered from its catalogue, and the step handler shadowed the
  catalogue fetcher of the same name, so it called itself with no arguments and recorded a `TypeError`
  as the step's error — visible in the panel as a stack trace rather than an answer. Found by reading
  a run's own detail on the published image.
- A catalogue that **could not be fetched** no longer reports itself as "no template matches this
  device": an empty catalogue is a fact, an unreachable one is not, and only one of those justifies
  saying nothing was found.

## [0.1.6] - 2026-09-30

### Added

- **A research run is drawn as a tree of data.** The device, the questions asked of it, the sources
  each answer came from, and the quote or fact it yielded — every subtree collapsed to a count and
  expanding on demand, with arrow keys to walk it and Enter to open a source. The shape carries the
  information: which question found nothing, which is waiting on a key, which source answered three
  of them at once.
- **A run streams.** Each step appears where it belongs the moment it is produced, over
  server-sent events, instead of the panel asking every second and a half. A finished run's stream
  says so and closes. The old list view stays behind a toggle, for reading a run rather than seeing
  its shape.

### Fixed

- **OpenAI and Anthropic claimed to be ready when they were not.** They take their key from
  **Assistant** rather than from the research panel, and the panel was treating "does not take a key
  here" as "needs no key at all" — so it showed them as *Always available* with nothing set up. They
  now say *Not set up yet* and point at the assistant, because a screen about what the app can do is
  the last place that should overstate it. Found by reading the published 0.1.5's own answer:
  "6 keyless" for four keyless services.

## [0.1.5] - 2026-09-30

### Added

- **Research is a run you watch, rather than a row of buttons.**
  Every device has a *plan* — the questions worth asking of that kind of device, from polar pattern and
  phantom power for a microphone to clock source for an interface, connectors for a monitor — and each
  step names the service that would answer it.
- **Sources you bring.** The page reader, your own manual text, the catalog and EasySchematic's device
  catalogue need no key at all; Firecrawl, a web search, Discogs, YouTube and Reverb are keys you can
  paste into **Settings → Research sources**, stored on this computer only, each with a one-call test.
  Firecrawl reuses the key the web-search panel already holds, and OpenAI/Anthropic are borrowed from
  the assistant instead of asked for twice. A step whose key is missing says so instead of quietly
  returning nothing.
- **Runs keep their plan.** Starting a run records all of its steps first, then fills them in as it
  goes — your catalog, then the text of the manuals you have, then the pages you have linked, then
  whatever you have brought keys for. A step that found nothing, needs a key, or failed says which.
- **Nothing counts until you confirm it.** What a run finds waits in a review queue, one finding per
  question asked with the sources it rests on. Only reviewed findings count towards **what is missing**
  — the device-by-dimension matrix that answers "what does my studio still not have documented".

## [0.1.4] - 2026-09-30

### Fixed

- **A Docker install could not pair a phone.** The pairing link is built from the machine's address
  on your network, and a container cannot see that: inside Docker the guess returns the container's
  own address (`172.17.0.2`), which no phone can reach, so the code in **Settings → Mobile capture**
  pointed at nowhere. `./scripts/audiobiblica` now works the address out on the machine and fills it
  in, and refreshes it on every run — a laptop that moves between networks gets a link that still
  works. Found by booting the published image and reading its own status, which is the habit that
  caught the 0.1.2 lockout too.
- When that address is missing — a copy started by hand with `docker compose up` rather than the
  launcher — the panel now says so and names the two ways to fix it, instead of showing a code that
  sends the phone into Docker's private network.

### Added

- `AUDIOBIBLICA_LAN_ADDRESS` and `AUDIOBIBLICA_PORT` are forwarded into the container, so the address
  a phone is told to use can be set deliberately. An address in the environment always wins over the
  one the launcher detects.

## [0.1.3] - 2026-09-30

### Fixed

- **0.1.2 could lock you out of your own app when it runs in Docker.** Docker publishes the port
  through its own forwarder, which rewrites the source address of every request that arrives to the
  VM's gateway — so the new gate saw the machine's own browser as "not this computer" and answered
  it with 401. A request whose host name is `localhost` or `127.0.0.1` is now accepted as coming
  from this computer as well. A device reaching the machine by its network address still needs the
  pairing link, which is the point of the gate: your browser opens the app, your phone pairs.
  Found by booting the published image and asking it for `/health`, and `tests/test_mobile.py` now
  covers both halves of it so it cannot come back quietly.

## [0.1.2] - 2026-09-30

### Added

- **Capture gear with your phone.** The desktop shows a QR code in **Settings → Mobile capture**;
  scanning it with the phone's camera opens a small page built for a rack — one device or a whole
  studio in a single shot. The photo is read by a vision model on your own computer (`qwen2.5vl:7b`
  by default, one click to download), the guesses come back as editable cards, and what you add
  waits in the library as a draft until you check it over. The pairing link is dropped from the phone's
  address bar as soon as the page opens, so a screenshot or a shared tab carries no token.
- Photos stay attached to the device they produced, in its record, next to the manuals — and are
  never uploaded anywhere: the reading happens on the machine that already holds the catalog.
- **Needs review**: a banner in the library counts what a capture added, a filter shows only those
  devices, and ticking a batch of them confirms, re-categorises, archives or deletes the lot in one
  request.
- `docs/INTEGRATION.md`: the reference for wiring another local app to a running AudioBiblica —
  topology and pairing, the endpoint list, the device matcher both sides should share, the MCP
  surface for agents, and the planned contracts for the studio console and Live Sessions.

### Changed

- The app can be reached from another machine on the wifi, so the catalog is now gated: anything
  that does not come from this computer has to present the pairing token (the link in
  **Settings → Mobile capture**, or the cookie it sets). Nothing is exempt — `/health` included.
- Browser access is an allow-list (this computer and its address on the local network) rather than
  `*`, and a browser's preflight is still answered without a credential.
- The capture page renders outside the desktop shell, so a phone gets one column instead of a
  sidebar it cannot use.
- `/health` reports the version from the one place it is declared, so it can no longer disagree with
  the image that is running.

## [0.1.1] - 2026-09-30

### Added

- AudioBiblica updates itself. It checks for a newer release, says so on the Overview, and installs
  it from a single button: the new version is downloaded, the app is replaced, and the page reloads
  into it. The catalog is copied first, so an update is always something you can go back from.
- A small updater container is the only thing that can talk to Docker, and all it can do is pull the
  published image and recreate the app container. The app itself holds no such power: it asks by
  writing a request file and reads back the updater's progress.
- `./scripts/audiobiblica` now works without git and is also the update path: it keeps its own copy
  of the two files it needs under `~/.audiobiblica/app`, refreshes them, pulls the published image,
  and starts. Nothing is built on the machine that runs it.
- `AUDIOBIBLICA_VERSION` pins a version, and the app then reports that it is pinned instead of
  offering an update.
- The health report gained a **Version** check, and the README became a landing page: real
  screenshots, plain language, developers at the end.

### Changed

- `docker-compose.yml` runs the published multi-architecture image and no longer builds. Developers
  (and CI) build from the checkout with `docker-compose.dev.yml`.

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
- Automatic recovery from a damaged catalog: startup checks the catalog, keeps the damaged file as
  `audiobiblica-broken-<timestamp>.db`, and restores the newest snapshot that still opens (or starts
  empty and says so). Unreadable files are reported instead, never moved.
- One-click restore of any snapshot from **Settings → Your data**, which snapshots what is live first
  so a restore is itself undoable (`POST /api/v1/data/restore`).
- **Settings → Check my setup**: a health report of the catalog, the backups, the assistant runtime
  and model, and the imported PDFs, with the fix that applies to each problem, a copyable report, and
  "Ask the assistant to explain this" for a plain-language reading of it.
- A rotating application log in the data directory (`audiobiblica.log`) and a reference on every
  unexpected failure, so a user can quote one short code and it appears next to the traceback.

### Changed

- Snapshots are consistent copies taken through SQLite rather than file copies, so a snapshot can no
  longer be torn by a write in progress, and two snapshots in the same second no longer overwrite
  each other.
- The Nanobot runtime now speaks nanobot's actual chat API: one user message per request, no `model`
  field, with any system prompt folded into that message. It previously sent the whole conversation
  with a system role and `model: "nanobot"`, which nanobot rejects.
- The assistant's explanation of a health report is sent as a digest, so it fits a chat message.
- The default assistant model is `llama3.2:3b` (was `llama3.1`).
- The default research path needs no API key; Firecrawl remains an optional accelerator.
- The UI no longer downloads web fonts, so it renders identically offline.
- The default SQLite catalog moved out of the working directory into the data directory. An existing
  `./audiobiblica.db` is copied there on first start and left in place.
- The first screen meets WCAG AA contrast and label rules, and the crash panel's recovery buttons are
  styled by the real button component.
- The frontend no longer installs Electron, Tailwind or PostCSS — nothing compiled or ran them.
- `.github/workflows` actions are pinned to current majors, so CI no longer warns about deprecated
  Node 20 runtimes, and Dependabot now watches the workflow pins.

### Removed

- The dead `audiobiblica` console-script entry point.

[Unreleased]: https://github.com/vip3rousmango/audiobiblica/compare/v0.1.9...HEAD
[0.1.7]: https://github.com/vip3rousmango/audiobiblica/releases/tag/v0.1.7
[0.1.8]: https://github.com/vip3rousmango/audiobiblica/releases/tag/v0.1.8
[0.1.9]: https://github.com/vip3rousmango/audiobiblica/releases/tag/v0.1.9
[0.1.6]: https://github.com/vip3rousmango/audiobiblica/releases/tag/v0.1.6
[0.1.5]: https://github.com/vip3rousmango/audiobiblica/releases/tag/v0.1.5
[0.1.4]: https://github.com/vip3rousmango/audiobiblica/releases/tag/v0.1.4
[0.1.3]: https://github.com/vip3rousmango/audiobiblica/releases/tag/v0.1.3
[0.1.2]: https://github.com/vip3rousmango/audiobiblica/releases/tag/v0.1.2
[0.1.1]: https://github.com/vip3rousmango/audiobiblica/releases/tag/v0.1.1
[0.1.0]: https://github.com/vip3rousmango/audiobiblica/releases/tag/v0.1.0
