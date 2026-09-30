# Troubleshooting

This page lists the messages AudioBiblica can show you and what to do about each one. You do not need to be technical to follow them.

If nothing here helps, the exact wording you saw will help whoever you ask; the messages below are quoted exactly as the app shows them.

## The page will not open, or shows "Can't reach AudioBiblica"

**What you see:** `Can't reach AudioBiblica. Make sure the app is running, then try again.`

**Why:** the app is not running, or it is still starting up.

**Fix:** open Docker Desktop and wait until it says it is ready. Then run `./scripts/audiobiblica` again and wait for it to print that the app is running. If it still will not start, open Docker Desktop and check that the app's container shows as running.

## Docker Desktop is not installed

**What you see:** `AudioBiblica needs Docker Desktop once. Download it at https://www.docker.com/products/docker-desktop/ and run this command again.`

**Why:** Docker Desktop is the one thing you need to install before AudioBiblica can run.

**Fix:** install Docker Desktop from that link, open it, and then run `./scripts/audiobiblica` again. This is a one-time step.

## Web search does nothing

**What you see:** `Web search needs a Firecrawl key. You can still add manuals by link or PDF.`

**Why:** searching the wider web for manuals uses Firecrawl, which is a paid service that needs your own key.

**Fix:** you can ignore this — importing a PDF you own and reading a product or support page by link both work without any key. If you do want web search, open **Settings**, go to **Web search (optional)**, and paste a Firecrawl key.

## The assistant's model is not installed

**What you see:** `The assistant's model isn't installed yet. Open Settings and pick a model from the list.`

**Why:** the assistant runs a model on your own computer, and that model has not been downloaded yet.

**Fix:** open **Settings**, choose the **Assistant** section, and use the download button (about 2 GB). You need Ollama installed and running for this. If the app says Ollama is not reachable, install it from https://ollama.com/download, reopen AudioBiblica, and try again.

## The first answer takes a long time

**What you see:** `The assistant is still thinking. The first answer after a download can take a minute.`

**Why:** the model has to load into memory the first time. That is normal and only happens once per
session. A long question — the health report in **Check my setup** is a long one — also takes longer
to read than a short one.

**Fix:** wait a minute and ask again; later answers are much faster. AudioBiblica already asks Ollama
for a small context window on every request, because Ollama otherwise sizes a model for its full
training context (131072 tokens for `llama3.2`), and that is what makes a small model take minutes on
a laptop. If answers are still slow, set `ASSISTANT_NUM_CTX` to something smaller (4096) or choose a
smaller model in **Settings → Assistant**; if they never finish at all, check that Ollama is running
and raise `ASSISTANT_TIMEOUT` (seconds, default 180).

## There is no update button

**What you see:** the Overview has no update notice, or **Settings → Check my setup** says your
version is current when you know a newer one exists.

**Why:** three things can cause it. You really are on the newest version. The app could not reach
GitHub to check (this is normal offline — the check is silent, never an error). Or this installation
is not allowed to update itself: it is pinned to a version in a `.env` file, or it is running from
source, where there is no updater container.

**Fix:** look at the **Version** line in **Settings → Check my setup** — it says which of these it
is, in the same sentence. A pinned install is pinned on purpose; remove `AUDIOBIBLICA_VERSION` from
your `.env` file to receive updates again.

## An update did not finish

**What you see:** `The last update did not finish` on the Overview or in the health report, and the
app is still running the old version.

**Why:** the new version could not be downloaded (no internet, or a registry hiccup), or the new
container did not start.

**Fix:** run the start command again, which does the same work with the output visible:

```bash
./scripts/audiobiblica
```

Your catalog is untouched either way, and the copy taken before the update is still in `backups/`.
If it keeps failing, `docker compose logs updater` (from `~/.audiobiblica/app`) shows what the
updater tried.

## Something went wrong, but your catalog is safe

**What you see:** `Something went wrong on our side. Your catalog is safe — try again.`

**Why:** the app hit an unexpected problem, but your devices, manuals, and notes were not affected.

**Fix:** try the same action again. Your data is stored in `~/.audiobiblica` (or the `audiobiblica_data` volume), and the app also keeps automatic backups in the `backups` folder there.

## A general failure

**What you see:** `That didn't work. Try again, or open Settings to check your setup.`

**Why:** the app could not complete the action and does not have a more specific message for it.

**Fix:** try again. If it keeps happening, open **Settings** and check that the assistant and, if you use it, the web-search key are set up.

## The assistant replies "model '<name>' not found"

**What you see:** an assistant answer containing `model '<name>' not found`.

**Why:** the model chosen in Settings is not one the assistant can find on your computer. This usually means Ollama does not have it downloaded.

**Fix:** open **Settings**, go to the **Assistant** section, and pick a model from the list shown there — that list is exactly what your computer has available. You can also run `ollama list` in a terminal to see the same set, and `ollama pull <name>` to download one.

## The app says the port is already in use

**What you see:** the app fails to start with `[Errno 48] address already in use`.

**Why:** another copy of the app (or an old one that did not shut down cleanly) is already using the port.

**Fix:** if you run from source, find and stop the old process: run `lsof -nP -iTCP:8000 -sTCP:LISTEN` to see what is holding the port, then `kill <pid>` using the number it shows. Then start the app again. If you use Docker, run `docker compose down` first, then `./scripts/audiobiblica`.

## Starting from source fails with "ModuleNotFoundError: No module named 'mcp'"

**What you see:** `ModuleNotFoundError: No module named 'mcp'` when starting the app from source.

**Why:** the app was started with your computer's system Python, which does not have the project's libraries installed.

**Fix:** install the project's libraries into its own environment and run it from there:

```bash
python3 -m venv venv
./venv/bin/pip install -e ".[dev,scrapers]"
./venv/bin/python3 -m uvicorn src.backend.main:app --host 127.0.0.1 --port 8000
```

Using the `./venv/bin/python3` path avoids the problem. The Docker path in [GETTING-STARTED.md](GETTING-STARTED.md) does not have this issue at all.
