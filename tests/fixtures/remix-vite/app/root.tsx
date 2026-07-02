import { Links, Meta, Outlet, Scripts } from "@remix-run/react";

function Document({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <Document>
      <Outlet />
    </Document>
  );
}

// SPA Mode renders this into the static index.html at build time, then the
// client hydrates and the matched route takes over. <Scripts /> is required so
// the hydration bootstrap is present in the generated HTML.
export function HydrateFallback() {
  return (
    <Document>
      <p>Loading fixture...</p>
    </Document>
  );
}
