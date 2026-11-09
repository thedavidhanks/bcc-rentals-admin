# BCC Rentals Admin — roadmap

What this project is building, phase by phase, and what the system
does today. It is the *intent* of each phase in plain English — not a
task list. Status lives on GitHub: the
[issues](https://github.com/thedavidhanks/bcc-rentals-admin/issues) and
[Project #4](https://github.com/users/thedavidhanks/projects/4), whose
`Phase` field carries the same P-numbers used here.

Requirements are in [ADMIN_APP_SPEC.md](./ADMIN_APP_SPEC.md), cited as
`§N`. Conventions and safety rails are in [CLAUDE.md](../CLAUDE.md).
The dated narrative of what landed is in [LOG.md](./LOG.md), and the
completed-task → commit archive plus the agent working notes are in
[EXECUTION_PLAN.md](./EXECUTION_PLAN.md).

Change this page when the plan changes (a phase is added, removed,
reordered, or rescoped) or when a phase ships — not as issues close.
An issue opening or closing inside a phase is status, and status lives
on GitHub.

## Where the system is today (2026-10-06)

Bachman Community Center staff sign in to the admin app with a Google
account or an email and password, and the app checks their Firebase
UID against the `app_users` table to decide what they may do. A
`scheduler` sees the calendar, reservations and prices; an `admin` also
sees products, categories and users. Every screen the spec calls for
exists: a week-or-month calendar with grouped, filterable reservation
bars, add and edit reservation flows that book several products and
recurring occurrences in one race-safe transaction, price management,
product and category management, user management with invite-by-email,
and a self-service profile page. Every mutation writes an
`admin_audit_log` row.

It runs on a developer's machine only. **Nothing is deployed yet** —
there is no Cloud Run service for this app and no CI; the GCP projects,
service accounts and secrets that will host it exist and are empty.
The app reads and writes the storefront's live Neon Postgres database,
so catalog, price and reservation edits made locally are already real.

The booking rules, the role guards and the pure calendar logic are
covered by a unit-test suite that runs clean, as do `npm run lint` and
`npm run typecheck`. Nothing that only a browser can confirm is tested:
`vitest` collects no `.tsx`.

## Phases

### P0 — Repo and tooling foundation ([complete](https://github.com/thedavidhanks/bcc-rentals-admin/issues?q=P0))

A Next.js App Router + TypeScript project that builds standalone and
packages into a container, so there is something deployable from day
one.

### P1 — Data layer and config (complete)

One pooled `pg` connection to the storefront's Neon Postgres, an
environment file validated at boot so a missing variable stops the app
rather than surprising it later, and the app's own tables (§5) written
as idempotent SQL.

### P2 — Reservation engine (complete)

The race-safe core. A staff block and a customer booking can arrive at
the same moment for the last unit of a product, and only one of them
may win. Bookings covering several products and several recurring dates
succeed or fail as a whole (§8).

### P3 — Repositories and audit (complete)

Every table is reached through one typed function per operation, and
every mutation records who did what in `admin_audit_log`.

### P4 — Sign-in and permissions (complete)

Staff sign in with whatever identity provider they already have, not
necessarily a Google account. The server verifies the session on every
request and looks the role up in the database, so hiding a menu item is
never what keeps someone out.

### P5 — App shell and calendar (complete)

A role-aware navigation shell and the first weekly calendar, with
reservations drawn as bars that span days and continue across weeks.

### P6 — Management screens

Staff can do the whole job from the browser: book and edit
reservations, set prices, add and retire products, organize them into
categories, and invite other staff by email. The screens are built; what
remains is full-flow test coverage and finishing the email invite path.

### P7 — Cross-system verification

Prove against the live storefront that the two apps agree: a block made
here really does remove capacity there, and a booking made there really
is visible here. Nothing to build — this is a check on the running
systems.

### P8 — Deployment

Put the app on Cloud Run at `admin.bachmancc.org` so staff can use it
from any browser instead of a developer's laptop, and smoke-test it in
production. *Gated on* confirming DNS control of the domain.

### P9 — Shared code

The scheduler and product rules exist in both this app and the
storefront. One copy, shared as `@bcc/scheduler`, so a fix to the
booking rules cannot land in one app and be missed in the other. The
package exists; both apps still need to consume it.

### P10 — GCP organization

Four projects under one `bachmancc.org` organization, one per app and
environment, each with a least-privilege runtime identity and a budget.
The structure is built; what remains is optional tidying.

### P11 — Polish and first-use fixes

The things that only show up once someone actually uses the app:
navigation that matches permissions, a logout that is findable, a
profile page, a calendar that is readable at a month's scale, and
reservation forms that do not lose typed input on a failed submit.

## Backlog

Anything not yet in a phase lives as an open issue without a `Phase`
field on the board. Small findings that are real but not worth an issue
yet are listed under "Unfiled minor findings" in
[EXECUTION_PLAN.md](./EXECUTION_PLAN.md).
