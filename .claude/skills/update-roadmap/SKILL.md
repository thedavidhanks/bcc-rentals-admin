---
name: update-roadmap
description: Bring docs/roadmap.md in line with GitHub after the plan changes or a phase ships. On a branch about to become a pull request, commit the edit there; otherwise report it for the next one. Never opens a pull request of its own. Use from open-pull-request before every pull request — a three-command gate exits early on the branches that don't move the plan, which is most of them; after an issue is created or closed or a pull request merges; when project-status finds the roadmap disagreeing with GitHub; or when asked to "update the roadmap" or "sync the roadmap".
allowed-tools: Bash(gh *), Bash(git *), Read, Edit
---

# Update the roadmap

Decide whether [docs/roadmap.md](../../../docs/roadmap.md) still matches
GitHub and, if it doesn't, change it. Most runs end with **no change
needed**: the page says to change it "when the plan changes (a phase is
added, removed, reordered, or rescoped) or when a phase ships, not as
issues close." Hold to that. An issue opening or closing inside a
phase, or a branch merging, is status, and status lives on GitHub.

The repository is `thedavidhanks/bcc-rentals-admin` and the board is
[Project #4](https://github.com/users/thedavidhanks/projects/4). GitHub
is current: where the page and GitHub disagree, the page moves, never
GitHub. This skill never creates, edits, closes, or re-phases an issue,
and never moves a board card.

**This skill owns docs/roadmap.md, and only that file.** It does not
touch [docs/LOG.md](../../../docs/LOG.md) or the archive in
[docs/EXECUTION_PLAN.md](../../../docs/EXECUTION_PLAN.md) — both belong
to [update-plan](../update-plan/SKILL.md) — and it does not report
project status, which is
[project-status](../project-status/SKILL.md)'s. Read
[docs/ADMIN_APP_SPEC.md](../../../docs/ADMIN_APP_SPEC.md) for what a
phase was meant to deliver, but never edit the spec: it is the
authoritative requirement document and changing it is a decision, not a
sync.

Never write a bare `#N`. Write "Issue #N" or "PR#N", linked to
`https://github.com/thedavidhanks/bcc-rentals-admin/issues/N` or
`.../pull/N`.

## 1. What triggered this

Note the trigger, if there is one: the issue or pull request that was
created, closed, or merged, the disagreement project-status reported,
or a branch the
[open-pull-request skill](../open-pull-request/SKILL.md) is about to
send. That last one puts this run in **branch mode** (step 5). Read the
trigger:

```bash
gh issue view N --repo thedavidhanks/bcc-rentals-admin \
  --json number,title,state,stateReason,body
gh pr view N --repo thedavidhanks/bcc-rentals-admin \
  --json number,title,state,mergedAt,mergeCommit,body,files
```

In branch mode, read the branch instead:
`git diff --stat master...HEAD` and `git diff master...HEAD`.

The trigger tells you where to look first, but always run the full
comparison in step 3: drift from earlier events counts too.

## 2. Gather

### Branch-mode fast path — check this before gathering anything

`open-pull-request` calls this skill on **every** pull request, and the
plan moves only a handful of times across a phase. Gathering the full
picture each time to conclude "no change needed" is a tax on every
merge, so in **branch mode** run these three cheap checks first:

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

**All three empty → stop.** Report `No change needed (gate: the branch
doesn't touch the roadmap, doesn't finish a phase, and doesn't change
what "Where the system is today" describes)` and hand that one line
back to open-pull-request. Don't run the queries below.

Any one of them hits → carry on with the full comparison.

The gate is **branch mode only**. A direct "update the roadmap" request
or a disagreement handed over by
[project-status](../project-status/SKILL.md) is a deliberate ask —
always do the full comparison for those, however little the last branch
changed.

Two things the gate deliberately ignores, because they churn on almost
every branch and would hold it open permanently: the **test count** and
the set of closed issues inside an unfinished phase. Neither belongs on
the page — that is why the page states no counts.

### The full comparison

There are **no GitHub milestones** in this repo. A phase is the board's
`Phase` field plus the `Pn.m — ` prefix on every issue title. Run:

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

Read docs/roadmap.md as it is on `master`
(`git show master:docs/roadmap.md`), not a local branch that may be
stale. If the board query fails for missing scope, carry on from issue
titles alone and say in the report that phase assignments came from
titles, not the board.

## 3. Compare

Check each of these. Write down every mismatch with the GitHub fact
that shows it.

1. **Added, removed, renamed, reordered.** Every phase that issues or
   the board refer to has a `###` heading under **Phases**, in
   P-number order, and no heading names a phase nothing refers to.
2. **Shipped.** A phase has shipped when **every** issue carrying it is
   closed. Its heading ends `(complete)` and its intent paragraph stays
   as written. A phase with no issues at all is not evidence of
   anything — check the archive in
   [EXECUTION_PLAN.md](../../../docs/EXECUTION_PLAN.md), which maps the
   pre-tracker phases P0–P5 to the commits that landed them.
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
   page's**; the page says only whether a deployment exists at all. In
   branch mode, count the branch as merged. The section changes when a
   phase ships, or when a merged change alters something it describes:
   a screen added or removed, the role boundary, the deployment state.
   It carries **no counts** — not tests, not issues — precisely so that
   routine work doesn't invalidate it; if you are tempted to add one,
   it belongs in [project-status](../project-status/SKILL.md) (live) or
   [LOG.md](../../../docs/LOG.md) (dated) instead. A merge that changes
   nothing the section says is not a reason to touch it.
5. **Gates and dependencies.** Paragraphs naming a gate ("*Gated on*
   confirming DNS control") still hold. If the gate has been met or
   dropped, the text says so.

If nothing mismatches, report **No change needed**, with one line per
check, and stop.

## 4. Edit

Change only what step 3 found. Keep:

- the opening paragraphs, the **Backlog** paragraph, and the "Change
  this page when…" rule, word for word;
- the page's voice: present tense, plain sentences a church staff
  member could follow, lines wrapped near 72 characters, the same
  Markdown shapes (one `###` heading per phase, an optional
  parenthetical, one intent paragraph);
- user-facing language. "Staff can retire a product without losing its
  booking history", not "`active=false` on `items`".

Never add issue lists, counts of any kind (issues, tests, phases),
progress, assignees, board status, commit SHAs, or an archive table.
A number that changes on an ordinary merge turns this into a status
page and defeats the step 2 gate. Those live on GitHub, in
[LOG.md](../../../docs/LOG.md), and in
[EXECUTION_PLAN.md](../../../docs/EXECUTION_PLAN.md) respectively.

When step 3 item 4 applied, set the date in "Where the system is today
(YYYY-MM-DD)" to today. Leave it alone otherwise.

**No secrets, no customer data.** The repo is public and this file is
committed — no connection strings, no real renter or staff identities.

## 5. Where the edit goes

Never open a pull request for the roadmap alone, and never merge one.
The edit rides with the change it describes, so the page and the code
move together and a reader of `git log` sees why the plan changed.

**Branch mode** (called from open-pull-request): edit docs/roadmap.md
on the current branch and commit it there, as a commit of its own:

```bash
git add docs/roadmap.md
git commit -F- <<'EOF'
docs: <imperative summary, e.g. "mark P6 complete in the roadmap">

<What GitHub showed and what the page now says, a few wrapped lines.>

Co-Authored-By: <the model you are running as> <noreply@anthropic.com>
EOF
```

Then hand back to open-pull-request a list of the mismatches, each as a
linked Issue, PR, or phase, with what changed on the page. The pull
request's body describes them. Don't push, and don't open anything.

**Otherwise** (project-status, or a direct request): don't create a
branch, a worktree, or a commit. Report the mismatches and show the
edit as a diff. Say that the next pull request picks it up, because
open-pull-request runs this skill in branch mode before every pull
request and finds the same drift. If the developer wants it out sooner,
it goes with whatever feature branch they send next.
