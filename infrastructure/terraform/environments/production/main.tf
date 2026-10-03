terraform {
  required_version = ">= 1.9"

  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      # 5.25.0 and 5.26.0 can't refresh a wrangler-deployed
      # cloudflare_workers_script: "main script part "worker.js" is missing
      # from multipart response". 5.25.0 changed how the resource reads the
      # multipart upload; it now looks for the part named by main_module (our
      # placeholder, worker.js), but wrangler uploads the real bundle under its
      # own name. Capped below 5.25.0 until a release fixes it (#197).
      #
      # The committed .terraform.lock.hcl pins 5.24.0, the last version proven
      # against live state. Bump it only after `make plan` (fluxtube-deploy)
      # succeeds against production: CI's validate can't catch a refresh
      # failure, which is how the 5.25.0 bump (#192) got merged.
      version = "~> 5.21"
    }
  }

  # Partial backend: every identifying value (`bucket`, `key`, `endpoints`) is
  # supplied at `terraform init` time via -backend-config flags from CI. The
  # deploy workflow (in alghanmi/fluxtube-deploy) reads TF_STATE_BUCKET +
  # TF_STATE_KEY from variables and CF_ACCOUNT_ID from a secret, builds the
  # endpoints URL inline, and passes all three. Keeps real values out of this
  # repo entirely.
  backend "s3" {
    use_lockfile                = true
    region                      = "auto"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_path_style              = true
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

module "fluxtube" {
  source = "../../_modules/fluxtube-environment"

  cloudflare_account_id = var.cloudflare_account_id

  # Multi-instance identity
  instance_id      = var.instance_id
  dashboard_domain = var.dashboard_domain
  history_window   = var.history_window

  # Sync worker (env-managed mode overlap)
  miniflux_url              = var.miniflux_url
  category_playlist_mapping = var.category_playlist_mapping
  sync_log_level            = var.sync_log_level
  heartbeat_url             = var.heartbeat_url
  heartbeat_url_auth        = var.heartbeat_url_auth
  heartbeat_url_quota       = var.heartbeat_url_quota
  cron_schedule             = var.cron_schedule
  cron_enabled              = var.cron_enabled

  # Dashboard worker
  dashboard_cron_schedule = var.dashboard_cron_schedule
  dashboard_cron_enabled  = var.dashboard_cron_enabled
  backup_retention_days   = var.backup_retention_days

  # Observability
  grafana_loki_url  = var.grafana_loki_url
  grafana_loki_user = var.grafana_loki_user
  grafana_otlp_url  = var.grafana_otlp_url
  grafana_otlp_user = var.grafana_otlp_user
}

output "instance_id" {
  value = module.fluxtube.instance_id
}

output "prefix" {
  value = module.fluxtube.prefix
}

output "sync_worker_name" {
  value = module.fluxtube.sync_worker_name
}

output "dashboard_worker_name" {
  value = module.fluxtube.dashboard_worker_name
}

output "d1_database_id" {
  value = module.fluxtube.d1_database_id
}

output "d1_database_name" {
  value = module.fluxtube.d1_database_name
}

output "backup_bucket_name" {
  value = module.fluxtube.backup_bucket_name
}

output "pages_project_name" {
  value = module.fluxtube.pages_project_name
}

output "dashboard_domain" {
  value = module.fluxtube.dashboard_domain
}

output "sync_cron_schedule" {
  value = module.fluxtube.sync_cron_schedule
}

output "dashboard_cron_schedule" {
  value = module.fluxtube.dashboard_cron_schedule
}

output "var_MINIFLUX_URL" { value = module.fluxtube.var_MINIFLUX_URL }
output "var_CATEGORY_PLAYLIST_MAPPING" { value = module.fluxtube.var_CATEGORY_PLAYLIST_MAPPING }
output "var_SYNC_LOG_LEVEL" { value = module.fluxtube.var_SYNC_LOG_LEVEL }
output "var_INSTANCE_ID" { value = module.fluxtube.var_INSTANCE_ID }
output "var_HEARTBEAT_URL" { value = module.fluxtube.var_HEARTBEAT_URL }
output "var_HEARTBEAT_URL_AUTH" { value = module.fluxtube.var_HEARTBEAT_URL_AUTH }
output "var_HEARTBEAT_URL_QUOTA" { value = module.fluxtube.var_HEARTBEAT_URL_QUOTA }
output "var_GRAFANA_LOKI_URL" { value = module.fluxtube.var_GRAFANA_LOKI_URL }
output "var_GRAFANA_LOKI_USER" { value = module.fluxtube.var_GRAFANA_LOKI_USER }
output "var_GRAFANA_OTLP_URL" { value = module.fluxtube.var_GRAFANA_OTLP_URL }
output "var_GRAFANA_OTLP_USER" { value = module.fluxtube.var_GRAFANA_OTLP_USER }

output "var_RP_ID" { value = module.fluxtube.var_RP_ID }
output "var_RP_NAME" { value = module.fluxtube.var_RP_NAME }
