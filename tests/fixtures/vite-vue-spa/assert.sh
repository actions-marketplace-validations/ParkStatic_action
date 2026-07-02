# Vite Vue SPA: same static-shell + crawl path as React, proving the action is
# framework-agnostic for plain Vite builds. Assert Vue-rendered text was captured.
assert_eq "$MODE" "static" "build mode"
assert_eq "$OUTPUT_DIR" "dist" "output dir"
assert_file dist/index.html
assert_grep dist/index.html "Hello from the Vite Vue SPA fixture"
assert_file dist.zip

# Functional check: the packaged Vue SPA must mount and paint without runtime
# errors or missing assets.
assert_renders "/" "Hello from the Vite Vue SPA fixture"
