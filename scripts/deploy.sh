#!/usr/bin/env bash
# Deploy from Yandex Cloud Shell:  scripts/deploy.sh [--yes]
set -euo pipefail
cd "$(dirname "$0")/.."

scripts/pack.sh
[ -f terraform/secrets.auto.tfvars ] || scripts/init-secrets.sh
[ -f terraform/terraform.tfvars ] || cp terraform/terraform.tfvars.example terraform/terraform.tfvars

export YC_TOKEN="${YC_TOKEN:-$(yc iam create-token)}"
cd terraform
"${TF:-terraform}" init -input=false
"${TF:-terraform}" validate
# Stage 1: the bucket needs S3-style credentials, which come from a service-account key that must exist first.
"${TF:-terraform}" apply -input=false -auto-approve \
  -target=yandex_iam_service_account_static_access_key.cs2 \
  -target=yandex_resourcemanager_folder_iam_member.cs2_storage
export YC_STORAGE_ACCESS_KEY="$("${TF:-terraform}" output -raw storage_access_key)"
export YC_STORAGE_SECRET_KEY="$("${TF:-terraform}" output -raw storage_secret_key)"
# Stage 2: everything else.
if [ "${1:-}" = "--yes" ]; then "${TF:-terraform}" apply -input=false -auto-approve; else "${TF:-terraform}" apply; fi
"${TF:-terraform}" output -json | python3 -c 'import json,sys; [print(k, "=", v["value"]) for k,v in json.load(sys.stdin).items() if not v.get("sensitive")]'
