#!/usr/bin/env bash
# Generates terraform/secrets.auto.tfvars (mode 0600, git-ignored) with random secrets.
# Optional env: GSLT=<token>  STEAM_WEB_API_KEY=<key>  PANEL_USERS="admin friend"
set -euo pipefail
cd "$(dirname "$0")/../terraform"
OUT=secrets.auto.tfvars
if [ -f "$OUT" ]; then echo "$OUT already exists, keeping it"; exit 0; fi

rand() { LC_ALL=C tr -dc "$1" < /dev/urandom | head -c "$2"; }
alnum() { rand 'A-Za-z0-9' "$1"; }

umask 077
{
  echo "bucket_suffix = \"$(rand 'a-z0-9' 8)\""
  echo "agent_token   = \"$(rand 'a-f0-9' 48)\""
  echo "rcon_password = \"$(alnum 24)\""
  echo "db_password   = \"$(alnum 24)\""
  echo "gslt              = \"${GSLT:-}\""
  echo "steam_web_api_key = \"${STEAM_WEB_API_KEY:-}\""
  echo "panel_users = {"
  for u in ${PANEL_USERS:-admin}; do
    pw=$(alnum 16 || true)
    echo "  ${u} = \"${pw}\""
    echo "panel login: ${u} / ${pw}" >&2
  done
  echo "}"
} > "$OUT"
echo "wrote terraform/$OUT (keep it private; it is git-ignored)" >&2
