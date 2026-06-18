output "worker_name" {
  description = "Name of the deployed Worker script."
  value       = local.worker_name
}

output "d1_database_id" {
  description = "ID of the D1 database used by the Worker."
  value       = cloudflare_d1_database.fluxtube.id
}

output "d1_database_name" {
  description = "Name of the D1 database used by the Worker."
  value       = cloudflare_d1_database.fluxtube.name
}

output "cron_schedule" {
  description = "Active cron schedule for the Worker."
  value       = var.cron_schedule
}
