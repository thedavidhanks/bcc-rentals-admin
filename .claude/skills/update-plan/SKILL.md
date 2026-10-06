---
name: update-plan
description: Maintain project status on GitHub Issues + Project #4 and append to docs/LOG.md — close issues when work lands, keep the board's Status/Priority fields honest, tell the user what to work on next, and refresh the phase roadmap in docs/EXECUTION_PLAN.md. Use whenever a task finishes, a merge lands, the user asks "what's next", or the board and reality have drifted.
---

# Update project status

Since **2026-10-05** open work lives on
**[Project #4](https://github.com/users/thedavidhanks/projects/4)** and the
[issues](https://github.com/thedavidhanks/bcc-rentals-admin/issues) of
`thedavidhanks/bcc-rentals-admin` — **not** in a Markdown status table.

| Source of truth for | Lives in |
| --- | --- |
| **Status** of any task | the issue (open/closed) + the board's `Status` field |
| **What happened**, dated | [docs/LOG.md](../../../docs/LOG.md) |
| **Phase-level shape** + archive of completed work | [docs/EXECUTION_PLAN.md](../../../docs/EXECUTION_PLAN.md) |
| **Requirements** (`§N`) | [docs/ADMIN_APP_SPEC.md](../../../docs/ADMIN_APP_SPEC.md) |

Invoke this skill when any of these is true:
- A task was completed / merged and its issue needs closing.
- The user asks **"what's next?"** or **"what should I work on?"**.
- Dependencies changed and previously-blocked issues are now runnable.
- The board and reality have drifted.

Issue titles keep their plan ID prefix (`P11.5 — …`), so `P11.5` stays greppable.
Use `gh issue list --search "P11.5 in:title"` to find an issue from a plan ID.

## Board reference

```
Project:  https://github.com/users/thedavidhanks/projects/4   (user thedavidhanks, number 4)
Fields:   Status   Backlog · Ready · In progress · In review · Blocked · Done
          Priority High · Medium · Low
          Phase    P6 — Admin CRUD · P7 — Cross-system · P8 — Deployment ·
                   P9 — Shared code · P10 — GCP org · P11 — UX polish
          Owner    code-writer · test-engineer · graphic-designer · human
```

`Auto-add to project` is **enabled** — a new issue in either linked repo lands on the board
automatically, but with **empty** Phase/Owner. Set those when you file or triage one.

Reading the board needs the `project` token scope. If `gh` errors with
`missing required scopes`, tell the user to run `gh auth refresh -s project` (it is an
interactive device-code flow — do not try to drive it unattended).

## Procedure

Do these in order. Query the board first; don't edit blind.

### 1. Verify reality before closing anything

Never close an issue on assertion alone. Confirm it actually landed:
- `git log --oneline -15` — is the claimed commit on `master`? Merges are human-gated here,
  so **a branch that built green but was not merged is not done** — set the board `Status`
  to `In review` instead and say "verified on branch, merge pending".
- If the task touched the shared DB or a deploy, confirm a **human** ran it in-session
  (agents never run DDL or deploy — see the plan's Safety rails).

### 2. Close the issue

Prefer letting git do it: `Closes #N` in the PR body or merge commit closes the issue and
sets the board `Status` to `Done` automatically. If the merge already happened without it:

```bash
gh issue close <N> --repo thedavidhanks/bcc-rentals-admin \
  --comment "Landed in <sha> (merged to master <merge-sha>). <one line on what shipped>."
```

Always leave that closing comment — it is the commit↔issue link a future reader needs.
If the task **unblocks** others, comment on each newly-unblocked issue and flip its
`Status` from `Blocked` to `Ready`.

### 3. Recompute what is unblocked

```bash
gh issue list --repo thedavidhanks/bcc-rentals-admin --state open \
  --json number,title,labels,assignees
```

For board fields (Status/Priority/Phase/Owner), query the project:

```bash
gh api graphql -f query='
{ user(login:"thedavidhanks"){ projectV2(number:4){ items(first:50){ nodes{
  content{ ... on Issue { number title state } }
  fieldValues(first:20){ nodes{ ... on ProjectV2ItemFieldSingleSelectValue {
    name field{ ... on ProjectV2SingleSelectField { name } } } } } } } } } }'
```

An issue is **ready to pick up** iff it is open, its `Status` is `Ready`, and every
dependency named in its body (`Blocked by P8.1`) is closed. Fix any `Status` that
disagrees with that test — a blocked issue showing `Ready` is the failure mode that wastes
a session.

### 4. Record what happened in the log (`docs/LOG.md`)

Append a dated entry (newest at the bottom). Convert relative dates to absolute
(`YYYY-MM-DD`). This is the step that cannot be reconstructed from `git log` or the issue
tracker, so it carries the most weight. A good entry captures:
- **What landed** + the commit/merge SHA + the issue number **and** plan ID (`#13` / `P11.5`).
- **Key design decisions** and *why* — especially anything someone might "optimize" away
  later (e.g. "mints a new `group_id` but preserves `series_id`, documented so no one turns
  it into a plain UPDATE").
- **Verification**: which checks passed (`typecheck` / `lint` / `npm test N/N` / `build`),
  verified live against which DB.
- **What it unblocks** and any new follow-ups created.
- **Gotchas** hit and how they were resolved.

Never paste secrets, `.env.local` contents, or live DB credentials. Refer to values by
shape or length, never by value. The repo is **public**.

### 5. Refresh the roadmap only if a phase changed shape

[docs/EXECUTION_PLAN.md](../../../docs/EXECUTION_PLAN.md) is no longer a task tracker. Touch
it only when:
- a **phase** completed or newly opened — update its row in `## Phase roadmap`;
- a task completed — add a row to the matching `## Archive — completed work` table
  (`ID | Task | Landed`), terse, with the commit or merge SHA;
- a blocking question resolved, or a new working-note lesson is worth keeping.

Do **not** recreate a per-task status table there. That is what the board is for.

### 6. Tell the user what's next

After editing, report concisely in chat (not just in the files):
- **What you closed** — issue numbers + plan IDs + SHAs.
- **The recommended next task** — lead with one, then alternatives, each with its issue
  number, owner, a one-line "what", and why it's unblocked.
- **Anything still blocked** and what would unblock it.
- Any **housekeeping** worth doing (stale branches/worktrees to prune) — flag it, don't
  silently run destructive git ops.

If the user only asked **"what's next?"** with no completed work to record, do steps 3 and 6
only — but still correct any `Status` field that has drifted.

## Guardrails

- **Verify before you close** (step 1). A green branch that isn't merged is not done.
- **Never run DDL against the shared Neon DB or deploy**, and never close such an issue
  unless a human ran it in-session.
- **Don't delete branches/worktrees or run other irreversible git ops** as part of
  "updating status" — surface them as suggestions and let the user confirm.
- **No secrets in the log, the issues, or any comment.** Issues are public and edit history
  is permanent.
- **Don't invent labels.** The repo has the GitHub defaults plus **`ops`** (needs a change to
  live infrastructure — GCP, DNS, Secret Manager, deploy) and **`verification`** (a manual
  check of a live system that changes nothing). Ask the user before adding another.
- Match the surrounding formatting and terseness of each file; don't reflow untouched content.
