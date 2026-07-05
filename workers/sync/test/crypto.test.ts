// Smoke test proving workers/sync's copy of crypto.ts still compiles + works.
// The exhaustive tests live alongside the canonical copy in
// workers/dashboard/test/crypto.test.ts. This file exists solely to catch
// drift between the two byte-identical copies during CI — if the sync copy
// falls behind or breaks, this test fails before Phase 3's dual-mode loader
// silently starts writing rows the dashboard can't decrypt.

import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, type Keychain } from '../src/crypto';

const KEY_1 = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

describe('crypto (sync worker copy)', () => {
  it('encrypt → decrypt roundtrip works', async () => {
    const kc: Keychain = { current: 1, keys: { '1': KEY_1 } };
    const encrypted = await encrypt('the sync worker also decrypts', kc);
    expect(await decrypt(encrypted, kc)).toBe('the sync worker also decrypts');
  });
});
