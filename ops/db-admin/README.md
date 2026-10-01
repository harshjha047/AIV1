# Database administrator guide (P1-09)

The AI assistant never receives admin credentials. Everything it reads goes through views created by the scripts in this folder, run by the DB administrator.

## Generated files per source (`ops/db-admin/<source>/`)

| File | Purpose |
| --- | --- |
| `create-views.js` / `create-views.sql` | Creates or updates the views, the read-only role and the `ai_ro` user. Safe to re-run. |
| `indexes.js` / `indexes.sql` | Recommended indexes. The AI user cannot create indexes. |
| `verify.js` / `verify.sql` | Run as `ai_ro` after creation; views must be readable and base collections denied. |
| `disable.js` / `enable.sql` ... | Database-level switch: revoke or grant access without touching the application. |
| `export-live.js` / `export-live.sql` | Exports live view definitions for the drift check. |
| `manifest.json` | `specVersion`, `specHash`, view names, disable and enable commands. |

## Regenerate

```
npm run views:generate -- --source crm --db crm=<real_db_name>
```

Review the diff of `ops/db-admin` before running anything. Only inclusion lists are used; no script names a password, token, Aadhaar, PAN, document link or contact field.

## Run (MongoDB)

```
mongosh "<admin uri>" ops/db-admin/crm/create-views.js
mongosh "<admin uri>" ops/db-admin/crm/indexes.js
mongosh "<ai_ro uri>" ops/db-admin/crm/verify.js
```

## Run (PostgreSQL, Samadhan)

```
psql "<admin uri>" -f ops/db-admin/samadhan/create-views.sql
psql "<admin uri>" -f ops/db-admin/samadhan/indexes.sql
psql "<ai_ro uri>" -f ops/db-admin/samadhan/verify.sql
```

`create-views.sql` ends with `\password ai_ro`; the password is entered interactively and stored in the secrets store, never in the repository.

## Disable and enable at the database

MongoDB:

```
mongosh "<admin uri>" ops/db-admin/crm/disable.js
mongosh "<admin uri>" ops/db-admin/crm/enable.js
```

PostgreSQL:

```
psql "<admin uri>" -f ops/db-admin/samadhan/disable.sql
psql "<admin uri>" -f ops/db-admin/samadhan/enable.sql
```

After a database-level enable, the hub still requires the source switch to be on and verification to pass.

## Drift check

```
mongosh "<admin uri>" ops/db-admin/crm/export-live.js > ops/live/crm.json
psql "<admin uri>" -f ops/db-admin/samadhan/export-live.sql > ops/live/samadhan.json
npm run views:check
```

Exit code 2 reports drift: a missing, changed or unexpected view, or generated files that no longer match the spec. A changed view must be reviewed, then either the spec is updated (bump `specVersion`) or the view is restored by re-running `create-views`.

## Source status

CRM and BahiKhata specs are confirmed. Invoicing and Samadhan specs are drafts: they generate, but sample verification is skipped until their practice databases exist, and their manifests carry `status: draft`.
