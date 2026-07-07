import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BackupSchema,
  fetchBackupBody,
  generateBackup,
  listBackups,
  objectKey,
  restoreBackup,
} from '../src/backup';
import type { BackupEnv } from '../src/backup';
import { ConfigRepo } from '../src/repos/config';
import { MappingHistoryRepo } from '../src/repos/mapping_history';
import { MappingsRepo } from '../src/repos/mappings';
import { MinifluxInstancesRepo } from '../src/repos/miniflux_instances';
import { resetV1Schema } from './support/schema';

const db = (env as unknown as { DB: D1Database }).DB;

// ─── In-memory R2 bucket stub ───────────────────────────────────────────

interface R2Object {
  key: string;
  body: string;
  uploaded: Date;
  size: number;
}

function stubBucket(seed: R2Object[] = []): { bucket: R2Bucket; store: Map<string, R2Object> } {
  const store = new Map<string, R2Object>();
  for (const s of seed) store.set(s.key, s);

  const bucket = {
    put: async (key: string, body: string): Promise<void> => {
      store.set(key, { key, body, uploaded: new Date(), size: body.length });
    },
    get: async (key: string) => {
      const obj = store.get(key);
      if (!obj) return null;
      return { text: async (): Promise<string> => obj.body };
    },
    list: async (opts?: { prefix?: string; cursor?: string; limit?: number }) => {
      const prefix = opts?.prefix ?? '';
      const all = Array.from(store.values())
        .filter((o) => o.key.startsWith(prefix))
        .map((o) => ({ key: o.key, uploaded: o.uploaded, size: o.size }));
      return {
        objects: all.slice(0, opts?.limit ?? 1000),
        truncated: false,
        cursor: undefined,
      };
    },
  } as unknown as R2Bucket;
  return { bucket, store };
}

async function seed(): Promise<{ instanceIdA: number; instanceIdB: number }> {
  const instancesRepo = new MinifluxInstancesRepo(db);
  const mappingsRepo = new MappingsRepo(db);
  const idA = await instancesRepo.insert({
    displayName: 'Home',
    url: 'https://home.example',
    apiTokenCt: 'ct',
    apiTokenIv: 'iv',
    apiTokenKv: 1,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  });
  const idB = await instancesRepo.insert({
    displayName: 'Work',
    url: 'https://work.example',
    apiTokenCt: 'ct',
    apiTokenIv: 'iv',
    apiTokenKv: 1,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  });
  await mappingsRepo.insert({
    minifluxInstanceId: idA,
    minifluxCategory: 'Videos',
    youtubePlaylistId: 'PL-a',
    skipShorts: true,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  });
  await mappingsRepo.insert({
    minifluxInstanceId: idB,
    minifluxCategory: 'Talks',
    youtubePlaylistId: 'PL-b',
    skipShorts: false,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  });
  await new ConfigRepo(db).setPlain('sync_log_level', 'info', 1_700_000_000);
  await new ConfigRepo(db).setPlain('history_window', '10', 1_700_000_000);
  return { instanceIdA: idA, instanceIdB: idB };
}

beforeEach(async () => {
  await resetV1Schema(db);
});

describe('objectKey', () => {
  it('produces the fluxtube-state_ prefix + UTC timestamp shape', () => {
    const key = objectKey(new Date('2026-07-06T04:15:30.123Z'));
    expect(key).toBe('fluxtube-state_2026-07-06_04-15-30.json');
  });
});

describe('BackupSchema', () => {
  it('rejects a payload missing required fields', () => {
    const parsed = BackupSchema.safeParse({ schema_version: 1 });
    expect(parsed.success).toBe(false);
  });
  it('accepts a valid minimal payload', () => {
    const parsed = BackupSchema.safeParse({
      schema_version: 1,
      exported_at: '2026-07-06T04:15:30.000Z',
      instance_id: 'alghanmi',
      miniflux_instances: [],
      mappings: [],
      mapping_history: [],
      config: { sync_log_level: 'info', history_window: 10 },
    });
    expect(parsed.success).toBe(true);
  });
});

describe('generateBackup', () => {
  it('throws when BACKUPS binding is missing', async () => {
    await expect(
      generateBackup({ DB: db, INSTANCE_ID: 'x' } as BackupEnv),
    ).rejects.toThrow(/BACKUPS_binding/);
  });

  it('throws when INSTANCE_ID is missing', async () => {
    const { bucket } = stubBucket();
    await expect(
      generateBackup({ DB: db, BACKUPS: bucket } as BackupEnv),
    ).rejects.toThrow(/INSTANCE_ID/);
  });

  it('writes a valid, self-consistent payload to R2', async () => {
    await seed();
    const { bucket, store } = stubBucket();
    const bucketEnv: BackupEnv = { DB: db, BACKUPS: bucket, INSTANCE_ID: 'test-instance' };
    const result = await generateBackup(bucketEnv, new Date('2026-07-06T04:15:00.000Z'));

    expect(result.key).toBe('fluxtube-state_2026-07-06_04-15-00.json');
    expect(result.sizeBytes).toBeGreaterThan(50);
    expect(result.exportedAt).toBe('2026-07-06T04:15:00.000Z');

    const stored = store.get(result.key);
    if (!stored) throw new Error('R2 object missing');
    const parsed = BackupSchema.safeParse(JSON.parse(stored.body));
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(parsed.error.message);

    expect(parsed.data.instance_id).toBe('test-instance');
    expect(parsed.data.miniflux_instances).toHaveLength(2);
    expect(parsed.data.mappings).toHaveLength(2);
    // Sensitive fields never appear.
    expect(stored.body).not.toContain('ct');
    expect(stored.body).not.toContain('iv');
    expect(stored.body).not.toContain('apiToken');
  });
});

describe('listBackups', () => {
  it('returns objects sorted newest-first', async () => {
    const { bucket } = stubBucket([
      {
        key: 'fluxtube-state_2026-07-01_04-00-00.json',
        body: '{}',
        uploaded: new Date('2026-07-01T04:00:00Z'),
        size: 2,
      },
      {
        key: 'fluxtube-state_2026-07-03_04-00-00.json',
        body: '{}',
        uploaded: new Date('2026-07-03T04:00:00Z'),
        size: 2,
      },
      {
        key: 'fluxtube-state_2026-07-02_04-00-00.json',
        body: '{}',
        uploaded: new Date('2026-07-02T04:00:00Z'),
        size: 2,
      },
    ]);
    const items = await listBackups({ DB: db, BACKUPS: bucket }, 100);
    expect(items.map((i) => i.key)).toEqual([
      'fluxtube-state_2026-07-03_04-00-00.json',
      'fluxtube-state_2026-07-02_04-00-00.json',
      'fluxtube-state_2026-07-01_04-00-00.json',
    ]);
  });
});

describe('fetchBackupBody', () => {
  it('returns null for a missing key', async () => {
    const { bucket } = stubBucket();
    const body = await fetchBackupBody({ DB: db, BACKUPS: bucket }, 'nope.json');
    expect(body).toBeNull();
  });
});

describe('restoreBackup', () => {
  it('rejects with backup_not_found for a missing key', async () => {
    const { bucket } = stubBucket();
    await expect(
      restoreBackup({ DB: db, BACKUPS: bucket }, 'missing.json', 1_700_000_000),
    ).rejects.toThrow(/backup_not_found/);
  });

  it('rejects malformed JSON', async () => {
    const { bucket } = stubBucket([
      {
        key: 'bad.json',
        body: 'not-json',
        uploaded: new Date(),
        size: 8,
      },
    ]);
    await expect(
      restoreBackup({ DB: db, BACKUPS: bucket }, 'bad.json', 1_700_000_000),
    ).rejects.toThrow(/backup_body_not_json/);
  });

  it('rejects a payload that fails schema validation', async () => {
    const { bucket } = stubBucket([
      {
        key: 'bad.json',
        body: JSON.stringify({ schema_version: 1 }),
        uploaded: new Date(),
        size: 100,
      },
    ]);
    await expect(
      restoreBackup({ DB: db, BACKUPS: bucket }, 'bad.json', 1_700_000_000),
    ).rejects.toThrow(/backup_schema_invalid/);
  });

  it('restores instances + mappings + history + config; snapshots pre-restore', async () => {
    // Seed pre-existing state that should be wiped/replaced by restore.
    await seed();

    // Compose a backup payload that describes different content.
    const payload = {
      schema_version: 1 as const,
      exported_at: '2026-07-01T00:00:00.000Z',
      instance_id: 'test-instance',
      miniflux_instances: [
        { display_name: 'Restored', url: 'https://restored.example' },
      ],
      mappings: [
        {
          miniflux_url: 'https://restored.example',
          miniflux_category: 'CategoryX',
          youtube_playlist_id: 'PL-restored',
          skip_shorts: true,
        },
        {
          // References an instance NOT in the backup — should be skipped.
          miniflux_url: 'https://orphan.example',
          miniflux_category: 'Y',
          youtube_playlist_id: 'PL-orphan',
          skip_shorts: false,
        },
      ],
      mapping_history: [
        {
          snapshot_json: JSON.stringify({ old: 'state' }),
          actor: 'ui' as const,
          created_at: 1_699_000_000,
        },
      ],
      config: { sync_log_level: 'warn', history_window: 20 },
    };
    const { bucket } = stubBucket([
      {
        key: 'good.json',
        body: JSON.stringify(payload),
        uploaded: new Date(),
        size: JSON.stringify(payload).length,
      },
    ]);

    const result = await restoreBackup(
      { DB: db, BACKUPS: bucket },
      'good.json',
      1_700_000_500,
    );
    expect(result).toEqual({
      restoredInstances: 1,
      restoredMappings: 1,
      restoredHistory: 1,
      skippedMappings: 1,
    });

    const instances = await new MinifluxInstancesRepo(db).list();
    expect(instances).toHaveLength(1);
    expect(instances[0]?.url).toBe('https://restored.example');
    // API token wiped — needs re-auth via UI.
    expect(instances[0]?.apiTokenCt).toBe('');
    expect(instances[0]?.apiTokenKv).toBe(0);

    const mappings = await new MappingsRepo(db).list();
    expect(mappings).toHaveLength(1);
    expect(mappings[0]?.minifluxCategory).toBe('CategoryX');
    expect(mappings[0]?.skipShorts).toBe(true);

    const history = await new MappingHistoryRepo(db).listLatest(100);
    // The pre-restore snapshot (actor=restore, ts=now) + the payload's
    // historical row (actor=ui, ts=1_699_000_000).
    expect(history.some((h) => h.actor === 'restore' && h.createdAt === 1_700_000_500)).toBe(true);
    expect(history.some((h) => h.actor === 'ui' && h.createdAt === 1_699_000_000)).toBe(true);

    const configRepo = new ConfigRepo(db);
    expect((await configRepo.getPlain('sync_log_level'))?.value).toBe('warn');
    expect((await configRepo.getPlain('history_window'))?.value).toBe('20');
  });
});
