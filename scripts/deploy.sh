#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Deploy to Parkstatic"

# Dry-run escape hatch. When skip-deploy is set, the whole build/prerender/
# package pipeline has already run for real; we just verify there is an
# artifact to upload and stop short of any network call or secret. This is what
# the framework-compatibility test suite (and offline dry runs) use to exercise
# every framework without a paid license or a live deploy endpoint.
if [ "${SKIP_DEPLOY:-}" = "true" ]; then
  if [ ! -f dist.zip ]; then
    action_error "skip-deploy is set but dist.zip not found. The Package step must run before Deploy."
    exit 1
  fi
  echo "skip-deploy is set: dist.zip is present; skipping upload to Parkstatic."
  write_output "deployed" "false"
  action_endgroup
  exit 0
fi

if [ -z "${PARKSTATIC_SECRET:-}" ]; then
  action_error "parkstatic-secret is empty. Add PARKSTATIC_SECRET to your repository secrets and pass it to the action."
  exit 1
fi

if [ -z "${DEPLOY_URL:-}" ]; then
  action_error "deploy-url is empty."
  exit 1
fi

if [ ! -f dist.zip ]; then
  action_error "dist.zip not found at the workspace root. The Package step must run before Deploy."
  exit 1
fi

ZIP_BYTES=$(wc -c < dist.zip | tr -d ' ')
echo "Uploading dist.zip ($ZIP_BYTES bytes) to Parkstatic."
echo "DEPLOY_URL: $DEPLOY_URL"

# The deploy function does the work in two phases:
#
#   1. Foreground (what we wait for): authenticate, upload to private
#      storage, sign a 3-day download URL.
#   2. Background (what we DO NOT wait for): call the WordPress receiver
#      with the signed URL, clean up the artifact on success.
#
# A 2xx here means phase 1 succeeded — the artifact is in storage and WP
# will pull it within seconds. Non-2xx means phase 1 failed (auth, storage,
# config). Phase 2 failures show up on the user's WordPress site, not here.
#
# GitHub already masks registered secrets in logs, but `set -x` (debug mode)
# would otherwise echo the expanded Authorization header. Suspend xtrace for
# just this call and restore it afterwards so the token never reaches stdout.
parkstatic_xtrace=0
case $- in *x*) parkstatic_xtrace=1 ;; esac
set +x
http_post "$DEPLOY_URL" \
  -H "Authorization: Bearer $PARKSTATIC_SECRET" \
  -H "Content-Type: application/zip" \
  -H "X-Parkstatic-Sha: ${GH_SHA}" \
  -H "X-Parkstatic-Ref: ${GH_REF}" \
  -H "X-Parkstatic-Repository: ${GH_REPO}" \
  --data-binary "@dist.zip"
[ "$parkstatic_xtrace" -eq 1 ] && set -x

# Treat any 2xx as success — the function returns 202 Accepted to signal
# the async hand-off.
if [ "$HTTP_STATUS" -lt 200 ] || [ "$HTTP_STATUS" -ge 300 ]; then
  action_error "Deploy failed (HTTP $HTTP_STATUS): $HTTP_BODY"

  if [ "$HTTP_STATUS" = "401" ]; then
    action_error "parkstatic-secret did not match any registered Parkstatic instance. Copy the deploy secret from WordPress admin (Parkstatic → General → Deploy secret) and update the PARKSTATIC_SECRET repo secret. If you moved your license to this site, the secret changed."
  elif [ "$HTTP_STATUS" = "404" ]; then
    action_error "No Parkstatic instance is registered for this secret. Open Parkstatic in your WordPress admin and complete setup first."
  elif [ "$HTTP_STATUS" = "403" ]; then
    action_error "This Parkstatic site does not have an active paid license. Activate or renew your license in WordPress admin (Parkstatic → Account) and try again."
  elif [ "$HTTP_STATUS" = "400" ]; then
    action_error "Parkstatic rejected the upload as malformed. This usually means the action was modified or hit a Supabase outage. Re-run the workflow; if it persists, open an issue with the response body above."
  elif [ "$HTTP_STATUS" -ge 500 ]; then
    action_error "Parkstatic's storage or signing layer returned an error. This is almost always transient — re-run the workflow."
  fi

  exit 1
fi

# Pull deploy_id out of the JSON body if jq is available; falls back to a
# best-effort sed so we still surface something useful on minimal runners.
DEPLOY_ID=$(echo "$HTTP_BODY" | jq -r '.deploy_id // empty' 2>/dev/null \
  || echo "$HTTP_BODY" | sed -n 's/.*"deploy_id":"\([^"]*\)".*/\1/p')

echo "Artifact uploaded to Parkstatic."
if [ -n "$DEPLOY_ID" ]; then
  echo "Deploy ID: $DEPLOY_ID"
fi
echo "Your WordPress site is downloading and installing the new build in the background."
echo "Check the site or its Parkstatic admin page within a minute to confirm."

write_output "deployed" "true"
if [ -n "$DEPLOY_ID" ]; then
  write_output "deploy-id" "$DEPLOY_ID"
fi

action_endgroup
