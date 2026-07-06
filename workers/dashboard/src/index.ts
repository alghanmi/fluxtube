import { Hono } from 'hono';
import { requireAuth } from './auth/require_auth';
import { clearSessionCookieHeader } from './auth/session';
import { AdminPasskeyRepo } from './repos/admin_passkey';
import { attachWebauthnRoutes } from './routes/webauthn';

// Env interface grows across phases:
//   Phase 0: D1 binding placeholder only
//   Phase 2: D1_KEYCHAIN secret (present when the crypto util is used)
//   Phase 4a: SESSION_SIGNING_KEY, MANUAL_TRIGGER_TOKEN
//   Phase 4b: RP_ID (WebAuthn relying-party ID), RP_NAME (optional)
//   Phase 4d: YOUTUBE_CLIENT_ID/SECRET
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
  /**
   * 32-byte HMAC key, base64-encoded. Used by ./auth/session.ts to sign
   * session cookies AND by ./auth/challenge.ts to sign short-lived
   * WebAuthn challenge cookies. Optional at the type level so the Phase
   * 0/1 health probes boot without it; auth routes that need it validate
   * presence and 500 with a clear operator message when missing.
   */
  SESSION_SIGNING_KEY?: string;
  /**
   * Same bearer token the workers/sync router accepts. Lets existing
   * operator scripts (trigger-sync.sh, etc.) hit dashboard endpoints
   * without a passkey session.
   */
  MANUAL_TRIGGER_TOKEN?: string;
  /**
   * WebAuthn relying-party ID — the domain the passkey is bound to. In
   * production this is `fluxtube.alghanmi.cloud`; injected via Terraform
   * from `var.dashboard_domain` (Phase 7) so the private hostname never
   * lives in the public repo.
   */
  RP_ID?: string;
  /**
   * Human-readable relying-party name shown by some authenticators.
   * Defaults to 'FluxTube' when unset.
   */
  RP_NAME?: string;
}

const app = new Hono<{ Bindings: Env }>();

// ─── Liveness / version probe ────────────────────────────────────────────
// Public; used by CI deploy verification + curl smoke tests.

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'fluxtube-dashboard',
    version: VERSION,
  }),
);

// ─── WebAuthn passkey ceremonies (Phase 4b) ──────────────────────────────
// register/begin, register/finish, authenticate/begin, authenticate/finish.
// Register is gated to admin_passkey being empty.

attachWebauthnRoutes(app);

// ─── Session-related routes ──────────────────────────────────────────────

/**
 * GET /api/me — returns the current session's SessionData or 401.
 * Both auth paths (cookie + Bearer) accepted; Bearer callers get a
 * synthetic session with credentialId 'bearer:manual-trigger-token'.
 */
app.get('/api/me', async (c) => {
  const session = await requireAuth(c.req.raw, c.env);
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ session });
});

/**
 * POST /api/auth/logout — clears the session cookie. Always 200 (idempotent).
 * Bearer-authed callers get no state change since Bearer auth is stateless,
 * but the endpoint still responds cleanly so they can share code with the UI.
 */
app.post('/api/auth/logout', (_c) => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookieHeader(),
    },
  });
});

/**
 * POST /api/auth/recovery — wipes the admin_passkey table iff the posted
 * `recovery_code` SHA-256-hashes to an existing row's recovery_hash.
 *
 * Body: { recovery_code: string }
 * Returns:
 *   200 { wiped: number } — recovery_code matched, N rows wiped
 *   401 { error: 'invalid_recovery_code' } — no match; table intact
 *
 * Intentionally NOT protected by auth — the whole point is that the operator
 * has lost their passkey. The recovery code IS the auth for this endpoint.
 * Once wiped, next request to /claim (Phase 4b) starts a fresh registration.
 */
app.post('/api/auth/recovery', async (c) => {
  let body: { recovery_code?: unknown };
  try {
    body = (await c.req.json()) as { recovery_code?: unknown };
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const code = body.recovery_code;
  if (typeof code !== 'string' || code.length === 0) {
    return c.json({ error: 'missing_recovery_code' }, 400);
  }
  const hash = await sha256Hex(code);
  const wiped = await new AdminPasskeyRepo(c.env.DB).deleteAllMatching(
    hash,
    Math.floor(Date.now() / 1000),
  );
  if (wiped === 0) return c.json({ error: 'invalid_recovery_code' }, 401);
  return c.json({ wiped });
});

// ─── Helpers ─────────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  let s = '';
  for (const b of new Uint8Array(buf)) s += b.toString(16).padStart(2, '0');
  return s;
}

export default app;
