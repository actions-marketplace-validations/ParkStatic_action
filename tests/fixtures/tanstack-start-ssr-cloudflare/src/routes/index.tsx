import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main>
      <h1 data-testid="marker">Hello from the TanStack Start Cloudflare SSR fixture</h1>
      <p>This page is server-rendered by a Cloudflare Worker and prerendered via Miniflare.</p>
    </main>
  );
}
