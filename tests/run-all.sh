#!/usr/bin/env bash
#
# Runs every fixture through tests/run.sh and reports a summary. Exits non-zero
# if any fixture fails, so it can gate CI and local pre-push checks alike.
#
# Usage: tests/run-all.sh [fixture-name ...]
#   With no args, runs all fixtures under tests/fixtures/.

set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES_DIR="$TESTS_DIR/fixtures"

if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_BOLD=""; C_RESET=""
fi

if [ $# -gt 0 ]; then
  FIXTURES=("$@")
else
  FIXTURES=()
  for dir in "$FIXTURES_DIR"/*/; do
    [ -d "$dir" ] || continue
    FIXTURES+=("$(basename "$dir")")
  done
fi

declare -a PASSED=() FAILED=()

for name in "${FIXTURES[@]}"; do
  if bash "$TESTS_DIR/run.sh" "$FIXTURES_DIR/$name"; then
    PASSED+=("$name")
  else
    FAILED+=("$name")
  fi
  echo
done

echo "${C_BOLD}==================================================${C_RESET}"
echo "${C_BOLD}Summary${C_RESET}"
echo "${C_BOLD}==================================================${C_RESET}"
# Guard empty-array expansion for bash 3.2 (macOS default) under `set -u`.
for name in ${PASSED[@]+"${PASSED[@]}"}; do echo "${C_GREEN}PASS${C_RESET} $name"; done
for name in ${FAILED[@]+"${FAILED[@]}"}; do echo "${C_RED}FAIL${C_RESET} $name"; done

echo
echo "${#PASSED[@]} passed, ${#FAILED[@]} failed."
[ "${#FAILED[@]}" -eq 0 ]
