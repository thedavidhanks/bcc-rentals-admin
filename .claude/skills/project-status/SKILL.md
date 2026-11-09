---
name: project-status
description: Report BCC Rentals Admin's current status in a fixed format — the current and next phase, what staff can actually do today, where the app is running, the next issue to work on, and whether the latest closed issue has reached production. Use when asked for "status", "where are we", "project status", "what's next", or "what's deployed".
allowed-tools: Bash(gh *), Bash(gcloud *), Bash(git *), Read, Skill(update-roadmap)
---

# Project status

Produce one status report, filled into [template.md](template.md)
exactly: same headings, same order, same tables. Don't add sections or
drop any. When a value can't be found, write `unknown` and say why in
**Notes**.

**This skill only reads.** It never closes, comments on, labels, or
moves an issue or board card, never edits a doc, and never deploys.
Recording landed work is [update-plan](../update-plan/SKILL.md)'s job;
correcting the roadmap is [update-roadmap](../update-roadmap/SKILL.md)'s
(step 7 below).

The repository is `thedavidhanks/bcc-rentals-admin` and the board is
[Project #4](https://github.com/users/thedavidhanks/projects/4) (user
`thedavidhanks`, number 4). GitHub holds status;
[docs/roadmap.md](../../../docs/roadmap.md) holds each phase's intent;
[docs/ADMIN_APP_SPEC.md](../../../docs/ADMIN_APP_SPEC.md) holds the
requirements. Where GitHub and the roadmap disagree, GitHub is current,
and the disagreement goes in **Notes**.

Never write a bare `#N`. Write "Issue #N" or "PR#N", each linked
(`https://github.com/thedavidhanks/bcc-rentals-admin/issues/N` or
`.../pull/N`).

### Before you start: `gh` and `gcloud` may not be signed in

Both are commonly logged out in a fresh devcontainer. Check first, and
if either is out, fill its sections with `unknown`, say so in **Notes**,
and tell the developer the command to run **in their own terminal** —
these are interactive flows, so don't try to drive them:

```bash
gh auth status          # else: gh auth login, then gh auth refresh -s project
gcloud auth list        # else: gcloud auth login
```

Reading board fields needs the `project` token scope. A `missing
required scopes` error means `gh auth refresh -s project`, not a
different query.

## 1. Phases

This project has **no GitHub milestones**. The phase is the board's
`Phase` single-select field, and phase IDs are also the prefix of every
issue title (`P11.5 — …`), so they stay greppable. The full list of
board fields and their values is in
[update-plan's Board reference](../update-plan/SKILL.md#board-reference)
— read it there rather than keeping a second copy here.

```bash
gh issue list --repo thedavidhanks/bcc-rentals-admin --state all --limit 100 \
  --json number,title,state,labels,assignees

gh api graphql -f query='
{ user(login:"thedavidhanks"){ projectV2(number:4){ items(first:100){ nodes{
  content{ ... on Issue { number title state } }
  fieldValues(first:20){ nodes{ ... on ProjectV2ItemFieldSingleSelectValue {
    name field{ ... on ProjectV2SingleSelectField { name } } } } } } } } } }'
```

- **Current phase**: the lowest-numbered phase with open issues. Give
  its progress as closed/total issues.
- **Next phase**: the phase after it that still has open issues.
- Name the last phase that is **complete** — every issue carrying it is
  closed, and [docs/roadmap.md](../../../docs/roadmap.md) marks its
  heading `(complete)`.

Take each phase's intent from its paragraph in docs/roadmap.md. Describe
what the current phase will add once it ships, and the next phase's new
capabilities, in **user-facing terms** — what a Bachman Community Center
staff member will be able to do — one bullet each, drawn from the
roadmap paragraph and the issue titles. Not "wire up the repository
layer".

## 2. Where it runs

There is **no CI and no GitHub Environments** here — the repo has no
`.github/` directory, and a deploy is a human running `gcloud run deploy`
per the P8 runbook. So read Cloud Run directly. The two projects are
`bcc-admin-staging` and `bcc-admin-prod`, region `us-east1`:

```bash
for p in bcc-admin-staging bcc-admin-prod; do
  gcloud run services list --project "$p" --region us-east1 \
    --format 'value(metadata.name,status.url,status.latestReadyRevisionName)'
done
```

No service means **not deployed** — say exactly that, not `unknown`.
As of the last roadmap update neither project has one; P8 is the phase
that changes it.

When a service does exist, get its revision, image and deploy time:

```bash
gcloud run revisions describe <revision> --project <project> --region us-east1 \
  --format 'value(metadata.creationTimestamp,spec.containers[0].image,metadata.labels)'
```

The **deployed commit** is only knowable if the deploy stamped it.
Report it from a `commit-sha` label or an image tag that carries one; if
neither is there, write `unknown` and put in **Notes** that the P8
runbook should deploy with `--labels commit-sha=$(git rev-parse --short HEAD)`
so this is answerable at all. Don't infer the deployed commit from
`master`'s tip — a local deploy can ship uncommitted work.

Say who can reach each URL. Cloud Run is `--allow-unauthenticated` by
design; **the app is the gate** (Firebase session → `app_users` role),
so an un-provisioned visitor is denied by the app, not the platform.

## 3. What staff can do today

Describe what a user can do **right now**, in user-facing terms, from
the "Where the system is today" section of docs/roadmap.md and the
closed issues. Split production from local only where they differ.

While nothing is deployed, production is "nothing — the app runs on a
developer's machine only", and the whole feature list belongs under
local. Say plainly that the app nonetheless reads and **writes the
live storefront database**, so edits made locally are already real for
customers.

Don't list a feature as available in production that has been merged
but not deployed.

## 4. Latest closed issue, and where it has reached

```bash
gh issue list --repo thedavidhanks/bcc-rentals-admin --state closed --limit 50 \
  --json number,title,closedAt,stateReason \
  --jq 'sort_by(.closedAt) | reverse | .[0:3][] | "\(.number)\t\(.closedAt)\t\(.stateReason)\t\(.title)"'
```

Sort by `closedAt`; `gh issue list` returns issues newest-*created*
first, which is a different order.

Find the change that closed it, in this order:

1. The merged pull request that closed it:
   ```bash
   gh issue view <N> --repo thedavidhanks/bcc-rentals-admin \
     --json closedByPullRequestsReferences,timelineItems
   ```
2. Falling back to the commit, because work before 2026-11-08 reached
   `master` by a **local `git merge`** with `Closes #N` in the final
   commit, with no pull request at all:
   ```bash
   git log --oneline --grep "Closes #<N>" -i master
   ```
   Several phases landed by fast-forward, so the "merge commit" and the
   work commit are often the same SHA. That is normal here, not a
   finding.
3. If neither exists, or the issue is `not_planned`, write **No code
   change, nothing to deploy** and say how it was resolved, from its
   last comment.

Then: is that commit deployed? With no deployment and no stamped
commit, the answer is **Not deployed** for both columns. Once step 2
yields a deployed SHA, compare:

```bash
git merge-base --is-ancestor <landed_sha> <deployed_sha> && echo deployed || echo "not yet"
```

An issue closed but not running in production is normal here while P8
is open — note it once, don't flag every issue.

## 5. Next issue

This section is the **canonical definition** of what is next.
[next-task-prompt](../next-task-prompt/SKILL.md) and
[update-plan](../update-plan/SKILL.md) both defer to the rule below
rather than restating it.

An issue is **ready to pick up** when all of these hold:

1. it is **open**;
2. its board `Status` is `Ready` (not `Backlog`, `Blocked`,
   `In progress`, or `In review`);
3. **every dependency named in its body** (`Blocked by P8.1`, "needs
   #4") is closed — check this yourself; a `Ready` status on a blocked
   issue is the failure mode that wastes a session, and when you find
   one, report it in **Notes**;
4. nothing already in flight owns the same files.

Among the ready issues, rank by, in order:

1. **the launch-critical path** — P8's deploy chain (runbook → deploy →
   domain → smoke test) and the P7 cross-system check gate real use by
   staff; everything else is polish or tech debt;
2. the board's `Priority` field (High > Medium > Low);
3. the lowest phase number, so phases finish instead of fraying;
4. unblocking the most other issues.

Report the single recommended issue with its phase, `Owner` and two or
three sentences on why it won. Note when `Owner` is `human` — deploys,
DDL against the shared database, and cross-system checks are not
delegable to an agent, so the recommendation is work for the developer,
not a prompt to launch. List the issues in flight (`In progress` /
`In review`), one line each.

## 6. Report

Fill in [template.md](template.md). Replace each `{placeholder}` and
remove the HTML comments. Keep the headings and table columns exactly
as the template gives them. Dates are `YYYY-MM-DD` (times in UTC when
given); commits are seven characters, linked to
`https://github.com/thedavidhanks/bcc-rentals-admin/commit/<sha>`.

## 7. Roadmap disagreements

After the report, if **Notes** records docs/roadmap.md disagreeing with
GitHub — a phase missing, renamed, or out of order; a phase whose issues
are all closed but whose heading is not marked `(complete)`; "Where the
system is today" describing something other than what the code does —
run the `update-roadmap` skill, passing it those disagreements as its
trigger. If nothing disagrees, don't run it.
