# ── R2 bucket for backups ───────────────────────────────────────────────────
#
# The dashboard Worker's nightly cron writes objects here via the BACKUPS
# binding. Naming shape matches the resource-name prefix pattern:
#
#   instance_id = "alghanmi" → bucket name = "fluxtube-alghanmi-backups"

resource "cloudflare_r2_bucket" "backups" {
  account_id = var.cloudflare_account_id
  name       = local.backup_bucket_name

  # Location hint — omitted so Cloudflare picks based on account default
  # (typically closest to the account's registration region). Valid values
  # are jurisdiction codes (apac, eeur, enam, weur, wnam, oc); we don't
  # constrain here since backups are read rarely and there's no
  # jurisdiction requirement for this single-tenant, single-region setup.
}

# ── Lifecycle rule: age-out old backups ─────────────────────────────────────
#
# 120-day expiration matches the RFC. Backups roll off automatically so
# the bucket doesn't grow unbounded. Restore is still possible for any
# object younger than the retention window.
resource "cloudflare_r2_bucket_lifecycle" "backups" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.backups.name

  rules = [
    {
      id      = "delete-old-backups"
      enabled = true
      conditions = {
        prefix = "fluxtube-state_"
      }
      delete_objects_transition = {
        condition = {
          # v5.21 schema: `max_age` is the attribute name (value in seconds
          # per the provider description "after an object reaches an age
          # in seconds"). Earlier drafts used `max_age_seconds` which the
          # provider silently accepts as an unknown key and then serializes
          # into malformed JSON — the API rejects with 400 "The JSON you
          # provided was not well formed."
          type    = "Age"
          max_age = var.backup_retention_days * 86400
        }
      }
    },
  ]
}
