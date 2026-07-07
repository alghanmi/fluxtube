variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the Workers, D1, R2, and Pages resources."
  type        = string
}

# ── Multi-instance identity (Phase 7) ────────────────────────────────────────
#
# `instance_id` becomes the prefix for every resource name. One Cloudflare
# account can host N independent FluxTube instances by supplying different
# `instance_id` values from different Terraform states. The value also lands
# in the backup payloads (`instance_id` field) so a cross-instance restore
# is disambiguable.

variable "instance_id" {
  description = "Multi-instance identifier — becomes the prefix for every resource name (e.g. \"alghanmi\" → \"fluxtube-alghanmi-sync\")."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.instance_id)) && length(var.instance_id) <= 32
    error_message = "instance_id must match ^[a-z0-9-]+$ and be at most 32 characters."
  }
}

variable "dashboard_domain" {
  description = "Public hostname the dashboard PWA is served from (e.g. \"fluxtube.example.com\"). Used as the WebAuthn relying-party ID + as the OAuth callback host."
  type        = string
}

variable "history_window" {
  description = "Maximum number of mapping snapshots kept in mapping_history. UI setting default; users can bump it per instance."
  type        = number
  default     = 10

  validation {
    condition     = var.history_window >= 1 && var.history_window <= 100
    error_message = "history_window must be between 1 and 100."
  }
}

# ── Sync worker (v0 config, retained during dual-mode overlap) ───────────────

variable "miniflux_url" {
  description = "Miniflux instance base URL, no trailing slash. Only read while the sync worker is in env-managed mode (before Phase 9 cutover flips the D1_MANAGED flag)."
  type        = string
  default     = ""
}

variable "category_playlist_mapping" {
  description = "JSON-encoded array of {category, playlist_id} entries. Only read in env-managed mode."
  type        = string
  default     = "[]"
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
  description = "Cron expression for the sync Worker's scheduled handler."
  type        = string
  default     = "*/30 * * * *"
}

variable "cron_enabled" {
  description = "Whether to create the sync Worker's cron trigger."
  type        = bool
  default     = true
}

# ── Dashboard worker (Phase 7 additions) ─────────────────────────────────────

variable "dashboard_cron_schedule" {
  description = "Cron expression for the dashboard Worker's nightly backup scheduled handler."
  type        = string
  default     = "15 4 * * *"
}

variable "dashboard_cron_enabled" {
  description = "Whether to create the dashboard Worker's cron trigger."
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  description = "R2 lifecycle rule — delete backup objects older than this many days."
  type        = number
  default     = 120
}

# ── Dashboard secrets (Phase 7) ──────────────────────────────────────────────
#
# All of these are wired via secret_text bindings, not plain_text — the API
# response for a bindings list masks their values. They come from Bitwarden
# via the deploy companion's sync-worker-secrets.sh at rotation time.

variable "session_signing_key" {
  description = "32-byte base64 HMAC key used by the dashboard Worker for session + challenge cookies."
  type        = string
  sensitive   = true
}

variable "d1_keychain" {
  description = "JSON keychain: {\"current\":N,\"keys\":{\"N\":\"<b64 32-byte key>\"}}. Used by both the dashboard Worker (encrypt) and sync Worker (decrypt) for at-rest column crypto."
  type        = string
  sensitive   = true
}

variable "manual_trigger_token" {
  description = "Bearer token accepted by both Workers for operator-script auth (trigger-sync.sh, deploy-time smoke tests)."
  type        = string
  sensitive   = true
}

variable "youtube_client_id" {
  description = "Google Cloud OAuth 2.0 Web application client id. Redirect URI must be https://{dashboard_domain}/api/auth/youtube/callback."
  type        = string
  sensitive   = true
}

variable "youtube_client_secret" {
  description = "Matching OAuth client secret."
  type        = string
  sensitive   = true
}

# ── Observability (unchanged from v0) ────────────────────────────────────────

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
