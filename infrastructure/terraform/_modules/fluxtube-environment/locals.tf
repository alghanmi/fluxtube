locals {
  # ── Resource-name prefix ──────────────────────────────────────────────────
  #
  # Every Cloudflare resource in this module derives its name from this
  # prefix, so a single Cloudflare account can host N independent instances
  # by supplying different `instance_id` values from different Terraform
  # states. Naming shape:
  #
  #   instance_id = "alghanmi"
  #     → prefix                = "fluxtube-alghanmi"
  #     → sync worker           = "fluxtube-alghanmi-sync"
  #     → dashboard worker      = "fluxtube-alghanmi-dashboard"
  #     → d1 database           = "fluxtube-alghanmi"
  #     → r2 backup bucket      = "fluxtube-alghanmi-backups"
  #     → pages project         = "fluxtube-alghanmi-dashboard"
  prefix                = format("fluxtube-%s", var.instance_id)
  sync_worker_name      = format("%s-sync", local.prefix)
  dashboard_worker_name = format("%s-dashboard", local.prefix)
  d1_name               = local.prefix
  backup_bucket_name    = format("%s-backups", local.prefix)
  pages_project_name    = format("%s-dashboard", local.prefix)

  # ── Sync worker plain_text (unchanged from v0) ────────────────────────────
  sync_worker_vars = {
    MINIFLUX_URL              = var.miniflux_url
    CATEGORY_PLAYLIST_MAPPING = var.category_playlist_mapping
    SYNC_LOG_LEVEL            = var.sync_log_level
    HEARTBEAT_URL             = var.heartbeat_url
    HEARTBEAT_URL_AUTH        = var.heartbeat_url_auth
    HEARTBEAT_URL_QUOTA       = var.heartbeat_url_quota
    GRAFANA_LOKI_URL          = var.grafana_loki_url
    GRAFANA_LOKI_USER         = var.grafana_loki_user
    GRAFANA_OTLP_URL          = var.grafana_otlp_url
    GRAFANA_OTLP_USER         = var.grafana_otlp_user
  }

  # ── Dashboard worker plain_text ───────────────────────────────────────────
  #
  # Non-secret env for the dashboard worker. Secrets (SESSION_SIGNING_KEY,
  # D1_KEYCHAIN, MANUAL_TRIGGER_TOKEN, YOUTUBE_CLIENT_ID/SECRET) are wired
  # separately via secret_text bindings so their values don't appear in
  # the `bindings` API response body.
  dashboard_worker_vars = {
    RP_ID             = var.dashboard_domain
    RP_NAME           = "FluxTube"
    INSTANCE_ID       = var.instance_id
    GRAFANA_LOKI_URL  = var.grafana_loki_url
    GRAFANA_LOKI_USER = var.grafana_loki_user
    GRAFANA_OTLP_URL  = var.grafana_otlp_url
    GRAFANA_OTLP_USER = var.grafana_otlp_user
  }

  # ── Placeholder script written on first apply ─────────────────────────────
  #
  # Both Workers get replaced by wrangler deploy immediately after Terraform
  # provisions the script resource. Ignoring `content` + `main_module`
  # keeps Terraform from reverting the wrangler-uploaded bundle on
  # subsequent applies.
  placeholder_script = <<-EOT
    export default {
      async fetch(_req, _env, _ctx) {
        return new Response("placeholder — replaced by wrangler deploy", { status: 503 });
      },
      async scheduled(_event, _env, _ctx) {
        console.log("placeholder — replaced by wrangler deploy");
      },
    };
  EOT
}
