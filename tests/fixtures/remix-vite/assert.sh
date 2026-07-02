# Remix Vite SPA Mode: `remix vite:build` with ssr:false writes a static
# build/client/index.html shell (root HydrateFallback + hydration bootstrap).
# The action serves build/client and the crawl captures the post-hydration DOM
# (the real _index route content). Assert the build was located at build/client,
# the route content was captured, and the packaged site renders.
assert_eq "$MODE" "static" "build mode"
assert_eq "$OUTPUT_DIR" "build/client" "output dir"
assert_file build/client/index.html
assert_grep build/client/index.html "Hello from the Remix Vite SPA fixture"
assert_file dist.zip

# Functional check: the packaged Remix SPA must hydrate and render without
# runtime errors or missing assets.
assert_renders "/" "Hello from the Remix Vite SPA fixture"
