terraform {
  required_version = ">= 1.9"

  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      # v5.26.0 can't refresh a wrangler-deployed cloudflare_workers_script:
      # "main script part "worker.js" is missing from multipart response"
      # (the resource declares a placeholder main_module; wrangler uploads the
      # real bundle under its own name). Excluded until a release fixes it.
      # The committed .terraform.lock.hcl pins the version actually used
      # (5.24.0, last proven against live state); bump it only after a real
      # `terraform plan` against production succeeds — CI's validate can't
      # catch a refresh failure.
      version = "~> 5.21, != 5.26.0"
    }
  }

  # Partial backend: every identifying value (`bucket`, `key`, `endpoints`) is
  # supplied at `terraform init` time via -backend-config flags from CI. The
  # deploy workflow (in alghanmi/fluxtube-deploy) reads TF_STATE_BUCKET +
  # TF_STATE_KEY from variables and CF_ACCOUNT_ID from a secret, builds the
  # endpoints URL inline, and passes all three. Keeps real values out of this
  # repo entirely.
  backend "s3" {
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
