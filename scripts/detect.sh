#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Detect project"

if [ ! -f package.json ]; then
  action_error "package.json not found."
  exit 1
fi

# Detect the package manager. We honor an explicit "packageManager" field when
# a matching lockfile is present, then fall back to lockfile-based detection,
# then to pnpm (Lovable's default for new projects).
PM_FIELD=""
if grep -q '"packageManager"' package.json; then
  PM_FIELD=$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"\([^@"]*\).*/\1/p' package.json | head -1)
fi

MANAGER=""
LOCKFILE="false"
CACHE=""

if [ -n "$PM_FIELD" ] && { [ -f pnpm-lock.yaml ] || [ -f package-lock.json ] || [ -f yarn.lock ]; }; then
  MANAGER="$PM_FIELD"
  LOCKFILE="true"
  CACHE="$MANAGER"
elif [ -f pnpm-lock.yaml ]; then
  MANAGER="pnpm"
  LOCKFILE="true"
  CACHE="pnpm"
elif [ -f yarn.lock ]; then
  MANAGER="yarn"
  LOCKFILE="true"
  CACHE="yarn"
elif [ -f package-lock.json ]; then
  MANAGER="pnpm"
  action_notice "Ignoring stale package-lock.json; using pnpm (Lovable default)."
else
  MANAGER="pnpm"
  action_notice "No lockfile found; using pnpm without a frozen lockfile."
fi

# Sanity-check the project shape. We deliberately do NOT classify frameworks
# here — that is the plan step's job (the edge function holds the proprietary
# build recipes). This guard only rejects repos that clearly aren't a buildable
# frontend: no "build" script AND no recognized frontend tool. Anything with a
# build script is trusted to build itself; anything with a known framework dep
# is trusted even without one. Parsed with Node so the dep keys are matched as
# real object keys rather than as substrings of some unrelated string.
if ! node -e '
  const fs = require("node:fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const has = (k) => Object.prototype.hasOwnProperty.call(deps, k);
  const frameworks = [
    "vite", "next", "astro", "nuxt",
    "@sveltejs/kit", "@remix-run/dev", "@react-router/dev", "@solidjs/start",
  ];
  const knownFramework = frameworks.some(has) ||
    Object.keys(deps).some((d) => d.startsWith("@lovable.dev/"));
  const hasBuild = !!(pkg.scripts && typeof pkg.scripts === "object" && "build" in pkg.scripts);
  process.exit(knownFramework || hasBuild ? 0 : 1);
' 2>/dev/null; then
  action_error "Unsupported project: expected a build script or a recognized frontend framework (vite, next, astro, nuxt, @sveltejs/kit, @remix-run/dev, @react-router/dev, @solidjs/start) in package.json."
  exit 1
fi

write_output "manager" "$MANAGER"
write_output "lockfile" "$LOCKFILE"
write_output "cache" "$CACHE"

echo "Package manager: $MANAGER (lockfile=$LOCKFILE)"
action_endgroup
