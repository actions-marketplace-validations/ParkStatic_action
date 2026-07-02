import { defineConfig } from "astro/config";

// Default static output lands in dist/ with one index.html per route. No
// adapter, no SSR — the build is fully prerendered by Astro.
export default defineConfig({});
