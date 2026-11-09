# BCC Rentals Admin status — {YYYY-MM-DD}

## Where it runs

| Environment | GCP project | URL | Revision | Deployed commit | Deployed at (UTC) |
|---|---|---|---|---|---|
| Staging | `bcc-admin-staging` | {URL or "not deployed"} | {revision or —} | {[{sha7}]({commit URL}) or `unknown`} | {YYYY-MM-DD HH:MM or —} |
| Production | `bcc-admin-prod` | {URL or "not deployed"} | {revision or —} | {[{sha7}]({commit URL}) or `unknown`} | {YYYY-MM-DD HH:MM or —} |

{One line on access: Cloud Run is `--allow-unauthenticated`; the app itself gates on a Firebase session plus an `app_users` role.}
{One line if nothing is deployed: which issue changes that.}

## Phases

| | Phase | Progress | Issues open |
|---|---|---|---|
| Last complete | {Pn — title} | {closed}/{total} | 0 |
| **Current** | {Pn — title} | {closed}/{total} | {n} |
| Next | {Pn — title} | {closed}/{total} | {n} |

### Current: {Pn — title}

{Intent, one or two sentences, from docs/roadmap.md.}

When it ships, staff will be able to:
- {user-facing capability}

Issues:
- {✅ or ⬜} [Issue #{N}]({URL}) {title} <!-- Status: {board status} -->

### Next: {Pn — title}

{Intent, one or two sentences, from docs/roadmap.md.}

New capabilities:
- {user-facing capability}

Issues:
- ⬜ [Issue #{N}]({URL}) {title}

## What staff can do today

### Production
- {what a user can do today, or "Nothing — the app is not deployed."}

### Local (a developer's machine)
{"Same as production." or the capabilities beyond production, as bullets}

{One line if it applies: the app reads and writes the live storefront database, so edits made locally are already real for customers.}

## Latest closed issue

[Issue #{N}]({URL}) {title} ({phase}). Closed {YYYY-MM-DD HH:MM} UTC as {completed / not planned}.
Landed by: {[PR#N](URL), merged as [{sha7}]({commit URL}) | local merge [{sha7}]({commit URL}) | "no code change: {how it was resolved}"}

| Staging | Production |
|---|---|
| {✅ Deployed in [{sha7}]({commit URL}) / ⏳ Not yet deployed / — No code change} | {same} |

## Next issue

**[Issue #{N}]({URL}) {title}** ({phase}, Owner: {owner}, Priority: {priority})
{Two or three sentences: which rule settled it, what it unblocks, and — if Owner is `human` — that it is the developer's to run, not an agent's.}

In flight:
- {[Issue #{N}]({URL}) {title}: {board status, branch or agent}} <!-- or "Nothing in flight." -->

## Notes

- {Anything odd: `gh`/`gcloud` signed out, missing `project` scope, a `Ready` issue whose dependency is still open, an issue closed but not deployed, a deploy with no `commit-sha` label, the roadmap disagreeing with GitHub. "None." if nothing.}
