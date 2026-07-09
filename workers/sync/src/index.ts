import { ping } from './heartbeat';
import { createLogger, parseLogLevel } from './logger';
import { LokiSink } from './logsink';
import { emitRunMetrics, OtlpMetricsSink } from './metricsink';
import { MinifluxClient } from './miniflux';
import { handleFetch } from './router';
import { loadRuntimeConfig, type NormalizedRuntimeConfig } from './runtime_config';
import { QueueState } from './state';
import { runSync, type SyncDeps } from './sync';
import { FatalError } from './types';
import { YouTubeClient } from './youtube';
import type { LogSink } from './logsink';
import type { MetricsSink } from './metricsink';
import type { Env } from './types';
import type { Logger } from './logger';

/**
 * Deps for a single sync run. Miniflux + YouTube refresh token come from
 * the normalized runtime config so both env-mode and D1-mode work through
 * the same wiring. YOUTUBE_CLIENT_ID / _SECRET stay platform-level in env
 * per the plan's config split.
 */
function buildDeps(runtime: NormalizedRuntimeConfig, env: Env, logger: Logger): SyncDeps {
  const miniflux = new MinifluxClient(runtime.minifluxUrl, runtime.minifluxApiToken);
  const youtube = new YouTubeClient({
    clientId: env.YOUTUBE_CLIENT_ID,
    clientSecret: env.YOUTUBE_CLIENT_SECRET,
    refreshToken: runtime.youtubeRefreshToken,
  });
  const state = new QueueState(env.DB);
  return { miniflux, youtube, state, logger };
}

/**
 * Construct a LokiSink iff all three GRAFANA_LOKI_* env vars are set.
 * A `run_id` label is added so the operator can group all lines from a
 * single invocation in Grafana Explore (`{run_id="..."}`).
 */
function buildLokiSink(env: Env, runId: string): LogSink | undefined {
  if (!env.GRAFANA_LOKI_URL || !env.GRAFANA_LOKI_USER || !env.GRAFANA_LOKI_TOKEN) {
    return undefined;
  }
  return new LokiSink(
    {
      baseUrl: env.GRAFANA_LOKI_URL,
      userId: env.GRAFANA_LOKI_USER,
      apiToken: env.GRAFANA_LOKI_TOKEN,
      labels: {
        app: 'fluxtube',
        env: 'production',
        instance_id: env.INSTANCE_ID ?? 'unknown',
        run_id: runId,
        version: VERSION,
      },
    },
    warnToStderr,
  );
}

/**
 * Construct an OtlpMetricsSink iff all three GRAFANA_OTLP_* env vars are
 * set. `service.instance.id` carries the run_id so an operator can pivot
 * from a Loki log line to its metric data points using the same UUID.
 */
function buildMetricsSink(env: Env, runId: string): MetricsSink | undefined {
  if (!env.GRAFANA_OTLP_URL || !env.GRAFANA_OTLP_USER || !env.GRAFANA_OTLP_TOKEN) {
    return undefined;
  }
  return new OtlpMetricsSink(
    {
      baseUrl: env.GRAFANA_OTLP_URL,
      userId: env.GRAFANA_OTLP_USER,
      apiToken: env.GRAFANA_OTLP_TOKEN,
      resourceAttributes: {
        'service.name': 'fluxtube',
        'service.namespace': 'production',
        'service.instance.id': runId,
        'service.version': VERSION,
        instance_id: env.INSTANCE_ID ?? 'unknown',
      },
    },
    warnToStderr,
  );
}

// Use console.warn directly rather than the logger so a sink that fails
// while emitting its own warn line can't recurse back into itself.
function warnToStderr(event: string, fields?: Record<string, unknown>): void {
  console.warn(
    JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event, ...(fields ?? {}) }),
  );
}

function fatalOutcome(err: unknown): 'fatal_invalid_grant' | 'fatal_quota_exhausted' | 'fatal_other' {
  if (err instanceof FatalError) {
    if (err.reason === 'invalid_grant') return 'fatal_invalid_grant';
    if (err.reason === 'quota_exhausted') return 'fatal_quota_exhausted';
  }
  return 'fatal_other';
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const runId = crypto.randomUUID();
    const sink = buildLokiSink(env, runId);
    const metrics = buildMetricsSink(env, runId);
    const startedAt = new Date();

    // Dual-mode config load. In D1-managed mode (admin_passkey present)
    // this reads mappings + credentials from D1; otherwise it falls back
    // to env vars — exact same shape either way.
    let runtime: NormalizedRuntimeConfig;
    try {
      runtime = await loadRuntimeConfig(env);
    } catch (err) {
      // Bootstrap logger uses env-only log level since runtime failed to load.
      const bootstrapLogger = createLogger(parseLogLevel(env.SYNC_LOG_LEVEL), sink);
      bootstrapLogger.error('sync_config_load_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      if (env.HEARTBEAT_URL) {
        ctx.waitUntil(ping(env.HEARTBEAT_URL, 'fail', bootstrapLogger));
      }
      bootstrapLogger.flush(ctx);
      throw err;
    }

    // Post-load: log level comes from the resolved runtime (env or D1-derived).
    const logger = createLogger(parseLogLevel(runtime.syncLogLevel), sink);

    // Common attributes for every OTLP data point. instance_id lives as a
    // per-sample attribute (Prometheus label) so Grafana's label_values()
    // template variable finds it. Resource-attribute-only labels land on
    // target_info, not on individual metric series.
    const commonAttributes: Record<string, string> = {
      instance_id: env.INSTANCE_ID ?? 'unknown',
    };

    // Optional start-ping; fire-and-forget but kept alive past the handler.
    if (env.HEARTBEAT_URL) {
      ctx.waitUntil(ping(env.HEARTBEAT_URL, 'start', logger));
    }

    try {
      const summary = await runSync(runtime.mappings, buildDeps(runtime, env, logger));

      if (metrics) {
        emitRunMetrics(metrics, summary, 'success', startedAt, commonAttributes);
        metrics.flush(ctx);
      }
      if (env.HEARTBEAT_URL) {
        ctx.waitUntil(ping(env.HEARTBEAT_URL, 'success', logger));
      }
      logger.flush(ctx);
    } catch (err) {
      const reason =
        err instanceof FatalError
          ? err.reason
          : err instanceof Error
            ? err.name || 'unknown'
            : 'unknown';
      logger.error('fatal', {
        reason,
        message: err instanceof Error ? err.message : String(err),
      });

      // Per-reason failure routing: a FatalError tagged invalid_grant pings
      // the AUTH check; quota_exhausted pings the QUOTA check. Both are
      // optional; missing URLs are no-ops. The main HEARTBEAT_URL is always
      // pinged in addition so the primary dashboard view stays correlated.
      if (err instanceof FatalError) {
        if (err.reason === 'invalid_grant' && env.HEARTBEAT_URL_AUTH) {
          ctx.waitUntil(ping(env.HEARTBEAT_URL_AUTH, 'fail', logger));
        }
        if (err.reason === 'quota_exhausted' && env.HEARTBEAT_URL_QUOTA) {
          ctx.waitUntil(ping(env.HEARTBEAT_URL_QUOTA, 'fail', logger));
        }
      }
      if (env.HEARTBEAT_URL) {
        ctx.waitUntil(ping(env.HEARTBEAT_URL, 'fail', logger));
      }
      // Emit the fluxtube.runs metric with the failure outcome so the
      // success-rate panel reflects the run. We don't emit the per-summary
      // gauges — runSync didn't return a summary.
      if (metrics) {
        metrics.push({
          name: 'fluxtube.runs',
          value: 1,
          ts: startedAt,
          attributes: { ...commonAttributes, outcome: fatalOutcome(err) },
        });
        metrics.flush(ctx);
      }
      logger.flush(ctx);
      throw err;
    }
  },

  // Manual operator endpoints. Auth + routing live in `router.ts`.
  // Intentionally does NOT ping Healthchecks — those are the cron's dead-man
  // switch; satisfying them from a manual call would mask a stuck schedule.
  // The MetricsSink is built but only emitted from inside `runSync` paths
  // (the router calls runSync for /sync, but not for /audit) — flushed
  // unconditionally in `finally` so any buffered points (e.g. a manual /sync
  // run) ship before the request returns.
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const runId = crypto.randomUUID();
    const sink = buildLokiSink(env, runId);
    const metrics = buildMetricsSink(env, runId);

    let runtime: NormalizedRuntimeConfig;
    try {
      runtime = await loadRuntimeConfig(env);
    } catch (err) {
      // 503 so operator scripts see a clear failure rather than a stale 401.
      // Body carries the failure detail — safe because /sync + /audit are
      // Bearer-token-gated in router.ts.
      const bootstrapLogger = createLogger(parseLogLevel(env.SYNC_LOG_LEVEL), sink);
      bootstrapLogger.error('sync_config_load_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      bootstrapLogger.flush(ctx);
      return new Response(
        JSON.stringify({
          error: 'config_unavailable',
          message: err instanceof Error ? err.message : String(err),
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const logger = createLogger(parseLogLevel(runtime.syncLogLevel), sink);
    const commonAttributes: Record<string, string> = {
      instance_id: env.INSTANCE_ID ?? 'unknown',
    };
    try {
      return await handleFetch(
        request,
        env,
        ctx,
        logger,
        buildDeps(runtime, env, logger),
        runtime.mappings,
        metrics,
        commonAttributes,
      );
    } finally {
      metrics?.flush(ctx);
      logger.flush(ctx);
    }
  },
} satisfies ExportedHandler<Env>;
