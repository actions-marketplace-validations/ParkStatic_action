#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Build"

# Trust the user's own build. We don't overlay a vite config or pin a config
# path — every Lovable variant (vite SPA, TanStack Start, anything in
# between) defines its own `build` script and we just run it. The downstream
# prerender step renders the resulting output in a real browser, which is the
# only universally reliable way to get static HTML for arbitrary routing.
# Build invocation, in priority order:
#   1. The action's build-command input (explicit user override).
#   2. The plan's declarative build kind (package-script vs vite-build). The
#      plan never returns shell to run — only this constrained vocabulary, which
#      we map onto run_pm here.
#   3. A local heuristic, for when the plan step was skipped entirely.
if [ -n "${BUILD_COMMAND:-}" ]; then
  echo "Running custom build command: $BUILD_COMMAND"
  eval "$BUILD_COMMAND"
elif [ "${BUILD_KIND:-}" = "package-script" ]; then
  echo "Running '$PACKAGE_MANAGER run ${BUILD_SCRIPT:-build}'."
  run_pm run "${BUILD_SCRIPT:-build}"
elif [ "${BUILD_KIND:-}" = "vite-build" ]; then
  echo "No 'build' script in package.json; running 'vite build'."
  run_pm exec vite build
elif has_build_script; then
  echo "Running '$PACKAGE_MANAGER run build'."
  run_pm run build
else
  echo "No 'build' script in package.json; falling back to 'vite build'."
  run_pm exec vite build
fi

action_endgroup

action_group "Locate output"

# Two clearly separated build shapes, decided here once and propagated as the
# `mode` output to every downstream step:
#
#   static — classic Vite SPA. dist/client (or dist, build) ships an empty
#            index.html shell plus its assets. The prerender step serves that
#            directory and crawls it to capture real content.
#
#   prerendered — the build already emitted the framework's OWN server-rendered
#            HTML for every route, complete with an inline hydration bootstrap
#            (e.g. TanStack Start's Vite `prerender: { enabled: true }`, which
#            embeds a `$_TSR` barrier). These files are final and must ship
#            verbatim: re-crawling would capture the post-hydration DOM, strip
#            the bootstrap, and blank the page for visitors. The prerender step
#            is skipped entirely for this shape.
#
#   ssr    — SSR build (TanStack Start et al.). dist/server holds a Web Fetch
#            handler, dist/client holds the static assets; no index.html
#            exists yet. The prerender step boots the handler — via Miniflare
#            for the Cloudflare preset, via a generic Node fetch server
#            otherwise — and crawls it to materialize HTML into dist/client.
# Resolve the static output directory. Priority:
#   1. User `output-dir` input — strict, always wins (respected verbatim).
#   2. Plan `plan-output-dir` — advisory; used only when its index.html actually
#      exists, so an SSR build (no static index.html yet) falls through to SSR
#      detection below instead of being mislocated.
#   3. Candidate-list heuristic in find_output_dir.
LOCATE_OVERRIDE="${OUTPUT_DIR_OVERRIDE:-}"
if [ -z "$LOCATE_OVERRIDE" ] && [ -n "${PLAN_OUTPUT_DIR:-}" ] && [ -f "${PLAN_OUTPUT_DIR}/index.html" ]; then
  LOCATE_OVERRIDE="$PLAN_OUTPUT_DIR"
fi

if OUTPUT_DIR=$(find_output_dir "$LOCATE_OVERRIDE"); then
  if [ ! -f "$OUTPUT_DIR/index.html" ]; then
    action_error "Could not find index.html in $OUTPUT_DIR."
    exit 1
  fi
  if is_prerendered_static_output "$OUTPUT_DIR"; then
    MODE="prerendered"
    echo "Detected an already-prerendered static build (framework hydration bootstrap present)."
    echo "Output: $OUTPUT_DIR"
    echo "The build's own HTML will be deployed verbatim; the headless crawl is skipped to preserve hydration state."
  else
    MODE="static"
    echo "Detected static SPA build."
    echo "Output: $OUTPUT_DIR"
  fi
elif SSR_ENTRY=$(find_ssr_bundle); then
  MODE="ssr"
  SSR_RUNTIME=$(find_ssr_runtime)
  OUTPUT_DIR=$(find_ssr_assets_dir)
  if [ ! -d "$OUTPUT_DIR" ]; then
    action_error "SSR build detected but assets directory '$OUTPUT_DIR' does not exist."
    exit 1
  fi
  echo "Detected SSR build (runtime: $SSR_RUNTIME)."
  echo "Server entry:  $SSR_ENTRY"
  echo "Static assets: $OUTPUT_DIR"
  write_output "ssr-entry" "$SSR_ENTRY"
  write_output "ssr-runtime" "$SSR_RUNTIME"
else
  action_error "Could not find a deployable build. Expected an index.html in dist/client, dist, build, build/client, .output/public, or out (static SPA), or an SSR entry at dist/server/index.js or dist/server/server.js."
  exit 1
fi

write_output "mode" "$MODE"
write_output "output-dir" "$OUTPUT_DIR"
action_endgroup
