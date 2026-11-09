---
name: update-plan
description: Record work that has landed on master — verify it really merged, close its issue, correct the board's Status/Phase/Owner fields, append the dated entry to docs/LOG.md, and add the archive row to docs/EXECUTION_PLAN.md. Use after a merge, or when the board and reality have drifted. For "what's next" or "where are we" use project-status instead; for docs/roadmap.md use update-roadmap.
allowed-tools: Bash(gh *), Bash(git *), Read, Edit, Skill(project-status), Skill(update-roadmap)
---

# Record landed work

This skill writes down what already happened. It runs **after** a human
merges, when there is a merge SHA to record.

## What this skill does and does not own

| Job | Skill |
| --- | --- |
| Close the issue, fix board fields, write [LOG.md](../../../docs/LOG.md) + the archive | **this skill** |
| Report status, recommend the next issue | [project-status](../project-status/SKILL.md) |
| Edit [docs/roadmap.md](../../../docs/roadmap.md) | [update-roadmap](../update-roadmap/SKILL.md) |
| Turn an issue into an agent work order | [next-task-prompt](../next-task-prompt/SKILL.md) |
| Open the pull request in the first place | [open-pull-request](../open-pull-request/SKILL.md) |

If the developer asks **"what's next?"** or **"where are we?"** with no
landed work to record, this is the wrong skill — run `project-status`.
Don't answer it here; two skills recommending a next issue from two
copies of the rule is how they drift apart.

Open work lives on **[Project #4](https://github.com/users/thedavidhanks/projects/4)**
and the [issues](https://github.com/thedavidhanks/bcc-rentals-admin/issues)
of `thedavidhanks/bcc-rentals-admin` — not in a Markdown status table.

| Source of truth for | Lives in |
| --- | --- |
| **Status** of any task | the issue (open/closed) + the board's `Status` field |
| **What happened**, dated | [docs/LOG.md](../../../docs/LOG.md) |
| **Completed task → commit** | the archive in [docs/EXECUTION_PLAN.md](../../../docs/EXECUTION_PLAN.md) |
| **Phase intent** | [docs/roadmap.md](../../../docs/roadmap.md) |
| **Requirements** (`§N`) | [docs/ADMIN_APP_SPEC.md](../../../docs/ADMIN_APP_SPEC.md) |

Issue titles keep their plan ID prefix (`P11.5 — …`), so `P11.5` stays
greppable. Find an issue from a plan ID with
`gh issue list --search "P11.5 in:title"`.

## Board reference

```
Project:  https://github.com/users/thedavidhanks/projects/4   (user thedavidhanks, number 4)
Fields:   Status   Backlog · Ready · In progress · In review · Blocked · Done
          Priority High · Medium · Low
          Phase    P6 — Admin CRUD · P7 — Cross-system · P8 — Deployment ·
                   P9 — Shared code · P10 — GCP org · P11 — UX polish
          Owner    code-writer · test-engineer · graphic-designer · human
```

`Auto-add to project` is **enabled** — a new issue in either linked repo
lands on the board automatically, but with **empty** Phase/Owner. Set
those when you file or triage one.

Reading the board needs the `project` token scope. If `gh` errors with
`missing required scopes`, tell the developer to run
`gh auth refresh -s project` in their own terminal — it is an
interactive device-code flow, so don't try to drive it unattended. If
`gh` isn't logged in at all, stop and say so; nothing below works.

## Procedure

### 1. Verify it landed before closing anything

Never close an issue on assertion alone.

```bash
git log --oneline -15 master
git branch --merged master
```

- Is the claimed commit **on `master`**? Merging is human-gated here —
  a branch that built green but was not merged is **not done**. Set the
  board `Status` to `In review` and say "verified on branch, merge
  pending".
- Note that several waves landed by **fast-forward**, so the work
  commit and the "merge commit" are often one SHA. Record what `git
  log` actually shows rather than inventing a merge commit.
- If the task touched the shared database or a deploy, confirm a
  **human** ran it in-session. Agents never run DDL or deploy.

### 2. Close the issue

A pull request with `Closes #N` in its body closes the issue on merge
and flips the board `Status` to `Done` by itself — check before acting,
and if GitHub already did it, don't duplicate the comment. Otherwise:

```bash
gh issue close <N> --repo thedavidhanks/bcc-rentals-admin \
  --comment "Landed in <sha> on master. <one line on what shipped>."
```

Always leave that closing comment — it is the commit ↔ issue link a
future reader needs. If the work **unblocks** others, comment on each
newly-unblocked issue and flip its `Status` from `Blocked` to `Ready`.

### 3. Correct the board

```bash
gh issue list --repo thedavidhanks/bcc-rentals-admin --state open \
  --json number,title,labels,assignees
```

For board fields, query the project:

```bash
gh api graphql -f query='
{ user(login:"thedavidhanks"){ projectV2(number:4){ items(first:100){ nodes{
  content{ ... on Issue { number title state } }
  fieldValues(first:20){ nodes{ ... on ProjectV2ItemFieldSingleSelectValue {
    name field{ ... on ProjectV2SingleSelectField { name } } } } } } } } } }'
```

Fix any field that now disagrees with reality: a `Blocked` issue whose
dependency just closed becomes `Ready`; an issue whose branch merged
becomes `Done`; a newly auto-added issue gets its `Phase` and `Owner`.
The eligibility rule — what makes an issue genuinely `Ready` — is
defined once, in
[project-status §5](../project-status/SKILL.md). Apply it; don't
restate it here.

This is field hygiene, not a recommendation. Fixing the fields is what
makes `project-status`'s recommendation trustworthy later.

### 4. Record what happened in the log (`docs/LOG.md`)

Append a dated entry (newest at the bottom). Convert relative dates to
absolute (`YYYY-MM-DD`). **This is the step that cannot be
reconstructed** from `git log` or the issue tracker, so it carries the
most weight. A good entry captures:

- **What landed** + the commit/merge SHA + the issue number **and**
  plan ID (`#13` / `P11.5`) + the pull request, if there was one.
- **Key design decisions** and *why* — especially anything someone
  might "optimize" away later (e.g. "filtering is post-load in pure
  code, never in SQL, because filtering rows in SQL would drop a
  matching group's non-matching sibling rows").
- **Verification**: which checks passed (`typecheck` / `lint` /
  `npm test N/N files`), and against which database.
- **What it unblocks**, and any follow-ups found but not filed.
- **Gotchas** hit and how they were resolved.

Never paste secrets, `.env.local` contents, live DB credentials, or
real customer/staff data. Refer to values by shape, never by value.
**The repo is public.**

### 5. Add the archive row (`docs/EXECUTION_PLAN.md`)

Add one terse row to the matching `## Archive — completed work` table
(`ID | Task | Landed`), with the commit or merge SHA, and bump the task
count in the sentence above the tables. Add a new phase subsection only
if the phase has none yet.

Also update, if the work changed them: `## Blocking open questions`
(a question resolved), `## Working notes for agent waves` (an
operational lesson that cost real time), or `## Unfiled minor findings`
(a small real finding, or removing one you just filed as an issue).

Do **not** recreate a per-task status table there, and do **not** edit
`docs/roadmap.md` — if a whole phase just completed or the plan
changed shape, run [update-roadmap](../update-roadmap/SKILL.md), which
will tell you the edit has to ride on the next feature branch rather
than go up alone.

### 6. Report

Report concisely in chat, not just in the files:

- **What you closed** — issue numbers + plan IDs + SHAs.
- **What you wrote** — the LOG entry and the archive row.
- **What this unblocks**, and any `Status` you corrected.
- Any **housekeeping** worth doing (stale branches, leftover
  `.claude/worktrees/` directories) — flag it, don't silently run
  destructive git operations.

For the recommended next task, say "run `project-status`" or run it as
a skill. Don't recompute it here.

## Guardrails

- **Verify before you close** (step 1). A green branch that isn't
  merged is not done.
- **Never run DDL against the shared Neon database and never deploy**,
  and never close such an issue unless a human ran it in-session.
- **Don't delete branches or worktrees, and don't run other
  irreversible git operations** as part of "updating status" — surface
  them as suggestions and let the developer confirm.
- **No secrets and no customer data** in the log, the issues, or any
  comment. Issues are public and edit history is permanent.
- **Don't invent labels.** The repo has the GitHub defaults plus
  **`ops`** (needs a change to live infrastructure — GCP, DNS, Secret
  Manager, deploy) and **`verification`** (a manual check of a live
  system that changes nothing). Ask before adding another.
- Match the surrounding formatting and terseness of each file; don't
  reflow untouched content.
