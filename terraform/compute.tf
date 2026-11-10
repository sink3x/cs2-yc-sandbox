data "yandex_compute_image" "ubuntu" {
  # Ubuntu 24.04: CS2 + CounterStrikeSharp are tested on it; 25.04 / Debian 13 hit an execstack problem.
  family = "ubuntu-2404-lts"
}

locals {
  bundle_path = "${path.module}/../build/bundle.tgz"
  public_path = "${path.module}/../build/public.tgz"

  ssh_metadata = var.ssh_public_key == "" ? {} : { "ssh-keys" = "ubuntu:${var.ssh_public_key}" }

  user_data_cs2 = templatefile("${path.module}/templates/user-data.yaml.tftpl", {
    bootstrap_b64 = base64encode(file("${path.module}/../common/bootstrap.sh"))
    unit_b64      = base64encode(file("${path.module}/../vm-cs2/systemd/cs2-bootstrap.service"))
  })
  user_data_admin = templatefile("${path.module}/templates/user-data.yaml.tftpl", {
    bootstrap_b64 = base64encode(file("${path.module}/../common/bootstrap.sh"))
    unit_b64      = base64encode(file("${path.module}/../vm-admin/systemd/cs2-bootstrap.service"))
  })

  panel_host = var.panel_domain != "" ? var.panel_domain : "${replace(yandex_vpc_address.admin.external_ipv4_address[0].address, ".", "-")}.sslip.io"

  cs2_config = {
    hostname  = var.server_hostname
    admins    = var.cs2_admins
    bucket    = yandex_storage_bucket.backups.bucket
    endpoint  = "https://storage.yandexcloud.net"
    region    = "ru-central1"
    agentPort = 8081
    agentBind = var.cs2_private_ip
  }
}

# ---- persistent data disk (survives VM re-creation; never auto-deleted) ---------------------------------
resource "yandex_compute_disk" "cs2_data" {
  name = "${var.name_prefix}-data"
  type = "network-ssd"
  zone = var.zone
  size = var.cs2_data_disk_gb

  labels = { purpose = "cs2-data" }

  lifecycle {
    prevent_destroy = true
  }
}

# ---- game VM ------------------------------------------------------------------------------------------------
resource "yandex_compute_instance" "cs2" {
  name        = "${var.name_prefix}-game"
  hostname    = "${var.name_prefix}-game"
  platform_id = var.cs2_platform
  zone        = var.zone

  service_account_id        = yandex_iam_service_account.cs2.id
  allow_stopping_for_update = true

  resources {
    cores         = var.cs2_cores
    memory        = var.cs2_memory_gb
    core_fraction = 100
  }

  boot_disk {
    auto_delete = true
    initialize_params {
      image_id = data.yandex_compute_image.ubuntu.id
      type     = "network-ssd"
      size     = 20
    }
  }

  secondary_disk {
    disk_id     = yandex_compute_disk.cs2_data.id
    device_name = "cs2data"
    auto_delete = false
  }

  network_interface {
    subnet_id          = yandex_vpc_subnet.main.id
    ip_address         = var.cs2_private_ip
    nat                = true
    nat_ip_address     = yandex_vpc_address.cs2.external_ipv4_address[0].address
    security_group_ids = [yandex_vpc_security_group.cs2.id]
  }

  scheduling_policy {
    preemptible = false
  }

  metadata = merge(local.ssh_metadata, {
    user-data   = local.user_data_cs2
    role        = "cs2"
    app-bundle  = filebase64(local.bundle_path)
    config-json = jsonencode(local.cs2_config)
    # root-only secrets (agent + backups)
    secrets-env = <<-EOT
      AGENT_TOKEN=${var.agent_token}
      S3_ACCESS_KEY=${yandex_iam_service_account_static_access_key.cs2.access_key}
      S3_SECRET_KEY=${yandex_iam_service_account_static_access_key.cs2.secret_key}
    EOT
    # secrets the game process (user steam, third-party plugins) can read anyway
    game-env = <<-EOT
      RCON_PASSWORD=${var.rcon_password}
      DB_PASSWORD=${var.db_password}
      GSLT=${var.gslt}
      STEAM_WEB_API_KEY=${var.steam_web_api_key}
    EOT
  })

  depends_on = [yandex_resourcemanager_folder_iam_member.cs2_storage]

  lifecycle {
    ignore_changes = [boot_disk[0].initialize_params[0].image_id]
  }
}

# ---- admin panel VM (always on, tiny) ------------------------------------------------------------------------
resource "yandex_compute_instance" "admin" {
  name        = "${var.name_prefix}-panel"
  hostname    = "${var.name_prefix}-panel"
  platform_id = "standard-v3"
  zone        = var.zone

  service_account_id        = yandex_iam_service_account.admin.id
  allow_stopping_for_update = true

  resources {
    cores         = var.admin_cores
    core_fraction = var.admin_core_fraction
    memory        = var.admin_memory_gb
  }

  boot_disk {
    auto_delete = true
    initialize_params {
      image_id = data.yandex_compute_image.ubuntu.id
      type     = "network-ssd"
      size     = 10
    }
  }

  network_interface {
    subnet_id          = yandex_vpc_subnet.main.id
    ip_address         = var.admin_private_ip
    nat                = true
    nat_ip_address     = yandex_vpc_address.admin.external_ipv4_address[0].address
    security_group_ids = [yandex_vpc_security_group.admin.id]
  }

  metadata = merge(local.ssh_metadata, {
    user-data  = local.user_data_admin
    role       = "admin"
    app-bundle = filebase64(local.bundle_path)
    app-public-ref = jsonencode({
      bucket = yandex_storage_bucket.backups.bucket
      key    = yandex_storage_object.public.key
      sha256 = filesha256(local.public_path)
    })
    panel-host = local.panel_host
    config-json = jsonencode({
      instanceId = yandex_compute_instance.cs2.id
      agentUrl   = "http://${var.cs2_private_ip}:8081"
      publicPort = 8080
      publicUrl  = "https://${local.panel_host}"
      gamePort   = 27015
    })
    secrets-env = <<-EOT
      AGENT_TOKEN=${var.agent_token}
    EOT
    panel-users = join("\n", [for n, p in var.panel_users : "${n}:${p}"])
  })

  depends_on = [yandex_resourcemanager_folder_iam_member.admin_compute, yandex_resourcemanager_folder_iam_member.admin_storage, yandex_storage_object.public]

  lifecycle {
    ignore_changes = [boot_disk[0].initialize_params[0].image_id]
  }
}
