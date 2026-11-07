terraform {
  required_version = ">= 1.6.0"

  # Состояние в Object Storage (бакет с версионированием, приватный): его читают и пишут и Mac, и GitHub Actions.
  # Ключи — из окружения: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (статический ключ сервисного аккаунта ...-ci).
  # Блокировок у Yandex Object Storage нет: параллельные запуски исключает concurrency-группа в workflow.
  backend "s3" {
    bucket = "example-cs2-tfstate"
    key    = "cs2/terraform.tfstate"
    region = "ru-central1"

    endpoints = {
      s3 = "https://storage.yandexcloud.net"
    }

    skip_region_validation      = true
    skip_credentials_validation = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }

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
