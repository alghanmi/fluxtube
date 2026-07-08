import { describe, expect, it } from 'vitest';
import {
  clearSessionCookieHeader,
  readSessionCookie,
  sessionCookieHeader,
  signSession,
  verifySession,
  type SessionData,
} from '../../src/auth/session';

// 32-byte HMAC key, base64.
const HMAC_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const OTHER_KEY = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=';

const NOW = 1_700_000_000;

const baseSession = (overrides: Partial<SessionData> = {}): SessionData => ({
  sub: 'admin',
  credentialId: 'cred-abc',
  issuedAt: NOW,
  ...overrides,
});

describe('session sign + verify', () => {
  it('roundtrips a signed session', async () => {
    const token = await signSession(baseSession(), HMAC_KEY);
    const verified = await verifySession(token, HMAC_KEY, NOW + 1);
    expect(verified).toEqual({ sub: 'admin', credentialId: 'cred-abc', issuedAt: NOW });
  });

  it('rejects a token signed by a different key', async () => {
    const token = await signSession(baseSession(), HMAC_KEY);
    expect(await verifySession(token, OTHER_KEY, NOW + 1)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signSession(baseSession(), HMAC_KEY);
    const [payload, mac] = token.split('.') as [string, string];
    // Modify one byte of the payload (base64url charset — swap A with B).
    const tampered = `${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}.${mac}`;
    expect(await verifySession(tampered, HMAC_KEY, NOW + 1)).toBeNull();
  });

  it('rejects a token past its 24h TTL', async () => {
    const token = await signSession(baseSession({ issuedAt: NOW }), HMAC_KEY);
    // 24h + 1s later.
    expect(await verifySession(token, HMAC_KEY, NOW + 86400 + 1)).toBeNull();
  });

  it('accepts a token exactly at the 24h boundary', async () => {
    const token = await signSession(baseSession({ issuedAt: NOW }), HMAC_KEY);
    expect(await verifySession(token, HMAC_KEY, NOW + 86400)).not.toBeNull();
  });

  it('rejects a future-dated token (clock skew tolerance is 60s)', async () => {
    const token = await signSession(baseSession({ issuedAt: NOW + 61 }), HMAC_KEY);
    expect(await verifySession(token, HMAC_KEY, NOW)).toBeNull();
  });

  it('tolerates a slightly future-dated token within 60s skew', async () => {
    const token = await signSession(baseSession({ issuedAt: NOW + 30 }), HMAC_KEY);
    expect(await verifySession(token, HMAC_KEY, NOW)).not.toBeNull();
  });

  it('rejects a token without a period separator', async () => {
    expect(await verifySession('malformedtoken', HMAC_KEY, NOW)).toBeNull();
  });

  it('rejects an undefined / empty token', async () => {
    expect(await verifySession(undefined, HMAC_KEY, NOW)).toBeNull();
    expect(await verifySession('', HMAC_KEY, NOW)).toBeNull();
  });

  it('rejects payload with wrong shape (sub != admin)', async () => {
    // Craft a valid signature over a payload with sub: 'attacker'.
    const bad = { sub: 'attacker', credentialId: 'x', issuedAt: NOW };
    const token = await signSession(bad as unknown as SessionData, HMAC_KEY);
    expect(await verifySession(token, HMAC_KEY, NOW + 1)).toBeNull();
  });
});

describe('cookie headers', () => {
  it('sessionCookieHeader emits Secure; HttpOnly; SameSite=Lax; Max-Age=86400', () => {
    const header = sessionCookieHeader('abc.def');
    expect(header).toContain('fluxtube_session=abc.def');
    expect(header).toContain('Path=/');
    expect(header).toContain('Secure');
    expect(header).toContain('HttpOnly');
    // Lax (not Strict) so top-level OAuth callbacks land with the cookie.
    expect(header).toContain('SameSite=Lax');
    expect(header).not.toContain('SameSite=Strict');
    expect(header).toContain('Max-Age=86400');
  });

  it('clearSessionCookieHeader emits Max-Age=0 with the same attributes', () => {
    const header = clearSessionCookieHeader();
    expect(header).toContain('fluxtube_session=');
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).not.toContain('SameSite=Strict');
  });
});

describe('readSessionCookie', () => {
  const withCookie = (value: string) =>
    new Request('http://d.test/', { headers: { Cookie: value } });

  it('returns null when no cookie header is present', () => {
    expect(readSessionCookie(new Request('http://d.test/'))).toBeUndefined();
  });

  it('returns the session cookie value when present', () => {
    expect(readSessionCookie(withCookie('fluxtube_session=abc.def'))).toBe('abc.def');
  });

  it('finds the session cookie among other cookies', () => {
    expect(
      readSessionCookie(withCookie('other=xyz; fluxtube_session=abc.def; last=q')),
    ).toBe('abc.def');
  });

  it('returns undefined when the cookie header contains other cookies only', () => {
    expect(readSessionCookie(withCookie('other=xyz; last=q'))).toBeUndefined();
  });
});
