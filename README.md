AudioBiblica is a private, local-first catalog of your studio gear — with the manuals you own searchable by an assistant that runs on your own computer.

## Start it

You need Docker Desktop once. Everything else is included.

1. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and open it.
2. In a terminal, run:

```bash
./scripts/audiobiblica
```

That command builds and starts AudioBiblica, waits for it to come up, and opens http://localhost:8000 in your browser. It is the same one command every time; run it again to start the app after a restart.

If you prefer to run it yourself instead of using the script, the equivalent is:

```bash
docker compose up -d --build
```

Then open http://localhost:8000.

## First five minutes

1. **Add a device.** On the Overview page, click **Add a device** and fill in the name, maker, and category of something in your studio.
2. **Import a manual.** Open **Library**, open the device, and add a document. You can import a PDF you already own, or paste a product or support page link and let AudioBiblica read the page for you.
3. **Ask a question.** Open **AV assistant** and ask something about your gear, for example: "What are the input and output connections on the interface I just added?" The first time you use the assistant it offers a one-click model download (about 2 GB); see Optional extras below.

## Where your data lives

Everything stays on this computer. Nothing is uploaded anywhere, and AudioBiblica works with no account and no cloud service.

Your data lives in one folder, `~/.audiobiblica` by default:

- `audiobiblica.db` — your catalog: devices, their manuals, and research notes.
- `config.json` — your settings, including any API keys you have entered. It is readable only by your user account.
- `manuals/` — the PDF manuals you have imported.
- `backups/` — automatic safety copies of your catalog, taken every time the app starts. The ten most recent are kept and older ones are removed.

When you run the Docker bundle, the same folder is a Docker volume named `audiobiblica_data` instead of a visible folder on your desktop. If you want it somewhere specific, set the `AUDIOBIBLICA_DATA_DIR` environment variable to the path you prefer.

## Optional extras

Both of these are optional. The app is useful without them.

- **Assistant model.** The assistant runs a small language model on your own machine through Ollama. AudioBiblica detects whether Ollama is running and, when it is, offers a button to download the default model (about 2 GB). One click, one time. If Ollama is not installed, the app says so and links you to https://ollama.com/download.
- **Web search.** Searching the wider web for manuals uses Firecrawl, which needs your own Firecrawl key. Add it in **Settings** under **Web search (optional)**. Without a key, importing a PDF you own and reading a product or support page by link both still work.

## Updating

Run the same command you started with; it rebuilds the app with the newest code you have and restarts it:

```bash
./scripts/audiobiblica
```

Your catalog and manuals are untouched by an update. If you cloned the project with git, run `git pull` first to fetch the newest version.

## Uninstalling

Stop the app:

```bash
docker compose down
```

Then delete your data. If you used the Docker bundle, remove the volume:

```bash
docker volume rm audiobiblica_data
```

If you used the app directly, delete the folder `~/.audiobiblica`. This is permanent — it removes your catalog, manuals, settings, and backups.

## Something not working?

- **The page will not open.** Make sure Docker Desktop is running, then run `./scripts/audiobiblica` again.
- **The assistant says its model is not installed.** Open **Settings**, choose the **Assistant** section, and download the model. It needs Ollama installed and running on your computer.
- **Web search does nothing.** That feature needs a Firecrawl key. Everything else works without one.
- **The assistant is slow the first time.** The first answer after a model download can take a minute while the model loads. Later answers are quicker.

The full list of messages and what to do about each is in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## For developers

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the architecture notes in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

To run from source instead of Docker, you need Python 3.10+ and Node 18+:

```bash
git clone https://github.com/vip3rousmango/audiobiblica.git
cd audiobiblica
python3 -m venv venv
./venv/bin/pip install -e ".[dev,scrapers]"
./venv/bin/python3 -m uvicorn src.backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal, start the user interface:

```bash
cd src/frontend
npm install
npm run dev
```

The development server runs on http://localhost:5173 and talks to the backend on port 8000.

## License

AudioBiblica is open source under the MIT License. See [LICENSE](LICENSE).
