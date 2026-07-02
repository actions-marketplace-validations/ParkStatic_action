# SvelteKit static build: adapter-static prerenders every route to build/.
# The action detects a static SPA build and the crawl re-captures the hydrated
# Svelte DOM. Assert the build was located at build/, the page content survived,
# and the packaged site renders.
assert_eq "$MODE" "static" "build mode"
assert_eq "$OUTPUT_DIR" "build" "output dir"
assert_file build/index.html
assert_grep build/index.html "Hello from the SvelteKit static fixture"
assert_file dist.zip

# Functional check: the packaged SvelteKit site must hydrate and render without
# runtime errors or missing assets.
assert_renders "/" "Hello from the SvelteKit static fixture"
