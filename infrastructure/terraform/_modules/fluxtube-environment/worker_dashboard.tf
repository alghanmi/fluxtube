# ── Dashboard worker script (Phase 7) ───────────────────────────────────────
#
# Same ownership split as the sync worker: Terraform owns bindings +
# metadata, wrangler owns the JS bundle (`content` / `main_module` are
# ignored on subsequent applies).
#
# Bindings:
#
#   DB               — same D1 as the sync Worker (shared state)
#   BACKUPS          — the R2 bucket declared in r2.tf
#   SYNC             — service binding to the sync Worker so
#                      POST /api/sync/trigger can forward without going
#                      through the public internet
#
# Secrets (all secret_text — API response body masks the values):
#   SESSION_SIGNING_KEY  — HMAC key for session + WebAuthn challenge cookies
#   D1_KEYCHAIN          — AES-GCM key set for at-rest column crypto
#   MANUAL_TRIGGER_TOKEN — shared with the sync Worker for operator scripts
#   YOUTUBE_CLIENT_ID    — OAuth 2.0 web client id
#   YOUTUBE_CLIENT_SECRET — matching client secret
#
# Plain-text env:
#   RP_ID          — WebAuthn relying-party ID = dashboard_domain
#   RP_NAME        — human-readable RP name shown by authenticators
#   INSTANCE_ID    — lands in every backup payload for multi-instance
#                    disambiguation
#   GRAFANA_*      — same log/metric endpoints as the sync Worker

locals {
  dashboard_required_plain_text = {
    RP_ID       = local.dashboard_worker_vars.RP_ID
    RP_NAME     = local.dashboard_worker_vars.RP_NAME
    INSTANCE_ID = local.dashboard_worker_vars.INSTANCE_ID
  }

  dashboard_optional_plain_text = {
    GRAFANA_LOKI_URL  = local.dashboard_worker_vars.GRAFANA_LOKI_URL
    GRAFANA_LOKI_USER = local.dashboard_worker_vars.GRAFANA_LOKI_USER
    GRAFANA_OTLP_URL  = local.dashboard_worker_vars.GRAFANA_OTLP_URL
    GRAFANA_OTLP_USER = local.dashboard_worker_vars.GRAFANA_OTLP_USER
  }
}

resource "cloudflare_workers_script" "dashboard" {
  account_id          = var.cloudflare_account_id
  script_name         = local.dashboard_worker_name
  content             = local.placeholder_script
  main_module         = "worker.js"
  compatibility_date  = "2025-05-01"
  compatibility_flags = ["nodejs_compat"]

  bindings = concat(
    [
      for k, v in local.dashboard_required_plain_text : { name = k, type = "plain_text", text = v }
    ],
    [
      for k, v in local.dashboard_optional_plain_text : { name = k, type = "plain_text", text = v }
      if v != ""
    ],
    [
      {
        name = "DB"
        type = "d1"
        id   = cloudflare_d1_database.fluxtube.id
      },
      {
        name        = "BACKUPS"
        type        = "r2_bucket"
        bucket_name = cloudflare_r2_bucket.backups.name
      },
      {
        name    = "SYNC"
        type    = "service"
        service = cloudflare_workers_script.sync.script_name
        # `environment` is required by the v5 provider for service bindings;
        # "production" is the default namespace Cloudflare uses when a Worker
        # is deployed without explicit envs.
        environment = "production"
      },
      # Secrets (SESSION_SIGNING_KEY, D1_KEYCHAIN, MANUAL_TRIGGER_TOKEN,
      # YOUTUBE_CLIENT_ID/SECRET, GRAFANA_*_TOKEN, etc.) are wrangler-
      # managed, not Terraform-managed — pushed via the deploy
      # companion's scripts/sync-worker-secrets.sh (which iterates
      # Bitwarden's `FluxTube / Worker Secrets / Production` item and
      # loops over both worker names). See worker_sync.tf for the full
      # rationale.
    ],
  )

  observability = {
    enabled            = true
    head_sampling_rate = 1
    logs = {
      enabled            = true
      head_sampling_rate = 1
      invocation_logs    = true
      persist            = true
    }
    traces = {
      enabled            = false
      head_sampling_rate = 1
      persist            = true
    }
  }

  lifecycle {
    ignore_changes = [
      content,
      main_module,
    ]
  }
}

# ── Dashboard cron trigger (nightly backup) ─────────────────────────────────
#
# Fires the dashboard Worker's `scheduled` handler which calls generateBackup().
# Offset from the sync worker's `*/30 * * * *` schedule to avoid CPU
# contention on tick boundaries.
resource "cloudflare_workers_cron_trigger" "dashboard" {
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_workers_script.dashboard.script_name
  schedules   = var.dashboard_cron_enabled ? [{ cron = var.dashboard_cron_schedule }] : []
}
