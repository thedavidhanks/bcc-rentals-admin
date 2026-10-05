---
name: next-task-prompt
description: Write an AI work-order prompt for the next task in docs/EXECUTION_PLAN.md and save it to docs/prompts/. Use when the user asks to "write a prompt for the next task", "create a work order", "prompt for P11.5", or wants the next unblocked plan task turned into an agent-ready brief.
---

# Write a work order for the next task

Turns a task (or small wave of tasks) from
[docs/EXECUTION_PLAN.md](../../../docs/EXECUTION_PLAN.md) into a self-contained **work order** —
the prompt a `work-distributor` / `code-writer` agent is launched with — and saves it to
[docs/prompts/](../../../docs/prompts/).

The bar: an agent that reads **only** the work order plus the files it names can do the task
correctly without asking a question. Every existing prompt in `docs/prompts/` clears that bar;
match them. Use [references/work-order-template.md](references/work-order-template.md) as the
skeleton.

This skill **writes a prompt file only**. It does not implement the task, launch agents, edit the
plan's status, or merge anything.

## Procedure

### 1. Read the plan before anything else

Read, in this order:

- `## ▶ Next session — start here` — the curated priority shortlist and its standing reminders
  (isolation/worktree, model pinning, merge protocol, integration trick). This is the priority
  ordering; the table is roughly ranked and rows carry `(recommended)` / `(do first…)` markers.
- `## Current state` — tip commit, current test counts, what just landed.
- The `## Phases` row(s) for the candidate task — the full task text is the requirement source.
- `## Blocking open questions` and `## Safety rails`.

### 2. Pick the target task

- **User named a task** (`/next-task-prompt P11.8`, "write the prompt for the calendar work") →
  use it. Confirm its `Depends` are all DONE; if not, say so and ask whether to proceed anyway.
- **User didn't name one** → take the highest-priority eligible row from the shortlist. Eligible =
  Status `TODO`/`IN PROGRESS`, every dependency DONE, no open blocking question against it.
  - If the top candidates are genuinely close in value, or the top row is owned by `main`
    (deploy / shared-prod-DB work isn't delegable), use `AskUserQuestion` to offer 2–4 with a
    one-line why each. Otherwise just pick, and state why in your report.
- **Bundle or split?** Follow what the plan says — it records hard-won sequencing:
  - Tasks that edit the same file or compose on one surface go in **one** work order for **one**
    agent, sequenced (e.g. P11.9 + P11.10; the P11.5→P11.6→P11.7 calendar trio).
  - Tasks with disjoint file sets may fan out to parallel worktrees in one order (the P6.3/P6.4/P6.5
    shape) — but then you must write the **file-ownership seam table** (§1 of the template).
  - Never bundle a `graphic-designer` or `main`-owned task with a `code-writer` one.

### 3. Research before writing — this is what makes the prompt good

A work order that only restates the plan row is worthless; the agent could have read the plan. The
value is in the specifics you resolve *now* so the agent doesn't guess. Before writing, find:

- **The precedent to mirror.** Nearly every task has one — an existing page + action + repository +
  test quartet that already solves the same shape (`app/users/*` and `tests/users-actions.test.ts`
  are the canonical example). Name it with clickable paths and say "same shapes".
- **What already exists — build on it, do NOT reinvent.** Grep for the repository functions, helpers,
  types, and routes the task touches. State which exports to call. Repositories in
  `lib/repositories/` are the only way to touch tables; no raw SQL in routes.
- **Exact anchors.** Real file paths, and line numbers where they pin something down
  (`components/nav/nav-config.ts:22`). Verify each path exists — a wrong path sends an agent
  down a rabbit hole.
- **Ground truth for the verification bar:** `git log --oneline -1` for the tip SHA to branch from,
  and the current test count (`npm test`, or the count in `## Current state` if you trust it as of
  the tip). Both go in the prompt.
- **Schema reality.** Confirm whether the column/table already exists (`db/schema.sql`). If the task
  needs no migration, say so explicitly — it removes an agent's biggest excuse to ask.
- **Relevant spec sections.** Cite `docs/ADMIN_APP_SPEC.md` by **§ number** (and approximate line)
  for the feature rules, UI layout, schema, and validation the task depends on.

### 4. Write the file

Path: `docs/prompts/<ID>[-<ID>...]-<kebab-slug>.md`, e.g. `P11.8-prices-pricing-unit.md`,
`P11.9-P11.10-reservation-form-wave.md`. Follow
[references/work-order-template.md](references/work-order-template.md). Drop sections that don't
apply (a favicon task has no security section) — but never drop §0, the verification bar, or the
handoff.

Non-negotiables to carry into every work order (drawn from CLAUDE.md — restate the ones the task
can actually violate, don't paste the whole list):

- **Server guards are the only real access boundary** — `requireScheduler`/`requireAdmin` on every
  mutating path, called **first**, before parsing input. Never rely on hidden UI.
- **Write `admin_audit_log` on every mutation**, in the **same transaction** as the write.
- `import "server-only"` in any module touching the DB or secrets.
- **Deactivate, don't delete**; `items.updated_at = now()` on every edit.
- **Money is integer cents; time is minutes since local midnight in `America/New_York`.**
- **Reservation writes are race-safe** — advisory lock → re-check → insert, in one transaction,
  locks in stable slug order (only when the task touches reservations).
- **No DDL, no deploy, no new dependencies** — if the agent thinks it needs one, it stops and
  surfaces it rather than installing.
- **Test harness:** `vitest.config.ts` is `environment: "node"`, `include: ["tests/**/*.test.ts"]` —
  `.tsx` is not collected and there is no jsdom / testing-library. Put testable logic in `.ts`
  modules; do not add jsdom.
- **Isolation:** launch each `code-writer` with `isolation: "worktree"`; symlink `node_modules`
  from the primary tree rather than `npm install`; worktrees have **no `.env.local`**, so a failing
  `next build` there is an env artifact, not a defect — never copy `.env.local` into one.
- **Model:** the agents in `~/.claude/agents/` are already pinned to full versioned IDs — launch
  with **no** `model:` override.
- **Stop before merging to `master`** — `git merge` is human-gated, for agents too. Do not edit
  `docs/EXECUTION_PLAN.md` / `docs/LOG.md` status; a human marks the task DONE after the merge.
- End with an explicit **"Do not start <adjacent task IDs>"** so the wave stays scoped.

Write in the voice of the existing orders: second person, imperative, bold on the parts that bite,
tables for ownership seams, and **judgment calls pre-decided** ("decide these, don't stall on them")
rather than left open.

### 5. Link it from the plan, then report

- Append `Work order: [docs/prompts/<file>.md](./prompts/<file>.md).` to the task's **Task cell** in
  its Phases table (the P11.1/P11.2/P11.3 rows show the convention). This is the only plan edit this
  skill makes — **do not** change Status, and do not touch `docs/LOG.md`.
- Report in chat: which task(s) you chose and **why that one is next**, the file path, the shape you
  recommended (one agent vs. fan-out), any judgment calls you pre-decided on the user's behalf, and
  the exact launch line the user can run next (which agent, `isolation: "worktree"`, no `model:`
  override).

## Guardrails

- **Verify every path, line number, SHA, and test count you cite.** A confidently wrong anchor is
  worse than no anchor.
- **Don't invent requirements.** The plan row + the spec are the source; where they're silent and a
  decision is needed, put it under "Judgment calls" with a recommendation, or ask the user if it
  materially changes the work.
- **Don't implement the task** or launch the agents — writing the prompt is the whole deliverable
  unless the user asks for more.
- **Don't mark anything DONE** — that's the `update-plan` skill, after a human merge.
- **No secrets.** Never quote `.env.local`, DB URLs, or credentials into a prompt file; these files
  are committed.
- If a task turns out to be **blocked** or to need DDL/deploy/human action, write that finding up
  and stop rather than papering over it in the prompt.
