#!/usr/bin/env bash
# Runs on every boot of both VMs (cs2-bootstrap.service, installed by cloud-init).
# Pulls the application bundle, config and secrets from the instance metadata, unpacks them and runs the
# role-specific idempotent installer (vm-cs2/install.sh or vm-admin/install.sh).
set -euo pipefail

MD=http://169.254.169.254/computeMetadata/v1/instance/attributes
APP=/opt/cs2-app
STATE=/var/lib/cs2-bootstrap
mkdir -p "$APP" "$STATE"

get() { curl -fsS --retry 12 --retry-delay 3 --retry-connrefused -H 'Metadata-Flavor: Google' "$MD/$1"; }
log() { echo "[bootstrap] $*"; }

ROLE=$(get role)
log "role=$ROLE"

get app-bundle | base64 -d > "$STATE/bundle.tgz"
NEW=$(sha256sum "$STATE/bundle.tgz" | cut -d' ' -f1)
if [ "$NEW" != "$(cat "$STATE/bundle.sha" 2>/dev/null || true)" ]; then
  log "unpacking new bundle $NEW"
  rm -rf "${APP:?}"/*
  tar xzf "$STATE/bundle.tgz" -C "$APP"
  echo "$NEW" > "$STATE/bundle.sha"
fi

case "$ROLE" in
  cs2)
    install -d -m 0755 /etc/cs2
    get config-json > /etc/cs2/config.json
    get secrets-env > /etc/cs2/secrets.env.new
    get game-env > /etc/cs2/game.env.new
    install -m 0600 -o root -g root /etc/cs2/secrets.env.new /etc/cs2/secrets.env
    rm -f /etc/cs2/secrets.env.new
    getent group steam >/dev/null || groupadd --system steam
    install -m 0640 -o root -g steam /etc/cs2/game.env.new /etc/cs2/game.env
    rm -f /etc/cs2/game.env.new
    ;;
  admin)
    install -d -m 0755 /etc/cs2-admin
    get config-json > /etc/cs2-admin/config.json
    get secrets-env > /etc/cs2-admin/secrets.env.new
    install -m 0600 -o root -g root /etc/cs2-admin/secrets.env.new /etc/cs2-admin/secrets.env
    rm -f /etc/cs2-admin/secrets.env.new
    get panel-users > "$STATE/panel-users" || true
    chmod 0600 "$STATE/panel-users"
    get panel-host > "$STATE/panel-host" || true
    ;;
  *) log "unknown role $ROLE"; exit 1 ;;
esac

exec bash "$APP/vm-$ROLE/install.sh"
