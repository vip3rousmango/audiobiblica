# Contributing to AudioBiblica

Thanks for helping. AudioBiblica is local-first and offline-capable by design: no feature should
require a paid service or a cloud account to work, because the people it is built for are musicians
and home-studio producers, not system administrators.

## Ways to help

- Report a bug with the bug report template.
- Suggest a feature with the feature request template.
- Improve the documentation musicians actually read — `docs/GETTING-STARTED.md` and
  `docs/TROUBLESHOOTING.md`.
- Fix a bug or add a feature, then open a pull request.

## Development setup

Prerequisites: Python 3.10+, Node 18+ (20 recommended), and Docker Desktop only if you want to run
the packaged bundle.

```bash
git clone https://github.com/vip3rousmango/audiobiblica.git
cd audiobiblica
python3 -m venv venv
./venv/bin/pip install -e ".[dev,scrapers]"
```

### Run the backend

```bash
./venv/bin/python3 -m uvicorn src.backend.main:app --host 127.0.0.1 --port 8000
curl http://127.0.0.1:8000/health   # {"status":"ok","version":"0.1.1"}
```

### Run the frontend

```bash
cd src/frontend
npm install
npm run dev   # http://localhost:5173
```

The dev server talks to the backend origin in `VITE_API_BASE_URL`, which
`src/frontend/.env.development` sets to `http://127.0.0.1:8000`. A production build leaves that
variable empty, so the built UI calls whatever origin served it.

### Run the packaged bundle

```bash
./scripts/audiobiblica        # or: docker compose up -d --build
open http://localhost:8000
```

`AUDIOBIBLICA_UI_DIR` is what makes the backend serve the built UI; the image sets it to `/app/ui`.

## Before you open a pull request

Run all three:

1. `./venv/bin/python3 -m ruff check src/backend tests`
2. `./venv/bin/python3 -m pytest tests -q`
3. `cd src/frontend && npm run build`

CI runs the same three plus a Docker job that builds the bundle and asserts the UI and the API answer
on one port. Keep all of them green.

Type checking with mypy is aspirational: there is no mypy configuration, no CI job, and the code is
untyped. Do not add annotations purely to satisfy a checker, and do not add a mypy job to CI.

## Tests

`tests/test_api_smoke.py` guards the HTTP surface. Every route must answer its documented status for
valid and invalid input and must never return 500 for input a client can send. Add a case there when
you add a route.

Tests must be deterministic, isolated, and safe to run in a single process. The module-level app and
the MCP streamable-HTTP session manager can only be started once, so the suite shares one `TestClient`
and points `AUDIOBIBLICA_DB_PATH`, `AUDIOBIBLICA_CONFIG_PATH` and `AUDIOBIBLICA_MANUAL_DIR` at a
temporary directory.

## Conventions that matter here

- **Plain language for failures.** Every user-visible error is a plain sentence with a next step.
  The single place that does this is `friendlyMessage()` in `src/frontend/src/lib/api.ts`; the raw
  server string is kept on `ApiError.technical` and logged. Add a case there rather than wording an
  error at a call site.
- **No new hard dependency on a paid service.** Firecrawl stays optional; the built-in page reader
  is the zero-key default path.
- **Keep the novice path working.** A change that makes a musician's first run harder is a regression
  even when it adds capability.
- **Data safety first.** Anything that writes to the catalog must keep working when the catalog file
  is read-only or missing, and must never delete user data on a failed operation.

## Commits and pull requests

- One logical change per commit; imperative subject under 72 characters, for example
  `Add catalog export endpoint`.
- The pull request template asks for what changed, why, and how you verified it. Fill it in.
- Reference the issue you are closing when there is one.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Report unacceptable behaviour to
conduct@audiobiblica.dev.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
