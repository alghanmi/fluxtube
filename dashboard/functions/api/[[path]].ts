// Cloudflare Pages Function — forwards every /api/* request to the
// dashboard Worker via the Service Binding named DASHBOARD (declared in
// infrastructure/terraform/_modules/fluxtube-environment/pages.tf).
//
// This is the plumbing that makes /api/* same-origin from the Astro static
// build's perspective. The Preact islands hit `/api/mappings` etc. as
// if they lived on Pages; this proxy re-invokes the Worker without a
// public-internet hop.
//
// Cookies + auth headers ride along unchanged — Fetcher.fetch() honors the
// full Request including credentials.
//
// Types inlined so this file doesn't force @cloudflare/workers-types into
// the Astro workspace (Astro's check would need it in the tsconfig types
// list otherwise). Cloudflare provides the real PagesFunction and Fetcher
// at runtime — the shapes below match its documented interfaces.

interface Fetcher {
  fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
}

interface Env {
  DASHBOARD: Fetcher;
}

interface PagesFunctionArgs {
  request: Request;
  env: Env;
}

export const onRequest = async ({ request, env }: PagesFunctionArgs): Promise<Response> => {
  return env.DASHBOARD.fetch(request);
};
