import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

// Preset-less TanStack Start SSR. With no deployment target the build emits a
// plain Web Fetch handler into dist/server (and no wrangler.json), which the
// action detects as runtime=node and boots on a generic Node fetch server to
// crawl into dist/client.
export default defineConfig({
  plugins: [tanstackStart(), viteReact()],
});
