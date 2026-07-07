import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/index';
import { signSession } from '../../src/auth/session';
import { ConfigRepo } from '../../src/repos/config';
import { MappingsRepo } from '../../src/repos/mappings';
import { MinifluxInstancesRepo } from '../../src/repos/miniflux_instances';
import { resetV1Schema } from '../support/schema';

const db = (env as unknown as { DB: D1Database }).DB;

const HMAC_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

type AppEnv = Parameters<typeof app.fetch>[1];

// In-memory R2 stub (kept tiny — separate from backup.test.ts's version so
// each test file is self-contained per the existing route-test pattern).
interface R2Obj {
  key: string;
  body: string;
  uploaded: Date;
  size: number;
}

function stubBucket(seed: R2Obj[] = []): { bucket: R2Bucket; store: Map<string, R2Obj> } {
  const store = new Map<string, R2Obj>();
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
    list: async (opts?: { prefix?: string }) => {
      const prefix = opts?.prefix ?? '';
      const all = Array.from(store.values())
        .filter((o) => o.key.startsWith(prefix))
        .map((o) => ({ key: o.key, uploaded: o.uploaded, size: o.size }));
      return { objects: all, truncated: false, cursor: undefined };
    },
  } as unknown as R2Bucket;
  return { bucket, store };
}

function testEnv(overrides: Record<string, unknown> = {}): AppEnv {
  return {
    DB: db,
    SESSION_SIGNING_KEY: HMAC_KEY,
    INSTANCE_ID: 'test-instance',
    ...overrides,
  } as unknown as AppEnv;
}

async function sessionCookie(): Promise<string> {
  const token = await signSession(
    { sub: 'admin', credentialId: 'cred-1', issuedAt: Math.floor(Date.now() / 1000) },
    HMAC_KEY,
  );
  return `fluxtube_session=${token}`;
}

async function seed(): Promise<void> {
  const instanceId = await new MinifluxInstancesRepo(db).insert({
    displayName: 'Home',
    url: 'https://home.example',
    apiTokenCt: 'ct',
    apiTokenIv: 'iv',
    apiTokenKv: 1,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  });
  await new MappingsRepo(db).insert({
    minifluxInstanceId: instanceId,
    minifluxCategory: 'Videos',
    youtubePlaylistId: 'PL-a',
    skipShorts: false,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  });
}

beforeEach(async () => {
  await resetV1Schema(db);
});

describe('POST /api/backup/now', () => {
  it('401 without auth', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/backup/now', { method: 'POST' }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('500 when BACKUPS binding is missing', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/backup/now', {
        method: 'POST',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('backup_failed');
    expect(body.message).toContain('BACKUPS');
  });

  it('writes to R2 + stamps backup_last_success_at on success', async () => {
    await seed();
    const { bucket, store } = stubBucket();
    const res = await app.fetch(
      new Request('http://d.test/api/backup/now', {
        method: 'POST',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv({ BACKUPS: bucket }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; key: string; sizeBytes: number };
    expect(body.ok).toBe(true);
    expect(body.key).toMatch(/^fluxtube-state_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/);
    expect(store.has(body.key)).toBe(true);
    const stampVal = await new ConfigRepo(db).getPlain('backup_last_success_at');
    expect(stampVal).not.toBeNull();
  });
});

describe('GET /api/backups', () => {
  it('401 without auth', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/backups'),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('lists newest-first with defaulted limit', async () => {
    const { bucket } = stubBucket([
      {
        key: 'fluxtube-state_2026-07-01_04-00-00.json',
        body: '{}',
        uploaded: new Date('2026-07-01T04:00:00Z'),
        size: 2,
      },
      {
        key: 'fluxtube-state_2026-07-05_04-00-00.json',
        body: '{}',
        uploaded: new Date('2026-07-05T04:00:00Z'),
        size: 2,
      },
    ]);
    const res = await app.fetch(
      new Request('http://d.test/api/backups', { headers: { Cookie: await sessionCookie() } }),
      testEnv({ BACKUPS: bucket }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { backups: Array<{ key: string }> };
    expect(body.backups[0]?.key).toBe('fluxtube-state_2026-07-05_04-00-00.json');
  });
});

describe('GET /api/backup/:filename', () => {
  it('400 on invalid filename shape', async () => {
    const { bucket } = stubBucket();
    const res = await app.fetch(
      new Request('http://d.test/api/backup/random-object.json', {
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv({ BACKUPS: bucket }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('404 for a valid key that does not exist', async () => {
    const { bucket } = stubBucket();
    const res = await app.fetch(
      new Request('http://d.test/api/backup/fluxtube-state_2026-07-06_04-00-00.json', {
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv({ BACKUPS: bucket }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(404);
  });

  it('200 streams the object body with Content-Disposition', async () => {
    const { bucket } = stubBucket([
      {
        key: 'fluxtube-state_2026-07-06_04-00-00.json',
        body: '{"schema_version":1}',
        uploaded: new Date(),
        size: 20,
      },
    ]);
    const res = await app.fetch(
      new Request('http://d.test/api/backup/fluxtube-state_2026-07-06_04-00-00.json', {
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv({ BACKUPS: bucket }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect(await res.text()).toBe('{"schema_version":1}');
  });
});

describe('POST /api/backup/restore/:filename', () => {
  it('400 on invalid filename shape', async () => {
    const { bucket } = stubBucket();
    const res = await app.fetch(
      new Request('http://d.test/api/backup/restore/nope.json', {
        method: 'POST',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv({ BACKUPS: bucket }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('404 on missing backup', async () => {
    const { bucket } = stubBucket();
    const res = await app.fetch(
      new Request('http://d.test/api/backup/restore/fluxtube-state_2026-07-06_04-00-00.json', {
        method: 'POST',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv({ BACKUPS: bucket }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(404);
  });

  it('400 on schema-invalid backup body', async () => {
    const { bucket } = stubBucket([
      {
        key: 'fluxtube-state_2026-07-06_04-00-00.json',
        body: '{"schema_version": 1}',
        uploaded: new Date(),
        size: 20,
      },
    ]);
    const res = await app.fetch(
      new Request('http://d.test/api/backup/restore/fluxtube-state_2026-07-06_04-00-00.json', {
        method: 'POST',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv({ BACKUPS: bucket }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('200 restores + returns counts', async () => {
    const payload = {
      schema_version: 1,
      exported_at: '2026-07-01T00:00:00.000Z',
      instance_id: 'test',
      miniflux_instances: [{ display_name: 'A', url: 'https://a.example' }],
      mappings: [
        {
          miniflux_url: 'https://a.example',
          miniflux_category: 'C',
          youtube_playlist_id: 'PL-x',
          skip_shorts: false,
        },
      ],
      mapping_history: [],
      config: { sync_log_level: 'info', history_window: 10 },
    };
    const { bucket } = stubBucket([
      {
        key: 'fluxtube-state_2026-07-06_04-00-00.json',
        body: JSON.stringify(payload),
        uploaded: new Date(),
        size: JSON.stringify(payload).length,
      },
    ]);
    const res = await app.fetch(
      new Request('http://d.test/api/backup/restore/fluxtube-state_2026-07-06_04-00-00.json', {
        method: 'POST',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv({ BACKUPS: bucket }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      restoredInstances: number;
      restoredMappings: number;
    };
    expect(body.restoredInstances).toBe(1);
    expect(body.restoredMappings).toBe(1);
    expect(await new MinifluxInstancesRepo(db).list()).toHaveLength(1);
  });
});

describe('scheduled handler', () => {
  it('runs generateBackup and stamps success timestamp', async () => {
    await seed();
    const { bucket, store } = stubBucket();
    const { scheduledHandler } = await import('../../src/index');
    await scheduledHandler(
      { scheduledTime: Date.now(), cron: '15 4 * * *', noRetry: () => {} } as ScheduledController,
      testEnv({ BACKUPS: bucket }) as unknown as Parameters<typeof scheduledHandler>[1],
      {} as ExecutionContext,
    );
    expect(store.size).toBe(1);
    expect(
      (await new ConfigRepo(db).getPlain('backup_last_success_at'))?.value,
    ).not.toBeNull();
  });

  it('stamps failure timestamp + re-throws when generateBackup errors', async () => {
    // No BACKUPS binding → generateBackup throws → handler should stamp failure + rethrow.
    const { scheduledHandler } = await import('../../src/index');
    await expect(
      scheduledHandler(
        { scheduledTime: Date.now(), cron: '15 4 * * *', noRetry: () => {} } as ScheduledController,
        testEnv() as unknown as Parameters<typeof scheduledHandler>[1],
        {} as ExecutionContext,
      ),
    ).rejects.toThrow();
    expect(
      (await new ConfigRepo(db).getPlain('backup_last_failure_at'))?.value,
    ).not.toBeNull();
  });
});
