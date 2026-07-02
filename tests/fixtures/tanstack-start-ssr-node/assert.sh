# Preset-less TanStack Start SSR. The build emits a plain Web Fetch handler into
# dist/server (no wrangler.json), which the action detects as mode=ssr /
# runtime=node, boots on a generic Node fetch server, and crawls into
# dist/client. Assert that shape and the rendered server output.
assert_eq "$MODE" "ssr" "build mode"
assert_eq "$SSR_RUNTIME" "node" "ssr runtime"
[ ! -f dist/server/wrangler.json ] || fail "node SSR build should not emit wrangler.json"
echo "  ok: no wrangler.json (node runtime)"
assert_file "$OUTPUT_DIR/index.html"
assert_grep "$OUTPUT_DIR/index.html" "Hello from the TanStack Start Node SSR fixture"
assert_file dist.zip

# Functional check: the crawled SSR snapshot must hydrate into a working SPA
# without runtime errors or missing assets.
assert_renders "/" "Hello from the TanStack Start Node SSR fixture"
