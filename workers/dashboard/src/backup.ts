// R2 backup module.
//
// Backs up mappings + miniflux_instances (identities only, no api_tokens)
// + mapping_history + non-sensitive config to R2. Payload is validated
// by zod both on write (defensive) and on read (before restore).
//
// Excluded on purpose:
//   * admin_passkey            — WebAuthn state; restoring would break the
//                                bound authenticator; passkey rotation is a
//                                separate operator flow
//   * miniflux_instances.api_token_*   — re-prompted on restore via the UI
//   * config.youtube_refresh_token     — re-auth via the OAuth flow
//   * queue table              — cold start is fine (YouTube-as-truth dedup)
//
// Bucket: BACKUPS binding, provisioned by Terraform in Phase 7.
// Object key: `fluxtube-state_YYYY-MM-DD_HH-MM-SS.json` (UTC).
// Lifecycle: Terraform sets `expiration_days = 120` on the bucket.

import { z } from 'zod';
import { ConfigRepo } from './repos/config';
import { MappingHistoryRepo } from './repos/mapping_history';
import { MappingsRepo } from './repos/mappings';
import { MinifluxInstancesRepo } from './repos/miniflux_instances';

// ─── Schema ─────────────────────────────────────────────────────────────

export const BackupSchema = z.object({
  schema_version: z.literal(1),
  exported_at: z.iso.datetime(),
  instance_id: z.string().min(1),
  miniflux_instances: z.array(
    z.object({
      display_name: z.string(),
      url: z.url(),
    }),
  ),
  mappings: z.array(
    z.object({
      miniflux_url: z.url(),
      miniflux_category: z.string(),
      youtube_playlist_id: z.string(),
      skip_shorts: z.boolean(),
    }),
  ),
  mapping_history: z.array(
    z.object({
      snapshot_json: z.string(),
      actor: z.string(),
      created_at: z.number().int(),
    }),
  ),
  config: z.object({
    sync_log_level: z.string().nullable(),
    history_window: z.number().int().nullable(),
  }),
});

export type Backup = z.infer<typeof BackupSchema>;

// ─── Environment ────────────────────────────────────────────────────────

export interface BackupEnv {
  DB: D1Database;
  BACKUPS?: R2Bucket;
  INSTANCE_ID?: string;
}

// ─── Public API ─────────────────────────────────────────────────────────

/** Result of a backup run — safe to log + push to OTLP. */
export interface BackupResult {
  key: string;
  sizeBytes: number;
  exportedAt: string;
}

/**
 * Walks the D1 repos, composes a `BackupSchema`-valid payload, and writes
 * it to R2 under a UTC-timestamped key.
 */
export async function generateBackup(
  env: BackupEnv,
  now: Date = new Date(),
): Promise<BackupResult> {
  if (!env.BACKUPS) throw new Error('BACKUPS_binding_not_configured');
  if (!env.INSTANCE_ID) throw new Error('INSTANCE_ID_not_configured');

  const [instances, mappings, history, syncLogLevel, historyWindow] = await Promise.all([
    new MinifluxInstancesRepo(env.DB).list(),
    new MappingsRepo(env.DB).list(),
    new MappingHistoryRepo(env.DB).listLatest(1000),
    new ConfigRepo(env.DB).getPlain('sync_log_level'),
    new ConfigRepo(env.DB).getPlain('history_window'),
  ]);

  const urlById = new Map<number, string>();
  for (const inst of instances) urlById.set(inst.id, inst.url);

  const payload: Backup = {
    schema_version: 1,
    exported_at: now.toISOString(),
    instance_id: env.INSTANCE_ID,
    miniflux_instances: instances.map((i) => ({
      display_name: i.displayName,
      url: i.url,
    })),
    mappings: mappings
      .map((m) => {
        const url = urlById.get(m.minifluxInstanceId);
        if (!url) return null;
        return {
          miniflux_url: url,
          miniflux_category: m.minifluxCategory,
          youtube_playlist_id: m.youtubePlaylistId,
          skip_shorts: m.skipShorts,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null),
    mapping_history: history.map((h) => ({
      snapshot_json: h.snapshotJson,
      actor: h.actor,
      created_at: h.createdAt,
    })),
    config: {
      sync_log_level: syncLogLevel?.value ?? null,
      history_window: historyWindow?.value ? Number(historyWindow.value) : null,
    },
  };

  const parsed = BackupSchema.parse(payload);
  const body = JSON.stringify(parsed);
  const key = objectKey(now);
  await env.BACKUPS.put(key, body, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return { key, sizeBytes: body.length, exportedAt: parsed.exported_at };
}

/**
 * Lists backup objects newest-first. Returns up to `limit` keys with size +
 * upload time so the UI can render a chronological picker.
 */
export async function listBackups(
  env: BackupEnv,
  limit = 100,
): Promise<Array<{ key: string; sizeBytes: number; uploadedAt: string }>> {
  if (!env.BACKUPS) throw new Error('BACKUPS_binding_not_configured');

  const out: Array<{ key: string; sizeBytes: number; uploadedAt: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await env.BACKUPS.list({
      prefix: 'fluxtube-state_',
      cursor,
      limit: Math.min(1000, limit - out.length),
    });
    for (const obj of page.objects) {
      out.push({
        key: obj.key,
        sizeBytes: obj.size,
        uploadedAt: obj.uploaded.toISOString(),
      });
      if (out.length >= limit) break;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && out.length < limit);

  out.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return out;
}

/** Fetches a backup's raw JSON body. */
export async function fetchBackupBody(env: BackupEnv, key: string): Promise<string | null> {
  if (!env.BACKUPS) throw new Error('BACKUPS_binding_not_configured');
  const obj = await env.BACKUPS.get(key);
  if (!obj) return null;
  return await obj.text();
}

/**
 * Restore result. `skipped_mappings` reports mappings whose miniflux_url
 * didn't match any inserted instance — should be zero in normal use.
 */
export interface RestoreResult {
  restoredInstances: number;
  restoredMappings: number;
  restoredHistory: number;
  skippedMappings: number;
}

/**
 * Reads the given R2 object, validates its shape, wipes the tables it
 * owns, and reinserts from the payload. Guarded by the caller's auth.
 *
 * Non-transactional: D1 doesn't expose multi-statement transactions to
 * the Workers API. On partial failure the operator can re-run restore
 * from the same backup — inserts are idempotent per (instance URL) and
 * mappings are always full-replaced.
 */
export async function restoreBackup(
  env: BackupEnv,
  key: string,
  now: number,
): Promise<RestoreResult> {
  const body = await fetchBackupBody(env, key);
  if (body === null) throw new Error('backup_not_found');

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new Error('backup_body_not_json');
  }

  const parsed = BackupSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`backup_schema_invalid: ${parsed.error.message}`);
  }
  const payload = parsed.data;

  const instancesRepo = new MinifluxInstancesRepo(env.DB);
  const mappingsRepo = new MappingsRepo(env.DB);
  const historyRepo = new MappingHistoryRepo(env.DB);
  const configRepo = new ConfigRepo(env.DB);

  // Snapshot current state first — restore is undoable via mapping_history.
  const before = await snapshotForHistory(env.DB, now);
  await historyRepo.append({
    snapshotJson: JSON.stringify(before),
    actor: 'restore',
    createdAt: now,
  });

  // Wipe + reinsert instances. Mappings cascade via FK; explicit sweep
  // afterwards keeps the invariant clean when FK enforcement is disabled.
  await env.DB.prepare('DELETE FROM mappings').run();
  await env.DB.prepare('DELETE FROM miniflux_instances').run();

  const urlToId = new Map<string, number>();
  for (const inst of payload.miniflux_instances) {
    // No api_token in the backup — we insert placeholders and require the
    // operator to re-supply via the UI. Callers should render a
    // "re-auth required" state after restore.
    const id = await instancesRepo.insert({
      displayName: inst.display_name,
      url: inst.url,
      apiTokenCt: '',
      apiTokenIv: '',
      apiTokenKv: 0,
      createdAt: now,
      updatedAt: now,
    });
    urlToId.set(inst.url, id);
  }

  let skippedMappings = 0;
  let restoredMappings = 0;
  for (const m of payload.mappings) {
    const instanceId = urlToId.get(m.miniflux_url);
    if (instanceId === undefined) {
      skippedMappings++;
      continue;
    }
    await mappingsRepo.insert({
      minifluxInstanceId: instanceId,
      minifluxCategory: m.miniflux_category,
      youtubePlaylistId: m.youtube_playlist_id,
      skipShorts: m.skip_shorts,
      createdAt: now,
      updatedAt: now,
    });
    restoredMappings++;
  }

  // Reinsert history AFTER the pre-restore snapshot we already appended,
  // so the timeline reads: [old snapshots] → [pre-restore snapshot] →
  // [historical snapshots from backup].
  for (const h of payload.mapping_history) {
    await historyRepo.append({
      snapshotJson: h.snapshot_json,
      actor: h.actor === 'ui' || h.actor === 'restore' || h.actor === 'migration' ? h.actor : 'restore',
      createdAt: h.created_at,
    });
  }

  // Restore non-encrypted config. Leaves encrypted keys
  // (youtube_refresh_token) untouched — those need OAuth re-auth.
  if (payload.config.sync_log_level !== null) {
    await configRepo.setPlain('sync_log_level', payload.config.sync_log_level, now);
  }
  if (payload.config.history_window !== null) {
    await configRepo.setPlain('history_window', String(payload.config.history_window), now);
  }

  return {
    restoredInstances: payload.miniflux_instances.length,
    restoredMappings,
    restoredHistory: payload.mapping_history.length,
    skippedMappings,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Produces `fluxtube-state_2026-07-06_04-15-00.json` (UTC). */
export function objectKey(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const y = now.getUTCFullYear();
  const mo = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const h = pad(now.getUTCHours());
  const mi = pad(now.getUTCMinutes());
  const s = pad(now.getUTCSeconds());
  return `fluxtube-state_${y}-${mo}-${d}_${h}-${mi}-${s}.json`;
}

async function snapshotForHistory(
  db: D1Database,
  _now: number,
): Promise<{ instances: unknown[]; mappings: unknown[] }> {
  const instances = await new MinifluxInstancesRepo(db).list();
  const mappings = await new MappingsRepo(db).list();
  return {
    instances: instances.map((i) => ({ id: i.id, displayName: i.displayName, url: i.url })),
    mappings: mappings.map((m) => ({
      minifluxInstanceId: m.minifluxInstanceId,
      minifluxCategory: m.minifluxCategory,
      youtubePlaylistId: m.youtubePlaylistId,
      skipShorts: m.skipShorts,
    })),
  };
}
