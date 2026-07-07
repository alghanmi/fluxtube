// Client-side API wrappers for the dashboard Worker.
//
// All requests go to same-origin `/api/*` — Cloudflare Pages proxies to the
// dashboard Worker via Service Binding (wired by Terraform in Phase 7).
// Session cookies ride along automatically (SameSite=Strict).
//
// Every helper returns typed data or throws an `ApiError` — callers decide
// how to render the message.

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function req<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    ...init,
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}

// ─── Session ────────────────────────────────────────────────────────────

export interface SessionData {
  sub: string;
  credentialId: string;
  issuedAt: number;
}

export async function getMe(): Promise<SessionData | null> {
  try {
    const r = await req<{ session: SessionData }>('/api/me');
    return r.session;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export async function logout(): Promise<void> {
  await req<{ ok: true }>('/api/auth/logout', { method: 'POST' });
}

export async function recoverWithCode(code: string): Promise<{ wiped: number }> {
  return await req('/api/auth/recovery', {
    method: 'POST',
    body: JSON.stringify({ recovery_code: code }),
  });
}

// ─── WebAuthn ──────────────────────────────────────────────────────────

// Server returns the raw JSON produced by @simplewebauthn/server. We pass it
// through unchanged to @simplewebauthn/browser for the ceremony.

export async function registerBegin(): Promise<unknown> {
  return await req('/api/auth/passkey/register/begin', { method: 'POST' });
}

export async function registerFinish(
  attestation: unknown,
): Promise<{ credentialId: string; recoveryCode: string; credentialBackedUp: boolean }> {
  return await req('/api/auth/passkey/register/finish', {
    method: 'POST',
    body: JSON.stringify(attestation),
  });
}

export async function authenticateBegin(): Promise<unknown> {
  return await req('/api/auth/passkey/authenticate/begin', { method: 'POST' });
}

export async function authenticateFinish(
  assertion: unknown,
): Promise<{ credentialId: string }> {
  return await req('/api/auth/passkey/authenticate/finish', {
    method: 'POST',
    body: JSON.stringify(assertion),
  });
}

// ─── Miniflux instances ────────────────────────────────────────────────

export interface MinifluxInstance {
  id: number;
  displayName: string;
  url: string;
  createdAt: number;
  updatedAt: number;
}

export async function listInstances(): Promise<MinifluxInstance[]> {
  const r = await req<{ instances: MinifluxInstance[] }>('/api/miniflux/instances');
  return r.instances;
}

export async function createInstance(input: {
  displayName: string;
  url: string;
  apiToken: string;
}): Promise<MinifluxInstance> {
  return await req('/api/miniflux/instances', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateInstance(
  id: number,
  patch: Partial<{ displayName: string; url: string; apiToken: string }>,
): Promise<MinifluxInstance> {
  return await req(`/api/miniflux/instances/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function deleteInstance(id: number): Promise<void> {
  await req(`/api/miniflux/instances/${id}`, { method: 'DELETE' });
}

export interface MinifluxCategory {
  id: number;
  title: string;
}

export async function listCategories(instanceId: number): Promise<MinifluxCategory[]> {
  const r = await req<{ categories: MinifluxCategory[] }>(
    `/api/miniflux/categories?instance_id=${instanceId}`,
  );
  return r.categories;
}

// ─── YouTube ────────────────────────────────────────────────────────────

export interface YouTubePlaylist {
  id: string;
  title: string;
  itemCount: number;
}

export async function listPlaylists(): Promise<YouTubePlaylist[]> {
  const r = await req<{ playlists: YouTubePlaylist[] }>('/api/youtube/playlists');
  return r.playlists;
}

/** Full-page redirect — no fetch. Returns the URL the caller navigates to. */
export function youtubeOAuthBeginUrl(): string {
  return '/api/auth/youtube';
}

// ─── Mappings ──────────────────────────────────────────────────────────

export interface MappingEntry {
  id: number;
  minifluxCategory: string;
  youtubePlaylistId: string;
  skipShorts: boolean;
}

export interface MappingsInstance {
  id: number;
  displayName: string;
  url: string;
  mappings: MappingEntry[];
}

export async function getMappings(): Promise<MappingsInstance[]> {
  const r = await req<{ instances: MappingsInstance[] }>('/api/mappings');
  return r.instances;
}

export interface MappingPayload {
  minifluxInstanceId: number;
  minifluxCategory: string;
  youtubePlaylistId: string;
  skipShorts: boolean;
}

export async function saveMappings(mappings: MappingPayload[]): Promise<MappingsInstance[]> {
  const r = await req<{ instances: MappingsInstance[] }>('/api/mappings', {
    method: 'PUT',
    body: JSON.stringify({ mappings }),
  });
  return r.instances;
}

export interface HistoryEntry {
  id: number;
  actor: string;
  createdAt: number;
  snapshot: unknown;
}

export async function getMappingHistory(): Promise<HistoryEntry[]> {
  const r = await req<{ history: HistoryEntry[] }>('/api/mappings/history');
  return r.history;
}

export async function restoreMappingHistory(id: number): Promise<{
  instances: MappingsInstance[];
  skipped: Array<{ minifluxInstanceId: number; count: number }>;
}> {
  return await req(`/api/mappings/history/${id}/restore`, { method: 'POST' });
}

// ─── Config ────────────────────────────────────────────────────────────

export interface ConfigState {
  sync_log_level: string | null;
  history_window: string | null;
  backup_last_success_at: string | null;
  backup_last_failure_at: string | null;
}

export async function getConfig(): Promise<ConfigState> {
  const r = await req<{ config: ConfigState }>('/api/config');
  return r.config;
}

export async function setConfig(
  key: 'sync_log_level' | 'history_window',
  value: string | number,
): Promise<void> {
  await req(`/api/config/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

// ─── Sync trigger ───────────────────────────────────────────────────────

export async function triggerSync(): Promise<unknown> {
  return await req('/api/sync/trigger', { method: 'POST' });
}

// ─── Backups ───────────────────────────────────────────────────────────

export interface BackupObject {
  key: string;
  sizeBytes: number;
  uploadedAt: string;
}

export async function listBackupObjects(): Promise<BackupObject[]> {
  const r = await req<{ backups: BackupObject[] }>('/api/backups');
  return r.backups;
}

export async function backupNow(): Promise<{ key: string; sizeBytes: number }> {
  return await req('/api/backup/now', { method: 'POST' });
}

export async function restoreFromBackup(filename: string): Promise<{
  restoredInstances: number;
  restoredMappings: number;
  restoredHistory: number;
  skippedMappings: number;
}> {
  return await req(`/api/backup/restore/${encodeURIComponent(filename)}`, { method: 'POST' });
}

export function backupDownloadUrl(filename: string): string {
  return `/api/backup/${encodeURIComponent(filename)}`;
}
