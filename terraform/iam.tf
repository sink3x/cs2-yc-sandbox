# Game VM: may read/write the backup bucket (through the static key below) – nothing else.
resource "yandex_iam_service_account" "cs2" {
  name        = "${var.name_prefix}-game"
  description = "CS2 VM: backups to Object Storage"
}

# Panel VM: may start/stop VMs in this folder – through the metadata-service token, no keys on disk.
resource "yandex_iam_service_account" "admin" {
  name        = "${var.name_prefix}-panel"
  description = "Admin panel: start/stop the CS2 VM"
}

resource "yandex_resourcemanager_folder_iam_member" "cs2_storage" {
  folder_id = var.folder_id
  role      = "storage.editor"
  member    = "serviceAccount:${yandex_iam_service_account.cs2.id}"
}

resource "yandex_resourcemanager_folder_iam_member" "admin_compute" {
  folder_id = var.folder_id
  role      = "compute.operator"
  member    = "serviceAccount:${yandex_iam_service_account.admin.id}"
}

resource "yandex_iam_service_account_static_access_key" "cs2" {
  service_account_id = yandex_iam_service_account.cs2.id
  description        = "CS2 VM backups"
}
