locals {
  worker_name = "fluxtube-sync${var.name_suffix}"
  d1_name     = "fluxtube${var.name_suffix}"

  worker_vars = {
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

  placeholder_script = <<-EOT
    export default {
      async scheduled(_event, _env, _ctx) {
        console.log("placeholder — replaced by wrangler deploy");
      },
    };
  EOT
}
