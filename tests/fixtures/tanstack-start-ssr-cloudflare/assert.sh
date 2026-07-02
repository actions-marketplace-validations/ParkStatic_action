# TanStack Start SSR with the Cloudflare preset. The build emits a Workers
# bundle (dist/server/index.js) + wrangler.json; the action must detect
# mode=ssr / runtime=cloudflare, boot the worker under Miniflare, crawl it, and
# materialize static HTML into dist/client. Assert that shape and the rendered
# server output.
assert_eq "$MODE" "ssr" "build mode"
assert_eq "$SSR_RUNTIME" "cloudflare" "ssr runtime"
assert_file dist/server/index.js
assert_file dist/server/wrangler.json
assert_file "$OUTPUT_DIR/index.html"
assert_grep "$OUTPUT_DIR/index.html" "Hello from the TanStack Start Cloudflare SSR fixture"
assert_file dist.zip

# Functional check: the Miniflare-crawled snapshot must hydrate into a working
# SPA without runtime errors or missing assets.
assert_renders "/" "Hello from the TanStack Start Cloudflare SSR fixture"
