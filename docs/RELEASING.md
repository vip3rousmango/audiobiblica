# Releasing AudioBiblica

Every release follows the same six steps. The point of writing them down is that the app now updates
itself: a tag is not a commit message, it is the thing a running install acts on.

```text
   write  ──►  bump  ──►  commit + push  ──►  tag + push  ──►  verify  ──►  the app updates itself
   CHANGELOG   versions      main, develop      vX.Y.Z        (below)      (a local test)
```

## 1. Write the changelog entry

`CHANGELOG.md`, under `## [Unreleased]`, in the audience the file already uses: what it means for the
person using the app, not which module changed. Sections in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
order — `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security` — and a `Fixed` bullet must
be a bug that was *released*, never something fixed before its first release (that belongs in `Added`).

## 2. Bump the version — five places, all of them

| File | What | Note |
| --- | --- | --- |
| `pyproject.toml` | `version` | the package |
| `src/backend/services/catalog_archive.py` | `APP_VERSION` | the running app, and what the update check compares against |
| `src/frontend/package.json` | `version` | |
| `src/frontend/package-lock.json` | `version`, twice | root and `packages[""]`; `npm install` keeps them in step |
| `main.py` | *(none)* | `FastAPI(version=APP_VERSION)` reads the constant, so it cannot drift |

Then date the changelog section (`## [0.1.2] - 2026-09-30`), point the `[Unreleased]` comparison link
at the new tag, and add the new version's `releases/tag/vX.Y.Z` link at the bottom of the file.

## 3. Gates on the tagged commit

```bash
./venv/bin/python3 -m ruff check src/backend tests
./venv/bin/python3 -m pytest tests -q
cd src/frontend && npm run build          # tsc && vite build — the frontend's only check
```

CI runs the first two again on the tag, but a red tag is a published failure, so run them yourself.

## 4. Commit, push, tag

```bash
git add -A && git commit -m "Release 0.1.2"
git push origin develop && git push origin main      # keep both in step; the tag comes off main
git tag -a v0.1.2 -m "AudioBiblica 0.1.2"
git push origin v0.1.2
```

Pushing the tag is what starts `.github/workflows/release.yml`: **tests → PyPI (only when
`PYPI_TOKEN` is set) → the dual-architecture image on GHCR → the GitHub release with the wheel and
sdist attached.** Nothing is published until the tag lands.

> If the tag goes out broken, fix the code *inside* the tag: delete it, re-create it on the corrected
> commit, push again — but only while nothing has been announced. Re-running the old workflow against
> an old tag uses the old workflow file, so a workflow fix that is not in the tag does nothing.
> A tag left behind and then re-created silently means two different commits are called `vX.Y.Z`.

## 5. Verify the release, not the green tick

A successful workflow does not mean a usable release — an empty release and a single-architecture
image have both happened. Full procedure: the `verifying-a-tagged-release` skill. The short version:

```bash
gh run watch "$(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
V=0.1.3
gh release view "v$V" --json assets --jq '.assets[] | "\(.name) \(.size)"'     # wheel + sdist, non-zero
docker manifest inspect "ghcr.io/vip3rousmango/audiobiblica:v$V" | jq -r '.manifests[].platform.architecture'
docker run --rm -d --name abi-verify -p 8010:8000 "ghcr.io/vip3rousmango/audiobiblica:v$V"
sleep 5
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8010/health   # must be 200, from the host
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8010/          # must be 200 — the app itself
docker rm -f abi-verify
```

Two architectures, two assets, and a booted image that answers **200 from the host** — not just from
inside the container, where the healthcheck runs. That last distinction is exactly what 0.1.2 got
wrong: its healthcheck passed while the app answered the owner's browser with 401, because Docker's
forwarder flattens the client address (see `tests/test_mobile.py` and §3 of `docs/INTEGRATION.md`).
Anything that changes who is allowed in has to be checked through a published port, from the host,
or the check is not the check.

Third trap, from the skill: **is the package actually public?** Pulls succeed while logged in either
way. Check it with an anonymous token rather than `docker logout` (which would disturb the machine's
own GHCR credentials):

```bash
TOKEN=$(curl -s "https://ghcr.io/token?scope=repository%3Avip3rousmango%2Faudiobiblica%3Apull&service=ghcr.io" | jq -r .token)
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  -H 'Accept: application/vnd.oci.image.index.v1+json' \
  https://ghcr.io/v2/vip3rousmango/audiobiblica/manifests/v$V      # 200 = anyone can pull it
```

## 6. Watch it arrive on a real install

This is the only step that tests the feature the user actually touches.

```bash
# a machine running the *previous* release, unpinned
cat ~/.audiobiblica/app/.env            # AUDIOBIBLICA_VERSION must be absent or "latest"
docker ps --format '{{.Names}} {{.Image}}'   # ghcr.io/vip3rousmango/audiobiblica:latest
```

Open the app: the Overview should offer the new version, **Settings → Check my setup** should still
name the old one, and pressing the button should show the updater's progress, replace the container,
and reload the page onto the new version — which then reports the new number in the same check.

**The check is cached for six hours** (`CHECK_TTL` in `services/updater.py`), and that cache lives in
the container's data volume — not in `~/.audiobiblica` on the host, so deleting a file there does
nothing. Right after publishing, force a fresh look at GitHub:

```bash
curl -s 'http://localhost:8000/api/v1/update/status?refresh=true' | python3 -m json.tool
# "update_available": true, and "latest" holding the version just published
```

Reload the Overview and the notice is there. (Nothing in the interface passes `refresh=true` yet, so
without this the newest release can take up to six hours to appear — which is why a **Check again**
button is the first item in 0.1.4.)

> **The in-app updater pulls the image; it does not refresh `docker-compose.yml`.** That file lives in
> `~/.audiobiblica/app` and is replaced only by `./scripts/audiobiblica`. So a release that changes the
> compose file — a new environment variable, a new volume, a changed port — reaches existing installs
> only when the user runs the launcher once, and the release notes have to say so plainly. 0.1.4 is
> the first such release: it forwards `AUDIOBIBLICA_LAN_ADDRESS` into the container, so the phone
> pairing link can be built from the machine's address rather than the container's.

If the button is missing: the install is pinned (`AUDIOBIBLICA_VERSION` in `.env` — by design, see
the README), the updater sidecar is not running (`docker ps` should list `audiobiblica-updater-1`),
or the release is not newer than what is running.

---

## The roadmap

Each version below is one release: independently useful, independently testable through the updater,
and small enough to describe in a changelog entry without hedging. Ordering is by what unblocks the
most — the console integration and the Live reader are prerequisites for the wizard, not extras.

| Version | What ships | Why it is its own release |
| --- | --- | --- |
| **0.1.2** | Mobile gear capture (QR pairing, vision read, drafts, **Needs review** tray, photos on the device); `docs/INTEGRATION.md`. | Already written and verified: a capture path that works with no DAW and no cloud, plus the contract another app needs. |
| **0.1.3** | *(shipped as a hotfix)* The gate trusted Docker's view of the client address, which the port forwarder flattens, so 0.1.2 answered the owner's own browser with 401 on a Docker install. Now a request naming `localhost` counts as this computer; `tests/test_mobile.py` covers both halves. | A released version that locked people out of their own app outranks anything planned. It also proved the point of step 5: the published image, not the green tick, is what found it. |
| **0.1.4** | A **Check again** button that forces the update check past its six-hour cache; the console speaks back: `POST /api/v1/studio/graph` (ports, cables, observed vs expected routes, device snapshot) and the shared **Finding** envelope; `response_model=` on the equipment routes so payload types generate; `manual_search` MCP tool. | Turns the studio console from a consumer into a *source* of physical truth — nothing else can supply that column, and every connection check downstream depends on it — and clears the one rough edge in testing the updater itself. |
| **0.1.5** | Sessions, offline: read `.als` against the schemas Live ships; opt-in scan of the default folders; **review-first** queue for devices a Set mentions that the catalog does not have; sessions visible next to the gear they use. | The first release that knows what you were actually working on, with no DAW required and no bridge to install. |
| **0.1.6** | The live bridge: one-click install of the Remote Script into `User Library/Remote Scripts/`, the Control Surface instructions, a diagnostics check for the whole path, live selection and parameter values, session logging. | Opt-in and version-fragile (user Remote Scripts changed behaviour in Live 12.4), so it ships alone, with its own check, once the offline reader is already trusted. |
| **0.2.0** | The A/V wizard: the signal-path view, checklist runs with evidence and `cannot-check` as a first-class answer, pre-flight reports attached to a Session; local model first, nanobot alongside for long runs. | A new surface and a new data model, and the first release whose headline is judgement rather than data. The minor bump is the signal that the API grew a new area. |
| **0.2.1** | Preset and rack inventory (`.adg`, `.adv`, `.alc`, User Library): what belongs to which device, what has never been opened. | A self-contained payoff of the Sessions work; rides on the reader that 0.1.5 shipped instead of asking for new trust. |

Deliberately not scheduled yet:

- **Ableton Link** — timing only, no knowledge of the gear. Not useful here.
- **Max for Live devices** — Suite-only, so it cannot be the path for Lite or Standard users.
- **A Live Extension (right-click inside Live)** — the Extensions SDK is Live 12 Suite 12.4.5+ beta
  only. Worth doing when it is out of beta and available beyond Suite; until then the Remote Script
  (0.1.5) is the bridge every edition can use.
- **Other DAWs** — Audacity's `mod-script-pipe`, Reaper's `.rpp`, Logic's project bundles. They plug
  into the same `SessionSnapshot` contract as Ableton in 0.1.4; none of them should be started until
  that contract has survived one real DAW.

## Housekeeping notes

- **Stray tag refs.** `git tag` may warn about refs named with a space (`v0.1.0 2`, `v0.1.0 3`) —
  leftovers from a mis-quoted `git tag` command. They make `git show-ref` fail outright. Remove the
  files (they are not real refs, so `git tag -d` cannot touch them):
  `rm ".git/refs/tags/v0.1.0 2" ".git/refs/tags/v0.1.0 3"`.
- **Version numbers must move together.** `APP_VERSION` is what the update check compares against the
  newest GitHub release tag; a tag newer than the constant is exactly what makes the button appear.
- **0.x versions:** this project uses the patch position for features while the API is still moving
  (0.1.0 → 0.1.1 → 0.1.2), and reserves the minor position for a release that adds a whole new area
  (0.2.0, the wizard). What matters is that it is consistent, because it is what users see in the
  update notice.
