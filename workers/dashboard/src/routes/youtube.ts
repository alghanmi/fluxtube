// YouTube integration routes.
//
//   GET /api/auth/youtube            → 302 to Google's consent screen
//   GET /api/auth/youtube/callback   → exchanges the code, encrypts +
//                                      persists the refresh_token in
//                                      config.youtube_refresh_token
//   GET /api/youtube/playlists       → live-fetch the user's owned
//                                      playlists via the stored token
//
// The OAuth begin flow mints a signed `state` parameter (HMAC over
// {issuedAt}) so the callback can verify the round-trip came from a
// request we initiated. Client_id/secret come from wrangler secrets,
// injected by Terraform in Phase 7. The redirect URI is composed from
// `env.RP_ID` — the private dashboard domain is never hardcoded here.
//
// The callback is auth-gated. Google redirects the browser back to us
// carrying the same-origin session cookie, so a legitimate operator's
// callback succeeds; anyone else hitting the URL without a session
// gets 401 before the code is spent.

import type { Hono } from 'hono';
import { requireAuth } from '../auth/require_auth';
import type { DashboardAuthEnv } from '../auth/require_auth';
import { encrypt, decrypt, parseKeychain } from '../crypto';
import type { Keychain } from '../crypto';
import { ConfigRepo } from '../repos/config';

export interface YouTubeEnv extends DashboardAuthEnv {
  DB: D1Database;
  D1_KEYCHAIN?: string;
  RP_ID?: string;
  YOUTUBE_CLIENT_ID?: string;
  YOUTUBE_CLIENT_SECRET?: string;
}

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const PLAYLISTS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/playlists';
const SCOPE = 'https://www.googleapis.com/auth/youtube';
const STATE_MAX_AGE_SEC = 10 * 60;
const FETCH_TIMEOUT_MS = 10_000;

export function attachYouTubeRoutes(app: Hono<{ Bindings: YouTubeEnv }>): void {
  // ─── OAuth begin ───────────────────────────────────────────────────

  app.get('/api/auth/youtube', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    const cfg = requireOAuthConfig(c.env);
    if (!cfg.ok) return c.json({ error: cfg.error }, 500);

    const state = await signState(cfg.signingKey);
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return c.redirect(`${AUTH_ENDPOINT}?${params.toString()}`, 302);
  });

  // ─── OAuth callback ────────────────────────────────────────────────

  app.get('/api/auth/youtube/callback', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    const cfg = requireOAuthConfig(c.env);
    if (!cfg.ok) return c.json({ error: cfg.error }, 500);

    const url = new URL(c.req.raw.url);
    const errorParam = url.searchParams.get('error');
    if (errorParam) return c.json({ error: 'oauth_error', message: errorParam }, 400);

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return c.json({ error: 'missing_code_or_state' }, 400);

    const stateOk = await verifyState(state, cfg.signingKey);
    if (!stateOk) return c.json({ error: 'invalid_state' }, 400);

    const kc = loadKeychain(c.env);
    if (!kc.ok) return c.json({ error: kc.error }, 500);

    const tokens = await exchangeCode(code, cfg);
    if (!tokens.ok) {
      return c.json({ error: 'token_exchange_failed', message: tokens.message }, 502);
    }
    if (!tokens.refreshToken) {
      // Google omits refresh_token when the user already granted this
      // scope + prompt=none. We always send prompt=consent above; if
      // it's still missing, something's off with the client config.
      return c.json({ error: 'no_refresh_token_returned' }, 502);
    }

    const encrypted = await encrypt(tokens.refreshToken, kc.keychain);
    await new ConfigRepo(c.env.DB).setEncrypted(
      'youtube_refresh_token',
      encrypted.ct,
      encrypted.iv,
      encrypted.kv,
      nowSec(),
    );

    return c.json({ ok: true, connected: true });
  });

  // ─── List playlists ────────────────────────────────────────────────

  app.get('/api/youtube/playlists', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    const cfg = requireOAuthConfig(c.env);
    if (!cfg.ok) return c.json({ error: cfg.error }, 500);

    const kc = loadKeychain(c.env);
    if (!kc.ok) return c.json({ error: kc.error }, 500);

    const stored = await new ConfigRepo(c.env.DB).getEncrypted('youtube_refresh_token');
    if (!stored) return c.json({ error: 'not_connected' }, 409);

    let refreshToken: string;
    try {
      refreshToken = await decrypt(
        { ct: stored.ct, iv: stored.iv, kv: stored.kv },
        kc.keychain,
      );
    } catch (err) {
      return c.json(
        {
          error: 'decrypt_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }

    const access = await mintAccessToken(refreshToken, cfg);
    if (!access.ok) {
      return c.json({ error: 'access_token_failed', message: access.message }, 502);
    }

    const playlists = await listOwnedPlaylists(access.accessToken);
    if (!playlists.ok) {
      return c.json({ error: 'playlists_fetch_failed', message: playlists.message }, 502);
    }
    return c.json({ playlists: playlists.items });
  });
}

// ─── OAuth config + keychain helpers ────────────────────────────────────

interface OAuthConfigOk {
  ok: true;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  signingKey: string;
}
interface OAuthConfigErr {
  ok: false;
  error: string;
}

function requireOAuthConfig(env: YouTubeEnv): OAuthConfigOk | OAuthConfigErr {
  if (!env.YOUTUBE_CLIENT_ID) return { ok: false, error: 'youtube_client_id_not_configured' };
  if (!env.YOUTUBE_CLIENT_SECRET) {
    return { ok: false, error: 'youtube_client_secret_not_configured' };
  }
  if (!env.SESSION_SIGNING_KEY) return { ok: false, error: 'session_signing_key_not_configured' };
  if (!env.RP_ID) return { ok: false, error: 'rp_id_not_configured' };
  return {
    ok: true,
    clientId: env.YOUTUBE_CLIENT_ID,
    clientSecret: env.YOUTUBE_CLIENT_SECRET,
    redirectUri: `https://${env.RP_ID}/api/auth/youtube/callback`,
    signingKey: env.SESSION_SIGNING_KEY,
  };
}

type KeychainResult =
  | { ok: true; keychain: Keychain }
  | { ok: false; error: string };

function loadKeychain(env: YouTubeEnv): KeychainResult {
  if (!env.D1_KEYCHAIN) return { ok: false, error: 'keychain_not_configured' };
  try {
    return { ok: true, keychain: parseKeychain(env.D1_KEYCHAIN) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? `keychain_invalid: ${err.message}` : 'keychain_invalid',
    };
  }
}

// ─── Signed state parameter ─────────────────────────────────────────────

async function signState(hmacKeyB64: string): Promise<string> {
  const payload = { iat: nowSec() };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(payloadJson));
  const key = await importHmacKey(hmacKeyB64);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${bytesToHex(new Uint8Array(mac))}`;
}

async function verifyState(token: string, hmacKeyB64: string): Promise<boolean> {
  const dot = token.indexOf('.');
  if (dot < 1 || dot === token.length - 1) return false;
  const payloadB64 = token.slice(0, dot);
  const macHex = token.slice(dot + 1);
  const macBytes = hexToBytes(macHex);
  if (!macBytes) return false;

  const key = await importHmacKey(hmacKeyB64);
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    macBytes,
    new TextEncoder().encode(payloadB64),
  );
  if (!ok) return false;

  let payload: { iat?: unknown };
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as {
      iat?: unknown;
    };
  } catch {
    return false;
  }
  if (typeof payload.iat !== 'number') return false;
  const now = nowSec();
  if (now - payload.iat > STATE_MAX_AGE_SEC) return false;
  if (payload.iat > now + 60) return false;
  return true;
}

// ─── Upstream YouTube calls ─────────────────────────────────────────────

type ExchangeResult =
  | { ok: true; refreshToken: string | null; accessToken: string }
  | { ok: false; message: string };

async function exchangeCode(code: string, cfg: OAuthConfigOk): Promise<ExchangeResult> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
  });
  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: `non-json: ${text.slice(0, 200)}` };
  }
  if (!res.ok) {
    const p = parsed as { error?: unknown; error_description?: unknown };
    return {
      ok: false,
      message: `${res.status}: ${String(p.error ?? 'unknown')} — ${String(p.error_description ?? '')}`,
    };
  }
  const p = parsed as { refresh_token?: unknown; access_token?: unknown };
  if (typeof p.access_token !== 'string') {
    return { ok: false, message: 'no_access_token_in_response' };
  }
  return {
    ok: true,
    accessToken: p.access_token,
    refreshToken: typeof p.refresh_token === 'string' ? p.refresh_token : null,
  };
}

type AccessResult = { ok: true; accessToken: string } | { ok: false; message: string };

async function mintAccessToken(refreshToken: string, cfg: OAuthConfigOk): Promise<AccessResult> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: `non-json: ${text.slice(0, 200)}` };
  }
  if (!res.ok) {
    const p = parsed as { error?: unknown };
    return { ok: false, message: `${res.status}: ${String(p.error ?? 'unknown')}` };
  }
  const p = parsed as { access_token?: unknown };
  if (typeof p.access_token !== 'string') {
    return { ok: false, message: 'no_access_token_in_response' };
  }
  return { ok: true, accessToken: p.access_token };
}

interface PlaylistDto {
  id: string;
  title: string;
  itemCount: number;
}

type PlaylistsResult =
  | { ok: true; items: PlaylistDto[] }
  | { ok: false; message: string };

async function listOwnedPlaylists(accessToken: string): Promise<PlaylistsResult> {
  const items: PlaylistDto[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails',
      mine: 'true',
      maxResults: '50',
    });
    if (pageToken) params.set('pageToken', pageToken);
    let res: Response;
    try {
      res = await fetch(`${PLAYLISTS_ENDPOINT}?${params.toString()}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    if (!res.ok) {
      const bodyPreview = await safeText(res);
      return { ok: false, message: `${res.status}: ${bodyPreview.slice(0, 200)}` };
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return { ok: false, message: 'response_not_json' };
    }
    if (typeof data !== 'object' || data === null) {
      return { ok: false, message: 'response_not_object' };
    }
    const d = data as { items?: unknown; nextPageToken?: unknown };
    if (!Array.isArray(d.items)) {
      return { ok: false, message: 'response_items_not_array' };
    }
    for (const entry of d.items) {
      const dto = toPlaylistDto(entry);
      if (dto) items.push(dto);
    }
    if (typeof d.nextPageToken === 'string' && d.nextPageToken.length > 0) {
      pageToken = d.nextPageToken;
    } else {
      break;
    }
  }
  return { ok: true, items };
}

function toPlaylistDto(entry: unknown): PlaylistDto | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const e = entry as {
    id?: unknown;
    snippet?: { title?: unknown };
    contentDetails?: { itemCount?: unknown };
  };
  if (typeof e.id !== 'string') return null;
  const title = typeof e.snippet?.title === 'string' ? e.snippet.title : '';
  const itemCount =
    typeof e.contentDetails?.itemCount === 'number' ? e.contentDetails.itemCount : 0;
  return { id: e.id, title, itemCount };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

// ─── Base helpers ──────────────────────────────────────────────────────

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

async function importHmacKey(b64: string): Promise<CryptoKey> {
  const bin = atob(b64);
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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
