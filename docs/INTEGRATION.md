# Integrating another app with AudioBiblica

This is for a developer wiring a **different application** to a running AudioBiblica — reading the
catalog from it, and (later) feeding physical facts back. It documents what exists today, what is
planned, and the exact shapes to build against either way.

The reference consumer is **Downstairs Studio Console** (`audio-studio-interactive-ui`): a studio
graph of gear, ports, cables and signal flow, with an `ExternalAdapterRegistry`, a local bridge, and
device enumeration. Where a section is shaped by that app, it says so.

---

## 1. The two directions

| Direction | Who owns it | What crosses |
| --- | --- | --- |
| **Out** — knowledge | AudioBiblica | Gear records, specs, manual text, photos, research notes, (planned) parsed Live Sessions |
| **In** — physical truth | Your app | Ports, connectors, cables, expected vs observed routes, device enumeration |
| **Both** — findings | Either | Checks that cross the two: what Live is configured to do vs what the gear is and what is plugged in |

Neither side can answer "is this connection right?" alone: AudioBiblica cannot see a cable, and a
studio graph cannot read a manual. The wizard exists where they meet.

---

## 2. Topology and trust

AudioBiblica binds to every interface so a phone can reach it, and **gates every request that does
not come from the computer it runs on** (`src/backend/services/mobile.py`, middleware in
`create_app`). That gate is the whole trust model, so decide the topology first.

| Topology | Works today? | Notes |
| --- | --- | --- |
| **A. Both local, same machine** (your Vite dev server or a local build → `http://127.0.0.1:8000`) | Yes | Requests come from loopback: no token, no CORS problem. This is the recommended development loop. |
| **B. Your app hosted (Netlify), AudioBiblica local** | Not directly | The browser sends `Origin: https://your-site.netlify.app`, which the allow-list does not contain, so the request is refused. **Route it through your existing local bridge instead** — see below. |
| **C. Your app hosted, talking to a LAN AudioBiblica** | Yes, with a token | Non-loopback clients must present the pairing token (§3). |

**Why B needs the bridge.** CORS is evaluated against the *origin of the page*, not where the server
runs, so a hosted page cannot be allow-listed by address. Your `public/bridge/server.mjs` already
solves this class of problem for MIDI/audio devices, and it is the right place: the bridge runs
locally, so *its* request to AudioBiblica comes from loopback (topology A) and the browser only ever
talks to the bridge. One pairing screen then covers both services.

> **Planned, not built:** an `AUDIOBIBLICA_ALLOWED_ORIGINS` variable to add explicit origins to the
> CORS regex, for people who want topology B without a bridge. Until it exists, the bridge is the
> answer — don't design around the env var yet.

**Why B needs the bridge.** CORS is evaluated against the *origin of the page*, not where the server
runs, so a hosted page cannot be allow-listed by address — and browsers add a second wall of their own:
a public `https://` page reaching a local address is what Chrome calls a **Private Network Access**
request, which it may refuse outright regardless of CORS. (Only `127.0.0.1`/`localhost` count as
secure contexts, which is why the *scheme* is not the problem.) Your `public/bridge/server.mjs` already
solves this class of problem for MIDI/audio devices, and it is the right place: the bridge runs
locally, so *its* request to AudioBiblica comes from loopback (topology A) and the browser only ever
talks to the bridge. One pairing screen then covers both services.

## 3. Authentication

**Two things count as "this computer", and both are checked on every request:**

| Signal | When it applies | Strength |
| --- | --- | --- |
| The **client address** is loopback (`127.0.0.0/8`, `::1`, or no address at all) | the run-from-a-checkout workflow, and the container's own healthcheck | strong — not forgeable over a network |
| The request's **`Host`** names `localhost`, `127.0.0.0/8` or `[::1]` | any install reached through a published port, where the client address is useless | weaker: a browser copies `Host` from the address bar and cannot forge it, but a hand-made request can |

The second rule exists because of a hard platform fact, found by running the published image: **Docker
Desktop's port forwarder rewrites the source address of every request that arrives through a
published port to its own VM gateway** (`192.168.65.1` here), so the machine's own browser and a
phone on the wifi arrive looking identical. Address-only gating answered the owner with `401`. If
your adapter runs inside a container and calls the app on the host, expect the same flattening: send
the token and do not design anything that depends on the client address. A `Host` naming the
machine's *network* address — which is what a phone's URL carries — still requires the pairing token,
which is the case the gate is for.

**Everything else needs the pairing token.** Same pattern your bridge already uses (`/pair`, then
`x-studio-bridge-token`), so the two can share one pairing UI:

```http
GET  http://<host>:8000/api/v1/mobile/status      # loopback only: tells you the token URL
POST http://<host>:8000/api/v1/mobile/token       # rotate it (invalidates paired clients)
GET  http://<host>:8000/capture?t=<token>         # presents the token once…
                                                  # …and sets Cookie: audiobiblica_mobile=<token>
```

```jsonc
// GET /api/v1/mobile/status  (200)
{
  "enabled": true,
  "address": "10.0.0.50",
  "address_source": "override",                     // "override" | "guessed"
  "in_container": false,
  "url": "http://10.0.0.50:8000/capture?t=JEoV…",   // null when the machine has no network
  "token_set": true,
  "port": 8000,
  "vision": { "model": "qwen2.5vl:7b", "installed": true, "models": ["qwen2.5vl:7b", "llama3.2:3b"] }
}
```

`address` is the address a **phone** should use, not the address this request arrived on, and
`address_source` says where it came from: `override` when `AUDIOBIBLICA_LAN_ADDRESS` set it, `guessed`
when the app worked it out from the routing table. `in_container` is true inside Docker. The
combination `in_container && address_source == "guessed"` means the app is reporting the container's
own address, which no phone can reach — the interface refuses to show a pairing code in that state,
and so should anything you build on this endpoint.

A non-loopback caller may present the token three ways: `?t=<token>` on any request, the
`audiobiblica_mobile` cookie, or (recommended for a server-to-server bridge) the query parameter on
the first call and the cookie afterwards. Tokens are compared in constant time. Rejection is always
the same:

```jsonc
// 401 on /api/v1/*, /mcp/*, /health — nothing is exempt
{ "detail": "This catalog is only reachable from the computer it runs on. Open Settings → Mobile capture there and scan the code." }
```

Rotation (`POST /api/v1/mobile/token`) makes every previously paired client 401 immediately — expose
that as a "revoke" button, and expect your adapter to go `error` → re-pair.

---

## 4. Read the catalog (available now)

All routes live under `/api/v1`. `GET /openapi.json` is served and generates cleanly (43 paths, and
every path on this page is in it), so use it as the **route and status-code inventory** — and to catch
drift, since it is generated from the code:

```bash
curl -s http://127.0.0.1:8000/openapi.json > audiobiblica.openapi.json
npx openapi-typescript audiobiblica.openapi.json -o src/domain/audiobiblica.types.ts
```

**But the response *bodies* are not typed in it.** The routes return plain dicts (`-> dict`), so
`equipment`, `photo`, `draft` and friends come out as untyped objects — generating types from this
schema gives you accurate paths and useful `unknown`-shaped bodies, not `CatalogEquipment`. The
hand-written types in §12 are the payload contract instead, and they are the shapes the app actually
sends and the app's own UI consumes. (Making the schema describe payloads would mean adding
`response_model=` to those routes; worth doing, not done yet — say the word and it is a small change.)

### Equipment

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/equipment` | Every device, one call. No pagination — the catalog is hundreds of rows at most. |
| `GET` | `/api/v1/equipment/{id}` | One device. `404` when it is gone. |
| `POST` | `/api/v1/equipment` | Create. `review_state: "draft"` marks a capture for review. |
| `PUT` | `/api/v1/equipment/{id}` | Partial update; `photo_ids` attaches captured photos. |
| `DELETE` | `/api/v1/equipment/{id}` | Delete, with its stored PDFs and photos. |
| `POST` | `/api/v1/equipment/batch` | `{ids, changes, delete}` → `{updated, deleted}`. One request for a selection. |

```jsonc
// GET /api/v1/equipment  (200) — the envelope is always named after the noun
{
  "equipment": [
    {
      "id": "6f1c…",                       // stable uuid, the join key you should store
      "name": "Focusrite ISA One",
      "category": "Outboard",              // Microphone | Console | Outboard | Instrument | Monitor | Interface | Other
      "manufacturer": "Focusrite",
      "model": "ISA ONE",
      "description": "A high-quality microphone preamplifier…",
      "specifications": { "phantom_power": "48 V", "input_impedance": "600 ohms" },  // free-form, from manuals
      "manuals": [ { "id": "…", "title": "ISA One User Guide", "url": "…", "source": "Focusrite", "downloaded_at": "…", "metadata": { "kind": "uploaded_pdf" } } ],
      "research_findings": [ { "id": "…", "title": "…", "source_url": "…", "content": "…", "extracted_specs": {}, "confidence": 0.7, "status": "completed", "created_at": "…" } ],
      "archived": false,
      "review_state": null,                 // null | "draft" | "reviewed"
      "photos": [ { "id": "…", "file_name": "panel.jpg", "url": "/api/v1/photos/…/file", "byte_size": 21937, "content_type": "image/jpeg", "created_at": "…" } ],
      "created_at": "2026-09-30T19:26:19+00:00",
      "updated_at": "2026-09-30T19:26:19+00:00"
    }
  ]
}
```

`specifications` is deliberately free-form: it is whatever the PDF extractor and the research tools
found. Treat it as a bag of strings, not a schema.

### Manuals and photos (binary payloads)

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/v1/equipment/{id}/manuals` | Link an external URL. |
| `POST` | `/api/v1/equipment/{id}/manuals/upload` | Multipart PDF, ≤ 25 MB. Returns extracted text stats and merged specs. |
| `GET` | `/api/v1/equipment/{id}/manuals/{manual_id}/file` | The stored PDF (only for uploaded ones). |
| `GET` | `/api/v1/equipment/{id}/manuals/{manual_id}` | Metadata. |
| `DELETE` | `/api/v1/equipment/{id}/manuals/{manual_id}` | Remove the link and the stored file. |
| `POST` | `/api/v1/capture/photos` | Multipart photo (JPEG/PNG/WebP, ≤ 12 MB) → `{photo}`. Unattached until a device claims it. |
| `GET` | `/api/v1/photos/{photo_id}/file` | The image bytes. Directly usable as an `<img src>` when you are on the same origin. |
| `DELETE` | `/api/v1/photos/{photo_id}` | Forget it (and its file). |
| `POST` | `/api/v1/capture/read` | `{photo_id, mode: "item" \| "studio"}` → `{drafts: GearDraft[]}` — the local vision model's guesses. |

Photo URLs are **relative** (`/api/v1/photos/…/file`): prefix them with your AudioBiblica base URL.
Your `StudioPortEvidence.photoKey` and `StudioRouteVerification.evidencePhotoKey` are natural homes
for a copy of the id, so a console port can point at the same picture the catalog shows.

### Health, diagnostics, data

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | `{"status": "ok", "version": "0.1.1"}`. Cheap liveness + version gate. |
| `GET` | `/api/v1/diagnostics` | The app's own health report: catalog state, backups, assistant, **checks[]**. |
| `GET` | `/api/v1/data/export` | ZIP archive of the whole catalog (manifest, records, PDFs). |
| `POST` | `/api/v1/data/import` | Mirror of the above. |
| `GET` | `/api/v1/data/backups` · `POST /api/v1/data/backup` · `POST /api/v1/data/restore` | Snapshot listing, take one, restore one. |
| `GET` | `/api/v1/update/status` · `POST /api/v1/update/start` | Self-update state and trigger. |

`GET /api/v1/diagnostics` is the model your DiagnosticsView should mirror, because the checks are
already three-valued — `ok`, `warn`, and explicit "cannot check":

```jsonc
{
  "checks": [
    { "id": "catalog",         "level": "ok",   "title": "Your catalog is healthy", "detail": "…", "fix": null },
    { "id": "manual_files",    "level": "warn", "title": "Some imported PDFs are missing", "detail": "…", "fix": null },
    { "id": "vision_model",    "level": "warn", "title": "The photo reader is not installed", "detail": "…",
      "fix": { "kind": "download_model", "label": "Download qwen2.5vl:7b", "model": "qwen2.5vl:7b" } }
  ]
}
```

`fix.kind` today, one of: `download_model` (`{model}` — pull a model), `open_settings`
(`{section}` — one of `assistant`, `web-search`, `advanced`, `your-data`, `mobile`, `doctor`),
`backup_now`, `restore` (`{snapshot}`), `update` — or `null` when the app can only explain. The same
order the app itself renders them in. Note `warn` covers both "something is wrong" and "I cannot
tell" — the `detail` says which, which is why you should render the sentence rather than re-word the
level.

### Sync strategy

There is no ETag, cursor or `since` parameter yet. The catalog is small, so:

1. `GET /api/v1/equipment` on start and every 15–30 s (or on window focus).
2. Diff by `id`; treat a changed `updated_at` as "re-read this record".
3. Keep the mapping `catalogEquipmentId ↔ StudioGear.id` in your own store — never in ours.
4. Fetch photos/manual files lazily; never in the list path.

If you would rather not poll, say so when we build the session endpoints — an SSE stream is a small
addition and the natural moment to add it.

### Research sources and the plan (new in 0.1.5)

AudioBiblica's research runs lean on optional services, and which ones are configured is public
information — the keys never are:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/providers` | Every service, what it unlocks, and whether it is configured (`configured`, `keyless`, `borrowed_from`, `testable`). No key is ever returned. |
| `PUT` | `/api/v1/providers/{id}` | `{ "key": "…" }` — stored locally in `config.json`. `422` for services that need no key. |
| `DELETE` | `/api/v1/providers/{id}` | Forget it. |
| `POST` | `/api/v1/providers/{id}/test` | One cheap call: `status` is `ok`, `rejected`, `unreachable`, `unconfigured`, `always` (keyless) or `untested` (no cheap probe exists). |
| `GET` | `/api/v1/research/plan?equipment_id=…` \\| `?category=…` | The steps a run would perform, each with `tool`, `question`, `dimension` and `ready` — false when the step's key is missing. |

The **provider ids** are the vocabulary: `page_reader`, `manual_text`, `catalog`,
`easyschematic_templates` (all keyless), `firecrawl`, `web_search`, `discogs`, `youtube`, `reverb`
(keyed), `openai` and `anthropic` (borrowed from the assistant's settings, not stored twice).
`firecrawl` deliberately shares the key the web-search panel has always used.

`ready: false` is the honest half of this API and the reason the interface can say "this step needs a
key" instead of returning an empty result. If you build anything on the plan, honour it the same way.
The `dimension` values (`manual`, `specs`, `connections`, `sources`, `settings`, `compatibility`) are
what the coverage matrix counts.

#### Running a plan

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/equipment/{id}/research/run` | `{ "mode": "planned" }` — returns **at once** with the run, whose steps are all `queued`. Watch it, don't await it. |
| `GET` | `/api/v1/research/runs` | Recent runs, newest first, each named after its device (`equipment_missing` is true when that device has been deleted). |
| `GET` | `/api/v1/research/runs/{id}` | One run: every step with `state`, `detail`, `error`, `evidence[]` and timings. |
| `GET` | `/api/v1/research/queue` | Findings a run produced that nobody has reviewed, with the device named. |
| `POST` | `/api/v1/research/queue/approve` | `{ "ids": [...] }` → `{ approved, requested }`. The only thing that turns a result into knowledge. |

**Step states are the point:** `done` (found something, with `evidence`), `empty` (ran, and the source
does not mention it — `detail` says so in a sentence), `needs-key` (the step's provider is not
configured), `failed` (with `error`). A step is never silently blank. `mode: "open"` is rejected with
`422` and a sentence explaining that it is driven by a nanobot installed on the machine rather than
shipped in the app.

Findings arrive as `status: "pending"` and only count towards coverage once approved — so a caller can
poll the queue and build a review UI, or approve in bulk and watch the matrix move.

#### What is missing

`GET /api/v1/research/coverage` returns every device against the dimensions its category asks about,
gaps first, with totals (`devices`, `complete`, `missing_manual`, `pending_findings`). That is the
endpoint to call if you want to show "this studio has 12 devices and 7 missing connector specs" — and
the shape your console can render directly in its DiagnosticsView, since `missing[]` names the same
dimensions the findings carry.

---

## 5. Joining a catalog record to a studio gear item

Both apps identify devices by their own ids, so the join is a stored link plus a matcher for the
first attach. AudioBiblica's matcher (the same one the phone capture flow uses) is:

> Compare on letters and digits only, case-insensitively. When the incoming record has a `model`,
> compare `manufacturer + model`; otherwise compare `name`. Equality is required — no fuzzy scoring.

```
normalize(text) = text.casefold() with every character outside [0-9a-z] removed
key(record)     = normalize(record.manufacturer + " " + record.model)   if record.model
                = normalize(record.name)                                 otherwise
```

So `"Neve 1073 DPX"` matches `"neve  1073-dpx"`, and a bare model number under a different maker does
**not** match. Implement it identically on your side and both apps agree on "the same device".

### Category mapping

Your `GearCategory` is the finer one; ours is coarse. Default lossy mapping, then a recommendation:

| AudioBiblica | → Downstairs (default) | Loss? |
| --- | --- | --- |
| `Microphone` | `microphone` | — |
| `Monitor` | `monitor` | — |
| `Interface` | `interface` | — |
| `Other` | `other` | — |
| `Console` | `rack` | A desk is not a rack unit |
| `Outboard` | `other` | A preamp and a compressor collapse together |
| `Instrument` | `other` | Keyboards/guitars have no home |
| — | `drums`, `computer`, `cable` | Console-only concepts; no catalog counterpart |

**Recommended instead:** extend `GearCategory` with `'console' | 'outboard' | 'instrument'`. It is a
closed union, so this is a deliberate one-line change on your side — but a lossless join means the
console can honestly label a node "Outboard — from AudioBiblica" instead of guessing, and your
`ExternalAdapterKind` is already open (`| (string & {})`), so the adapter itself needs no change at all.

### Specs → ports

Your `ConnectorSpec` already carries exactly the fields a manual can answer: `type`, `gender`,
`signal`, `channelCount`, `phantomPower`, `clock`, `impedanceOhms`. AudioBiblica's
`equipment.specifications` holds the raw text of the same facts. The mapping is deliberately
**suggestive, never authoritative** — which is what `StudioPortEvidence.source: 'remote-suggestion'`
is for:

```jsonc
// what AudioBiblica can offer for a gear item's ports (planned, see §8)
{
  "gearId": "console-gear-id",
  "suggestions": [
    { "label": "Mic input 1", "direction": "input", "signal": "audio", "connector": { "type": "xlr", "gender": "female", "signal": "audio", "channelCount": 1, "phantomPower": true },
      "evidence": { "source": "manual", "url": "/api/v1/equipment/6f1c…/manuals/…/file", "quote": "48 V phantom power, switchable per channel", "confidence": 0.82 } }
  ]
}
```

Store it as `verified: false` until a human confirms — your port evidence model already distinguishes
that, and it is the difference between a catalog that suggests and one that lies.

---

## 6. Being an adapter in `ExternalAdapterRegistry`

Your registry wants `{ descriptor, publish(event) }`, with envelopes validated to **64 KiB and depth
12**, a 2.5 s timeout, and states `registered | connecting | connected | degraded | error |
disconnected | unsupported`. So the adapter publishes **ids and summaries, never whole catalogs** —
a full equipment dump would blow the byte cap on a real catalog.

```ts
// src/domain/audiobiblicaAdapter.ts  (sketch for your repo — not written there)
const descriptor = {
  id: 'audiobiblica',
  name: 'AudioBiblica catalog',
  version: '1.0.0',
  kind: 'catalog',                       // your kind union is open, so no change needed
  capabilities: ['catalog.read', 'manual.read', 'photo.read', 'session.read', 'wizard.findings'],
}
```

Events to publish (payloads are small by construction):

| `type` | payload | when |
| --- | --- | --- |
| `catalog.ready` | `{ baseUrl, version, equipmentCount }` | after the first successful list |
| `catalog.equipment.upserted` | `{ equipmentId, name, manufacturer, model, category, changedAt }` | a record appeared or changed |
| `catalog.equipment.removed` | `{ equipmentId }` | a record disappeared |
| `catalog.photo.added` | `{ equipmentId, photoId, url }` | a capture landed on a device |
| `session.parsed` | `{ sessionId, projectName, tempo, deviceNames[] }` | planned (§9) |
| `wizard.finding.raised` | a `Finding` (§7) | planned |
| `wizard.run.finished` | `{ runId, sessionId, counts: { ok, warning, mismatch, cannotCheck } }` | planned |

Detail (specs, manual text, image bytes) is **pulled on demand** by the consumer when the user opens
a node — that keeps every event under the cap and keeps the adapter's `publish` cheap.

---

## 7. A shared finding shape

Both apps check things; if they invent separate shapes you will end up rendering two diagnostics
lists. One envelope, emitted by either side:

```ts
export type FindingLevel = 'ok' | 'warning' | 'mismatch' | 'cannot-check'

export interface FindingEvidence {
  source: 'catalog' | 'manual' | 'session' | 'machine' | 'console'
  summary: string                 // one sentence, no jargon
  url?: string                    // manual file, catalog record
  photoId?: string                // an AudioBiblica photo, or a console photo key
  quote?: string                  // the sentence in the manual this rests on
}

export interface Finding {
  id: string
  level: FindingLevel
  subject: { kind: 'gear' | 'port' | 'route' | 'session' | 'machine'; id: string; label: string }
  title: string
  detail: string
  evidence: FindingEvidence[]     // at least one; a finding without evidence is a guess
  fix?: { label: string; kind: 'advise' | 'apply-lom' | 'open-settings'; payload?: Record<string, unknown> }
  createdAt: string
}
```

Where each part lands in your model:

- `level: 'mismatch'` on a `route` → `StudioRouteVerification.status = 'mismatch'`, with
  `method: 'audiobiblica:session'` and the evidence photo if there is one.
- `subject.kind: 'port'` with `evidence.source: 'manual'` → a `StudioPortEvidence` entry
  (`verified: false`, `confidence` from the check).
- `fix.kind: 'apply-lom'` is the only one that changes anything outside AudioBiblica, and it should
  always be a user click, never automatic: LOM writes are not atomic and land in Live's undo history.

`cannot-check` is not a failure. "Live is recording from input 3; nothing in the console says what is
plugged into input 3" is the single most useful thing the wizard can say, and it is only possible if
both sides are willing to say it.

---

## 8. What AudioBiblica needs from you (planned — design against this)

To check connections rather than describe them, AudioBiblica needs the one evidence class it cannot
produce: your graph. Proposed endpoint, **not implemented yet**:

```http
POST /api/v1/studio/graph          # loopback, or the pairing token
Content-Type: application/json

{
  "console": { "name": "downstairs-studio-console", "version": "0.1.0", "sentAt": "2026-09-30T20:04:00Z" },
  "gear": [
    { "id": "gear-1", "name": "Focusrite Scarlett 2i2", "category": "interface",
      "manufacturer": "Focusrite", "model": "Scarlett 2i2",
      "catalogEquipmentId": "6f1c…",            // the join from §5, when you have it
      "zone": "desk" }
  ],
  "ports": [
    { "id": "port-1", "gearId": "gear-1", "label": "Input 1", "direction": "input", "signal": "audio",
      "connector": { "type": "xlr", "gender": "female", "signal": "audio", "channelCount": 1 },
      "channelCount": 1, "phantomPower": true,
      "evidence": [{ "source": "manual", "confidence": 0.9, "verified": true }] }
  ],
  "edges":   [ { "id": "e1", "sourceNodeId": "port-1", "destinationNodeId": "port-9", "signal": "audio", "cableId": "cable-1" } ],
  "observedCables": [ { "id": "cable-1", "endpointPortIds": ["port-1", "port-9"], "verification": { "status": "verified", "checkedAt": "…", "method": "visual" } } ],
  "expectedRoutes": [ { "id": "r1", "sourcePortId": "port-1", "destinationPortId": "port-9", "required": true, "purpose": "vocal mic into the interface" } ],
  "devices": {                                  // straight from your bridge's /snapshot
    "audioInputs":  [ { "id": "…", "label": "Scarlett 2i2 USB", "isDefault": true } ],
    "audioOutputs": [ { "id": "…", "label": "MacBook Pro Speakers", "isDefault": true } ],
    "midiPorts":    [ { "id": "…", "name": "Scarlett 2i2", "type": "input" } ]
  }
}
```

The interesting checks come from *disagreements* between these columns:

| Console says | Live says | Catalog says | Finding |
| --- | --- | --- | --- |
| cable observed: mic → input 1 | armed track records `Ext. In 3` | SM7B is a dynamic mic | **mismatch** — right gear, wrong input |
| port has phantom `true` | — | SM7B is dynamic | **warning** — phantom unnecessary (advice only: no API can switch it) |
| default input = `LoomAudioDevice` | — | your interface is what should be default | **warning** — a virtual device has the default |
| nothing recorded for input 3 | records `Ext. In 3` | — | **cannot-check** — say so, do not guess |

CORS/loopback notes from §2 apply unchanged. Send it on graph mutation (debounced) and on request;
it is a few kilobytes.

---

## 9. Sessions and the live bridge (planned)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/sessions` | Parsed Live Sets: name, path, tempo, scale, track/device counts, parsedAt. |
| `GET` | `/api/v1/sessions/{id}` | Tracks, device chains, routing, referenced samples, missing files. |
| `POST` | `/api/v1/sessions/scan` | Scan the configured folders now (opt-in scanning, default folder list). |
| `GET` | `/api/v1/sessions/{id}/findings` | Findings for one Session (§7). |
| `POST` | `/api/v1/sessions/review` | Decide the review-first queue: which set devices join the catalog. |
| `GET` | `/api/v1/live/bridge` | Live bridge state: installed, connected, Live version, last message. |

Reading is offline (`.als` parsed against the ALSchemas Live ships), so it works with Live closed and
in every edition. The live bridge (a user Remote Script, Python 3.11, `User Library/Remote Scripts/`)
adds live selection, parameter values, CPU load, and writes — loopback only, and optional.

Deliberately **not** exposed: sample rate, buffer size, phantom power, cabling. Live's
`Preferences.cfg` is a binary blob and neither the ALS nor the LOM carries audio settings, so those
are `cannot-check` by design rather than by omission.

---

## 10. MCP, for agents (available now)

Agents — including a nanobot container — talk to AudioBiblica over MCP:

- **Streamable HTTP:** `POST /mcp` (the FastMCP app; `initialize`, `tools/list`, `tools/call`).
- **JSON bridge:** `POST /api/v1/mcp` with `{"tool_name": "search_equipment", "arguments": {}}` for a
  simple one-shot call without an MCP client.
- **Host allow-list:** `AUDIOBIBLICA_MCP_ALLOWED_HOSTS` must contain the `Host` header the agent
  sends (DNS-rebinding protection). The default is
  `127.0.0.1:*,localhost:*,[::1]:*,host.docker.internal:*`, so a container on the Docker bridge
  usually needs nothing; a container that addresses the host by LAN IP or by a compose service name
  does.
- **Auth:** a container is a non-loopback client → present the pairing token (§3).

Tools today (all read-only, catalog + web research): `search_equipment`,
`get_equipment_specifications`, `find_manuals`, `search_manufacturer_docs`, `search_web`,
`extract_equipment_specs`, `crawl_manufacturer_site`, `batch_scrape_urls`, `scrape_manufacturer_site`.

Planned, so your UI can already reserve space: `manual_search(device, topic)` (text search *inside*
stored manual text), `session_list`, `session_snapshot`, `session_findings`, `machine_audio_devices`,
`plugin_inventory`, `samples_missing`, `wizard_run(goal)`. **No write tools**: fixes are dispatched by
the UI after a click.

**Two drivers, one contract.** The wizard runs on the built-in local model by default — it is already
there, so nothing to install and nothing to start. A nanobot container can drive the *same* tools over
the same endpoint for long, session-length runs (its value is a persistent agent that keeps working
across an afternoon, not a different result shape). Nothing in the tool surface may assume which one
is calling, and a container is a non-loopback client, so it needs the pairing token and a matching
`Host` in the MCP allow-list.

---

## 11. Errors, limits, versioning

```jsonc
// every failure, from any route
{ "detail": "One sentence, written for a musician." }
{ "detail": "Something went wrong on our side.", "reference": "4f2a9c31" }   // 500s: grep the app log
```

Status codes you will actually meet: `401` not paired · `404` gone · `409` reader missing / no
network · `413` too large (12 MB photo, 25 MB PDF) · `415` not an image/PDF · `422` bad request ·
`500` unhandled (use `reference`) · `502` model call failed · `503` optional integration missing.

Rules we hold to, so you can rely on them: routes under `/api/v1` keep their shape within a minor
version; new fields are additive and optional; `updated_at` is always ISO-8601 UTC; nothing returns
`200` with an error body. The things that *may* change: heuristic parsers (`.als`, PDF extraction),
the contents of `specifications`, and which models the vision/assistant tooling reports.

---

## 12. A copy-paste client

```ts
// src/domain/audiobiblicaClient.ts — small, dependency-free, platform-neutral
export interface CatalogEquipment {
  id: string
  name: string
  category: string
  manufacturer: string
  model?: string | null
  description?: string | null
  specifications?: Record<string, unknown>
  manuals?: Array<{ id: string; title: string; url: string; source?: string; metadata?: Record<string, unknown> }>
  photos?: Array<{ id: string; file_name: string; url: string; byte_size?: number; content_type?: string }>
  archived?: boolean
  review_state?: 'draft' | 'reviewed' | null
  created_at?: string
  updated_at?: string
}

export class AudioBiblicaClient {
  #baseUrl: string
  #token?: string

  constructor(baseUrl = 'http://127.0.0.1:8000', token?: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, '')
    this.#token = token
  }

  get baseUrl() { return this.#baseUrl }

  /** Absolute URL for a relative payload path (photos, manual files). */
  fileUrl(path: string) {
    return path.startsWith('http') ? path : `${this.#baseUrl}${path}`
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = new URL(`${this.#baseUrl}${path}`)
    if (this.#token) url.searchParams.set('t', this.#token)   // pairs on the first call, then cookie
    const response = await fetch(url, {
      ...init,
      credentials: 'include',                                  // keep the pairing cookie
      headers: {
        Accept: 'application/json',
        ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { detail?: string; reference?: string }
      throw new AudioBiblicaError(body.detail ?? `HTTP ${response.status}`, response.status, body.reference)
    }
    return response.json() as Promise<T>
  }

  async health() { return this.#request<{ status: string; version: string }>('/health') }

  async listEquipment(): Promise<CatalogEquipment[]> {
    const payload = await this.#request<{ equipment?: CatalogEquipment[] }>('/api/v1/equipment')
    return payload.equipment ?? []
  }

  async getEquipment(id: string): Promise<CatalogEquipment> {
    const payload = await this.#request<{ equipment: CatalogEquipment }>(`/api/v1/equipment/${encodeURIComponent(id)}`)
    return payload.equipment
  }

  async attachPhotos(equipmentId: string, photoIds: string[]) {
    return this.#request(`/api/v1/equipment/${encodeURIComponent(equipmentId)}`, {
      method: 'PUT',
      body: JSON.stringify({ photo_ids: photoIds }),
    })
  }

  async batch(ids: string[], changes: Record<string, unknown> = {}, remove = false) {
    return this.#request<{ updated: number; deleted: number }>('/api/v1/equipment/batch', {
      method: 'POST',
      body: JSON.stringify({ ids, changes, delete: remove }),
    })
  }

  async diagnostics() { return this.#request<{ checks: unknown[] }>('/api/v1/diagnostics') }

  /** Push the studio graph (needs the endpoint from §8). */
  async pushStudioGraph(graph: unknown) {
    return this.#request('/api/v1/studio/graph', { method: 'POST', body: JSON.stringify(graph) })
  }
}

export class AudioBiblicaError extends Error {
  constructor(message: string, readonly status: number, readonly reference?: string) {
    super(message)
    this.name = 'AudioBiblicaError'
  }
}
```

Matcher, verbatim from §5, so both apps agree:

```ts
export const normalizeDeviceKey = (text: string) => text.toLowerCase().replace(/[^0-9a-z]+/g, '')

export const deviceKey = (record: { name: string; manufacturer?: string | null; model?: string | null }) =>
  record.model
    ? normalizeDeviceKey(`${record.manufacturer ?? ''} ${record.model}`)
    : normalizeDeviceKey(record.name)
```

---

## 13. Starting points

```bash
# 1. AudioBiblica, with your UI served from the repo (topology A)
./scripts/audiobiblica                      # Docker, port 8000
#    …or from a checkout:
./venv/bin/python3 -m uvicorn src.backend.main:app --host 127.0.0.1 --port 8000

# 2. Confirm the contract before writing UI code
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/api/v1/equipment | head -c 400
curl -s http://127.0.0.1:8000/openapi.json > /tmp/audiobiblica.openapi.json
```

Open questions worth settling before either side builds: whether the hosted console goes through your
bridge (recommended) or waits for `AUDIOBIBLICA_ALLOWED_ORIGINS`; whether the console keeps a copy of
catalog fields or always reads through; and whether findings are stored on your side (so a report can
be printed offline) or only rendered.
