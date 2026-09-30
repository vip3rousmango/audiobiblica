```text
   _  _   _ ___ ___ ___  ___ ___ ___ _    ___ ___   _
  /_\| | | |   \_ _/ _ \| _ )_ _| _ ) |  |_ _/ __| /_\
 / _ \ |_| | |) | | (_) | _ \| || _ \ |__ | | (__ / _ \
/_/ \_\___/|___/___\___/|___/___|___/____|___\___/_/ \_\

          ▁▂▃▅▇█▇▅▃▂▁   your gear · your manuals · your computer   ▁▂▃▅▇█▇▅▃▂▁
```

**A private catalog of your studio gear — with the manuals you own searchable by an assistant that runs on your own computer.**

No account. No subscription. No cloud. If your internet goes down, AudioBiblica doesn't notice.

[![License: MIT](https://img.shields.io/badge/license-MIT-yellowgreen)](LICENSE)
[![CI](https://github.com/vip3rousmango/audiobiblica/actions/workflows/ci.yml/badge.svg)](https://github.com/vip3rousmango/audiobiblica/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/vip3rousmango/audiobiblica)](https://github.com/vip3rousmango/audiobiblica/releases)
[![Works offline](https://img.shields.io/badge/internet-not%20required-lightgrey)](#what-it-does)

![The AudioBiblica overview: five devices catalogued, two manuals indexed, and a system pulse showing every local service ready](https://raw.githubusercontent.com/vip3rousmango/audiobiblica/main/docs/images/overview.webp)

## What it does

You own the gear. You own the manuals. The problem is finding things: which preamp has 48V on every channel, where that interface's clock settings are described, what you wrote down about a mic you borrowed two years ago.

AudioBiblica is one place to keep all of it, on your machine:

- **Your gear, written down once.** Every mic, preamp, interface, monitor and pedal, with the details you actually care about.
- **Your manuals, searchable.** Drag in the PDFs you already own, or paste a product page and let the app read it for you.
- **Plain questions, real answers.** "What are the input and output connections on the interface I just added?" The assistant reads *your* catalog to answer — not the internet.
- **Notes that stay found.** Research you gather about a piece of gear is attached to that piece of gear, not buried in a browser history.
- **Your gear, photographed.** Point your phone at a device, scan the code in Settings, and the app writes the entry for you — one device, or a whole rack in a single shot.

```text
   your gear  ──►  your catalog  ──►  a question  ──►  an answer you can act on
```

Everything lives in one folder on your computer. Nothing is uploaded anywhere.

## Start it

Five minutes, once. You need **Docker Desktop** and nothing else — no Python, no Node, no build tools.

**1. Install Docker Desktop** from <https://www.docker.com/products/docker-desktop/> and open it. Wait until it says it is running (a whale icon in your menu bar means it is ready).

**2. Open a terminal** — on macOS, press `⌘-Space`, type `Terminal` and press Enter; on Windows or Linux, use yours — and paste these two lines:

```bash
git clone https://github.com/vip3rousmango/audiobiblica.git
cd audiobiblica
```

That downloads this project into a folder called `audiobiblica` in your home folder — that is where `./scripts/audiobiblica` below comes from; it is a file in that folder, not something you install separately.

**3. Start it:**

```bash
./scripts/audiobiblica
```

That one command builds the app, starts it, waits until it answers, and opens **<http://localhost:8000>** in your browser. The first run takes a few minutes; every run after that is seconds.

> Use the same command every time you want to start AudioBiblica, for example after restarting your computer. If you would rather not use the script, `docker compose up -d --build` does exactly the same thing.

## First five minutes

**1. Add a device.** On the Overview page click **Add a device**. A name, a maker and a category are enough to begin — everything else is optional.

**2. Import a manual.** Open **Library**, click your device, then add a document. You can drop in a PDF you already own (it stays on your computer) or paste a product or support page link and let AudioBiblica read the page for you.

**3. Ask a question.** Open **AV assistant** and ask about your gear. The first time, it offers to download a small language model — one click, about 2 GB, one time. See [Optional extras](#optional-extras) if you would rather set that up yourself.

## What it looks like

Your whole collection, searchable by name, maker, model or specification:

![The equipment library: five devices shown as cards with category, model, manual count and research count](https://raw.githubusercontent.com/vip3rousmango/audiobiblica/main/docs/images/library.webp)

And it can tell you what is wrong with itself, in plain words:

![Settings → Check my setup: five checks with green dots, one asking to back up, and a "Back up now" button](https://raw.githubusercontent.com/vip3rousmango/audiobiblica/main/docs/images/check-my-setup.webp)

## Your data stays yours

```text
   ┌──────────────────────── your computer ────────────────────────┐
   │                                                               │
   │    your catalog      your PDFs      the assistant's model     │
   │                                                               │
   │              ↑ nothing here is uploaded anywhere ↑            │
   └───────────────────────────────────────────────────────────────┘
```

Everything lives in one folder:

- `audiobiblica.db` — your catalog: devices, manuals, research notes.
- `manuals/` — the PDFs you imported.
- `backups/` — automatic copies of your catalog, taken every time the app starts. The ten newest are kept.
- `config.json` — your settings and any API keys you entered.
- `audiobiblica.log` — what the app did. If something ever goes wrong it shows you a short reference like `Ref 4f2a9c31`, and the matching detail is in this file.
- `photos/` — photos you took from your phone, kept with the gear they produced.

When you run it with Docker, that folder is a Docker storage area called `audiobiblica_data` instead of a visible folder. You can back the whole thing up by exporting from **Settings → Your data**, and move it to another computer by importing that file.

## Optional extras

Both of these are optional. The app is genuinely useful without them.

| | What it is | What you need |
|---|---|---|
| **The assistant** | Ask questions about your own gear in plain language | [Ollama](https://ollama.com/download), free. AudioBiblica notices it and offers a one-click model download (~2 GB) |
| **Web search** | Search the wider web for manuals and specs | Your own [Firecrawl](https://firecrawl.dev) key, added in **Settings → Web search** |

Without either one, adding devices, importing PDFs you own, and reading a manual from a link all still work.

## Add gear from your phone

Your phone cannot browse the catalog, and that is deliberate: the camera on it is a better way to
write gear down than a keyboard is. Open **Settings → Mobile capture** on the computer, scan the code
with the phone's camera, and a small page opens:

```text
   ┌────────────── your phone ──────────────┐
   │   One device  │  Whole studio          │
   │   [ Take a photo ]                     │
   │   "Focusrite · ISA ONE · 95% sure"     │
   │   [ Add ]  [ Skip ]                    │
   └────────────────────────────────────────┘
```

Pick **One device** for a single photo of a front panel or a back panel with the connections, or
**Whole studio** for a shot of the rack, which can produce several entries at once. Each guess is
editable before you add it, and anything you add waits as a draft in the library until you check it
over — tick a batch of them and confirm them in one go.

The reading is done by a local vision model ([Ollama](https://ollama.com/download), about 6 GB the
first time), so **the photos are never uploaded anywhere**. They stay attached to the device they
produced, and the only way in is the link in the QR code: anyone on your wifi with that link can add
gear, so press **New link** in Settings if you ever want to cut them off.

If the panel instead says there is no code to scan yet, the app is running in Docker and cannot see
your computer's address on the network — run `./scripts/audiobiblica` once and it fills it in. (It
does that on every run, so a laptop that moves between wifi networks keeps working.)

## Updates look after themselves

AudioBiblica checks for a newer version and, when there is one, says so **on the Overview** — one button, and it is done:

```text
   ┌──────────────────────────────────────────────────────────────┐
   │  Version 0.1.2 is available (you are running 0.1.1).  [Update now] │
   └──────────────────────────────────────────────────────────────┘
```

One click downloads the new version, replaces the app, and the page reloads itself into it. Your catalog is copied before anything is replaced, and the old version's copy stays in `backups/` — so an update is always something you can go back from.

The same button is in **Settings → Check my setup**, along with everything else the app knows about its own health.

**If you would rather update by hand**, running the start command again does exactly the same thing — it fetches the newest version and restarts:

```bash
./scripts/audiobiblica
```

You never need `git` for this. The command keeps its own copy of the two files it needs in `~/.audiobiblica/app`, refreshes them whenever it can, and only ever downloads a published version — nothing is built or compiled on your computer.

**To pin a version** (and turn updates off), put `AUDIOBIBLICA_VERSION=0.1.1` in a `.env` file next to the app files; the app then tells you it is pinned instead of offering an update.

### What updating actually does here

Two containers run: the app, and a small one whose only job is updates. Only the second one can talk to Docker, and all it can do is download the published image and restart the app container — the app you see in the browser has no such power. The app asks it by writing a file, and reads back what it is doing, which is how the progress on screen is possible.

## Uninstalling

```bash
cd ~/.audiobiblica/app                # where the app files live
docker compose down                   # stop the app and the updater
docker volume rm audiobiblica_audiobiblica_data audiobiblica_audiobiblica_control
```

The first volume is your catalog, manuals and settings; deleting it is permanent.

## Something not working?

- **The page will not open.** Make sure Docker Desktop is running, then run `./scripts/audiobiblica` again.
- **It says the assistant's model is not installed.** Open **Settings → Assistant** and use the download button; it needs Ollama installed and running.
- **Something looks wrong but you are not sure what.** Open **Settings → Check my setup** — it inspects the app, explains what it found in one sentence, and offers the fix where there is one.
- **Web search does nothing.** That needs a Firecrawl key. Everything else works without one.
- **The update button is missing.** Your version has nothing newer to install, or this install cannot update itself — open **Settings → Check my setup**, where the version line says which. A pinned install (`AUDIOBIBLICA_VERSION` in `.env`) never updates itself by design.
- **An update did not finish.** Run `./scripts/audiobiblica`; it does the same work with the output visible.
- **The first answer is slow.** The model has to load the first time. Later answers are quick; if every answer is slow, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

The complete list of messages and what to do about each is in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## For developers

```text
   PDF ──────┐
             ├──►  your catalog  ──►  search  ──►  the assistant
   link ─────┘            │                      (Ollama · OpenAI · Anthropic)
                          └──►  MCP tools, for other agents on your machine
```

A FastAPI backend with a SQLite catalog, a React front end served from the same origin, and an MCP server over Streamable HTTP at `/mcp` exposing the catalog as read-only tools (`search_equipment`, `get_equipment_specifications`, `find_manuals`, `search_manufacturer_docs`).

Wiring another app to a running AudioBiblica — reading the catalog, or feeding it physical facts back — is documented in [docs/INTEGRATION.md](docs/INTEGRATION.md): topology and pairing, the endpoint reference, the device matcher both sides should share, and the MCP surface for agents.

Run it from source with Python 3.10+ and Node 18+:

```bash
git clone https://github.com/vip3rousmango/audiobiblica.git
cd audiobiblica
python3 -m venv venv
./venv/bin/pip install -e ".[dev,scrapers]"
./venv/bin/python3 -m uvicorn src.backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal, start the user interface with live reload:

```bash
cd src/frontend
npm install
npm run dev        # http://localhost:5173, talking to the backend on 8000
```

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — architecture, the nanobot integration, environment variables.
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to send a change.
- The `pip` package is the API and the MCP server only: it has no interface of its own. The app a musician runs is the container image, which serves the built front end and the API from one port.
- `./venv/bin/python3 -m pytest tests -q` and `./venv/bin/python3 -m ruff check src/backend tests` are the two gates CI runs.

## License

MIT — see [LICENSE](LICENSE). Use it, change it, ship it.
