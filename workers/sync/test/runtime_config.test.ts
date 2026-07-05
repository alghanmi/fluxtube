import { env as testEnv } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { encrypt, type Keychain } from '../src/crypto';
import { AdminPasskeyRepo } from '../src/repos/admin_passkey';
import { ConfigRepo } from '../src/repos/config';
import { MinifluxInstancesRepo } from '../src/repos/miniflux_instances';
import { loadRuntimeConfig } from '../src/runtime_config';
import type { Env } from '../src/types';
import { resetV1Schema } from './testdb';

const db = (testEnv as unknown as { DB: D1Database }).DB;

// 32-byte deterministic key for tests.
const KEY_1 = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const KEYCHAIN: Keychain = { current: 1, keys: { '1': KEY_1 } };
const KEYCHAIN_JSON = JSON.stringify(KEYCHAIN);

// A minimal env fixture. Every test overrides what it cares about.
function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    MINIFLUX_URL: 'https://miniflux.env.example',
    MINIFLUX_API_TOKEN: 'env-miniflux-token',
    CATEGORY_PLAYLIST_MAPPING: '[{"category":"env-cat","playlist_id":"PL_env"}]',
    YOUTUBE_CLIENT_ID: 'yt-cid',
    YOUTUBE_CLIENT_SECRET: 'yt-cs',
    YOUTUBE_REFRESH_TOKEN: 'env-yt-refresh',
    MANUAL_TRIGGER_TOKEN: 'trigger',
    SYNC_LOG_LEVEL: 'debug',
    ...overrides,
  };
}

// Seed helpers for D1-mode fixtures.
async function seedPasskey(): Promise<void> {
  await new AdminPasskeyRepo(db).insert({
    credentialId: 'cred-test',
    publicKey: 'pk-test',
    signCount: 0,
    transports: null,
    recoveryHash: 'hash-test',
    createdAt: 1700000000,
  });
}

async function seedMinifluxInstance(url: string, plaintextToken: string): Promise<number> {
  const enc = await encrypt(plaintextToken, KEYCHAIN);
  return new MinifluxInstancesRepo(db).insert({
    displayName: url,
    url,
    apiTokenCt: enc.ct,
    apiTokenIv: enc.iv,
    apiTokenKv: enc.kv,
    createdAt: 1700000000,
    updatedAt: 1700000000,
  });
}

async function seedYouTubeRefreshToken(plaintextToken: string): Promise<void> {
  const enc = await encrypt(plaintextToken, KEYCHAIN);
  await new ConfigRepo(db).setEncrypted(
    'youtube_refresh_token',
    enc.ct,
    enc.iv,
    enc.kv,
    1700000000,
  );
}

beforeEach(async () => {
  await resetV1Schema(db);
});

describe('loadRuntimeConfig — env-mode (admin_passkey empty)', () => {
  it('returns env-derived config when admin_passkey table is empty', async () => {
    const rt = await loadRuntimeConfig(baseEnv());
    expect(rt.mode).toBe('env');
    expect(rt.minifluxUrl).toBe('https://miniflux.env.example');
    expect(rt.minifluxApiToken).toBe('env-miniflux-token');
    expect(rt.youtubeRefreshToken).toBe('env-yt-refresh');
    expect(rt.syncLogLevel).toBe('debug');
    expect(rt.mappings).toEqual([{ category: 'env-cat', playlistId: 'PL_env' }]);
  });

  it('does NOT read D1_KEYCHAIN in env-mode (works without it)', async () => {
    const rt = await loadRuntimeConfig(baseEnv({ D1_KEYCHAIN: undefined }));
    expect(rt.mode).toBe('env');
    expect(rt.minifluxUrl).toBe('https://miniflux.env.example');
  });

  it('propagates parseCategoryPlaylistMapping errors', async () => {
    await expect(
      loadRuntimeConfig(baseEnv({ CATEGORY_PLAYLIST_MAPPING: 'not-json' })),
    ).rejects.toThrow(/not valid JSON/);
  });
});

describe('loadRuntimeConfig — D1-mode (admin_passkey populated) — THE fallback safety proof', () => {
  it('IGNORES env vars entirely when admin_passkey has any row', async () => {
    await seedPasskey();
    await seedMinifluxInstance('https://miniflux.d1.example', 'd1-miniflux-token');
    await seedYouTubeRefreshToken('d1-yt-refresh');
    // Deliberately populate env with wrong values — they must NOT bleed through.
    const rt = await loadRuntimeConfig(
      baseEnv({
        MINIFLUX_URL: 'https://SHOULD-BE-IGNORED.example',
        MINIFLUX_API_TOKEN: 'SHOULD-BE-IGNORED',
        YOUTUBE_REFRESH_TOKEN: 'SHOULD-BE-IGNORED',
        CATEGORY_PLAYLIST_MAPPING: '[{"category":"SHOULD-BE-IGNORED","playlist_id":"PL_x"}]',
        D1_KEYCHAIN: KEYCHAIN_JSON,
      }),
    );
    expect(rt.mode).toBe('d1');
    expect(rt.minifluxUrl).toBe('https://miniflux.d1.example');
    expect(rt.minifluxApiToken).toBe('d1-miniflux-token');
    expect(rt.youtubeRefreshToken).toBe('d1-yt-refresh');
    expect(rt.mappings).toEqual([]); // no mappings seeded yet
  });

  it('reads sync_log_level from config table (plain) — overrides env.SYNC_LOG_LEVEL', async () => {
    await seedPasskey();
    await seedMinifluxInstance('https://a.example', 'tok');
    await seedYouTubeRefreshToken('rt');
    await new ConfigRepo(db).setPlain('sync_log_level', 'warn', 1700000000);

    const rt = await loadRuntimeConfig(
      baseEnv({ SYNC_LOG_LEVEL: 'debug', D1_KEYCHAIN: KEYCHAIN_JSON }),
    );
    expect(rt.syncLogLevel).toBe('warn');
  });

  it('sync_log_level absent in D1 → undefined (parseLogLevel will default upstream)', async () => {
    await seedPasskey();
    await seedMinifluxInstance('https://a.example', 'tok');
    await seedYouTubeRefreshToken('rt');
    const rt = await loadRuntimeConfig(baseEnv({ D1_KEYCHAIN: KEYCHAIN_JSON }));
    expect(rt.syncLogLevel).toBeUndefined();
  });

  it('reads mappings scoped to the single miniflux_instance', async () => {
    await seedPasskey();
    const instanceId = await seedMinifluxInstance('https://a.example', 'tok');
    await seedYouTubeRefreshToken('rt');
    await db
      .prepare(
        `INSERT INTO mappings (miniflux_instance_id, miniflux_category, youtube_playlist_id, skip_shorts, created_at, updated_at)
         VALUES (?, 'tech', 'PL_tech', 1, 1, 1),
                (?, 'music', 'PL_music', 0, 2, 2)`,
      )
      .bind(instanceId, instanceId)
      .run();

    const rt = await loadRuntimeConfig(baseEnv({ D1_KEYCHAIN: KEYCHAIN_JSON }));
    expect(rt.mappings).toEqual([
      { category: 'tech', playlistId: 'PL_tech', skipShorts: true },
      { category: 'music', playlistId: 'PL_music' },
    ]);
  });

  it('throws when D1_KEYCHAIN is missing', async () => {
    await seedPasskey();
    await seedMinifluxInstance('https://a.example', 'tok');
    await seedYouTubeRefreshToken('rt');

    await expect(
      loadRuntimeConfig(baseEnv({ D1_KEYCHAIN: undefined })),
    ).rejects.toThrow(/D1_KEYCHAIN is required/);
  });

  it('throws when D1_KEYCHAIN is malformed', async () => {
    await seedPasskey();
    // Instance not seeded — but keychain error fires first.
    await expect(
      loadRuntimeConfig(baseEnv({ D1_KEYCHAIN: 'not-json' })),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('throws when no miniflux_instances rows exist', async () => {
    await seedPasskey();
    await expect(
      loadRuntimeConfig(baseEnv({ D1_KEYCHAIN: KEYCHAIN_JSON })),
    ).rejects.toThrow(/no miniflux_instances row/);
  });

  it('throws (Phase 3.5 pending) when multiple miniflux_instances rows exist', async () => {
    await seedPasskey();
    await seedMinifluxInstance('https://a.example', 'tok-a');
    await seedMinifluxInstance('https://b.example', 'tok-b');
    await seedYouTubeRefreshToken('rt');

    await expect(
      loadRuntimeConfig(baseEnv({ D1_KEYCHAIN: KEYCHAIN_JSON })),
    ).rejects.toThrow(/multi-instance sync not yet implemented/);
  });

  it('throws when config.youtube_refresh_token is not set', async () => {
    await seedPasskey();
    await seedMinifluxInstance('https://a.example', 'tok');

    await expect(
      loadRuntimeConfig(baseEnv({ D1_KEYCHAIN: KEYCHAIN_JSON })),
    ).rejects.toThrow(/youtube_refresh_token is not set/);
  });
});
