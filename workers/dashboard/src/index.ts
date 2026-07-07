import { Hono } from 'hono';
import { requireAuth } from './auth/require_auth';
import { clearSessionCookieHeader } from './auth/session';
import { AdminPasskeyRepo } from './repos/admin_passkey';
import { generateBackup } from './backup';
import { OtlpMetricsSink } from './metricsink';
import type { MetricsSink } from './metricsink';
import { attachBackupRoutes } from './routes/backup';
import { attachConfigRoutes } from './routes/config';
import { attachMappingsRoutes } from './routes/mappings';
import { attachMinifluxCategoriesRoutes } from './routes/miniflux_categories';
import { attachMinifluxInstanceRoutes } from './routes/miniflux_instances';
import { attachSyncRoutes } from './routes/sync';
import { attachWebauthnRoutes } from './routes/webauthn';
import { attachYouTubeRoutes } from './routes/youtube';
import { ConfigRepo } from './repos/config';

// Env interface grows across phases:
//   Phase 0: D1 binding placeholder only
//   Phase 2: D1_KEYCHAIN secret (present when the crypto util is used)
//   Phase 4a: SESSION_SIGNING_KEY, MANUAL_TRIGGER_TOKEN
//   Phase 4b: RP_ID (WebAuthn relying-party ID), RP_NAME (optional)
//   Phase 4d: YOUTUBE_CLIENT_ID/SECRET
//   Phase 5: BACKUPS (R2)
//   Phase 7: SYNC service binding
interface Env {
  DB: D1Database;
  /**
   * JSON keychain — parsed via `parseKeychain()` from ./crypto.ts.
   * Optional at the type level so Phase 0/1 health probes still work when
   * the secret hasn't been provisioned locally; callers that actually use
   * the crypto util must check + throw if missing.
   */
  D1_KEYCHAIN?: string;
  /**
   * 32-byte HMAC key, base64-encoded. Used by ./auth/session.ts to sign
   * session cookies AND by ./auth/challenge.ts to sign short-lived
   * WebAuthn challenge cookies. Optional at the type level so the Phase
   * 0/1 health probes boot without it; auth routes that need it validate
   * presence and 500 with a clear operator message when missing.
   */
  SESSION_SIGNING_KEY?: string;
  /**
   * Same bearer token the workers/sync router accepts. Lets existing
   * operator scripts (trigger-sync.sh, etc.) hit dashboard endpoints
   * without a passkey session.
   */
  MANUAL_TRIGGER_TOKEN?: string;
  /**
   * WebAuthn relying-party ID — the domain the passkey is bound to.
   * Injected via Terraform from `var.dashboard_domain` (Phase 7) so the
   * private hostname never lives in the public repo.
   */
  RP_ID?: string;
  /**
   * Human-readable relying-party name shown by some authenticators.
   * Defaults to 'FluxTube' when unset.
   */
  RP_NAME?: string;
  /**
   * Service Binding to the sync Worker. Wired by Terraform in Phase 7.
   * Absent locally + in tests; POST /api/sync/trigger 503s when missing.
   */
  SYNC?: Fetcher;
  /**
   * R2 bucket for nightly + manual backups. Provisioned by Terraform in
   * Phase 7 with a 120-day lifecycle rule. Absent locally + in tests.
   */
  BACKUPS?: R2Bucket;
  /**
   * Multi-instance identifier — becomes part of every backup payload so
   * a cross-instance restore is disambiguable. Set via Terraform's
   * `var.instance_id` in Phase 7.
   */
  INSTANCE_ID?: string;
  /**
   * Google OAuth 2.0 Web application client id + secret, used by the
   * YouTube integration routes (Phase 4d). The redirect URI registered on
   * the client must be `https://<RP_ID>/api/auth/youtube/callback`.
   */
  YOUTUBE_CLIENT_ID?: string;
  YOUTUBE_CLIENT_SECRET?: string;
  /**
   * Grafana Cloud OTLP metric shipping (Phase 8). All three must be set to
   * enable backup outcome metrics; otherwise the metric sink is not
   * constructed and only the D1 config timestamps are stamped.
   */
  GRAFANA_OTLP_URL?: string;
  GRAFANA_OTLP_USER?: string;
  GRAFANA_OTLP_TOKEN?: string;
}

const app = new Hono<{ Bindings: Env }>();

// ─── Liveness / version probe ────────────────────────────────────────────
// Public; used by CI deploy verification + curl smoke tests.

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'fluxtube-dashboard',
    version: VERSION,
  }),
);

// ─── WebAuthn passkey ceremonies (Phase 4b) ──────────────────────────────
// register/begin, register/finish, authenticate/begin, authenticate/finish.
// Register is gated to admin_passkey being empty.

attachWebauthnRoutes(app);

// ─── Data endpoints (Phase 4c) ───────────────────────────────────────────
// Mapping CRUD + history, Miniflux instance CRUD, config CRUD, and the
// service-binding sync trigger. All auth-gated (session or Bearer).

attachMinifluxInstanceRoutes(app);
attachMinifluxCategoriesRoutes(app);
attachMappingsRoutes(app);
attachConfigRoutes(app);
attachSyncRoutes(app);

// ─── External integrations (Phase 4d) ────────────────────────────────────
// YouTube OAuth begin/callback + owned-playlist listing.

attachYouTubeRoutes(app);

// ─── Backup routes (Phase 5) ─────────────────────────────────────────────
// Manual backup + list + download + restore. Nightly cron uses the
// `scheduled` handler below.

attachBackupRoutes(app);

// ─── Session-related routes ──────────────────────────────────────────────

/**
 * GET /api/me — returns the current session's SessionData or 401.
 * Both auth paths (cookie + Bearer) accepted; Bearer callers get a
 * synthetic session with credentialId 'bearer:manual-trigger-token'.
 */
app.get('/api/me', async (c) => {
  const session = await requireAuth(c.req.raw, c.env);
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ session });
});

/**
 * POST /api/auth/logout — clears the session cookie. Always 200 (idempotent).
 * Bearer-authed callers get no state change since Bearer auth is stateless,
 * but the endpoint still responds cleanly so they can share code with the UI.
 */
app.post('/api/auth/logout', (_c) => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookieHeader(),
    },
  });
});

/**
 * POST /api/auth/recovery — wipes the admin_passkey table iff the posted
 * `recovery_code` SHA-256-hashes to an existing row's recovery_hash.
 *
 * Body: { recovery_code: string }
 * Returns:
 *   200 { wiped: number } — recovery_code matched, N rows wiped
 *   401 { error: 'invalid_recovery_code' } — no match; table intact
 *
 * Intentionally NOT protected by auth — the whole point is that the operator
 * has lost their passkey. The recovery code IS the auth for this endpoint.
 * Once wiped, next request to /claim (Phase 4b) starts a fresh registration.
 */
app.post('/api/auth/recovery', async (c) => {
  let body: { recovery_code?: unknown };
  try {
    body = (await c.req.json()) as { recovery_code?: unknown };
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const code = body.recovery_code;
  if (typeof code !== 'string' || code.length === 0) {
    return c.json({ error: 'missing_recovery_code' }, 400);
  }
  const hash = await sha256Hex(code);
  const wiped = await new AdminPasskeyRepo(c.env.DB).deleteAllMatching(
    hash,
    Math.floor(Date.now() / 1000),
  );
  if (wiped === 0) return c.json({ error: 'invalid_recovery_code' }, 401);
  return c.json({ wiped });
});

// ─── Helpers ─────────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  let s = '';
  for (const b of new Uint8Array(buf)) s += b.toString(16).padStart(2, '0');
  return s;
}

// ─── Scheduled (Phase 5) ─────────────────────────────────────────────────
// The wrangler.toml cron `15 4 * * *` (UTC) invokes this once nightly.
// Failure paths stamp `backup_last_failure_at` so Grafana can alert on
// stale backups without needing to parse worker logs.

export async function scheduledHandler(
  _controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const metrics = buildMetricsSink(env);
  try {
    const result = await generateBackup(env, new Date());
    await new ConfigRepo(env.DB).setPlain('backup_last_success_at', String(now), now);
    emitBackupMetrics(metrics, ctx, {
      outcome: 'success',
      sizeBytes: result.sizeBytes,
      lastSuccessSec: now,
    });
  } catch (err) {
    await new ConfigRepo(env.DB).setPlain('backup_last_failure_at', String(now), now);
    emitBackupMetrics(metrics, ctx, { outcome: 'failure' });
    // Re-throw so the cron surfaces the failure to Cloudflare's execution log.
    throw err;
  }
}

// ─── Metrics helpers ─────────────────────────────────────────────────────

function buildMetricsSink(env: Env): MetricsSink | undefined {
  if (!env.GRAFANA_OTLP_URL || !env.GRAFANA_OTLP_USER || !env.GRAFANA_OTLP_TOKEN) {
    return undefined;
  }
  return new OtlpMetricsSink(
    {
      baseUrl: env.GRAFANA_OTLP_URL,
      userId: env.GRAFANA_OTLP_USER,
      apiToken: env.GRAFANA_OTLP_TOKEN,
      resourceAttributes: {
        'service.name': 'fluxtube-dashboard',
        'service.namespace': 'production',
        'service.version': VERSION,
        instance_id: env.INSTANCE_ID ?? 'unknown',
      },
    },
    (event, fields) =>
      console.warn(
        JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event, ...(fields ?? {}) }),
      ),
  );
}

function emitBackupMetrics(
  metrics: MetricsSink | undefined,
  ctx: ExecutionContext,
  input:
    | { outcome: 'success'; sizeBytes: number; lastSuccessSec: number }
    | { outcome: 'failure' },
): void {
  if (!metrics) return;
  const ts = new Date();
  // Names use dot-style so Mimir's OTLP receiver produces
  // fluxtube_backup_runs_total / fluxtube_backup_last_success_seconds /
  // fluxtube_backup_size_bytes on the PromQL side.
  metrics.push({
    name: 'fluxtube.backup.runs_total',
    value: 1,
    ts,
    attributes: { outcome: input.outcome },
  });
  if (input.outcome === 'success') {
    metrics.push({
      name: 'fluxtube.backup.last_success_seconds',
      value: input.lastSuccessSec,
      ts,
    });
    metrics.push({
      name: 'fluxtube.backup.size_bytes',
      value: input.sizeBytes,
      ts,
    });
  }
  metrics.flush(ctx);
}

export default {
  fetch: app.fetch.bind(app),
  scheduled: scheduledHandler,
} satisfies ExportedHandler<Env>;
