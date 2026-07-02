// Minimal Nuxt 3 config. `nuxt generate` (the build script) prerenders every
// route to .output/public/. With only app.vue (no pages/ directory) the build
// emits a single .output/public/index.html.
export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  ssr: true,
});
