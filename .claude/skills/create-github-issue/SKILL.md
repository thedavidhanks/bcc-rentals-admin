---
name: create-github-issue
description: Create a GitHub issue in thedavidhanks/bcc-rentals-admin with the house format — plain-English summary, background with file:line citations, an embedded agent prompt, testable acceptance criteria, and always an assignee. The repo is public and the app shares a production DB holding real renter data, so the skill also covers keeping secrets, customer PII, and unpatched vulnerabilities out of issues. Use whenever the user asks to file, open, or create an issue, or to turn a bug/idea/finding into one.
---

# Create a GitHub issue

Issues in `thedavidhanks/bcc-rentals-admin` are written to be handed straight to a
coding agent. An issue that only describes a symptom is incomplete — it forces
the next person to re-derive the context. Every issue carries its own briefing.

**Companion repo:** the storefront is `thedavidhanks/bcc-rentals-frontend` (also
public). If the bug is in the storefront, file it there with `--repo`; if it
spans both, file in the repo that must change and cross-link.

## Issue vs. execution plan — pick the right home

This project tracks its own roadmap in
[docs/EXECUTION_PLAN.md](../../../docs/EXECUTION_PLAN.md), with work orders in
[docs/prompts/](../../../docs/prompts/).

- **Already a plan task (`P11.4`, `P9.3`, …)** → it does not need an issue. Use the
  `next-task-prompt` skill to write the work order, and `update-plan` to move its
  status. Only file an issue if the user wants it externally visible or
  assignable on GitHub.
- **Not in the plan** — a bug found in shipped code, a drive-by finding, an idea
  from outside the roadmap → **this skill**. Mention the nearest plan phase in
  Background so the two stay reconciled, and say whether the plan should gain a
  row for it.

Always cite the plan task ID when one is related (`P6.7`, `P8.3`), and cite spec
sections as `§N` referencing
[docs/ADMIN_APP_SPEC.md](../../../docs/ADMIN_APP_SPEC.md).

## This repo is public — read this first

`thedavidhanks/bcc-rentals-admin` has **public** visibility, so every issue,
title, comment and edit is world-readable and indexed by search engines. Issue
edits do not erase history: the original text stays in the issue's edit history
and in any notification email already sent. Treat anything you type as permanent
and published.

Three things therefore never go in an issue.

### 1. Secrets

`.env.local` contains **live production credentials**. Never paste a live
credential, even to illustrate a bug. That includes:

- `DATABASE_URL` / `DATABASE_URL_DEV` — Neon Postgres connection strings; the
  password is embedded in the URL, so even a "partial" paste leaks it
- Firebase Admin service-account JSON, or anything
  `GOOGLE_APPLICATION_CREDENTIALS` points at
- `NEXT_PUBLIC_FIREBASE_*` values (client-visible by design, still not ours to
  publish), Firebase **ID tokens** and **session cookies** captured from a
  browser or `curl -v`
- Any Secret Manager payload from `bcc-admin-prod` / `bcc-admin-staging`
- Full `env`, `printenv`, `gcloud` auth output, or Cloud Run logs pasted raw

Redact instead, keeping enough shape to be useful:

```
DATABASE_URL=postgresql://<redacted>@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require
Cookie: __session=<redacted>
```

Scrub command output before pasting it — `psql` echoes its connection URL on
error, Next.js stack traces can include env values, and CI/Cloud Run logs leak
headers. Describe a secret by **name and location** ("the `DATABASE_URL` secret
in `bcc-admin-prod` Secret Manager"), never by value.

If you discover a real secret already committed or already published in an
issue, **stop and tell the user immediately**. Rotation comes first (Neon
password reset, key revocation); redacting the text is not a fix, because the
value is already public.

### 2. Customer data

This app writes to the storefront's production tables. `reservations` holds real
renters' **names, emails, phone numbers and notes**, and `app_users` holds real
staff emails and Firebase UIDs. Never paste a production row, query result, or
screenshot containing them.

Use synthetic values that preserve the shape:

```
customer_name  | customer_email        | start_at
Jane Example   | jane@example.com      | 2026-10-12T14:00:00Z
```

Reproducing against the Neon **dev** branch with seeded data is the right way to
get pasteable evidence. Internal `@bachmancc.org` staff identities already
documented in the committed `CLAUDE.md` are fine to reference by role ("the
bootstrapped admin"), but do not add new ones.

### 3. Unfixed vulnerabilities

Do not open a public issue that explains how to exploit an unpatched weakness in
the live app. A public issue is a disclosure with a working recipe attached, and
the deployment stays vulnerable until it is fixed.

This covers, concretely: a mutating server action missing its
`requireScheduler` / `requireAdmin` guard; a way to escalate `app_users.role`;
session-cookie forgery or a middleware bypass; any route on the live Cloud Run
URL reachable without auth that should not be; SQL injection into a shared table.

Instead:

- Report it privately — GitHub Security tab → **Report a vulnerability**
  (private advisory), or just tell the user directly in chat. Ask the user which
  they prefer; do not pick a public issue by default.
- Once it is fixed and deployed, a public issue or PR describing the fix is fine.

**Hardening review work is not in this category** and belongs in a normal public
issue — "audit that every mutating action calls a role guard first", "review the
session cookie lifetime". The line is whether the text hands a stranger a working
exploit against production. **Data-integrity bugs are also not in this category**:
a missed advisory lock, a capacity-recheck gap, a DST boundary error or a
double-booking race is an ordinary public bug — file it normally and be specific.

When in doubt, ask the user before filing rather than after.

## Assignee (required)

Every issue gets an assignee. There is no such thing as an unassigned issue here.

- If the user names someone, use their GitHub login.
- **If no one is specified, assign `thedavidhanks`** — the repo owner
  (`dphanks@gmail.com`). `gh` takes logins, not emails, so always pass
  `--assignee thedavidhanks`.
- If `gh issue create` rejects the assignee (not a collaborator), create the
  issue anyway and say so in your reply rather than dropping the field silently.

## Before writing

Gather the facts the issue needs to stand on its own:

1. Reproduce or confirm the problem if it is observable. The admin app is
   auth-gated, so "observable" here usually means **a failing `npm test` case**,
   `npm run typecheck` / `npm run lint` output, a query against the Neon **dev**
   branch, or a precise description of the UI step sequence. Paste the real
   output — never invented output, never un-scrubbed, never with real customer
   rows.
2. Find the relevant code and note `file.ext:line` references. The layering is
   stable: `app/<area>/{page.tsx,actions.ts}` → `lib/repositories/*` →
   `lib/db.ts`; scheduler logic in `lib/scheduler/*` and `packages/scheduler`
   (`@bcc/scheduler`); auth in `lib/auth/{session,guards}.ts`.
3. Check for related issues — the tracker is young, so often there are none:
   `gh issue list --state all --limit 30` or
   `gh search issues --repo thedavidhanks/bcc-rentals-admin <keyword>`.
   Cross-link with `#N`.
4. Note anything that cannot be fixed by a commit alone — call it out
   explicitly. Common cases here: a **schema change** (needs
   `db/schema.sql` + a human running `npm run db:apply`, dev branch first), a
   **GCP console change** (Cloud Run env var, Secret Manager, Firebase
   Authorized Domains, sign-in providers), or a **deploy**.

## Title

Short, specific, states the problem or the change — not the area. Lead with the
observable fact when there is one.

- Good: `Cancelling one occurrence of a weekly series frees capacity for the whole series`
- Good: `updateItem does not set items.updated_at, so the storefront serves a stale cached row`
- Bad: `Reservation bugs`

Prefix `[Tier N]` only when the user has given a priority tier.

## Body format

Use exactly these sections, in this order. Write the body to a temp file and
pass `--body-file` so backticks and `$` in code blocks survive the shell.

```markdown
## Summary

Two to four sentences a non-expert can follow — assume a church staff member or
a future maintainer, not someone holding this thread in their head. What is
wrong (or what should exist), what the user-visible consequence is (double
booking? wrong price? staff locked out?), and where it shows up. Say whether it
is a regression or long-standing. No jargon that is not unpacked.

## Background

The technical detail: how the relevant code works today, with `file.ext:line`
citations. Include the real evidence — a failing test, command output, a table
of observed vs. expected values. Cite the spec section (`§8`, `§6`) and the
execution-plan task (`P6.2`) the behaviour comes from. State what is NOT in the
repo if that matters ("the sign-in provider list lives in the Firebase console,
so a commit alone cannot fix it"). Cross-reference related issues with `#N`.

## Agent prompt

> A fully blockquoted, self-contained brief. Assume the reader has the repo and
> nothing else — no access to this thread. Cover, in this order:
>
> **Stack and context.** Next.js App Router + TypeScript + `pg` against the
> storefront's shared Neon Postgres; npm workspaces with `@bcc/scheduler`. How
> the relevant subsystem is wired and where the files live.
>
> **Problem.** What is broken and how to see it. Give the exact command so the
> agent verifies before changing anything.
>
> **Task.** What to do. Be concrete about the approach where the approach is
> already decided; leave it open where it genuinely is. Name the precedent to
> mirror — an existing page + action + repository + test quartet that already
> solves the same shape.
>
> **Constraints / do-nots.** The `CLAUDE.md` rules that apply. Pull in whichever
> are relevant:
>
> - Reservation writes are race-safe: `pg_advisory_xact_lock` → re-check
>   buffered-window capacity → insert, in **one** transaction; multi-item locks
>   in stable slug order, all-or-nothing (§8).
> - Money is integer cents; time is minutes since local midnight in
>   `America/New_York`. No floats, no stored offsets.
> - `import "server-only"` in anything touching the DB or secrets; env validated
>   with Zod at boot (fail to start if missing).
> - Tables are reached through `lib/repositories/*` only — no raw SQL in routes.
> - Every mutating action calls `requireScheduler` / `requireAdmin` as its first
>   statement, and writes `admin_audit_log` on the **same** txn client.
> - Deactivate, don't delete (`active=false`, `status='cancelled'`); set
>   `items.updated_at = now()` on every edit.
> - Import shared scheduler/product types from `@bcc/scheduler`; don't duplicate.
> - **No DDL against the shared DB and no deploys without human approval** — an
>   agent may write `db/schema.sql` and the apply script; a human runs it, dev
>   branch first. `git merge` also needs human approval: build and verify on a
>   branch, then stop.
>
> …plus any tradeoff that must be surfaced rather than silently accepted.
>
> **How to verify.** The exact commands that prove it works, and what output
> counts as passing — normally `npm run lint`, `npm run typecheck`, and
> `npm test` with the new case(s) green and no existing test regressed. Name the
> test file to add to. Include known gotchas (the storefront caches the catalog
> ~30s per instance; `npm run db:apply` prefers `DATABASE_URL_DEV` whenever it is
> set; local `.env.local` `DATABASE_URL` points at **prod**).

## Acceptance criteria

- [ ] One checkbox per independently testable outcome
- [ ] Each states an observable result, not an activity — "cancelling one
      occurrence leaves the other occurrences' capacity unchanged", not "fix the
      cancel logic"
- [ ] Include the test requirement as its own box, naming the file
- [ ] Include `npm run lint` + `npm run typecheck` clean as its own box
- [ ] Include any docs update the change implies — `docs/EXECUTION_PLAN.md`
      status, a dated line in `docs/LOG.md`, `CLAUDE.md` if a convention changes
```

### Examples of failure and success

Include concrete before/after whenever the problem is observable — inside
**Background** for what fails today, and inside the agent prompt's **How to
verify** for what success looks like. Real pasted output, formatted as a code
block or table:

```
$ npm test -- tests/scheduler-booking.test.ts
 × rejects a second block when the buffered window is already full
   expected 'conflict' but booking succeeded      # today — the failure

Must read: 2 passed, 0 failed.                    # after the fix — the success
```

If the problem is not observable from the outside, give a failing-test sketch or
a worked input → wrong-output example instead — e.g. a table of
`start_minute`/`end_minute` inputs against the capacity the code returns versus
the capacity §8 requires.

## Creating it

```bash
gh issue create \
  --repo thedavidhanks/bcc-rentals-admin \
  --title "<title>" \
  --body-file /tmp/issue-body.md \
  --assignee thedavidhanks \
  --label bug
```

Only use labels that already exist (`gh label list`). Do not invent labels — if a
new one is genuinely warranted, ask the user first.

The GitHub defaults are all present: `bug`, `documentation`, `duplicate`,
`enhancement`, `good first issue`, `help wanted`, `invalid`, `question`,
`wontfix`. Two were added **2026-10-05** for work a commit cannot close:

- **`ops`** — needs a change to live infrastructure (GCP console, DNS, Secret
  Manager, Cloud Run deploy). Use it alongside a kind label, not instead of one.
- **`verification`** — a manual check that a live system behaves correctly, which
  changes nothing. The cross-system check and the prod smoke test carry this.

A task that is merely *human-owned* gets neither — a Markdown-only runbook edit is
`documentation`, and a decision conversation is `question`. Reserve `ops` for
touching live infrastructure and `verification` for observing it.

Report the issue URL back to the user.

## Checklist before you run `gh`

- [ ] **No secrets anywhere** in the title, body, or pasted output — Neon
      connection strings, Firebase service-account JSON, ID tokens/session
      cookies, Secret Manager values, `.env.local` contents, raw logs
- [ ] **No real customer or staff data** — reservation contact details,
      `app_users` emails/UIDs; use synthetic rows
- [ ] **No exploit recipe** for an unpatched vulnerability (auth-guard gap, role
      escalation, session forgery); if that is the subject, route it privately
- [ ] Right repo — admin vs. `bcc-rentals-frontend`
- [ ] Assignee set (`thedavidhanks` by default)
- [ ] Summary is readable by someone who has never seen the code
- [ ] Background cites `file.ext:line`, the spec `§N`, and the plan task ID, and
      shows real, un-invented output
- [ ] Agent prompt is fully blockquoted and self-contained — no "as described above"
- [ ] Agent prompt carries the relevant `CLAUDE.md` constraints, including the
      no-DDL / no-deploy / no-merge rails
- [ ] Agent prompt says how to verify, with exact commands
- [ ] Acceptance criteria are checkboxes, each independently testable
- [ ] Anything requiring DDL, a GCP/Firebase console change, or a deploy is
      flagged as not-a-commit
