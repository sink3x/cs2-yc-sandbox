# cs2-yc-sandbox

A cheap, persistent Counter-Strike 2 practice server for 2-3 friends on Yandex Cloud (`ru-central1`, closest region to Moscow),
plus a tiny always-on admin panel that starts/stops the game VM so you only pay for the hours you play.

```
                      ┌──────────────── Yandex Cloud folder "sandbox-2-cs" ────────────────┐
 players ── UDP 27015 ─▶  sandbox-cs-1-game  (2 vCPU / 8 GB, static IP)                    │
                      │   ├─ cs2.service      CS2 + Metamod + CounterStrikeSharp + plugins │
                      │   ├─ cs2-agent        HTTP API on the private net (token)          │
                      │   ├─ MariaDB          WeaponPaints data (on the data disk)         │
                      │   └─ data disk 100 GB game, plugins, DB: survives VM re-creation   │
 you ──── HTTPS ─────▶  sandbox-cs-1-panel (2 vCPU @20%, 1 GB, static IP, Caddy + Node)     │
                      │   └─ calls the Compute API with its service-account token         │
                      │  Object Storage bucket: nightly + on-shutdown backups (last 14)    │
                      └────────────────────────────────────────────────────────────────────┘
```

## What you get

* **Persistence.** Everything that matters lives on a separate data disk (`/srv/cs2`: game files, plugin configs, `state.json`,
  MariaDB). The VM itself is disposable. Backups (state, configs, skin DB dump) go to Object Storage on every panel-initiated
  shutdown, on VM shutdown (safety net) and nightly. If the data disk is ever empty, the newest backup is restored on start.
* **One state file.** Panel settings are saved as `state.json` and rendered into `server.cfg`, `sandbox/overrides.cfg`,
  CounterStrikeSharp `admins.json`, MatchZy `admins.json`, plugin folders and launch arguments on **every** start.
* **Admin rights.** Both Steam IDs in `cs2_admins` get `@css/root` (CounterStrikeSharp: `!map`, `!rcon`, `!kick`, `!ban`, `!cvar`, ...)
  and MatchZy admin commands. Admins are editable in the panel.
* **Panel.** Start/stop the VM, live status, RCON console, map/mode presets (practice, competitive, bots, casual, wingman,
  deathmatch, arms race), ~60 cvars grouped, plugin and feature toggles, update now, backups/restore, logs, audit log,
  auto-stop after N minutes without players.
* **Plugins** (all toggleable): MatchZy (practice mode, `.prac`, nade/position saving, warmup, pause, scrims), WeaponPaints
  (skin changer: `!wp`, `!knife`, `!gloves`), RockTheVote (`!rtv`, `!nominate`), OpenPrefirePrac (off by default).

## Layout

| Path | What |
|---|---|
| `app/lib` | shared libraries: RCON client, SigV4 S3 client, Compute API client, state model/validation, presets |
| `app/agent` | runs on the game VM: prestart (restore/update/configure), launcher, HTTP agent, backups |
| `app/admin` | runs on the panel VM: HTTP API + static single-page UI |
| `common/bootstrap.sh` | runs at every boot of both VMs: pulls bundle/config/secrets from instance metadata, runs the role installer |
| `vm-cs2`, `vm-admin` | idempotent installers and systemd units |
| `terraform` | network, security groups, service accounts, bucket, disks, both VMs |
| `scripts` | `pack.sh`, `init-secrets.sh`, `deploy.sh`, `ssh.sh` |

Zero npm dependencies (Node >= 18 from the Ubuntu archive).

## Deploy (Yandex Cloud Shell)

```bash
git clone <this repo> && cd cs2-yc-sandbox       # or unpack the archive
scripts/deploy.sh                                # pack bundle, generate secrets, terraform init/validate/apply
```

`deploy.sh` prints the panel logins once (also in `terraform/secrets.auto.tfvars`, which is git-ignored). Terraform outputs the
connect string and the panel URL (`https://<ip-with-dashes>.sslip.io`, real Let's Encrypt certificate).

First start of the game VM downloads ~60 GB with steamcmd (10-20 min); watch the phase in the panel overview.

### Game Server Login Token (needed for a public server)

Create a token at <https://steamcommunity.com/dev/managegameservers> (App ID `730`), put it into `terraform/secrets.auto.tfvars`
(`gslt = "..."`), run `scripts/deploy.sh`, then reboot or restart CS2 from the panel.
**Use a secondary Steam account**: skin changers violate Valve's server guidelines and can get the token banned. Disable
WeaponPaints in the panel if you want to stay clean.

### Updating the code

Edit, run `scripts/deploy.sh`, then restart the VM or `sudo systemctl restart cs2-bootstrap` on it. The game process is never
restarted by a re-bootstrap.

## Cost (order of magnitude)

The game VM is billed only while it runs. The data disk (100 GB SSD), static IPs, the tiny panel VM and the bucket are the fixed
part. Current prices: <https://yandex.cloud/ru/prices>. Auto-stop (default 30 min empty) protects against forgotten sessions.

## Operations

* Logs: panel → Backups & logs, or `journalctl -u cs2 -u cs2-agent -u cs2-bootstrap`.
* Manual backup/restore on the VM: `node /opt/cs2-app/app/agent/backup.js backup manual` / `... restore <key|latest>`.
* Destroy: the data disk has `prevent_destroy`. Remove that block (and empty the bucket) before `terraform destroy`.
* Tests: `cd app && node --test`.

## Security notes

* RCON is bound to loopback; only UDP 27015 is exposed on the game VM. The agent API is reachable only from the panel VM's
  security group and needs a bearer token.
* The panel has scrypt-hashed passwords, rate-limited login, HttpOnly/SameSite=Strict sessions, CSRF header, CSP, audit log.
  Restrict `panel_allowed_cidrs` if you have a fixed IP.
* Secrets travel as instance metadata (visible to folder viewers and in Terraform state). Keep the state private.
* Third-party plugins run as unprivileged user `steam`; root-only secrets (agent token, S3 keys) are not readable by it.
- Снимки встроенных карт: [ghostcap-gaming/cs2-map-images](https://github.com/ghostcap-gaming/cs2-map-images); значки карт: [MurkyYT/cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons). Превью, размер и теги карт Workshop панель берёт из Steam Web API. Подборка комьюнити-карт — коллекция Workshop «Best Counter-Strike 2 Community Maps» (scritch).
