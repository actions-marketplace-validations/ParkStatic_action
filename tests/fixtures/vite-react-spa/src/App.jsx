import { useState } from "react";

export function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1 data-testid="marker">Hello from the Vite React SPA fixture</h1>
      <p>This text is rendered by React and must survive the prerender crawl.</p>
      <button onClick={() => setCount((c) => c + 1)}>count is {count}</button>
    </main>
  );
}
