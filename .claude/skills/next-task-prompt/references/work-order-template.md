# Work-order template

Skeleton for `docs/prompts/<ID>-<slug>.md`. Angle brackets are placeholders. Keep the section
numbering; drop sections that genuinely don't apply (security §, parallelism § for a solo task),
but never drop §0 "Read first", the verification bar, or the handoff. Bold the parts that bite.

---

```markdown
# Work Order — <ID(s)>: <Short title>

**For:** the `<work-distributor | code-writer | test-engineer | graphic-designer>` agent.
**Deliver by:** <planning the work below, executing it through `code-writer` subagent(s)
(`isolation: "worktree"`), verifying the tree>, and stopping **before merge** (merge is
human-gated in this repo).

**Why this one is next:** <one short paragraph — the user-visible consequence of not doing it,
or the dependency it unblocks. Ties the order back to the plan's priority reasoning.>

---

## 0. Read first (non-negotiable context)

Before assigning anything, you — and **every** subagent that touches code — must read:

- [CLAUDE.md](../../CLAUDE.md) — <name only the rules this task can violate: roles model and
  "the server is the only real access boundary — never rely on hidden UI"; `import "server-only"`;
  **write `admin_audit_log` on every mutation**; "deactivate, don't delete";
  `items.updated_at = now()`; integer cents / Eastern minutes-since-midnight; race-safe
  advisory-lock writes> — and the **agent model** note (agents are already pinned to full
  versioned model IDs — launch them with **no** `model:` override).
- [docs/EXECUTION_PLAN.md](../EXECUTION_PLAN.md) — the **<IDs>** row(s) in §<phase>, and the
  isolation / worktree setup / merge protocol reminders at the bottom.
- [docs/ADMIN_APP_SPEC.md](../ADMIN_APP_SPEC.md) — **§<n>** (<what's there>), **§<n>** (<…>).
- The precedent implementation to mirror: [<path>](../../<path>) + [<path>](../../<path>) +
  [tests/<name>.test.ts](../../tests/<name>.test.ts) (<task ID that shipped it>). Same shapes:
  <guard-first server action, one `withTransaction` wrapping mutation + audit row, `state.ts` for
  the action-state type, `useActionState` in the client component>.

**Isolation rule:** launch each `code-writer` with **`isolation: "worktree"`**. Symlink
`node_modules` from the primary tree into the worktree instead of running a slow `npm install`.
Worktrees have **no `.env.local`**, so `next build` there fails on missing
`NEXT_PUBLIC_FIREBASE_*` / `DATABASE_URL` — that is an env artifact, not a code defect. Inject
dummy env on the command line if a real build signal is wanted; **never** copy `.env.local` into
a worktree.

Branch off **`master`** (tip `<sha>`, clean, **<N> tests / <M> files** green).

---

## 1. Scope, readiness, and how much to parallelize

Dep `<ID>` is **DONE**. <Schema reality: "**No schema change** — `<column>` already exists
(db/schema.sql)". "**No new dependency.** No DDL, no deploy.">

<Either: "This is a small, cohesive task — one route, one action, one repository function.
Fanning it out would cost more in integration than it saves. **Recommended shape: one
`code-writer` in one worktree, doing all of §2.**">

<Or, for a fan-out — the file-ownership seam table is mandatory:>

| Sub-task | Owns (may edit) | Must NOT touch |
| --- | --- | --- |
| **A — <name>** | `<paths>` | `<paths>` |
| **B — <name>** | `<paths>` | `<paths>` |

<Call out any seam explicitly: which agent owns a shared module, who only *calls* its exports,
and what to reconcile at integration. Do **not** run two agents in a *shared* tree.>

---

## 2. The deliverable

### 2.1 <Route / page> — `<path>`

- **Guard: `<requireScheduler|requireAdmin>()`** — called **first**, before any DB work.
  <Why that guard.> Do **not** invent a new guard.
- `export const dynamic = "force-dynamic"` and **defer the DB import** so `next build` stays free
  of env boot validation — copy the pattern from [<precedent>](../../<precedent>).
- <What it loads, what it renders, editable vs read-only, error/empty states.>
- Style with a `page.module.css` alongside the page, matching the other admin pages. No CSS
  framework, no new dependency.

### 2.2 Server action — `<path>`

`"use server"` + `import "server-only"`.

- `<guard>()` **first**, before parsing anything.
- Zod-validate <fields, with bounds>.
- One `withTransaction` containing **both** the write and the `writeAuditLog` call (`client`
  threaded into both) so they commit atomically.
- Audit entry: `action` = `"<entity.verb>"` (dotted convention), `entity`, `entity_id`, `detail` =
  `{ before, after }`.
- `revalidatePath(...)` for <paths>.
- Return an action state that **echoes the submitted values back on failure** so a rejected save
  doesn't wipe the form (type it in a separate `state.ts` — a `"use server"` file may only export
  async functions).

### 2.3 Repository — `<path>`

<Exact signature, the SQL it emits, what it must NOT touch, null/0-row behavior, and "follow the
file's existing style: `executor(client)`, the shared `<X>_COLUMNS` constant, a short doc comment".>

---

## 3. <Security | Domain> requirements — non-negotiable, verify each with a test

1. **Never accept a target identifier from the client.** The write is keyed only off the session
   uid. Test: submit a `FormData` carrying someone else's id and assert the session uid was used.
2. **`role`/`active`/<other privileged fields> are never written by this path.**
3. **Guard runs before parsing** — a rejecting guard means no repository call and no audit write.
4. **Every mutation is audited, in the same transaction** — a throw leaves no partial state.
5. **Server guards remain the only real access boundary** — no subagent may weaken, remove, or
   route around them anywhere.

<For reservation work, replace/extend with: advisory lock in stable slug order → re-check
buffered-window capacity → insert, all in one transaction, all-or-nothing across items.>

---

## 4. Judgment calls — decide these, don't stall on them

1. <Ambiguity + **the recommended resolution**, with the reason.>
2. <Known trap, e.g. dev-bypass sessions have no `app_users` row — what to render/return.>
3. <Scope fence, e.g. "do NOT add this route to `NAV_ITEMS`" + which test to re-confirm.>

---

## 5. Test harness constraints (read before planning tests)

`vitest.config.ts` uses `environment: "node"` with `include: ["tests/**/*.test.ts"]` — **`.tsx`
files are not collected, and there is no jsdom / `@testing-library/react` installed.**

- Do **not** add jsdom or testing-library. That is a dependency + config change; if a subagent is
  convinced DOM-level tests are essential, it must **stop and surface it** rather than install.
- Put testable logic in plain `.ts` modules and unit test those: the server action (mock
  `@/lib/auth/guards`, `@/lib/db`'s `withTransaction`, the repo fns, `writeAuditLog`, and
  `next/cache` via `vi.hoisted` + `vi.mock` — copy the harness from
  [tests/users-actions.test.ts](../../tests/users-actions.test.ts)), the repository function
  (mocked `pg`, as in [tests/repositories.test.ts](../../tests/repositories.test.ts)), and the
  validation edge cases.
- Cover every item in §3 explicitly. A green suite that doesn't assert the <critical> case has not
  tested the thing that matters.

---

## 6. Verification bar

Per branch and again on the integration branch:

- `npm run typecheck`, `npm run lint`, `npm test` — all green.
- Baseline on `master` is **<N> tests / <M> files**. The final tree must be **≥ that**, with **no
  pre-existing test deleted or weakened** to make a new one pass.
- Each `code-writer` hands its branch to `test-engineer` for verification before you integrate
  (launch it as-is on its pinned model — **no** `model:` override).
- No `TODO(P9)` markers introduced; no duplication of anything that belongs in `@bcc/scheduler`.

---

## 7. Integration & handoff (you, the distributor)

1. Execute per §1.
2. When green (verified by `test-engineer`), assemble the work on **one** branch and verify the
   combined tree: `npm run typecheck`, `npm run lint`, `npm test`.
3. **Stop before merging to `master`.** `git merge` to `master` is human-gated here — the
   permission guard denies it for agents too. With strictly disjoint file ownership, integrate
   with `git checkout <branch> -- <paths>` instead of a merge, then diff each branch's owned paths
   against the integration branch to prove nothing was missed.
4. **Report:** branch name(s), test counts (<N> → ?), the §4 decisions you took, the exact audit
   `action` string(s) used, confirmation that each §3 item has a named test behind it, and
   anything you changed in existing tests (and why).
5. Do **not** edit [docs/EXECUTION_PLAN.md](../EXECUTION_PLAN.md) or [docs/LOG.md](../LOG.md)
   status — a human marks <IDs> DONE after the merge.

**Do not start <adjacent task IDs>.** <One line on why they're a separate wave.>
```
