#!/usr/bin/env bash
#
# Shared helpers for the framework-compatibility test harness. The harness runs
# the action's REAL scripts (scripts/*.sh) against each fixture in the same order
# action.yml runs them, skipping only the network deploy. This keeps the tests
# honest: they exercise the exact detect/plan/install/inject/build/prerender/
# package logic that paying users depend on.

# ACTION_PATH mirrors ${{ github.action_path }} — the action repo root, which
# every script resolves scripts/ and node tooling against. tests/ lives directly
# under that root, so the root is this file's parent's parent.
TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION_PATH="$(cd "$TESTS_DIR/.." && pwd)"
export ACTION_PATH

# ANSI helpers (no-ops when stdout is not a TTY).
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_BOLD=""; C_RESET=""
fi

# Reads the last value written for a given key in $GITHUB_OUTPUT. Returns empty
# (status 0) when the key was never written, so optional outputs like ssr-entry
# never abort the harness under `set -e`.
get_output() {
  local key="$1" line
  line=$(grep "^${key}=" "$GITHUB_OUTPUT" 2>/dev/null | tail -n1 || true)
  printf '%s' "${line#*=}"
}

# Runs one action script (e.g. detect.sh) exactly as action.yml would: a fresh
# bash process with ACTION_PATH exported and the caller's step env in scope.
run_step() {
  local script="$1"
  echo "${C_BOLD}--- ${script} ---${C_RESET}"
  bash "$ACTION_PATH/scripts/${script}"
}

# --- assertions -------------------------------------------------------------

fail() {
  echo "${C_RED}ASSERT FAILED:${C_RESET} $*" >&2
  exit 1
}

assert_eq() {
  local actual="$1" expected="$2" label="${3:-value}"
  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
  echo "  ok: $label = $expected"
}

assert_file() {
  local path="$1"
  [ -f "$path" ] || fail "expected file to exist: $path"
  echo "  ok: file exists: $path"
}

assert_grep() {
  local path="$1" pattern="$2"
  [ -f "$path" ] || fail "expected file to exist for grep: $path"
  grep -qE "$pattern" "$path" || fail "expected '$path' to match /$pattern/"
  echo "  ok: '$path' matches /$pattern/"
}

# Functional render check: serves the packaged OUTPUT_DIR and loads <path> in
# headless Chromium, failing on runtime/hydration errors, asset 4xx, an empty
# body, or any missing required marker text. This is the "does it actually work"
# assertion, distinct from the file/grep checks above. Requires OUTPUT_DIR in
# scope (run.sh exports it).
assert_renders() {
  local path="$1"; shift
  [ -n "${OUTPUT_DIR:-}" ] || fail "assert_renders: OUTPUT_DIR is not set"
  echo "  smoke: rendering '$path' from $OUTPUT_DIR ..."
  SMOKE_OUTPUT_DIR="$OUTPUT_DIR" node "$TESTS_DIR/smoke.mjs" "$path" "$@" \
    || fail "'$path' did not render cleanly"
  if [ "$#" -gt 0 ]; then
    echo "  ok: '$path' renders and shows: $*"
  else
    echo "  ok: '$path' renders cleanly (no errors, no 4xx, non-blank)"
  fi
}

# Fails if the pattern IS present — used to prove the crawl did NOT run on
# already-prerendered output (the hydration bootstrap must survive verbatim).
assert_not_grep() {
  local path="$1" pattern="$2"
  [ -f "$path" ] || fail "expected file to exist for negative grep: $path"
  if grep -qE "$pattern" "$path"; then
    fail "expected '$path' to NOT match /$pattern/"
  fi
  echo "  ok: '$path' does not match /$pattern/"
}
