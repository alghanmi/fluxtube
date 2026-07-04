import { Hono } from 'hono';

// Env interface grows across phases:
//   Phase 0: D1 binding placeholder only
//   Phase 2: D1_KEYCHAIN, SESSION_SIGNING_KEY secrets
//   Phase 4: RP_ID, YOUTUBE_CLIENT_ID/SECRET, MANUAL_TRIGGER_TOKEN
//   Phase 5: BACKUPS (R2)
//   Phase 7: SYNC service binding
interface Env {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Env }>();

// Liveness / version probe. Used by curl-based smoke tests and the CI deploy
// verification step. The full route surface (auth, mappings, backup, etc.)
// arrives in Phase 4.
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'fluxtube-dashboard',
    version: VERSION,
  }),
);

export default app;
