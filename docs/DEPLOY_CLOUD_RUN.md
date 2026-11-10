# Deploy the admin app to GCP Cloud Run

Runbook for plan phase **P8 — Deployment** (`P8.1`–`P8.6`). This is the **admin** app's
runbook, written from this repo's own code; it replaces an earlier copy of the
storefront's runbook that described a different app. The admin app takes **no payments**,
sends no email, and uses no cache service: its only secret is a database URL and its only
third-party dependency at runtime is Firebase Authentication. There is no webhook endpoint
to register anywhere.

Containerisation is done in-repo: [`Dockerfile`](../Dockerfile),
[`.dockerignore`](../.dockerignore), and `output: 'standalone'` in
[`next.config.ts`](../next.config.ts).

Two ways to ship:

| | When | Section |
| --- | --- | --- |
| **Automated** (normal) | every merge to `master` | [§5 GitHub Actions](#5--automated-deploys-github-actions-p86) |
| **Manual** (first deploy, or if CI is broken) | by hand from a workstation | [§3 Manual deploy](#3--manual-deploy-p82) |

> **No agent deploys.** Per [`CLAUDE.md`](../CLAUDE.md), a human runs the first real deploy
> and applies branch protection. Agents may write these files; they do not execute them.

---

## 1 — The target, in one table

| Thing | Value |
| --- | --- |
| GCP org | `bachmancc.org` (`513346324292`), folder `bcc-rentals` (`873642981137`) |
| Project | **`bcc-admin-prod`** (`305395393303`) |
| Region | `us-east1` (Neon lives in AWS `us-east-1`; keep them close) |
| Cloud Run service | `bcc-rentals-admin` |
| Container port | `8080` |
| Scaling | `--min-instances 0` (scale to zero; idle cost ≈ $0) |
| Ingress auth | `--allow-unauthenticated` — see the box below |
| **Runtime** identity | `run-runtime@bcc-admin-prod.iam.gserviceaccount.com` |
| **Deploy** identity | `github-deployer@bcc-admin-prod.iam.gserviceaccount.com` |
| Image registry | Artifact Registry `us-east1-docker.pkg.dev/bcc-admin-prod/bcc-admin` |
| Only secret | `DATABASE_URL` (Secret Manager, already created) |
| Custom domain | `admin.bachmancc.org` |
| Firebase / Identity Platform tenant | `bcc-admin-staging` today; a `bcc-admin-prod` web app is planned (§5.4) |

### Why `--allow-unauthenticated` is correct here

Cloud Run IAM gates **Google service accounts**, not the centre's staff, who sign in with
Google / Email+Password through Firebase. Spec [§10](./ADMIN_APP_SPEC.md) says this
outright: *"Do **not** rely on Cloud Run IAM `--no-allow-unauthenticated` for user login;
that gates Google service accounts, not your social-login users."*

**The app is the gate.** [`middleware.ts`](../middleware.ts) redirects any request without
a session cookie to `/login`, and every Server Component, route handler, and server action
calls the Node-runtime guards (`lib/auth/guards.ts`) which verify the Firebase session
cookie and look up `app_users.role`. `--allow-unauthenticated` here is deliberate, not an
oversight.

**The reasoning is right; the binding still does not land by itself.** This runbook used to
claim the `allUsers` **invoker** binding was exempt from the org's domain-restricted-sharing
constraint (`constraints/iam.allowedPolicyMemberDomains`). It is **not** — the org refuses it
unless a project-scoped exception exists on `bcc-admin-prod`, and `gcloud run deploy` reports
that refusal as a *warning* while exiting `0`, so the deploy looks successful and the service
answers `403` to everyone. Apply **§3.3 before the first deploy**. Every *other* IAM member
you add in this org must still be an `@bachmancc.org` identity — see §5.2.

### Two service accounts, two jobs — do not merge them

- **`run-runtime@…`** is what the *running container* is. It must stay least-privilege:
  `roles/secretmanager.secretAccessor` on the `DATABASE_URL` secret, and nothing else. It
  is passed to `gcloud run deploy` as `--service-account`. **Never grant it deploy roles.**
- **`github-deployer@…`** is what *CI impersonates to perform a deploy*. It needs
  `roles/run.admin`, `roles/artifactregistry.writer`, and `roles/iam.serviceAccountUser` on
  `run-runtime` (to be allowed to assign that runtime identity). It never runs the app.

---

## 2 — Configuration: what is a secret, what is a build arg, what is both

[`lib/env.ts`](../lib/env.ts) (server) and [`lib/public-env.ts`](../lib/public-env.ts)
(client-safe) are the source of truth. Both Zod-validate **at module load**, so the app
*fails to start* — and `next build` *fails to build* — when a required var is missing.

| Var | Secret? | Build time | Runtime | Notes |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | **yes** (Secret Manager) | placeholder only | **yes** | Neon **pooled** endpoint, prod branch |
| `FIREBASE_PROJECT_ID` | no | yes | yes | Admin SDK project id |
| `NEXT_PUBLIC_SITE_URL` | no | **yes** | yes | `https://admin.bachmancc.org` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | no | **yes** | yes | publishable client config |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | no | **yes** | yes | |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | no | **yes** | yes | |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | no | **yes** | yes | |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | no | optional | optional | omit entirely if unused — an **empty string fails** `.min(1)` |
| `ALLOWED_EMAIL_DOMAIN` | no | — | optional | e.g. `bachmancc.org`; omit entirely if unused |
| `NODE_ENV` | no | — | `production` | already set in the image |
| `DATABASE_URL_DEV` | — | **never** | **never** | local DDL tooling only |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | **never** | **never** | **local dev only.** On Cloud Run the runtime SA's Application Default Credentials sign session cookies — do **not** add a key file as a Cloud Run secret |
| `AUTH_DEV_BYPASS` | — | **never** | **never** | dev-only; forced off in production anyway |

Three rules that follow from that table:

1. **`NEXT_PUBLIC_*` must be passed twice.** Next.js inlines them into the browser bundle
   at *build* time, so they must be `--build-arg`s; `lib/public-env.ts` also validates them
   *server-side* at module load, so the same values must be set again as runtime env vars.
   Keep the two copies identical — a mismatch ships a browser bundle pointing at one
   Firebase project while the server thinks it is another.
2. **`DATABASE_URL` is a build arg only as a placeholder.** `next build` imports
   `lib/env.ts` but never opens a connection (verified: every route is `ƒ` dynamic, nothing
   is prerendered against the DB). The [`Dockerfile`](../Dockerfile) defaults it to
   `postgresql://build:build@localhost:5432/build`. **Do not pass the real connection
   string as a build arg** — build args are recorded in image metadata.
3. **Omit optional vars rather than setting them empty.** They are `.min(1).optional()`:
   absent is fine, `""` is a boot failure.

---

## 3 — Manual deploy (P8.2)

Use this for the first deploy, or when CI is unavailable. `gcloud` is installed in the
devcontainer but has no logged-in account by default.

```bash
gcloud auth login                       # as an @bachmancc.org identity
export PROJECT_ID=bcc-admin-prod
export REGION=us-east1
export SERVICE=bcc-rentals-admin
export AR_REPO=bcc-admin
export RUNTIME_SA="run-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud config set project "$PROJECT_ID"
```

### 3.1 One-time project setup (mostly already done under P10)

APIs `run`, `artifactregistry`, `identitytoolkit`, `secretmanager`, `iam`, and
`cloudbuild` are **already enabled** on `bcc-admin-prod`, and the `DATABASE_URL` secret
already exists with `run-runtime` granted `secretAccessor`. The commands below are
idempotent — run them only to verify or to rebuild the project from scratch.

```bash
gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  identitytoolkit.googleapis.com iam.googleapis.com cloudbuild.googleapis.com

# The Docker repository the image is pushed to.
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker --location="$REGION" \
  --description="bcc-rentals-admin container images" \
  || echo "already exists"

# The ONLY secret this app has. (Already created — this is the shape, not a to-do.)
printf '%s' "REPLACE_ME_WITH_THE_NEON_POOLED_PROD_URL" \
  | gcloud secrets create DATABASE_URL --data-file=- \
  || printf '%s' "REPLACE_ME_WITH_THE_NEON_POOLED_PROD_URL" \
     | gcloud secrets versions add DATABASE_URL --data-file=-

gcloud secrets add-iam-policy-binding DATABASE_URL \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role=roles/secretmanager.secretAccessor

# Firebase Admin SDK permissions for the RUNTIME identity. Without these the app
# deploys, boots and serves /login — and then every sign-in fails. See below.
gcloud iam roles create adminAppAuth --project="$PROJECT_ID" \
  --title="Admin app auth runtime" \
  --description="Minimum Identity Platform access for the admin app's server code" \
  --permissions=firebaseauth.users.createSession,firebaseauth.users.get,firebaseauth.users.update \
  || echo "already exists"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="projects/${PROJECT_ID}/roles/adminAppAuth"
```

#### `run-runtime` needs Identity Platform access, not just the secret

This is the step that is easiest to miss, because skipping it produces a deploy that
looks **completely healthy**: the container starts, Zod env validation passes, `/`
redirects to `/login`, and the login page renders with the right Firebase config. Sign-in
then fails on the server with:

```text
Credential implementation provided to initializeApp() via the "credential" property
has insufficient permission to access the requested resource.
```

That message names the *credential*, which sends you looking at `GOOGLE_APPLICATION_CREDENTIALS`
and ADC. The credential is fine. On Cloud Run the Admin SDK uses the runtime service
account's ADC, and `run-runtime` is deliberately least-privilege — created under P10 with
**no project roles at all**, only `secretAccessor` on one secret. It therefore cannot call
Identity Platform. Diagnose it with:

```bash
gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' \
  --filter="bindings.members:${RUNTIME_SA}" --format='value(bindings.role)'
# No output = this step was skipped.
```

Three permissions are needed, and each is traceable to a call in the app:

| Permission | Required by |
| --- | --- |
| `firebaseauth.users.createSession` | `createSessionCookie` in `lib/auth/session.ts` |
| `firebaseauth.users.get` | `verifyIdToken(idToken, true)` and `verifySessionCookie(value, true)` — both pass `checkRevoked: true`, which calls the API rather than verifying locally |
| `firebaseauth.users.update` | `setCustomUserClaims` in `app/users/actions.ts` |

`roles/firebaseauth.admin` also covers all three and is a single command, but it adds the
ability to create and delete Firebase users — worth avoiding on an identity whose entire
purpose is to be minimal. If you grant it as a stopgap, narrow it afterwards.

IAM changes apply to the **running** revision; no redeploy is needed. Allow a minute for
propagation, and force a new revision only if it is still failing after a few.

Local development does not exercise any of this: `GOOGLE_APPLICATION_CREDENTIALS` points
at an impersonated `firebase-adminsdk-fbsvc` credential that already holds these
permissions, so sign-in works on localhost while the deployment is broken.

### 3.2 Build and push the image

Build explicitly rather than with `gcloud run deploy --source .`. The `NEXT_PUBLIC_*`
values have to reach the build as Docker `--build-arg`s, and neither `--source .` nor
`gcloud builds submit --tag` gives you a dependable way to pass them (`--set-build-env-vars`
is a buildpacks feature). Building the image yourself keeps the build inputs unambiguous and
makes the manual path identical to what CI does.

```bash
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE}:$(git rev-parse --short HEAD)"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

docker build \
  --build-arg "NEXT_PUBLIC_SITE_URL=https://admin.bachmancc.org" \
  --build-arg "NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_PROD_FIREBASE_API_KEY" \
  --build-arg "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_PROD_FIREBASE_AUTH_DOMAIN" \
  --build-arg "NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_PROD_FIREBASE_PROJECT_ID" \
  --build-arg "NEXT_PUBLIC_FIREBASE_APP_ID=YOUR_PROD_FIREBASE_APP_ID" \
  --build-arg "FIREBASE_PROJECT_ID=YOUR_PROD_FIREBASE_PROJECT_ID" \
  -t "$IMAGE" .

docker push "$IMAGE"
```

*(No local Docker? Then add a `cloudbuild.yaml` that forwards substitutions to
`docker build --build-arg …` and run `gcloud builds submit --config cloudbuild.yaml
--substitutions …`. There is no such file in the repo today; CI builds with Docker on the
runner, so none is needed.)*

### 3.3 Prerequisite: make the service publicly invocable (human, one-time)

**Do this before the first deploy.** `--allow-unauthenticated` asks Cloud Run to add
`allUsers` → `roles/run.invoker`, and domain-restricted sharing rejects that member exactly
as it rejects the WIF binding in §5.2 — same constraint, same remedy, different resource:

```text
ERROR: (gcloud.run.services.add-iam-policy-binding) FAILED_PRECONDITION: One or more users
named in the policy do not belong to a permitted customer, perhaps due to an organization
policy.
```

`gcloud run deploy` does **not** fail on this. It prints `Setting IAM Policy….warning`, then
`Completed with warnings`, and exits `0`: the revision serves traffic, the IAM policy stays
empty (`{"etag": "ACAB"}`), and every request gets `403`. That is precisely what the first
production deploy did on 2026-11-10 —
[Issue #21](https://github.com/thedavidhanks/bcc-rentals-admin/issues/21). CI now asserts
reachability after deploying (P8.7), so the mistake fails the job instead of shipping green,
but CI cannot repair it: a human has to apply the exception below.

**Who can run it:** an identity with `roles/orgpolicy.policyAdmin` at the org (or the
`bcc-rentals` folder). **Not** the deploy service account — `github-deployer@…` has no
org-policy permission and must not be granted any. `roles/resourcemanager.organizationAdmin`
alone is also insufficient: it carries only `orgpolicy.policy.get` / `policies.list`.

```bash
# What is in force today?
gcloud org-policies describe iam.allowedPolicyMemberDomains \
  --project=bcc-admin-prod --effective

# The project-scoped exception — the same shape as §5.2's. If §5.2 was already applied to
# bcc-admin-prod this policy exists already; read the probe above before writing a second one.
cat > /tmp/drs-bcc-admin-prod.yaml <<'YAML'
name: projects/bcc-admin-prod/policies/iam.allowedPolicyMemberDomains
spec:
  inheritFromParent: false
  rules:
    - allowAll: true
YAML

gcloud org-policies set-policy /tmp/drs-bcc-admin-prod.yaml --project=bcc-admin-prod
```

`allUsers` and `allAuthenticatedUsers` are governed by this same constraint, so the
`allowAll: true` rule is what re-admits them. A rule listing only the `bachmancc.org` customer
id will **not** help — the public principals belong to no customer. **Verify before running**
if you want something tighter than `allowAll`: the constraint's `allowedValues` take customer
/ directory ids and have no documented way to name the public principals, so `allowAll`
scoped to this one project is the only form this runbook can vouch for.

Org-policy changes are **not instant**. Allow a few minutes and re-run the `describe` probe
before concluding the exception did not take.

Then create the binding and verify it actually landed:

```bash
gcloud run services add-iam-policy-binding bcc-rentals-admin \
  --project=bcc-admin-prod --region=us-east1 \
  --member=allUsers --role=roles/run.invoker

# Expect a bindings[] entry for allUsers / roles/run.invoker. A bare {"etag": "…"} with no
# bindings means the policy is still empty and the service is still unreachable.
gcloud run services get-iam-policy bcc-rentals-admin \
  --project=bcc-admin-prod --region=us-east1 --format=json

# Expect 200, or a 3xx redirect to /login — never 403. Scale-to-zero means the first
# request after a deploy can take many seconds; retry before believing a failure.
URL="$(gcloud run services describe bcc-rentals-admin \
  --project=bcc-admin-prod --region=us-east1 --format='value(status.url)')"
curl -s -o /dev/null -w '%{http_code}\n' "$URL"
```

Two notes before you do this:

- **It is a security decision, and it is the intended one.** The exception makes the Cloud
  Run *endpoint* publicly invocable; it does not make the *app* public. Authorization is
  unchanged — [`middleware.ts`](../middleware.ts) redirects any request without a session
  cookie to `/login`, and every server entry point re-checks the Firebase session cookie
  against `app_users` (see the box in §1). Cloud Run IAM was never the gate here. As in §5.2,
  leave a note in `docs/LOG.md` when you apply it.
- Unlike §5.2's one-time WIF binding, do **not** assume you can restore the restrictive
  policy afterwards. Any future deploy that has to re-assert the binding — a recreated
  service, a new environment — needs the exception in force again. **Verify before running**
  if you intend to revert: re-run the `get-iam-policy` and `curl` checks above afterwards.

### 3.4 Deploy the image

```bash
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --port 8080 \
  --min-instances 0 \
  --allow-unauthenticated \
  --service-account "$RUNTIME_SA" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest" \
  --set-env-vars "^;^NODE_ENV=production;\
NEXT_PUBLIC_SITE_URL=https://admin.bachmancc.org;\
NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_PROD_FIREBASE_API_KEY;\
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_PROD_FIREBASE_AUTH_DOMAIN;\
NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_PROD_FIREBASE_PROJECT_ID;\
NEXT_PUBLIC_FIREBASE_APP_ID=YOUR_PROD_FIREBASE_APP_ID;\
FIREBASE_PROJECT_ID=YOUR_PROD_FIREBASE_PROJECT_ID"
```

`^;^` is gcloud's custom-delimiter syntax: it splits the list on `;` instead of `,`, so a
value containing a comma cannot split one pair into two.

The first deploy prints the service URL (`https://bcc-rentals-admin-….a.run.app`). Smoke
test it before mapping the domain: hitting `/` unauthenticated must redirect to `/login`.

---

## 4 — Custom domain `admin.bachmancc.org` (P8.3)

```bash
# Lower the TTL on any existing GoDaddy record FIRST (e.g. 600s) and let it propagate.
gcloud beta run domain-mappings create \
  --service "$SERVICE" --region "$REGION" \
  --domain admin.bachmancc.org
```

The command prints the DNS record to create. Add the matching **CNAME** in GoDaddy
(`admin` → `ghs.googlehosted.com`, or whatever exact target it returned). Cloud Run
provisions the TLS certificate automatically once DNS resolves — minutes to hours.

Verify: `curl -sI https://admin.bachmancc.org/` → a redirect to `/login`.

### 4.1 Then: Firebase Authorized Domains (also P8.3)

Sign-in will fail on the new domain until it is allow-listed. Before the first real
sign-in against `admin.bachmancc.org`:

1. Firebase console → **Authentication → Settings → Authorized domains** → add
   `admin.bachmancc.org` (and the `*.run.app` service URL if you want to keep using it).
2. Add the same origin to each enabled provider's allowed redirect/callback list. Launch
   providers are **Google** and **Email/Password**; Email/Password needs no callback.
   GitHub / Facebook / Apple are deferred and have no OAuth apps yet.
3. Set `NEXT_PUBLIC_SITE_URL=https://admin.bachmancc.org` (already the value above) and
   redeploy if it was previously the `.run.app` URL — it is baked into the browser bundle.

Spec [§10](./ADMIN_APP_SPEC.md) is the authority for this step.

---

## 5 — Automated deploys: GitHub Actions (P8.6)

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) holds both jobs:

- **`test`** — runs on every `pull_request` targeting `master` and every push to `master`:
  `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, then a `npm run build` with
  obvious placeholder env (the suite needs no DB, secrets, or network; the build needs env
  only to satisfy Zod boot validation).
- **`deploy (bcc-admin-prod)`** — `needs: test`, and additionally guarded by
  `if: github.event_name == 'push' && github.ref == 'refs/heads/master'`. It can never run
  from a pull request or a topic branch. It is serialised by a
  `concurrency: deploy-bcc-admin-prod` group with `cancel-in-progress: false`, so two
  merges in quick succession queue instead of racing. It is bound to the GitHub
  **Environment `production`**, which is where its variables live and where an optional
  manual-approval gate can be switched on.

All third-party actions are pinned to a commit SHA with the version in a trailing comment.
Nothing in the job echoes a credential: no `set -x`, no `--verbosity=debug`, and every
`vars.*` value is bound through `env:` rather than interpolated into a shell string.

### 5.1 One-time GCP setup for Workload Identity Federation (keyless)

Run these once, as an `@bachmancc.org` identity with project IAM admin on
`bcc-admin-prod`. They create the **deployer** service account and let *only* this repo's
`master` branch impersonate it, with no long-lived key anywhere.

```bash
PROJECT_ID=bcc-admin-prod
PROJECT_NUMBER=305395393303
REGION=us-east1
REPO=thedavidhanks/bcc-rentals-admin
POOL=github
PROVIDER=github-oidc
DEPLOYER="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="run-runtime@${PROJECT_ID}.iam.gserviceaccount.com"

# 1. The deploy identity (separate from the runtime identity).
gcloud iam service-accounts create github-deployer \
  --project="$PROJECT_ID" \
  --display-name="GitHub Actions deployer (bcc-rentals-admin)"

# 2. Deploy permissions — on the PROJECT, not on run-runtime.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER}" --role="roles/run.admin"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER}" --role="roles/artifactregistry.writer"

# 3. Let the deployer assign run-runtime as the service's identity.
#    Scoped to that one SA — this is NOT a project-wide serviceAccountUser grant.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER}" --role="roles/iam.serviceAccountUser"

# 4. Workload Identity pool + GitHub OIDC provider.
gcloud iam workload-identity-pools create "$POOL" \
  --project="$PROJECT_ID" --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
  --project="$PROJECT_ID" --location=global --workload-identity-pool="$POOL" \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='${REPO}' && assertion.ref=='refs/heads/master'"

# 5. The binding that domain-restricted sharing may reject — see 5.2.
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}"

# 6. Also create the Artifact Registry repo if §3.1 has not been run.
gcloud artifacts repositories create bcc-admin \
  --project="$PROJECT_ID" --repository-format=docker --location="$REGION" \
  || echo "already exists"
```

The attribute condition pins the credential to this repository **and** to `refs/heads/master`.
If a future workflow ever needs to authenticate from another branch (e.g. a staging
deploy), widen the condition deliberately — do not drop it.

The value for the `GCP_WORKLOAD_IDENTITY_PROVIDER` variable (§5.3) is then:

```
projects/305395393303/locations/global/workloadIdentityPools/github/providers/github-oidc
```

### 5.2 If the org policy rejects the WIF binding

The org enforces `constraints/iam.allowedPolicyMemberDomains` (domain-restricted sharing),
which requires every IAM member to belong to the `bachmancc.org` Cloud Identity customer.
A `principalSet://iam.googleapis.com/…` member is not such an identity, so step 5 above may
fail with a policy-violation error.

**The documented fallback is a project-scoped org-policy exception** — not a service
account key. Apply the override at `bcc-admin-prod` only, so the rest of the org keeps the
restriction. You need `roles/orgpolicy.policyAdmin` at the org (or folder) level.

```bash
# What is in force today?
gcloud org-policies describe iam.allowedPolicyMemberDomains \
  --organization=513346324292 --effective

cat > /tmp/drs-bcc-admin-prod.yaml <<'YAML'
name: projects/bcc-admin-prod/policies/iam.allowedPolicyMemberDomains
spec:
  inheritFromParent: false
  rules:
    - allowAll: true
YAML

gcloud org-policies set-policy /tmp/drs-bcc-admin-prod.yaml --project=bcc-admin-prod

# Now re-run step 5 of §5.1, then confirm the binding landed:
gcloud iam service-accounts get-iam-policy \
  "github-deployer@bcc-admin-prod.iam.gserviceaccount.com" --project=bcc-admin-prod
```

Two things worth knowing before you do this:

- The override widens *who may be added to IAM in `bcc-admin-prod`*. It is one project, and
  that project contains only this app — but it is a real loosening, so leave a note in
  `docs/LOG.md` when you apply it.
- Domain-restricted sharing is evaluated **when a binding is created**, not continuously.
  That means you can restore the restrictive policy after the one-time binding exists;
  re-run the `get-iam-policy` check afterwards to confirm the binding survived before
  relying on it.

A service-account JSON key in a GitHub Actions secret would also work and is **explicitly
rejected**: it is a long-lived deploy credential sitting in a public repository's settings,
with no expiry and no per-branch scoping. Do not use it.

### 5.3 GitHub configuration the human must create

**Repository variables** (Settings → Secrets and variables → Actions → *Variables*):

| Name | Value |
| --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/305395393303/locations/global/workloadIdentityPools/github/providers/github-oidc` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `github-deployer@bcc-admin-prod.iam.gserviceaccount.com` |

**Environment `production`** (Settings → Environments → *New environment* → `production`;
optionally add yourself as a required reviewer to gate every deploy). Its *variables*:

| Name | Value |
| --- | --- |
| `PROD_NEXT_PUBLIC_SITE_URL` | `https://admin.bachmancc.org` |
| `PROD_NEXT_PUBLIC_FIREBASE_API_KEY` | the **prod** Firebase web app's API key |
| `PROD_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | the **prod** Firebase auth domain |
| `PROD_NEXT_PUBLIC_FIREBASE_PROJECT_ID` | the **prod** Firebase project id |
| `PROD_NEXT_PUBLIC_FIREBASE_APP_ID` | the **prod** Firebase web app id |
| `PROD_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | optional — **leave unset** rather than empty |
| `PROD_FIREBASE_PROJECT_ID` | Admin SDK project id (same Firebase project as above) |
| `PROD_ALLOWED_EMAIL_DOMAIN` | optional — `bachmancc.org` once every admin has a `@bachmancc.org` identity. **Setting this locks out any Gmail-identity admin immediately** |

**No Actions *secrets* are required.** `DATABASE_URL` never leaves Secret Manager; WIF
needs no stored credential. If an Actions secret ever appears in this repo, that is worth a
second look.

### 5.4 Staging vs production Firebase

The `NEXT_PUBLIC_FIREBASE_*` values in local `.env.local` are the **staging**
(`bcc-admin-staging`, `612782676839`) web app's. They are *not* what production should
use. A `bcc-admin-prod` (`305395393303`) Firebase Web App registration is being created
separately; its values are what go into the `PROD_*` variables above.

Nothing in the workflow hardcodes either environment, so adding staging later is additive:
a `staging` GitHub Environment with `STAGING_*` variables and a second job (or a
`environment:`-parameterised matrix) pointing at a `bcc-admin-staging` Cloud Run service.
Standing that service up is **out of scope** today — `bcc-admin-staging` has no Cloud Run
service and the Neon dev branch has zero `app_users` rows, so nobody could sign in to it.

### 5.5 Branch protection on `master` (human, one-time)

This is a repository **settings** change — no file in the repo can enable it, and it is
deliberately not applied by any agent. It requires the `repo` admin scope
(`gh auth refresh -s admin:repo_hook,repo` if `gh` complains).

First confirm the exact status-check name GitHub records for the CI job (it is the **job**
name, which may or may not be displayed with the workflow prefix):

```bash
gh api "repos/thedavidhanks/bcc-rentals-admin/commits/master/check-runs" \
  --jq '.check_runs[].name'
# expect: test
```

Then apply the protection, substituting that exact string into `contexts` if it differs:

```bash
gh api -X PUT repos/thedavidhanks/bcc-rentals-admin/branches/master/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["test"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON

# Verify — this currently returns {"message":"Branch not protected"}.
gh api repos/thedavidhanks/bcc-rentals-admin/branches/master/protection
```

What that policy means: no direct pushes to `master` by anyone including administrators
(`enforce_admins: true`); every change arrives through a pull request; the `test` check must
be green; and `strict: true` means the branch must be up to date with `master` before the
merge button unlocks. `required_approving_review_count` is `0` because the project has a
single maintainer who reads their own diffs — raise it to `1` the moment there is a second
person.

---

## 6 — Troubleshooting

| Symptom | Cause |
| --- | --- |
| Container fails to start, logs show `Invalid server environment … DATABASE_URL: Required` | `--set-secrets` missing, or the runtime SA lost `secretAccessor` |
| `Invalid public environment (NEXT_PUBLIC_*)` at boot | the `NEXT_PUBLIC_*` runtime copies were not set — build args alone are not enough |
| Browser console: Firebase `auth/invalid-api-key`, or sign-in silently fails | build args were missing/blank, so the bundle was compiled with no config; or the domain is not in Firebase Authorized Domains (§4.1) |
| `… is not a valid value for …` on an optional var | it was set to an empty string; unset it instead |
| `gcloud run deploy` prints `Completed with warnings` / `Setting IAM Policy….warning`, or the deployed URL returns `403` to everyone | the `allUsers` invoker binding was rejected by domain-restricted sharing — §3.3 was skipped |
| Sign-in fails with `Credential implementation provided to initializeApp() … has insufficient permission` | **not** a credential problem — `run-runtime` has no Identity Platform permissions; §3.1 was skipped |
| WIF step fails with a policy violation | §5.2 |
| `PERMISSION_DENIED … iam.serviceAccounts.actAs` during deploy | step 3 of §5.1 (`roles/iam.serviceAccountUser` on `run-runtime`) was skipped |
| Deploy succeeded but the site shows stale catalog data | the storefront caches ~30s per instance; unrelated to this app's deploy |
