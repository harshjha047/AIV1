# PRD v4: Internal AI Assistant for FAB5 Systems

**Status:** Draft v4 (supersedes PRD_v3.md; folds in DESIGN_UPDATE_v2)
**Basis:** `SYSTEMS_ANALYSIS.md` (code review of the existing repositories, 1 Oct 2026) and DESIGN_UPDATE_v2
**Stack for all NEW code:** JavaScript only (Node.js, Express, MongoDB, Next.js, Tailwind CSS). No TypeScript in new code.
**Delivery order:** Gate 0, then Phases 1-4 on the developer laptop (CRM and BahiKhata practice data only), then Phase 5 on the Windows VPS (all sources)
**Companion documents:** TRD v2, BACKEND_SCHEMA v2, IMPLEMENTATION_PLAN v2

---

## 0. What Changed from v3

| Area | v3 | v4 |
|---|---|---|
| How data is read | Federated snapshot: new export endpoints added inside CRM, Invoicing, BahiKhata | **Direct read-only database access** by the AI service. Nothing is added to the apps for reading data |
| Hiding sensitive fields | Adapter code in each service | **Database-level views** (inclusion-only allow-lists). The AI database user can read only those views |
| Per-source control | None | **Source Gate** and a dashboard **switch per source** (active, paused, disabled), with required reason and audit |
| Missing sources | Assumed all present | **Graceful degradation**: features that need a missing source say so instead of showing zero |
| Laptop scope | All sources, masked copies, masking script | **CRM + BahiKhata only** (practice data, about 2 months old). Other sources are built on synthetic fixtures and validated on the VPS. Masking script removed |
| Dashboard | LLM monitoring only | **Hub** with Overview, Sources, Data inventory, Activity, LLM monitor, Mappings, available from the first weeks on the laptop |
| Time model | Real "today" | **Practice mode** with a reference date, so old data still yields current-looking answers |
| Effort | 113 developer-days | about **127 developer-days** (see IMPLEMENTATION_PLAN v2) |

Unchanged: KPI definitions (Section 4), identity mapping, the separate `ai_snapshot` database, local models, validator, two-model pipeline, LLM dashboard panels, Gate 0, email handling, SEO scoping.

---

## 1. Summary

An AI assistant that runs on local models (no third-party inference APIs) and is embedded in our existing applications. Employees and managers get prepared, number-accurate summaries of **their KPIs by role**, customer and billing overviews, and ticket-based suggestions. Most answers are prepared overnight from a snapshot copied out of our databases, so daytime answers are instant lookups. Live questions use the local models asynchronously.

The AI reads the source databases **directly, read-only, and only through database views** that expose an allow-list of fields. A **Source Gate** is the single code path that may touch a source database, and an admin can switch any source off from the dashboard. A **hub dashboard** shows which data exists, what the system is doing, and local-LLM usage and health.

## 2. Goals and Non-Goals

### Goals
1. Every employee sees role-appropriate KPI summaries (sales, collections, support) each morning, served in under 500 ms.
2. All inference runs locally; Ollama bound to 127.0.0.1; no external inference calls.
3. All numbers are computed by code; the LLM only phrases and comments.
4. Sensitive fields (Aadhaar, PAN, passwords, tokens, OTPs) never enter the AI layer, enforced by inclusion-only database views and an automated scan.
5. The AI reuses existing infrastructure (Redis, BullMQ, PM2, Nginx, the existing databases) instead of adding parallel systems, and adds no code to the apps for reading data.
6. An admin dashboard for local LLM usage, speed, queue health, cache effectiveness, and system load.
7. Build and validate on a laptop first, then deploy to the VPS without redesign.
8. **Read-only by construction:** the AI database users hold `find` (or `SELECT`) on views only, and the system verifies this daily without attempting writes.
9. **Per-source switch:** an admin can pause or disable reading from any source within seconds, with proof on the dashboard.
10. **Visibility from the first weeks:** on the laptop, the hub shows what data exists (counts, date ranges, quality flags) and what is happening (reads, syncs, KPI runs, LLM calls).

### Non-Goals
- No autonomous actions: the AI never writes to production data, sends emails, or issues refunds/invoices.
- The AI never receives database administrator credentials; view and role scripts are run by a human DB admin.
- No real-time analytics; up to 24 h staleness is accepted for snapshot data.
- No browser-side (client-side) LLM inference in v1. Client-side work is limited to UI concerns (caching, debouncing, skeletons, lazy loading).
- No ingestion of BharatRadius, ehastakshar, or Desk data in v1.
- No fine-tuning, no GPU features, no speculative decoding, no Atlas dependency in v1.
- No ranking guarantees for SEO.
- The source switch is not a security boundary against other holders of the same database credentials (Section 5.5).

## 3. Users, Roles, and Access

The apps use different role vocabularies. The AI service maps them to four AI roles via the canonical `employees` collection.

| AI role | Source roles (examples) | Can see |
|---|---|---|
| **Employee** | CRM `employee`, BahiKhata `employee`, Samadhan `SALES` / `SUPPORT_AGENT` | Own KPIs, own customers, own tickets |
| **Manager** | CRM `project_manager` / `order_generation` (to be confirmed) | Team KPIs, team customers |
| **Admin** | CRM `admin`, Invoicing `Admin`, BahiKhata `admin`, Samadhan `ADMIN` | All operational data, hub (including source switches) |
| **Owner** | CRM `owner` | Everything, including cross-role comparisons, LLM dashboard, source switches |

Rules: `employeeId` always comes from the authenticated session (via the calling app), never from question text. RBAC is enforced in code and query filters, never in the prompt. Source switches, inventory, activity, and mappings are admin/owner only. On the laptop the hub uses a single local admin login.

## 4. KPI Definitions by Role (v1 defaults, unchanged from v3)

An employee can hold more than one KPI profile (for example sales and collections). Profiles live in an admin-managed `employee_kpi_profiles` mapping, because roles in the apps do not reliably say which KPIs apply.

### 4.1 Sales: Mbps against target
| Item | Definition |
|---|---|
| Source | CRM `SalesTarget` (monthly `targetMbps` per employee), `Connection` (+ `history[]`), `ServiceRequest` |
| Achieved Mbps | Sum of bandwidth (parsed from the free-text `bandwidth`, Gbps converted to Mbps) for connections with an `ACTIVATED` history event in the month, plus upgrade deltas |
| Attainment | achieved / target. If no target is set, report "no target set" (never divide by zero) |
| Attribution (default) | `Connection.createdBy`. Alternative: `customer.managedBy`. **Needs your decision** |
| Shown separately (not netted) | Downgrade and termination Mbps ("lost Mbps"), so attainment is not distorted; an admin switch can net them |
| Supporting | MRC added, margin (MRC minus provider MRC), activation count, average provisioning days (CREATED to ACTIVATED), open pipeline requests, disconnection requests |
| Requires | CRM |
| Reuse | Mirror `computeCrmSnapshot()` math (bandwidth parsing, margin, turnaround) |

### 4.2 Collections
| Item | Definition |
|---|---|
| Source | BahiKhata `Ledger` (approved entries), `Customer.manager` |
| Collected | Sum of `credit` in the period for customers managed by the employee |
| Billed | Sum of `debit` in the period for the same customers |
| Efficiency | collected / billed (the reports module already computes this) |
| Outstanding and aging | `balanceDue` buckets: current, 30+, 60+, 90+; available advance |
| Growth | Period-over-period change in collected. History before 1 Jul 2026 comes from the hard-coded legacy array, which Phase 2 loads into a real `legacy_collections` collection (owned by the BahiKhata switch) |
| Targets | No collections target exists in the code. v1 compares against the employee's own history; targets can be added later |
| Requires | BahiKhata (and its legacy history); CRM optional (customer names, managers) |
| Caveat | Invoicing and BahiKhata both track outstanding; one must be declared authoritative (Open Question 8). On the laptop BahiKhata is the authority |

### 4.3 Support: tickets resolved
| Item | Definition |
|---|---|
| Source | Samadhan (PostgreSQL) `tickets`, `ticket_events`, `issue_categories` |
| Resolved | Tickets with `resolved_at` in the period |
| Attribution (default) | The actor of the `STATUS_CHANGED` to `RESOLVED` event; fallback to `current_assigned_employee_id` |
| Supporting | MTTR (created to resolved), open backlog, escalations, reopened count, average customer rating, tickets by category, repeat-issue rate |
| Requires | Samadhan; CRM optional |
| Reuse | Mirror `metric.service.ts` MTTR/repeat logic |
| Caveat | SLA thresholds were not found in the code reviewed; SLA-breach metrics wait until they are confirmed |

### 4.4 Manager and owner rollups
Team totals and per-person comparisons for each profile above, customer-level summaries (connections, MRC, margin, outstanding, open tickets, last reminder), and top/bottom movers.

## 5. Data Sources and Ingestion

### 5.1 Source matrix

| Source | Engine | What we take | Read method (v4) |
|---|---|---|---|
| CRM | MongoDB | customers, connections + history, service requests, sales targets, users (allow-listed) | Direct read-only access to `ai_*_v` views |
| BahiKhata | MongoDB | ledger, customers, users; legacy growth array (one-time script reading the source file) | Direct read-only access to views; script for legacy data |
| Invoicing | MongoDB | invoices (financials, payment status, reminders), credit notes, EmailLog (events) | Direct read-only access to views (VPS stage) |
| Samadhan | PostgreSQL | tickets, ticket events, categories, employees | Read-only role `ai_ro` on `ai_export` views (VPS stage) |
| Mailing microservice + Resend | external | see 5.2 | Events from logs; optional Resend pull |
| SOPs / policies | not found | none in the repositories | Source pending (Open Question 6) |
| BharatRadius, ehastakshar, Desk, Accounting_application | n/a | out of scope for v1 | Revisit after source/schema access |

**Why direct read-only access (replaces the v3 federated endpoints):** it adds nothing to the production apps, removes the per-service adapter and contract-test work, and keeps field hiding in the database where the AI user cannot bypass it. Trade-offs: the AI is coupled to source schemas through the view definitions (mitigated by a generator that checks every field against a sample document, plus a daily drift check), and a database credential now exists per source (mitigated by views-only roles, daily read-only verification, and the Source Gate).

### 5.2 Email (Resend): findings and handling

**What the code shows**
- Every service sends mail through a **separate mailing microservice** (hosted on Render; not in the reviewed repos) that calls Resend. The CRM hard-codes the service URL; the others use environment variables.
- All emails are **outbound, system-generated from templates**: invoices, credit notes, payment reminders (1st, 2nd, suspension notice), connection notices (CRM), ticket lifecycle notices and RCA (Samadhan), staff/customer welcome messages, password-reset OTPs.
- No inbound email handling or email webhooks exist in the code. These are not customer conversations.
- The apps keep their own logs: Invoicing `EmailLog` (document type, email type, recipients, subject, status, sent time, provider message ID) and Samadhan `automated_email_logs` (ticket, type, time).

**What Resend can provide:** the API lists sent emails as references and returns the HTML and plain text of a single email by ID. **Retention is plan-limited**: sources disagree (from 1 to 30 days depending on plan and date), so older bodies may already be gone. Check your plan and dashboard.

**Decisions**
1. **Treat emails as communication events**, not as a semantic-search corpus. Source of truth for history: Invoicing `EmailLog` and Samadhan logs, joined to invoices, tickets, and customers.
2. **Do not embed boilerplate** (invoice and reminder text). Only genuinely free text (staff ticket updates, RCA) is searchable, and that already lives in tickets and ticket events.
3. **Never ingest** welcome emails (Samadhan templates include a password), password-reset/OTP emails, or any email containing credentials. Filter by type in the view and again in the sync engine; scrub as a third layer.
4. **Optional Resend pull:** if bodies are needed, a nightly job pages through List Sent Emails, filters by allowed types, retrieves each body, strips HTML/boilerplate, and stores plain text. It must throttle requests and respect API limits. It only captures what Resend still retains. This is the only outbound call in the AI layer and is disabled by default.
5. Bodies can also be **regenerated** from templates plus the source record.

### 5.3 Identity resolution
- `employees`: canonical employee keyed by email, with IDs in CRM, Invoicing, BahiKhata, Samadhan. Replaces the hard-coded name/email lists in source code.
- `customers`: canonical customer with CRM `_id`, BahiKhata `crmId`/`_id`, Invoicing `crmCustomerId`, Samadhan customer ID. Samadhan links by **name**, so Phase 2 produces a one-time reconciliation report (matched, ambiguous, unmatched) for manual review (CRM and BahiKhata on the laptop; Samadhan on the VPS).

### 5.4 Field rules (inclusion-only views)
Each source database gets views that **name the allowed fields** (inclusion `$project` in MongoDB; explicit column lists in PostgreSQL). A field added to an app later does not appear in a view until someone adds it.
- **Never exposed:** passwords and hashes, refresh/reset tokens, OTPs, session tokens, Aadhaar, PAN, certificate material, push tokens, IP/user-agent data, identity-document URLs, API keys.
- **Minimise or mask inside the view:** customer email and mobile (not exposed), GST numbers (not exposed), bank names and UTR references (not exposed), circuit coordinates and addresses (not exposed), free text truncated to a snippet, recipient addresses reduced to a count and domains.
- A generator (`npm run views:generate`) writes the view and role scripts from the allow-lists, checks that each field exists in a sample document, and refuses scripts that name deny-listed fields.
- The laptop restores the practice databases locally and creates the **same views**, so the laptop exercises the production code path.

### 5.5 Source control: states, switch, and guarantees

**States**

| State | Meaning | Reads | Existing copied data |
|---|---|---|---|
| `not_configured` | No credentials yet (for example Samadhan on the laptop) | none | none |
| `active` | Normal | allowed (verified read-only) | used |
| `paused` | Temporarily stopped | **blocked** | still used, labeled "stale since <date>" |
| `disabled` | Turned off | **blocked** | excluded from KPIs and answers (kept on disk) under policy `hide`; used and labeled stale under `keep` |
| `disabled + purged` | Turned off and erased | **blocked** | deleted from `ai_snapshot` |

**Behavior on a switch**
- The change is saved with who, when, and a required reason, and written to `admin_audit`.
- Within seconds: connection pools closed, credentials wiped from memory, running jobs aborted, scheduled jobs paused.
- Dependent KPIs and prepared answers switch to "not available" (Section 5.6).
- The Sources page shows proof: "Reads since switch: 0", "Blocked attempts: N", "Pool: closed".
- Re-enabling requires confirmation, re-runs the connection test and read-only verification, then resumes from the saved cursor.
- **Purge** deletes that source's facts, text chunks, embeddings, and any prepared answers that used it, clears its mapping references, and requires a typed confirmation.
- Legacy collections data (loaded from BahiKhata's code) belongs to the BahiKhata switch.
- Default policy on disable is `hide` (Open Question 14).

**Guarantees and limits**
1. The switch stops **this application** from reading. It cannot stop someone else who holds the same database credentials.
2. Data **already copied** stays in `ai_snapshot` unless you choose purge.
3. For a hard guarantee, also cut access **at the database**. The dashboard shows a ready-to-copy command for the DB admin (the AI never holds admin rights):
   - MongoDB: `db.getSiblingDB('<db>').revokeRolesFromUser('ai_ro', ['ai_reader'])` (restore with `grantRolesToUser`)
   - PostgreSQL: `ALTER ROLE ai_ro NOLOGIN;` then terminate its sessions (restore with `LOGIN`)
4. Access to the switch is limited to admin/owner, protected against cross-site requests, rate limited, and audited.

### 5.6 Graceful degradation
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
- A missing **required** source returns "Not available: <source> is <disabled/paused/not configured>", never zero. A paused source that already has copied data serves that data labeled stale; the "not available" message applies when no usable copied data exists.
- A missing **optional** source gives a partial answer that lists what is missing.
- Prepared answers store `usedSources[]` and `missingSources[]`; the nightly job skips features whose required sources are inactive.
- A paused source's data is shown as stale with its last-read date.

### 5.7 Practice mode and synthetic fixtures (laptop)
- `MODE=practice` with a **reference date** (default: the latest activity date found in the active sources, overridable). "Today", "this month", "last week" and freshness checks resolve against it.
- A banner on every page: "PRACTICE MODE: reference date <date>, data from <min> to <max>".
- The nightly schedule is replaced by a **Run now** button.
- **Reconciliation on the laptop:** the apps' own report logic (BahiKhata reports, CRM dashboards) runs on the same practice data and is compared with the AI's KPIs.
- **Synthetic fixtures (optional):** a generator creates clearly labeled sources (`samadhan_synthetic`: about 200 tickets with events in the Samadhan shape; invoice and email fixtures for Invoicing), each with its own switch and a `synthetic` badge. They exercise chunking, embedding, search, the support KPI, and communication events. They are purged before the VPS stage and never mixed with real data of the same logical source.
- Recall@5 and support-KPI reconciliation numbers from synthetic data are **not** accepted as real results.

## 6. Architecture

```
 [ CRM (Vite) ] [ BahiKhata (Next) ] [ Samadhan (Next) ] [ Invoicing (Vite) ]
        |  each app's own login/JWT
 [ each app's backend ] --(app key + {email})--> BFF call
                                                       |
                          [ AI Service (Express, JS) - PM2 process ]
                            |- RBAC via employees
                            |- prepared_answers lookup (instant)
                            |- Redis cache, BullMQ queues (own prefix)
                            '- /admin/* (sources, inventory, activity, LLM metrics)
                                       |
                          [ AI Workers - PM2, separate processes ]
                            |- small-model queue, large-model queue
                            |- Ollama on 127.0.0.1 (two models + embeddings)
                            |- validator (code checks all numbers)
                            '- usage events -> Mongo

 Source access (only code allowed to hold source DB drivers):
   [ Source Registry (data_sources) ] -> [ SOURCE GATE ] -> read-only, views only
        ^ hub toggle                          |-> CRM MongoDB      (ai_reader role)
                                              |-> BahiKhata MongoDB
                                              |-> Invoicing MongoDB   (VPS stage)
                                              '-> Samadhan PostgreSQL (VPS stage, ai_export views)
                                                  writes only to its own database: ai_snapshot

 Nightly 04:00 sync (PM2/cron; "Run now" in practice mode):
   entity specs read views through the gate -> ai_snapshot: employees, customers,
   facts, embeddings, legacy_collections, communication_events, prepared_answers, ...
```

Design decisions:
- **BFF pattern:** each app authenticates its own user, then calls the AI service with an app key and the acting user's email. The AI service never handles app passwords or JWTs.
- **Source Gate:** the single module that may import `mongodb` or `pg` for source access. Every read checks the source state first.
- **One shared AI panel** (embeddable React component) plus a separate **hub** (Next.js) for administration. The panel style-isolates itself because the apps differ (Tailwind 3 vs 4; Vite vs Next).
- In-memory cosine search (Float32Array, normalized vectors) over embedded ticket text, fused with keyword search by Reciprocal Rank Fusion.
- Models are never called from request handlers. Handlers return a prepared answer or enqueue a job.
- `num_ctx` is set explicitly so prompts are never silently truncated.

## 7. Functional Requirements

**FR1. Nightly direct snapshot (04:00).** Incremental reads through the Source Gate (`updatedAt|_id` cursor and content hash), build-then-swap for rebuilds, `snapshot_runs` logging, separate from normal `mongodump`/`pg_dump` backups. Each source records its own success, failure, or skipped state (`disabled`, `paused`, `not_configured`), so one failing or switched-off source does not block the others.

**FR2. KPI engine.** Code-computed KPIs per role (Section 4), stored with prepared answers so the UI shows real numbers and the LLM only phrases them.

**FR3. Intents and prepared answers.** Intent = name, examples, parameter schema, `allowedRoles`, `requiresSources`, `optionalSources`. Launch intents: my monthly KPI (by profile), my team's KPIs, customer summary, outstanding and aging overview, ticket backlog, churn/pipeline watch-list. Nightly per user: compute, hash, skip unchanged, template the facts, add 1-2 LLM sentences (`num_predict` 80-120). Each answer is stamped "as of 04:00, [date]" (reference date in practice mode) and keyed by `snapshotVersion`.

**FR4. Question handling.** Embed the question, match to intents by similarity threshold, serve the prepared answer, otherwise enqueue a live job with a skeleton/streaming UI. Log every question.

**FR5. Learning from usage.** Count intents by user and weekday and precompute ahead of need; cluster unmatched questions into candidate intents for admin review.

**FR6. Two-model pipeline.** Night: small model drafts, code validates every number, large model reviews only on failure/ambiguity, numbers-only fallback if still failing. Day: prepared answer, then small model for simple questions, large model for complex; if the large model's wait exceeds about 20 s, answer with the small model ("quick answer") and enqueue a large-model refinement with identical code-computed numbers. One queue per model, concurrency 1 each, abort on client disconnect.

**FR7. Access control.** Section 3 rules, plus per-intent `allowedRoles`, per-user prepared answers, read-only credentials per source, and treating any free text (tickets, emails) as untrusted input (prompt injection).

**FR8. Ticket assistance.** For a new or open ticket, retrieve similar past tickets (problem text to RCA/resolution), with a similarity threshold and a "no confident match, escalate" path. Suggestions are drafts for a human; nothing is sent automatically. Note: 1,100+ tickets is a modest corpus, so many tickets will have no close match.

**FR9. Communication events.** Reminder, invoice, credit-note, and ticket-notice history per customer (from Invoicing `EmailLog` and Samadhan logs), available to customer summaries and watch-lists; optional Resend body pull per Section 5.2.

**FR10. LLM usage monitoring dashboard** (admin/owner only, hub page `/admin/llm`, `noindex`).

| Panel | Metrics |
|---|---|
| Overview | Requests today/7d/30d, success/timeout/error rate, active jobs, queue depth per model |
| Speed | Decode and prompt-eval tokens/sec per model, time-to-first-token, p50/p95 latency, queue wait |
| Volume | Tokens in/out per model, route (night draft, review, live ask, refine), user, intent |
| Cache | Prepared-answer hit rate, skipped-unchanged drafts, unmatched-question rate |
| Quality | Validator pass/fail, reviewer rewrites, numbers-only fallbacks, thumbs up/down by intent |
| Routing | Small vs. large share, quick-answer + refine count |
| Nightly job | Per-source status (including skipped), duration, records processed, drafts generated vs. skipped, failures |
| System | CPU, RAM, Ollama memory, event-loop lag, loaded models, latency of existing services during AI activity |
| Alerts | Nightly job late/failed, queue wait over threshold, cold model loads, error spikes, read-only verification failures |

Data source: one `llm_usage_events` record per Ollama call (Ollama's returned durations and token counts, plus model, route, user, intent, queue wait, outcome) and system samples every 30 s. Metadata and counts only by default; prompt/answer text only if enabled for debugging with a short TTL. Raw events kept 90 days; daily rollups kept longer. Polling every 5-10 s, CSV export.

**FR11. Source control.** A registry of sources with states (Section 5.5); a Source Gate that blocks every read unless the source is `active`; per-source switch with required reason and audit; read-only verification on add, on re-enable, and daily; data policy on disable (`keep`, `hide`, `purge`); purge with typed confirmation; ready-to-copy DB-level disable and enable commands; proof counters (reads since switch, blocked attempts, pool status).

**FR12. Data inventory and activity.** Per source and entity: rows in source, rows synced, date range, last updated, quality flags, records-per-month, mapping coverage, and a KPI readiness matrix (employee by profile by month: ready, no target, no activity, source off). A live Activity timeline of reads, syncs, KPI computations, drafts, validations, LLM calls, switch changes, and alerts, with filters and a running-jobs panel. Inventory counts are cached and time-limited so the dashboard never causes heavy source queries.

**FR13. Graceful degradation.** Requirements matrix (Section 5.6) enforced at compute time, nightly scheduling, and serving time; "Not available" cards and partial answers with explicit missing-source lists; stale labels for paused sources.

**FR14. Practice mode and synthetic fixtures.** Reference-date clock, banners, Run-now, optional labeled synthetic sources with their own switches, and a rule that real and synthetic data of the same logical source are never active together.

## 8. Performance and Web Requirements (re-scoped to reality)

Status legend: **Done** = already present in reviewed code (verify only), **Build** = work required, **Verify** = cannot be confirmed from the repositories.

| ID | Requirement | Applies to | Current state | Work |
|---|---|---|---|---|
| P-01 | Cache API responses | AI service, apps | Redis exists in CRM, Invoicing, Samadhan | **Build** for AI endpoints (`Cache-Control`/`ETag`, client cache); never cache per-user data in shared caches |
| P-02 | Lazy loading | AI panel, hub | n/a | **Build** (`next/dynamic`, lazy charts/images) |
| P-03 | Skeleton loading | AI panel, hub | n/a | **Build** |
| P-04 | CDN | Static assets | CRM and Invoicing frontends have `vercel.json` (Vercel CDN) | **Verify** per app; **Build** for VPS-hosted assets only; never route authenticated/AI data through a CDN |
| P-05 | Minify JS/CSS | All | Vite/Next production builds minify | **Verify** (bundle budgets in CI); purge unused Tailwind |
| P-06 | Index the database | All Mongo apps | CRM, BahiKhata reasonably indexed; **Invoicing missing indexes** on invoice dates, `status`, `invoiceNumber`; a unique fingerprint index is commented out | **Build**: indexes for new snapshot/AI collections; `explain()` on view queries shows no COLLSCAN on hot paths; for source databases the AI cannot create indexes (read-only), so recommended indexes (including Invoicing's) are delivered as a DB-admin script |
| P-07 | Reduce re-renders | AI panel, hub | n/a | **Build** (profile, then memoize where measured) |
| P-08 | Debounce input handlers | Ask box, search | CRM has a `useDebounce` convention | **Build** (about 300 ms + `AbortController`) |
| P-09 | Remove unused dependencies | All | Candidates: the deprecated `crypto` npm package is listed in CRM and Invoicing; `bcrypt` and `bcryptjs` both in CRM | **Build** (`depcheck`, bundle analyzer) |
| P-10 | Load balancer | APIs on the VPS | Single server | **Build** as Nginx upstream + PM2 cluster mode. Do **not** load-balance the LLM. A true external LB only if a second server appears |
| P-11 | Defer non-critical scripts | Web apps | n/a | **Build** (`next/script` strategies) |
| P-12 | Connection pooling | Mongo apps | `maxPoolSize`/`minPoolSize` set in CRM, Invoicing, BahiKhata | **Done** in apps; **Build** small pools inside the Source Gate (max 2 per Mongo source, max 3 for `pg`), closed when a source leaves `active` |
| P-13 | Remove N+1 queries | All | CRM snapshot loads all records and filters in memory per customer | **Build**: paged incremental reads with compound cursors; grouped aggregations in `ai_snapshot`; query-count tests |
| P-14 | Server-side caching | AI service | Redis available | **Build**: cache KPI aggregations keyed by snapshot version |
| P-15 | Core Web Vitals | Web apps | Not measured | **Build**: LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1 (75th percentile); Lighthouse CI in lab, real-user data after launch |
| P-16 | Mobile responsiveness | AI panel, hub | n/a | **Build** (mobile-first; test at 360/390/768/1024/1440 px) |
| P-17 | Enforce HTTPS | All | Helmet in use; hosting unknown | **Verify** at Nginx/Vercel; HSTS after verification; secure cookies |

## 9. SEO Requirements (conditional, unchanged)

None of the reviewed repositories is a public marketing site, and all apps are authenticated. Therefore:
- **Internal apps, the AI service, and the hub stay `noindex`, disallowed in `robots.txt`, and out of any sitemap**, with an automated test that fails the build if that changes. (BahiKhata already ships `robots.js` referencing a sitemap that does not exist yet.)
- The full checklist below is **parked** until the public site is identified (Open Question 4), then executed in Phase 4/5 against that site.

| ID | Requirement | Acceptance check |
|---|---|---|
| S-01 | Sitemap | Generated from public routes only; submitted in Search Console |
| S-02 | robots | Allows public paths, blocks app/API paths, references the sitemap |
| S-03 | Remove accidental noindex | Crawl shows no stray `noindex` on public pages |
| S-04 | Unique title and meta description | About 50-60 and 140-160 characters per page |
| S-05 | One H1 per page | Automated test |
| S-06 | Correct heading hierarchy | No skipped levels |
| S-07 | SEO-friendly image file names | Descriptive, hyphenated names (you rename the files; the plan supplies the list) |
| S-08 | Alt text | All content images; decorative images use empty alt |
| S-09 | Schema markup (JSON-LD) | Organization, WebSite, plus Service/FAQ/Article where honest; validated |
| S-10 | Internal links | Key pages within 3 clicks; descriptive anchors |
| S-11 | No broken links | Link checker in CI and before launch; 301s for moved URLs |
| S-12 | Clean slugs | Lowercase, hyphenated, no IDs or queries |
| S-13 | og:image and social tags | 1200x630; validated with a sharing debugger |
| S-14 | Search Console verification | DNS domain property verified; sitemap submitted |
| S-15 | Backlink strategy | Earned links only (directories, industry bodies, partners, case studies, trade press); tracked monthly; no paid link schemes |

## 10. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Privacy | Local models; Ollama on 127.0.0.1; the AI layer makes no external calls (the optional Resend pull is off by default). Samadhan already sends ticket text to Google Translate and mail to Resend; that is outside this project but affects any "no data leaves" claim |
| Prepared answer latency | Under 500 ms |
| Live small-model answer | About 30-60 s, async/streamed |
| Live large-model answer | About 60-120 s, async with status |
| Nightly job | Finishes before 06:00; a failed or switched-off source degrades gracefully |
| Production impact | AI limited to about 4 threads in daytime; no measurable regression in existing services, including source database load from reads |
| Source reads | Paged (default 500 rows), 30 s query timeout, rows-per-minute cap per source, off-peak production syncs, `secondaryPreferred` where a replica set exists |
| Switch latency | A state change blocks new reads in at most 5 s (cache TTL) and normally within 1 s (signal); in-flight reads are aborted |
| Read-only assurance | Verification passes for every active source daily; any write privilege or non-view resource fails the check and pauses the source |
| Dashboard load | Hub polling never queries source databases directly; inventory totals come from a cached, time-limited collector |
| Security | Inclusion-only views, scoped read-only credentials, timing-safe key checks, rate limiting, validation, no sensitive data in logs, secrets never shown in the hub |
| Reproducibility | Answers keyed by `snapshotVersion`; embedding model/version stored per record |

## 11. Five-Phase Plan

### Gate 0: Prerequisites (before Phase 1, not optional)
- Rotate the secrets exposed in the public BharatRadius repo (database credentials, JWT secret, email password); remove them from history; make repositories private.
- Decide email handling: check Resend plan retention; export anything needed now if still available.
- Confirm KPI attribution choices (Section 4) and the `employee_kpi_profiles` mapping.
- Inventory hosting, including network reachability from the VPS to each source database.
- Settle practice-data form (dump or remote), local MongoDB authentication, the production DB admin who will run view scripts, and the default on-disable policy.
- Obtain missing context: mailing microservice repo, Accounting_application, BharatRadius source (if in scope).

### Phase 1: Foundation and Source Control (Laptop)
- Repository layout for the AI service, workers, and Next.js hub/panel (JavaScript). `ai_snapshot` database, shared library, PII rules, auth layer.
- Restore CRM and BahiKhata practice databases locally; views generator and DB-admin scripts; create the same views and read-only user locally.
- Source registry, **Source Gate** with lint and test enforcement, credential handling, read-only verification, practice mode and reference date.
- Install Ollama; benchmark and pin models; usage-event wrapper around every Ollama call.
- **Exit:** gate enforced and tested; views and verification working on practice data; models pinned.

### Phase 2: Control Panel and Ingestion (Laptop)
- CRM and BahiKhata readers and entity specs (direct, incremental); inventory collector.
- Hub: Overview, Sources (switches), Data inventory (**Milestone L1**); Activity page, graceful degradation, purge (**Milestone L2**).
- Employee identity builder and customer reconciliation (CRM and BahiKhata); sync engine; `legacy_collections`; daily aging; PII scan after sync; index and query-count checks.
- Retrieval pipeline (communication events, ticket text, embeddings, hybrid search, evaluation harness) built against synthetic or hand-made fixtures.
- **Exit:** CRM and BahiKhata sync idempotently; PII scan clean; L1 and L2 accepted; retrieval pipeline tested on fixtures.

### Phase 3: KPI and AI Engine (Laptop)
- KPI aggregations for sales and collections on practice data, support on synthetic fixtures; intents with source requirements; prepared answers with skip-if-unchanged and templated facts; validator.
- Two-model night pipeline (skips features with inactive sources); BullMQ queues; day routing and quick-answer/refine; abort handling; question logging and weekday precompute.
- BFF endpoints with RBAC; Redis KPI cache; monitoring backend.
- **Exit:** end-to-end run works; validator catches seeded number errors; sales and collections KPIs reconcile with the apps' own report logic on the same practice data; intent accuracy meets target (proposed 90% or higher).

### Phase 4: Web App, LLM Monitor, Performance (Laptop)
- Shared AI panel integrated into the CRM and BahiKhata first, then Samadhan and Invoicing; skeletons, lazy loading, debounce, re-render fixes, script deferral, mobile layouts.
- Hub completion: token-exchange login for production, LLM monitor page, intents, unmatched questions, and mappings UI.
- Internal routes locked to `noindex` with an automated test. If the public site is identified: build the SEO items (S-01 to S-13).
- **Exit:** Lighthouse budgets pass for the panel and hub; dashboard shows data from simulated load; accessibility checks pass.

### Phase 5: VPS Deployment, All Sources, Hardening, Pilot
- Ollama as a Windows service; MongoDB cache cap; Redis; PM2; Nginx; HTTPS.
- **Production source access:** the DB admin runs the generated view and role scripts on each production database; the AI verifies read-only; synthetic sources are purged; Samadhan views and role, Samadhan reader, and Invoicing reader are added.
- First production backfill and re-embed; real recall@5, support-KPI and Samadhan customer reconciliation; decide the authoritative outstanding source; re-benchmark; guard tuning; runbooks.
- Pilot with 2-3 users for 1-2 weeks; then roll out.
- **Exit:** no measurable regression in existing services; nightly job on time; HTTPS verified; hub live on production data; pilot meets success metrics.

## 12. Laptop vs. VPS

| Capability | Laptop (CRM + BahiKhata, about 2 months old) | VPS (all sources) |
|---|---|---|
| Sales KPI (Mbps vs target) | Yes, for months that have targets in the practice data | Yes |
| Collections KPI | Yes. Growth uses the legacy history from BahiKhata's code plus the 2 months of ledger | Yes |
| Support KPI (tickets) | **No real data.** Built and tested on synthetic fixtures | Yes, validated on real tickets |
| Customer summary | Partial (CRM + BahiKhata); missing parts are labeled | Full |
| Outstanding and aging | BahiKhata is the authority on the laptop | Decide authority when Invoicing is added |
| Communication events (Invoicing emails) | No | Yes |
| Ticket similarity search and recall@5 | Pipeline built on synthetic tickets; **real evaluation on the VPS** | Yes |
| LLM benchmarks, validator, queues, dashboards | Yes (laptop speeds are not production targets) | Re-benchmark |
| Period-over-period growth | Month over month only where both months exist; weekly works; no seasonality | Meaningful history builds over time |

| Topic | Laptop (Phases 1-4) | VPS (Phase 5) |
|---|---|---|
| Purpose | Build, prompts, backfill, evaluation, lab performance tests | Production |
| Data | Practice databases restored locally, same views and read-only user | Real data via read-only credentials on views |
| Database-level read-only | Enforced only if local MongoDB runs with authentication; otherwise the hub shows "DB-level protection: not enforced (auth disabled)" | Required (activation refused if not enforced) |
| Time | Practice mode with reference date; Run-now instead of schedule | Real clock; 04:00 IST schedule |
| Threads | Free to use most cores | AI capped at about 4 daytime; 6-8 at night |
| Performance numbers | Not representative | Re-benchmark before fixing targets |
| Models/embeddings | Pin exact model and quantization | Must match, or re-embed |
| HTTPS / CDN / Search Console | Not testable | Configured and verified |

## 13. Success Metrics

- 80% or more of daily requests served from prepared answers in under 500 ms.
- Zero validator-detected number errors reaching users; KPI values match each app's own reports for sampled employees.
- Zero sensitive fields (Aadhaar, PAN, passwords, tokens, OTPs) found in `ai_snapshot` (automated scan).
- Nightly job completes before 06:00 on 95% or more of nights.
- No measurable latency regression in existing production services.
- Core Web Vitals (75th percentile) on the AI panel and hub: LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1.
- Zero indexable internal routes.
- Unmatched-question rate falls week over week.
- After any switch-off, **zero reads** of that source are logged and blocked attempts are visible; the effect is in place within 5 s.
- Read-only verification passes daily for 100% of active sources; no write privilege is ever detected.
- Inventory source counts for CRM and BahiKhata match direct counts taken by the DB admin on the same day.
- No KPI card ever shows zero where the real state is "source unavailable".

## 14. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Secrets and business data exposed in public repos | Gate 0: rotate, purge history, make repos private |
| PII or credentials leak into the AI layer (for example via welcome/OTP emails) | Inclusion-only views, email type filters in the view and sync engine, automated scan of `ai_snapshot` |
| Direct access widens the blast radius of a leaked AI database credential | Views-only role, daily read-only verification, credentials in memory only while active, DB-level disable commands, per-source credentials |
| Local MongoDB without authentication cannot enforce read-only | Source Gate still enforces the switch; hub shows "not enforced"; production activation requires enforced auth |
| App schema changes silently break or leak through views | Inclusion-only views (no leak on additions); generator `--check` drift run daily and in CI; entity-spec tests; quarantine on shape mismatch |
| Source databases lack indexes for incremental reads and the AI cannot create them | `explain()` checks; recommended index script for the DB admin; page size and rows-per-minute caps |
| Production database load from reads | Paged reads, 30 s timeouts, rate caps, off-peak schedule, `secondaryPreferred`, probe latency watched by the guard |
| Customer identity mismatches (Samadhan links by name) | One-time reconciliation with manual review; unmatched customers flagged, not guessed |
| KPI definitions disputed by staff | Definitions documented in the UI; numbers traceable to source records; admin-switchable attribution |
| Practice data is only 2 months old, limiting growth metrics and recall evidence | Practice mode reference date; synthetic data clearly labeled and never accepted as real results; real validation on the VPS |
| Synthetic data mistaken for real | `synthetic` badge, separate source IDs, `SYNTHETIC_SOURCE` data-quality flag, refusal to activate alongside real data, purge before VPS |
| Resend retention makes email history unrecoverable | Use app-side logs as source of truth; bodies are regenerable from templates |
| CPU contention hurts production | Thread caps, priority, affinity, off-hours batch, queues; move inference to a separate machine if metrics show harm |
| Slow CPU generation | Prepared answers, templating, skip-if-unchanged, small model for drafts |
| LLM arithmetic/factual errors | Code computes numbers; validator; numbers-only fallback |
| Five frontends with different toolchains | Style-isolated shared panel; integrate incrementally |
| Prompt injection via ticket/email text | Read-only credentials, no write tools, RBAC in code, human approval |
| Sensitive data in monitoring logs | Metadata only by default; text storage opt-in with short TTL |
| Internal pages indexed by search engines | `noindex` + robots + auth + automated test |
| Misuse of the source switch | admin/owner only, CSRF protection, rate limit, required reason, audit |

## 15. Open Questions

1. **Resend:** what plan are you on, and does the dashboard still show the older emails? Do you need email bodies searchable, or are delivery/reminder events enough (default in this PRD)?
2. **Mailing microservice:** can you share its repo (it is the real email path for all apps)?
3. **KPI attribution:** sales Mbps by `createdBy` or `customer.managedBy`? Should downgrades/terminations be netted? Do collections targets exist outside the code? Which employees hold which KPI profiles?
4. **Public website:** which site should rank, and where is its code?
5. **BharatRadius and Accounting_application:** in scope for v1? (Source/schema access needed.)
6. **SOPs and procurement policies:** where do these documents live?
7. **Hosting:** where do each service's APIs and databases run (Windows VPS, Vercel, Render, Atlas), and can the VPS reach each source database (network, TLS, IP allow-list)?
8. **Authoritative outstanding:** Invoicing or BahiKhata when they disagree? (BahiKhata is used on the laptop; decide when Invoicing is added.)
9. **Roles:** how do CRM `project_manager` and `order_generation` map to the AI Manager role?
10. **SLA thresholds** for support KPIs.
11. **Practice data:** are the CRM and BahiKhata copies dumps you restore into a local MongoDB, or remote databases you connect to? (Either works.)
12. **Local MongoDB authentication:** is it enabled? Without it, database-level read-only cannot be enforced on the laptop (the switch still works and the hub says so).
13. **Production DB admin:** who runs the view and role scripts on each production database? (The AI never receives admin credentials.)
14. **Default on disable:** `hide` (keep data on disk but excluded) is proposed; say if you prefer `keep (stale)` or `purge` as the default.

## 16. Document Roadmap

| Order | Document | Contents |
|---|---|---|
| 1 | PRD v4 (this document) | What and why, KPIs, sources, source control, phases |
| 2 | TRD v2 | Source Gate, registry, credentials, read-only verification, views, entity specs, sync, degradation, practice mode, internal auth, BFF flow, queue/routing logic, caching, Ollama/PM2/Nginx configuration, hub architecture, test strategy |
| 3 | BACKEND_SCHEMA v2 | `ai_snapshot` collections (including `data_sources`, `source_credentials`, `source_access_log`, `source_inventory`, `kpi_readiness`, `activity_events`), fields, indexes, TTLs, view and role scripts, examples |
| 4 | IMPLEMENTATION_PLAN v2 | Task-level breakdown per phase, dependencies, milestones (L1, L2, M0-M7), definition of done, per-requirement verification checklist |

DESIGN_UPDATE_v2 is fully absorbed by these four documents and can be archived.
