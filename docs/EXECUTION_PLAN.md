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
   with a note). Keep the progress log in **[LOG.md](./LOG.md)** current — one dated line
   per meaningful change.
4. Prefer delegating to agents (standing preference). The **owner** column is the
   recommended agent; `main` = do it in the primary session (decisions, wiring,
   verification against the shared DB).
5. **Never** let an agent run DDL against the shared Neon DB or deploy without
   explicit human go-ahead. See **Safety rails** below.

Status legend: `TODO` · `IN PROGRESS` · `DONE` · `BLOCKED` · `N/A`

---

## Current state (as of 2026-09-03)

**P6 is feature-complete and on `master`.** The 2026-09-02 wave landed the last three admin
CRUD screens — **P6.3 Update Prices, P6.4 Products, P6.5 Categories** — built by three parallel
`code-writer` agents in isolated worktrees, integrated on `integration/P6.3-4-5-admin-crud-wave`,
and merged to trunk **2026-09-03**; `master` tip is **`9f60fb1`**. Verified on trunk that day:
`npm test` **418/418 (25 files)** green, `app/{prices,products,categories}` tracked. No schema
change, no new dependency, no `TODO(P9)` markers added. This unblocks **P6.7** (full-flow tests).

**Branch housekeeping done 2026-09-03:** all 24 branches reachable from `master` were deleted
and their 7 stale worktrees removed. Only `master` plus four wave-3 leftovers remain —
`code-writer/{p4-auth,p5.1-shell,p5.2-calendar,p9.2-shared-pkg}` — which are *not* ancestors of
`master` (their content landed via the wave-3 integration merge as different commits). Verified
they carry **no unique source files**: the only paths they add are stale `.claude/agents/*.md`
copies, and everything else is an older variant of a file `master` already has. They need
`git branch -D` (force) to remove; two still have worktrees under `.claude/worktrees/`.

The dated snapshot below (2026-08-05) still describes the auth/DB/bootstrap situation accurately.

### Earlier snapshot (as of 2026-08-05)

**Q3 answered + first admin bootstrapped against PROD; P4.4 DONE (2026-08-05).** The human
signed in once, created the first admin, and completed the `@bachmancc.org` re-bootstrap.
**Verified live 2026-08-05:**

1. **Prod schema is COMPLETE.** ✅ All §5 objects present on the Neon **prod** branch
   (`DATABASE_URL`): `app_users`, `reservation_groups`, `reservation_series`, `admin_audit_log`,
   and `reservations.group_id`/`series_id`. (Applied via PgAdmin directly against prod; the full
   idempotent `db/schema.sql` was run.) Audit writer and P6 reservation-grouping are unblocked on prod.
2. **Re-bootstrap to `@bachmancc.org` DONE.** ✅ Prod `app_users` now holds exactly **one** row —
   `dhanks@bachmancc.org` (`uid=aOcGPdPctZMhw6TFeMqgIkyvLio1`, `role=admin`, `active=true`, UID
   len 28); the interim `dphanks@gmail.com` row was deleted by the swap. Human confirmed a local
   sign-in as `dhanks@bachmancc.org` (auth via `bcc-admin-staging`, roles read from prod
   `DATABASE_URL`), then set **`ALLOWED_EMAIL_DOMAIN=bachmancc.org`** — all three steps verified
   live against prod (1 admin row, correct identity/role/UID; `ALLOWED_EMAIL_DOMAIN` present).
   Lockout risk eliminated (no non-`@bachmancc.org` identity remains). Remaining app-side item:
   insert an admin into the **dev** branch (0 `app_users`) **only if** `DATABASE_URL` is later
   repointed at dev for local development — not needed while local `DATABASE_URL`=prod.

**DB workflow correction:** the assumption that the Neon **dev** branch auto-deleted is **false** —
it is alive (`DATABASE_URL_DEV` connects) and carries the **complete** §5 schema with 0 `app_users`
rows. **DDL/tooling should stay dev-branch-first.**

**Auth vs. authorization — two independent axes (don't conflate them):**

- **Firebase project** _authenticates_ (issues the UID). `.env.local` uses `bcc-admin-staging` for
  both the client and Admin SDK. `localhost` is auto-authorized, so real sign-in works locally
  with no deploy.
- **Neon DB (`DATABASE_URL`)** _authorizes_ (UID → role lookup). **The running app only ever uses
  `DATABASE_URL`; it never touches `DATABASE_URL_DEV`** (that var is for one-off DDL/tooling only).
- **Current local reality:** `.env.local`'s `DATABASE_URL` points at the **prod** branch. So the
  app locally signs in via `bcc-admin-staging` and reads roles from **prod** — the same DB the swap
  SQL writes to. That's why the admin can sign in locally _today_ without any dev-branch `app_users`
  row. Adding the admin UID to the **dev** branch is **only** needed if `DATABASE_URL` is later
  repointed at the dev branch for local development.

**Q2 (Firebase) answered for staging (2026-07-26).** `bcc-admin-staging` Web SDK config is
in `.env.local`; launch sign-in methods = **Google + Email/Password**. Both halves of the
real auth path are now implemented: **client** (`lib/auth/firebase-client.ts`, `firebase`
installed) Google popup + `signInWithEmailPassword`, and **server** (`lib/auth/session.ts`,
**P4.2 DONE**) real `firebase-admin` `verifyIdToken` → `createSessionCookie` →
`verifySessionCookie` (ADC on Cloud Run; `GOOGLE_APPLICATION_CREDENTIALS` key only for local
dev). `app/login/login-form.tsx` now renders Email/Password inputs + the Google button in the
real path. `typecheck`/`lint` clean, `npm test` **141/141 (12 files)**, `build` exit 0. The
only Q2 remainder is **P8.3** Authorized Domains at deploy time. (Not yet committed/merged.)

**Foundation + reservation engine + repositories + auth plumbing + UI shell/calendar +
shared package are built, verified, and merged to `master`** (foundation `7707a88`; wave 2
tip `90e1659`; **wave 3 merged, tip `c648610`**). Working tree clean. `npm run typecheck`
is clean and `npm test` is **139/139 green** (12 files). Neon **dev** branch has the §5
schema applied (P1.5).

Landed in wave 3 (`961209f`, `a891d05`, `e68274c`, `809785a`, `c648610`):

- **Auth plumbing (P4.1–P4.3)** on the Q2 **dev-bypass stub** — `app/login/*` sign-in UI,
  `lib/auth/{session,guards,firebase-client,types,constants}.ts`, `middleware.ts`,
  `app/api/auth/session`. UID→`app_users` role lookup + `requireScheduler`/`requireAdmin`
  guards. **Swap in real Firebase when Q2 lands** (real providers, Admin SDK `verifyIdToken`).
- **App shell (P5.1)** — `components/nav/*` responsive role-aware navigation (admin entries
  hidden from schedulers; server still enforces).
- **Weekly calendar (P5.2)** — `app/calendar/*`, multi-day spanning bars, cross-week
  continuation, block/confirmed styling, prev/next/today, `+` → Add Reservation.
- **Shared package (P9.2)** — `packages/scheduler` = `@bcc/scheduler`, npm-workspaces
  monorepo pkg (no build step; TS consumed via workspaces + tsconfig paths). Exports
  `scheduler/{errors,policy,types}` + `products/types`. Placeholder route dirs scaffolded:
  `app/{products,prices,categories,users,reservations}` (P6 fills these in).
- **Tests** — +47 (auth-session, auth-guards, nav-config, calendar-week); still unit-level
  (mocked `pg`); no live-DB integration test yet (see P7.1).

Landed in wave 2 (`0509643`, `4f7f11f`, `3636301`):

- **Reservation engine** `lib/scheduler/{client,policy,types,errors}.ts` — race-safe
  single-item write (advisory lock → capacity recheck → insert), multi-item/multi-occurrence
  all-or-nothing booking (stable slug-order locks), Eastern policy helpers with staff-block
  bypass (never bypasses capacity). Copied/adapted from storefront, tagged `// TODO(P9)`.
- **Recurrence** `lib/scheduler/recurrence.ts` — pure `expandRecurrence()`, DST-proof civil-date
  math, cap + truncation flag.
- **Repositories** `lib/repositories/*` — typed read/write for all eight tables + `writeAuditLog`
  (transaction-aware). Shared-table shapes tagged `// TODO(P9)`.
- **Tests** — 92 unit tests (mocked `pg`); no live-DB integration test yet (see P7.1).

Present in the repo now:

- **App scaffold:** Next.js (App Router) + TypeScript, `next.config.ts` with
  `output: 'standalone'`, strict TS, ESLint, `vitest`. `package.json` scripts: `dev`,
  `build`, `start`, `lint`, `typecheck`, `test`, `db:apply`. Placeholder `app/page.tsx`.
- **Container:** `Dockerfile` (multi-stage standalone, port 8080, non-root) + `.dockerignore`.
- **Data layer:** `lib/db.ts` (`getPool()` + `withTransaction()`, `server-only`).
- **Config:** `lib/env.ts` (server Zod env, fail-fast) + `lib/public-env.ts` (client-safe
  `NEXT_PUBLIC_*`). `.env.local.example` reshaped to the §11 admin var set (no PayPal/
  Resend/Upstash).
- **Schema:** `db/schema.sql` (idempotent §5 DDL) + `scripts/db/apply-schema.mjs`
  (dev-branch-first, refuses prod unless `APPLY_TO_PROD=1`). **NOT yet applied to any DB.**
- **Tests:** `tests/env.test.ts` (3 passing).
- Git initialized; `.env.local` (live prod secrets) is git-ignored.

Still storefront-inherited / needs work later:

- [DEPLOY_CLOUD_RUN.md](./DEPLOY_CLOUD_RUN.md) is the **storefront's** runbook (PayPal
  build args, storefront domain). Adapt for admin (Firebase build vars,
  `admin.bachmancc.org`, no PayPal) — tracked as `P8.1`.
- Toolchain: Node v22.16, npm 10.9.

Reconcile-later flags (from building without the storefront source — see P9):

- `lib/db.ts` SSL uses `{ rejectUnauthorized: false }` for Neon — confirm vs storefront.
- `lib/env.ts` + `lib/public-env.ts` split is our interpretation, not a copy.
- `withTransaction` shape follows spec prose, not the real `lib/scheduler/db.ts`.

---

## Blocking open questions (resolve before the dependent phase)

These gate specific phases. Surface them to the human; do not guess.

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Blocks               | Default if unanswered                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | ✅ **FULLY RESOLVED:** repo https://github.com/thedavidhanks/bcc-rentals-frontend (public, default branch `main`, verified reachable 2026-07-23, tip `1074a9e`). Strategy: do **not** duplicate — extract functions common to storefront + admin into a **shared/common area** and consume it from both (see P9). Mechanism **decided**: npm-workspaces monorepo package `@bcc/scheduler`. Copy verbatim from the storefront in the interim if consolidation lags.                                                                                                                                                                                                     | P2, P5, P6 (quality) | ~~Awaiting repo address~~ — **resolved**; the race-safe write + policy can now be copied from the storefront instead of reimplemented from spec pseudocode. |
| Q2  | ✅ **ANSWERED (2026-07-26, staging).** Firebase project **`bcc-admin-staging`** config supplied in `.env.local` (all `NEXT_PUBLIC_FIREBASE_*` + `FIREBASE_PROJECT_ID` set; values never echoed). **Enabled sign-in methods for launch: Google + Email/Password** (GitHub/Facebook/Apple deferred). Both halves wired real: client (`lib/auth/firebase-client.ts`, `firebase`) + server Admin SDK (`lib/auth/session.ts`, **P4.2 DONE**, `firebase-admin`) + Email/Password inputs in `app/login`. **Only remaining before Q2 is fully closed:** Authorized Domains added at deploy = **P8.3**. Prod (`bcc-admin-prod`) Firebase config still to gather at deploy time. | P4                   | ~~Cannot complete auth; stub dev-only bypass~~ — **resolved**; end-to-end real auth implemented (P8.3 authorized domains remain).                           |
| Q3  | ✅ **FULLY RESOLVED (2026-08-05).** First admin signed in via `bcc-admin-staging`; UID captured and inserted into prod `app_users`. Interim Gmail identity (`dphanks@gmail.com`) **swapped** for the `@bachmancc.org` admin (`uid=aOcGPdPctZMhw6TFeMqgIkyvLio1`, `dhanks@bachmancc.org`) — verified live: prod holds exactly 1 admin row, local sign-in confirmed, `ALLOWED_EMAIL_DOMAIN=bachmancc.org` set. P4.4 DONE.                                                                                                                                                                                                                                                | P4.4                 | ~~Defer~~ — resolved (UID known, admin bootstrapped).                                                                                                       |
| Q4  | **GCP project id + confirm domain** `admin.bachmancc.org` and DNS control. Now largely superseded by **P10** — the org/project structure (`bcc-admin-prod` etc.) produces the concrete project ids the deploy needs.                                                                                                                                                                                                                                                                                                                                                                                                                                                   | P8, P10              | Deploy phase stays BLOCKED until P10.4 creates `bcc-admin-prod`.                                                                                            |
| Q5  | ✅ **ANSWERED (2026-07-20):** human gave go-ahead; `schema.sql` applied to the Neon **dev** branch (`DATABASE_URL_DEV`) and verified. Prod (`main` branch) still pending under P8.4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | P1.4 (apply)         | ~~Write `schema.sql` as a file only~~ — resolved.                                                                                                           |

---

## Safety rails (non-negotiable)

- The admin app is a **second writer to the storefront's production tables.** Every
  reservation write MUST use the per-item advisory-lock + capacity-recheck pattern in
  spec §8, inside one transaction, locks acquired in stable slug order.
- **No agent runs DDL against the shared DB or deploys** without explicit human
  approval in-session. Agents may _write_ `schema.sql` and the apply script; a human
  (or `main` with go-ahead) _runs_ it, against the **dev branch** first.
- All new schema is idempotent (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
- Money = integer cents. Time = minutes since local midnight, `America/New_York`.
  Reservation instants = `timestamptz`. No floats, no stored UTC offsets.
- `.env.local` holds **live production secrets** — never commit it, never echo its
  contents into logs, PRs, or agent prompts.

---

## Phases

### P0 — Repo & tooling foundation

| ID   | Task                                                                                                                   | Owner       | Depends | Status           |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ----------- | ------- | ---------------- |
| P0.1 | `git init`, add `.gitignore` (node, `.env*`, `.next`, `node_modules`), initial commit. Enables branch-isolated agents. | main        | —       | DONE             |
| P0.2 | Scaffold Next.js (App Router) + TypeScript; `next.config.ts` with `output: 'standalone'`; ESLint/TS strict.            | code-writer | P0.1    | DONE (`7707a88`) |
| P0.3 | Add `Dockerfile` + `.dockerignore` for standalone build (adapt storefront's; no PayPal).                               | code-writer | P0.2    | DONE (`7707a88`) |

### P1 — Data layer & config

| ID   | Task                                                                                                                                                                                | Owner       | Depends  | Status                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P1.1 | `lib/db.ts`: `pg` `Pool` (`getPool()`) + `withTransaction()` (mirror storefront `lib/scheduler/db.ts`). `import "server-only"`.                                                     | code-writer | P0.2     | DONE (`7707a88`; `TODO(P9)`: reconcile SSL + shape vs storefront)                                                                           |
| P1.2 | `lib/env.ts`: Zod validation of §11 vars; **fail-fast at boot**. `import "server-only"`.                                                                                            | code-writer | P0.2     | DONE (`7707a88`; split: `lib/env.ts` server + `lib/public-env.ts` client)                                                                   |
| P1.3 | Rewrite `.env.local.example` to the admin var set (§11): drop PayPal/Resend/Upstash; add `NEXT_PUBLIC_FIREBASE_*`, `FIREBASE_PROJECT_ID`, `ALLOWED_EMAIL_DOMAIN`.                   | code-writer | —        | DONE (`7707a88`)                                                                                                                            |
| P1.4 | `db/schema.sql` (§5, correct FK ordering: series → groups → alter reservations → audit) + `scripts/db/apply-schema.mjs` (mirror storefront). **File only — do not apply** (see Q5). | code-writer | P1.1     | DONE (`7707a88`; apply refuses prod unless `APPLY_TO_PROD=1`)                                                                               |
| P1.5 | Apply `schema.sql` to Neon **dev** branch, verify tables/columns/indexes.                                                                                                           | main        | P1.4, Q5 | DONE (2026-07-20; verified: app_users, reservation_groups, reservation_series, admin_audit_log + reservations.group_id/series_id + indexes) |

### P2 — Reservation engine (race-safe core)

| ID   | Task                                                                                                                                                            | Owner         | Depends   | Status                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2.1 | Port/implement race-safe single-item write: advisory lock → buffered overlap capacity recheck → insert `status='block'`, in one txn (spec §8).                  | code-writer   | P1.1, Q1  | DONE (`4f7f11f`, merged to `master` ff `90e1659`)                                                                                                                                                   |
| P2.2 | Multi-item / multi-occurrence booking: one txn, stable-order locks, all-or-nothing, report failing (item × date).                                               | code-writer   | P2.1      | DONE (`4f7f11f`)                                                                                                                                                                                    |
| P2.3 | Policy helpers (lead/horizon/available-hours/slot alignment, Eastern) — mirror storefront `policy.ts`; staff blocks may bypass lead/horizon but never capacity. | code-writer   | P2.1      | DONE (`4f7f11f`)                                                                                                                                                                                    |
| P2.4 | Recurrence expansion: rule → concrete Eastern occurrence dates; cap (horizon_days or 104), surface truncation.                                                  | code-writer   | —         | DONE (`3636301`)                                                                                                                                                                                    |
| P2.5 | Unit tests: overlap boundaries (half-open), buffer widening, capacity math, recurrence expansion, DST edges.                                                    | test-engineer | P2.1–P2.4 | DONE — covered by the code-writers' own suites (scheduler-policy/client/booking + recurrence); 92/92 green on `master`. NOTE: all unit-level (mocked `pg`); no live-DB integration test yet (P7.1). |

### P3 — Repositories & audit

| ID   | Task                                                                                                                                                     | Owner       | Depends | Status                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------- | -------------------------------------------------------------------------------------------- |
| P3.1 | Typed repositories for `items`, `item_prices`, `categories`, `item_categories`, `reservations`, `reservation_groups`, `reservation_series`, `app_users`. | code-writer | P1.1    | DONE (`0509643`, merged to `master` ff `90e1659`)                                            |
| P3.2 | `admin_audit_log` writer; call on **every** mutation (action, entity, entity_id, before/after detail).                                                   | code-writer | P3.1    | DONE (`0509643`) — writer exists; wiring it into each mutation happens as P4/P6 actions land |

### P4 — Auth & authorization

| ID   | Task                                                                                                                                                                   | Owner       | Depends    | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P4.1 | Firebase Web SDK client sign-in UI (multi-provider); returns ID token.                                                                                                 | code-writer | P0.2, Q2   | DONE (`961209f` stub) + **real client wired 2026-07-26** (`lib/auth/firebase-client.ts` — real Web SDK: `signInWithProvider` Google popup + `signInWithEmailPassword`; `firebase` installed) + **Email/Password inputs added to `app/login/login-form.tsx`** (real path now: email/password form + Google button). typecheck/lint clean. Not yet committed/merged.                                                                                                                                                                                                                                              |
| P4.2 | Server: Admin SDK `verifyIdToken` → session cookie via `createSessionCookie`; verify cookie in middleware. ADC on Cloud Run, key only for local dev.                   | code-writer | P1.1, Q2   | **DONE 2026-07-26** — real `firebase-admin` swapped into `lib/auth/session.ts`: `verifyIdToken(idToken, true)` → `createSessionCookie` (mint), `verifySessionCookie(value, true)` → identity (read; returns `null` on invalid/revoked). Cached `getAdminAuth()` uses ADC (Cloud Run runtime SA) or `GOOGLE_APPLICATION_CREDENTIALS` locally. `firebase-admin` installed; 4 real-path unit tests added (`tests/auth-session.test.ts`, admin mocked). Edge boundary preserved — `middleware.ts` stays cookie-presence-only. End-to-end real sign-in now complete (client P4.1 + this). Not yet committed/merged.  |
| P4.3 | UID → `app_users` → role lookup; deny unknown users. `requireScheduler` / `requireAdmin` guards used in **every** mutating route/action. Optional custom-claim mirror. | code-writer | P4.2, P3.1 | DONE (`961209f`, `lib/auth/guards.ts`; nav role type aligned to canonical `UserRole` `c648610`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P4.4 | Bootstrap first admin (§5 insert) once their UID is known.                                                                                                             | main        | P4.3, Q3   | **DONE (2026-08-05)** — `@bachmancc.org` admin bootstrapped in **prod** `app_users` and verified live: exactly 1 row, `dhanks@bachmancc.org` / `uid=aOcGPdPctZMhw6TFeMqgIkyvLio1` / `role=admin` / `active=true` (interim `dphanks@gmail.com` row removed by the swap). Human confirmed local sign-in (auth via `bcc-admin-staging`, roles from prod `DATABASE_URL`); `ALLOWED_EMAIL_DOMAIN=bachmancc.org` set. **Follow-up only if needed:** insert an admin into the **dev** branch (0 `app_users`) if `DATABASE_URL` is later repointed at dev for local dev — not required while local `DATABASE_URL`=prod. |

### P5 — UI: navigation & calendar

| ID   | Task                                                                                                                                                                                                  | Owner       | Depends    | Status                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------- | ---------------------------------------------------------- |
| P5.1 | Responsive app shell + menu bar (Calendar, Products, Add Reservation, Update Prices; admin: Categories, Users) collapsing to hamburger; hide admin entries for schedulers (server still enforces).    | code-writer | P4.3       | DONE (`e68274c`, `components/nav/*` role-aware shell)      |
| P5.2 | Weekly calendar: 7 columns, multi-day spanning bars, cross-week `<`/`>` continuation indicators, confirmed vs block styling, greyed/omitted cancelled, prev/next/today, `+` button → Add Reservation. | code-writer | P3.1, P5.1 | DONE (`a891d05`, `app/calendar/*` + `calendar-week` tests) |

### P6 — UI: reservations, products, prices, users

| ID   | Task                                                                                                                                                                          | Owner         | Depends          | Status |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------- | ------ |
| P6.1 | Add Reservation: multi-product line items + recurrence controls; on submit run race-safe check across all (item × occurrence), no partial commit.                             | code-writer   | P2.2, P2.4, P5.2 | DONE (`1ab94e4`, merged to `master` `e56b0fa`) |
| P6.2 | Edit Reservation: edit line items/dates/contact/notes; delete-instance vs delete-series; cancel = `status='cancelled'`.                                                       | code-writer   | P6.1             | **DONE (2026-08-22)** — page + actions merged to `master` (`e045dea`). Contact/notes edit (no engine); line/date/time edit via cancel-then-rebook through `scheduler.createBooking` (race-safe, rolls back on conflict, mints new `group_id`, preserves `series_id`); delete-instance / delete-series (future-only); cancel≠DELETE; audit on every mutation; calendar bars link to `/reservations/[groupId]`. 225 tests green (+23 P6.2). **Unblocks P7.1.** |
| P6.3 | Update Prices: CRUD `item_prices` with §6 validation; warn if edit leaves no all-days/all-hours base row; show effective/base rate + overrides.                               | code-writer   | P3.1             | **DONE (2026-09-02, merged to `master` 2026-09-03 `9f60fb1`)** — `app/prices/*` (`51ac535`) merged via `integration/P6.3-4-5-admin-crud-wave` → `feature/P6.3-4-5-admin-crud-wave` (`4f34304`) → `master`. `requireScheduler` first statement in all 3 actions; money parsed as exact integer cents (whole/fraction parts, no float drift); both-null-or-both-set + `end>start` + 0–1440 hour window; `days_of_week` bounds/duplicate checks. Base-row warn/confirm is a two-step that performs **zero DB writes** on the warning path (asserted `withTransaction` is never entered). Audit write shares the *same* txn client object as the mutation (asserted by identity, not `expect.anything()`). +69 tests. |
| P6.4 | Products (admin): Add (all `items` fields + base price → first price row), Edit (deactivate not delete, `updated_at=now()`, unique URL-safe slug, respect check constraints). | code-writer   | P3.1, P4.3       | **DONE (2026-09-02, merged to `master` 2026-09-03 `9f60fb1`)** — `app/products/*` incl. `new/` + `[id]/` (`4d0f4ba`), same integration merge (`4f34304`). `requireAdmin` first statement in all 3 actions; deactivate-not-delete; `updated_at=now()`; unique URL-safe slug (pre-check + unique-violation race handling). Base price row written via the **existing** `createPrice` export on the item-insert txn client (`days_of_week`/`start_minute`/`end_minute` all `null`, `priority: 0`) — `lib/repositories/item-prices.ts` **byte-identical to base**, no price-CRUD UI here (that's P6.3). +63 tests. |
| P6.5 | Categories (admin): CRUD `categories`; assign products via `item_categories`.                                                                                                 | code-writer   | P3.1, P4.3       | **DONE (2026-09-02, merged to `master` 2026-09-03 `9f60fb1`)** — `app/categories/*` (`f298ae9`), same integration merge (`4f34304`). `requireAdmin` first statement in all 6 actions (verified it precedes even the read-only pre-checks); every mutation in `withTransaction` with `writeAuditLog` on the same client. Slug uniqueness allows a row to keep its own slug on edit; delete-confirm re-fetches assignments so the audited set is current; `setItemCategories` DELETE+INSERT stays atomic on the txn client. TOCTOU races (row deleted between pre-check and txn) guarded and tested. +61 tests. |
| P6.6 | User management (admin): CRUD `app_users` (set role, deactivate); guard against removing last active admin; re-sync custom claim on change. **Extended 2026-08-18 with invite-by-email onboarding** — admin invites by email+name+role (pending row `uid=NULL`, `active=false`); UID binds on first sign-in iff `email_verified=true` + email matches. **Needs 1 schema change (make `app_users.uid` nullable) + a login-flow change.** UID stays canonical (spec §3); email is a one-time binding key only. Work order: [docs/prompts/P6.6-user-management.md](./prompts/P6.6-user-management.md). | code-writer   | P3.1, P4.3       | **DONE (2026-08-19)** — admin CRUD (invite/revoke/set-role/activate) + invite-by-email onboarding shipped and human-approved. Schema migration (nullable `uid` + partial unique indexes on non-null `uid` and pending-invite email) applied to **dev + prod** and verified live. `email_verified` threaded through `SessionIdentity`; UID binds on first verified sign-in (race-safe via `WHERE uid IS NULL`). Last-active-admin guard is transactional (re-check inside the mutation txn). Every mutation writes `admin_audit_log`. `"use server"` split: result-state moved to `app/users/state.ts` (a "use server" file may only export async fns). Verified: typecheck + lint clean, users-actions tests 26/26. **KNOWN LIMITATION:** "Send invite" creates a pending row only — it does **not** email anyone (no mail integration exists); the invitee must be told the URL out-of-band → tracked as P6.9. |
| P6.7 | Full flow tests: booking (single/multi/recurring), price edits, product lifecycle, role guards (server-side denial).                                                          | test-engineer | P6.1–P6.6        | **TODO — now UNBLOCKED** (P6.1–P6.6 all DONE as of 2026-09-02). Note each screen already ships per-action unit tests (418 total); P6.7's value is the **cross-screen flows** those miss — create product → price it → book it → cancel, and role-denial across every mutating action. |
| P6.8 | **Invite-exception to the email-domain guard (MEDIUM).** `emailDomainAllowed` in [lib/auth/guards.ts](../lib/auth/guards.ts) currently blocks any non-`ALLOWED_EMAIL_DOMAIN` email at bind time, so an invited outsider creates a pending row but is then **denied on first sign-in** — inviting outside domains doesn't work end-to-end. Change the bind path to allow binding when **either** the domain matches **or** an explicit pending invite exists for that exact (lower-cased) email. Keeps the domain wall up for everyone else (defense-in-depth); only opens it for people an admin explicitly invited. Do **not** blank `ALLOWED_EMAIL_DOMAIN` (drops the wall for the whole app). Useful for testing with other users. Audit the bind as today. | code-writer | P6.6 | TODO (medium priority) |
| P6.9 | **Real invitation email (LOW / optional).** Make "Send invite" actually notify the invitee (currently it only writes a pending `app_users` row — see P6.6 known limitation). Scope: pick a mail provider (e.g. Resend/SendGrid), add its key to Secret Manager + Zod env, send from `inviteUserAction` **after** the DB commit (best-effort — a send failure must not roll back the committed invite), include the sign-in URL. **Optional** — launch has ≤10 users, so onboarding can be done manually (tell the invitee the URL out-of-band). | code-writer | P6.6 | TODO (low priority, optional) |

### P7 — Cross-system verification

| ID   | Task                                                                                                                             | Owner | Depends | Status |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | ----- | ------- | ------ |
| P7.1 | Create a block/reservation in admin → confirm storefront availability reflects it within ~30s and won't double-book that window. | main  | P6.1    | TODO   |

### P9 — Shared code consolidation (with storefront)

Per the human's direction (Q1): common functions must live in a **shared/common area**
consumed by both storefront and admin, not duplicated. **The storefront repo is now
available** (https://github.com/thedavidhanks/bcc-rentals-frontend, public, `main`,
verified reachable 2026-07-23, tip `1074a9e`), so this phase is unblocked. The shared-code
**mechanism is decided: an npm-workspaces monorepo package `@bcc/scheduler`.** Code written
in P2/P3 that mirrors storefront logic is tagged `// TODO(P9): consolidate` so it's easy to
find and hoist.

| ID   | Task                                                                                                                                                                                                                                                                                                            | Owner       | Depends | Status                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P9.1 | ~~Obtain storefront repo (address from human)~~ + ~~decide the shared-code mechanism~~. Repo provided & verified: https://github.com/thedavidhanks/bcc-rentals-frontend (public, `main`). Mechanism chosen: **npm-workspaces monorepo package `@bcc/scheduler`**. Standing up the package + extraction is P9.2. | main        | Q1 addr | DONE (2026-07-23 — repo confirmed reachable; mechanism = npm-workspaces `@bcc/scheduler`)                                                                                        |
| P9.2 | Identify the common surface: `scheduler/{db,client,policy}`, `products/{types,repository}`, env/time/money helpers. Extract into the shared package.                                                                                                                                                            | code-writer | P9.1    | DONE (`809785a`, `packages/scheduler` = `@bcc/scheduler`; exports `scheduler/{errors,policy,types}` + `products/types`; consumed via workspaces + tsconfig paths, no build step) |
| P9.3 | Refactor both storefront and admin to import from the shared package; remove duplicated copies; run both test suites.                                                                                                                                                                                           | code-writer | P9.2    | TODO                                                                                                                                                                             |
| P9.4 | Reconcile any admin code that was reimplemented from spec pseudocode against the now-shared canonical implementation (all `TODO(P9)` markers).                                                                                                                                                                  | code-writer | P9.3    | TODO                                                                                                                                                                             |

### P8 — Deployment

| ID   | Task                                                                                                                                                       | Owner | Depends     | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P8.1 | Adapt `DEPLOY_CLOUD_RUN.md` for admin: Firebase `NEXT_PUBLIC_*` build vars, no PayPal, `admin.bachmancc.org`, `--allow-unauthenticated` (app is the gate). | main  | —           | TODO                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P8.2 | Deploy to Cloud Run `us-east1`; secrets in Secret Manager; grant runtime SA `secretAccessor`.                                                              | main  | P8.1, P10.4 | TODO (unblocked — `bcc-admin-prod` exists w/ billing+APIs+`run-runtime` SA; `DATABASE_URL` secret + accessor already granted. Needs P8.1 runbook.)                                                                                                                                                                                                                                                                                                                                              |
| P8.3 | Map `admin.bachmancc.org`; add to Firebase Authorized Domains + each provider callback list.                                                               | main  | P8.2        | BLOCKED (Q4). NOTE (2026-07-26): **no Authorized Domain needed for local dev** — Firebase authorizes `localhost` by default, so real Google/Email-Password sign-in can be tested locally without deploying. The `*.run.app` URL (from P8.2) and later `admin.bachmancc.org` get added to Firebase **Authentication → Settings → Authorized domains** here, at deploy time.                                                                                                                      |
| P8.4 | Apply `schema.sql` to Neon **prod** (`main`) branch; bootstrap prod admin.                                                                                 | main  | P8.2, P1.5  | **DONE (2026-08-05)** — ✅ **full §5 schema applied to prod** (all tables + `reservations.group_id/series_id`; verified live via PgAdmin apply of `db/schema.sql`) **and** ✅ **prod admin bootstrapped** (`@bachmancc.org` admin, swap complete, `ALLOWED_EMAIL_DOMAIN` set — see P4.4). Both prod-DB deliverables of this task are complete and verified live. Note prod was written to ahead of a formal deploy (pre-release), so this ran before P8.2 — no remaining prod-DB work for P8.5. |
| P8.5 | Production smoke test (login per provider, create block, storefront reflects).                                                                             | main  | P8.4        | BLOCKED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### P10 — GCP organization & project structure

Foundational cloud layout for **both** the admin app and the storefront. This precedes the
P8 deploy tasks — Cloud Run, Secret Manager, and Identity Platform all need their target
project to exist first (resolves Q4). Target hierarchy:

```
bachmancc.org                             (Organization)
└── bcc-rentals                           (Folder)
    ├── bcc-storefront-prod               (Cloud Run · Identity Platform: customers)
    ├── bcc-storefront-staging
    ├── bcc-admin-prod                    (Cloud Run · Identity Platform: staff · Secret Mgr: Neon creds)
    └── bcc-admin-staging
```

Rationale (see architecture discussion): one project **per app × environment** for IAM/blast-radius
isolation (the admin app is a privileged second writer to the shared prod DB; the storefront is
public), independent per-project runtime service accounts + Secret Manager, separate Identity
Platform user pools (staff vs customers), and per-project billing. The shared DB is Neon (external
to GCP), so nothing forces the two apps to co-locate.

**An Organization needs an identity account bound to a domain you control.** A GCP Org is created
automatically once a **Cloud Identity** _or_ **Google Workspace** account is associated with
`bachmancc.org`. Cloud Identity **Free** is sufficient and $0; Google Workspace for
Nonprofits (if eligible) also yields the Org and adds the collaboration suite — see the director
note below.

| ID    | Task                                                                                                                                                                                                                                                                                                                                                                                        | Owner | Depends      | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P10.1 | **Talk to the community-center director** about adopting Google Workspace for Nonprofits (features listed below). Decide: Cloud Identity Free only, or Workspace for Nonprofits too. Confirm the org owns/controls the `bachmancc.org` domain + DNS.                                                                                                                                        | main  | —            | TODO                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P10.2 | Register the identity account for `bachmancc.org`: **Cloud Identity Free now** (creates the Org immediately, unblocks everything downstream), **and** apply for **Google Workspace for Nonprofits** if the director opts in (eligibility runs through Google for Nonprofits / a validation partner and can take days–weeks — don't let it gate P10.3). Verify domain ownership via DNS TXT. | main  | P10.1        | TODO                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P10.3 | Create the GCP **Organization** `bachmancc.org` (auto-appears on first Cloud Console sign-in as the identity account) and the **folder** `bcc-rentals`. Apply baseline org policies + a budget alert.                                                                                                                                                                                       | main  | P10.2        | DONE (2026-07-23 — org `513346324292` pre-existed; folder `bcc-rentals`=`873642981137`; $50/mo budget w/ 50/90/100% alerts on billing acct `01E5FF-02B2AA-CE23CF`. Baseline org policies: recommended, awaiting human decision — see log.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P10.4 | Create the four projects under `bcc-rentals`: `bcc-storefront-prod`, `bcc-storefront-staging`, `bcc-admin-prod`, `bcc-admin-staging`. Per project: link billing, enable Cloud Run, create a least-privilege runtime SA, enable Identity Platform (customers on storefront, staff on admin). Store Neon creds in **`bcc-admin-prod`** Secret Manager.                                        | main  | P10.3        | DONE (2026-07-23 — 4 projects created & billing-linked; APIs enabled (run, artifactregistry, identitytoolkit, secretmanager, iam); `run-runtime` SA per project; `DATABASE_URL` secret shell in `bcc-admin-prod` w/ runtime-SA `secretAccessor` — value added out-of-band by human. Identity Platform pool config (staff/customer) deferred to P4/P8.)                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P10.5 | Bring the storefront under the org. Original plan was to **re-parent** the personal-account project; changed to **redeploy** (see note).                                                                                                                                                                                                                                                    | main  | P10.3, P10.4 | DONE for **staging** (2026-07-23 — redeployed `bcc-rentals-frontend` into `bcc-storefront-staging` (`78017895905`), Cloud Run `us-east1`, service `bcc-rentals`, URL `https://bcc-rentals-78017895905.us-east1.run.app`). **Decision reversed: redeploy, not re-parent** — the org has domain-restricted sharing on by default (`iam.allowedPolicyMemberDomains`), which blocks moving a project owned by external `dphanks@gmail.com` into the folder (and blocks adding gmail identities to any org resource). Redeploy was cleaner for a dev site. Personal `bcc-rentals` project under `dphanks@gmail.com` still exists (untouched) — decommission once the org deployment is promoted. **TODO if wanted:** prod storefront redeploy into `bcc-storefront-prod` + domain mapping. |

**Director note — Google Workspace for Nonprofits features (for the P10.1 conversation):**
Google grants eligible nonprofits Google Workspace at no cost, which bundles the collaboration
tools most churches/community centers already want. Highlights: **Email** — professional
addresses on your own domain (e.g. `office@bachmancc.org`), shared mailboxes, and
distribution groups via Gmail. **Storage** — pooled **Google Drive** (typically ~100 TB shared
across the organization) with Shared Drives so files belong to the org rather than an individual,
plus the **Docs / Sheets / Slides / Forms** editors. **Calendars** — shared **Google Calendar**
for staff scheduling, bookable resources (rooms/equipment), and event coordination. Also included:
**Google Meet** video conferencing, **Google Sites**, **Google Groups**, and centralized admin
controls (user management, security policies, 2-step verification enforcement). Adopting Workspace
also produces the Cloud Identity account that backs the GCP Organization above, so P10.2 and the
center's day-to-day productivity tooling can be handled in one signup.

### P11 — UX polish & first-use fixes (human feedback, 2026-09-03)

Feedback from the first real walkthrough of the merged P6 surface. These are **UI/UX defects and
gaps**, not engine work: no schema change is required for any of them (`app_users.name` already
exists; `items.pricing_unit` already exists). All are unblocked — P6 is DONE — and none block each
other, so they can fan out to parallel `code-writer` worktrees. **P11.2 (logout) is the priority:**
a signed-in user currently has no way to sign out from the UI.

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Owner            | Depends | Status                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------- | ---------------------- |
| P11.1  | **Nav must show only what the role can reach.** Signing in as a `scheduler` and clicking **Products** throws `ForbiddenError: Admin role required` — [app/products/page.tsx:29](../app/products/page.tsx#L29) calls `requireAdmin()`, but [components/nav/nav-config.ts:22](../components/nav/nav-config.ts#L22) has no `adminOnly: true` on the Products entry. Fix that entry **and** audit every row in `NAV_ITEMS` against the guard its page actually calls (`/prices` = `requireScheduler`, `/categories` + `/users` = `requireAdmin`, …) so the two can't drift again. Server guards stay the real boundary; this is the cosmetic half. Add a test asserting nav entries ⊆ role-reachable routes. | code-writer      | P5.1    | TODO **(high)**        |
| P11.2  | **Account menu with Logout (PRIORITY).** [components/sign-out-button.tsx](../components/sign-out-button.tsx) exists but is **rendered nowhere**, so there is no way to log out of the app. Replace the plain user label in [components/nav/AppNav.tsx](../components/nav/AppNav.tsx) with a circular avatar button in the top-right (GitHub/Facebook style — initials or gravatar-ish monogram from `name`/`email`) that opens a dropdown containing at minimum **Update profile** (→ `/profile`, P11.3) and **Logout** (wire the existing sign-out flow → `POST /api/auth/session` delete → redirect to `/login`). Keyboard-accessible (Esc/outside-click close, focus trap, `aria-expanded`). | code-writer      | P5.1    | TODO **(priority)**    |
| P11.3  | **Profile page `/profile`.** Signed-in user can view and update their own **name** (`app_users.name` — column already exists, no migration) and **see their role/group** read-only. Self-service only: the action must write only the caller's own row keyed by session UID (never accept a target uid/id from the form), leave `role`/`active` untouched, set `updated_at = now()`, and write `admin_audit_log`. Both roles may use it.                                                                                                                                                                                                        | code-writer      | P4.3    | TODO                   |
| P11.4  | **Non-generic favicon.** `public/` is empty and there is no `app/icon.*`, so the site shows the browser default. Design a BCC mark (monogram, or a nod to the Hamilton County flag) and ship it as `app/icon.svg` + `app/apple-icon.png` (App Router auto-wires these into `<head>`); include a 32×32-legible variant. Keep it readable at tab size.                                                                                                                                                                                                                                                                                             | graphic-designer | —       | TODO                   |
| P11.5  | **Calendar: week/month view toggle.** Add a view selector to `/calendar` (default stays **week**). Month view = day-cell grid for the month with per-day reservation bars/chips and overflow ("+N more"); prev/next/today operate on the selected unit. Persist the choice in the URL (`?view=month`) so it survives reload/share. Multi-day spanning bars and the block/confirmed styling from P5.2 must survive in both views.                                                                                                                                                                                                                 | code-writer      | P5.2    | TODO                   |
| P11.6  | **Calendar: one bar per reservation group, not per item.** Items booked together under the same `reservations.group_id` currently render as separate bars. Collapse them into a single bar showing the **reservation title** with the included **items as a subtitle**, truncated with an ellipsis + count when the list is too long (full list in the tooltip/`title`); the bar links to `/reservations/[groupId]` as today. Ungrouped rows (`group_id IS NULL`, e.g. storefront bookings) keep rendering individually.                                                                                                                          | code-writer      | P5.2    | TODO                   |
| P11.7  | **Calendar: filter flyout.** Panel with (a) **show cancelled** toggle — cancelled reservations are **hidden by default**, and (b) **filter by product** (multi-select over `items`). Filter state in the URL so it survives navigation; show an active-filter count on the trigger. Must compose with P11.5's view toggle and P11.6's grouping (a group is shown if **any** of its items match).                                                                                                                                                                                                                                                 | code-writer      | P5.2    | TODO                   |
| P11.8  | **Prices page: show the pricing unit.** `/prices` renders a bare `$25`; it must render `$25/hr` (and `/day`, `/event`) using `items.pricing_unit` (`hour \| day \| event`, already on the item — no schema change). Apply to base rate, effective rate, and override rows. Money stays integer cents; formatting only.                                                                                                                                                                                                                                                                                                                           | code-writer      | P6.3    | TODO                   |
| P11.9  | **Add Reservation: one shared date/time for the whole booking.** All line items are reserved for the same window, so lift **Date / Start / End** out of the per-line-item box in [app/reservations/new/reservation-form.tsx](../app/reservations/new/reservation-form.tsx) into their own "When" box above the line items, and feed that single window to every line item on submit. Keep the recurrence controls with it. Server action + booking payload adjust accordingly (P6.1 race-safe path unchanged).                                                                                                                                   | code-writer      | P6.1    | TODO                   |
| P11.10 | **Add Reservation: don't wipe the form on error.** When submission fails (validation or a capacity/conflict rejection) the fields reset to empty. Echo the submitted values back through the action's result state so every field — line items, contact, notes, and the shared date/time from P11.9 — retains what the user typed, with the error shown alongside. Cover with a test that a failing submit round-trips the values.                                                                                                                                                                                                                | code-writer      | P6.1    | TODO                   |

---

## ▶ Next session — start here

Context: **the entire P6 admin CRUD surface is built and merged to `master` (tip `9f60fb1`).**
P0–P5, P9.1/P9.2, and every P6 screen (P6.1 Add Reservation, P6.2 Edit Reservation, **P6.3
Prices, P6.4 Products, P6.5 Categories** — the 2026-09-02 wave, merged to trunk 2026-09-03 —
and P6.6 Users) are DONE. Engine, recurrence, repositories, real Firebase auth, app shell,
weekly calendar, the `@bcc/scheduler` shared package, and all admin CRUD flows exist and are
green on trunk: **418 tests / 25 files** (re-verified on `master` 2026-09-03), typecheck +
lint + `next build` clean. Trunk is no longer stale — branch straight off `master`.

**Housekeeping**

- `npm install` if `node_modules` is absent.
- **Branch prune: DONE 2026-09-03** — all 24 branches merged into `master` deleted, and the 7
  worktrees holding them removed. **Four leftovers remain**, all wave-3 branches that are not
  ancestors of `master` (their content landed via the `c648610` integration merge as different
  commits): `code-writer/p4-auth`, `code-writer/p5.1-shell`, `code-writer/p5.2-calendar`,
  `code-writer/p9.2-shared-pkg`. Checked — they add **no unique source files** (only stale
  `.claude/agents/*.md` copies; everything else is an older variant of a file `master` already
  has), so they are safe to force-delete. Two still have worktrees: `git worktree remove` the
  two under `.claude/worktrees/`, then `git branch -D` all four.
- **Fix `.gitignore`**: it has `node_modules/` with a **trailing slash**, which matches
  directories only — so the `node_modules` symlink each agent worktree needs shows as
  *untracked* and is one `git add -A` from committing an absolute-path symlink. A bare
  `node_modules` line is in `.git/info/exclude` as a local stopgap; fold it into `.gitignore`.

**New since the walkthrough (2026-09-03): [P11 — UX polish & first-use fixes](#p11--ux-polish--first-use-fixes-human-feedback-2026-09-03).**
Ten UI/UX defects and gaps found on the first real click-through of the merged P6 surface. No
schema change needed for any of them. Two are outright bugs a user hits immediately:

- **P11.2 (priority)** — there is **no way to log out**: `components/sign-out-button.tsx` exists
  but is rendered nowhere. Wanted: a circular avatar button top-right with a dropdown
  (**Update profile**, **Logout**).
- **P11.1 (high)** — schedulers see **Products** in the nav but the page calls `requireAdmin()`,
  so clicking it throws `ForbiddenError`. Nav entry needs `adminOnly: true` + an audit of the
  whole `NAV_ITEMS` list against each page's guard.

The rest: **P11.3** profile page (edit own name, see role), **P11.4** real favicon,
**P11.5–P11.7** calendar week/month toggle + group-per-reservation bars + filter flyout
(cancelled hidden by default, filter by product), **P11.8** prices show `$25/hr` not `$25`,
**P11.9–P11.10** Add Reservation shared date/time box + no field reset on error. All ten are
unblocked and mutually independent — good candidates for a parallel `code-writer` worktree wave.

**Pick any of these — all unblocked, none block each other:**
| Task | What | Owner | Notes |
|---|---|---|---|
| P11.2 → P11.1 | **(do first)** Logout / account menu, then the role-aware nav fix. Both are user-visible breakage, both are small. | code-writer | New 2026-09-03. |
| P11.3–P11.10 | Profile page, favicon, calendar view toggle + grouping + filters, price units, reservation form fixes. | code-writer / graphic-designer | New 2026-09-03; fan out. |
| P6.7 | **(recommended)** Full-flow tests — cross-screen journeys the per-action unit tests can't reach: create product → price it → book it → cancel; recurring + multi-item booking; server-side role denial on every mutating action. | test-engineer | **Newly unblocked** — P6.1–P6.6 all DONE. |
| P7.1 | **(main-owned, not a code-writer delegation — touches the shared prod DB)** Create a block/reservation in admin → confirm the storefront reflects it within ~30s and won't double-book that window. | main | Deps P6.1 DONE. |
| P8.1→P8.2 | Deploy runbook, then deploy to `bcc-admin-prod`. | main | Unblocked since P10.4. Human-gated. |
| P6.8 | **(medium)** Invite-exception to the email-domain guard: let an invited outside-domain user bind on first sign-in (domain match **or** explicit pending invite), keeping the wall up for everyone else. Useful for testing with other users. | code-writer | Deps P6.6 DONE. |
| P9.3→P9.4 | Refactor storefront **and** admin to import from `@bcc/scheduler`; remove duplicated copies; reconcile `TODO(P9)` markers; run both suites. | code-writer | Deps P9.2 DONE. Cross-repo (touches the storefront) — heavier. |

Wire `writeAuditLog` into **every** mutating action (P3.2 writer exists).
P6.9 (real invitation email) is LOW/optional and not required for launch.

**Isolation reminder (learned the hard way in wave 2):** launch parallel `code-writer` agents
with `isolation: "worktree"`. Wave 2 ran them in one shared tree and the branch labels
scrambled (recoverable, but avoidable). One shared tree = one branch pointer they fight over.
Worked cleanly in the 2026-09-02 wave: three agents, disjoint file sets, **zero merge conflicts**.

**Worktree setup (2026-09-02):** symlink `node_modules` from the primary tree instead of a slow
`npm install` — `vitest`/`tsc`/`next lint` all run fine through it. Two gotchas: the symlink is
**not** covered by `.gitignore`'s `node_modules/` (see housekeeping above), and worktrees have
**no `.env.local`**, so `next build` there fails fast on missing `NEXT_PUBLIC_*` at whichever
route first reaches the Firebase client config — an env artifact, not a code defect. Inject
dummy env on the command line for a real build signal; never copy `.env.local` into a worktree.

**Model note (corrected 2026-09-02):** use **full versioned model IDs** — `claude-sonnet-5` and
`claude-opus-5` work; bare `claude-sonnet`/`claude-opus` and the Agent-tool `sonnet` enum all
fail with `model_not_found`. All six agents in `~/.claude/agents/` are now correctly pinned, so
launch them with **no** `model:` override. Agent definitions are cached at session start, so
editing a pin needs a session restart.

**Resolved since wave 3:** real Firebase auth (Q2 — client + Admin SDK wired), prod-admin
bootstrap (**Q3 + P4.4 DONE 2026-08-05** — `@bachmancc.org` admin live in prod, `ALLOWED_EMAIL_DOMAIN`
set), and **P8.4 DONE** (full §5 schema on prod + admin bootstrapped). `bcc-admin-prod` exists
(P10.4) so **P8.1 (deploy runbook) + P8.2 (deploy) are unblocked**. Still open on the deploy path:
**P8.3** (map `admin.bachmancc.org` + Firebase Authorized Domains at deploy) and **P8.5** (prod
smoke test, after deploy). **P7.1 (live-DB cross-system check) is now unblocked** — P6.1 landed,
so a real block can be created in the admin app and checked against the storefront.

**Merge protocol reminder:** `git merge` requires human approval in this environment —
code-writer builds/verifies on a branch and stops; a human runs the merge. For a multi-agent
wave, assemble one integration branch, verify the **combined** tree, then hand off one merge.

---

## Progress log

Moved to **[LOG.md](./LOG.md)** — the dated log of work as it lands. Append new entries there;
keep this file focused on phases + status.
