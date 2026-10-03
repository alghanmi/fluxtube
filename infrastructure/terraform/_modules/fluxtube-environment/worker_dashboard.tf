removed {
  from = cloudflare_workers_script.dashboard
  lifecycle {
    destroy = false
  }
}

import {
  to = cloudflare_worker.dashboard
  id = "${var.cloudflare_account_id}/${local.dashboard_worker_name}"
}

resource "cloudflare_worker" "dashboard" {
  account_id = var.cloudflare_account_id
  name       = local.dashboard_worker_name
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

resource "cloudflare_workers_cron_trigger" "dashboard" {
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_worker.dashboard.name
  schedules   = var.dashboard_cron_enabled ? [{ cron = var.dashboard_cron_schedule }] : []
}
