# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |

## Reporting a vulnerability

Report privately through GitHub Security Advisories — on the repository, **Security** →
**Report a vulnerability**. Do not open a public issue for a vulnerability.

Include the version (`GET /health` reports it), how AudioBiblica was started (Docker bundle or from
source), your operating system, and the smallest reproduction you have. We aim to acknowledge within
7 days.

## What AudioBiblica stores, and where

Everything the app keeps lives in one data directory — `~/.audiobiblica` by default, `/data` inside
the Docker bundle, relocatable with `AUDIOBIBLICA_DATA_DIR`:

| Path | Contents |
| ---- | -------- |
| `audiobiblica.db` | The equipment catalog (SQLite). |
| `config.json` | Settings, written with mode `0600`. **Provider API keys are stored here in plaintext.** |
| `manuals/` | PDF manuals you imported. |
| `backups/` | The ten most recent automatic catalog snapshots. |

The API never returns a stored credential: it exposes only a masked key and an `api_key_configured`
flag. Anyone who can read `config.json` can read the keys, so treat the data directory as sensitive.

## Deployment posture

- **Loopback only by default.** The server is intended to run on a single machine. Publishing it on a
  public interface without a reverse proxy that adds authentication exposes your catalog and your
  stored API keys to that network.
- **Host allow-list on the MCP endpoint.** `AUDIOBIBLICA_MCP_ALLOWED_HOSTS` validates the `Host`
  header to block DNS rebinding. Every host you add to that list is a host that may reach your MCP
  tools, which can read and write the catalog.
- **Fetched pages are untrusted text.** The built-in page reader refuses `localhost`, `.local`, and
  private/link-local IP literals so a pasted URL cannot be used to probe the machine it runs on, and
  it caps the response size. It does follow redirects, so a hostile page still chooses what it
  serves; the text is stored as research content and never executed.
- **CORS is open.** `allow_origins=["*"]` is set, which is only safe while the server is reachable
  from loopback alone. Do not remove the loopback assumption without tightening CORS.
- **No authentication.** AudioBiblica has no login: it assumes a single trusted user on one machine.
