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

## Current state (as of 2026-07-26)

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

| # | Question | Blocks | Default if unanswered |
|---|---|---|---|
| Q1 | ✅ **FULLY RESOLVED:** repo https://github.com/thedavidhanks/bcc-rentals-frontend (public, default branch `main`, verified reachable 2026-07-23, tip `1074a9e`). Strategy: do **not** duplicate — extract functions common to storefront + admin into a **shared/common area** and consume it from both (see P9). Mechanism **decided**: npm-workspaces monorepo package `@bcc/scheduler`. Copy verbatim from the storefront in the interim if consolidation lags. | P2, P5, P6 (quality) | ~~Awaiting repo address~~ — **resolved**; the race-safe write + policy can now be copied from the storefront instead of reimplemented from spec pseudocode. |
| Q2 | ✅ **ANSWERED (2026-07-26, staging).** Firebase project **`bcc-admin-staging`** config supplied in `.env.local` (all `NEXT_PUBLIC_FIREBASE_*` + `FIREBASE_PROJECT_ID` set; values never echoed). **Enabled sign-in methods for launch: Google + Email/Password** (GitHub/Facebook/Apple deferred). Both halves wired real: client (`lib/auth/firebase-client.ts`, `firebase`) + server Admin SDK (`lib/auth/session.ts`, **P4.2 DONE**, `firebase-admin`) + Email/Password inputs in `app/login`. **Only remaining before Q2 is fully closed:** Authorized Domains added at deploy = **P8.3**. Prod (`bcc-admin-prod`) Firebase config still to gather at deploy time. | P4 | ~~Cannot complete auth; stub dev-only bypass~~ — **resolved**; end-to-end real auth implemented (P8.3 authorized domains remain). |
| Q3 | **First admin's Firebase UID** for the bootstrap insert (§5). Requires that person to sign in once. | P4.4 | Defer; leave a documented one-liner to run later. |
| Q4 | **GCP project id + confirm domain** `admin.bachmancc.org` and DNS control. Now largely superseded by **P10** — the org/project structure (`bcc-admin-prod` etc.) produces the concrete project ids the deploy needs. | P8, P10 | Deploy phase stays BLOCKED until P10.4 creates `bcc-admin-prod`. |
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
| P4.1 | Firebase Web SDK client sign-in UI (multi-provider); returns ID token. | code-writer | P0.2, Q2 | DONE (`961209f` stub) + **real client wired 2026-07-26** (`lib/auth/firebase-client.ts` — real Web SDK: `signInWithProvider` Google popup + `signInWithEmailPassword`; `firebase` installed) + **Email/Password inputs added to `app/login/login-form.tsx`** (real path now: email/password form + Google button). typecheck/lint clean. Not yet committed/merged. |
| P4.2 | Server: Admin SDK `verifyIdToken` → session cookie via `createSessionCookie`; verify cookie in middleware. ADC on Cloud Run, key only for local dev. | code-writer | P1.1, Q2 | **DONE 2026-07-26** — real `firebase-admin` swapped into `lib/auth/session.ts`: `verifyIdToken(idToken, true)` → `createSessionCookie` (mint), `verifySessionCookie(value, true)` → identity (read; returns `null` on invalid/revoked). Cached `getAdminAuth()` uses ADC (Cloud Run runtime SA) or `GOOGLE_APPLICATION_CREDENTIALS` locally. `firebase-admin` installed; 4 real-path unit tests added (`tests/auth-session.test.ts`, admin mocked). Edge boundary preserved — `middleware.ts` stays cookie-presence-only. End-to-end real sign-in now complete (client P4.1 + this). Not yet committed/merged. |
| P4.3 | UID → `app_users` → role lookup; deny unknown users. `requireScheduler` / `requireAdmin` guards used in **every** mutating route/action. Optional custom-claim mirror. | code-writer | P4.2, P3.1 | DONE (`961209f`, `lib/auth/guards.ts`; nav role type aligned to canonical `UserRole` `c648610`) |
| P4.4 | Bootstrap first admin (§5 insert) once their UID is known. | main | P4.3, Q3 | BLOCKED (Q3) |

### P5 — UI: navigation & calendar
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P5.1 | Responsive app shell + menu bar (Calendar, Products, Add Reservation, Update Prices; admin: Categories, Users) collapsing to hamburger; hide admin entries for schedulers (server still enforces). | code-writer | P4.3 | DONE (`e68274c`, `components/nav/*` role-aware shell) |
| P5.2 | Weekly calendar: 7 columns, multi-day spanning bars, cross-week `<`/`>` continuation indicators, confirmed vs block styling, greyed/omitted cancelled, prev/next/today, `+` button → Add Reservation. | code-writer | P3.1, P5.1 | DONE (`a891d05`, `app/calendar/*` + `calendar-week` tests) |

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
available** (https://github.com/thedavidhanks/bcc-rentals-frontend, public, `main`,
verified reachable 2026-07-23, tip `1074a9e`), so this phase is unblocked. The shared-code
**mechanism is decided: an npm-workspaces monorepo package `@bcc/scheduler`.** Code written
in P2/P3 that mirrors storefront logic is tagged `// TODO(P9): consolidate` so it's easy to
find and hoist.

| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P9.1 | ~~Obtain storefront repo (address from human)~~ + ~~decide the shared-code mechanism~~. Repo provided & verified: https://github.com/thedavidhanks/bcc-rentals-frontend (public, `main`). Mechanism chosen: **npm-workspaces monorepo package `@bcc/scheduler`**. Standing up the package + extraction is P9.2. | main | Q1 addr | DONE (2026-07-23 — repo confirmed reachable; mechanism = npm-workspaces `@bcc/scheduler`) |
| P9.2 | Identify the common surface: `scheduler/{db,client,policy}`, `products/{types,repository}`, env/time/money helpers. Extract into the shared package. | code-writer | P9.1 | DONE (`809785a`, `packages/scheduler` = `@bcc/scheduler`; exports `scheduler/{errors,policy,types}` + `products/types`; consumed via workspaces + tsconfig paths, no build step) |
| P9.3 | Refactor both storefront and admin to import from the shared package; remove duplicated copies; run both test suites. | code-writer | P9.2 | TODO |
| P9.4 | Reconcile any admin code that was reimplemented from spec pseudocode against the now-shared canonical implementation (all `TODO(P9)` markers). | code-writer | P9.3 | TODO |

### P8 — Deployment
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P8.1 | Adapt `DEPLOY_CLOUD_RUN.md` for admin: Firebase `NEXT_PUBLIC_*` build vars, no PayPal, `admin.bachmancc.org`, `--allow-unauthenticated` (app is the gate). | main | — | TODO |
| P8.2 | Deploy to Cloud Run `us-east1`; secrets in Secret Manager; grant runtime SA `secretAccessor`. | main | P8.1, P10.4 | TODO (unblocked — `bcc-admin-prod` exists w/ billing+APIs+`run-runtime` SA; `DATABASE_URL` secret + accessor already granted. Needs P8.1 runbook.) |
| P8.3 | Map `admin.bachmancc.org`; add to Firebase Authorized Domains + each provider callback list. | main | P8.2 | BLOCKED (Q4). NOTE (2026-07-26): **no Authorized Domain needed for local dev** — Firebase authorizes `localhost` by default, so real Google/Email-Password sign-in can be tested locally without deploying. The `*.run.app` URL (from P8.2) and later `admin.bachmancc.org` get added to Firebase **Authentication → Settings → Authorized domains** here, at deploy time. |
| P8.4 | Apply `schema.sql` to Neon **prod** (`main`) branch; bootstrap prod admin. | main | P8.2, P1.5 | BLOCKED |
| P8.5 | Production smoke test (login per provider, create block, storefront reflects). | main | P8.4 | BLOCKED |

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
automatically once a **Cloud Identity** *or* **Google Workspace** account is associated with
`bachmancc.org`. Cloud Identity **Free** is sufficient and $0; Google Workspace for
Nonprofits (if eligible) also yields the Org and adds the collaboration suite — see the director
note below.

| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P10.1 | **Talk to the community-center director** about adopting Google Workspace for Nonprofits (features listed below). Decide: Cloud Identity Free only, or Workspace for Nonprofits too. Confirm the org owns/controls the `bachmancc.org` domain + DNS. | main | — | TODO |
| P10.2 | Register the identity account for `bachmancc.org`: **Cloud Identity Free now** (creates the Org immediately, unblocks everything downstream), **and** apply for **Google Workspace for Nonprofits** if the director opts in (eligibility runs through Google for Nonprofits / a validation partner and can take days–weeks — don't let it gate P10.3). Verify domain ownership via DNS TXT. | main | P10.1 | TODO |
| P10.3 | Create the GCP **Organization** `bachmancc.org` (auto-appears on first Cloud Console sign-in as the identity account) and the **folder** `bcc-rentals`. Apply baseline org policies + a budget alert. | main | P10.2 | DONE (2026-07-23 — org `513346324292` pre-existed; folder `bcc-rentals`=`873642981137`; $50/mo budget w/ 50/90/100% alerts on billing acct `01E5FF-02B2AA-CE23CF`. Baseline org policies: recommended, awaiting human decision — see log.) |
| P10.4 | Create the four projects under `bcc-rentals`: `bcc-storefront-prod`, `bcc-storefront-staging`, `bcc-admin-prod`, `bcc-admin-staging`. Per project: link billing, enable Cloud Run, create a least-privilege runtime SA, enable Identity Platform (customers on storefront, staff on admin). Store Neon creds in **`bcc-admin-prod`** Secret Manager. | main | P10.3 | DONE (2026-07-23 — 4 projects created & billing-linked; APIs enabled (run, artifactregistry, identitytoolkit, secretmanager, iam); `run-runtime` SA per project; `DATABASE_URL` secret shell in `bcc-admin-prod` w/ runtime-SA `secretAccessor` — value added out-of-band by human. Identity Platform pool config (staff/customer) deferred to P4/P8.) |
| P10.5 | Bring the storefront under the org. Original plan was to **re-parent** the personal-account project; changed to **redeploy** (see note). | main | P10.3, P10.4 | DONE for **staging** (2026-07-23 — redeployed `bcc-rentals-frontend` into `bcc-storefront-staging` (`78017895905`), Cloud Run `us-east1`, service `bcc-rentals`, URL `https://bcc-rentals-78017895905.us-east1.run.app`). **Decision reversed: redeploy, not re-parent** — the org has domain-restricted sharing on by default (`iam.allowedPolicyMemberDomains`), which blocks moving a project owned by external `dphanks@gmail.com` into the folder (and blocks adding gmail identities to any org resource). Redeploy was cleaner for a dev site. Personal `bcc-rentals` project under `dphanks@gmail.com` still exists (untouched) — decommission once the org deployment is promoted. **TODO if wanted:** prod storefront redeploy into `bcc-storefront-prod` + domain mapping. |

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

---

## ▶ Next session — start here

Context: P0–P5 + P9.1/P9.2 are DONE and merged (foundation `7707a88`; wave 2 tip `90e1659`;
wave 3 tip `c648610`). Engine, recurrence, repositories, auth-on-stub, app shell, weekly
calendar, and the `@bcc/scheduler` shared package all exist and are green (139/139). Pick up
with the **P6 UI wave** — the CRUD screens that consume all of the above.

**First: housekeeping**
- `npm install` if `node_modules` is absent.
- **Prune stale wave-3 branches** (all content is on `master` via `c648610`):
  `code-writer/p4-auth`, `code-writer/p5.1-shell`, `code-writer/p5.2-calendar`,
  `code-writer/p9.2-shared-pkg`, `integration/wave3`, and their `.claude/worktrees/agent-*`
  worktrees (`git worktree remove` each, then `git branch -D`).

**Delegate this wave now (unblocked):**
| Task | What | Owner | Notes |
|---|---|---|---|
| **P6.1** | **Add Reservation** — multi-product line items + recurrence controls; on submit run the race-safe check across all (item × occurrence), no partial commit. **The next task.** | code-writer | Deps P2.2, P2.4, P5.2 all DONE. The `+` button + `app/reservations/new` route stub already exist; wire in the engine + `writeAuditLog`. |
| P6.3 | Update Prices — CRUD `item_prices` with §6 validation; warn if edit leaves no all-days/all-hours base row. | code-writer | Deps P3.1 DONE. Independent of P6.1 — parallelizable. |
| P6.4 | Products (admin) — Add/Edit (deactivate not delete, `updated_at=now()`, unique slug). | code-writer | Deps P3.1, P4.3 DONE. |
| P6.5 | Categories (admin) — CRUD `categories` + assign via `item_categories`. | code-writer | Deps P3.1, P4.3 DONE. |
| P6.6 | User management (admin) — CRUD `app_users`; guard last active admin. | code-writer | Deps P3.1, P4.3 DONE. |
| P9.3→P9.4 | Refactor storefront **and** admin to import from `@bcc/scheduler`; remove duplicated copies; reconcile `TODO(P9)` markers; run both suites. | code-writer | Deps P9.2 DONE. Cross-repo (touches the storefront) — heavier; can trail the P6 wave. |

Wire `writeAuditLog` into **every** mutating action in this wave (P3.2 writer exists).
P6.2 (Edit Reservation) depends on P6.1; P6.7 (full-flow tests) trails the whole P6 wave.

**Isolation reminder (learned the hard way in wave 2):** launch parallel `code-writer` agents
with `isolation: "worktree"`. Wave 2 ran them in one shared tree and the branch labels
scrambled (recoverable, but avoidable). One shared tree = one branch pointer they fight over.

**Model note:** `code-writer`/`test-engineer` are pinned to `claude-sonnet-4-5` (NOT enabled
here) — pass `model: opus` when launching or they fail immediately.

**Still blocked until the human provides answers** (see open-questions table): swapping the
auth stub for **real Firebase** (Q2) + prod-admin bootstrap (Q3, P4.4); P8.3/P8.4 deploy
(domain mapping + prod schema apply). `bcc-admin-prod` now exists (P10.4) so **P8.1 (deploy
runbook) + P8.2 (deploy) are unblocked**. P7.1 (live-DB cross-system check) waits on P6.1.

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
- 2026-07-23 — **Added phase P10 (GCP organization & project structure).** Decided the cloud layout:
  Organization `bachmancc.org` → folder `bcc-rentals` → four projects (`bcc-storefront-prod/staging`,
  `bcc-admin-prod/staging`), one per app × environment for IAM/blast-radius isolation. Tasks cover the
  director conversation about Google Workspace for Nonprofits (P10.1), registering **Cloud Identity Free**
  (creates the Org for $0, unblocks everything) and applying for **Workspace for Nonprofits** if opted in
  (P10.2), creating the Org+folder (P10.3), the four projects (P10.4), and re-parenting the storefront if
  it's currently standalone (P10.5). Included a director-facing paragraph listing Workspace features
  (email on the domain, pooled Drive storage + Docs suite, shared Calendars, Meet/Groups/admin controls).
  Updated Q4 (superseded by P10) and P8.2 depends → P10.4. No code changes.
- 2026-07-23 — **Corrected the org domain in P10 to `bachmancc.org`** (was `bachmancommunitycenter.org` — the
  real domain matches `admin.bachmancc.org` in the spec/CLAUDE.md). Updated the P10 hierarchy tree, prose,
  the P10.1–P10.3 rows, the example email, and the earlier P10 log entry. Human has completed **Cloud Identity
  Free signup + domain verification** for `bachmancc.org`, with `gcp-admin@bachmancc.org` as super admin
  (functional/role account — recommended over a personal address; note Cloud Identity Free has no mailbox, so
  a recovery email/phone + a second break-glass super admin are advised). **P10.2 intentionally NOT marked
  DONE** — human has follow-up questions before closing it.
- 2026-07-23 — **Q1 fully closed + P9.1 DONE.** Re-verified the storefront repo is reachable
  (`git ls-remote https://github.com/thedavidhanks/bcc-rentals-frontend` → `refs/heads/main` at
  `1074a9e`, public). With the repo in hand and the shared-code mechanism already decided
  (npm-workspaces monorepo package `@bcc/scheduler`), **P9.1 is complete** — standing up the
  package + extracting the common surface is P9.2 (next). Reconciled the doc so the Q1 row, P9.1
  row, P9 intro, and "Next session" table all agree (previously P9.1 still read "pick mechanism"
  while the log/Next-session said it was decided). No code changes.
- 2026-07-23 — **P10.3 + P10.4 DONE — GCP org/project architecture built** (driven from CLI as
  `gcp-admin@bachmancc.org`). Org `bachmancc.org` (`513346324292`) pre-existed; created folder
  **`bcc-rentals`** (`873642981137`) and the four projects: `bcc-storefront-prod` (`259601604284`),
  `bcc-storefront-staging` (`78017895905`), `bcc-admin-prod` (`305395393303`), `bcc-admin-staging`
  (`612782676839`). Human created Cloud Billing account **`01E5FF-02B2AA-CE23CF`** (`bachmancc-billing`)
  in Console (no CLI path exists); linked to all four. Per project enabled APIs: `run`,
  `artifactregistry`, `identitytoolkit`, `secretmanager`, `iam`, `cloudresourcemanager`; created a
  least-privilege **`run-runtime`** SA. In `bcc-admin-prod`: created **`DATABASE_URL`** secret shell +
  granted `run-runtime` `secretAccessor` on it (human pipes the value out-of-band — prod secret never
  entered the session). Created a **$50/mo budget** (50/90/100% alerts) on the billing account.
  Gotchas hit: (1) `organizationAdmin` lacks folder-create — granted `gcp-admin` `folderCreator` at the
  org. (2) Rapid `projects create` tripped the **shared** default quota project (`32555940559`, 429
  RATE_LIMIT) — fixed permanently by `gcloud config set billing/quota_project bcc-storefront-prod` +
  enabling `cloudresourcemanager`/`cloudbilling`/`iam` there. **Deferred:** baseline org policies
  (recommended, awaiting human decision — NOT applying `iam.disableServiceAccountKeyCreation` since the
  spec allows a Firebase Admin key for local dev; `iam.allowedPolicyMemberDomains` deferred until after
  the storefront re-parent to avoid blocking the cross-account move). Identity Platform staff/customer
  pool config deferred to P4/P8. **Unblocks P8.2** (bcc-admin-prod ready). P10.5 storefront re-parent
  is next: `BCC-rentals`/`bcc-rentals` confirmed under personal `dphanks@gmail.com` — decision is
  **re-parent (zero-downtime), not redeploy**; cross-account, needs `dphanks@gmail.com` to grant
  ownership or run the move.
- 2026-07-23 — **P10.5 storefront: decision REVERSED to redeploy; DONE for staging.** Attempted the
  re-parent first (granted `gcp-admin` `projectMover`+`billing.projectManager` on the personal
  `bcc-rentals` project — those succeed because it has no org policy yet — plus folder-level
  `projectMover`). The `projects move` kept failing, and the root cause surfaced when granting
  `dphanks@gmail.com` on the folder returned **`User dphanks@gmail.com is not in permitted organization`**:
  the new org enforces **`iam.allowedPolicyMemberDomains`** (domain-restricted sharing) **by default**,
  which blocks both adding external gmail identities to org resources and migrating an
  externally-owned project in. Human called it — it's a **dev site**, so we **redeployed** instead:
  `gcloud run deploy` of `bcc-rentals-frontend` into **`bcc-storefront-staging`** (`us-east1`, service
  `bcc-rentals`) → `https://bcc-rentals-78017895905.us-east1.run.app`. Storefront env is all external
  (Neon/PayPal/Resend/Upstash) so nothing DB-related changed; only `NEXT_PUBLIC_SITE_URL` (bake the
  new URL at build time) and `PAYPAL_WEBHOOK_ID` (new webhook for the new URL) needed correcting, with
  `PAYPAL_ENV=sandbox` for the dev site. Enabled `cloudbuild` on both storefront projects for
  `--source` deploys. **Cleanup DONE (2026-07-23):** removed the temp grants to `gcp-admin` on the
  personal `bcc-rentals` project (`projectMover`, `billing.projectManager`) + the folder-level
  `projectMover`; verified no residual `gcp-admin` bindings on `bcc-rentals`. **Lesson for P8 (admin deploy):** the same domain-restriction default is in force — keep all
  identities `@bachmancc.org`; `--allow-unauthenticated` on Cloud Run still works (it's an IAM
  `allUsers` invoker binding on the service, exempt from the member-domain constraint).
- 2026-07-23 — **Housekeeping: stale wave-2 branch prune verified complete.** Checked all refs —
  only `refs/heads/master` and `refs/remotes/origin/master` exist; the five flagged wave-2 branches
  (`code-writer/foundation-scaffold`, `code-writer/p2-engine`, `code-writer/p2.4-recurrence`,
  `code-writer/p3-repositories`, `integration/wave2`) are already gone (never persisted past their
  wave-2 worktrees/session). All content is on `master` (tip `2afcb2f`). Nothing to delete; marked
  the "Next session" housekeeping item DONE.
- 2026-07-26 — **Q2 answered (staging) — real Firebase client wired.** Human created the
  Firebase/Identity Platform project **`bcc-admin-staging`**, registered a Web app, and put the
  config in `.env.local` (all `NEXT_PUBLIC_FIREBASE_*` + `FIREBASE_PROJECT_ID` present and
  plausible — project id 17 chars, auth domain 33 chars = `bcc-admin-staging.firebaseapp.com`;
  values never echoed into the session, per safety rails). **Enabled sign-in methods for launch:
  Google + Email/Password** (GitHub/Facebook/Apple deferred — kept in `ProviderId` + commented in
  `PROVIDERS`). Corrected `lib/auth/firebase-client.ts` (it had been hand-edited into an invalid
  module — top-level imports mid-file, orphaned code) into a clean real Web SDK implementation:
  lazy `getAuthClient()`, real `signInWithProvider("google")` popup, new
  `signInWithEmailPassword(email, password)`; both return a fresh ID token. `npm i firebase`
  (79 pkgs); `npm run typecheck` clean. **Applied to the MAIN workspace (`master`)**, not the
  stale `agent-a0e46b61cf18ae37e` worktree (branch `code-writer/p4-auth`, flagged for pruning,
  no `.env.local`). **Remaining to close Q2 fully:** (a) **P4.2** real Admin SDK server verify
  (`npm i firebase-admin` + ADC) — the client gets a real ID token but `session.ts` still can't
  verify it, so end-to-end login isn't complete yet; (b) add Email/Password inputs to
  `app/login/login-form.tsx` (popup-buttons only today); (c) **P8.3** add `*.run.app` +
  `admin.bachmancc.org` to Firebase Authorized Domains at deploy (localhost is auto-authorized,
  so local testing needs no Cloud Run service). Prod (`bcc-admin-prod`) Firebase config still to
  gather at deploy time. Q3 (bootstrap admin UID) unchanged — grab it from Firebase
  Authentication → Users after the first real sign-in. Not yet committed/merged.
- 2026-07-26 — **P4.2 DONE + login Email/Password UI — end-to-end real auth complete.**
  Swapped the real `firebase-admin` Admin SDK into `lib/auth/session.ts`: `createRealSession`
  calls `verifyIdToken(idToken, true)` (rejects revoked/invalid before minting) →
  `createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_SECONDS * 1000 })`;
  `verifyRealSession` calls `verifySessionCookie(value, true)` and returns `{uid, email}` or
  `null` on failure (mirrors the dev-cookie path). Lazy, cached `getAdminAuth()` initializes
  via ADC (Cloud Run runtime SA) or `cert(GOOGLE_APPLICATION_CREDENTIALS)` locally. The auth
  seam is preserved — dev-bypass stub and real path still coexist in this one module, and
  `middleware.ts` (Edge) stays cookie-presence-only. Added Email/Password inputs to
  `app/login/login-form.tsx` (real path now renders an email/password form + "or" divider +
  Google button; dev-bypass role picker unchanged). Replaced the 2 obsolete
  "throws AuthNotConfiguredError" tests with 4 real-path unit tests in `tests/auth-session.test.ts`
  (firebase-admin mocked via `vi.doMock` so no live project / heavy cold import): mint verifies
  then creates cookie, mint rejects invalid token, verify returns identity, verify returns null
  on revoked. `npm i firebase-admin` (133 pkgs). **Verified on `master` working tree:**
  `typecheck` + `lint` exit 0, `npm test` **141/141 (12 files)**, `npm run build` exit 0 (login
  route 48.2 kB w/ Web SDK). Only Q2 remainder is **P8.3** Authorized Domains at deploy. Applied
  to the MAIN workspace; **not yet committed/merged** (`git merge` is human-gated).
- 2026-07-24 — **Wave 3 MERGED to `master` (tip `c648610`).** Human merged `integration/wave3`.
  Four parallel `code-writer` branches (run with worktree isolation this time — no branch scramble):
  **P4.1–P4.3** auth plumbing on the Q2 dev-bypass stub (`961209f` — `app/login/*`,
  `lib/auth/*`, `middleware.ts`, `app/api/auth/session`; UID→`app_users` role lookup +
  `requireScheduler`/`requireAdmin`), **P5.1** role-aware app shell (`e68274c` — `components/nav/*`),
  **P5.2** weekly calendar (`a891d05` — `app/calendar/*`), **P9.2** `@bcc/scheduler` shared
  workspace package (`809785a` — `packages/scheduler`, exports `scheduler/{errors,policy,types}` +
  `products/types`, consumed via npm-workspaces + tsconfig paths, no build step). Integration fix
  `c648610` aligned the nav role type to canonical `UserRole`. Verified on `master`:
  `typecheck` clean, `npm test` **139/139 (12 files)**. Marked P4.1–P4.3, P5.1, P5.2, P9.2 DONE.
  **NOTE:** P4 is on the **dev-bypass stub** (Q2 default) — real Firebase (providers + Admin SDK
  `verifyIdToken`) still pending Q2; P4.4 still BLOCKED on Q3. **Next: the P6 UI wave** (P6.1 Add
  Reservation is the immediate next task — all deps DONE), with P6.3/P6.4/P6.5/P6.6 parallelizable
  and P9.3→P9.4 cross-repo consolidation trailing. Prune the stale wave-3 branches + `agent-*`
  worktrees (all content is on `master`).
</content>
</invoke>
