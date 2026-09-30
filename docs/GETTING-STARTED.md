# Getting started

AudioBiblica keeps a catalog of your studio gear and makes the manuals you own searchable. It runs on your own computer and keeps your data there. You do not need an account, and you do not need to be technical.

This walkthrough takes you from nothing to asking your first question.

## 1. Install Docker Desktop once

AudioBiblica runs inside a small self-contained package called a Docker container. To run it you need **Docker Desktop**, which is free for personal use.

1. Go to https://www.docker.com/products/docker-desktop/ and download Docker Desktop for your computer (macOS, Windows, or Linux).
2. Install it the way you install any other app.
3. Open Docker Desktop and leave it running. You will see a small whale icon in your menu bar or system tray when it is ready.

You only do this once. If Docker Desktop is not running, AudioBiblica will tell you so and nothing else will work — so start it first.

## 2. Start AudioBiblica

Open a terminal window and run this one command:

```bash
./scripts/audiobiblica
```

What happens:

- It checks that Docker Desktop is running. If it is not, it prints a short message telling you where to get it.
- It builds and starts AudioBiblica.
- It waits until the app is ready, then opens http://localhost:8000 in your web browser.

That is the same command every time you want to use AudioBiblica. If you close everything and come back tomorrow, run it again.

If you would rather start it without the helper script, the equivalent command is:

```bash
docker compose up -d --build
```

and then open http://localhost:8000 yourself.

*[screenshot: the Overview page with the first-run checklist]*

## 3. Your first five minutes

### Add a device

Click **Add a device** on the Overview page. Type in the name of a piece of gear, its manufacturer, and a category (for example, "Audio interface" or "Microphone"). Save it. Repeat for anything else you want to keep track of.

### Import a manual

Open **Library**, click the device you just added, and add a document. You have two options:

- **Import a PDF you own.** Pick the file from your computer. This works completely offline.
- **Add from a link.** Paste the address of a product page or a support page. AudioBiblica reads the page and saves the useful text as a note against that device. This also works without any paid service.

PDFs you already own are the most reliable source. Use them freely.

### Ask a question

Open **AV assistant** and type a question about your gear, for example: "What kind of power supply does my mixer need?" or "Summarise the setup steps in the manual for my audio interface."

The first time you use the assistant, it offers to download a small model (about 2 GB) that runs on your own computer. You need to have Ollama installed for this — if you do not, the app says so and links you to https://ollama.com/download. Click the download button, wait a few minutes, and then ask your question. The very first answer can take a minute while the model loads; after that it is quicker.

## What each screen is for

- **Overview** — the dashboard. It shows how many devices you have, how many manuals are indexed, and whether the app and the assistant are ready. The first-run checklist lives here.
- **Library** — your catalog. This is where you add, search, and open devices, and where you import manuals and read research notes.
- **Research** — where you gather documentation for a device: reading a page by link, importing a PDF, and (optionally) searching the web with your own Firecrawl key.
- **AV assistant** — a chat window that answers questions using your own catalog and manuals, running the model on your computer.
- **Settings** — your setup: which assistant model to use, the optional Firecrawl key for web search, where your data lives, and tools to export or import your catalog.
- **Advanced tools** — the technical interfaces (for example the MCP endpoint). You never need this to use the app.

*[screenshot: the Library page with a device open and one manual listed]*

## What works with no internet

You do not need an internet connection for day-to-day use. With no connection you can:

- Add, edit, and organise your devices.
- Import PDF manuals you already own.
- Ask the assistant questions about your gear.

You only need a connection to install Docker Desktop, to download the assistant model the first time, and to read a product or support page from a link or to search the web. Nothing about your catalog or your questions is sent anywhere.

## Where to go next

- If something does not work, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
- For the project overview and where your data lives, see the main [README](../README.md).
