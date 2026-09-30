## What changed

<!-- One paragraph. What the change does, and which files or areas it touches. -->

## Why

<!-- The problem it solves, or the issue it closes: "Closes #123". -->

## How it was verified

<!-- What you actually ran or clicked, and what you saw. "Ran the suite" is not enough on its own;
     say what the suite covers for this change, or paste the command and its result. -->

## Checklist

- [ ] `./venv/bin/python3 -m ruff check src/backend tests` passes
- [ ] `./venv/bin/python3 -m pytest tests -q` passes
- [ ] `cd src/frontend && npm run build` passes
- [ ] The novice path still works: a fresh `docker compose up` reaches a usable page at http://localhost:8000
- [ ] User-visible errors are plain sentences with a next step (added to `friendlyMessage` rather than worded at a call site)
- [ ] No new mandatory dependency on a paid service
