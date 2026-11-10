#!/usr/bin/env bash
#
# assert-service-reachable.sh — fail loudly when a deployed Cloud Run service
# is not actually answering anonymous callers.
#
# WHY THIS EXISTS (plan P8.7, issue #21)
#   `gcloud run deploy --allow-unauthenticated` downgrades a failure to set the
#   service's IAM policy to a *warning* and still exits 0. On 2026-11-10 that
#   produced a green CI run for a production service that returned 403 to every
#   visitor: the revision was live and serving traffic, but the `allUsers` →
#   `roles/run.invoker` binding had been rejected by the bachmancc.org org's
#   `constraints/iam.allowedPolicyMemberDomains` (domain-restricted sharing).
#   Exit codes cannot be trusted here, so CI asserts the post-condition instead:
#   can an anonymous caller reach the URL at all?
#
# USAGE
#   scripts/ci/assert-service-reachable.sh <url>
#
#   ATTEMPTS=10       how many times to try before giving up (retryable statuses only)
#   SLEEP_SECONDS=6   delay between attempts  -> default budget is roughly 60s
#   MAX_TIME=20       per-request curl timeout, in seconds
#
# EXIT STATUS
#   0  the service answered with a 2xx or 3xx
#   1  the service is not reachable (see the message for which flavour)
#   2  bad usage
#
# NOTE: this script deliberately never prints the response body and never runs
# with `set -x`. The repo is public and CI logs are world-readable.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: assert-service-reachable.sh <url>

Asserts that <url> answers an anonymous HTTP request with a 2xx or 3xx status.

Environment:
  ATTEMPTS        number of attempts for retryable failures (default: 10)
  SLEEP_SECONDS   seconds to wait between attempts         (default: 6)
  MAX_TIME        per-request timeout in seconds           (default: 20)
EOF
}

URL="${1-}"
if [ -z "$URL" ]; then
  echo "error: missing required argument: the service URL to check." >&2
  usage
  exit 2
fi

ATTEMPTS="${ATTEMPTS:-10}"
SLEEP_SECONDS="${SLEEP_SECONDS:-6}"
MAX_TIME="${MAX_TIME:-20}"

# Printed by every failure path so whoever reads the log knows where to look.
RUNBOOK="See docs/DEPLOY_CLOUD_RUN.md."

# The human fix for the 403 case. Repeated verbatim in the workflow's IAM check
# so either failure tells the same story.
fix_403() {
  cat >&2 <<EOF

What a 403 here means
  Cloud Run's front end rejected the request before it ever reached the
  container: the service has no 'roles/run.invoker' binding for anonymous
  callers. The deploy itself may well have succeeded -- image built, revision
  created, traffic routed -- but nobody can load the page.

  This is NOT something CI can fix. 'gcloud run deploy --allow-unauthenticated'
  tries to add allUsers -> roles/run.invoker and that binding is rejected by the
  bachmancc.org organization policy 'constraints/iam.allowedPolicyMemberDomains'
  (domain-restricted sharing), which only permits members in permitted domains.

How a human fixes it
  1. Apply a PROJECT-SCOPED org-policy exception for
     constraints/iam.allowedPolicyMemberDomains on project bcc-admin-prod
     (requires an Organization Policy Administrator on bachmancc.org).
  2. Then add the binding:
       gcloud run services add-iam-policy-binding bcc-rentals-admin \\
         --project=bcc-admin-prod --region=us-east1 \\
         --member=allUsers --role=roles/run.invoker
  3. Re-run this check (or re-run the deploy workflow).

  $RUNBOOK
EOF
}

echo "Checking that the service answers an anonymous request: $URL"
echo "  (up to ${ATTEMPTS} attempt(s), ${SLEEP_SECONDS}s apart, ${MAX_TIME}s per request)"

status='000'
attempt=1
while [ "$attempt" -le "$ATTEMPTS" ]; do
  # No -L: a 3xx is the EXPECTED healthy answer. Unauthenticated callers are
  # redirected to /login by the app's middleware, so following the redirect
  # would only tell us about /login, not about the service's front door.
  # `|| true` keeps `set -e` from killing us on a connection failure; curl still
  # writes a status (000) to stdout in that case.
  status="$(curl --silent --show-error --output /dev/null \
    --write-out '%{http_code}' --max-time "$MAX_TIME" "$URL" 2>/dev/null || true)"
  [ -n "$status" ] || status='000'

  echo "  attempt ${attempt}/${ATTEMPTS}: HTTP ${status}"

  case "$status" in
    2??|3??)
      # 3xx included on purpose: 302/303/307 to /login is a healthy admin app.
      echo "PASS: service is reachable (HTTP ${status})."
      exit 0
      ;;
    403)
      # Fail FAST, without retrying. A 403 from Cloud Run's front end is a
      # stable IAM state, not a transient condition -- it will still be 403 in
      # sixty seconds, so retrying only burns the budget and buries the cause.
      echo "FAIL: ${URL} returned HTTP 403 -- the service is deployed but unreachable." >&2
      fix_403
      exit 1
      ;;
    401)
      # Ambiguous, so also fail fast: Cloud Run returns 401 when a request
      # carries an Authorization header it cannot accept, and this script sends
      # none. Far more likely the app itself answered 401 instead of redirecting
      # to /login -- either way it is a real, non-transient defect worth a red
      # job rather than a silent pass.
      echo "FAIL: ${URL} returned HTTP 401." >&2
      echo "  An anonymous caller should be redirected to /login (3xx), not challenged." >&2
      echo "  Check the app's middleware, or whether Cloud Run is requiring IAM auth. ${RUNBOOK}" >&2
      exit 1
      ;;
    5??|000)
      # Retryable: a scale-to-zero cold start, a revision still rolling out, or
      # DNS/TLS not yet settled all look like this moments after a deploy.
      if [ "$attempt" -eq "$ATTEMPTS" ]; then
        if [ "$status" = '000' ]; then
          echo "FAIL: no HTTP response from ${URL} after ${ATTEMPTS} attempt(s)." >&2
          echo "  curl could not complete a request (DNS, TLS, timeout or connection refused)." >&2
        else
          echo "FAIL: ${URL} still returning HTTP ${status} after ${ATTEMPTS} attempt(s)." >&2
          echo "  The service is routable but erroring -- check the Cloud Run revision logs." >&2
        fi
        echo "  ${RUNBOOK}" >&2
        exit 1
      fi
      ;;
    *)
      # Any other 4xx (404, 429, ...) or a nonsense status: not transient, and
      # not something a retry improves. Name the status so the log is actionable.
      echo "FAIL: ${URL} returned an unexpected HTTP ${status}." >&2
      echo "  Expected 2xx or 3xx (an unauthenticated caller is redirected to /login)." >&2
      echo "  ${RUNBOOK}" >&2
      exit 1
      ;;
  esac

  sleep "$SLEEP_SECONDS"
  attempt=$((attempt + 1))
done

# Unreachable: the 5xx/000 branch exits on the final attempt. Kept as a guard so
# a future edit to the loop cannot turn an exhausted budget into a silent pass.
echo "FAIL: exhausted ${ATTEMPTS} attempt(s) against ${URL}; last status HTTP ${status}. ${RUNBOOK}" >&2
exit 1
