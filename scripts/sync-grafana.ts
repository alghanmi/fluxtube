#!/usr/bin/env tsx
/**
 * Push dashboards + alert rules from docs/grafana/ to Grafana Cloud.
 *
 * Source of truth is the repo. UI edits to provisioned items are blocked by
 * Grafana (no `X-Disable-Provenance` header sent) — drift is impossible by
 * construction. Editing the repo is the only path to changing prod.
 *
 * Idempotency:
 *   - Dashboards → POST /api/dashboards/db with overwrite=true; UID-keyed.
 *   - Alert rules → GET /api/v1/provisioning/alert-rules/{uid} first;
 *     PUT if exists, POST if not. UID-keyed.
 *
 * Auto-discovery (no operator-provided UIDs):
 *   - Prometheus datasource UID: GET /api/datasources, pick type=prometheus.
 *   - Folder UID for alert rules: GET /api/folders, pick title="fluxtube".
 *     Operator creates this folder once in the UI (or via the API outside
 *     this script's scope — see TODO.md).
 *
 * Required env:
 *   GRAFANA_API_URL    base URL, e.g. https://<stack>.grafana.net
 *   GRAFANA_API_TOKEN  service account token, scopes:
 *                        dashboards:write, alert.rules:read,
 *                        alert.rules:write, datasources:read, folders:read
 *
 * Optional env:
 *   GRAFANA_PROMETHEUS_DATASOURCE_UID
 *     Skip Prometheus auto-discovery and use this UID directly. Set this
 *     when your stack has multiple Prometheus datasources where the
 *     `isDefault` heuristic can't disambiguate (rare).
 *
 * Usage:
 *   pnpm --filter @fluxtube/scripts sync-grafana
 *   pnpm --filter @fluxtube/scripts sync-grafana -- --dry-run
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DRY_RUN = process.argv.includes('--dry-run');
const FOLDER_TITLE = 'fluxtube';
const DASHBOARDS_DIR = 'docs/grafana/dashboards';
const ALERTS_DIR = 'docs/grafana/alerts';
const DS_PLACEHOLDER = '${DS_PROMETHEUS}';

async function main(): Promise<void> {
  const baseUrl = requireEnv('GRAFANA_API_URL').replace(/\/+$/, '');
  const token = requireEnv('GRAFANA_API_TOKEN');

  const repoRoot = findRepoRoot();
  log(`repo root: ${repoRoot}`);
  log(`grafana:   ${baseUrl}`);
  log(`mode:      ${DRY_RUN ? 'DRY RUN (no writes)' : 'apply'}`);
  log('');

  const promUid = await resolvePrometheusDatasourceUid(baseUrl, token);
  log(`prometheus datasource uid: ${promUid}`);

  const folderUid = await resolveFolderUid(baseUrl, token, FOLDER_TITLE);
  log(`alert folder uid (title="${FOLDER_TITLE}"): ${folderUid}`);
  log('');

  // ── Dashboards ──────────────────────────────────────────────────────────
  const dashboards = readJsonDir(join(repoRoot, DASHBOARDS_DIR));
  log(`dashboards: ${dashboards.length} file(s)`);
  for (const { name, json } of dashboards) {
    const substituted = substituteDatasource(json, promUid);
    await pushDashboard(baseUrl, token, name, substituted);
  }
  log('');

  // ── Alert rules ─────────────────────────────────────────────────────────
  const alerts = readJsonDir(join(repoRoot, ALERTS_DIR));
  log(`alerts: ${alerts.length} file(s)`);
  for (const { name, json } of alerts) {
    const substituted = substituteDatasource(json, promUid) as Record<string, unknown>;
    substituted.folderUID = folderUid;
    substituted.ruleGroup = FOLDER_TITLE;
    await pushAlertRule(baseUrl, token, name, substituted);
  }
  log('');
  log(DRY_RUN ? '✓ dry-run complete' : '✓ sync complete');
}

// ── Resolvers ─────────────────────────────────────────────────────────────

interface Datasource {
  uid: string;
  type: string;
  name: string;
  isDefault: boolean;
}

async function resolvePrometheusDatasourceUid(baseUrl: string, token: string): Promise<string> {
  // Escape hatch: operator-provided UID skips discovery entirely.
  const override = process.env['GRAFANA_PROMETHEUS_DATASOURCE_UID'];
  if (override && override.trim() !== '') {
    return override.trim();
  }

  const res = await grafana(baseUrl, token, 'GET', '/api/datasources');
  const list = (await res.json()) as Datasource[];
  const candidates = list.filter((d) => d.type === 'prometheus');

  if (candidates.length === 0) {
    throw new Error(
      'No Prometheus datasource found. Create one in Grafana → Connections → Add new connection → Prometheus.',
    );
  }
  if (candidates.length === 1) {
    return candidates[0]!.uid;
  }

  // Grafana Cloud auto-provisions two Prometheus DS — the primary
  // metrics one (the operator's stack, marked isDefault) and an internal
  // `grafanacloud-usage` for billing telemetry. The default flag is the
  // canonical discriminator; isDefault=true is what `${DS_PROMETHEUS}`
  // would resolve to in a dashboard view too.
  const defaults = candidates.filter((d) => d.isDefault);
  if (defaults.length === 1) {
    return defaults[0]!.uid;
  }

  const names = candidates.map((c) => `${c.name} (uid=${c.uid}, default=${c.isDefault})`).join(', ');
  throw new Error(
    `Multiple Prometheus datasources found and none/multiple marked default: ${names}. ` +
      `Set GRAFANA_PROMETHEUS_DATASOURCE_UID in the workflow env to the metrics datasource's uid.`,
  );
}

interface Folder {
  uid: string;
  title: string;
}

async function resolveFolderUid(
  baseUrl: string,
  token: string,
  title: string,
): Promise<string> {
  // `/api/folders` is paginated (default page size 1000, max 1000). One page
  // is more than enough for a personal Grafana instance, but ask for the max
  // explicitly so the script behaves consistently as folders are added.
  const res = await grafana(baseUrl, token, 'GET', '/api/folders?limit=1000');
  const list = (await res.json()) as Folder[];

  // Case-insensitive match — Grafana's UI title-cases folder names if you
  // tab through "Create folder" quickly, so "Fluxtube" or "FLUXTUBE" can
  // sneak in. Trim too in case of a trailing space from a keyboard slip.
  const want = title.trim().toLowerCase();
  const match = list.find((f) => f.title.trim().toLowerCase() === want);
  if (match) return match.uid;

  // Diagnostic on failure: dump what the service account CAN see so the
  // operator can tell whether it's a name mismatch (folder exists but
  // titled differently) or a permissions issue (folder doesn't appear at
  // all — service account is missing folder access).
  const visible =
    list.length === 0
      ? '<none — check that the service account has folders:read>'
      : list.map((f) => `"${f.title}"`).join(', ');
  throw new Error(
    `Folder "${title}" not found.\n` +
      `Folders visible to this service account: ${visible}\n` +
      `Either rename your folder to "${title}" exactly, or grant this ` +
      `service account access to the existing folder. See TODO.md step 17b.`,
  );
}

// ── Pushers ───────────────────────────────────────────────────────────────

async function pushDashboard(
  baseUrl: string,
  token: string,
  filename: string,
  dashboard: unknown,
): Promise<void> {
  const body = { dashboard, overwrite: true };
  if (DRY_RUN) {
    log(`  [dry-run] POST /api/dashboards/db ← ${filename}`);
    return;
  }
  const res = await grafana(baseUrl, token, 'POST', '/api/dashboards/db', body);
  const result = (await res.json()) as { uid?: string; status?: string };
  log(`  ✓ ${filename} → uid=${result.uid ?? '?'} status=${result.status ?? '?'}`);
}

async function pushAlertRule(
  baseUrl: string,
  token: string,
  filename: string,
  rule: Record<string, unknown>,
): Promise<void> {
  const uid = rule.uid as string;
  if (!uid) throw new Error(`Alert file ${filename} is missing a top-level "uid" field`);

  const exists = await alertRuleExists(baseUrl, token, uid);
  const verb = exists ? 'PUT' : 'POST';
  const path = exists ? `/api/v1/provisioning/alert-rules/${uid}` : '/api/v1/provisioning/alert-rules';

  if (DRY_RUN) {
    log(`  [dry-run] ${verb} ${path} ← ${filename}`);
    return;
  }
  await grafana(baseUrl, token, verb, path, rule);
  log(`  ✓ ${filename} → ${exists ? 'updated' : 'created'} uid=${uid}`);
}

async function alertRuleExists(baseUrl: string, token: string, uid: string): Promise<boolean> {
  const res = await grafana(baseUrl, token, 'GET', `/api/v1/provisioning/alert-rules/${uid}`, undefined, {
    acceptNotFound: true,
  });
  return res.status === 200;
}

// ── HTTP ──────────────────────────────────────────────────────────────────

interface GrafanaOpts {
  acceptNotFound?: boolean;
}

async function grafana(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
  opts: GrafanaOpts = {},
): Promise<Response> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    if (opts.acceptNotFound && res.status === 404) return res;
    const text = await res.text().catch(() => '<no body>');
    throw new Error(
      `Grafana ${method} ${path} failed: ${res.status} ${res.statusText}\n${text.slice(0, 500)}`,
    );
  }
  return res;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    console.error(`Error: required env var ${name} is unset.`);
    process.exit(1);
  }
  return v;
}

function findRepoRoot(): string {
  // The script may be invoked from any cwd (pnpm --filter sets it to scripts/).
  // Walk up from this file's directory until we find pnpm-workspace.yaml.
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== '/') {
    try {
      statSync(join(dir, 'pnpm-workspace.yaml'));
      return dir;
    } catch {
      dir = resolve(dir, '..');
    }
  }
  throw new Error('Could not find pnpm-workspace.yaml — run from inside the FluxTube repo.');
}

interface NamedJson {
  name: string;
  json: unknown;
}

function readJsonDir(dir: string): NamedJson[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  return files.map((name) => ({
    name,
    json: JSON.parse(readFileSync(join(dir, name), 'utf-8')),
  }));
}

// Walk the JSON tree and replace every occurrence of `${DS_PROMETHEUS}` with
// the resolved Prometheus datasource UID. Recursive — handles nested objects
// and arrays (the placeholder appears in `data[].datasourceUid` on alert
// rules and inside dashboard panel `datasource` blocks).
function substituteDatasource(value: unknown, uid: string): unknown {
  if (typeof value === 'string') {
    return value === DS_PLACEHOLDER ? uid : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => substituteDatasource(v, uid));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, substituteDatasource(v, uid)]),
    );
  }
  return value;
}

function log(line: string): void {
  // eslint-disable-next-line no-console
  console.log(line);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
