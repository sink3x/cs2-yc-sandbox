output "game_ip" {
  value = yandex_vpc_address.cs2.external_ipv4_address[0].address
}

output "connect" {
  value = "connect ${yandex_vpc_address.cs2.external_ipv4_address[0].address}:27015"
}

output "panel_url" {
  value = "https://${local.panel_host}"
}

output "panel_ip" {
  value = yandex_vpc_address.admin.external_ipv4_address[0].address
}

output "cs2_instance_id" {
  value = yandex_compute_instance.cs2.id
}

output "backup_bucket" {
  value = yandex_storage_bucket.backups.bucket
}

# Used by scripts/deploy.sh to give the provider S3 credentials for the bucket (never printed).
output "storage_access_key" {
  value     = yandex_iam_service_account_static_access_key.cs2.access_key
  sensitive = true
}

output "storage_secret_key" {
  value     = yandex_iam_service_account_static_access_key.cs2.secret_key
  sensitive = true
}
