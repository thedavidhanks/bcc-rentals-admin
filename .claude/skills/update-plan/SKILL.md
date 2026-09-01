---
name: update-plan
description: Maintain docs/EXECUTION_PLAN.md and docs/LOG.md — mark tasks DONE when work lands, keep the "▶ Next session — start here" section surfacing the correct unblocked tasks, tell the user what to work on next, and append a dated entry to the log. Use whenever a task finishes, a merge lands, the user asks "what's next", or the plan and reality have drifted.
---

# Update the execution plan

Keeps [docs/EXECUTION_PLAN.md](../../../docs/EXECUTION_PLAN.md) and
[docs/LOG.md](../../../docs/LOG.md) accurate as work lands, so any future session can resume
from the plan alone. The plan is the source of truth for **status**; the log is the source of
truth for **what happened**.

Invoke this skill when any of these is true:
- A task was completed / merged and needs marking DONE.
- The "▶ Next session — start here" section is stale (lists done work, or omits newly-unblocked tasks).
- The user asks **"what's next?"** or **"what should I work on?"**.
- Dependencies changed and previously-blocked tasks are now runnable.

## Layout you are maintaining

- **`## Phases`** — the canonical task tables (`ID | Task | Owner | Depends | Status`). One row
  per task. Status legend: `TODO · IN PROGRESS · DONE · BLOCKED · N/A`.
- **`## ▶ Next session — start here`** — a curated shortlist of the tasks a future session
  should pick from. This is a *view* onto Phases, not a second source of truth.
- **`## Current state`** — prose snapshot of where things stand (headline facts, live-verified
  state). Refresh the dated header and the top lines when a milestone lands.
- **`docs/LOG.md`** — the dated progress log. Append-only; newest work at the bottom.

The plan's own "How to use this file across sessions" section (top of the file) is the contract
— honor it.

## Procedure

Do these in order. Read the relevant sections of the plan first; don't edit blind.

### 1. Verify reality before changing status

Never mark a task DONE on assertion alone. Confirm it actually landed:
- `git log --oneline -15` — is the claimed commit on `master`? (Merges are human-gated here —
  a branch that built green but was **not merged** is **not** DONE; mark it IN PROGRESS or note
  "verified on branch, merge pending".)
- If the task changed code, the merge commit should be reachable from `master`.
- If the task touched the shared DB / deploy, confirm it was human-run (see Safety rails —
  agents never run DDL or deploy).

### 2. Mark completed tasks DONE (in `## Phases`)

For each finished task, edit its Phases-table Status cell:
`DONE (<short-sha or merge-sha>[, merged to master <sha>]) — <one-line what shipped>`.
Match the style of existing DONE rows (they carry the commit + a terse summary). Include the
date for anything nontrivial: `**DONE (YYYY-MM-DD)** — …`.

If a completed task **unblocks** others, note that in its row (`Unblocks P7.1.`) so the
dependency chain stays legible.

### 3. Re-surface the correct tasks in "▶ Next session — start here"

This is the most important step — it's what the next session reads first.

1. **Remove** every task from the shortlist that is now DONE (verify against Phases + git).
2. **Add** every task that is now **unblocked** — i.e. its `Depends` are all DONE — and not
   already listed. Check each candidate's dependencies explicitly; don't list a blocked task.
3. Keep the note about what **stays blocked** and why (e.g. "P6.7 stays blocked until
   P6.3/P6.4/P6.5 land"), so no one starts it prematurely.
4. It's fine — encouraged — to list **more than one** task so the operator can choose. Order
   them roughly by priority / independence, and mark each with its owner and a one-line "what".
5. Refresh the **Context** line at the top of the section to reflect the current tip commit and
   what's freshly done.
6. Preserve the standing reminders in that section (worktree isolation, `model: opus` for
   pinned agents, human-gated `git merge`) unless they've genuinely changed.

A task is **eligible for the shortlist** iff: Status is `TODO` (or `IN PROGRESS`) **and** every
task in its `Depends` column is `DONE`. Anything with an unresolved dependency or an open
blocking question (see `## Blocking open questions`) does **not** go on the list.

### 4. Record useful information in the log (`docs/LOG.md`)

Append a dated entry (newest at the bottom) for each meaningful change. Convert relative dates
to absolute (`YYYY-MM-DD`). A good entry captures what a future reader can't reconstruct from
`git log` alone:
- **What landed** + the commit/merge SHA + which task ID.
- **Key design decisions** and *why* (especially anything non-obvious or that someone might
  "optimize" away later — e.g. "mints a new group_id but preserves series_id, documented so no
  one turns it into a plain UPDATE").
- **Verification**: which checks passed (`typecheck`/`lint`/`npm test N/N`/`build`), verified
  live against which DB, etc.
- **What it unblocks / new follow-ups** created.
- **Gotchas** hit and how they were resolved.

Do **not** paste secrets, `.env.local` contents, or live DB credentials into the log (Safety
rails). Refer to values by shape/length, never by value.

### 5. Refresh `## Current state` if a milestone landed

Update the dated header (`## Current state (as of YYYY-MM-DD)`) and the headline lines when
something material changed (a phase completed, a blocking question resolved, the tip commit
moved). Keep it a snapshot, not a log — the blow-by-blow belongs in `docs/LOG.md`.

### 6. Tell the user what's next

After editing, report concisely in chat (not just in the file):
- **What you marked DONE** (task IDs + SHAs).
- **The recommended next task(s)** from the refreshed shortlist — lead with a single
  recommendation, then the alternatives, each with owner + one-line what + why it's unblocked.
- **Anything still blocked** and what would unblock it.
- Any **housekeeping** worth doing (e.g. stale branches/worktrees to prune) — flag it, don't
  silently do destructive git ops.

If the user only asked **"what's next?"** (no completed work to record), you may skip steps 2–5
and just do step 3's *analysis* (recompute the eligible set) + step 6 — but still fix the
shortlist in the file if it's drifted.

## Guardrails

- **Verify before you assert DONE** (step 1). A green branch that isn't merged is not done.
- **Never run DDL against the shared Neon DB or deploy** — and never mark such a task DONE
  unless a human ran it in-session. (Plan Safety rails.)
- **Don't delete branches/worktrees or run other irreversible git ops** as part of "updating
  the plan" — surface them as housekeeping suggestions and let the user confirm.
- **No secrets in the log or plan.**
- Keep the shortlist a *view* — the Phases tables remain the single source of truth for status;
  never let the two disagree.
- Match the surrounding formatting and terseness of each file; don't reflow untouched content.
