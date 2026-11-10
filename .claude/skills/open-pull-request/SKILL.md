---
name: open-pull-request
description: Check a branch before it becomes a pull request to bcc-rentals-admin — no secrets or stray files in the diff, lint/typecheck/tests green, schema and deploy changes flagged as human-only, the plan documents (log, archive, roadmap) written on the branch by update-roadmap, and a body with a Closes #N line — then open it and explain in plain English what it adds, which issue it closes, and how it moves the roadmap. Use whenever a pull request is about to be opened, or when asked to "open a PR", "send a PR", "create a pull request", or "ship this branch".
allowed-tools: Bash(gh *), Bash(git *), Bash(npm run *), Bash(npm test *), Read, Edit, Skill(update-roadmap)
---

# Open a pull request

Every branch reaches `master` through a pull request. This skill runs
the checks, fixes what it safely can on the branch, opens the pull
request once the developer says yes, and then explains what it does.

The repository is `thedavidhanks/bcc-rentals-admin`; the base branch is
**`master`**. The rules come from [CLAUDE.md](../../../CLAUDE.md).

**A human merges.** Both `Bash(git merge:*)` and `Bash(gh pr merge:*)`
are denied in `.claude/settings.json`, deliberately: this app is a
second writer to the storefront's production database, so a human reads
the diff before it becomes trunk. Open the pull request and stop. Don't
ask for the deny to be lifted.

Outside the `Closes` line, never write a bare `#N`. Write "Issue #N" or
"PR#N", linked to
`https://github.com/thedavidhanks/bcc-rentals-admin/issues/N` or
`.../pull/N`.

## 1. What the branch delivers

```bash
git branch --show-current
git status --porcelain
git fetch origin master
git log --oneline master..HEAD
git diff --stat master...HEAD
```

**Never open a pull request from `master`** — if `HEAD` is `master`,
stop and ask the developer which branch this should be.

Uncommitted changes are the developer's: ask whether they belong in
this pull request before committing any of them.

Find the issue or issues the branch closes. Start with the branch name
(`code-writer/p11-5-6-7-calendar-wave` → the P11.5/P11.6/P11.7 issues),
then the commits, then the conversation. Issue titles carry their phase
ID, so a plan ID in the branch name resolves with:

```bash
gh issue list --repo thedavidhanks/bcc-rentals-admin --search "P11.5 in:title" --state all
gh issue view <N> --repo thedavidhanks/bcc-rentals-admin \
  --json number,title,state,body
```

Each must be an **open** issue of this repository. Note its acceptance
criteria — step 5 maps them to evidence. If you can't tell which issue
it is, ask; a pull request with no `Closes` line leaves the board to be
corrected by hand later.

## 2. Nothing in the diff that must not be there

The repo is **public** and `.env.local` holds **live production
credentials**. Review the full diff, not just the file list:

```bash
git diff master...HEAD --name-only
git diff master...HEAD | grep -nEi \
  'postgres(ql)?://|BEGIN [A-Z ]*PRIVATE KEY|AIza[0-9A-Za-z_-]{20,}|private_key|__session=|service_account'
```

Any hit stops the pull request — report it and take it off the branch.
If a real credential was **already pushed**, say so immediately and
treat rotation (Neon password reset, key revocation) as the first step;
removing the line does not un-publish it.

Also check for things that shouldn't be committed at all:

```bash
git diff master...HEAD --name-only | grep -E '^\.env|node_modules/|^\.next/|^\.claude/worktrees/'
```

And for real customer or staff data in fixtures and test files —
reservation contact details, `app_users` emails or Firebase UIDs. Tests
use synthetic values (`jane@example.com`); a real row in a fixture is a
stop.

## 3. Changes a commit alone cannot deliver

Three kinds of change on a branch need a human to do something beyond
merging. Find them now so they go in the body rather than surprising
someone after the merge:

```bash
git diff master...HEAD --name-only | grep -E '^db/schema.sql|^scripts/db/|^docs/DEPLOY|^Dockerfile|^next.config'
git diff master...HEAD -- package.json
```

- **Schema** (`db/schema.sql`): an agent may write it; a **human** runs
  `npm run db:apply`, **dev branch first**. Nothing on the branch may
  have run DDL. Say in the body that the merge does not apply it and
  name the command.
- **Deploy / infrastructure** (`Dockerfile`, `next.config.ts`, env
  vars, GCP or Firebase console settings): call it out as an `ops`
  follow-up; merging changes nothing until someone deploys.
- **New dependencies** in `package.json`: CLAUDE.md's rails say an
  agent surfaces one rather than installing it. If the branch added
  one, say which and why, and let the developer decide before the pull
  request goes up.

## 4. Checks

```bash
npm run lint
npm run typecheck
npm test
```

All three must pass. Keep `npm test`'s summary line for the body's
**Verification** — report the real file and test counts, and compare
them with `master`'s so the body can say the branch **added** coverage
rather than rewrote it. A failure stops the pull request: report the
output and fix the cause, or ask.

**Don't run `npm run build` in a worktree and don't treat its failure
as a defect.** Worktrees have no `.env.local`, and `app/layout.tsx`
calls `getSessionUser()` for every route, so page-data collection
aborts on `DATABASE_URL: Required` — reproduced on clean `master`, so
it is an environment artifact, app-wide and pre-existing. Never copy
`.env.local` into a worktree to get around it.

If the branch changed anything only a browser can confirm — calendar
layout, a form, anything `.tsx` — say so explicitly. `vitest` is
`environment: "node"` with `include: ["tests/**/*.test.ts"]`, so
**no `.tsx` is ever collected**; a green suite is not evidence that a
screen renders.

## 5. The plan documents

Run the [update-roadmap](../update-roadmap/SKILL.md) skill, with this
branch as its trigger. It owns all three plan documents and writes them
**on this branch**, as one commit, so they merge with the change they
describe:

- [docs/LOG.md](../../../docs/LOG.md) — the dated entry: what this
  branch does, the decisions behind it, how it was verified. Written
  for every substantive branch.
- the archive in
  [docs/EXECUTION_PLAN.md](../../../docs/EXECUTION_PLAN.md) — one row
  per task this branch completes.
- [docs/roadmap.md](../../../docs/roadmap.md) — judged as if this
  branch had merged, along with any drift already on `master`.

Don't write any of those three yourself, and don't go read them to
second-guess what it did; take its report and put it in the body.

**The roadmap part usually comes back `no change needed (gate: …)`
after three commands** — its gate exits early unless the branch touches
the page, finishes a phase, or changes what "Where the system is today"
describes. That one-line answer is the step completing, not the step
being skipped; put it in the body's **Roadmap** line as "needed no
change" and move on. The log entry and archive row are written either
way.

A phase is complete only when every issue carrying it is closed, and
that skill counts this branch as merged when it judges that. If this
pull request closes the phase's last open issue, say so in step 7.

Nothing is left to do after the merge: the `Closes #N` line closes the
issue and flips the board to `Done`, and the documents merge with the
code.

## 6. The body

Write it to a file, in this order:

~~~markdown
## Summary

<One plain sentence on what the change does for a staff member, linking
the issue as [Issue #N](https://github.com/thedavidhanks/bcc-rentals-admin/issues/N).>

- **`path/to/file`**: <what changed in it and why>

## Acceptance criteria

- **<criterion from the issue>**: <the test or manual check that shows it>

## Verification

```text
<npm test summary; lint and typecheck results>
```

<What only a browser can confirm, and anything checked by hand.>

## Needs a human after merge

<Schema apply, deploy, new dependency — or "Nothing: merging is all
this needs.">

---
Closes #N

🤖 Generated with [Claude Code](https://claude.com/claude-code)
~~~

### The Closes line

`Closes #N`, on a line of its own, is **wanted** here — GitHub closes
the issue on merge and the board's `Status` flips to `Done`
automatically, which is the whole point of deriving status rather than
hand-maintaining it. Two issues take two lines. Keep the number bare on
that line, even though every other mention is linked.

If a branch genuinely delivers only part of an issue, write
`Part of Issue #N` instead and say what remains — don't close an issue
the branch doesn't finish.

Check the file before using it:

```bash
body=/tmp/pr-body.md
grep -nE '^Closes #[0-9]+$' "$body" || echo 'MISSING: no bare Closes #N line'
for n in $(grep -oE '^Closes #([0-9]+)$' "$body" | grep -oE '[0-9]+'); do
  gh issue view "$n" --repo thedavidhanks/bcc-rentals-admin --json state,url \
    --jq '"\(.url) \(.state)"'
done
grep -nEi 'postgres(ql)?://|private_key|__session=' "$body" && echo 'STOP: secret in body'
```

Each issue must print `OPEN` and an `/issues/` URL.

## 7. Confirm, open, and explain

Pushing and opening a pull request publish the change to a public
repository. Show the developer the branch's commits, the title, and the
body, and say what steps 2 to 5 found and fixed. Then ask. On a yes:

```bash
git push -u origin HEAD
gh pr create --repo thedavidhanks/bcc-rentals-admin --base master \
  --title "<imperative summary>" --body-file /tmp/pr-body.md
```

Then report, in plain English, for someone who hasn't read the code:

```markdown
**Opened [PR#N](https://github.com/thedavidhanks/bcc-rentals-admin/pull/N): <title>**

**Closes:** [Issue #N](https://github.com/thedavidhanks/bcc-rentals-admin/issues/N), <issue title>.

**What it adds:**
- <A capability as a staff member sees it, e.g. "The calendar has a
  Month button, and a booking of five chairs shows as one bar instead
  of five.">
- <Another, if any. Name refactors, docs, or test-only work as such, in
  one line.>

**Roadmap:** <Phase>, whose intent is <the roadmap paragraph in a
clause>. This pull request covers <which part>. Still open in the phase
after it: <each remaining issue, linked, with its title in a few
words>, or "nothing: the phase completes when this merges". The roadmap
page itself <was updated in this pull request to say …> / <needed no
change>.

**Docs in this pull request:** the LOG entry and archive row for
<plan ID>, plus the roadmap edit above if there was one — all in
<docs commit SHA>, so nothing needs writing after the merge.

**Checks:** <secret scan, stray files, lint, typecheck, test counts,
roadmap: one line each, with any fix this skill made.>

**Before merging:** <what a human must do — read the diff; plus any
schema apply, deploy, or browser check from step 3/4.>

You merge it — `gh pr merge` is denied to agents here. Nothing needs
recording afterwards: the docs are in the pull request and `Closes #N`
closes the issue.
```

Get "still open in the phase" from GitHub, not from the roadmap:

```bash
gh issue list --repo thedavidhanks/bcc-rentals-admin --state open \
  --search "P8 in:title" --json number,title
```

The issue this pull request closes is closed by the merge itself —
leave it out of what's still open.
