# ── Bindings: collapsed into a single typed list ────────────────────────────
#
# v4 used per-binding-type HCL blocks (`plain_text_binding {}`,
# `d1_database_binding {}`). v5 collapses them into a single `bindings`
# attribute — a list of objects discriminated by a `type` field. The two
# locals below split the plain_text bindings into "required" (always
# present) and "optional" (only emitted when non-empty) so the conditional
# logic from the old `dynamic` blocks survives without re-introducing
# block syntax.
locals {
  sync_required_plain_text = {
    MINIFLUX_URL              = local.sync_worker_vars.MINIFLUX_URL
    CATEGORY_PLAYLIST_MAPPING = local.sync_worker_vars.CATEGORY_PLAYLIST_MAPPING
    SYNC_LOG_LEVEL            = local.sync_worker_vars.SYNC_LOG_LEVEL
  }

  # Cloudflare's API rejects plain_text bindings whose text is empty, so we
  # filter empties out before reaching the resource. The Worker code already
  # treats missing env vars as "feature disabled" — no behavior change.
  sync_optional_plain_text = {
    HEARTBEAT_URL       = local.sync_worker_vars.HEARTBEAT_URL
    HEARTBEAT_URL_AUTH  = local.sync_worker_vars.HEARTBEAT_URL_AUTH
    HEARTBEAT_URL_QUOTA = local.sync_worker_vars.HEARTBEAT_URL_QUOTA
    GRAFANA_LOKI_URL    = local.sync_worker_vars.GRAFANA_LOKI_URL
    GRAFANA_LOKI_USER   = local.sync_worker_vars.GRAFANA_LOKI_USER
    GRAFANA_OTLP_URL    = local.sync_worker_vars.GRAFANA_OTLP_URL
    GRAFANA_OTLP_USER   = local.sync_worker_vars.GRAFANA_OTLP_USER
  }
}

# ── The sync Worker script ──────────────────────────────────────────────────
#
# Ownership split:
#   - Terraform owns:  bindings (D1, plain_text vars, secrets), metadata
#                      (compatibility_date, compatibility_flags),
#                      observability config.
#   - wrangler owns:   the JS bundle (`content`) and entry-module name
#                      (`main_module`) — see lifecycle.ignore_changes below.
resource "cloudflare_workers_script" "sync" {
  account_id          = var.cloudflare_account_id
  script_name         = local.sync_worker_name
  content             = local.placeholder_script
  main_module         = "worker.js"
  compatibility_date  = "2025-05-01"
  compatibility_flags = ["nodejs_compat"]

  bindings = concat(
    [for k, v in local.sync_required_plain_text : { name = k, type = "plain_text", text = v }],
    [
      for k, v in local.sync_optional_plain_text : { name = k, type = "plain_text", text = v }
      if v != ""
    ],
    [
      {
        name = "DB"
        type = "d1"
        id   = cloudflare_d1_database.fluxtube.id
      },
      # v1: the sync Worker reads config.youtube_refresh_token from D1
      # (encrypted). Both Workers need the same keychain to decrypt.
      {
        name = "D1_KEYCHAIN"
        type = "secret_text"
        text = var.d1_keychain
      },
      {
        name = "MANUAL_TRIGGER_TOKEN"
        type = "secret_text"
        text = var.manual_trigger_token
      },
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

# ── Cron trigger ────────────────────────────────────────────────────────────
#
# `var.cron_enabled` toggles `schedules` between an empty list and the
# configured cron expression. Empty = "no scheduled invocations" — the
# cron stops firing without destroying the resource.
resource "cloudflare_workers_cron_trigger" "sync" {
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_workers_script.sync.script_name
  schedules   = var.cron_enabled ? [{ cron = var.cron_schedule }] : []
}
