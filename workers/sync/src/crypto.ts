// AES-GCM encryption at rest for sensitive D1 columns.
//
// Sensitive scalars (YouTube refresh token, Miniflux API tokens) live in D1
// as a triple: (ct, iv, kv). Each field:
//   ct = base64 ciphertext (includes GCM auth tag)
//   iv = base64 12-byte random IV, fresh per write
//   kv = integer key version — which entry of the keychain was used
//
// The Worker reads the `D1_KEYCHAIN` secret at each request — a JSON object
// with the shape:
//
//   { "current": 2, "keys": { "1": "<base64 32-byte key>", "2": "<...>" } }
//
// New writes use `current`. Reads decrypt with whichever key version was
// used at write time. Rotation adds a new entry, bumps `current`, redeploys,
// and the dashboard's POST /api/config/rotate-keys walks every encrypted row
// re-encrypting under the new current.
//
// Old key versions stay in the keychain until the operator confirms every
// row has been rewritten (see docs/encryption-keychain.md — added in Phase 8).
//
// This file lives in TWO worker workspaces byte-identical:
//   * workers/dashboard/src/crypto.ts (canonical — where encryption happens)
//   * workers/sync/src/crypto.ts     (mirror — sync only decrypts)
// Keep them in sync when you edit either.

const AES_GCM = 'AES-GCM';
const KEY_LENGTH_BITS = 256;
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;

export interface Keychain {
  /** Version to use for new writes. */
  current: number;
  /** Version (as decimal string) → base64-encoded 32-byte key. */
  keys: Record<string, string>;
}

export interface EncryptedValue {
  ct: string;
  iv: string;
  kv: number;
}

/**
 * Parses + validates the JSON keychain string. Throws on any structural
 * problem so a misconfigured Worker fails at boot rather than lazily on
 * the first encrypt/decrypt call.
 */
export function parseKeychain(source: string): Keychain {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (err) {
    throw new Error(
      `D1_KEYCHAIN: not valid JSON — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (raw === null || typeof raw !== 'object') {
    throw new Error('D1_KEYCHAIN: expected an object, got ' + typeof raw);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.current !== 'number' || !Number.isInteger(obj.current)) {
    throw new Error('D1_KEYCHAIN: `current` must be an integer key version');
  }
  if (!obj.keys || typeof obj.keys !== 'object') {
    throw new Error('D1_KEYCHAIN: `keys` must be an object of version → base64-key');
  }
  const kc: Keychain = { current: obj.current, keys: obj.keys as Record<string, string> };

  // Validate every key entry first (integer name + correct length) so the
  // most specific errors fire before the "current not present" fallback.
  for (const [ver, b64] of Object.entries(kc.keys)) {
    if (!/^\d+$/.test(ver)) {
      throw new Error(`D1_KEYCHAIN: non-integer key version "${ver}"`);
    }
    if (typeof b64 !== 'string') {
      throw new Error(`D1_KEYCHAIN: key version ${ver} value must be a string`);
    }
    let bytes: Uint8Array;
    try {
      bytes = base64Decode(b64);
    } catch (err) {
      throw new Error(
        `D1_KEYCHAIN: key version ${ver} not valid base64 — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (bytes.byteLength !== KEY_LENGTH_BYTES) {
      throw new Error(
        `D1_KEYCHAIN: key version ${ver} is ${bytes.byteLength} bytes, need ${KEY_LENGTH_BYTES}`,
      );
    }
  }
  if (!(String(kc.current) in kc.keys)) {
    throw new Error(`D1_KEYCHAIN: current version ${kc.current} not present in keys`);
  }
  return kc;
}

/** Encrypt under the keychain's `current` key. Fresh IV per call. */
export async function encrypt(plaintext: string, keychain: Keychain): Promise<EncryptedValue> {
  const kv = keychain.current;
  const key = await importKey(keychain.keys[String(kv)]!, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const ptBytes = new TextEncoder().encode(plaintext);
  const ctBytes = await crypto.subtle.encrypt({ name: AES_GCM, iv }, key, ptBytes);
  return {
    ct: base64Encode(new Uint8Array(ctBytes)),
    iv: base64Encode(iv),
    kv,
  };
}

/**
 * Decrypt under whichever key version was used at write time (`value.kv`).
 * Throws if that version isn't in the keychain — the operator needs to add
 * it back for the duration of a rotation cycle.
 */
export async function decrypt(value: EncryptedValue, keychain: Keychain): Promise<string> {
  const b64Key = keychain.keys[String(value.kv)];
  if (!b64Key) {
    throw new Error(
      `decrypt: key version ${value.kv} not present in keychain — add it back to D1_KEYCHAIN for read-only decryption during rotation`,
    );
  }
  const key = await importKey(b64Key, ['decrypt']);
  const iv = base64Decode(value.iv);
  const ct = base64Decode(value.ct);
  const ptBytes = await crypto.subtle.decrypt({ name: AES_GCM, iv }, key, ct);
  return new TextDecoder().decode(ptBytes);
}

/**
 * Generate a fresh 256-bit key, base64-encoded. Used by operators bootstrapping
 * a new keychain (see docs/encryption-keychain.md).
 */
export async function generateKeyBase64(): Promise<string> {
  // AES generateKey returns a single CryptoKey (not a pair) but the union
  // return type needs a cast. Cast + exportKey with format='raw' → ArrayBuffer.
  const key = (await crypto.subtle.generateKey(
    { name: AES_GCM, length: KEY_LENGTH_BITS },
    true,
    ['encrypt', 'decrypt'],
  )) as CryptoKey;
  const raw = (await crypto.subtle.exportKey('raw', key)) as ArrayBuffer;
  return base64Encode(new Uint8Array(raw));
}

async function importKey(
  b64: string,
  usages: ReadonlyArray<'encrypt' | 'decrypt'>,
): Promise<CryptoKey> {
  const raw = base64Decode(b64);
  // Cast the ReadonlyArray to a mutable array — importKey doesn't mutate but
  // the type signature isn't readonly. Using the string literal union avoids
  // needing the KeyUsage type name (varies by lib config).
  return crypto.subtle.importKey('raw', raw, AES_GCM, false, [...usages]);
}

// base64 helpers — atob/btoa work on latin1 code points. Web Crypto emits
// arbitrary bytes; loop-encoding via String.fromCharCode is fine at the
// sizes involved (< 1 KiB per value).
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
