resource "cloudflare_d1_database" "fluxtube" {
  account_id = var.cloudflare_account_id
  name       = local.d1_name
}
