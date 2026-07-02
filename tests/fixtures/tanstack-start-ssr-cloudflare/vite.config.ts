import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

// Cloudflare SSR preset. The @cloudflare/vite-plugin builds the worker from
// wrangler.jsonc's `main` (src/server.ts); tanstackStart's server.entry points
// at the same file so both agree. Output: dist/server/index.js + wrangler.json
// (runtime=cloudflare) alongside dist/client — the shape the action boots via
// Miniflare.
export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
  ],
});
