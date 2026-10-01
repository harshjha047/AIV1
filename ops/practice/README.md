# Practice databases (P1-06)

Two local MongoDB databases hold restored copies of CRM and BahiKhata. Nothing here touches production.

## 1. Restore

```
PRACTICE_MONGO_URI=mongodb://127.0.0.1:27017 npm run practice:restore -- crm /path/to/crm-dump crm_practice
PRACTICE_MONGO_URI=mongodb://127.0.0.1:27017 npm run practice:restore -- bahikhata /path/to/bahikhata-dump bahikhata_practice
```

The script refuses any non-local URI, drops the target database, and restores with a namespace rename. Collection names and counts are printed afterwards; compare them with `allowListedPaths` expectations (`users`, `customers`, `connections`, `servicerequests`, `salestargets` for CRM; `users`, `customers`, `ledgers` for BahiKhata).

## 2. Record field paths and samples

```
npm run practice:record -- crm crm_practice
npm run practice:record -- bahikhata bahikhata_practice
```

Environment: `PRACTICE_<ID>_ADMIN_URI` (default `mongodb://127.0.0.1:27017`), `PRACTICE_SAMPLE_SIZE` (default 300), `PRACTICE_SAMPLES_DIR` (default `ops/samples`).

Output in `ops/samples/<source>/`:

- `inventory.json`: every field path with document count, observed types and a `denied` flag for deny-listed names.
- `<collection>.json`: structure-only sample documents containing only allow-listed paths. Every value is replaced by a placeholder, so no data from the database is written. Paths that are rare in the random sample are probed with `$exists` queries.

`ops/samples` is git-ignored. Exit code 1 means a collection is missing; fix the collection name in the allow-list or restore again.

## 3. Generate and review the DB-admin scripts

```
npm run views:generate -- --source crm,bahikhata --db crm=crm_practice,bahikhata=bahikhata_practice
```

Generation fails on any allow-listed path that is absent from every sample document.

## 4. Create views and `ai_ro` locally

Run as the local admin user:

```
mongosh "mongodb://127.0.0.1:27017" ops/db-admin/crm/create-views.js
mongosh "mongodb://127.0.0.1:27017" ops/db-admin/crm/indexes.js
```

`passwordPrompt()` asks for the `ai_ro` password. Repeat for BahiKhata. Enable authentication on the local `mongod` (`security.authorization: enabled`) so that verification reports `authEnforced=true`.

## 5. Verify `ai_ro`

```
PRACTICE_CRM_AI_URI='mongodb://ai_ro:<password>@127.0.0.1:27017/crm_practice?authSource=crm_practice' npm run practice:verify -- crm crm_practice
```

The check confirms: `connectionStatus` shows only `find` on the exposed views, every view is readable, every base collection is denied (error code 13), and records the result in `ops/practice/status.json` including `authEnforced`. Exit code 0 means green. If `mongod` runs without authentication the status is `warn` with `authEnforced=false` and the command exits 1; practice data may continue without enforcement, production may not.

## 6. Drift

```
mongosh "mongodb://127.0.0.1:27017" ops/db-admin/crm/export-live.js > ops/live/crm.json
npm run views:check -- --source crm --db crm=crm_practice
```
