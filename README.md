# FAB5 Internal AI Assistant

JavaScript ESM, Node.js LTS, Express 5, native MongoDB driver, Vitest. All inference runs on local Ollama at `127.0.0.1:11434`.

## Commands

| Command | Purpose |
|---|---|
| `npm run ci` | Lint and tests |
| `npm run views:generate` / `views:check` | Generate read-only view scripts under `ops/db-admin/`; drift check exits 2 |
| `npm run practice:record` / `practice:verify` / `practice:restore` | Practice database tooling (`ops/practice/README.md`) |
| `npm run source:add -- <sourceId>` | Store an encrypted read-only connection string (hidden prompt, or `--stdin`) |
| `npm run seed:auth` | Create the `hub` client and the local owner (practice mode only) |
| `npm run start:ai` | Start the AI service on `AI_HOST:AI_PORT` (default 127.0.0.1:4100) |
| `npm run bench:models` | Benchmark Ollama candidates and pin tags (`ops/ollama/README.md`) |

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `MODE` | `production` | `practice` or `production`; production locks mode changes and the local login |
| `SOURCE_CRED_MASTER_KEY` | none | Base64 32-byte key for stored source credentials (`_ID`, `_OLD` supported) |
| `AI_CLIENT_MASTER_KEY` | none | Base64 32-byte key for `ai_clients.secretEnc` |
| `REDIS_URL` | none | Replay cache, rate limits, bus, queues; required when `MODE=production` |
| `AI_REQUIRE_SIGNATURE` | `true` | `false` only in practice mode, for unsigned local calls |
| `AI_HOST` / `AI_PORT` | `127.0.0.1` / `4100` | Listen address |
| `LOCAL_ADMIN_EMAIL` | none | Practice-mode local owner |
| `LOCAL_ADMIN_PASSWORD_HASH` | none | scrypt hash for the local owner |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Loopback hosts only |
| `MODEL_SMALL` / `MODEL_LARGE` / `MODEL_EMBED` | pinned by `bench:models` | Model tags |
| `SRC_<ID>_URI` | none | Source connection string when `credentialRef` is `env:` |
| `SOURCE_STATE_TTL_S` | `5` | Source registry cache lifetime |
| `ON_DISABLE_DEFAULT` | `hide` | Default data policy on source disable |

## Integration notes

- `@fab5/snapshot-db` must export `connectSnapshotDb()` returning `{ db, close }`.
- `packages/shared/src/clock.js` and `today.js` carry the reference-date clock; reconcile them with the P1-04 clock and period modules.
- Request signature: `HMAC-SHA256(secret, timestamp \n METHOD \n originalUrl \n sha256(body))`, timestamp in epoch milliseconds.
