# BCC Rentals Admin — Execution Plan

Session-resumable build plan for the rentals **admin app**. The authoritative
requirements live in [ADMIN_APP_SPEC.md](./ADMIN_APP_SPEC.md); this file tracks
**how** we build it, in what order, who does each task, and what is done.

**Read [CLAUDE.md](../CLAUDE.md) first** — it holds the non-negotiable conventions
(integer cents, Eastern minutes-since-midnight, race-safe advisory-lock writes,
shared production DB) that every task below assumes.

---

## How to use this file across sessions

1. On session start: read this file top-to-bottom, then jump to the first phase
   whose status is not `DONE`.
2. Each task has an ID (e.g. `P1.2`), an **owner** (which agent, or `main`), a
   **status**, and **depends-on**. Only start a task when its dependencies are `DONE`.
3. Update the **Status** column as you go: `TODO → IN PROGRESS → DONE` (or `BLOCKED`
   with a note). Keep the **Progress log** at the bottom current — one dated line per
   meaningful change.
4. Prefer delegating to agents (standing preference). The **owner** column is the
   recommended agent; `main` = do it in the primary session (decisions, wiring,
   verification against the shared DB).
5. **Never** let an agent run DDL against the shared Neon DB or deploy without
   explicit human go-ahead. See **Safety rails** below.

Status legend: `TODO` · `IN PROGRESS` · `DONE` · `BLOCKED` · `N/A`

---

## Current state (as of 2026-07-20)

- Repo contains only `docs/`, `.claude/` (settings + 4 custom agents), `.devcontainer/`,
  `.env.local`, `.env.local.example`. No app code, no `package.json`, no git repo.
- `.env.local` / `.env.local.example` are **inherited from the storefront** (PayPal,
  Resend, Upstash, Neon) and must be reshaped to the admin var set (§11).
- [DEPLOY_CLOUD_RUN.md](./DEPLOY_CLOUD_RUN.md) is the **storefront's** runbook (PayPal
  build args, storefront domain). It must be adapted for the admin app (Firebase build
  vars, `admin.bachmancc.org`, no PayPal) — tracked as `P8.1`.
- Toolchain: Node v22.16, npm 10.9. Target: Next.js (App Router) + TypeScript, `pg`.

---

## Blocking open questions (resolve before the dependent phase)

These gate specific phases. Surface them to the human; do not guess.

| # | Question | Blocks | Default if unanswered |
|---|---|---|---|
| Q1 | ✅ **ANSWERED.** Storefront repo **address will be provided** by the human. Strategy: do **not** duplicate — extract functions common to storefront + admin into a **shared/common area** and consume it from both (see P9). Copy verbatim in the interim if consolidation lags. | P2, P5, P6 (quality) | Awaiting repo address; until then use spec pseudocode and mark for consolidation. |
| Q2 | **Firebase / Identity Platform project details**: project id, Web SDK config keys, and which social providers to enable (Google/GitHub/Facebook/Apple). Each needs its own OAuth app. | P4 | Cannot complete auth; stub a dev-only bypass gated behind `NODE_ENV !== 'production'` so other phases proceed. |
| Q3 | **First admin's Firebase UID** for the bootstrap insert (§5). Requires that person to sign in once. | P4.4 | Defer; leave a documented one-liner to run later. |
| Q4 | **GCP project id + confirm domain** `admin.bachmancc.org` and DNS control. | P8 | Deploy phase stays BLOCKED. |
| Q5 | **Confirm targeting the same Neon DB, dev branch first.** `DATABASE_URL_DEV` in `.env.local` — is it safe to apply DDL there? | P1.4 (apply) | Write `schema.sql` as a file only; do **not** apply until confirmed. |

---

## Safety rails (non-negotiable)

- The admin app is a **second writer to the storefront's production tables.** Every
  reservation write MUST use the per-item advisory-lock + capacity-recheck pattern in
  spec §8, inside one transaction, locks acquired in stable slug order.
- **No agent runs DDL against the shared DB or deploys** without explicit human
  approval in-session. Agents may *write* `schema.sql` and the apply script; a human
  (or `main` with go-ahead) *runs* it, against the **dev branch** first.
- All new schema is idempotent (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
- Money = integer cents. Time = minutes since local midnight, `America/New_York`.
  Reservation instants = `timestamptz`. No floats, no stored UTC offsets.
- `.env.local` holds **live production secrets** — never commit it, never echo its
  contents into logs, PRs, or agent prompts.

---

## Phases

### P0 — Repo & tooling foundation
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P0.1 | `git init`, add `.gitignore` (node, `.env*`, `.next`, `node_modules`), initial commit. Enables branch-isolated agents. | main | — | DONE |
| P0.2 | Scaffold Next.js (App Router) + TypeScript; `next.config.ts` with `output: 'standalone'`; ESLint/TS strict. | code-writer | P0.1 | IN PROGRESS |
| P0.3 | Add `Dockerfile` + `.dockerignore` for standalone build (adapt storefront's; no PayPal). | code-writer | P0.2 | IN PROGRESS |

### P1 — Data layer & config
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P1.1 | `lib/db.ts`: `pg` `Pool` (`getPool()`) + `withTransaction()` (mirror storefront `lib/scheduler/db.ts`). `import "server-only"`. | code-writer | P0.2 | TODO |
| P1.2 | `lib/env.ts`: Zod validation of §11 vars; **fail-fast at boot**. `import "server-only"`. | code-writer | P0.2 | TODO |
| P1.3 | Rewrite `.env.local.example` to the admin var set (§11): drop PayPal/Resend/Upstash; add `NEXT_PUBLIC_FIREBASE_*`, `FIREBASE_PROJECT_ID`, `ALLOWED_EMAIL_DOMAIN`. | code-writer | — | TODO |
| P1.4 | `db/schema.sql` (§5, correct FK ordering: series → groups → alter reservations → audit) + `scripts/db/apply-schema.mjs` (mirror storefront). **File only — do not apply** (see Q5). | code-writer | P1.1 | TODO |
| P1.5 | Apply `schema.sql` to Neon **dev** branch, verify tables/columns/indexes. | main | P1.4, Q5 | BLOCKED (Q5) |

### P2 — Reservation engine (race-safe core)
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P2.1 | Port/implement race-safe single-item write: advisory lock → buffered overlap capacity recheck → insert `status='block'`, in one txn (spec §8). | code-writer | P1.1, Q1 | TODO |
| P2.2 | Multi-item / multi-occurrence booking: one txn, stable-order locks, all-or-nothing, report failing (item × date). | code-writer | P2.1 | TODO |
| P2.3 | Policy helpers (lead/horizon/available-hours/slot alignment, Eastern) — mirror storefront `policy.ts`; staff blocks may bypass lead/horizon but never capacity. | code-writer | P2.1 | TODO |
| P2.4 | Recurrence expansion: rule → concrete Eastern occurrence dates; cap (horizon_days or 104), surface truncation. | code-writer | — | TODO |
| P2.5 | Unit tests: overlap boundaries (half-open), buffer widening, capacity math, recurrence expansion, DST edges. | test-engineer | P2.1–P2.4 | TODO |

### P3 — Repositories & audit
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P3.1 | Typed repositories for `items`, `item_prices`, `categories`, `item_categories`, `reservations`, `reservation_groups`, `reservation_series`, `app_users`. | code-writer | P1.1 | TODO |
| P3.2 | `admin_audit_log` writer; call on **every** mutation (action, entity, entity_id, before/after detail). | code-writer | P3.1 | TODO |

### P4 — Auth & authorization
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P4.1 | Firebase Web SDK client sign-in UI (multi-provider); returns ID token. | code-writer | P0.2, Q2 | BLOCKED (Q2) |
| P4.2 | Server: Admin SDK `verifyIdToken` → session cookie via `createSessionCookie`; verify cookie in middleware. ADC on Cloud Run, key only for local dev. | code-writer | P1.1, Q2 | BLOCKED (Q2) |
| P4.3 | UID → `app_users` → role lookup; deny unknown users. `requireScheduler` / `requireAdmin` guards used in **every** mutating route/action. Optional custom-claim mirror. | code-writer | P4.2, P3.1 | BLOCKED (Q2) |
| P4.4 | Bootstrap first admin (§5 insert) once their UID is known. | main | P4.3, Q3 | BLOCKED (Q3) |

### P5 — UI: navigation & calendar
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P5.1 | Responsive app shell + menu bar (Calendar, Products, Add Reservation, Update Prices; admin: Categories, Users) collapsing to hamburger; hide admin entries for schedulers (server still enforces). | code-writer | P4.3 | TODO (nav shell can stub auth) |
| P5.2 | Weekly calendar: 7 columns, multi-day spanning bars, cross-week `<`/`>` continuation indicators, confirmed vs block styling, greyed/omitted cancelled, prev/next/today, `+` button → Add Reservation. | code-writer | P3.1, P5.1 | TODO |

### P6 — UI: reservations, products, prices, users
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P6.1 | Add Reservation: multi-product line items + recurrence controls; on submit run race-safe check across all (item × occurrence), no partial commit. | code-writer | P2.2, P2.4, P5.2 | TODO |
| P6.2 | Edit Reservation: edit line items/dates/contact/notes; delete-instance vs delete-series; cancel = `status='cancelled'`. | code-writer | P6.1 | TODO |
| P6.3 | Update Prices: CRUD `item_prices` with §6 validation; warn if edit leaves no all-days/all-hours base row; show effective/base rate + overrides. | code-writer | P3.1 | TODO |
| P6.4 | Products (admin): Add (all `items` fields + base price → first price row), Edit (deactivate not delete, `updated_at=now()`, unique URL-safe slug, respect check constraints). | code-writer | P3.1, P4.3 | TODO |
| P6.5 | Categories (admin): CRUD `categories`; assign products via `item_categories`. | code-writer | P3.1, P4.3 | TODO |
| P6.6 | User management (admin): CRUD `app_users` (set role, deactivate); guard against removing last active admin; re-sync custom claim on change. | code-writer | P3.1, P4.3 | TODO |
| P6.7 | Full flow tests: booking (single/multi/recurring), price edits, product lifecycle, role guards (server-side denial). | test-engineer | P6.1–P6.6 | TODO |

### P7 — Cross-system verification
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P7.1 | Create a block/reservation in admin → confirm storefront availability reflects it within ~30s and won't double-book that window. | main | P6.1 | TODO |

### P9 — Shared code consolidation (with storefront)
Per the human's direction (Q1): common functions must live in a **shared/common area**
consumed by both storefront and admin, not duplicated. Do this once the storefront repo
address is provided; until then, code written in P2/P3 that mirrors storefront logic is
tagged `// TODO(P9): consolidate` so it's easy to find and hoist.

| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P9.1 | Obtain storefront repo (address from human); decide the shared-code mechanism (e.g. workspaces monorepo package `@bcc/scheduler`, git submodule, or published internal pkg). | main | Q1 addr | BLOCKED (need repo address) |
| P9.2 | Identify the common surface: `scheduler/{db,client,policy}`, `products/{types,repository}`, env/time/money helpers. Extract into the shared package. | code-writer | P9.1 | TODO |
| P9.3 | Refactor both storefront and admin to import from the shared package; remove duplicated copies; run both test suites. | code-writer | P9.2 | TODO |
| P9.4 | Reconcile any admin code that was reimplemented from spec pseudocode against the now-shared canonical implementation (all `TODO(P9)` markers). | code-writer | P9.3 | TODO |

### P8 — Deployment
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P8.1 | Adapt `DEPLOY_CLOUD_RUN.md` for admin: Firebase `NEXT_PUBLIC_*` build vars, no PayPal, `admin.bachmancc.org`, `--allow-unauthenticated` (app is the gate). | main | — | TODO |
| P8.2 | Deploy to Cloud Run `us-east1`; secrets in Secret Manager; grant runtime SA `secretAccessor`. | main | P8.1, Q4 | BLOCKED (Q4) |
| P8.3 | Map `admin.bachmancc.org`; add to Firebase Authorized Domains + each provider callback list. | main | P8.2 | BLOCKED (Q4) |
| P8.4 | Apply `schema.sql` to Neon **prod** (`main`) branch; bootstrap prod admin. | main | P8.2, P1.5 | BLOCKED |
| P8.5 | Production smoke test (login per provider, create block, storefront reflects). | main | P8.4 | BLOCKED |

---

## Recommended first delegation wave (unblocked now)

`P0.2, P0.3, P1.1, P1.2, P1.3, P1.4` — scaffold + config + data layer + `schema.sql`
file. None need the open questions resolved; all are well-specified. Hand to
`code-writer` after `P0.1` (git init). `P2.4` (recurrence expansion, pure function)
and its tests can also proceed in parallel.

---

## Progress log

- 2026-07-20 — Plan created from ADMIN_APP_SPEC.md. Confirmed fresh scaffold, no git,
  storefront source not present locally (Q1), env files are storefront-inherited.
- 2026-07-20 — P0.1 done (git init + .gitignore, .env.local confirmed ignored). Foundation
  wave (P0.2, P0.3, P1.1–P1.4) handed to code-writer agent (background).
- 2026-07-20 — Q1 answered: human will provide storefront repo address; consolidate common
  code into a shared area rather than duplicating → added phase P9. Reimplemented-from-spec
  code to carry `// TODO(P9): consolidate` markers.
</content>
</invoke>
