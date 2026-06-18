variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the Worker, D1, and cron resources."
  type        = string
}

variable "name_suffix" {
  description = "Suffix appended to resource names for environment isolation (e.g. \"\" or \"-dev\")."
  type        = string
  default     = ""
}

variable "miniflux_url" {
  description = "Miniflux instance base URL, no trailing slash."
  type        = string
}

variable "category_playlist_mapping" {
  description = "JSON-encoded array of {category, playlist_id} entries."
  type        = string
}

variable "sync_log_level" {
  description = "One of: debug, info, warn, error."
  type        = string
  default     = "info"

  validation {
    condition     = contains(["debug", "info", "warn", "error"], var.sync_log_level)
    error_message = "sync_log_level must be one of: debug, info, warn, error."
  }
}

variable "heartbeat_url" {
  description = "Healthchecks.io base URL — no trailing slash, no /fail suffix. Empty disables heartbeats."
  type        = string
  default     = ""
}

variable "heartbeat_url_auth" {
  description = "Healthchecks.io base URL pinged on invalid_grant FatalError. Empty = no auth-specific alert."
  type        = string
  default     = ""
}

variable "heartbeat_url_quota" {
  description = "Healthchecks.io base URL pinged on quota_exhausted FatalError. Empty = no quota-specific alert."
  type        = string
  default     = ""
}

variable "cron_schedule" {
  description = "Cron expression for the Worker scheduled handler."
  type        = string
  default     = "*/30 * * * *"
}

variable "cron_enabled" {
  description = "Whether to create the cron trigger. Set to false during cutover or to deploy a Worker without a scheduled handler."
  type        = bool
  default     = true
}

variable "grafana_loki_url" {
  description = "Grafana Cloud Loki base URL (e.g. https://logs-prod-006.grafana.net). Empty disables log shipping."
  type        = string
  default     = ""
}

variable "grafana_loki_user" {
  description = "Grafana Cloud user ID (numeric). Empty disables log shipping."
  type        = string
  default     = ""
}

variable "grafana_otlp_url" {
  description = "Grafana Cloud OTLP/HTTP base URL (My Account → OpenTelemetry tile). Empty disables metrics shipping."
  type        = string
  default     = ""
}

variable "grafana_otlp_user" {
  description = "Grafana Cloud numeric user ID for OTLP metrics. Empty disables shipping."
  type        = string
  default     = ""
}
