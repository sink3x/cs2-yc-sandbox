resource "yandex_storage_bucket" "backups" {
  bucket        = "${var.name_prefix}-backups-${var.bucket_suffix}"
  force_destroy = false

  # Object Storage needs S3-style credentials in the environment (YC_STORAGE_ACCESS_KEY/_SECRET_KEY): scripts/deploy.sh
  # creates the service-account key first and exports it. An IAM token alone gives "failed to get default storage client".
  depends_on = [yandex_resourcemanager_folder_iam_member.cs2_storage]

  anonymous_access_flags {
    read = false
    list = false
  }

  # Backups are pruned by the agent (keeps 14); this is only a safety net for forgotten objects.
  lifecycle_rule {
    id      = "expire-old-backups"
    enabled = true
    filter {
      prefix = "cs2/"
    }
    expiration {
      days = 90
    }
  }

  lifecycle_rule {
    id      = "expire-old-dist"
    enabled = true
    filter {
      prefix = "dist/"
    }
    expiration {
      days = 30
    }
  }
}

# Frontend bundle for the panel VM (content-addressed key: a new build is a new object, old ones are pruned after 30 days).
resource "yandex_storage_object" "public" {
  bucket = yandex_storage_bucket.backups.bucket
  key    = "dist/public-${substr(filesha256(local.public_path), 0, 16)}.tgz"
  source = local.public_path
}
