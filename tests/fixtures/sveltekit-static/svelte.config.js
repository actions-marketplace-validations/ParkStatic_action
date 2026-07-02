import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// Fully prerendered static site (no SSR, no fallback). With every route
// prerendered (see src/routes/+layout.js) adapter-static writes one HTML file
// per route into build/.
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
  },
};
