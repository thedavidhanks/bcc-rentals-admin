# CLAUDE.md — BCC Rentals Admin

Guidance for Claude Code working in this repo. Read this before touching code.

## What this is

An authenticated web app for **church staff** to administer the BCC Rentals catalog and
calendar. It is a **separate repo** from the storefront (`bcc-rentals-frontend`) but
**shares the storefront's Neon Postgres database** as the single source of truth. The
admin app is a **second writer** to the same catalog + reservation tables; the storefront
is unchanged by anything here.

- **Full spec:** [docs/ADMIN_APP_SPEC.md](./docs/ADMIN_APP_SPEC.md) — authoritative requirements.
- **Build plan / progress:** [docs/EXECUTION_PLAN.md](./docs/EXECUTION_PLAN.md) — phases, task owners, status. Update it as work lands.

## The three things that will corrupt data if you skip them

1. **Reservation writes must be race-safe.** The storefront books the same rows under a
   per-item Postgres **advisory lock** (`pg_advisory_xact_lock`). Every reservation row
   this app writes MUST use the identical pattern — lock → re-check buffered-window
   capacity → insert — inside **one transaction**. Multi-item bookings: acquire locks in
   **stable slug order**, check every (item × occurrence), all-or-nothing. See spec §8.
   Skip this and a staff block + a customer booking can both claim the last unit.
2. **Money is integer cents; time is minutes since local midnight in `America/New_York`.**
   No floats, no stored UTC offsets. `days_of_week` is `smallint[]`, `0=Sun..6=Sat`,
   `null`=every day. `start_minute`/`end_minute` are 0–1440, both-null-or-both-set,
   `end > start`. Reservation `start_at`/`end_at` are `timestamptz` (real instants) —
   convert to Eastern only for display and hours validation.
3. **Do not assume users have Google accounts.** Auth is Firebase Authentication / GCP
   Identity Platform with multiple social providers (Google, GitHub, Facebook, Apple).
   The Firebase **UID** is the durable account id; `app_users.role` in the DB is the
   canonical permission store. Verify tokens server-side; deny unknown users.

## Architecture

- **Stack:** Next.js (App Router) + TypeScript + `pg`. Deploys to GCP Cloud Run
  (`us-east1`, scale-to-zero), `output: 'standalone'`. Secrets in Secret Manager.
- **DB:** the storefront's Neon Postgres. Runtime uses the **pooled** endpoint
  (`DATABASE_URL`); `DATABASE_URL_DEV` is for one-off DDL/tooling only. Access via `pg`
  `Pool`; wrap multi-statement writes in a transaction.
- **Auth model on Cloud Run:** `--allow-unauthenticated` at the platform layer; the
  **app** is the gate (Firebase verify in middleware → `app_users` lookup authorizes).
- **Roles:** `scheduler` (calendar, reservations, prices) and `admin` (all that + products,
  categories, users). Enforce on the **server** in every mutating route/action —
  `requireScheduler` / `requireAdmin`. Never rely on hidden UI.

## Schema

- **Existing (storefront-owned), read the spec §4:** `items`, `item_prices`, `categories`,
  `item_categories`, `reservations`. Respect the check constraints.
- **New (this app adds, spec §5):** `app_users`, `reservation_groups`, `reservation_series`,
  plus `reservations.group_id` / `reservations.series_id`, and `admin_audit_log`. All
  idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). FK creation order:
  `reservation_series` → `reservation_groups` → `ALTER reservations` → `admin_audit_log`.
- Lives in `db/schema.sql`, applied by `scripts/db/apply-schema.mjs`. **Dev branch first.**
- Write to `admin_audit_log` on **every** mutation.

## Conventions

- Deactivate, don't delete: products use `active=false`; cancelled reservations use
  `status='cancelled'` (keeps history + frees capacity via the partial index). Set
  `items.updated_at = now()` on every edit.
- `import "server-only"` in any module that touches the DB or secrets.
- Validate env with Zod at boot — the app must **fail to start** if a required var is
  missing (see spec §11 for the var list).
- Match storefront row shapes when reading/writing shared tables — when unsure, mirror
  the storefront's `seed-products.mjs` / `repository.ts` shapes described in the spec.

## Commands

_(Populated once the app is scaffolded — P0.2. Expected:)_

```bash
npm run dev            # local dev server
npm run build          # standalone production build
npm run lint           # eslint
npm test               # unit/integration tests
node scripts/db/apply-schema.mjs   # apply db/schema.sql (DEV BRANCH first; never prod without go-ahead)
```

## Safety rails

- **`.env.local` contains live production secrets** (Neon prod creds, etc.). Never commit
  it, never paste its contents into agent prompts, PRs, or logs.
- **No agent runs DDL against the shared DB or deploys** without explicit human approval.
  Agents may *write* `schema.sql` and the apply script; a human *runs* it, dev branch first.
- The storefront caches the catalog ~30s per instance, so catalog/price/category edits
  appear on the storefront within ~30s automatically — no redeploy needed.

## Working style

- **Delegate to agents by default.** Custom agents available: `code-writer`
  (branch → test-engineer → merge), `test-engineer`, `code-improvement-advisor`,
  `graphic-designer`. Reserve `main` for decisions, wiring, and anything touching the
  shared production DB or deployment.
- Keep [docs/EXECUTION_PLAN.md](./docs/EXECUTION_PLAN.md) current: update task status and
  add a dated Progress-log line when work lands. Resume from the first non-`DONE` phase.

## Storefront reference files (per spec — NOT present in this repo)

The spec cites `lib/scheduler/{db,client,policy}.ts`, `lib/products/{types,repository}.ts`,
`lib/env.ts`, `scripts/db/apply-schema.mjs`, `docs/DEPLOY_CLOUD_RUN.md` from the storefront.
Only the docs are here. If the storefront repo becomes available, **copy** the scheduler
module rather than reimplementing (spec §8: "Copying is safer than reimplementing").
Otherwise reimplement the race-safe write + policy from the spec's pseudocode and flag for
later reconciliation (open question Q1 in the execution plan).
</content>
