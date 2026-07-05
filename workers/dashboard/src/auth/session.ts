// Signed session cookies for the dashboard's admin.
//
// Cookie shape:
//   fluxtube_session=<payload-b64url>.<hmac-hex>
//
// Payload is JSON-serialized SessionData; HMAC is over the payload bytes,
// signed with SESSION_SIGNING_KEY (base64, 32 bytes). Verification is
// timing-safe and TTL-checked (24h).
//
// The cookie is not encrypted — it doesn't need to be, since there's
// nothing sensitive in SessionData. Signing prevents forgery; that's all
// that's required for a single-tenant admin session.

const COOKIE_NAME = 'fluxtube_session';
const MAX_AGE_SECONDS = 60 * 60 * 24; // 24h

export interface SessionData {
  sub: 'admin';
  credentialId: string;
  issuedAt: number; // unix seconds when signed
}

/** Sign + encode a session token: `<payload-b64url>.<hmac-hex>` */
export async function signSession(data: SessionData, hmacKeyB64: string): Promise<string> {
  const key = await importHmacKey(hmacKeyB64);
  const payloadJson = JSON.stringify(data);
  const payloadB64Url = base64UrlEncode(new TextEncoder().encode(payloadJson));
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64Url));
  return `${payloadB64Url}.${bytesToHex(new Uint8Array(mac))}`;
}

/** Verify + parse. Returns SessionData if signature + TTL both check; else null. */
export async function verifySession(
  token: string | undefined,
  hmacKeyB64: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<SessionData | null> {
  if (!token) return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx < 1 || dotIdx === token.length - 1) return null;
  const payloadB64Url = token.slice(0, dotIdx);
  const macHex = token.slice(dotIdx + 1);

  const key = await importHmacKey(hmacKeyB64);
  const macBytes = hexToBytes(macHex);
  if (!macBytes) return null;
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    macBytes,
    new TextEncoder().encode(payloadB64Url),
  );
  if (!ok) return null;

  let payload: SessionData;
  try {
    const raw = base64UrlDecode(payloadB64Url);
    payload = JSON.parse(new TextDecoder().decode(raw)) as SessionData;
  } catch {
    return null;
  }
  if (
    payload.sub !== 'admin' ||
    typeof payload.credentialId !== 'string' ||
    typeof payload.issuedAt !== 'number'
  ) {
    return null;
  }
  if (now - payload.issuedAt > MAX_AGE_SECONDS) return null;
  if (payload.issuedAt > now + 60) return null; // future-dated → tamper

  return payload;
}

/** Set-Cookie value for a signed token. Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=24h. */
export function sessionCookieHeader(token: string): string {
  return [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'Secure',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${MAX_AGE_SECONDS}`,
  ].join('; ');
}

/** Set-Cookie value that clears the session cookie. */
export function clearSessionCookieHeader(): string {
  return [
    `${COOKIE_NAME}=`,
    'Path=/',
    'Secure',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
  ].join('; ');
}

/** Reads the session cookie value from a request. null if absent. */
export function readSessionCookie(request: Request): string | undefined {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(';')) {
    const trimmed = pair.trim();
    if (trimmed.startsWith(`${COOKIE_NAME}=`)) {
      return trimmed.slice(COOKIE_NAME.length + 1);
    }
  }
  return undefined;
}

async function importHmacKey(b64: string): Promise<CryptoKey> {
  const raw = base64Decode(b64);
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

// ─── base64 helpers ─────────────────────────────────────────────────────

function base64Encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return base64Decode(padded);
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}
