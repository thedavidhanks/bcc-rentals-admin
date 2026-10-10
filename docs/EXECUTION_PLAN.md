# BCC Rentals Admin — Roadmap

> **Task tracking moved to GitHub Issues on 2026-10-05.**
> Open work lives on the **[BCC Rentals project board](https://github.com/users/thedavidhanks/projects/4)**,
> not in this file. This file is now the **phase-level roadmap**, the **non-negotiable
> rails**, and the **archive** of completed work.

The authoritative requirements live in [ADMIN_APP_SPEC.md](./ADMIN_APP_SPEC.md); the
non-negotiable conventions live in **[CLAUDE.md](../CLAUDE.md)** — read it first. The dated
narrative of what landed and when is in **[LOG.md](./LOG.md)**.

## Where things live now

| What | Where |
| --- | --- |
| Open tasks, status, priority, dependencies | [Project #4](https://github.com/users/thedavidhanks/projects/4) + [issues](https://github.com/thedavidhanks/bcc-rentals-admin/issues) |
| Requirements (`§N` references) | [ADMIN_APP_SPEC.md](./ADMIN_APP_SPEC.md) |
| Conventions + safety rails | [CLAUDE.md](../CLAUDE.md) and the rails below |
| What landed, dated | [LOG.md](./LOG.md) |
| Completed task → commit mapping | the [archive](#archive--completed-work) below |
| Agent work orders | [docs/prompts/](./prompts/) |

Plan task IDs (`P6.8`, `P11.5`, …) are **retained** as the prefix of every issue title, so
`P9.3` stays greppable across work orders, commits, and `CLAUDE.md`.

## How to use this across sessions

1. **Find the next task on the board**, not in this file:
   ```bash
   gh issue list --repo thedavidhanks/bcc-rentals-admin --state open
   ```
   The board's **Status** field distinguishes `Ready` (unblocked, pick it up) from
   `Blocked` (waiting on a dependency named in the issue body).
2. Each issue is a **self-contained briefing** — summary, background with `file:line`
   citations, an agent prompt (or a human `## Brief` for deploy/DDL/decision tasks), and
   testable acceptance criteria. You should not need to re-derive context from this file.
3. **Status is derived, not asserted.** Put `Closes #N` in the PR or merge commit; do not
   hand-maintain a status column. Move the board's Status field only when a task starts
   or becomes blocked.
4. Agents build and verify **on a branch, then stop** — `git merge` needs human approval
   here. Append a dated line to [LOG.md](./LOG.md) when work lands.
5. Project fields: **Status** · **Priority** (High/Medium/Low) · **Phase** (P6–P11) ·
   **Owner** (`code-writer`, `test-engineer`, `graphic-designer`, `human`). The Owner field
   is the recommended agent; `human` means decisions, DDL, deploys, and cross-system checks.

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
  contents into logs, PRs, issues, or agent prompts.
- The repo and its issues are **public**. No secrets, no real customer/staff data, no
  exploit recipes for unpatched weaknesses — see the
  [create-github-issue skill](../.claude/skills/create-github-issue/SKILL.md).

---

## Phase roadmap

| Phase | Scope | State |
| --- | --- | --- |
| **P0** | Repo & tooling foundation | ✅ Complete |
| **P1** | Data layer & config (`lib/db.ts`, `lib/env.ts`, `db/schema.sql`) | ✅ Complete |
| **P2** | Reservation engine — race-safe core (spec §8) | ✅ Complete |
| **P3** | Typed repositories & `admin_audit_log` writer | ✅ Complete |
| **P4** | Auth & authorization (Firebase → `app_users` → role guards) | ✅ Complete |
| **P5** | UI: app shell, role-aware nav, weekly calendar | ✅ Complete |
| **P6** | UI: reservations, products, prices, categories, users | Screens complete; [#17](https://github.com/thedavidhanks/bcc-rentals-admin/issues/17) full-flow tests, [#1](https://github.com/thedavidhanks/bcc-rentals-admin/issues/1) invite-domain exception, [#2](https://github.com/thedavidhanks/bcc-rentals-admin/issues/2) invite email open |
| **P7** | Cross-system verification against the live storefront | [#3](https://github.com/thedavidhanks/bcc-rentals-admin/issues/3) open |
| **P8** | Deployment to Cloud Run + domain + smoke test | [#4](https://github.com/thedavidhanks/bcc-rentals-admin/issues/4) → [#5](https://github.com/thedavidhanks/bcc-rentals-admin/issues/5) → [#6](https://github.com/thedavidhanks/bcc-rentals-admin/issues/6) → [#7](https://github.com/thedavidhanks/bcc-rentals-admin/issues/7); P8.4 ✅ |
| **P9** | Shared code consolidation (`@bcc/scheduler`) | Package exists; [#8](https://github.com/thedavidhanks/bcc-rentals-admin/issues/8) → [#9](https://github.com/thedavidhanks/bcc-rentals-admin/issues/9) open |
| **P10** | GCP organization & project structure | Org + 4 projects ✅; [#10](https://github.com/thedavidhanks/bcc-rentals-admin/issues/10), [#11](https://github.com/thedavidhanks/bcc-rentals-admin/issues/11) open (optional) |
| **P11** | UX polish & first-use fixes | 8 of 10 done; [#12](https://github.com/thedavidhanks/bcc-rentals-admin/issues/12), [#16](https://github.com/thedavidhanks/bcc-rentals-admin/issues/16) open |

**Launch-critical path:** [#4](https://github.com/thedavidhanks/bcc-rentals-admin/issues/4)
(deploy runbook) → [#5](https://github.com/thedavidhanks/bcc-rentals-admin/issues/5) (deploy)
→ [#6](https://github.com/thedavidhanks/bcc-rentals-admin/issues/6) (domain) →
[#7](https://github.com/thedavidhanks/bcc-rentals-admin/issues/7) (smoke test), plus
[#3](https://github.com/thedavidhanks/bcc-rentals-admin/issues/3) (cross-system check, needs
no deploy). Everything else is polish or tech debt.

---

## Blocking open questions

Q1 (storefront repo + shared-code mechanism), Q2 (Firebase project + providers), Q3 (first
admin UID), and Q5 (schema apply go-ahead) are all **resolved** — see
[LOG.md](./LOG.md) and the [archive](#archive--completed-work).

**Q4 — `admin.bachmancc.org` DNS control** is the only one left, and it is now narrower than
originally written: P10.3/P10.4 created the org and `bcc-admin-prod`, so what remains is
confirming DNS control at domain-mapping time. Tracked on
[#6](https://github.com/thedavidhanks/bcc-rentals-admin/issues/6).

---

## Working notes for agent waves

Operational lessons that cost real time to learn. Not task tracking — keep these here.

- **Isolate parallel agents in worktrees.** Launch parallel `code-writer` agents with
  `isolation: "worktree"`. Wave 2 ran them in one shared tree and the branch labels
  scrambled — one shared tree means one branch pointer they fight over. The 2026-09-02
  wave did it right: three agents, disjoint file sets, zero merge conflicts.
- **Worktree setup:** symlink `node_modules` from the primary tree instead of a slow
  `npm install` — `vitest`/`tsc`/`next lint` all work through it. Two gotchas: the symlink
  is **not** matched by `.gitignore`'s `node_modules/` (trailing slash matches directories
  only), and worktrees have **no `.env.local`**, so `next build` fails fast on missing
  `NEXT_PUBLIC_*`. Inject dummy env on the command line; never copy `.env.local` in.
- **An empty agent worktree means the agent is still working.** Wait for the completion
  notification before relaunching — judging one dead produced two independent P11.3
  implementations.
- **Merge protocol:** `git merge` requires human approval, *including for agents*. For a
  multi-agent wave, assemble one integration branch, verify the **combined** tree, then
  hand off a single merge.
- **Integration without merge:** when a wave has strictly disjoint file ownership, integrate
  with `git checkout <branch> -- <paths>`. Two consequences: diff each branch's owned paths
  against the integration branch afterwards to prove nothing was missed, and those branches
  are then **not ancestors** of `master`, so `git branch --merged` reports them unmerged
  forever — pruning needs `-D` after `git diff --diff-filter=A --name-only master <branch>`
  confirms it is safe.
- **Re-check a branch tip before integrating** — a `test-engineer` may add a commit *after*
  the `code-writer` reports (it did: `843cc9d` → `22e6bbf`).
- **Agent model pins:** use full versioned IDs (`claude-sonnet-5`, `claude-opus-5`); bare
  aliases 404. Agent definitions are cached at session start, so editing a pin needs a
  session restart. See CLAUDE.md.

## Unfiled minor findings

Real but small; deliberately not on the board yet. File an issue if one starts to matter.

- `getInitials` in [components/nav/account-menu.ts](../components/nav/account-menu.ts)
  renders `"@C"` for `@example.com` and `".."` for `...@example.com`. Unreachable through
  Firebase (it enforces non-empty local parts) and now pinned by tests, so changing it means
  updating those two tests.
- **Pre-transaction reads aren't try/caught** — `app/users/actions.ts` (`loadTargetById`)
  reads before entering `withTransaction`, so a transient DB error throws uncaught instead
  of returning a clean error state. A codebase-wide convention question, not a new defect;
  `app/profile` deliberately takes its "before" snapshot **inside** the transaction.

---

## Archive — completed work

34 tasks, with the commit or merge that landed each. Full narrative in [LOG.md](./LOG.md).

### P0 — Repo & tooling foundation

| ID | Task | Landed |
| --- | --- | --- |
| P0.1 | `git init`, `.gitignore` (node, `.env*`, `.next`, `node_modules`), initial commit | 2026-07-20 |
| P0.2 | Next.js (App Router) + TypeScript scaffold; `output: 'standalone'`; strict TS/ESLint | `7707a88` |
| P0.3 | `Dockerfile` + `.dockerignore` for the standalone build | `7707a88` |

### P1 — Data layer & config

| ID | Task | Landed |
| --- | --- | --- |
| P1.1 | `lib/db.ts` — `pg` `Pool` (`getPool()`) + `withTransaction()`, `server-only` | `7707a88` |
| P1.2 | `lib/env.ts` — Zod validation of §11 vars, fail-fast at boot (split: server + `lib/public-env.ts`) | `7707a88` |
| P1.3 | `.env.local.example` reshaped to the admin var set (no PayPal/Resend/Upstash) | `7707a88` |
| P1.4 | `db/schema.sql` (§5, FK order: series → groups → alter reservations → audit) + `scripts/db/apply-schema.mjs` | `7707a88` |
| P1.5 | Applied `schema.sql` to the Neon **dev** branch; tables/columns/indexes verified | 2026-07-20 |

### P2 — Reservation engine (race-safe core)

| ID | Task | Landed |
| --- | --- | --- |
| P2.1 | Race-safe single-item write: advisory lock → buffered-overlap capacity recheck → insert, one txn (§8) | `4f7f11f` (merged `90e1659`) |
| P2.2 | Multi-item / multi-occurrence booking: one txn, stable-order locks, all-or-nothing | `4f7f11f` |
| P2.3 | Policy helpers (lead/horizon/hours/alignment, Eastern); staff blocks bypass lead/horizon, never capacity | `4f7f11f` |
| P2.4 | Recurrence expansion → concrete Eastern occurrence dates, capped, truncation surfaced | `3636301` |
| P2.5 | Unit tests: overlap boundaries, buffer widening, capacity math, recurrence, DST edges | covered by the above (all `pg`-mocked; live-DB check is [#3](https://github.com/thedavidhanks/bcc-rentals-admin/issues/3)) |

### P3 — Repositories & audit

| ID | Task | Landed |
| --- | --- | --- |
| P3.1 | Typed repositories for all eight tables | `0509643` (merged `90e1659`) |
| P3.2 | `admin_audit_log` writer, transaction-aware | `0509643` |

### P4 — Auth & authorization

| ID | Task | Landed |
| --- | --- | --- |
| P4.1 | Firebase Web SDK client sign-in (Google popup + Email/Password) | `961209f` + real client 2026-07-26 |
| P4.2 | Server: Admin SDK `verifyIdToken` → `createSessionCookie` → `verifySessionCookie`; ADC on Cloud Run | 2026-07-26 |
| P4.3 | UID → `app_users` → role lookup; `requireScheduler` / `requireAdmin` guards | `961209f`, `c648610` |
| P4.4 | Bootstrap first admin — `@bachmancc.org` admin live in prod, `ALLOWED_EMAIL_DOMAIN` set | 2026-08-05 |

### P5 — UI: navigation & calendar

| ID | Task | Landed |
| --- | --- | --- |
| P5.1 | Responsive role-aware app shell + menu bar, collapsing to hamburger | `e68274c` |
| P5.2 | Weekly calendar: spanning bars, cross-week continuation, block/confirmed styling, prev/next/today | `a891d05` |

### P6 — UI: reservations, products, prices, users

| ID | Task | Landed |
| --- | --- | --- |
| P6.1 | Add Reservation: multi-product line items + recurrence, race-safe across all (item × occurrence) | `1ab94e4` (merged `e56b0fa`) |
| P6.2 | Edit Reservation: line items/dates/contact/notes, delete-instance vs series, cancel ≠ delete | `e045dea` |
| P6.3 | Update Prices: `item_prices` CRUD with §6 validation, effective/base rate + overrides | `51ac535` (merged `9f60fb1`) |
| P6.4 | Products (admin): add/edit, deactivate-not-delete, `updated_at=now()`, unique slug | `4d0f4ba` (merged `9f60fb1`) |
| P6.5 | Categories (admin): CRUD + assign products via `item_categories` | `f298ae9` (merged `9f60fb1`) |
| P6.6 | User management (admin) + invite-by-email onboarding; nullable `uid` migration applied dev + prod | 2026-08-19 |

### P8 — Deployment

| ID | Task | Landed |
| --- | --- | --- |
| P8.4 | Full §5 schema applied to Neon **prod**; prod admin bootstrapped | 2026-08-05 |

### P9 — Shared code consolidation

| ID | Task | Landed |
| --- | --- | --- |
| P9.1 | Storefront repo obtained; mechanism decided (npm-workspaces `@bcc/scheduler`) | 2026-07-23 |
| P9.2 | `packages/scheduler` extracted — exports `scheduler/{errors,policy,types}` + `products/types`, no build step | `809785a` |

### P10 — GCP organization & project structure

| ID | Task | Landed |
| --- | --- | --- |
| P10.3 | Org `513346324292` (pre-existed) + folder `bcc-rentals` `873642981137`; $50/mo budget w/ alerts | 2026-07-23 |
| P10.4 | Four projects created + billing, APIs, `run-runtime` SA each; `DATABASE_URL` secret in `bcc-admin-prod` | 2026-07-23 |
| P10.5 | Storefront redeployed into `bcc-storefront-staging` (re-parenting blocked by domain-restricted sharing) | 2026-07-23 |

### P11 — UX polish & first-use fixes

| ID | Task | Landed |
| --- | --- | --- |
| P11.1 | Role-aware nav — Products marked `adminOnly`; `tests/nav-guard-parity.test.ts` pins nav ⟺ guard | `6cadba7` (merged `e629041`) |
| P11.2 | Account menu with Logout — avatar dropdown, full keyboard/ARIA, shared `signOut()` | `22e6bbf` (merged `e629041`) |
| P11.3 | `/profile` self-service page — name editable, role/email read-only, audited | `298df18` (merged `4cb0ec3`) |
| P11.5 | Calendar week/month view toggle — `?view=month`, month grid = N stacked week rows reusing `placeInWeek` | `4409529` (+ tests `2f9ad14`; fast-forward) |
| P11.6 | Calendar: one bar per reservation group — envelope window, mixed-status precedence | `cd71e75` (fast-forward) |
| P11.7 | Calendar: filter flyout — show-cancelled toggle + per-group product filter, state in URL | `3f3acd2` (fast-forward) |
| P11.9 | Add Reservation: one shared "When" box (Date/Start/End + recurrence) for the whole booking | `7e71c82` (merged `37109c0`) |
| P11.10 | Add Reservation: echo submitted values on a failed submit, captured before Zod runs | `7e71c82` (merged `37109c0`) |
