# Nuxt static build: `nuxt generate` prerenders every route to .output/public/.
# The action detects a static SPA build and the crawl re-captures the hydrated
# Nuxt DOM. Assert the build was located at .output/public, the page content
# survived, and the packaged site renders.
assert_eq "$MODE" "static" "build mode"
assert_eq "$OUTPUT_DIR" ".output/public" "output dir"
assert_file .output/public/index.html
assert_grep .output/public/index.html "Hello from the Nuxt static fixture"
assert_file dist.zip

# Functional check: the packaged Nuxt site must hydrate and render without
# runtime errors or missing assets.
assert_renders "/" "Hello from the Nuxt static fixture"
