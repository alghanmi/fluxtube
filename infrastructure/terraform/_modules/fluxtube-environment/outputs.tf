output "instance_id" {
  description = "The multi-instance identifier used as the resource-name prefix."
  value       = var.instance_id
}

output "prefix" {
  description = "Resource-name prefix (e.g. \"fluxtube-alghanmi\")."
  value       = local.prefix
}

output "sync_worker_name" {
  description = "Name of the deployed sync Worker script."
  value       = cloudflare_workers_script.sync.script_name
}

output "dashboard_worker_name" {
  description = "Name of the deployed dashboard Worker script."
  value       = cloudflare_workers_script.dashboard.script_name
}

output "d1_database_id" {
  description = "ID of the D1 database (shared by both Workers)."
  value       = cloudflare_d1_database.fluxtube.id
}

output "d1_database_name" {
  description = "Name of the D1 database."
  value       = cloudflare_d1_database.fluxtube.name
}

output "backup_bucket_name" {
  description = "Name of the R2 bucket used for nightly backups."
  value       = cloudflare_r2_bucket.backups.name
}

output "pages_project_name" {
  description = "Name of the Cloudflare Pages project serving the dashboard PWA."
  value       = cloudflare_pages_project.dashboard.name
}

output "dashboard_domain" {
  description = "Public hostname the dashboard PWA is served from."
  value       = var.dashboard_domain
}

output "sync_cron_schedule" {
  description = "Active cron schedule for the sync Worker."
  value       = var.cron_schedule
}

output "dashboard_cron_schedule" {
  description = "Active cron schedule for the dashboard Worker's nightly backup."
  value       = var.dashboard_cron_schedule
}
