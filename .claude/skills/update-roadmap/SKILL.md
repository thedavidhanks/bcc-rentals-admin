---
name: update-roadmap
description: Record what a branch does to the plan, on the branch, before the pull request — the dated entry in docs/LOG.md, the archive row in docs/EXECUTION_PLAN.md, and docs/roadmap.md when a phase is added, rescoped, or ships. Commits the edits on the current branch so they merge with the change they describe; never opens or merges a pull request. Use from open-pull-request before every pull request, when project-status finds the roadmap disagreeing with GitHub, or when asked to "update the roadmap", "sync the roadmap", or "record this work".
allowed-tools: Bash(gh *), Bash(git *), Read, Edit
---

# Update the roadmap

Write down what this branch does to the plan, **on the branch, before
the pull request**, so the documents and the code move together and a
reader of `git log` sees why the plan changed.

This skill owns three files:

| File | What it holds | How often it changes |
| --- | --- | --- |
| [docs/LOG.md](../../../docs/LOG.md) | dated narrative: what landed, why, how it was verified | **every** substantive branch |
| [docs/EXECUTION_PLAN.md](../../../docs/EXECUTION_PLAN.md) archive | one terse `ID \| Task \| Landed` row per completed task | every branch that closes an issue |
| [docs/roadmap.md](../../../docs/roadmap.md) | each phase's *intent*, in plain English | rarely — only when the plan changes shape or a phase ships |

The roadmap is the one that usually needs nothing. Its own rule: change
it "when the plan changes (a phase is added, removed, reordered, or
rescoped) or when a phase ships, not as issues close." Hold to that. An
issue opening or closing inside a phase is status, and status lives on
GitHub. The log and the archive are where per-task detail goes.

The repository is `thedavidhanks/bcc-rentals-admin` and the board is
[Project #4](https://github.com/users/thedavidhanks/projects/4). GitHub
is current: where a page and GitHub disagree, the page moves, never
GitHub.

## What this skill does not do

- **It does not write to GitHub.** It never creates, edits, closes,
  labels, or re-phases an issue, and never moves a board card. The
  pull request's `Closes #N` line closes the issue on merge and flips
  the board `Status` to `Done` by itself — that is the whole point of
  deriving status rather than hand-maintaining it. Board drift you
  notice goes in the report (step 7) for a human to fix.
- **It does not open or merge a pull request.** That is
  [open-pull-request](../open-pull-request/SKILL.md)'s, and merging is
  human-only here.
- **It does not report project status or recommend a next issue.**
  That is [project-status](../project-status/SKILL.md)'s. Two skills
  deriving "what's next" from two copies of the rule is how they drift
  apart.
- **It never edits
  [docs/ADMIN_APP_SPEC.md](../../../docs/ADMIN_APP_SPEC.md).** Read it
  for what a phase was meant to deliver; changing it is a decision, not
  a sync.

Never write a bare `#N` outside a `Closes` line. Write "Issue #N" or
"PR#N", linked to
`https://github.com/thedavidhanks/bcc-rentals-admin/issues/N` or
`.../pull/N`.

## Board reference

```
Project:  https://github.com/users/thedavidhanks/projects/4   (user thedavidhanks, number 4)
Fields:   Status   Backlog · Ready · In progress · In review · Blocked · Done
          Priority High · Medium · Low
          Phase    P6 — Admin CRUD · P7 — Cross-system · P8 — Deployment ·
                   P9 — Shared code · P10 — GCP org · P11 — UX polish
          Owner    code-writer · test-engineer · graphic-designer · human
```

`Auto-add to project` is **enabled** — a new issue in either linked
repo lands on the board automatically, but with **empty** Phase/Owner.
[create-github-issue](../create-github-issue/SKILL.md) sets those when
it files one.

There are **no GitHub milestones**. A phase is the board's `Phase`
field plus the `Pn.m — ` prefix on every issue title, so `P11.5` stays
greppable: `gh issue list --search "P11.5 in:title" --state all`.

Reading board fields needs the `project` token scope. If `gh` errors
with `missing required scopes`, tell the developer to run
`gh auth refresh -s project` in their own terminal — it is an
interactive device-code flow, so don't try to drive it unattended. If
`gh` isn't logged in at all, carry on from issue titles alone and say
in the report that phase assignments came from titles, not the board.

## 1. What triggered this

Note the trigger: the branch
[open-pull-request](../open-pull-request/SKILL.md) is about to send
(**branch mode** — the normal case), a disagreement project-status
reported, or a direct request. Read the branch:

```bash
git branch --show-current
git log --oneline master..HEAD
git diff --stat master...HEAD
git diff master...HEAD
```

**Never run on `master`.** If `HEAD` is `master` there is no branch to
commit the edits on — report what you would have written and stop.

Find the issue or issues the branch closes (the branch name, then the
commits, then the conversation), and read them — the log entry cites
them and the archive row is keyed by their plan ID:

```bash
gh issue view N --repo thedavidhanks/bcc-rentals-admin \
  --json number,title,state,body
```

## 2. The branch has not merged yet

Everything this skill writes describes work that is **about to** land,
not work that has landed. That changes what you may claim:

- **Cite the branch commits and the pull request, never a merge SHA
  you don't have.** `git log --oneline master..HEAD` gives the real
  SHAs; use those. Many waves here land by fast-forward, so the work
  commit *is* the merge commit, and inventing a separate one is wrong
  either way.
- **Date the entry today** (`YYYY-MM-DD`, absolute — never a relative
  date), on the understanding that the merge follows the same day. If
  the developer merges much later, the date is close enough; a wrong
  SHA is not.
- **A rebase rewrites every SHA you just cited.** If the branch is
  rebased after the entry is written — `master` moved and the pull
  request asks for it — re-read `git log --oneline master..HEAD` and
  re-point the SHAs, then amend the docs commit. Merging is human-only
  here, so a long-lived branch is normal and this will happen.
- **Never claim a schema apply or a deploy happened.** Agents never run
  DDL and never deploy. If the branch changes `db/schema.sql` or
  deployment config, the log says the merge does **not** apply it and
  names the command a human runs.
- If the pull request is never merged, these entries die with the
  branch. That is the correct outcome.

## 3. The log entry — `docs/LOG.md`

**This is the step that cannot be reconstructed** from `git log` or the
issue tracker, so it carries the most weight. Write it for every branch
that does something substantive; a pure typo fix doesn't need one.

Append a dated entry at the **bottom** (newest last), matching the
surrounding format and terseness. A good entry captures:

- **What landed** + the branch commit SHAs + the issue number **and**
  plan ID (Issue #13 / `P11.5`) + the pull request once it exists.
- **Key design decisions** and *why* — especially anything someone
  might "optimize" away later (e.g. "filtering is post-load in pure
  code, never in SQL, because filtering rows in SQL would drop a
  matching group's non-matching sibling rows").
- **Verification**: which checks passed (`typecheck` / `lint` /
  `npm test N/N files`), and against which database. Compare test
  counts with `master` so the entry shows coverage was **added**, not
  rewritten.
- **What it unblocks**, and any follow-ups found but not filed.
- **Gotchas** hit and how they were resolved.
- **What no agent could verify** — `vitest` is `environment: "node"`
  with `include: ["tests/**/*.test.ts"]`, so no `.tsx` is ever
  collected. If the branch changed a screen, say a human hasn't seen it
  render.

## 4. The archive row — `docs/EXECUTION_PLAN.md`

Add one terse row to the matching `### Pn — …` table under
`## Archive — completed work` (`ID | Task | Landed`), with the branch
commit SHA. Bump the task count in the sentence above the tables. Add a
new phase subsection only if the phase has none yet.

Do **not** recreate a per-task status table there.

Also update, if this branch changed them: `## Blocking open questions`
(a question resolved), `## Working notes for agent waves` (an
operational lesson that cost real time), or `## Unfiled minor findings`
(a small real finding, or removing one just filed as an issue).

## 5. The roadmap — `docs/roadmap.md`

### The gate — check this before gathering anything

This skill runs on **every** pull request, and the plan moves only a
handful of times across a phase. Gathering the full picture each time
to conclude "no change needed" is a tax on every merge, so run these
three cheap checks first:

```bash
# a. Does the branch touch the page itself?
git diff --name-only master...HEAD -- docs/roadmap.md

# b. Does it finish a phase? For each phase ID this branch closes an
#    issue in, are there other open issues left in that phase?
gh issue list --repo thedavidhanks/bcc-rentals-admin --state open \
  --search "P8 in:title" --json number,title

# c. Does it change something "Where the system is today" describes —
#    a screen added or removed, the role boundary, the deploy setup?
git diff --name-only --diff-filter=AD master...HEAD | grep -E '^app/(.*/)?page\.tsx$'
git diff --name-only master...HEAD | grep -E '^middleware\.ts$|^lib/auth/|^Dockerfile$|^next\.config\.ts$'
```

**All three empty → the roadmap needs nothing.** Record that in one
line and skip to step 6. Don't run the queries below.

The gate covers **this step only** — steps 3 and 4 still run. And it is
for branch mode only: a direct "update the roadmap" request, or a
disagreement handed over by
[project-status](../project-status/SKILL.md), is a deliberate ask —
always do the full comparison for those.

Two things the gate deliberately ignores, because they churn on almost
every branch and would hold it open permanently: the **test count** and
the set of closed issues inside an unfinished phase. Neither belongs on
the page — that is why the page states no counts.

### The full comparison

```bash
# Every issue with its phase prefix, open and closed
gh issue list --repo thedavidhanks/bcc-rentals-admin --state all --limit 100 \
  --json number,title,state,stateReason

# Board Phase / Status / Priority (needs: gh auth refresh -s project)
gh api graphql -f query='
{ user(login:"thedavidhanks"){ projectV2(number:4){ items(first:100){ nodes{
  content{ ... on Issue { number title state } }
  fieldValues(first:20){ nodes{ ... on ProjectV2ItemFieldSingleSelectValue {
    name field{ ... on ProjectV2SingleSelectField { name } } } } } } } } } }'

# When the roadmap last changed on master, and what landed since
git log -1 --format='%h %cs' master -- docs/roadmap.md
git log --oneline master --since='<that date>'
```

Read the page as it is on `master` (`git show master:docs/roadmap.md`),
not a local branch that may be stale.

### Compare

Check each of these, counting this branch as merged. Write down every
mismatch with the GitHub fact that shows it.

1. **Added, removed, renamed, reordered.** Every phase that issues or
   the board refer to has a `###` heading under **Phases**, in
   P-number order, and no heading names a phase nothing refers to.
2. **Shipped.** A phase has shipped when **every** issue carrying it is
   closed. Its heading ends `(complete)` and its intent paragraph stays
   as written. A phase with no issues at all is not evidence of
   anything — check the archive (step 4), which maps the pre-tracker
   phases P0–P5 to the commits that landed them.
3. **Rescoped.** A phase's issues are its scope. If an issue sits in a
   phase whose paragraph doesn't cover it (a new capability, not a step
   toward the stated intent), or the paragraph promises something no
   issue in the phase now carries, the phase has been rescoped. Suggest
   a reworded paragraph, but the wording of the plan is the developer's:
   show it and ask before using it.
4. **Where the system is today.** This section describes what `master`
   builds, as of its dated heading — what a staff member could do if
   they ran it. **What is actually deployed is
   [project-status](../project-status/SKILL.md)'s to report, not this
   page's**; the page says only whether a deployment exists at all. The
   section changes when a phase ships, or when the branch alters
   something it describes: a screen added or removed, the role
   boundary, the deployment state. It carries **no counts** — not
   tests, not issues — precisely so that routine work doesn't
   invalidate it. A branch that changes nothing the section says is not
   a reason to touch it.
5. **Gates and dependencies.** Paragraphs naming a gate ("*Gated on*
   confirming DNS control") still hold. If the gate has been met or
   dropped, the text says so.

### Edit

Change only what the comparison found. Keep:

- the opening paragraphs, the **Backlog** paragraph, and the "Change
  this page when…" rule, word for word;
- the page's voice: present tense, plain sentences a church staff
  member could follow, lines wrapped near 72 characters, the same
  Markdown shapes (one `###` heading per phase, an optional
  parenthetical, one intent paragraph);
- user-facing language. "Staff can retire a product without losing its
  booking history", not "`active=false` on `items`".

Never add issue lists, counts of any kind (issues, tests, phases),
progress, assignees, board status, commit SHAs, or an archive table. A
number that changes on an ordinary merge turns this into a status page
and defeats the gate. Those belong in the log, the archive, and on
GitHub.

When item 4 applied, set the date in "Where the system is today
(YYYY-MM-DD)" to today. Leave it alone otherwise.

A phase is complete only when every issue carrying it is closed. Don't
mark one `(complete)` because this branch closes the phase's last
**open** issue — count this branch as merged, and if that empties the
phase, `(complete)` is correct.

## 6. Commit on the branch

One commit, on the current branch. Don't push and don't open anything.

```bash
git add docs/LOG.md docs/EXECUTION_PLAN.md docs/roadmap.md
git commit -F- <<'EOF'
docs: record <imperative summary, e.g. "P11.5 calendar month view">

<What the branch does and what the documents now say, a few wrapped
lines. Note explicitly if the roadmap needed no change.>

Co-Authored-By: <the model you are running as> <noreply@anthropic.com>
EOF
```

If the skill was **not** called from a branch about to become a pull
request — a direct request, or project-status handing over drift — and
the current branch is unrelated to the work being recorded, don't
create a branch or a worktree. Report the mismatches, show the edit as
a diff, and say the next pull request picks it up, because
open-pull-request runs this skill before every pull request and finds
the same drift.

## 7. Report

Hand back, concisely:

- **What you wrote** — the log entry, the archive row, and either the
  roadmap mismatches you fixed (each as a linked Issue, PR, or phase)
  or the one-line gate result: `Roadmap: no change needed (gate: the
  branch doesn't touch the page, doesn't finish a phase, and doesn't
  change what "Where the system is today" describes)`.
- **The commit SHA** of the docs commit.
- **What this unblocks** — issues whose dependency this branch closes.
  Say which ones a human should flip from `Blocked` to `Ready` after
  the merge; don't move them yourself.
- **Board drift** you noticed and did not fix (empty Phase/Owner, a
  `Status` disagreeing with reality).
- Any **housekeeping** worth doing — stale branches, leftover
  `.claude/worktrees/` directories. Flag it; never run destructive git
  operations as part of "updating the docs".

For the recommended next task, say "run `project-status`". Don't
recompute it here.

## Guardrails

- **No secrets and no customer data** in any of the three files. The
  repo is **public** and all three are committed — no connection
  strings, no `.env.local` contents, no real renter or staff
  identities, no Firebase UIDs. Refer to values by shape, never by
  value.
- **Never claim a merge, a schema apply, or a deploy that hasn't
  happened** (step 2).
- **Never run DDL against the shared Neon database and never deploy.**
- **Don't delete branches or worktrees** or run other irreversible git
  operations as part of recording work — surface them and let the
  developer confirm.
- **Don't write to GitHub.** No issue closes, comments, labels, or
  board edits; the `Closes #N` line and a human do that.
- Match the surrounding formatting of each file; don't reflow untouched
  content.
