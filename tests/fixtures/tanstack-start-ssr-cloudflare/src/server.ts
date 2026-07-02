// Minimal Cloudflare worker entry: lazily import TanStack Start's server entry
// and delegate fetch to it. The dynamic import mirrors the pattern real Lovable
// exports use so the Workers runtime does not eagerly evaluate the SSR bundle.
type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const handler = await getServerEntry();
    return handler.fetch(request, env, ctx);
  },
};
