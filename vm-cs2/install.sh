#!/usr/bin/env bash
# Idempotent installer for the CS2 VM. Called by common/bootstrap.sh on every boot.
set -euo pipefail

APP=/opt/cs2-app
STAMP=/var/lib/cs2-bootstrap
DATA_DEV=/dev/disk/by-id/virtio-cs2data
PKG_VER=2
export DEBIAN_FRONTEND=noninteractive

log() { echo "[install-cs2] $*"; }
mkdir -p "$STAMP"

# ---- 1. packages (only when the list changes) --------------------------------------------------
if [ "$(cat "$STAMP/packages" 2>/dev/null || true)" != "$PKG_VER" ]; then
  log "installing packages"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl unzip jq tar rsync lib32gcc-s1 lib32stdc++6 mariadb-server nodejs
  echo "$PKG_VER" > "$STAMP/packages"
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || { log "node >= 18 required, got $NODE_MAJOR"; exit 1; }

getent group steam >/dev/null || groupadd --system steam
id steam >/dev/null 2>&1 || useradd --create-home --home-dir /home/steam --shell /bin/bash -g steam steam

# ---- 2. persistent data disk -------------------------------------------------------------------
for _ in $(seq 1 45); do [ -e "$DATA_DEV" ] && break; sleep 2; done
[ -e "$DATA_DEV" ] || { log "data disk $DATA_DEV not found"; exit 1; }
if ! blkid "$DATA_DEV" >/dev/null 2>&1; then
  log "formatting new data disk"
  mkfs.ext4 -q -L cs2data -m 0 "$DATA_DEV"
fi
mkdir -p /srv/cs2
if ! grep -q '^LABEL=cs2data ' /etc/fstab; then
  echo 'LABEL=cs2data /srv/cs2 ext4 defaults,nofail,noatime,x-systemd.device-timeout=90 0 2' >> /etc/fstab
fi
systemctl daemon-reload
mountpoint -q /srv/cs2 || mount /srv/cs2
mkdir -p /srv/cs2/data /srv/cs2/server /srv/cs2/steamcmd
chown steam:steam /srv/cs2 /srv/cs2/data /srv/cs2/server /srv/cs2/steamcmd

# ---- 3. swap on the boot disk (CS2 + .NET + MariaDB on 8 GB RAM) --------------------------------
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
swapon -a || true

# ---- 4. MariaDB datadir lives on the data disk (bind mount) --------------------------------------
if ! mountpoint -q /var/lib/mysql; then
  systemctl stop mariadb || true
  if [ ! -d /srv/cs2/mysql/mysql ]; then
    log "seeding MariaDB datadir on the data disk"
    mkdir -p /srv/cs2/mysql
    rsync -a /var/lib/mysql/ /srv/cs2/mysql/
  fi
  chown -R mysql:mysql /srv/cs2/mysql
  grep -q ' /var/lib/mysql ' /etc/fstab || \
    echo '/srv/cs2/mysql /var/lib/mysql none bind,nofail,x-systemd.requires-mounts-for=/srv/cs2 0 0' >> /etc/fstab
  systemctl daemon-reload
  mount /var/lib/mysql
fi
mkdir -p /etc/systemd/system/mariadb.service.d
cat > /etc/systemd/system/mariadb.service.d/10-cs2.conf <<'UNIT'
[Unit]
RequiresMountsFor=/srv/cs2 /var/lib/mysql
UNIT
# MariaDB listens on loopback only; WeaponPaints connects to 127.0.0.1:3306
CNF_NEW=$(mktemp)
cat > "$CNF_NEW" <<'CNF'
[mysqld]
bind-address = 127.0.0.1
innodb_buffer_pool_size = 128M
max_connections = 40
CNF
CNF_CHANGED=0
cmp -s "$CNF_NEW" /etc/mysql/mariadb.conf.d/99-cs2.cnf || { install -m 0644 "$CNF_NEW" /etc/mysql/mariadb.conf.d/99-cs2.cnf; CNF_CHANGED=1; }
rm -f "$CNF_NEW"

# ---- 5. systemd units ----------------------------------------------------------------------------
install -m 0644 "$APP"/vm-cs2/systemd/*.service "$APP"/vm-cs2/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable cs2-bootstrap.service cs2-agent.service cs2.service cs2-backup-shutdown.service cs2-backup-nightly.timer >/dev/null 2>&1 || true
# NOTE: this script runs inside cs2-bootstrap.service, which is ordered Before= the units below,
# so they must be started with --no-block (a blocking start would wait for us: deadlock).
if [ "$CNF_CHANGED" = 1 ]; then systemctl restart mariadb; else systemctl start mariadb; fi
systemctl --no-block restart cs2-agent.service
systemctl --no-block start cs2-backup-shutdown.service cs2-backup-nightly.timer
# Game server: never restarted here (a running match must survive a re-bootstrap); started if not yet running.
systemctl --no-block start cs2.service
log "done"
