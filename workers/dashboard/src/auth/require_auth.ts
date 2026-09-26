// Auth for /api/* routes:
//   1. Session cookie signed by SESSION_SIGNING_KEY (dashboard UI flow). The
//      session's credentialId must still exist in admin_passkey, so a
//      recovery wipe (or any passkey removal) revokes every outstanding
//      session instead of leaving them valid until their 24h TTL.
//   2. `Authorization: Bearer <MANUAL_TRIGGER_TOKEN>` — the operator-script
//      token. Accepted ONLY on routes that opt in with `{ bearer: true }`
//      (sync trigger, manual backup, backup listing, /api/me). Everything
//      else — restores, credential edits, mappings — needs a passkey
//      session, so the shared script token isn't a full admin credential.
//
// The Bearer comparison is timing-safe. Callers that only accept one path
// can call `verifySession` directly.

import { readSessionCookie, verifySession, type SessionData } from './session';

export interface DashboardAuthEnv {
  DB: D1Database;
  SESSION_SIGNING_KEY?: string;
  MANUAL_TRIGGER_TOKEN?: string;
}

export interface RequireAuthOptions {
  /** Accept the operator Bearer token on this route. Default false. */
  bearer?: boolean;
}

/**
 * Returns the SessionData if the request is authorized, else null.
 *
 * The bearer path returns a synthetic SessionData with `credentialId:
 * 'bearer:manual-trigger-token'` so downstream code can distinguish
 * bearer-triggered writes from UI writes in audit logs.
 */
export async function requireAuth(
  request: Request,
  env: DashboardAuthEnv,
  options: RequireAuthOptions = {},
): Promise<SessionData | null> {
  if (options.bearer && isOperatorBearer(request, env)) {
    return {
      sub: 'admin',
      credentialId: 'bearer:manual-trigger-token',
      issuedAt: Math.floor(Date.now() / 1000),
    };
  }

  if (env.SESSION_SIGNING_KEY) {
    const token = readSessionCookie(request);
    const session = await verifySession(token, env.SESSION_SIGNING_KEY);
    if (session !== null && (await passkeyExists(env.DB, session.credentialId))) {
      return session;
    }
  }

  return null;
}

/** True iff the request carries `Authorization: Bearer <MANUAL_TRIGGER_TOKEN>`. */
export function isOperatorBearer(request: Request, env: DashboardAuthEnv): boolean {
  if (!env.MANUAL_TRIGGER_TOKEN) return false;
  const auth = request.headers.get('Authorization');
  const match = auth ? /^Bearer\s+(.+)$/i.exec(auth) : null;
  if (match === null) return false;
  return timingSafeEqual(match[1] ?? '', env.MANUAL_TRIGGER_TOKEN);
}

async function passkeyExists(db: D1Database, credentialId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM admin_passkey WHERE credential_id = ?')
    .bind(credentialId)
    .first<{ ok: number }>();
  return row !== null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
