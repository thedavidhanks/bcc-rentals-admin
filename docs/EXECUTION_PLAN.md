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

## Current state (as of 2026-07-22)

**Foundation + reservation engine + repositories are built, verified, and merged to
`master`** (foundation merge `7707a88`; wave 2 fast-forwarded to tip `90e1659`). Working
tree clean. A new session can `npm install && npm run build` and it passes; `npm test` is
**92/92 green**. Neon **dev** branch has the §5 schema applied (P1.5).

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

| # | Question | Blocks | Default if unanswered |
|---|---|---|---|
| Q1 | ✅ **ANSWERED + repo now provided:** https://github.com/thedavidhanks/bcc-rentals-frontend (public, default branch `main`). Strategy: do **not** duplicate — extract functions common to storefront + admin into a **shared/common area** and consume it from both (see P9). Copy verbatim from the storefront in the interim if consolidation lags. | P2, P5, P6 (quality) | ~~Awaiting repo address~~ — **resolved**; the race-safe write + policy can now be copied from the storefront instead of reimplemented from spec pseudocode. |
| Q2 | **Firebase / Identity Platform project details**: project id, Web SDK config keys, and which social providers to enable (Google/GitHub/Facebook/Apple). Each needs its own OAuth app. | P4 | Cannot complete auth; stub a dev-only bypass gated behind `NODE_ENV !== 'production'` so other phases proceed. |
| Q3 | **First admin's Firebase UID** for the bootstrap insert (§5). Requires that person to sign in once. | P4.4 | Defer; leave a documented one-liner to run later. |
| Q4 | **GCP project id + confirm domain** `admin.bachmancc.org` and DNS control. | P8 | Deploy phase stays BLOCKED. |
| Q5 | ✅ **ANSWERED (2026-07-20):** human gave go-ahead; `schema.sql` applied to the Neon **dev** branch (`DATABASE_URL_DEV`) and verified. Prod (`main` branch) still pending under P8.4. | P1.4 (apply) | ~~Write `schema.sql` as a file only~~ — resolved. |

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
| P0.2 | Scaffold Next.js (App Router) + TypeScript; `next.config.ts` with `output: 'standalone'`; ESLint/TS strict. | code-writer | P0.1 | DONE (`7707a88`) |
| P0.3 | Add `Dockerfile` + `.dockerignore` for standalone build (adapt storefront's; no PayPal). | code-writer | P0.2 | DONE (`7707a88`) |

### P1 — Data layer & config
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P1.1 | `lib/db.ts`: `pg` `Pool` (`getPool()`) + `withTransaction()` (mirror storefront `lib/scheduler/db.ts`). `import "server-only"`. | code-writer | P0.2 | DONE (`7707a88`; `TODO(P9)`: reconcile SSL + shape vs storefront) |
| P1.2 | `lib/env.ts`: Zod validation of §11 vars; **fail-fast at boot**. `import "server-only"`. | code-writer | P0.2 | DONE (`7707a88`; split: `lib/env.ts` server + `lib/public-env.ts` client) |
| P1.3 | Rewrite `.env.local.example` to the admin var set (§11): drop PayPal/Resend/Upstash; add `NEXT_PUBLIC_FIREBASE_*`, `FIREBASE_PROJECT_ID`, `ALLOWED_EMAIL_DOMAIN`. | code-writer | — | DONE (`7707a88`) |
| P1.4 | `db/schema.sql` (§5, correct FK ordering: series → groups → alter reservations → audit) + `scripts/db/apply-schema.mjs` (mirror storefront). **File only — do not apply** (see Q5). | code-writer | P1.1 | DONE (`7707a88`; apply refuses prod unless `APPLY_TO_PROD=1`) |
| P1.5 | Apply `schema.sql` to Neon **dev** branch, verify tables/columns/indexes. | main | P1.4, Q5 | DONE (2026-07-20; verified: app_users, reservation_groups, reservation_series, admin_audit_log + reservations.group_id/series_id + indexes) |

### P2 — Reservation engine (race-safe core)
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P2.1 | Port/implement race-safe single-item write: advisory lock → buffered overlap capacity recheck → insert `status='block'`, in one txn (spec §8). | code-writer | P1.1, Q1 | DONE (`4f7f11f`, merged to `master` ff `90e1659`) |
| P2.2 | Multi-item / multi-occurrence booking: one txn, stable-order locks, all-or-nothing, report failing (item × date). | code-writer | P2.1 | DONE (`4f7f11f`) |
| P2.3 | Policy helpers (lead/horizon/available-hours/slot alignment, Eastern) — mirror storefront `policy.ts`; staff blocks may bypass lead/horizon but never capacity. | code-writer | P2.1 | DONE (`4f7f11f`) |
| P2.4 | Recurrence expansion: rule → concrete Eastern occurrence dates; cap (horizon_days or 104), surface truncation. | code-writer | — | DONE (`3636301`) |
| P2.5 | Unit tests: overlap boundaries (half-open), buffer widening, capacity math, recurrence expansion, DST edges. | test-engineer | P2.1–P2.4 | DONE — covered by the code-writers' own suites (scheduler-policy/client/booking + recurrence); 92/92 green on `master`. NOTE: all unit-level (mocked `pg`); no live-DB integration test yet (P7.1). |

### P3 — Repositories & audit
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P3.1 | Typed repositories for `items`, `item_prices`, `categories`, `item_categories`, `reservations`, `reservation_groups`, `reservation_series`, `app_users`. | code-writer | P1.1 | DONE (`0509643`, merged to `master` ff `90e1659`) |
| P3.2 | `admin_audit_log` writer; call on **every** mutation (action, entity, entity_id, before/after detail). | code-writer | P3.1 | DONE (`0509643`) — writer exists; wiring it into each mutation happens as P4/P6 actions land |

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
consumed by both storefront and admin, not duplicated. **The storefront repo is now
available** (https://github.com/thedavidhanks/bcc-rentals-frontend, public, `main`), so
this phase is unblocked. Code written in P2/P3 that mirrors storefront logic is tagged
`// TODO(P9): consolidate` so it's easy to find and hoist.

| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P9.1 | ~~Obtain storefront repo (address from human)~~ — **repo provided: https://github.com/thedavidhanks/bcc-rentals-frontend** (public, `main`). Remaining: decide the shared-code mechanism (e.g. workspaces monorepo package `@bcc/scheduler`, git submodule, or published internal pkg). | main | Q1 addr | TODO (unblocked — repo in hand; pick mechanism) |
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

## ▶ Next session — start here

Context: P0–P3 are DONE and merged (foundation `7707a88`; wave 2 tip `90e1659`). The engine,
recurrence, and repositories exist and are green. Pick up here.

**First: housekeeping**
- `npm install` if `node_modules` is absent.
- Prune stale wave-2 branches (all content is now in `master`): `code-writer/foundation-scaffold`,
  `code-writer/p2-engine`, `code-writer/p2.4-recurrence`, `code-writer/p3-repositories`,
  `integration/wave2`.

**Delegate this wave now (unblocked):**
| Task | What | Owner | Notes |
|---|---|---|---|
| P4.1–P4.3 (on stub) | Auth plumbing — middleware, session-cookie verify, UID→`app_users` role lookup, `requireScheduler`/`requireAdmin` — against the Q2 **dev-bypass stub** (`NODE_ENV !== 'production'`). Swap in real Firebase when Q2 lands. | code-writer | Unblocks the P5 shell/calendar; wire `writeAuditLog` into any mutating action. |
| P5.1 | Responsive app shell + menu bar (stub auth OK). | code-writer | Depends on P4.3 guards existing (stub is fine). |
| P5.2 | Weekly calendar (reads reservations via P3 repos). | code-writer | |
| P9.1→P9.2 | Stand up the `@bcc/scheduler` shared package; begin extracting the common surface. | code-writer | Mechanism decided: npm-workspaces monorepo pkg, sequenced now that engine/repos have landed. |

**Isolation reminder (learned the hard way in wave 2):** launch parallel `code-writer` agents
with `isolation: "worktree"`. Wave 2 ran them in one shared tree and the branch labels
scrambled (recoverable, but avoidable). One shared tree = one branch pointer they fight over.

**Model note:** `code-writer`/`test-engineer` are pinned to `claude-sonnet-4-5` (NOT enabled
here) — pass `model: opus` when launching or they fail immediately.

**Still blocked until the human provides answers** (see open-questions table): P4 real auth
(Q2) + prod-admin bootstrap (Q3), P8 deploy (Q4 — new dedicated GCP project recommended).
P7.1 (live-DB cross-system check) waits on the P6 booking UI.

**Merge protocol reminder:** `git merge` requires human approval in this environment —
code-writer builds/verifies on a branch and stops; a human runs the merge. For a multi-agent
wave, assemble one integration branch, verify the **combined** tree, then hand off one merge.

---

## Progress log

- 2026-07-20 — Plan created from ADMIN_APP_SPEC.md. Confirmed fresh scaffold, no git,
  storefront source not present locally (Q1), env files are storefront-inherited.
- 2026-07-20 — P0.1 done (git init + .gitignore, .env.local confirmed ignored). Foundation
  wave (P0.2, P0.3, P1.1–P1.4) handed to code-writer agent (background).
- 2026-07-20 — Q1 answered: human will provide storefront repo address; consolidate common
  code into a shared area rather than duplicating → added phase P9. Reimplemented-from-spec
  code to carry `// TODO(P9): consolidate` markers.
- 2026-07-20 — Foundation wave (P0.2, P0.3, P1.1–P1.4) built + verified GREEN by code-writer
  on branch `code-writer/foundation-scaffold` (commit `555674c`): `lint`, `typecheck`,
  `vitest` (3/3), `build` all pass. **Merge into `master` is blocked by a permission guard**
  (`git merge` denied) — needs human approval. Notes: `next`/`vitest` bumped for CVEs;
  env split into server (`lib/env.ts`) + client (`lib/public-env.ts`). Reconcile SSL config
  and `withTransaction` shape against storefront under P9.
- 2026-07-20 — Human merged the foundation branch → `master` (merge commit `7707a88`).
  P0.2–P1.4 now DONE; tree clean. Next wave = P2.4, P3.1, P3.2 (+ P2.4 tests), delegatable
  in parallel to `code-writer`/`test-engineer` (must pass `model: opus` — pinned model
  unavailable here). See "▶ Next session — start here". P2.1–P2.3 wait on Q1 repo address.
- 2026-07-20 — **P1.5 DONE:** with human go-ahead (Q5 answered), applied `db/schema.sql` to the Neon
  **dev** branch via `npm run db:apply` (`DATABASE_URL_DEV`, idempotent). Verified present: tables
  `app_users`, `reservation_groups`, `reservation_series`, `admin_audit_log`; `reservations.group_id`
  + `reservations.series_id`; and the new indexes. Prod apply remains P8.4. P9.1 mechanism decided:
  monorepo `@bcc/scheduler` shared package, sequenced AFTER the current engine/repo branches land.
- 2026-07-20 — Wave 2 dispatched (3 parallel `code-writer` agents, `model: opus`): P2.4 recurrence,
  P3.1+P3.2 repositories & audit, P2.1–P2.3 race-safe engine copying storefront
  `lib/scheduler/{db,client,policy}.ts`. Each: no DDL, no deploy, no `.env.local`, run checks
  in-branch and STOP before merge (merge is human-gated), self-run tests instead of the
  test-engineer subagent (pinned model unavailable).
- 2026-07-21 — **Wave 2 complete, all green — MERGE PENDING (human).** All three agents delivered
  clean, non-overlapping commits, but running them in one **shared working tree without worktree
  isolation** scrambled the branch labels (each agent's commit landed on whichever branch HEAD had
  drifted to). No work lost — commits are clean by SHA. Untangled by assembling one integration
  branch **`integration/wave2`** = `master` + `0509643` (P3 repos+audit) + `4f7f11f` (P2.1–P2.3
  engine) + `3636301` (P2.4 recurrence, cherry-picked). Verified the **combined** tree: `lint` ✓,
  `typecheck` ✓, `npm test` **92/92 (8 files)** ✓, `build` exit 0. **Next: human runs
  `git merge integration/wave2` into `master`**, then mark P2.1–P2.5, P3.1, P3.2 DONE with the
  merge commit. LESSON: launch parallel `code-writer` agents with `isolation: "worktree"` to avoid
  shared-tree branch scrambling. Stale mislabeled branches (`code-writer/p2-engine`,
  `code-writer/p2.4-recurrence`, `code-writer/p3-repositories`, `code-writer/foundation-scaffold`)
  can be pruned after the merge.
- 2026-07-20 — **Storefront repo address provided:** https://github.com/thedavidhanks/bcc-rentals-frontend
  (verified reachable via `git ls-remote`; public, default branch `main`). Q1 fully resolved.
  Unblocks P2.1–P2.3 (copy race-safe write + policy from the storefront instead of
  reimplementing from spec) and P9.1 (repo in hand — next step is choosing the shared-code
  mechanism). Updated Q1 row, P9.1, the P9 intro, the "Next session" guidance, and CLAUDE.md's
  storefront-reference section accordingly. Repo is *not* vendored into this repo — copy/consolidate.
- 2026-07-22 — **Wave 2 MERGED to `master` (fast-forward, tip `90e1659`).** Human ran the merge.
  P2.1–P2.5, P3.1, P3.2 now DONE (`0509643` repos+audit, `4f7f11f` engine, `3636301` recurrence).
  `master` green: `npm test` 92/92, `build` exit 0. Refreshed "Current state" and "Next session".
  Stale wave-2 branches can be pruned (all content is on `master`). **Next wave:** P4 auth on the
  dev-bypass stub → P5.1/P5.2 shell + calendar → begin P9.1/P9.2 shared package — launch parallel
  code-writers **with `isolation: "worktree"`** this time. Still blocked on human: Q2 (Firebase),
  Q3 (prod admin UID), Q4 (dedicated GCP project + `admin.bachmancc.org`).
</content>
</invoke>
