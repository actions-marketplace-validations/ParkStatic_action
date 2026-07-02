import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

// TanStack Start with framework-native prerendering. The build writes its OWN
// server-rendered HTML for every route into dist/client, complete with the
// inline hydration bootstrap ($_TSR). The action must detect this shape as
// mode=prerendered and deploy the HTML verbatim WITHOUT re-crawling it (a crawl
// would capture the post-hydration DOM and strip the bootstrap).
export default defineConfig({
  plugins: [
    tanstackStart({ prerender: { enabled: true, crawlLinks: true } }),
    viteReact(),
  ],
});
