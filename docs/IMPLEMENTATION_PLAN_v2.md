# Implementation Plan v2: Internal AI Assistant for FAB5 Systems

**Status:** Draft v2 (supersedes IMPLEMENTATION_PLAN v1; folds in DESIGN_UPDATE_v2) | **Implements:** PRD v4, TRD v2, BACKEND_SCHEMA v2
**Sequence:** Gate 0, then Phases 1-4 on the developer laptop (CRM and BahiKhata practice data only), then Phase 5 on the Windows VPS (all sources).

---

## 1. Planning Assumptions

| Item | Assumption |
|---|---|
| Team | 1-2 developers. Tracks below are written so two people can work in parallel |
| Estimates | Ideal developer-days, **plus or minus 30%**. They exclude waiting time for decisions, access, and reviews |
| Core effort | **126.5 developer-days** (Gate 0 3.5, Phase 1 19.0, Phase 2 31.0, Phase 3 34.5, Phase 4 23.5, Phase 5 15.0). v1 was 113; direct access removes about 10 days of adapter, masking, and contract work, and the Source Gate, switches, inventory, and Activity dashboard add about 23.5 |
| Optional/conditional | Synthetic fixtures generator 2.0, Resend body pull 2.0, public-site SEO build 5.0, SEO launch 2.0 (total 11.0) |
| Calendar (rough) | One developer: about 25-26 weeks plus pilot. Two developers: about 14-16 weeks plus pilot |
| Environment | Laptop specs unknown; laptop benchmark numbers are **not** used to set production targets. Laptop data: CRM and BahiKhata practice databases, about 2 months old |
| Defaults for open questions | TRD Section 17 flags (sales attribution `createdBy`, support attribution `resolver`, no netting, no Resend body pull, on-disable `hide`, BahiKhata authoritative for outstanding on the laptop) |

**Suggested tracks (two developers)**
- **Track A, data and KPIs:** Gate 0 support, practice databases, views generator, readers, sync engine, identity, KPI engine, reconciliation.
- **Track B, AI and platform:** Source Gate, credentials and verification, hub shell and pages, Ollama benchmarks, retrieval, generation, validator, queues, monitoring, then infrastructure.
- **Both:** frontend and integrations in Phase 4 (panel and BFF to one, hub pages to the other).

**Interpretation notes (where the design update needed a decision)**

| # | Note |
|---|---|
| 1 | **Driver imports.** The design says only the gate may import `mongodb`/`pg`, but `ai_snapshot` also uses the native driver. Two modules are allowed: `packages/source-gate` (sources) and `packages/snapshot-db` (hard-wired to `AI_MONGO_URI`). Lint and a graph test enforce exactly these two |
| 2 | **N7 split.** The six days of hub pages are split into P2-03 (shell, local login, Overview, Sources, Inventory; 4.5 days) for L1 and P2-04 (Activity; 1.5 days) for L2 |
| 3 | **L2 acceptance.** The design asks L2 to show a KPI computation and a "Not available" Sales KPI before the KPI engine exists. L2 is accepted with the activity event writer and the requirements engine tested on a stub; the live Sales KPI check is repeated at M2 |
| 4 | **Paused sources.** A required source that is `paused` with copied data serves stale-labeled data; "Not available: ... paused" applies only when no copied data exists |
| 5 | **Synthetic sources** are real local databases in the production shape (PostgreSQL for `samadhan_synthetic`, MongoDB for `invoicing_synthetic`) and pass through the gate. If P2-19 is done, the Samadhan reader (P5-07) and Invoicing reader (P5-08) are **pulled forward** to run against them; effort is spent once, not twice |
| 6 | **VPS-stage validation** (real recall@5, support-KPI reconciliation, Samadhan customer reconciliation) reuses tools built in Phases 2-3 and is carried inside P5-09; it is a schedule risk, listed in Section 14 |

---

## 2. Repository and Module Layout

```
fab5-ai/                        (new private repo, npm workspaces, ESM)
  apps/
    ai-service/                 Express 5: BFF API, auth, RBAC, admin endpoints
      src/{server.js, routes/, auth/, rbac/, intents/, retrieval/, admin/}
    ai-worker/                  BullMQ workers and jobs
      src/{llm.js, jobs.js, sync/, inventory/, nightly/, generation/, monitoring/, guard/}
    ai-hub/                     Next.js (App Router, JavaScript): Overview, Sources, Inventory,
                                Activity, LLM monitor, Mappings, Intents, Unmatched
  packages/
    source-gate/                registry, gate, credentials, verify, engines/{mongo.js,postgres.js}, errors
    snapshot-db/                the only access to ai_snapshot (native driver)
    sources/                    crm/, bahikhata/, invoicing/, samadhan/, samadhan_synthetic/, invoicing_synthetic/
                                each: entities.js, views.spec.js
    shared/                     constants, config, clock (reference date), period utils (IST), money/paise,
                                bandwidth parser, hashing, requirements engine, activity emitter,
                                KPI engine, validator, contracts/*.schema.json, PII rules
    ai-bff/                     @fab5/ai-bff (CJS + ESM): proxy middleware for app backends
    ai-panel/                   @fab5/ai-panel: React component with prefixed CSS
  scripts/                      ensureIndexes.js, migrations/, views-generate.js, source-add.js,
                                legacy-export.js, fixtures/ (synthetic generator)
  ops/                          nssm/ollama.ps1, pm2/ecosystem.config.js, nginx/ai.conf, runbooks/
  docs/                         PRD_v4.md, TRD_v2.md, BACKEND_SCHEMA_v2.md, IMPLEMENTATION_PLAN_v2.md
```

Changes inside existing repositories: **none for reading data.** Only the Phase 4 integration remains.

| Repo | Change |
|---|---|
| FAB5-CRM | BFF route mount; panel in the frontend |
| Invoicing | BFF mount; panel |
| tool-BahiKhataa | BFF mount; panel |
| tool-samadhan | BFF mount (TypeScript types shim); panel |

Database-side work (done by a human DB admin from generated scripts, not by app code): views and `ai_ro` users on CRM, BahiKhata, Invoicing (MongoDB) and `ai_export` views and `ai_ro` role on Samadhan (PostgreSQL); recommended source indexes (including the Invoicing indexes from PRD P-06).

---

## 3. Working Agreements

**Definition of done (every task)**
- Code reviewed; lint and unit tests pass; new behavior covered by tests.
- No secrets in the diff; `.env.example` updated; new config flags documented in TRD Section 17.
- **Every read of a source goes through `gate.read`;** no file outside `source-gate` and `snapshot-db` imports `mongodb` or `pg`.
- Anything that calls Ollama goes through the usage-event wrapper (appears on the dashboard).
- Anything that reads, syncs, computes, or toggles emits an activity event.
- Any data leaving a source passes the view allow-list and the PII scan.
- Logs and activity rows contain no personal data or credentials; `pino` redaction covers new fields.
- Docs touched when a contract changes (TRD or BACKEND_SCHEMA).
- No code comments in source files.

**Branching and releases:** trunk-based with short-lived branches. View scripts are versioned in the AI repo (`views.spec.js`) and run by the DB admin **before** a source is activated; the drift check (`views:generate --check`) runs in CI and daily.

**Decisions needed before each phase**

| Before | Decision |
|---|---|
| Gate 0 exit | Resend plan/retention; hosting topology (A or B) and database reachability from the VPS; Redis hosting; Node and MongoDB versions on each host; practice data form (dump or remote); local MongoDB authentication on or off; production DB admin named; default on-disable policy |
| Phase 2 | KPI attribution choices (or accept defaults); which systems are in scope (BharatRadius, Accounting_application) |
| Phase 3 | Manager-to-role mapping, `managerId` assignments; SLA thresholds (or defer SLA metrics) |
| Phase 4 | Public website identity (enables SEO tasks); package registry choice for `@fab5/*` |
| Phase 5 | Authoritative "outstanding" once Invoicing is added; pilot users; alert recipients; DB admin time booked for production view scripts |

---

## 4. Gate 0: Prerequisites (3.5 days, before Phase 1)

| ID | Task | Est. | Output / definition of done | Reqs |
|---|---|---|---|---|
| G0-01 | Rotate secrets exposed in the public BharatRadius repo (database credentials, JWT secret, email password); rotate any keys seen in other repos | 0.5 | New secrets live in the running services; old ones revoked; change recorded | Risk 1 |
| G0-02 | Purge secrets from git history and make all repositories private | 0.5 | History rewritten or repo recreated; visibility private; collaborators reviewed | Risk 1 |
| G0-03 | Email: check Resend plan and retention; export whatever is still needed; locate the mailing microservice repo | 0.5 | Decision note: events-only vs. optional body pull | PRD 5.2 |
| G0-04 | KPI decision session (attribution, netting, collections targets, profile assignment per employee) plus default on-disable policy | 0.5 | Signed-off settings or explicit acceptance of TRD defaults | PRD 4, 5.5 |
| G0-05 | Inventory hosting: where each API, MongoDB, PostgreSQL, Redis runs; choose topology A or B; **check network reachability, TLS, and IP allow-list needs from the VPS to each source database** | 0.5 | Topology diagram; open ports list; reachability table | TRD 2 |
| G0-06 | VPS inventory: Node, MongoDB, Redis versions; CPU flags (AVX2); current RAM/CPU baselines; PM2/Nginx configs | 0.5 | Baseline sheet used in Phase 5 | PRD 10 |
| G0-07 | Access: obtain missing repos or schemas (mailing service, Accounting_application if in scope); **practice database dumps or remote access; local MongoDB auth on/off; name the production DB admin** | 0.5 | Access granted or scope decision recorded; answers to PRD Open Questions 11-13 | PRD 15 |

**Gate 0 exit:** secrets rotated, repos private, topology chosen, KPI defaults agreed or accepted, practice data and DB admin answers recorded.

---

## 5. Phase 1: Foundation and Source Control (Laptop), 19.0 days

| ID | Task | Depends on | Est. | Output / definition of done | Reqs |
|---|---|---|---|---|---|
| P1-01 | Monorepo scaffold (workspaces, ESM, ESLint/Prettier, env loader, pino with redaction); local MongoDB and Redis (AI) documented | G0 | 1.0 | `npm test` and `npm run lint` run in CI | - |
| P1-02 | CI pipeline: lint, Vitest, `depcheck`/bundle analyzer, `npm audit` review, Lighthouse CI skeleton | P1-01 | 1.0 | Green pipeline; dependency report | P-09 |
| P1-03 | `ai_snapshot` via `snapshot-db`: `ensureIndexes.js`, validators, migration runner (`001_init` creating every collection in BACKEND_SCHEMA v2) | P1-01 | 1.0 | Fresh database builds in one command | P-06 |
| P1-04 | Shared library: constants, **clock with reference-date injection**, IST period utilities (luxon), paise/money, bandwidth parser, hashing, IDs; unit tests including edge cases | P1-01 | 1.5 | Test suite with unparsed bandwidth, month boundaries (IST vs UTC), FY boundaries, practice-mode "today" | FR2, FR14 |
| P1-05 | PII allow/deny rules as code, scanner, and tests reused by the views generator and entity specs | P1-04 | 1.0 | Scanner catches seeded violations | PRD 5.4 |
| P1-06 | Practice databases: restore CRM and BahiKhata locally; record collection and field paths and sample documents for the generator; after P1-09, create views and `ai_ro` locally and verify | G0, P1-09 (restore part first) | 1.0 | Two local databases; `ai_ro` cannot read base collections; auth status recorded | PRD 5.4, 12 |
| P1-07 | **Source registry, Source Gate**, state cache with Redis invalidation, access log, rows-per-minute limiter, `leaveActive` (close pool, wipe credentials, abort in-flight, cancel queued jobs), lint rule and graph test for the one-door rule, real/synthetic exclusion, production refuses `authEnforced=false` | P1-03, P1-04 | 3.0 | Gate tests green: disabled read throws and logs `blocked`; state change effective within 1 s (Redis) and 5 s (TTL only); fail closed on registry error; seeded import violation fails the build | FR11, TRD 4.1-4.2 |
| P1-08 | **Credential handling and read-only verification:** `env:`/`store:` refs, AES-256-GCM store, `npm run source:add`, Mongo (`connectionStatus` privileges) and Postgres checks, daily schedule, `warn` for auth disabled | P1-07 | 2.0 | Seeded write privilege, extra resource, superuser, DML grant all fail; auth-disabled yields `warn` with `authEnforced=false`; checks never write; no secrets in logs or API | FR11, TRD 4.3-4.4 |
| P1-09 | **Views generator and DB-admin scripts:** CRM and BahiKhata specs (Invoicing and Samadhan specs drafted), field-existence check against sample documents, inclusion-only and deny-list tests, `--check` drift mode, index recommendations, disable/enable commands, DB-admin README | P1-04, P1-05, P1-06 (restore) | 2.0 | Generated scripts reviewed; views created locally; drift check detects a changed view | FR11, PRD 5.4 |
| P1-10 | **Practice mode and reference date:** `meta.mode`, auto reference date from active sources' activity dates, override, banner data, Run-now trigger plumbing | P1-03, P1-04 | 0.5 | Banner values returned by API; "today" resolves to the reference date in period tests | FR14 |
| P1-11 | Auth layer and AI service skeleton (Express 5): `ai_clients`, key hashing, timing-safe compare, HMAC signing and replay cache, rate limiting, acting-user resolution (role from `employees`), `hub` client and seeded local admin | P1-03 | 1.5 | Tests: bad key, bad signature, replay, disabled app, unknown user, role escalation attempt | FR7 |
| P1-12 | Install Ollama; benchmark candidate small, large, and embedding models on the laptop (prefill speed, decode speed, RAM, output quality on sample KPI facts); pin model tags | G0 | 2.0 | Benchmark report; `MODEL_*` pinned; recorded laptop baselines (not production targets) | Phase 1 exit |
| P1-13 | Ollama client wrapper: timeouts, abort, retries, usage-event and activity-event recording, `/api/ps` probe | P1-03, P1-12 | 1.5 | Every call produces a `llm_usage_events` row and an `llm_call` activity event | FR10 |

**Phase 1 exit criteria:** practice databases restored with views and `ai_ro`; `ai_snapshot` builds from scratch; Source Gate enforced and tested; read-only verification working with `authEnforced` reporting; generator scripts reviewed; auth layer tested; models pinned with benchmark evidence; practice mode working.

---

## 6. Phase 2: Control Panel and Ingestion (Laptop), 31.0 days

| ID | Task | Depends on | Est. | Output / definition of done | Reqs |
|---|---|---|---|---|---|
| P2-01 | **CRM and BahiKhata readers and entity specs** (direct, incremental, compound cursor, content hash, quarantine); `scripts/legacy-export.js` reading BahiKhata's source file; verify that `history` appends bump the parent `updatedAt` | P1-07, P1-08, P1-06 | 3.0 | Entity-spec tests pass; deny-list test passes; cursor resumes after a kill; legacy export produces monthly per-employee rows | FR1 |
| P2-02 | **Inventory collector:** source counts (time-limited, cached), synced counts, date ranges, last updated, records per month, quality flags, mapping coverage, KPI readiness writer | P2-01 | 2.0 | `source_inventory` and `kpi_readiness` populated; no heavy queries (budget test); non-active sources never read | FR12 |
| P2-03 | **Hub shell, local admin login, Overview, Sources (switches), Data inventory pages**; `/admin/sources*`, `/admin/inventory*`, `/admin/mode` endpoints; CSRF, rate limit, audit with required reason; DB-level disable command display | P2-01, P2-02, P1-10, P1-11 | 4.5 | **Milestone L1** (below) | FR11, FR12 |
| P2-04 | **Activity page** and activity event pipeline (emitters in gate, sync, KPI, drafts, LLM wrapper, toggles; blocked-attempt collapsing; running jobs; run drill-down) | P2-03, P1-13 | 1.5 | Timeline shows reads, syncs, LLM calls, toggles, alerts with filters | FR12 |
| P2-05 | **Graceful degradation:** requirements engine, evaluation states (live, stale, hidden, not configured), "Not available" and partial responses, stale labels, hub UI states, serving-time check on `usedSources` | P2-03 | 1.5 | Requirements matrix tests for every feature and source state; no zero values | FR13 |
| P2-06 | **Purge function and tests** (per BACKEND_SCHEMA purge procedure, typed confirmation, counts reported) | P1-03, P1-07 | 1.0 | Purge removes facts, chunks, embeddings, prepared answers, mapping references; audited | FR11 |
| P2-07 | Employee identity builder: collect from active sources by email, create `employees`, CLI to assign `aiRole`, `managerId`, KPI profiles | P2-01, P1-03 | 1.0 | Report: complete/partial mappings | PRD 5.3 |
| P2-08 | Customer reconciliation tool (CRM + BahiKhata): normalization, exact and fuzzy candidates, CSV/JSON report (matched, ambiguous, unmatched) for manual review; apply confirmations | P2-01, P1-03 | 2.0 | Reviewed report; confirmed mappings stored; no auto-accept below exact | PRD 5.3 |
| P2-09 | Sync engine over direct reads: pagination, cursors in `sync_state`, upsert with content hash, per-source isolation, retries, quarantine, tombstones, weekly ID reconciliation, `snapshot_runs` (with skipped reasons), abort on leaving `active` | P2-01, P2-07, P2-08 | 3.0 | Idempotent re-runs; a killed run resumes; one failing or switched-off source does not block others | FR1 |
| P2-10 | Load `legacy_collections` with key-to-employee mapping (owned by the BahiKhata switch) | P2-01, P2-07 | 0.5 | Rows per employee and month; totals checked against the source array; hidden when BahiKhata is hidden | PRD 4.2 |
| P2-11 | Daily aging computation into `fact_aging_daily` using BahiKhata boundaries | P2-09 | 1.0 | Matches BahiKhata's aging for sample customers | PRD 4.2 |
| P2-12 | Indexes and N+1: `explain()` on view queries, recommended source-index script, query-count budget tests | P2-01, P1-03 | 1.0 | No COLLSCAN on hot paths; budgets enforced in CI | P-06, P-13 |
| P2-13 | Integrate PII scanner after each sync; failure fails the run and raises an alert | P1-05, P2-09 | 0.5 | Seeded violation blocks promotion | PRD 5.4 |
| P2-14 | `communication_events` builder (invoice, credit note, reminders, suspension, ticket notices), allow-list enforced | P2-09 | 1.5 | Built and tested on fixtures; counts match fixture logs; deny-listed types absent. Real validation in P5-09 | FR9 |
| P2-15 | Ticket text preparation: cleaning, chunking, de-identification helper | P2-09 | 1.5 | Chunks per TRD 8.1; masking helper tested on fixtures | FR8 |
| P2-16 | Embedding pipeline with `nomic-embed-text` prefixes, Float32 binary storage with `_src`, active-model pointer, hash-skip | P1-13, P2-15 | 1.5 | Re-run embeds nothing; model switch procedure documented | FR8 |
| P2-17 | Hybrid search: in-memory vectors of visible sources, keyword index, RRF, filters, hot reload after promotion or source change | P2-16 | 2.0 | Query latency within target; filter and visibility correctness tests | FR8 |
| P2-18 | Evaluation harness: about 100 held-out tickets (excluded from retrieval); recall@5 and "no match" precision; provisional `SIM_MIN_SUGGEST` | P2-17 | 2.0 | Harness works on synthetic or hand-made tickets; **numbers not accepted as real results** (real run in P5-09) | FR8 |
| *P2-19* | *Optional: synthetic fixtures generator (about 200 tickets with events, invoices, email logs) into local `samadhan_synthetic` (PostgreSQL) and `invoicing_synthetic` (MongoDB), badge `synthetic`, own switches* | *P1-07, P1-09* | *2.0* | *Synthetic sources readable through the gate (pulls P5-07/P5-08 forward); excluded when real source of the same logical source is active* | *FR14* |
| *P2-20* | *Optional: Resend body pull (list, filter by allowed types, retrieve, throttle, strip HTML)* | *P2-14* | *2.0* | *Only if G0-03 chose it; captures only what Resend still retains* | *PRD 5.2* |

**Milestone L1 (after P2-01, P2-02, P2-03).** With practice data loaded: the dashboard shows record counts and date ranges for CRM and BahiKhata; turning CRM off makes reads stop within seconds (blocked attempts rise, "reads since switch" stays 0, pool shows closed); turning it back on re-verifies and reads resume (cursor resume is re-proven in P2-09).

**Milestone L2 (after P2-04, P2-05, P2-06).** A sync run and an LLM call appear in Activity; the requirements engine returns "Not available: CRM is disabled" for the Sales feature when CRM is off (live Sales KPI card repeated at M2); a purge test passes.

**Phase 2 exit criteria:** L1 and L2 accepted; CRM and BahiKhata sync incrementally and idempotently into `ai_snapshot`; PII scan clean; `legacy_collections` loaded; query-count and index checks pass; retrieval pipeline tested on fixtures.

---

## 7. Phase 3: KPI and AI Engine (Laptop), 34.5 days

| ID | Task | Depends on | Est. | Output / definition of done | Reqs |
|---|---|---|---|---|---|
| P3-01 | KPI: sales (achieved Mbps, upgrades, lost Mbps, attainment, supporting metrics), flags for attribution/netting; visibility-filtered loaders; `usedSources` output | P2-09 | 2.0 | Fixture tests incl. no target, unparsed bandwidth, multiple upgrades, CRM hidden | FR2, FR13 |
| P3-02 | KPI: collections (billed, collected, efficiency, aging, growth with legacy history and `INSUFFICIENT_HISTORY`, defaulters) | P2-09, P2-10, P2-11 | 2.0 | Fixture tests incl. zero billed, advances, month boundaries, single-month history | FR2 |
| P3-03 | KPI: support (resolver attribution, resolved, MTTR, backlog, rating, escalations, repeat rate); runs on synthetic with `SYNTHETIC_SOURCE` | P2-09 | 2.0 | Fixture tests incl. reassigned and reopened tickets | FR2 |
| P3-04 | Reconciliation gate: compare sales and collections KPIs against the apps' own report logic (CRM targets/dashboard, BahiKhata `/reports/dashboard`) on the same practice data for sample employees and months. Support reconciliation moves to P5-09 | P3-01, P3-02 | 2.0 | Reconciliation report; collections tolerance zero; differences explained | FR2 |
| P3-05 | Intents: seed table with `requiresSources`/`optionalSources`, example embeddings, matcher, margin rule, parameter extraction (periods via clock, profiles, names), permission then availability check; labeled phrasing set and threshold calibration | P2-16, P2-05 | 3.0 | Accuracy meets target (proposed 90% or higher); confusion matrix; clarification flow tested | FR3, FR4, FR13 |
| P3-06 | Facts templates (Indian number formatting, percentages, dates) and prepared-answer generator with metrics hash, skip-if-unchanged, `usedSources`/`missingSources` | P3-01..03 | 2.0 | Deterministic text; unchanged metrics cause no regeneration | FR3 |
| P3-07 | Validator and seeded-error suite (wrong numbers, unknown names, forbidden patterns, length) | P3-06 | 2.0 | All seeded errors caught; false-reject rate measured | FR3, FR6 |
| P3-08 | Prompts, structured outputs (`format` schema), per-model options (`num_ctx`, `num_predict`, thinking off) | P1-13, P3-07 | 1.5 | Stable outputs on sample facts across both models | FR6 |
| P3-09 | Night pipeline: verification, sync, embed, KPI (skips features with unavailable required sources), draft (small), validate, review (large) on failure, numbers-only fallback, promotion and `snapshot_runs`; **Run now** in practice mode | P3-06..08, P2-13 | 2.0 | Full simulated night completes; fallback path tested; skipped sources recorded | FR1, FR3, FR6, FR13, FR14 |
| P3-10 | Queues, workers, streaming (Redis channels to SSE), cancellation, timeouts, dedicated Redis configuration; `ai:source:changed` handling for queued jobs | P1-13 | 3.0 | Cancel stops Ollama generation; SSE reconnect returns final result; switch-off removes queued sync jobs | FR6 |
| P3-11 | Day routing: prepared, small, large; quick-answer plus refine; backpressure and 429 handling | P3-05, P3-10 | 2.0 | Simulated load shows routing and swap-in of refined answers | FR4, FR6 |
| P3-12 | AI service API: `/me/home`, `/assist/*` with availability fields, acting-user resolution, RBAC enforcement and **full intent x role test matrix** | P1-11, P3-05 | 2.0 | Matrix tests pass; denial messages fixed, LLM not invoked on denial | FR7 |
| P3-13 | Redis KPI cache keyed by snapshot version; HTTP caching headers for prepared cards; invalidation on source change | P3-06, P3-12 | 1.0 | Hit rate visible; no cross-user cache leakage test | P-01, P-14 |
| P3-14 | Production guard: CPU and production-health probes, pause/resume large and small queues, source-sync suspension, cooldown, alerts | P3-10 | 1.5 | Forced CPU load pauses queues; resume after cooldown | D-13 |
| P3-15 | Monitoring backend: usage events, system sampler, hourly/daily rollups, alert rules (including verification failure, read-after-switch-off, view drift) and email delivery | P1-13, P3-10 | 3.0 | Dashboard endpoints return correct aggregates on a simulated day | FR10, FR12 |
| P3-16 | Admin endpoints: intents CRUD, unmatched review, mappings, snapshot status/run, audit log | P3-12 | 2.0 | Every change audited; role-restricted | FR8 (admin), FR7 |
| P3-17 | Question log, weekday-based precompute, unmatched-question clustering | P3-05, P3-09 | 1.5 | Precompute schedules match usage patterns in a simulation; clusters created | FR5 |

**Phase 3 exit criteria:** end-to-end run (sync, KPI, draft, validate, promote, morning lookup) works on practice data; sales and collections reconciliation passed; Sales KPI shows "Not available: CRM is disabled" when CRM is off (completes L2); validator catches all seeded errors; RBAC matrix green; intent accuracy at target; dashboard API verified on a simulated day.

---

## 8. Phase 4: Web App, LLM Monitor, Performance (Laptop), 23.5 days

| ID | Task | Depends on | Est. | Output / definition of done | Reqs |
|---|---|---|---|---|---|
| P4-01 | `@fab5/ai-bff` package: dual CJS/ESM, headers, SSE pass-through, disconnect-abort, tests against a fake AI service | P3-12 | 2.0 | Works in an Express 4 CommonJS app and an Express 5 ESM app | FR7 |
| P4-02 | Integrate BFF and panel into the CRM (Vite, Tailwind 3) | P4-01, P4-06 | 1.5 | Morning cards and ask box visible behind CRM login | FR4 |
| P4-03 | Integrate into BahiKhata (Next.js) | P4-01, P4-06 | 1.5 | Same | FR4 |
| P4-04 | Integrate into Samadhan (TypeScript backend, Next.js) | P4-01, P4-06 | 1.5 | Same; types shim for the BFF package | FR4 |
| P4-05 | Integrate into Invoicing (Vite, Tailwind 4) | P4-01, P4-06 | 1.0 | Same | FR4 |
| P4-06 | `@fab5/ai-panel`: KPI cards with sparkline, ask box (debounced, cancellable), streaming answer, "quick answer to refined" states, "Not available"/stale/partial states, feedback, source-as-of footer; prefixed CSS without preflight; accessibility | P3-12 | 3.5 | Renders correctly next to Tailwind 3 and 4 hosts (visual tests); keyboard accessible | FR4, FR13, P-03, P-07, P-08 |
| P4-07 | Hub hardening for production: token-exchange session (60-second one-time token, 8-hour cookie), role gate, local login disabled in production mode, `noindex`, robots, security headers | P2-03, P3-12 | 2.0 | Only admin/owner can enter; cookie flags verified; local login refuses to start in production mode | FR10, S-02 (internal) |
| P4-08 | LLM monitor page: overview, speed, volume, cache, quality, routing, nightly, system, alerts; range selector; CSV export; skeletons | P3-15, P2-03 | 4.0 | All panels show data from simulated load; mobile layout works | FR10, P-02, P-03 |
| P4-09 | Remaining admin pages: intents editor, unmatched questions, employee/customer mapping reconciliation UI (snapshot runs UI is covered by Activity) | P3-16, P2-03 | 2.0 | Admin can confirm a fuzzy customer match and see it applied; changes audited | FR8, PRD 5.3 |
| P4-10 | Performance pass on panel and hub: lazy loading, dynamic imports, re-render profiling and fixes, debounce, script deferral, minification/purge check, client caching, virtualized Activity timeline | P4-06..09 | 2.5 | Profiler evidence recorded; bundle budgets met | P-01, P-02, P-05, P-07, P-08, P-11 |
| P4-11 | Lighthouse CI budgets, accessibility checks, mobile tests (360, 390, 768, 1024, 1440), cross-host CSS isolation tests | P4-10 | 1.5 | LCP <= 2.5 s, CLS <= 0.1 in lab; INP proxy acceptable; a11y issues fixed | P-15, P-16 |
| P4-12 | Automated tests: internal routes always `noindex`, disallowed in robots, absent from sitemap; security headers present | P4-07 | 0.5 | Build fails if an internal route loses `noindex` | PRD 9 |
| *P4-13* | *Conditional: public-site SEO build (sitemap, robots, metadata, one H1, heading hierarchy, image names and alt text, JSON-LD, internal links, slugs and redirects, og:image, link check)* | *public site identified* | *5.0* | *Checks in PRD Section 9 pass on the public site* | *S-01..S-13* |

**Phase 4 exit criteria:** panel works inside all four apps on laptop builds; hub complete on simulated data; Lighthouse budgets and accessibility checks pass; internal routes verified non-indexable; KPI numbers shown match the reconciliation reports.

---

## 9. Phase 5: VPS Deployment, All Sources, Hardening, Pilot, 15.0 days (+ pilot)

| ID | Task | Depends on | Est. | Output / definition of done | Reqs |
|---|---|---|---|---|---|
| P5-01 | VPS baseline confirmation (from G0-06): versions, AVX2, free RAM/CPU at peak, existing PM2/Nginx setup | G0-06 | 1.0 | Baseline sheet approved | NFR |
| P5-02 | Ollama as a Windows service (NSSM): localhost bind, keep-alive, max loaded models, below-normal priority, CPU affinity; verify the runner process inherits both; pull models | P5-01 | 1.0 | Service survives reboot; evidence of priority/affinity on the runner | TRD 15.1 |
| P5-03 | MongoDB WiredTiger cache cap; AI Redis (`noeviction`, password, localhost); `ai_snapshot` and curated-collection backups (including `data_sources`, `source_credentials`) | P5-01 | 1.0 | Memory budget verified; restore test of curated collections | TRD 15.2-15.4 |
| P5-04 | PM2 ecosystem; Nginx upstream and SSE settings; HTTPS redirect and HSTS verification; CDN check for public static assets only | P5-02 | 1.5 | Services restart cleanly; HTTPS verified; no authenticated/AI data behind a CDN | P-04, P-10, P-17 |
| P5-05 | **Production source access:** purge synthetic sources; DB admin runs generated view and role scripts and the recommended index script on production CRM, BahiKhata, Invoicing; production credentials via `source:add`; verification must be green with `authEnforced`; app keys and signing secrets; key rotation drill; test DB-level disable and enable once | P5-03, P1-09 | 2.0 | Sync works against production in read-only mode; verification green; rotation drill documented | FR11, FR14, TRD 14 |
| P5-06 | Samadhan: `ai_export` views and `ai_ro` role on production PostgreSQL (run by DB admin); verify `ai_ro` cannot read base tables (moved from v1 P1-04) | P5-05 | 1.0 | SQL in repo; verification script passes | TRD 4.7 |
| P5-07 | Samadhan reader and entity specs through the gate; verify how `updated_at` behaves in practice; set overlap window (moved from v1 P2-04; pulled forward if P2-19 exists) | P5-06 | 2.0 | Reader returns incremental pages; note on `updated_at` reliability | FR1 |
| P5-08 | Invoicing reader and entity specs; Invoicing indexes via DB-admin script (N11) | P5-05 | 1.5 | Invoices, credit notes, email events sync; boilerplate and recipient addresses absent; no COLLSCAN | FR1, FR9, P-06 |
| P5-09 | First production backfill and re-embed (same model and quantization as laptop, or re-embed all); switch `MODE=production`; full nightly run; **re-benchmark with production running**; real recall@5 and `SIM_MIN_SUGGEST` calibration; support-KPI reconciliation; Samadhan customer reconciliation; communication-event counts vs source logs; decide authoritative outstanding | P5-02..08 | 2.0 | Real prefill/decode numbers recorded; nightly run finishes before 06:00 IST; recall@5 meets target (or gap documented); production latency unchanged | NFR, FR2, FR8, FR9 |
| P5-10 | Guard and threshold tuning under simulated load (15 users, mixed prepared and live); alert wiring to real recipients | P5-09 | 1.0 | No measurable regression in existing services (especially the WebRTC relays) or source database latency | D-13, NFR |
| P5-11 | Runbooks and handover (Section 12) | P5-09 | 1.0 | Runbooks reviewed and tested once | - |
| P5-12 | **Pilot:** 2-3 users for 1-2 weeks; daily review of unmatched questions, validator failures, KPI disputes, source activity; adjust thresholds and intents (support about 0.5 day per day) | P5-10 | pilot | Go/no-go against success metrics | PRD 13 |
| *P5-13* | *Conditional: SEO launch (submit sitemap, verify Search Console, final link crawl, start backlink plan)* | *P4-13, domain access* | *2.0* | *Search Console verified; sitemap accepted* | *S-11, S-14, S-15* |

**Phase 5 exit criteria:** no measurable regression in existing services during AI activity; read-only verification green on every production source; nightly job on time on production data; HTTPS verified; hub live on production data; pilot results meet the success metrics in PRD Section 13.

---

## 10. Milestones

| ID | Milestone | Demo / acceptance |
|---|---|---|
| M0 | Gate 0 complete | Secrets rotated, repos private, topology chosen, practice data answers recorded |
| P1 done | Source control in place | Gate enforced, views and `ai_ro` working on practice databases, verification reporting |
| **L1** | Laptop control panel: see and switch | Counts and date ranges for CRM and BahiKhata; CRM off stops reads in seconds; on re-verifies and resumes |
| **L2** | Laptop control panel: see what happens | Sync run and LLM call in Activity; "Not available: CRM is disabled" from the requirements engine; purge tested |
| M1 | Data in | CRM and BahiKhata synced into `ai_snapshot`; PII scan clean; retrieval pipeline tested on fixtures |
| M2 | KPIs correct | Sales and collections reconcile with the apps' own report logic on the same practice data; Sales KPI card shows "Not available" when CRM is off; support KPI shown on synthetic with badge |
| M3 | Morning lookup | Simulated night run produces validated prepared answers; `/me/home` returns them instantly; live question works with streaming |
| M4 | In the apps | Panel visible inside CRM, BahiKhata, Samadhan, Invoicing; LLM monitor shows simulated usage |
| M5 | VPS staging | Production sources verified read-only and syncing; first real nightly run complete; benchmark recorded |
| M6 | Pilot | 2-3 real users for 1-2 weeks; issues triaged |
| M7 | General availability | All users enabled; alerts routed; runbooks signed off |

**Critical path:** G0, then P1-01/P1-03, then P1-07/P1-08/P1-09 (gate, verification, views), then P2-01 (readers), then P2-02/P2-03 (L1), then P2-07/P2-08 (identity), then P2-09 (sync), then P3-01..04 (KPIs and reconciliation), then P3-06/07/09 (prepared answers and validator), then P3-10/11 (queues and routing), then P4 integration, then P5 production access, staging, and pilot.
**Parallel work:** P1-12/P1-13 (models and Ollama wrapper) beside the Source Gate; P2-04..06 beside identity and sync; P2-14..18 (retrieval) beside P3 KPI work; `ai-panel` (P4-06) can start against a mocked API once the TRD API contract is frozen; LLM monitor (P4-08) can start once usage events exist (P3-15).

---

## 11. Verification Matrix (every PRD requirement)

| Requirement | Verified by | Task(s) | Phase |
|---|---|---|---|
| FR1 direct snapshot | Idempotent re-run test, killed-run resume, per-source isolation, entity-spec tests, drift check, skipped-source recording | P1-09, P2-01, P2-09, P2-12, P3-09, P5-07, P5-08 | 1-3, 5 |
| FR2 KPI engine | Fixture tests and reconciliation against source apps' report logic; support on real tickets | P3-01..04, P5-09 | 3, 5 |
| FR3 intents and prepared answers | Phrasing-set accuracy, skip-if-unchanged test, template determinism | P3-05..07, P3-09 | 3 |
| FR4 question handling | Routing simulation, unmatched logging, clarification flow | P3-05, P3-11 | 3 |
| FR5 learning from usage | Precompute simulation, clustering output | P3-17 | 3 |
| FR6 two-model pipeline | Night fallback test, quick-answer/refine simulation, cancel test | P3-08..11 | 3 |
| FR7 access control | Intent x role matrix, key/signature/replay tests, role-escalation test, isolation of per-user answers, switch-endpoint role/CSRF tests | P1-11, P2-03, P3-12 | 1-3 |
| FR8 ticket assistance | recall@5, no-match precision (synthetic first, real in P5-09), de-identification test | P2-15..18, P5-09 | 2, 5 |
| FR9 communication events | Counts match source logs; deny-listed types absent | P2-14, P5-08, P5-09 | 2, 5 |
| FR10 LLM dashboard | Aggregates verified on a simulated day; UI panels and alerts | P3-15, P4-07, P4-08 | 3-4 |
| FR11 source control | Gate tests, import-ban test, verification tests, view tests, switch end-to-end (reads since switch 0, blocked attempts, pool closed, re-verify and resume), purge test, DB-level disable drill | P1-07, P1-08, P1-09, P2-03, P2-06, P5-05 | 1-2, 5 |
| FR12 data inventory and activity | Counts match direct counts, date ranges, flags, KPI readiness matrix, activity rows for reads/syncs/KPI/LLM/toggles, no heavy-query budget | P2-02, P2-03, P2-04, P3-15 | 2-3 |
| FR13 graceful degradation | Requirements matrix tests for every feature and source state; no zero values; stale labels | P2-05, P3-05, P3-09, P3-12, P4-06 | 2-4 |
| FR14 practice mode and synthetic fixtures | Reference-date period tests, banner, Run-now, real/synthetic exclusion, synthetic purge before VPS | P1-04, P1-10, P2-19, P3-09, P5-05 | 1-3, 5 |
| P-01 cache API | Headers/ETag tests; cache-isolation test | P3-13, P4-10 | 3-4 |
| P-02 lazy loading | Bundle analysis | P4-10 | 4 |
| P-03 skeletons | Visual check; zero layout shift on load | P4-06, P4-08 | 4 |
| P-04 CDN | Only public static assets; no authenticated data | P5-04 | 5 |
| P-05 minify | Production build inspection, budgets | P4-10, P4-11 | 4 |
| P-06 indexes | `explain()` on view queries shows no COLLSCAN; recommended source-index script; Invoicing indexes | P1-03, P2-12, P5-08 | 1-2, 5 |
| P-07 re-renders | Profiler evidence | P4-10 | 4 |
| P-08 debounce | Test of request counts while typing; aborted requests | P4-06, P4-10 | 4 |
| P-09 dependencies | `depcheck` clean, audit reviewed | P1-02 | 1 (and ongoing) |
| P-10 load balancer | Nginx upstream and PM2 cluster running; LLM not balanced | P5-04 | 5 |
| P-11 defer scripts | Lighthouse "render-blocking" audit | P4-10 | 4 |
| P-12 pooling | Gate pool settings (max 2 Mongo, 3 pg), pools close on leaving `active`, dashboard pool state | P1-07, P5-05 | 1, 5 |
| P-13 N+1 | Query-count budget tests | P2-12 | 2 |
| P-14 server cache | Hit-rate metric; invalidation on snapshot promotion and source change | P3-13 | 3 |
| P-15 Core Web Vitals | Lighthouse CI in lab; field data reviewed during pilot | P4-11, P5-12 | 4-5 |
| P-16 mobile | Breakpoint tests, touch-target checks | P4-11 | 4 |
| P-17 HTTPS | Redirect test, HSTS header, secure cookies | P5-04 | 5 |
| S-01..S-15 | Conditional on the public site; internal noindex verified by automated tests | P4-12, P4-13, P5-13 | 4-5 |
| NFR: latency | Prepared under 500 ms; live within stated limits, measured on VPS | P5-09 | 5 |
| NFR: no production regression | Probe latency (apps and source databases) before/during/after AI load | P3-14, P5-10 | 3, 5 |
| NFR: nightly by 06:00 | Run timing for 14 consecutive nights during pilot | P5-09, P5-12 | 5 |
| NFR: switch latency | Block within 5 s (1 s with Redis); in-flight reads aborted | P1-07, P2-03 | 1-2 |
| NFR: read-only assurance | Daily verification green; seeded write privilege fails | P1-08, P5-05 | 1, 5 |
| NFR: privacy | PII scan clean; view allow-list tests; no outbound calls from AI layer (network check) | P1-05, P1-09, P2-13, P5-05 | all |

---

## 12. Runbooks to Produce (Phase 5)

| Runbook | Trigger | Summary |
|---|---|---|
| Nightly run late or failed | Alert | Check `snapshot_runs`, per-source status, re-run a single source, decide whether to serve stale answers labeled with `asOf` |
| Switch a source off or on | Admin action or incident | Pause or disable in the hub with reason, confirm blocked attempts and pool closed, choose `keep`/`hide`/`purge`, re-enable with re-verification |
| Read-only verification failed | Alert (source auto-paused) | Read the check details, ask the DB admin to correct grants, re-run Verify, re-enable |
| DB-level disable and enable | Hard cut-off needed | Copy the command from the hub, DB admin runs it, record in audit, reverse with the restore command |
| Purge a source | Data removal request | Disable, typed confirmation, purge, verify counts and mapping references |
| Source schema changed or view drift | Drift alert or sync quarantine | Run `views:generate --check`, update the view spec, DB admin re-runs the view script, confirm entity-spec tests |
| Source endpoint or database down | Sync failure | Check network and credentials, pause the source if needed, serve stale labeled data |
| Ollama down or unresponsive | Alert | Restart service, check memory, confirm models loaded (`/api/ps`), reduce to small model only |
| Guard engaged | Alert | Review CPU and probe latency, identify noisy process, adjust thresholds or move inference off-box |
| Credential rotation | Schedule or incident | Rotate source credentials (`source:add`), app keys, HMAC secrets, master key; verify; revoke old ones |
| Model upgrade | Planned | Benchmark, embed all under the new model, flip `activeModel`, verify recall and validator, roll back by flipping back |
| Restore curated data | Data loss | Restore `ai_clients`, `employees`, mappings, intents, `data_sources`, `source_credentials` from nightly dump; rebuild facts by backfill |
| Customer mapping dispute | User report | Inspect mapping, correct in hub, audited, re-run affected KPIs |

**Rollback:** the AI layer is isolated and never writes to sources. Disable an app integration by setting its `ai_clients.enabled=false` or removing the BFF mount; switch every source to `disabled` in the hub (and, for a hard guarantee, run the DB-level disable commands); stop the PM2 AI processes and the Ollama service. Existing apps and their databases are unaffected. If the VPS cannot sustain inference, only `OLLAMA_URL` changes to point at another machine.

---

## 13. First Two Weeks (10 working days)

| Days | Work |
|---|---|
| 1-3.5 | Gate 0 (G0-01..G0-07), with the KPI session, hosting and reachability inventory, and practice-data answers |
| 4 | P1-01 scaffold |
| 5 | P1-02 CI |
| 6 | P1-03 `ai_snapshot` indexes, validators, migrations |
| 7-8 | P1-04 shared library and tests; P1-06 restore of practice databases (restore part) |
| 8-10 | P1-07 Source Gate (start); with a second developer in parallel, P1-12 model benchmarks and pinned tags |

After this sprint the critical-path items (gate, verification, views generator, readers, identity) continue, with the second developer taking Ollama, retrieval, and the hub shell.

---

## 14. Top Risks to Schedule

| Risk | Schedule effect | Mitigation |
|---|---|---|
| Decisions pending (attribution, SLA, manager mapping) | Rework in P3 | Flags with defaults; decisions requested before P2 |
| DB admin unavailable or slow to run view scripts | P5-05 to P5-08 slip; laptop unaffected | Generator scripts reviewed early; booking in Gate 0; practice run on local databases |
| Local MongoDB without authentication | Verification shows "not enforced" on the laptop | Accepted on the laptop; production activation requires enforced auth |
| Source databases lack indexes for incremental reads | Slow or heavy reads; longer P2-01 and P5-08 | `explain()` checks in P2-12; index script for the DB admin; page-size and rate caps |
| `history` appends do not bump parent `updatedAt` | Missed CRM events | Verified in P2-01; fall back to periodic full re-read of events with hash dedupe |
| Samadhan `updated_at` unreliable | Longer P5-07 | `last_activity_at` view and 7-day overlap already planned |
| Customer name matching worse than expected | More manual review in P2-08/P4-09 | Show unmapped customers explicitly; admin UI for confirmations |
| Reconciliation differences in KPIs | P3-04 extends | Early reconciliation per KPI as each is built, not at the end |
| **VPS-stage validation larger than estimated** (real recall@5, support reconciliation, Samadhan customer matching, outstanding authority) | P5-09 extends; pilot starts later | Tools already built and tested on fixtures; synthetic pulls readers forward; keep the pilot gated on these results |
| Practice data too short for growth and weekday-pattern features | Weak demos on the laptop | Reference-date mode; `INSUFFICIENT_HISTORY` flag; real history builds on the VPS |
| VPS capacity tighter than planned | P5 re-plan | Small model only by day; large model at night; or separate inference machine |
| Public-site SEO work lands late | Conditional tasks | Kept out of the critical path; starts once the site is identified |

---

## 15. Crosswalk from IMPLEMENTATION_PLAN v1

| v1 task | v2 task | Change |
|---|---|---|
| P1-01, P1-02 | P1-01, P1-02 | Gate and import-ban lint added to CI scope |
| P1-03 masking script | removed | -2.0 (views protect fields; practice data restored locally) |
| P1-04 Samadhan masked copy, views, role | P5-06 | Moved to VPS stage (no masked copy needed) |
| P1-05 | P1-03 | New collections added |
| P1-06 | P1-04 | Clock with reference date added |
| P1-07 | P1-11 | Plus AI service skeleton and local admin seed |
| P1-08, P1-09 | P1-12, P1-13 | Activity events added to wrapper |
| P1-10, P1-11 | P2-07, P2-08 | Moved to Phase 2 (need readers); CRM + BahiKhata only on laptop |
| P1-12 | P1-05 | Reused by views generator |
| P2-01, P2-02, P2-03 adapters | removed; replaced by P2-01 | -6.0 (readers and entity specs only, +3.0 via N5) |
| P2-04 Samadhan reader | P5-07 | Moved to VPS stage |
| P2-05..P2-14 | P2-09..P2-18 | Sync over direct reads; communication events, ticket text, retrieval built on fixtures |
| P2-15 contract harness | removed | -1.0 (replaced by entity-spec tests and view drift check) |
| P2-16 Resend pull | P2-20 | Optional, unchanged |
| P3-01..P3-17 | P3-01..P3-17 | Same IDs; dependencies updated; support and Samadhan items marked synthetic or VPS |
| P4-01..P4-13 | P4-01..P4-13 | P4-07 narrowed to production hardening; P4-09 reduced by 1.0 |
| P5-01..P5-10 | P5-01..P5-05, P5-09..P5-13 | P5-05 now production source access; mapped as listed |
| N1 | P1-06 | New |
| N2 | P1-07 | New |
| N3 | P1-08 | New |
| N4 | P1-09 | New |
| N5 | P2-01 | New |
| N6 | P2-02 | New |
| N7 | P2-03 and P2-04 | New; split 4.5 / 1.5 |
| N8 | P2-05 | New |
| N9 | P1-10 | New |
| N10 | P2-06 | New |
| N11 | P5-08 | New (VPS stage) |
| N12 | P2-19 | New (optional) |

**Effort reconciliation:** 113 - 2.0 (masking) - 6.0 (adapters) - 1.0 (contract harness) - 1.0 (P4-09 reduction) + 22.0 (N1-N10) + 1.5 (N11) = **126.5 days**. Moved tasks (v1 P1-04 and P2-04, 3.0 days) are counted in Phase 5.
