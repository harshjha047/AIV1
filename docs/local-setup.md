# Local setup (laptop, practice mode)

Plan v2 P1-01 requires the local MongoDB and the AI Redis to be documented. Both are for the AI layer only. They are separate from the apps' own databases and Redis.

## Requirements

| Item | Version | Notes |
|---|---|---|
| Node.js | 22 LTS (`.nvmrc`) | `node -v` |
| MongoDB | 7.x | Holds `ai_snapshot` and the CRM and BahiKhata practice copies |
| Redis | 7.x | Dedicated AI instance on port 6380 with `noeviction` (TRD D-12, 2.4) |
| Ollama | latest | Installed in P1-12 |

## Option A: Docker

```powershell
Copy-Item .env.example .env
docker compose up -d
docker compose ps
```

Set `LOCAL_MONGO_ROOT_PASSWORD` and `AI_REDIS_PASSWORD` in `.env` first. Both services bind to `127.0.0.1` only. Authentication is on for MongoDB, so the read-only check can report `authEnforced: true` on the laptop.

## Option B: native installs

### MongoDB with authentication

1. Install MongoDB Community 7.x as a Windows service.
2. Start it once without auth, create the admin user in `mongosh`:

```javascript
use admin
db.createUser({ user: 'root', pwd: passwordPrompt(), roles: [{ role: 'root', db: 'admin' }] })
```

3. Enable authorization in `mongod.cfg`:

```yaml
security:
  authorization: enabled
net:
  bindIp: 127.0.0.1
```

4. Restart the service. Without step 3 the database cannot enforce read-only, and the hub shows "DB-level protection: not enforced (auth disabled)" (DESIGN_UPDATE_v2 section 3.3).

### Redis on port 6380

Redis has no official native Windows build. Use Memurai, WSL2, or Docker. Required settings:

```text
port 6380
bind 127.0.0.1
requirepass <password>
maxmemory-policy noeviction
appendonly yes
```

### Application user for `ai_snapshot`

```javascript
use admin
db.createUser({ user: 'ai_app', pwd: passwordPrompt(), roles: [{ role: 'readWrite', db: 'ai_snapshot' }, { role: 'dbAdmin', db: 'ai_snapshot' }] })
```

`dbAdmin` is required because `npm run db:migrate` creates collections, validators and indexes.

## Environment

```powershell
Copy-Item .env.example .env
```

| Variable | Value |
|---|---|
| `AI_MONGO_URI` | URI for the `ai_snapshot` database with a user that owns only that database |
| `AI_REDIS_URL` | `redis://:<password>@127.0.0.1:6380` |
| `MODE` | `practice` |

## Verify

```powershell
mongosh "mongodb://root:<password>@127.0.0.1:27017/admin" --eval "db.runCommand({ ping: 1 })"
redis-cli -p 6380 -a <password> ping
redis-cli -p 6380 -a <password> config get maxmemory-policy
npm run ci
```

Expected: `ok: 1`, `PONG`, `noeviction`, and a green pipeline.

## Build `ai_snapshot`

```powershell
npm run db:migrate
npm run db:status
```

`db:migrate` applies every pending migration (`001_init` creates all collections, validators, indexes and the `meta` singletons) and is safe to re-run. `db:status` lists applied and pending migrations without changing anything. `db:indexes` re-applies indexes only.

## Integration tests

`npm test` starts a throwaway MongoDB through `mongodb-memory-server`, which downloads the pinned server binary (7.0.14) on first use. Set `SKIP_MONGO_TESTS=1` to skip those tests when offline.

## Practice data

CRM and BahiKhata practice copies are restored into the local MongoDB in P1-06. The answers to "dump or remote" and "local authentication on or off" are recorded in `docs/decisions/gate0-decisions.json` (G0-07).
