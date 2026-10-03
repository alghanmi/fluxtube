removed {
  from = cloudflare_workers_script.sync
  lifecycle {
    destroy = false
  }
}

import {
  to = cloudflare_worker.sync
  id = "${var.cloudflare_account_id}/${local.sync_worker_name}"
}

resource "cloudflare_worker" "sync" {
  account_id = var.cloudflare_account_id
  name       = local.sync_worker_name
  content    = local.placeholder_script

  observability = {
    enabled            = true
    head_sampling_rate = 1
    logs = {
      enabled            = true
      head_sampling_rate = 1
      invocation_logs    = true
      persist            = true
    }
    traces = {
      enabled            = false
      head_sampling_rate = 1
      persist            = true
    }
  }

  lifecycle {
    ignore_changes = [
      content,
    ]
  }
}

resource "cloudflare_workers_cron_trigger" "sync" {
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_worker.sync.name
  schedules   = var.cron_enabled ? [{ cron = var.cron_schedule }] : []
}
