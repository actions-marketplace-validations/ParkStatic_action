#!/usr/bin/env bash
#
# Runs the action's real pipeline against a single fixture and asserts the
# result. Mirrors action.yml step-for-step, wiring each script's outputs into
# the next step's env, and swaps the two network touchpoints for their offline
# equivalents:
#
#   - plan:   PLAN_FILE=<fixture>/plan.json  -> plan.mjs reads it, no server call
#   - deploy: SKIP_DEPLOY=true               -> deploy.sh verifies dist.zip only
#
# Usage: tests/run.sh <path-to-fixture-dir>

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <fixture-dir>" >&2
  exit 2
fi

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FIXTURE_DIR="$(cd "$1" && pwd)"
FIXTURE_NAME="$(basename "$FIXTURE_DIR")"

echo "${C_BOLD}==================================================${C_RESET}"
echo "${C_BOLD}Fixture: ${FIXTURE_NAME}${C_RESET}"
echo "${C_BOLD}==================================================${C_RESET}"

cd "$FIXTURE_DIR"

# Start from a clean slate so a re-run never asserts against stale output.
rm -rf dist build .output .nitro .svelte-kit out dist.zip .npmrc

GITHUB_OUTPUT="$(mktemp)"
export GITHUB_OUTPUT
export DEBUG="${DEBUG:-false}"
trap 'rm -f "$GITHUB_OUTPUT"' EXIT

# 1. Detect project (package manager + vite sanity check).
run_step detect.sh
PACKAGE_MANAGER="$(get_output manager)"
LOCKFILE="$(get_output lockfile)"
export PACKAGE_MANAGER LOCKFILE

# 2. Resolve build plan from the fixture's plan.json (no server call).
export PLAN_URL=""
export PARKSTATIC_SECRET=""
export PRERENDER_INPUT="true"
if [ -f plan.json ]; then
  export PLAN_FILE="$FIXTURE_DIR/plan.json"
else
  export PLAN_FILE=""
fi
run_step plan.sh
BUILT_DEPS="$(get_output built-deps)"
INJECT_DEPS="$(get_output inject-deps)"
BUILD_KIND="$(get_output build-kind)"
BUILD_SCRIPT="$(get_output build-script)"
PLAN_OUTPUT_DIR="$(get_output plan-output-dir)"
PRERENDER_ENABLED="$(get_output prerender-enabled)"
export BUILT_DEPS INJECT_DEPS BUILD_KIND BUILD_SCRIPT PLAN_OUTPUT_DIR PRERENDER_ENABLED

# 3. Install project dependencies (+ the action's prerender tooling).
run_step install.sh

# 4. Inject build-only dependencies the plan asked for.
run_step inject.sh

# 5. Build (emits mode + output-dir, and ssr-* for SSR builds).
export BUILD_COMMAND=""
export OUTPUT_DIR_OVERRIDE=""
run_step build.sh
MODE="$(get_output mode)"
OUTPUT_DIR="$(get_output output-dir)"
SSR_ENTRY="$(get_output ssr-entry)"
SSR_RUNTIME="$(get_output ssr-runtime)"
export OUTPUT_DIR BUILD_MODE="$MODE" SSR_ENTRY SSR_RUNTIME

# 6. Prerender (crawl static, boot+crawl SSR, or skip already-prerendered).
export PRERENDER_ROUTES=""
export PRERENDER_EXCLUDE=""
export PRERENDER_MAX_PAGES="500"
export PRERENDER_CONCURRENCY="4"
export DISABLE_HYDRATION=""
run_step prerender.sh

# 7. Package the output directory into dist.zip.
run_step package.sh

# 8. Deploy in skip mode: verify dist.zip, no network, no secret.
export SKIP_DEPLOY="true"
export DEPLOY_URL=""
export GH_SHA="test-sha"
export GH_REF="refs/heads/test"
export GH_REPO="ParkStatic/action-tests"
run_step deploy.sh

# 9. Assertions. A fixture may ship assert.sh with vars in scope (MODE,
#    OUTPUT_DIR, SSR_RUNTIME, ...). Otherwise fall back to the universal checks.
echo "${C_BOLD}--- assertions ---${C_RESET}"
export MODE OUTPUT_DIR SSR_RUNTIME FIXTURE_DIR FIXTURE_NAME
if [ -f assert.sh ]; then
  # shellcheck source=/dev/null
  source assert.sh
else
  assert_file dist.zip
  assert_file "$OUTPUT_DIR/index.html"
fi

echo "${C_GREEN}${C_BOLD}PASS: ${FIXTURE_NAME}${C_RESET}"
