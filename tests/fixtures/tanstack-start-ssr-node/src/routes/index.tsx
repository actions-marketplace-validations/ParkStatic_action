import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main>
      <h1 data-testid="marker">Hello from the TanStack Start Node SSR fixture</h1>
      <p>This page is server-rendered by a plain Web Fetch handler and prerendered on a Node server.</p>
    </main>
  );
}
