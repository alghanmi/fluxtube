// WebAuthn passkey ceremony routes.
//
// Register (first boot only, gated by admin_passkey being empty):
//   POST /api/auth/passkey/register/begin   → options + challenge cookie
//   POST /api/auth/passkey/register/finish  → verifies, stores credential,
//                                             issues a one-time recovery code,
//                                             mints the initial session cookie
//
// Authenticate (subsequent boots):
//   POST /api/auth/passkey/authenticate/begin   → options + challenge cookie
//   POST /api/auth/passkey/authenticate/finish  → verifies, bumps sign_count,
//                                                 mints the session cookie
//
// Challenge flow: server generates a random challenge via
// @simplewebauthn/server, signs it into `fluxtube_challenge` cookie (5m TTL),
// and expects the same challenge back at /finish. The signed cookie is the
// "server-side challenge store" that the spec calls for — no D1 hop needed
// for a single-tenant single-user setup.
//
// All ceremony crypto lives inside @simplewebauthn/server; this module is
// glue: shape the options, thread the challenge through the cookie, land
// the credential in D1, mint the session.

import type { Hono } from 'hono';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  challengeCookieHeader,
  clearChallengeCookieHeader,
  readChallengeCookie,
  signChallenge,
  verifyChallenge,
} from '../auth/challenge';
import { sessionCookieHeader, signSession } from '../auth/session';
import { AdminPasskeyRepo } from '../repos/admin_passkey';

export interface WebauthnEnv {
  DB: D1Database;
  SESSION_SIGNING_KEY?: string;
  RP_ID?: string;
  RP_NAME?: string;
}

/** Attach the four passkey ceremony routes to a Hono app. */
export function attachWebauthnRoutes(app: Hono<{ Bindings: WebauthnEnv }>): void {
  // ─── REGISTER ────────────────────────────────────────────────────────

  app.post('/api/auth/passkey/register/begin', async (c) => {
    const cfg = requireCryptoConfig(c.env);
    if (!cfg.ok) return c.json({ error: cfg.error }, 500);

    // Gate: refuse if the instance is already claimed.
    const count = await new AdminPasskeyRepo(c.env.DB).count();
    if (count > 0) {
      return c.json({ error: 'instance_already_claimed' }, 409);
    }

    const options = await generateRegistrationOptions({
      rpName: cfg.rpName,
      rpID: cfg.rpID,
      // Single-tenant: user identity is a constant. Random user ID bytes
      // still helpful for authenticator UX (some show it in the picker).
      userName: 'admin',
      userDisplayName: 'FluxTube admin',
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
      },
    });

    const token = await signChallenge(
      { purpose: 'register', value: options.challenge, issuedAt: nowSec() },
      cfg.signingKey,
    );

    return new Response(JSON.stringify(options), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': challengeCookieHeader(token),
      },
    });
  });

  app.post('/api/auth/passkey/register/finish', async (c) => {
    const cfg = requireCryptoConfig(c.env);
    if (!cfg.ok) return c.json({ error: cfg.error }, 500);

    // Guard the gate on the finish path too — a concurrent register that
    // sneaks past begin's check needs to still fail at finish.
    const repo = new AdminPasskeyRepo(c.env.DB);
    if ((await repo.count()) > 0) {
      return c.json({ error: 'instance_already_claimed' }, 409);
    }

    const cookieToken = readChallengeCookie(c.req.raw);
    const challenge = await verifyChallenge(cookieToken, cfg.signingKey, 'register');
    if (!challenge) return c.json({ error: 'challenge_missing_or_expired' }, 400);

    let body: RegistrationResponseJSON;
    try {
      body = (await c.req.json()) as RegistrationResponseJSON;
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: challenge,
        expectedOrigin: `https://${cfg.rpID}`,
        expectedRPID: cfg.rpID,
        requireUserVerification: false,
      });
    } catch (err) {
      return c.json(
        {
          error: 'registration_verification_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        400,
      );
    }
    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ error: 'registration_not_verified' }, 400);
    }

    const {
      credential: { id: credentialID, publicKey: credentialPublicKey, counter },
      credentialBackedUp,
    } = verification.registrationInfo;

    const recoveryCode = generateRecoveryCode();
    const recoveryHash = await sha256Hex(recoveryCode);

    await repo.insert({
      credentialId: credentialID,
      publicKey: uint8ToBase64Url(credentialPublicKey),
      signCount: counter,
      transports: body.response.transports ?? null,
      recoveryHash,
      createdAt: nowSec(),
    });

    // Mint the initial session cookie so the browser is logged in already.
    const sessionToken = await signSession(
      { sub: 'admin', credentialId: credentialID, issuedAt: nowSec() },
      cfg.signingKey,
    );

    return new Response(
      JSON.stringify({
        credentialId: credentialID,
        recoveryCode,
        credentialBackedUp: credentialBackedUp ?? false,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          // Clear the challenge cookie; set the session cookie. Set-Cookie
          // is one of the few headers that Cloudflare allows multiple of.
          'Set-Cookie': [
            clearChallengeCookieHeader(),
            sessionCookieHeader(sessionToken),
          ].join(', '),
        },
      },
    );
  });

  // ─── AUTHENTICATE ───────────────────────────────────────────────────

  app.post('/api/auth/passkey/authenticate/begin', async (c) => {
    const cfg = requireCryptoConfig(c.env);
    if (!cfg.ok) return c.json({ error: cfg.error }, 500);

    const rows = await new AdminPasskeyRepo(c.env.DB).listAll();
    if (rows.length === 0) {
      return c.json({ error: 'no_registered_passkey' }, 404);
    }

    const options = await generateAuthenticationOptions({
      rpID: cfg.rpID,
      allowCredentials: rows.map((r) => ({
        id: r.credentialId,
        transports: (r.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
      })),
      userVerification: 'preferred',
    });

    const token = await signChallenge(
      { purpose: 'authenticate', value: options.challenge, issuedAt: nowSec() },
      cfg.signingKey,
    );

    return new Response(JSON.stringify(options), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': challengeCookieHeader(token),
      },
    });
  });

  app.post('/api/auth/passkey/authenticate/finish', async (c) => {
    const cfg = requireCryptoConfig(c.env);
    if (!cfg.ok) return c.json({ error: cfg.error }, 500);

    const cookieToken = readChallengeCookie(c.req.raw);
    const challenge = await verifyChallenge(cookieToken, cfg.signingKey, 'authenticate');
    if (!challenge) return c.json({ error: 'challenge_missing_or_expired' }, 400);

    let body: AuthenticationResponseJSON;
    try {
      body = (await c.req.json()) as AuthenticationResponseJSON;
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const repo = new AdminPasskeyRepo(c.env.DB);
    const stored = await repo.get(body.id);
    if (!stored) return c.json({ error: 'unknown_credential' }, 404);

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge: challenge,
        expectedOrigin: `https://${cfg.rpID}`,
        expectedRPID: cfg.rpID,
        credential: {
          id: stored.credentialId,
          publicKey: base64UrlToUint8(stored.publicKey),
          counter: stored.signCount,
        },
        requireUserVerification: false,
      });
    } catch (err) {
      return c.json(
        {
          error: 'authentication_verification_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        400,
      );
    }
    if (!verification.verified) {
      return c.json({ error: 'authentication_not_verified' }, 400);
    }

    // Bump the sign_count so a replay of the same assertion fails next time.
    await repo.updateSignCount(
      stored.credentialId,
      verification.authenticationInfo.newCounter,
      nowSec(),
    );

    const sessionToken = await signSession(
      { sub: 'admin', credentialId: stored.credentialId, issuedAt: nowSec() },
      cfg.signingKey,
    );

    return new Response(JSON.stringify({ credentialId: stored.credentialId }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': [
          clearChallengeCookieHeader(),
          sessionCookieHeader(sessionToken),
        ].join(', '),
      },
    });
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────

// Minimal WebAuthn transport union we care about — matches the strings the
// browser sends via `getTransports()`. Kept local so we don't pull in the
// full type surface just to satisfy tsc.
type AuthenticatorTransportFuture = 'ble' | 'internal' | 'nfc' | 'usb' | 'cable' | 'hybrid';

interface CryptoConfigOk {
  ok: true;
  rpID: string;
  rpName: string;
  signingKey: string;
}

interface CryptoConfigErr {
  ok: false;
  error: string;
}

function requireCryptoConfig(env: WebauthnEnv): CryptoConfigOk | CryptoConfigErr {
  if (!env.RP_ID) return { ok: false, error: 'rp_id_not_configured' };
  if (!env.SESSION_SIGNING_KEY) return { ok: false, error: 'session_signing_key_not_configured' };
  return {
    ok: true,
    rpID: env.RP_ID,
    rpName: env.RP_NAME ?? 'FluxTube',
    signingKey: env.SESSION_SIGNING_KEY,
  };
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Recovery code: 32 random bytes → base64url. Shown to the user once at
 * register/finish, hashed for storage. High entropy (~256 bits) — a single
 * lost code doesn't need a rotation or lockout policy.
 */
function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return uint8ToBase64Url(bytes);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  let s = '';
  for (const b of new Uint8Array(buf)) s += b.toString(16).padStart(2, '0');
  return s;
}

function uint8ToBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUint8(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  // Explicit ArrayBuffer backing so the return type narrows to
  // Uint8Array<ArrayBuffer>, which is what @simplewebauthn/server's
  // `credential.publicKey` field requires under TS 6's stricter typing.
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
