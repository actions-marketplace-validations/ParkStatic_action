# Lovable-style export: a Vite React SPA that uses @tanstack/react-query. The
# plan asks to inject @tanstack/query-core (the classic missing-dep fix for
# Lovable projects); the inject step must run without error and the build must
# succeed. Assert the static build was produced and the app rendered.
assert_eq "$MODE" "static" "build mode"
assert_eq "$OUTPUT_DIR" "dist" "output dir"
assert_file dist/index.html
assert_grep dist/index.html "Hello from the Lovable react-query fixture"
assert_file dist.zip

# Functional check: the app must hydrate with a live QueryClient (the missing
# query-core dep is exactly what causes a blank Lovable page) and paint.
assert_renders "/" "Hello from the Lovable react-query fixture" "react-query status: data loaded"
