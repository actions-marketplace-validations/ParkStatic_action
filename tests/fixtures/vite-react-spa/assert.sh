# Classic Vite SPA: the build ships an empty shell, the prerender crawl captures
# the post-hydration DOM. Assert the SPA was detected as static, the crawl wrote
# real content into index.html, and the artifact was packaged.
assert_eq "$MODE" "static" "build mode"
assert_eq "$OUTPUT_DIR" "dist" "output dir"
assert_file dist/index.html
assert_grep dist/index.html "Hello from the Vite React SPA fixture"
assert_file dist.zip

# Functional check: the packaged SPA must hydrate and paint without runtime
# errors or missing assets.
assert_renders "/" "Hello from the Vite React SPA fixture"
