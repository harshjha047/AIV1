# Design Update v2: Direct Database Access, Source Switches, Laptop Monitoring Dashboard

**Status:** Draft | **Amends:** TRD, BACKEND_SCHEMA, IMPLEMENTATION_PLAN (banners added at the top of each)
**Triggered by:** (1) read the databases directly instead of adding code to each service, (2) a dashboard switch that turns reading off per service, (3) on the laptop only CRM and BahiKhata (about 2 months old) are available, and a dashboard is needed to see what data exists and what is happening.

---

## 1. What Changes

| Topic | Before (TRD v1) | Now |
|---|---|---|
| How data is read | New export endpoints inside CRM, Invoicing, BahiKhata; per-service keys; contract tests | **Direct read-only database access** from the AI service. Nothing is added to the apps for reading data |
| Hiding sensitive fields | Done in each adapter's code | **Database-level views** (allow-list of fields). The AI user can read only the views |
| Per-source control | None | **Source Gate** plus a dashboard switch per source (active, paused, disabled), audited |
| Missing sources | Assumed all present | **Graceful degradation**: KPIs and answers that need a missing source say so instead of showing zero |
| Laptop scope | All sources, masked copies | **CRM + BahiKhata only** (practice data). Other sources are built against synthetic fixtures and validated on the VPS |
| Dashboard | LLM monitoring only | Adds **Sources**, **Data inventory**, **Activity**, and **KPI readiness**, available from the first week on the laptop |

Unchanged: KPI definitions (PRD v3 Section 4), identity mapping, the separate `ai_snapshot` database, local models, validator, two-model pipeline, LLM dashboard (FR10), Gate 0.

---

## 2. What Works Where

| Capability | Laptop (CRM + BahiKhata, about 2 months old) | VPS (all sources) |
|---|---|---|
| Sales KPI (Mbps vs target) | Yes, for months that have targets in the practice data | Yes |
| Collections KPI | Yes. Growth uses the legacy history from BahiKhata's code plus the 2 months of ledger | Yes |
| Support KPI (tickets) | **No real data.** Built and tested on synthetic fixtures | Yes, validated on real tickets |
| Customer summary | Partial (CRM + BahiKhata); missing parts are labeled | Full |
| Outstanding and aging | BahiKhata is the authority on the laptop (resolves Open Question 8 for practice) | Decide authority when Invoicing is added |
| Communication events (Invoicing emails) | No | Yes |
| Ticket similarity search and recall@5 | Pipeline built on synthetic tickets; **real evaluation on the VPS** | Yes |
| LLM benchmarks, validator, queues, dashboards | Yes (laptop speeds are not production targets) | Re-benchmark |
| Period-over-period growth | Month over month only where both months exist; weekly works; no seasonality | Meaningful history builds over time |

---

## 3. Direct-Access Architecture

```
                 +------------------- AI service / worker -------------------+
 Hub dashboard ->|  Source Registry (data_sources)                            |
 (toggle)        |        |                                                   |
                 |  SOURCE GATE  (the only code allowed to hold DB drivers)   |
                 |    - checks state on every read, closes pools on disable   |
                 |    - keeps credentials in memory only while active         |
                 |    - logs every read to source_access_log                  |
                 +-----+--------------------------+---------------------------+
                       | read-only, views only    | read-only, views only
               [ CRM MongoDB ]            [ BahiKhata MongoDB ]   (later: Invoicing, Samadhan Postgres)
                       |
                       v writes only to its own database
               [ ai_snapshot ]
```

### 3.1 Source Gate rules
1. **One door.** Only the `source-gate` module may import `mongodb` or `pg`. A lint rule and a test fail the build if any other file imports them.
2. **Every read goes through the gate:** `gate.read(sourceId, (client) => ...)`. The gate loads the source state (cached at most 5 seconds, invalidated immediately on a toggle) and throws `SourceDisabledError` unless the state is `active`.
3. **On leaving `active`:** close the connection pool, wipe decrypted credentials from memory, abort running sync jobs for that source, and pause its scheduled jobs.
4. **Safe reads:** paged (default 500 rows), `maxTimeMS` 30 s (Mongo) or `statement_timeout` 30 s (Postgres), a rows-per-minute cap per source, and `secondaryPreferred` on production if a replica set exists. Production syncs run off-peak.
5. **Entities are defined in the AI repo** (`sources/<id>/entities.js`): view name, incremental key (`updatedAt`, `_id`), and the mapping into fact documents. These replace the adapters.

### 3.2 Credentials
- Supplied through environment variables or a CLI command (`npm run source:add crm`), never typed into the browser.
- Held in memory only while a source is active; if stored, encrypted at rest (AES-256-GCM, master key from the environment or OS keychain).
- The dashboard never shows secrets.

### 3.3 Read-only verification (non-mutating)
Run when a source is added, re-enabled, and daily. The result and timestamp show on the Sources page.

| Engine | Checks |
|---|---|
| MongoDB | `connectionStatus` with `showPrivileges`: fail if the user has any write action (insert, update, remove, createCollection, dropCollection, createIndex, etc.) or any resource other than the allowed views |
| PostgreSQL | Role is not superuser; `default_transaction_read_only = on`; no `INSERT/UPDATE/DELETE/TRUNCATE` privilege on any visible relation; base tables not visible, only the `ai_export` views |

The checks do not attempt writes, so a failed check cannot damage anything.

### 3.4 Field hiding with views
- The AI user is granted `find` on specific **views** only. A user with `find` on a view can read it without any access to the underlying collection, so password hashes, Aadhaar and PAN in `users` stay unreachable.
- Views use an **inclusion** `$project` (list the allowed fields), never exclusion, so a field added to the app later does not leak automatically.
- Standard views are read-only and use the source collection's indexes.
- The allowed-field lists are the ones in BACKEND_SCHEMA Section 7. A generator (`npm run views:generate`) writes the shell script from those lists and checks each field exists in a sample document, so you can review it before running it.
- **Laptop:** restore the practice databases locally and create the same views, so the laptop exercises the production code path. Note that if your local MongoDB runs **without authentication** (the default for many dev installs), the database cannot enforce read-only for you; the Source Gate still enforces the toggle, and the dashboard shows "DB-level protection: not enforced (auth disabled)" instead of a green tick.

---

## 4. Source States and the Switch

| State | Meaning | Reads | Existing copied data |
|---|---|---|---|
| `not_configured` | No credentials yet (for example Samadhan on the laptop) | none | none |
| `active` | Normal | allowed (verified read-only) | used |
| `paused` | Temporarily stopped | **blocked** | still used, labeled "stale since <date>" |
| `disabled` | Turned off | **blocked** | excluded from KPIs and answers (kept on disk) |
| `disabled + purged` | Turned off and erased | **blocked** | deleted from `ai_snapshot` |

**What happens on a switch**
- The change is saved with who, when, and a required reason, and written to `admin_audit`.
- The gate takes effect within seconds: pools closed, credentials wiped, running jobs aborted, schedules paused.
- Dependent KPIs and prepared answers switch to "not available" (Section 5).
- The Sources page shows proof: "Reads since switch: 0", "Blocked attempts: N", "Pool: closed".
- Re-enabling requires confirmation, re-runs the connection test and read-only verification, then resumes from the saved cursor.
- **Purge** deletes that source's facts, text chunks, embeddings, and any prepared answers that used it, clears its mapping references, and requires a typed confirmation.
- Legacy collections data (loaded from BahiKhata's code) belongs to the BahiKhata switch, so turning BahiKhata off hides it too.

**Guarantees and limits (stated plainly)**
1. The switch stops **this application** from reading. It cannot stop someone else who holds the same database credentials.
2. Data **already copied** stays in `ai_snapshot` unless you choose purge.
3. For a hard guarantee, also cut access **at the database**. The dashboard shows a ready-to-copy command for the DB admin (the AI never holds admin rights, by design):
   - MongoDB: `db.getSiblingDB('<db>').revokeRolesFromUser('ai_ro', ['ai_reader'])` (restore with `grantRolesToUser`)
   - PostgreSQL: `ALTER ROLE ai_ro NOLOGIN;` then terminate its sessions (restore with `LOGIN`)
4. Access to the switch is limited to admin/owner, protected against cross-site requests, rate limited, and every use is audited. On the laptop the hub uses a single local admin login.

---

## 5. Graceful Degradation

Every KPI profile and intent declares the sources it needs.

| Feature | Requires | Optional enrichment |
|---|---|---|
| Sales KPI | CRM | |
| Collections KPI | BahiKhata (+ legacy history) | CRM (customer names, managers) |
| Support KPI | Samadhan | CRM |
| Customer summary | CRM | BahiKhata, Invoicing, Samadhan |
| Outstanding and aging | BahiKhata | Invoicing |
| Communication history | Invoicing or Samadhan | |
| Similar tickets | Samadhan | |

Behavior:
- A missing **required** source returns "Not available: <source> is <disabled/paused/not configured>", never zero.
- A missing **optional** source gives a partial answer that lists what is missing.
- Prepared answers store `usedSources[]` and `missingSources[]`; the nightly job skips features whose required sources are inactive.
- A paused source's data is shown as stale with its last-read date.

---

## 6. Practice Mode (laptop)

- Setting `MODE=practice` with a **reference date** (default: the latest date found in the active sources, overridable). "Today", "this month", "last week" and freshness checks resolve against it, so a 2-month-old dataset still produces current-looking answers instead of empty ones.
- A banner on every page: "PRACTICE MODE: reference date 2026-08-xx, data from <min> to <max>".
- The nightly schedule is replaced by a **Run now** button.
- **Reconciliation on the laptop:** run the apps' own report logic (BahiKhata reports, CRM dashboards) on the same practice data and compare it with the AI's KPIs.
- **Synthetic fixtures (optional):** a generator creates a clearly labeled source `samadhan_synthetic` (about 200 tickets with events in the Samadhan shape) plus invoice/email fixtures, each with its own switch and a `synthetic` badge. It exists to exercise chunking, embedding, search, and the support KPI. It is purged before the VPS stage and never mixed with real data.
- Recall@5 and support-KPI reconciliation numbers from synthetic data are **not** accepted as real results.

---

## 7. Laptop Dashboard (the hub)

Runs locally (for example `http://localhost:4101`), local admin login, `noindex`. Polling: activity every 3-5 s, inventory every 30 s.

### 7.1 Pages

| Page | Purpose |
|---|---|
| **Overview** | Mode banner and reference date; one tile per source (state, last read, freshness); KPI readiness summary; last pipeline run; Ollama and queue status; open alerts |
| **Sources** (control panel) | Per source: state, **switch**, data policy on disable (keep/hide/purge), read-only verification (tick, time, "auth disabled" warning), pool status, last successful read, rows read in 24 h, blocked attempts, buttons: Test, Verify, Pause, Disable, Enable, Purge, "Show DB-level disable command" |
| **Data inventory** (what we have) | Per source and entity: rows in source, rows synced, date range, last updated, quality flags; records-per-month chart; mapping coverage; KPI readiness matrix |
| **Activity** (what is going on) | Live timeline of reads, syncs, KPI computations, prepared-answer generation, LLM calls, validator results, alerts; running jobs; recent runs with drill-down; read-volume chart; errors |
| **LLM monitor** | FR10 panels: speed, volume, cache, quality, routing, nightly, system, alerts |
| **Mappings** | Employee and customer reconciliation (confirm, split, merge) |

### 7.2 Sources page (wireframe)

```
PRACTICE MODE  reference date 2026-08-14   data: 2026-06-14 .. 2026-08-14
+------------------------------------------------------------------------------+
| CRM (MongoDB)                    [ ON  ]   state: ACTIVE                     |
|  read-only verified  OK  2 min ago     pool: open (2)     last read 09:12:40 |
|  rows read 24h: 3,210    blocked attempts: 0    data policy on disable: hide |
|  [Test] [Verify] [Pause] [Disable] [Purge...]  [DB-level disable command]    |
+------------------------------------------------------------------------------+
| BahiKhata (MongoDB)              [ ON  ]   state: ACTIVE                     |
|  read-only verified  WARN  DB auth disabled (not enforced at database)       |
|  ...                                                                         |
+------------------------------------------------------------------------------+
| Invoicing (MongoDB)              [ -- ]   state: NOT CONFIGURED              |
| Samadhan (PostgreSQL)            [ -- ]   state: NOT CONFIGURED              |
+------------------------------------------------------------------------------+
```

### 7.3 Data inventory (what it shows)

| Entity (source) | Source rows | Synced | Date range (field) | Last updated | Flags |
|---|---|---|---|---|---|
| Connections (CRM) | live count | synced count | `createdAt` min to max | latest `updatedAt` | unparsed bandwidth, no customer mapping, no target for creator's month |
| Connection events (CRM) | | | `date` | | activations without a creator |
| Sales targets (CRM) | | | `monthStart` | | employees with activity but no target |
| Customers (CRM, BahiKhata) | | | | | unmapped between systems, no manager |
| Ledger entries (BahiKhata) | | | `date` | | pending/unapproved, unmapped customer |
| Legacy collections (code) | | | month range | n/a | employees without a mapping |
| Employees (all) | | | | | present in one system only |

Also: a records-per-month bar chart per entity (so the 2-month range is visible), and a **KPI readiness matrix** (employee by profile by month: ready, no target, no activity, source off).
Counts use `estimatedDocumentCount` for totals and time-limited, cached aggregations for ranges, so the dashboard never causes heavy queries.

### 7.4 Activity (what it shows)
Each row: time, source, action (read page, sync run, KPI compute, draft, validate, LLM call, toggle, alert), rows or tokens, duration, result. Filters by source, type, and level. A running-jobs panel shows queue depth and progress. A "blocked attempts" filter proves a switched-off source is not being read.

---

## 8. Schema Additions

**`data_sources`**

| Field | Type | Notes |
|---|---|---|
| `_id` | string | `crm`, `bahikhata`, `invoicing`, `samadhan`, `samadhan_synthetic`, etc. |
| `displayName`, `engine` | string | `mongodb` or `postgres` |
| `mode` | string | `practice` or `production` |
| `state` | enum | `not_configured`, `active`, `paused`, `disabled` |
| `onDisable` | enum | `keep` (stale), `hide`, `purge` |
| `exposedObjects` | string[] | The views the AI may read |
| `credentialRef` | string | Name of the environment variable or encrypted entry (never the secret) |
| `readOnlyCheck` | object | `{ok, checkedAt, details, authEnforced}` |
| `limits` | object | `{pageSize, maxTimeMs, rowsPerMin}` |
| `lastSuccessAt`, `lastError` | | |
| `stateChangedAt`, `stateChangedBy`, `stateReason` | | |

**`source_access_log`** (TTL 30 days): `ts`, `sourceId`, `entity`, `action` (`read_page`, `count`, `verify`, `blocked`), `rows`, `durationMs`, `ok`, `error?`, `runId?`, `triggeredBy` (`schedule`, `manual`, `dashboard`).

**`source_inventory`** (history 90 days): `ts`, `sourceId`, `entity`, `sourceRows`, `syncedRows`, `minDate`, `maxDate`, `lastUpdatedAt`, `perMonth` (array), `flags` (object of counts).

**Changes to existing collections**
- `prepared_answers`: add `usedSources[]`, `missingSources[]`.
- `snapshot_runs.sources.<id>`: add `skipped` (`disabled`, `paused`, `not_configured`).
- `meta`: add document `mode` `{mode, referenceDate, referenceAuto}`.
- `admin_audit`: records every state change, including reason.
- `fact_*`, `text_chunks`: `_src` already identifies the source, so purge and hide are simple filters.

---

## 9. Database Setup Scripts (run by you or your DB admin)

**MongoDB (per source database; names and exact field paths are generated and verified by `views:generate`)**

```js
// Example for CRM; the generator produces one view per allowed entity.
const crm = db.getSiblingDB('<crm_db>');

crm.createView('ai_users_v', 'users', [
  { $project: { name: 1, email: 1, role: 1, isActive: 1, createdAt: 1, updatedAt: 1 } }  // inclusion only
]);
crm.createView('ai_customers_v', 'customers', [
  { $project: { name: 1, customerType: 1, managedBy: 1, isActive: 1, createdAt: 1, updatedAt: 1 } }
  // state and other derived fields are added by the generator after checking the real field path
]);
// ... ai_connections_v, ai_connection_events_v, ai_service_requests_v, ai_sales_targets_v

crm.createRole({
  role: 'ai_reader',
  privileges: [
    { resource: { db: '<crm_db>', collection: 'ai_users_v' },       actions: ['find'] },
    { resource: { db: '<crm_db>', collection: 'ai_customers_v' },   actions: ['find'] }
    // one line per view
  ],
  roles: []
});
crm.createUser({ user: 'ai_ro', pwd: passwordPrompt(), roles: ['ai_reader'] });
```

- Only inclusion lists are used. Aadhaar, PAN, password hashes, tokens, document URLs and contact details are never named in any view.
- BahiKhata follows the same pattern (customers, ledger entries, users). The legacy collections come from a one-time script that reads the array in BahiKhata's source file, so no database access is needed for it.
- **PostgreSQL (Samadhan, when available):** unchanged from BACKEND_SCHEMA Section 8 (`ai_export` views and `ai_ro`).
- **Disable/enable at the database** commands are in Section 4.

---

## 10. Plan Changes

### 10.1 Task changes

| Change | Task | Days |
|---|---|---|
| Removed | P1-03 masking script (replaced below) | -2.0 |
| Removed | P2-01, P2-02, P2-03 adapters in CRM, Invoicing, BahiKhata | -6.0 |
| Removed | P2-15 cross-repo contract harness | -1.0 |
| Reduced | P4-09 admin pages (snapshot runs UI now covered by the Activity page) | -1.0 |
| Added | **N1** Restore practice DBs locally, create views, verify | +1.0 |
| Added | **N2** Source registry, Source Gate, lint and test enforcement | +3.0 |
| Added | **N3** Credential handling and read-only verification | +2.0 |
| Added | **N4** Views generator and DB-admin scripts (including disable/enable commands) | +2.0 |
| Added | **N5** CRM and BahiKhata readers and entity specs (direct, incremental) | +3.0 |
| Added | **N6** Inventory collector (counts, ranges, per-month, flags) | +2.0 |
| Added | **N7** Dashboard pages: Overview, Sources (switches), Data inventory, Activity | +6.0 |
| Added | **N8** Graceful degradation (requires matrix, UI states) | +1.5 |
| Added | **N9** Practice mode and reference date | +0.5 |
| Added | **N10** Purge function and tests | +1.0 |
| Moved to VPS stage | P1-04 (Samadhan views and role), P2-04 (Samadhan reader) | 0 (moved) |
| Added at VPS stage | **N11** Invoicing reader and entity specs | +1.5 |
| Optional | **N12** Synthetic fixtures generator (tickets, invoices, emails) | +2.0 |

**Net:** about **+14 days**, so core effort is roughly **127 developer-days** (was 113). Direct access itself saves about 3 days; the switches, inventory, and activity dashboard are new scope that costs more than that.

### 10.2 New ordering: the laptop control panel comes first

| Step | Work | Result |
|---|---|---|
| 1 | Gate 0 (still first), then N1, N2, N3, N4, N9 | CRM and BahiKhata readable through the gate; switches enforced |
| 2 | N5, N6 and the Overview, Sources, Inventory pages of N7 | **Milestone L1:** you can see what data exists and switch sources on and off |
| 3 | Activity page, N8, N10 | **Milestone L2:** you can see what is happening live, and missing sources degrade cleanly |
| 4 | Then identity mapping, KPIs, prepared answers, LLM pipeline, LLM monitor (as in the Implementation Plan) | Milestones M1 to M4 |

**L1 acceptance:** with the practice data loaded, the dashboard shows record counts and date ranges for CRM and BahiKhata; turning CRM off makes reads stop within seconds (blocked attempts rise, "reads since switch" stays at 0, pool shows closed); turning it back on re-verifies and resumes.
**L2 acceptance:** a sync run, a KPI computation, and an LLM call all appear in Activity; the Sales KPI shows "Not available: CRM is disabled" when CRM is off.

---

## 11. What This Supersedes

| Document and section | Status |
|---|---|
| TRD 2.2 (topology), 3 (adapters), 4.1 (REST adapter contract), 4.3 (sync) | Replaced by Sections 3 and 4 here (the sync engine rules for cursors, hashing, tombstones, quarantine and per-source isolation still apply, now implemented over direct reads) |
| TRD 4.2 (Samadhan Postgres views) | Still valid; moves to the VPS stage |
| TRD 14 (security) | Add: Source Gate, switches, read-only verification, DB-level disable |
| BACKEND_SCHEMA 7 (field mappings) | Still valid; used as the view allow-lists |
| BACKEND_SCHEMA 2.2 `ai_clients` | Still used for apps calling the AI (Phase 4 onward); not used for reading sources |
| IMPLEMENTATION_PLAN Phases 1-2 | Reordered and changed per Section 10 |

---

## 12. Open Items

1. **Practice data:** are the CRM and BahiKhata copies dumps you restore into a local MongoDB, or remote databases you connect to? (Either works.)
2. **Local MongoDB authentication:** is it enabled? Without it, database-level read-only cannot be enforced on the laptop (the switch still works, and the dashboard says so).
3. **Production DB admin:** you will run the view and role scripts on each production database yourself (the AI never receives admin credentials).
4. **Default on disable:** `hide` (keep data on disk but excluded) is proposed; say if you prefer `keep (stale)` or `purge` as the default.
