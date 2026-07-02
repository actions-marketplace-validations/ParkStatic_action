import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main>
      <h1 data-testid="marker">Hello from the TanStack Start prerendered fixture</h1>
      <p>This HTML is emitted by the framework's own prerenderer and must ship verbatim.</p>
    </main>
  );
}
