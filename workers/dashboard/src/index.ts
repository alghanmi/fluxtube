import { Hono } from 'hono';

// Env interface grows across phases:
//   Phase 0: D1 binding placeholder only
//   Phase 2: D1_KEYCHAIN secret (present when the crypto util is used)
//   Phase 4: SESSION_SIGNING_KEY, RP_ID, YOUTUBE_CLIENT_ID/SECRET,
//            MANUAL_TRIGGER_TOKEN
//   Phase 5: BACKUPS (R2)
//   Phase 7: SYNC service binding
interface Env {
  DB: D1Database;
  /**
   * JSON keychain — parsed via `parseKeychain()` from ./crypto.ts.
   * Optional at the type level so Phase 0/1 health probes still work when
   * the secret hasn't been provisioned locally; callers that actually use
   * the crypto util must check + throw if missing.
   */
  D1_KEYCHAIN?: string;
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
