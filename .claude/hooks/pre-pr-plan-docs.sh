#!/usr/bin/env bash
# PreToolUse(Bash) — stop a pull request that has no plan-docs commit.
#
# The plan documents (docs/LOG.md, the archive in docs/EXECUTION_PLAN.md,
# docs/roadmap.md) are written by the `update-roadmap` skill ON THE BRANCH,
# so they merge in the same pull request as the code and nothing is left to
# record afterwards. This hook is the backstop for when that step is skipped.
#
# Passes silently when the branch already commits one of those files.
# Otherwise returns "ask", so the developer can approve a branch that
# genuinely needs no entry (a typo fix) without the hook ever hard-blocking.
#
# Exit 0 with no output = stay out of the way; normal permissions apply.

set -uo pipefail

payload=$(cat)

cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0
# Only pull-request creation. Tolerate flags between `pr` and `create`.
printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])gh[[:space:]]+pr[[:space:]]+create([^[:alnum:]_-]|$)' || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

branch=$(git branch --show-current 2>/dev/null)
# Detached HEAD, or on master (open-pull-request refuses that itself).
[ -n "$branch" ] && [ "$branch" != "master" ] || exit 0

PLAN_DOCS=(docs/LOG.md docs/EXECUTION_PLAN.md docs/roadmap.md)

# Compare against the merge base so this reports only what the branch adds.
if ! base=$(git merge-base master HEAD 2>/dev/null) || [ -z "$base" ]; then
  exit 0  # no comparable master locally; don't guess
fi

touched=$(git diff --name-only "$base" HEAD -- "${PLAN_DOCS[@]}" 2>/dev/null)
[ -z "$touched" ] || exit 0   # the skill ran — let it through

# Nothing recorded. Say whether the branch also looks like it moves the plan,
# so the reason is specific rather than a blanket nag.
extra=""
surface=$(git diff --name-only "$base" HEAD 2>/dev/null \
  | grep -E '^app/(.*/)?page\.tsx$|^middleware\.ts$|^lib/auth/|^Dockerfile$|^next\.config\.ts$' \
  | head -5 | tr '\n' ' ')
[ -n "$surface" ] && extra=" It also changes what \"Where the system is today\" describes (${surface% }), so the roadmap may need an edit too."

jq -n --arg b "$branch" --arg e "$extra" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: ("Branch \($b) commits no plan docs — no entry in docs/LOG.md, no archive row in docs/EXECUTION_PLAN.md, no roadmap change.\($e)\n\nRun the update-roadmap skill first: it writes them on this branch and commits them, so they merge with the code and nothing needs recording after the merge.\n\nApprove to open the pull request anyway (fine for a typo or chore branch that warrants no entry).")
  }
}'
exit 0
