// Dual auth for /api/* routes:
//   1. Session cookie signed by SESSION_SIGNING_KEY (dashboard UI flow).
//   2. `Authorization: Bearer <MANUAL_TRIGGER_TOKEN>` — same secret the sync
//      worker uses for operator scripts (trigger-sync.sh etc.). Lets the
//      existing tooling keep working without new credential surface.
//
// Both paths are timing-safe. Callers that only accept one path (e.g. an
// endpoint gated to browser sessions only) can call `verifySession` directly.

import { readSessionCookie, verifySession, type SessionData } from './session';

export interface DashboardAuthEnv {
  SESSION_SIGNING_KEY?: string;
  MANUAL_TRIGGER_TOKEN?: string;
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
): Promise<SessionData | null> {
  // Bearer path.
  const auth = request.headers.get('Authorization');
  const bearerMatch = auth ? /^Bearer\s+(.+)$/i.exec(auth) : null;
  if (bearerMatch !== null && env.MANUAL_TRIGGER_TOKEN) {
    const presented = bearerMatch[1] ?? '';
    if (timingSafeEqual(presented, env.MANUAL_TRIGGER_TOKEN)) {
      return {
        sub: 'admin',
        credentialId: 'bearer:manual-trigger-token',
        issuedAt: Math.floor(Date.now() / 1000),
      };
    }
  }

  // Session cookie path.
  if (env.SESSION_SIGNING_KEY) {
    const token = readSessionCookie(request);
    const session = await verifySession(token, env.SESSION_SIGNING_KEY);
    if (session !== null) return session;
  }

  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
