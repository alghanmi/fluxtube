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

# ── Worker secrets — NOT Terraform-managed ──────────────────────────────────
#
# SESSION_SIGNING_KEY, D1_KEYCHAIN, MANUAL_TRIGGER_TOKEN,
# YOUTUBE_CLIENT_ID/SECRET, GRAFANA_LOKI_TOKEN, GRAFANA_OTLP_TOKEN,
# MINIFLUX_API_TOKEN, YOUTUBE_REFRESH_TOKEN — all live in Bitwarden's
# `FluxTube / Worker Secrets / Production` item and get pushed to the
# running Workers via the deploy companion's sync-worker-secrets.sh
# (which loops over both worker names). This module deliberately does
# NOT accept them as variables — Terraform's role stops at the D1 /
# R2 / KV / service bindings; the secret_text lifecycle is single-
# owned by wrangler.
#
# Trade-off documented, not just "removed": Terraform-owned
# secret_text bindings would put the value under Terraform state (so
# `terraform plan` shows drift if wrangler clobbers it), which is a
# real property. The counter-argument that wins for FluxTube: the
# interaction between `wrangler deploy` and Terraform-set secrets
# isn't crisp in Cloudflare's docs, and the operator's mental model
# stays simpler with one channel (wrangler) owning secrets end-to-end.

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
