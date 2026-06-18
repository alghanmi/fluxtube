variable "cloudflare_api_token" {
  description = "Cloudflare API token scoped to Workers, D1, and R2. Sourced from CLOUDFLARE_API_TOKEN secret."
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID. Sourced from CF_ACCOUNT_ID secret."
  type        = string
}

variable "miniflux_url" {
  description = "Miniflux instance base URL — no trailing slash."
  type        = string
}

variable "category_playlist_mapping" {
  description = "JSON-encoded array of {category, playlist_id} entries."
  type        = string
}

variable "sync_log_level" {
  description = "Worker log level: debug, info, warn, or error."
  type        = string
  default     = "info"
}

variable "heartbeat_url" {
  description = "Healthchecks.io ping base URL — no trailing slash, no /fail suffix. Empty disables heartbeats."
  type        = string
  default     = ""
}

variable "heartbeat_url_auth" {
  description = "Healthchecks.io ping URL for invalid_grant FatalError. Empty disables auth-specific alert."
  type        = string
  default     = ""
}

variable "heartbeat_url_quota" {
  description = "Healthchecks.io ping URL for quota_exhausted FatalError. Empty disables quota-specific alert."
  type        = string
  default     = ""
}

variable "cron_schedule" {
  description = "Cron schedule for the Worker scheduled handler."
  type        = string
  default     = "*/30 * * * *"
}

variable "cron_enabled" {
  description = "Whether to create the Worker cron trigger. Set to false during cutover or to deploy without a scheduled handler."
  type        = bool
  default     = true
}

variable "grafana_loki_url" {
  description = "Grafana Cloud Loki base URL. Empty disables log shipping."
  type        = string
  default     = ""
}

variable "grafana_loki_user" {
  description = "Grafana Cloud user ID (numeric). Empty disables log shipping."
  type        = string
  default     = ""
}

variable "grafana_otlp_url" {
  description = "Grafana Cloud OTLP/HTTP base URL. Empty disables metrics shipping."
  type        = string
  default     = ""
}

variable "grafana_otlp_user" {
  description = "Grafana Cloud user ID (numeric) for OTLP metrics. Empty disables shipping."
  type        = string
  default     = ""
}
