variable "cloudflare_api_token" {
  description = "Cloudflare API token scoped to Workers, D1, R2, and Pages. Sourced from CLOUDFLARE_API_TOKEN secret."
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID. Sourced from CF_ACCOUNT_ID secret."
  type        = string
}

# ── Multi-instance identity (Phase 7) ────────────────────────────────────────

variable "instance_id" {
  description = "Multi-instance identifier — becomes the prefix for every resource name."
  type        = string
}

variable "dashboard_domain" {
  description = "Public hostname the dashboard PWA is served from."
  type        = string
}

variable "history_window" {
  description = "Default max mapping snapshots kept in mapping_history."
  type        = number
  default     = 10
}

# ── Sync worker (env-managed mode, retained during dual-mode overlap) ────────

variable "miniflux_url" {
  description = "Miniflux instance base URL — no trailing slash. Only read in env-managed mode."
  type        = string
  default     = ""
}

variable "category_playlist_mapping" {
  description = "JSON-encoded array of {category, playlist_id} entries. Only read in env-managed mode."
  type        = string
  default     = "[]"
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
  description = "Cron schedule for the sync Worker's scheduled handler."
  type        = string
  default     = "*/30 * * * *"
}

variable "cron_enabled" {
  description = "Whether to create the sync Worker's cron trigger."
  type        = bool
  default     = true
}

# ── Dashboard worker (Phase 7) ───────────────────────────────────────────────

variable "dashboard_cron_schedule" {
  description = "Cron schedule for the dashboard Worker's nightly backup."
  type        = string
  default     = "15 4 * * *"
}

variable "dashboard_cron_enabled" {
  description = "Whether to create the dashboard Worker's cron trigger."
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  description = "R2 lifecycle rule — delete backups older than this many days."
  type        = number
  default     = 120
}

# ── Dashboard secrets (Phase 7) ──────────────────────────────────────────────

variable "session_signing_key" {
  description = "32-byte base64 HMAC key. Sourced from Bitwarden via the deploy companion."
  type        = string
  sensitive   = true
}

variable "d1_keychain" {
  description = "JSON keychain for at-rest column crypto. Sourced from Bitwarden."
  type        = string
  sensitive   = true
}

variable "manual_trigger_token" {
  description = "Shared bearer token for operator scripts. Sourced from Bitwarden."
  type        = string
  sensitive   = true
}

variable "youtube_client_id" {
  description = "Google Cloud OAuth 2.0 client id."
  type        = string
  sensitive   = true
}

variable "youtube_client_secret" {
  description = "Matching OAuth client secret."
  type        = string
  sensitive   = true
}

# ── Observability ───────────────────────────────────────────────────────────

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
