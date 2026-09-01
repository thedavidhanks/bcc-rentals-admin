# Progress log — BCC Rentals Admin

Dated log of work as it lands. Moved out of [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) to keep the
plan focused on phases + status; append new entries here as work lands.

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
  - `reservations.series_id`; and the new indexes. Prod apply remains P8.4. P9.1 mechanism decided:
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
  storefront-reference section accordingly. Repo is _not_ vendored into this repo — copy/consolidate.
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
- 2026-08-05 — **Q3 answered; first admin bootstrapped (P4.4 IN PROGRESS) — verified against live
  DBs.** Human signed in via `bcc-admin-staging` and inserted the first admin. **Live verification
  (Node + `pg`, credentials never echoed):**
  - **PROD** (`DATABASE_URL`, host `ep-spring-fog-…`): has `app_users` with **1 row** —
    `email=dphanks@gmail.com`, `role=admin`, `active=true`, UID len 28 (valid). But prod is
    **missing the rest of §5**: `reservation_groups`, `reservation_series`, `admin_audit_log`,
    and `reservations.group_id/series_id`. Only `app_users` + storefront tables present.
  - **DEV** (`DATABASE_URL_DEV`, host `ep-wild-feather-…-pooler`): **alive** (contrary to the
    "auto-deleted after 30 days" assumption) with the **complete** §5 schema and **0** `app_users`.
    **Decisions (human):** (1) apply full `schema.sql` to prod to close the gap — must run
    `DATABASE_URL_DEV= APPLY_TO_PROD=1 npm run db:apply`, because the apply script prefers
    `DATABASE_URL_DEV` whenever it's set (so `APPLY_TO_PROD=1` alone still hits dev); (2) **re-bootstrap
    the admin with a `@bachmancc.org` identity** and drop the interim Gmail row — a Gmail admin is a
    lockout risk once `ALLOWED_EMAIL_DOMAIN` (currently unset) is enabled for launch; (3) **resume
    dev-branch-first development** (dev branch is healthy) — the prod row counts toward P8.4, not a
    move of the working DB to prod. Security review of the human's actions: bootstrap SQL was sound
    (idempotent `ON CONFLICT`, no injection/secret exposure); the two issues are the incomplete prod
    DDL and the Gmail-vs-domain identity, both being remediated. Updated Current state, Q3, P4.4, P8.4.
    **Docs synced:** CLAUDE.md (auth/DB state) + ARCHITECTURE_PLAN_B.md (staleness banner).
- 2026-08-05 (later) — **Prod §5 schema completed + `@bachmancc.org` admin created; swap is the last
  step.** Human applied the full `db/schema.sql` to the Neon **prod** branch via PgAdmin. **Live
  re-verification (Node + `pg`, credentials never echoed):** prod now has **all 5 §5 objects**
  (`app_users`, `reservation_groups`, `reservation_series`, `admin_audit_log`) **plus**
  `reservations.group_id`/`series_id`. `app_users` still holds the single interim Gmail row
  (`dphanks@gmail.com`) — swap not yet run. Human created the replacement Firebase user in
  `bcc-admin-staging`: `uid=aOcGPdPctZMhw6TFeMqgIkyvLio1`, `dhanks@bachmancc.org`, "David Hanks".
  **Provided:** an idempotent prod swap transaction (upsert new admin `ON CONFLICT (uid)` + delete
  the Gmail row, with an in-txn `SELECT` sanity check before `COMMIT`). **Next (human):** run the
  swap on prod, sign in once as `dhanks@bachmancc.org` to confirm admin access, then set
  `ALLOWED_EMAIL_DOMAIN=bachmancc.org`. Also still open: insert an admin into the **dev** branch
  (0 rows) for local dev. Updated Current state, Q3, P4.4, P8.4. Removed stray closing-tag
  artifacts that had been committed at EOF.
- 2026-08-05 (final) — **P4.4 DONE + Q3 fully resolved — swap complete, verified live.** Human
  ran the prod swap SQL, signed in locally as `dhanks@bachmancc.org`, and set
  `ALLOWED_EMAIL_DOMAIN=bachmancc.org`. **Live verification (Node + `pg`, credentials never echoed):**
  prod `app_users` now holds **exactly 1 row** — `dhanks@bachmancc.org`,
  `uid=aOcGPdPctZMhw6TFeMqgIkyvLio1`, `role=admin`, `active=true`, UID len 28; the interim
  `dphanks@gmail.com` row is gone. `.env.local` `ALLOWED_EMAIL_DOMAIN` reads `bachmancc.org`.
  Lockout risk eliminated (no non-`@bachmancc.org` identity remains in prod). Marked **P4.4 DONE**,
  **Q3 fully resolved**, and **P8.4 DONE** (its two prod-DB deliverables — full §5 schema + admin
  bootstrap — are both complete). Updated Current state and the "Next session" blocked-items note.
  Remaining deploy-path work: P8.1/P8.2 (unblocked), P8.3 (domain + Authorized Domains), P8.5
  (smoke test). Dev-branch admin insert stays optional (only if `DATABASE_URL` is repointed at dev).
- 2026-08-05 — **P6.1 (Add Reservation) MERGED to `master` (`1ab94e4`; merge commit `e56b0fa`).**
  Built by a `code-writer` agent (`model: opus`) on `code-writer/p6.1-add-reservation` in a
  worktree (isolation, no branch scramble); human ran the merge, branch + worktree pruned.
  Delivered: server-rendered `app/reservations/new` (`page.tsx` + client `reservation-form.tsx`
  + `page.module.css`) with multi-product line items, recurrence controls (freq/interval/weekday/
  until-or-count) surfacing `expandRecurrence`'s truncation flag, and contact/notes; a
  `"server-only"` `createReservationAction` that calls `requireScheduler()` FIRST, validates with
  Zod, expands recurrence to Eastern occurrences, and runs the race-safe write. **Key design:**
  threaded an OPTIONAL `PoolClient` through `scheduler.createReservation`/`createBooking` (factored
  bodies into `run(client)`; `return client ? run(client) : withTransaction(run)`) so the action
  commits the `reservation_series` row + all reservation rows + the `admin_audit_log` row in ONE
  transaction, all-or-nothing (`GroupBookingConflictError` → reports failing item×date pairs, no
  partial commit). Lock/capacity/insert SQL byte-identical; behavior unchanged when no client is
  passed (existing engine tests still green). Added DST-correct `easternInstant()` to
  `lib/calendar/week.ts` (civil Eastern date + minutes-since-midnight → `timestamptz` via
  offset correction — NOT naive midnight+ms). Verified on the merged tree: `lint` + `typecheck`
  clean, `npm test` **154/154 (13 files)** (was 139); `npm run build` compiles successfully (the
  bare-worktree "collect page data" failure was environmental — missing `.env.local` `NEXT_PUBLIC_*`,
  hits pre-existing `/calendar`/`/users` too; the main workspace with `.env.local` builds clean).
  Two `// TODO(P9)` markers added on the new `client?` params (reconcile the admin-only txn-client
  extension against the storefront under P9.3/P9.4). **Unblocks P6.2** (Edit Reservation, now the
  next reservation task) and **P7.1** (live-DB cross-system check). Marked P6.1 DONE.
- 2026-08-18 — **P6.6 scoped + expanded to invite-by-email onboarding.** Confirmed P6.6 READY
  (deps P3.1 + P4.3 DONE; `app_users` on dev+prod; `countActiveAdmins()` already in the repo for
  the last-admin guard) and wrote the work order [docs/prompts/P6.6-user-management.md](./prompts/P6.6-user-management.md)
  for a PM/work-distributor agent (UI + function testing, task assignment, guardrails, DoD).
  **Design change (human-decided):** replaced the awkward "admin pastes a 28-char Firebase UID"
  add-user flow with **invite-by-email** — an admin invites by email+name+role, creating a
  **pending** `app_users` row (`uid=NULL`, `active=false`); on the invitee's first sign-in the
  server **binds** their real UID and activates the account. **Two locked decisions:** (1) bind
  **only if `email_verified=true`** and the token email matches the invite (unverified never binds
  → no invite takeover); domain still enforced by the existing guard, not re-checked at bind. (2)
  Storage = **make `app_users.uid` nullable** (idempotent DDL: drop NOT NULL + partial unique
  index on non-null `uid` + partial unique index on pending-invite email). Spec §3 reconciled —
  **UID remains the canonical key; email is a one-time binding key only.** New work vs. the
  original P6.6 line: a schema migration (human-applied, **dev branch first**, then prod on
  approval — the app errors on invite creation until applied), repo fns
  (`createInvite`/`getPendingInviteByEmail`/`bindInvite`/`revokeInvite` + pending/bound split in
  `listUsers`), threading `email_verified` through `SessionIdentity` (`verifyRealSession` returns
  only `{uid,email}` today) + a binding hook in `getSessionUser()`, and the Users UI/actions.
  Guidance: **one code-writer end-to-end** (schema→repo→auth→UI edit overlapping files — no
  fan-out) → test-engineer for the binding security matrix + last-admin guard; `model: opus`,
  `isolation: worktree`. No code or DDL applied yet — work order only.
- 2026-08-19 — **P6.6 DONE — user management + invite-by-email shipped and human-approved.**
  Built via subagents (schema→repo→auth→UI on one branch), integrated, verified, and merged.
  Delivered: admin Users page (`app/users/*` — invite / revoke / set-role / activate-deactivate),
  invite-by-email onboarding (pending row `uid=NULL` → binds real UID on first **verified** sign-in
  via `WHERE uid IS NULL`, `email_verified` threaded through `SessionIdentity`), transactional
  last-active-admin guard, and `admin_audit_log` on every mutation. **Schema migration applied to
  dev + prod and verified live:** `app_users.uid` made nullable, `app_users_uid_key` rebuilt as a
  partial unique index `WHERE uid IS NOT NULL`, plus `app_users_pending_email_key` unique on
  `lower(email) WHERE uid IS NULL` (both branches: `uid` is_nullable=YES, both indexes present).
  Fixed `scripts/db/apply-schema.mjs` env resolution (empty-string `DATABASE_URL_DEV=` now counts
  as unset via `|| undefined`, so `DATABASE_URL_DEV= APPLY_TO_PROD=1 npm run db:apply` correctly
  targets prod). Fixed a Next.js `"use server"` violation by moving the result-state
  interface/const out of `app/users/actions.ts` into new `app/users/state.ts` (a "use server" file
  may only export async functions). Verified: `typecheck` + `lint` clean, users-actions tests 26/26.
  **Known limitation surfaced to human:** no email is sent — "Send invite" only creates the pending
  row; onboarding is out-of-band today. Human approved the changes. **Added two follow-ups:**
  **P6.8** (medium) — invite-exception to the email-domain guard so invited outside-domain users can
  actually bind (keeps the wall for everyone else; needed for testing with other users); **P6.9**
  (low, optional) — a real invitation email, deferred since launch has ≤10 users and manual
  onboarding suffices.
- 2026-08-22 — **P6.2 DONE — Edit Reservation shipped and merged to `master` (`e045dea`).** Built as
  a parallel wave (work-distributor): one shared contract slice (`app/reservations/[groupId]/types.ts`
  + `loader.ts`) then B/C/D concurrently in per-slice worktrees (`model: opus`, `isolation: worktree`) —
  server actions (`actions.ts`), page + form + calendar entry point, and tests. Assembled onto
  `integration/p6.2-edit-reservation` and verified on the **combined** tree before hand-off; human ran
  the merge. Delivered (spec §7/§9): loads a booking by `group_id`, renders all line items + contact/
  notes + one-off-vs-series; **contact/notes/title edit bypasses the booking engine**; **line/date/time
  edit = cancel-then-rebook in ONE txn** (`cancelReservationsByGroup` → `scheduler.createBooking`) so
  the §8 race-safe path (advisory lock → capacity recheck → insert) protects every capacity change —
  on `GroupBookingConflictError` the txn rolls back, the original booking is intact, conflict lines
  surface to the UI ("Nothing was changed."). Cancel-then-rebook **mints a new `group_id`** (old rows
  become cancelled history) but **preserves `series_id`** so a series occurrence stays attached —
  documented in-code so no one "optimizes" it into a plain UPDATE. Delete offers **delete-this-instance**
  (`cancelReservationsByGroup`) and, only for a series, **delete-the-whole-series**
  (`cancelReservationsBySeries`, **future-only by default** — past occurrences kept as history per §9);
  cancel sets `status='cancelled'`, **never DELETE**. `requireScheduler()` first + `writeAuditLog` in the
  same txn on every mutation. Calendar bars now link to `/reservations/[groupId]` (only when `group_id`
  is non-null — storefront confirmed rows stay non-clickable). No schema change (repo fns + engine
  already existed). Verified on the combined tree: `typecheck` + `lint` clean, `npm test` **225/225
  (18 files)** (+23 net-new P6.2 tests: 19 action + 4 loader; no DOM tests — repo has no
  `@testing-library`/jsdom, UI logic covered via loader + `useActionState` result shape), `npm run
  build` exit 0 (new `/reservations/[groupId]` route present). **Unblocks P7.1** (live-DB cross-system
  double-booking check).
