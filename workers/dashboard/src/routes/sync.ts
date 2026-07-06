// POST /api/sync/trigger — forwards a POST to the sync Worker via
// Cloudflare Service Binding.
//
// The sync Worker's POST /sync endpoint expects the same
// `Authorization: Bearer <MANUAL_TRIGGER_TOKEN>` that this Worker uses for
// operator-script auth. Since both Workers share the secret at deploy time,
// we re-attach it from `env.MANUAL_TRIGGER_TOKEN` when forwarding — that
// way UI callers (session-cookie-authed) don't need to re-supply it, and
// bearer-authed callers get their token replaced with the canonical value
// rather than trusting the client's echo.
//
// The SYNC service binding is optional at the type level; Terraform wires
// it in Phase 7 alongside the dashboard Worker. Until then this endpoint
// returns 503 with a clear error.

import type { Hono } from 'hono';
import { requireAuth } from '../auth/require_auth';
import type { DashboardAuthEnv } from '../auth/require_auth';

export interface SyncEnv extends DashboardAuthEnv {
  // Not used inside this module — declared so `Hono<{ Bindings: SyncEnv }>`
  // stays structurally compatible with the app-level Env (which mandates DB).
  DB: D1Database;
  SYNC?: Fetcher;
}

export function attachSyncRoutes(app: Hono<{ Bindings: SyncEnv }>): void {
  app.post('/api/sync/trigger', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    if (!c.env.SYNC) return c.json({ error: 'sync_binding_not_configured' }, 503);
    if (!c.env.MANUAL_TRIGGER_TOKEN) {
      return c.json({ error: 'sync_bearer_not_configured' }, 503);
    }

    const upstream = await c.env.SYNC.fetch('https://sync/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.MANUAL_TRIGGER_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    // Pass through the sync worker's response body + status; strip its
    // Set-Cookie (the sync worker never sets one, but future-proof it).
    const bodyText = await upstream.text();
    return new Response(bodyText, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      },
    });
  });
}
