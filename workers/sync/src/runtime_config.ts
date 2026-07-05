// Dual-mode runtime configuration loader for workers/sync.
//
// Historically the Worker reads its config from env bindings — CATEGORY_
// PLAYLIST_MAPPING, MINIFLUX_URL/API_TOKEN, YOUTUBE_REFRESH_TOKEN,
// SYNC_LOG_LEVEL. Post-v1 the dashboard writes these values to D1, and the
// sync path reads from D1 instead. Both modes coexist so production stays
// on the env path until the operator cuts over.
//
// The gate is the `admin_passkey` table's existence:
//   COUNT(*) FROM admin_passkey > 0  →  D1-managed mode; env vars strictly
//                                       ignored (safety per the plan).
//   0                                 →  env-managed mode; unchanged behaviour.
//
// A caller (index.ts, router.ts) calls `loadRuntimeConfig(env)` at the top
// of each run/request and receives a normalized shape that both paths
// produce identically. The rest of the sync code doesn't need to know
// which mode fed it.

import { parseCategoryPlaylistMapping } from './config';
import { decrypt, parseKeychain, type Keychain } from './crypto';
import { AdminPasskeyRepo } from './repos/admin_passkey';
import { ConfigRepo } from './repos/config';
import { MappingsRepo } from './repos/mappings';
import { MinifluxInstancesRepo } from './repos/miniflux_instances';
import type { CategoryPlaylistMapping, Env } from './types';

export type ConfigMode = 'env' | 'd1';

/**
 * The union shape that the rest of sync/router code consumes. Both modes
 * produce this. Single-Miniflux for now — Phase 3.5 will extend to a flat
 * list of `{ miniflux: { url, token }, category, playlistId, skipShorts }`
 * once multi-instance sync is wired.
 */
export interface NormalizedRuntimeConfig {
  mode: ConfigMode;
  minifluxUrl: string;
  minifluxApiToken: string;
  youtubeRefreshToken: string;
  syncLogLevel: string | undefined;
  mappings: CategoryPlaylistMapping[];
}

export async function loadRuntimeConfig(env: Env): Promise<NormalizedRuntimeConfig> {
  const passkeyCount = await new AdminPasskeyRepo(env.DB).count();
  return passkeyCount > 0 ? await loadFromD1(env) : loadFromEnv(env);
}

/**
 * Env path — unchanged behaviour. Every value is required by the existing
 * production deployment; missing values throw with the existing error text
 * so the failure mode matches pre-v1.
 */
function loadFromEnv(env: Env): NormalizedRuntimeConfig {
  return {
    mode: 'env',
    minifluxUrl: env.MINIFLUX_URL,
    minifluxApiToken: env.MINIFLUX_API_TOKEN,
    youtubeRefreshToken: env.YOUTUBE_REFRESH_TOKEN,
    syncLogLevel: env.SYNC_LOG_LEVEL,
    mappings: parseCategoryPlaylistMapping(env.CATEGORY_PLAYLIST_MAPPING),
  };
}

/**
 * D1 path — reads mappings + tokens from D1 tables, decrypts sensitive
 * values via the keychain in env.D1_KEYCHAIN.
 *
 * Constraints for v1.0 (Phase 3):
 *   - Exactly 1 miniflux_instances row. Zero → the instance has been claimed
 *     but no source has been added; throw with the recovery hint. Multiple →
 *     throw "multi-instance sync not yet implemented" (Phase 3.5).
 *   - env.D1_KEYCHAIN must be present and parse to a valid keychain.
 *   - config.youtube_refresh_token must be set (encrypted). Absent → throw
 *     with the operator hint to complete the OAuth flow.
 */
async function loadFromD1(env: Env): Promise<NormalizedRuntimeConfig> {
  if (!env.D1_KEYCHAIN) {
    throw new Error(
      'D1-managed mode: env.D1_KEYCHAIN is required for decryption but is unset. Set it via `wrangler secret put D1_KEYCHAIN`.',
    );
  }
  const keychain: Keychain = parseKeychain(env.D1_KEYCHAIN);

  const instances = await new MinifluxInstancesRepo(env.DB).list();
  if (instances.length === 0) {
    throw new Error(
      'D1-managed mode: no miniflux_instances row present. Add one via the dashboard UI (Settings → Add Miniflux instance) before the next cron tick.',
    );
  }
  if (instances.length > 1) {
    // Phase 3.5 lifts this — the sync algorithm needs per-mapping Miniflux
    // routing + YouTube-409-as-success cross-instance mark-read logic.
    throw new Error(
      `D1-managed mode: multi-instance sync not yet implemented in this build (found ${instances.length} miniflux_instances rows). Phase 3.5 pending.`,
    );
  }
  // Guaranteed by the length checks above (0 → throw, >1 → throw), so
  // instances[0] is defined. Explicit guard satisfies the linter without
  // hiding the invariant.
  const instance = instances[0];
  if (!instance) throw new Error('unreachable: miniflux_instances list is empty after length check');

  const minifluxApiToken = await decrypt(
    { ct: instance.apiTokenCt, iv: instance.apiTokenIv, kv: instance.apiTokenKv },
    keychain,
  );

  const configRepo = new ConfigRepo(env.DB);
  const encRefresh = await configRepo.getEncrypted('youtube_refresh_token');
  if (!encRefresh) {
    throw new Error(
      'D1-managed mode: config.youtube_refresh_token is not set. Complete the OAuth flow via the dashboard (Settings → Connect YouTube) before the next cron tick.',
    );
  }
  const youtubeRefreshToken = await decrypt(
    { ct: encRefresh.ct, iv: encRefresh.iv, kv: encRefresh.kv },
    keychain,
  );

  const plainLogLevel = await configRepo.getPlain('sync_log_level');

  const mappingRows = await new MappingsRepo(env.DB).listByInstance(instance.id);
  const mappings: CategoryPlaylistMapping[] = mappingRows.map((r) => ({
    category: r.minifluxCategory,
    playlistId: r.youtubePlaylistId,
    ...(r.skipShorts ? { skipShorts: true } : {}),
  }));

  return {
    mode: 'd1',
    minifluxUrl: instance.url,
    minifluxApiToken,
    youtubeRefreshToken,
    syncLogLevel: plainLogLevel?.value,
    mappings,
  };
}
