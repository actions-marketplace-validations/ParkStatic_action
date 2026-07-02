# TanStack Start's own prerenderer already emitted final HTML with an inline
# hydration bootstrap. The action must detect mode=prerendered, SKIP the crawl,
# and ship the HTML verbatim. Assert the mode, that the framework's hydration
# barrier survived (proof the crawl did not run), and that it packaged.
assert_eq "$MODE" "prerendered" "build mode"
assert_file "$OUTPUT_DIR/index.html"
assert_grep "$OUTPUT_DIR/index.html" "Hello from the TanStack Start prerendered fixture"
assert_grep "$OUTPUT_DIR/index.html" '\$_TSR|\$tsr-stream-barrier'
assert_file dist.zip

# Functional check: the verbatim prerendered HTML must hydrate cleanly. This is
# the case that historically blanked ("Invariant failed") when the crawl stripped
# the $_TSR bootstrap — so rendering without a page error is the real proof.
assert_renders "/" "Hello from the TanStack Start prerendered fixture"
