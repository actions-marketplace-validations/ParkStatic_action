# Astro static build: `astro build` writes fully prerendered HTML to dist/.
# The action detects a static SPA build and the crawl re-captures the (already
# complete) DOM. Assert the build was located at dist/, the page content
# survived, and the packaged site renders.
assert_eq "$MODE" "static" "build mode"
assert_eq "$OUTPUT_DIR" "dist" "output dir"
assert_file dist/index.html
assert_grep dist/index.html "Hello from the Astro static fixture"
assert_file dist.zip

# Functional check: the packaged Astro site must render without runtime errors
# or missing assets.
assert_renders "/" "Hello from the Astro static fixture"
