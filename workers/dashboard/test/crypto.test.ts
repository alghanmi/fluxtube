import { describe, expect, it } from 'vitest';
import {
  decrypt,
  encrypt,
  generateKeyBase64,
  parseKeychain,
  type Keychain,
} from '../src/crypto';

// Test fixtures: two known 32-byte keys (bytes 0..31 and 32..63), base64.
// Deterministic so tests are stable, but real keychains are generated via
// generateKeyBase64().
const KEY_1 = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const KEY_2 = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=';

function keychain(current: number, ...keys: [string, string][]): Keychain {
  return { current, keys: Object.fromEntries(keys) };
}

describe('crypto: encrypt/decrypt roundtrip', () => {
  it('roundtrips a plaintext string via the current key', async () => {
    const kc = keychain(1, ['1', KEY_1]);
    const encrypted = await encrypt('hello world', kc);
    expect(encrypted.kv).toBe(1);
    const back = await decrypt(encrypted, kc);
    expect(back).toBe('hello world');
  });

  it('roundtrips unicode + long strings', async () => {
    const kc = keychain(1, ['1', KEY_1]);
    const plaintext = '𝕗𝕝𝕦𝕩𝕥𝕦𝕓𝕖 · '.repeat(64);
    const back = await decrypt(await encrypt(plaintext, kc), kc);
    expect(back).toBe(plaintext);
  });

  it('IV is fresh per call — same plaintext encrypts to different ciphertexts', async () => {
    const kc = keychain(1, ['1', KEY_1]);
    const a = await encrypt('same', kc);
    const b = await encrypt('same', kc);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    // But both decrypt to the same plaintext.
    expect(await decrypt(a, kc)).toBe('same');
    expect(await decrypt(b, kc)).toBe('same');
  });
});

describe('crypto: multi-key-version decryption', () => {
  it('encrypts under current, decrypts old rows under their kv', async () => {
    // Simulate a rotation:
    //   1. Started with key v1. Wrote a row.
    //   2. Rotated: added v2, bumped current.
    //   3. New writes use v2; the v1 row still decrypts under v1.
    const kcOld = keychain(1, ['1', KEY_1]);
    const oldRow = await encrypt('written before rotation', kcOld);
    expect(oldRow.kv).toBe(1);

    const kcRotated = keychain(2, ['1', KEY_1], ['2', KEY_2]);
    // New writes use v2.
    const newRow = await encrypt('written after rotation', kcRotated);
    expect(newRow.kv).toBe(2);
    // Old v1 row still decrypts under the rotated keychain.
    expect(await decrypt(oldRow, kcRotated)).toBe('written before rotation');
    // And the new v2 row too.
    expect(await decrypt(newRow, kcRotated)).toBe('written after rotation');
  });

  it('decrypt throws when the kv is not in the keychain', async () => {
    const kc = keychain(1, ['1', KEY_1]);
    const encrypted = await encrypt('secret', kc);

    const rotatedOut = keychain(2, ['2', KEY_2]); // v1 dropped
    await expect(decrypt(encrypted, rotatedOut)).rejects.toThrow(/key version 1 not present/);
  });

  it('decrypt throws on tampered ciphertext (GCM auth tag catches it)', async () => {
    const kc = keychain(1, ['1', KEY_1]);
    const encrypted = await encrypt('secret', kc);
    // Flip a byte in ct.
    const tampered = {
      ...encrypted,
      ct: encrypted.ct.slice(0, -4) + (encrypted.ct.endsWith('A') ? 'B' : 'A') + encrypted.ct.slice(-3),
    };
    await expect(decrypt(tampered, kc)).rejects.toThrow();
  });
});

describe('parseKeychain', () => {
  it('parses a valid keychain', () => {
    const src = JSON.stringify({ current: 1, keys: { '1': KEY_1 } });
    const kc = parseKeychain(src);
    expect(kc.current).toBe(1);
    expect(kc.keys['1']).toBe(KEY_1);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseKeychain('{ not json')).toThrow(/not valid JSON/);
  });

  it('rejects missing current', () => {
    expect(() => parseKeychain(JSON.stringify({ keys: { '1': KEY_1 } }))).toThrow(/current/);
  });

  it('rejects non-integer current', () => {
    expect(() =>
      parseKeychain(JSON.stringify({ current: 1.5, keys: { '1': KEY_1 } })),
    ).toThrow(/integer/);
  });

  it('rejects when current version is not in the keys map', () => {
    expect(() =>
      parseKeychain(JSON.stringify({ current: 2, keys: { '1': KEY_1 } })),
    ).toThrow(/current version 2 not present/);
  });

  it('rejects non-integer key names', () => {
    expect(() =>
      parseKeychain(JSON.stringify({ current: 1, keys: { latest: KEY_1 } })),
    ).toThrow(/non-integer key version/);
  });

  it('rejects wrong-length keys', () => {
    const shortKey = 'AAAA'; // 3 bytes decoded
    expect(() =>
      parseKeychain(JSON.stringify({ current: 1, keys: { '1': shortKey } })),
    ).toThrow(/3 bytes, need 32/);
  });
});

describe('generateKeyBase64', () => {
  it('produces a fresh 256-bit key each call', async () => {
    const a = await generateKeyBase64();
    const b = await generateKeyBase64();
    expect(a).not.toBe(b);
    // 32 bytes base64-encoded = 44 chars with padding.
    expect(a).toHaveLength(44);
    // Round-trip through parseKeychain to prove length is correct.
    parseKeychain(JSON.stringify({ current: 1, keys: { '1': a } }));
  });
});
