---
name: next-task-prompt
description: Write an AI work-order prompt for the next open issue on the BCC Rentals board and save it to docs/prompts/. Use when the user asks to "write a prompt for the next task", "create a work order", "prompt for P11.5", or wants the next unblocked issue turned into an agent-ready brief.
---

# Write a work order for the next task

Turns an open issue (or small wave of issues) from
**[Project #4](https://github.com/users/thedavidhanks/projects/4)** into a self-contained
**work order** — the prompt a `work-distributor` / `code-writer` agent is launched with — and
saves it to [docs/prompts/](../../../docs/prompts/).

The bar: an agent that reads **only** the work order plus the files it names can do the task
correctly without asking a question. Every existing prompt in `docs/prompts/` clears that bar;
match them. Use [references/work-order-template.md](references/work-order-template.md) as the
skeleton.

This skill **writes a prompt file only**. It does not implement the task, launch agents, change
the issue's status, or merge anything.

**When a work order is worth writing at all:** every issue already embeds an `## Agent prompt`
(or a human `## Brief`) written to the same bar. For a single, well-scoped issue that prompt is
often enough — launch straight from it. Write a work order when you are **bundling a wave**
(file-ownership seams, sequencing), when research since filing has changed the picture, or when
the user asks for one.

## Procedure

### 1. Read the board before anything else

```bash
gh issue list --repo thedavidhanks/bcc-rentals-admin --state open \
  --json number,title,labels,body
gh issue view <N> --repo thedavidhanks/bcc-rentals-admin
```

Board fields (`Status`, `Priority`, `Phase`, `Owner`) come from the project — see the
`update-plan` skill's **Board reference** for the GraphQL query and the field values. Then read:

- The target issue in full — its `## Background` and `## Agent prompt` are the requirement
  source, and its citations were verified when it was filed (re-verify anyway, see Guardrails).
- [docs/EXECUTION_PLAN.md](../../../docs/EXECUTION_PLAN.md) — `## Safety rails`,
  `## Working notes for agent waves` (isolation/worktree, model pinning, merge protocol,
  integration trick), and the `## Phase roadmap` for where the task sits.
- [docs/LOG.md](../../../docs/LOG.md) — the last few entries, for tip commit and recent context.

### 2. Pick the target task

- **User named a task** (`/next-task-prompt P11.8`, "write the prompt for the calendar work") →
  find it with `gh issue list --search "P11.8 in:title"`. Confirm its dependencies are closed;
  if not, say so and ask whether to proceed anyway.
- **User didn't name one** → take the highest-`Priority` issue whose `Status` is `Ready`.
  Eligible = open, `Status: Ready`, and every dependency named in its body (`Blocked by P8.1`)
  is closed.
  - If the top candidates are genuinely close in value, or the top one has `Owner: human`
    (deploy / shared-prod-DB work isn't delegable), use `AskUserQuestion` to offer 2–4 with a
    one-line why each. Otherwise just pick, and state why in your report.
- **Bundle or split?** Follow what the issues say — they record hard-won sequencing:
  - Tasks that edit the same file or compose on one surface go in **one** work order for **one**
    agent, sequenced (e.g. P11.9 + P11.10; the P11.5→P11.6→P11.7 calendar trio).
  - Tasks with disjoint file sets may fan out to parallel worktrees in one order (the P6.3/P6.4/P6.5
    shape) — but then you must write the **file-ownership seam table** (§1 of the template).
  - Never bundle a `graphic-designer` or `human`-owned task with a `code-writer` one.

### 3. Research before writing — this is what makes the prompt good

A work order that only restates the issue is worthless; the agent could have read the issue. The
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
  and the current test count from a real `npm test` run. Both go in the prompt. Do not trust a
  count quoted in an older issue or log entry — they go stale fast.
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
- **Stop before merging to `master`** — `git merge` is human-gated, for agents too. Do not close
  the issue, change its board `Status`, or edit `docs/LOG.md`; a human merges, then `update-plan`
  records it. Put `Closes #<N>` in the **branch's final commit message** so the merge closes the
  issue automatically.
- End with an explicit **"Do not start <adjacent task IDs>"** so the wave stays scoped.

Write in the voice of the existing orders: second person, imperative, bold on the parts that bite,
tables for ownership seams, and **judgment calls pre-decided** ("decide these, don't stall on them")
rather than left open.

### 5. Link it from the issue, then report

- Comment on each issue the work order covers, so the link is discoverable from the board:

  ```bash
  gh issue comment <N> --repo thedavidhanks/bcc-rentals-admin \
    --body "Work order: [\`docs/prompts/<file>.md\`](../blob/master/docs/prompts/<file>.md)"
  ```

  That comment is the only tracker change this skill makes — **do not** close the issue, change
  its board `Status`, or touch `docs/LOG.md`.
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
