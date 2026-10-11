#!/usr/bin/env bash
#
# refresh-admin-adc.sh — re-mint the local Firebase Admin credential
# (~/.config/gcloud/bcc-admin-adc.json) without disturbing the default ADC.
#
# Why this exists
# ---------------
# Two ADC files live side by side in ~/.config/gcloud:
#
#   application_default_credentials.json  → dh55@rice.edu (GCP agents)   ← must survive
#   bcc-admin-adc.json                    → gcp-admin@bachmancc.org,     ← this script
#                                           impersonating the Firebase
#                                           Admin SA for this project
#
# `gcloud auth application-default login` always writes the *default* path, so
# refreshing the second one by hand means a backup/restore dance around it.
# This script sidesteps that entirely: the login runs inside a throwaway
# CLOUDSDK_CONFIG directory, so the real default ADC is never written at all.
# A checksum guard still verifies that (and restores from backup if gcloud ever
# changes its mind about where it writes).
#
# The credential must be an IMPERSONATED service account, not a plain user
# login: lib/auth/session.ts calls createSessionCookie(), which needs an
# identity that can SIGN. A bare `authorized_user` ADC cannot sign and will
# fail at runtime. That is why --impersonate-service-account is the default
# here. See the credential-resolution comment in lib/auth/session.ts.
#
# Usage:  scripts/gcp/refresh-admin-adc.sh [options]
#         npm run gcp:adc
#
set -euo pipefail

SA_DEFAULT="firebase-adminsdk-fbsvc@bcc-admin-staging.iam.gserviceaccount.com"
LOGIN_ACCOUNT_HINT="gcp-admin@bachmancc.org"

GCLOUD_DIR="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud}"
DEFAULT_ADC="$GCLOUD_DIR/application_default_credentials.json"

SA="$SA_DEFAULT"
OUT="$GCLOUD_DIR/bcc-admin-adc.json"
IMPERSONATE=1
LAUNCH_BROWSER="auto"

usage() {
  cat <<EOF
Refresh the gcp-admin ADC credential, leaving the default ADC untouched.

Usage: $(basename "$0") [options]

Options:
  --impersonate-service-account EMAIL   SA to impersonate
                                        (default: $SA_DEFAULT)
  --no-impersonate                      Plain user ADC. NOT usable for Firebase
                                        session cookies — it cannot sign.
  --output PATH                         Where to write the credential
                                        (default: $OUT)
  --no-launch-browser                   Print a URL to paste instead of opening
                                        a browser. Use if the devcontainer's
                                        localhost callback does not come back.
  --launch-browser                      Force the browser flow.
  -h, --help                            This help.

Sign in as $LOGIN_ACCOUNT_HINT — it is the account allowed to impersonate the
service account. Pick the wrong one and the impersonation check fails, leaving
the existing credential untouched.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --impersonate-service-account) SA="${2:?--impersonate-service-account needs a value}"; shift 2 ;;
    --impersonate-service-account=*) SA="${1#*=}"; shift ;;
    --no-impersonate) IMPERSONATE=0; shift ;;
    --output) OUT="${2:?--output needs a value}"; shift 2 ;;
    --output=*) OUT="${1#*=}"; shift ;;
    --no-launch-browser) LAUNCH_BROWSER="no"; shift ;;
    --launch-browser) LAUNCH_BROWSER="yes"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown option '$1'" >&2; echo >&2; usage >&2; exit 2 ;;
  esac
done

command -v gcloud >/dev/null 2>&1 || { echo "error: gcloud not found on PATH" >&2; exit 1; }

hash_of() {
  if [ -f "$1" ]; then sha256sum "$1" | cut -d' ' -f1; else echo "absent"; fi
}

json_field() {
  # json_field <file> <key> — prints the top-level string value, or empty.
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2],""))' "$1" "$2" 2>/dev/null || true
}

# --- Guard the default ADC -------------------------------------------------
# The isolated CLOUDSDK_CONFIG below should mean gcloud never touches this
# file. Back it up and checksum it anyway, so a surprise is recoverable.
DEFAULT_ADC_HASH_BEFORE="$(hash_of "$DEFAULT_ADC")"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/bcc-adc.XXXXXXXX")"
chmod 700 "$WORKDIR"
DEFAULT_ADC_BACKUP="$WORKDIR/default-adc.backup.json"
if [ -f "$DEFAULT_ADC" ]; then
  cp -p "$DEFAULT_ADC" "$DEFAULT_ADC_BACKUP"
  echo "• Default ADC present; guarded (sha256 ${DEFAULT_ADC_HASH_BEFORE:0:12}…)"
else
  echo "• No default ADC present; nothing to guard"
fi

restore_default_adc_if_clobbered() {
  local now; now="$(hash_of "$DEFAULT_ADC")"
  [ "$now" = "$DEFAULT_ADC_HASH_BEFORE" ] && return 0
  echo "! Default ADC changed unexpectedly — restoring" >&2
  if [ -f "$DEFAULT_ADC_BACKUP" ]; then
    cp -p "$DEFAULT_ADC_BACKUP" "$DEFAULT_ADC"
    echo "  restored $DEFAULT_ADC" >&2
  else
    rm -f "$DEFAULT_ADC"
    echo "  removed $DEFAULT_ADC (there was none before)" >&2
  fi
}

cleanup() {
  local rc=$?
  restore_default_adc_if_clobbered || true
  rm -rf "$WORKDIR"
  return $rc
}
trap cleanup EXIT

# --- Log in inside a throwaway gcloud config -------------------------------
ISOLATED_CONFIG="$WORKDIR/gcloud"
mkdir -p "$ISOLATED_CONFIG"
NEW_ADC="$ISOLATED_CONFIG/application_default_credentials.json"

login_args=(auth application-default login)
if [ "$IMPERSONATE" -eq 1 ]; then
  login_args+=("--impersonate-service-account=$SA")
fi
case "$LAUNCH_BROWSER" in
  no)  login_args+=(--no-launch-browser) ;;
  yes) login_args+=(--launch-browser) ;;
esac

echo
echo "• Signing in. Choose $LOGIN_ACCOUNT_HINT in the browser."
if [ "$IMPERSONATE" -eq 1 ]; then
  echo "  Impersonating: $SA"
else
  echo "  !! --no-impersonate: the result CANNOT sign session cookies."
fi
echo

CLOUDSDK_CONFIG="$ISOLATED_CONFIG" gcloud "${login_args[@]}"

[ -f "$NEW_ADC" ] || { echo "error: gcloud reported success but wrote no credential" >&2; exit 1; }

# --- Validate shape --------------------------------------------------------
got_type="$(json_field "$NEW_ADC" type)"
want_type=$([ "$IMPERSONATE" -eq 1 ] && echo "impersonated_service_account" || echo "authorized_user")
if [ "$got_type" != "$want_type" ]; then
  echo "error: expected credential type '$want_type', got '${got_type:-<unparseable>}'" >&2
  exit 1
fi
echo "• Credential type: $got_type"

# --- Prove it works --------------------------------------------------------
# For the impersonated case this is also the identity check: only an account
# with tokenCreator on the SA can mint this token, so success means the right
# human signed in.
if [ "$IMPERSONATE" -eq 1 ]; then
  echo "• Verifying impersonation (generateAccessToken)…"
  if CLOUDSDK_CONFIG="$ISOLATED_CONFIG" gcloud auth application-default print-access-token >/dev/null; then
    echo "  ok — token minted for $SA"
  else
    echo "error: could not mint a token for $SA." >&2
    echo "       Wrong account signed in, or missing roles/iam.serviceAccountTokenCreator." >&2
    echo "       Nothing was installed; $OUT is unchanged." >&2
    exit 1
  fi
fi

# --- Install ---------------------------------------------------------------
mkdir -p "$(dirname "$OUT")"
if [ -f "$OUT" ]; then
  cp -p "$OUT" "$OUT.bak"          # single rolling backup, deliberately not .bak2/.bak3/…
  echo "• Previous credential saved to $OUT.bak"
fi
staged="$OUT.staged.$$"
cp "$NEW_ADC" "$staged"
chmod 600 "$staged"
mv -f "$staged" "$OUT"
echo "• Wrote $OUT"

# cleanup() re-checks the default ADC on exit.
echo
echo "Done. Point local dev at it with:"
echo "  GOOGLE_APPLICATION_CREDENTIALS=$OUT"
echo "(.env.local is not modified by this script.)"
