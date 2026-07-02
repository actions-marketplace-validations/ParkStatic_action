import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";

// SPA Mode: Remix generates a static build/client/index.html from the root
// route's HydrateFallback at build time and emits no server build. The action
// serves build/client and crawls it to capture the post-hydration DOM.
export default defineConfig({
  plugins: [remix({ ssr: false })],
});
