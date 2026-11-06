#!/usr/bin/env bash
# Idempotent installer for the admin VM. Called by common/bootstrap.sh on every boot.
set -euo pipefail

APP=/opt/cs2-app
STAMP=/var/lib/cs2-bootstrap
VARDIR=/var/lib/cs2-admin
PKG_VER=1
export DEBIAN_FRONTEND=noninteractive

log() { echo "[install-admin] $*"; }
mkdir -p "$STAMP"

if [ "$(cat "$STAMP/packages" 2>/dev/null || true)" != "$PKG_VER" ]; then
  log "installing packages"
  # The caddy package tries to start caddy.service from its postinst, and that unit is ordered After cs2-bootstrap
  # (which is what runs this script): a blocking start would deadlock. Forbid service starts while installing; the
  # units are started with --no-block at the end of this script.
  printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d
  chmod 0755 /usr/sbin/policy-rc.d
  trap 'rm -f /usr/sbin/policy-rc.d' EXIT
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl nodejs
  if ! apt-get install -y -qq caddy; then
    log "caddy is not in the Ubuntu archive, using the official repository"
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
      | sed 's#^deb #deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] #' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy
  fi
  rm -f /usr/sbin/policy-rc.d
  echo "$PKG_VER" > "$STAMP/packages"
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || { log "node >= 18 required, got $NODE_MAJOR"; exit 1; }

id cs2admin >/dev/null 2>&1 || useradd --system --home-dir "$VARDIR" --shell /usr/sbin/nologin cs2admin
install -d -m 0750 -o cs2admin -g cs2admin "$VARDIR"
chgrp cs2admin /etc/cs2-admin/secrets.env && chmod 0640 /etc/cs2-admin/secrets.env

# ---- initial panel users (never overwrite: passwords changed in the panel must survive reboots) -----
if [ -s "$STAMP/panel-users" ]; then
  # "|| [ -n ... ]": the list has no trailing newline, and plain `read` would silently drop the last user.
  while IFS=: read -r name pw || [ -n "${name:-}" ]; do
    [ -n "${name:-}" ] || continue
    if CS2ADMIN_VAR="$VARDIR" NAME="$name" node -e '
      const u = (() => { try { return require(process.env.CS2ADMIN_VAR + "/users.json").users; } catch { return {}; } })();
      process.exit(u[process.env.NAME] ? 0 : 1);'; then
      continue
    fi
    log "creating panel user $name"
    printf '%s' "$pw" | CS2ADMIN_VAR="$VARDIR" node "$APP/app/admin/adduser.js" "$name"
  done < "$STAMP/panel-users"
  chown -R cs2admin:cs2admin "$VARDIR"
fi

# ---- reverse proxy with automatic HTTPS (Let's Encrypt) -------------------------------------------
HOST=$(tr -d '[:space:]' < "$STAMP/panel-host" 2>/dev/null || true)
PORT=$(node -p 'require("/etc/cs2-admin/config.json").publicPort || 8080')
if [ -n "$HOST" ]; then
  SITE="$HOST"
else
  SITE=":80"
fi
cat > /etc/caddy/Caddyfile <<CADDY
$SITE {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
	header {
		Strict-Transport-Security "max-age=31536000"
		-Server
	}
}
CADDY

install -m 0644 "$APP"/vm-admin/systemd/*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable cs2-bootstrap.service cs2-admin.service caddy.service >/dev/null 2>&1 || true
systemctl --no-block restart cs2-admin.service
systemctl --no-block restart caddy.service
log "done"
