terraform {
  required_version = ">= 1.5.0"

  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = ">= 0.120.0"
    }
  }
}

# Authentication: export YC_TOKEN=$(yc iam create-token)  (scripts/deploy.sh does this in Cloud Shell)
provider "yandex" {
  cloud_id  = var.cloud_id
  folder_id = var.folder_id
  zone      = var.zone
}
