#!/usr/bin/env bash

set -euo pipefail

if [ "${DEBUG:-false}" = "true" ]; then
  set -x
fi

action_notice() { echo "::notice::$*"; }
action_error()  { echo "::error::$*"; }

action_group() { echo "::group::$*"; }
action_endgroup() { echo "::endgroup::"; }

write_output() {
  echo "$1=$2" >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is not set}"
}

run_pm() {
  case "${PACKAGE_MANAGER:?PACKAGE_MANAGER is not set}" in
    pnpm) pnpm "$@" ;;
    npm)  npm "$@" ;;
    yarn) yarn "$@" ;;
    *)
      action_error "Unsupported package manager: $PACKAGE_MANAGER"
      exit 1
      ;;
  esac
}

install_deps() {
  local manager="$1"
  local lockfile="$2"

  case "$manager" in
    pnpm)
      if [ "$lockfile" = "true" ]; then
        pnpm install --frozen-lockfile || {
          action_notice "pnpm lockfile out of sync; falling back to pnpm install."
          pnpm install
        }
      else
        pnpm install
      fi
      ;;
    npm)
      if [ "$lockfile" = "true" ]; then
        npm ci || {
          action_notice "package-lock.json out of sync; falling back to npm install."
          npm install
        }
      else
        npm install
      fi
      ;;
    yarn)
      if [ "$lockfile" = "true" ]; then
        yarn install --frozen-lockfile || {
          action_notice "yarn lockfile out of sync; falling back to yarn install."
          yarn install
        }
      else
        yarn install
      fi
      ;;
    *)
      action_error "Unsupported package manager: $manager"
      exit 1
      ;;
  esac
}

# Installs a single dependency into the CI workspace, but only when it is not
# already resolvable. This is build-time scaffolding (e.g. @tanstack/query-core
# for Lovable apps that import react-query but omit it) — it lands in the
# runner's node_modules and is NEVER committed back to the user's repo.
inject_dependency() {
  local dep="$1"
  if node -e "require.resolve('$dep')" 2>/dev/null; then
    echo "$dep already present; skipping."
    return 0
  fi
  echo "Injecting $dep (CI only; never committed to your repo)."
  run_pm add "$dep"
}

# Sets HTTP_BODY and HTTP_STATUS. Remaining args are passed to curl before the URL.
# Retries once with HTTP/1.1 when curl hits HTTP/2 PROTOCOL_ERROR (exit 92).
http_post() {
  local url="$1"
  shift
  local response
  local curl_status=0

  response=$(curl -sS -w "\n__HTTP_STATUS__:%{http_code}" -X POST "$@" "$url") || curl_status=$?

  if [ "$curl_status" -eq 92 ]; then
    action_notice "HTTP/2 PROTOCOL_ERROR; retrying POST with HTTP/1.1."
    curl_status=0
    response=$(curl -sS --http1.1 -w "\n__HTTP_STATUS__:%{http_code}" -X POST "$@" "$url") || curl_status=$?
  fi

  if [ "$curl_status" -ne 0 ]; then
    action_error "curl failed with exit code $curl_status"
    return "$curl_status"
  fi

  HTTP_STATUS="${response##*__HTTP_STATUS__:}"
  HTTP_BODY="${response%$'\n'__HTTP_STATUS__:*}"
}

# Note: the plan step normally supplies an explicit output dir (via the
# `plan-output-dir` output) for frameworks whose build writes somewhere other
# than the Vite defaults. This candidate list is the fallback for when no plan
# is available (offline, no license) and covers the common static frameworks.
find_output_dir() {
  local override="${1:-}"

  if [ -n "$override" ]; then
    echo "$override"
    return 0
  fi

  local candidate
  for candidate in dist/client dist build build/client .output/public out; do
    if [ -f "$candidate/index.html" ]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

# True when the build emitted an SSR server entry. Every modern Vite-SSR /
# TanStack Start build (with or without a deploy preset) emits a single
# Web Fetch handler — `export default { fetch(request) }` — into dist/server.
# The Cloudflare preset names it index.js (next to wrangler.json); the plain
# preset-less build names it server.js. We accept either and echo the path.
find_ssr_bundle() {
  local candidate
  for candidate in dist/server/index.js dist/server/server.js; do
    if [ -f "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

# How the SSR entry must be booted to prerender it:
#
#   cloudflare — Cloudflare Workers bundle. The worker relies on CF-specific
#                globals and serves its own static assets via the `ASSETS`
#                binding, so it has to run inside a real Workers runtime
#                (Miniflare). Identified by the wrangler.json the CF preset
#                writes alongside the entry.
#
#   node       — plain Web Fetch handler (no CF bindings, doesn't serve its
#                own assets). Booted on a generic Node HTTP server that serves
#                dist/client statically and delegates everything else to the
#                handler's `fetch`. This is the default for any preset-less
#                TanStack Start / Vite-SSR build.
find_ssr_runtime() {
  if [ -f dist/server/wrangler.json ]; then
    echo "cloudflare"
  else
    echo "node"
  fi
}

# Static assets directory the SSR build serves from. For the Cloudflare
# runtime this reads `assets.directory` out of dist/server/wrangler.json
# (resolved relative to that file). For the node runtime there is no
# wrangler.json, so it falls back to dist/client — the directory both presets
# emit client assets into.
find_ssr_assets_dir() {
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    let dir = "../client";
    try {
      const cfg = JSON.parse(fs.readFileSync("dist/server/wrangler.json", "utf8"));
      if (cfg && cfg.assets && typeof cfg.assets.directory === "string") {
        dir = cfg.assets.directory;
      }
    } catch {}
    const resolved = path.resolve("dist/server", dir);
    const rel = path.relative(process.cwd(), resolved);
    process.stdout.write(rel || ".");
  '
}

# True when a static build output is the framework's OWN prerendered HTML that
# must be served verbatim — i.e. fully server-rendered markup that carries an
# inline client-hydration bootstrap. The canonical case is TanStack Start's
# Vite prerender (`prerender: { enabled: true }`), which writes real HTML for
# every route plus a `$_TSR` dehydration barrier near </body>.
#
# Such output is the final, correct SSG result and MUST NOT be re-crawled. The
# `$_TSR` object is created during HTML parse, then deletes itself
# (`delete self.$_TSR`) the moment hydration completes, and its <script> tag
# removes itself from the DOM (`document.currentScript.remove()`). A headless
# capture of the post-hydration DOM therefore loses the bootstrap entirely;
# replaying that file in a real visitor's browser makes the client's
# `hydrate()` find no `window.$_TSR`, trip TanStack Router's invariant, and
# unmount React to a blank page ("Invariant failed"). So when we detect this
# marker we skip the crawl and deploy the build's own files as-is.
is_prerendered_static_output() {
  local index="${1:?}/index.html"
  [ -f "$index" ] || return 1
  grep -qE '\$_TSR|\$tsr-stream-barrier' "$index"
}

# True when package.json declares a "build" script. Uses Node so we don't
# have to grep for a key that could appear inside any other string.
has_build_script() {
  node -e '
    const pkg = JSON.parse(require("node:fs").readFileSync("package.json", "utf8"));
    process.exit(pkg.scripts && pkg.scripts.build ? 0 : 1);
  ' 2>/dev/null
}
