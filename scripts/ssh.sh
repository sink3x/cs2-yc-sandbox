#!/usr/bin/env bash
# ssh.sh game|panel [command...]   (needs ssh_public_key in terraform.tfvars and the matching private key)
set -euo pipefail
cd "$(dirname "$0")/../terraform"
case "${1:-}" in
  game)  IP=$(terraform output -raw game_ip) ;;
  panel) IP=$(terraform output -raw panel_ip) ;;
  *) echo "usage: $0 game|panel [command...]" >&2; exit 2 ;;
esac
shift
exec ssh -o StrictHostKeyChecking=accept-new "ubuntu@$IP" "$@"
