# Configuration

Four layers, from the one you will touch most to the one you will rarely need.

| Layer | Where | Who edits it |
|---|---|---|
| 1. Infrastructure variables | `terraform/terraform.tfvars`, `terraform/secrets.auto.tfvars` | You, before `scripts/deploy.sh` |
| 2. Panel settings | Settings page of the panel (`/api/settings`) | Panel admins |
| 3. Game server state | Pages of the panel (`state.json` on the data disk) | Panel admins |
| 4. Environment variables | systemd units, demo mode | Developers |

## 1. Terraform variables

Set in `terraform/terraform.tfvars` (not secret) unless noted. Everything has a default except the first two.

| Variable | Default | Meaning |
|---|---|---|
| `cloud_id`, `folder_id` | required | Where to create resources. Use a dedicated folder |
| `zone` | `ru-central1-a` | Availability zone |
| `name_prefix` | `sandbox-cs-1` | Prefix of all resource names |
| `cs2_cores`, `cs2_memory_gb` | `2`, `8` | Game VM size. 2 vCPU handles about 3 players; use 4 if it stutters |
| `cs2_platform` | `standard-v3` | Yandex Cloud platform of the game VM |
| `cs2_data_disk_gb` | `100` | Persistent disk: game (about 60 GB), plugins, database |
| `admin_cores`, `admin_core_fraction`, `admin_memory_gb` | `2`, `20`, `1` | Panel VM: tiny and always on |
| `subnet_cidr`, `cs2_private_ip`, `admin_private_ip` | `10.20.0.0/24`, `.10`, `.11` | Private network |
| `panel_allowed_cidrs` | `["0.0.0.0/0"]` | Who may reach the panel on 80/443. The panel has its own login, but restrict it if you have a fixed IP |
| `panel_domain` | empty | Own hostname. Empty means `<ip-with-dashes>.sslip.io` with a real Let's Encrypt certificate |
| `ssh_public_key`, `ssh_allowed_cidrs` | empty, `["0.0.0.0/0"]` | Optional SSH to user `ubuntu`. Empty key means no SSH rule at all |
| `server_hostname` | `sandbox-cs-1` | Server name shown in the game |
| `cs2_admins` | `[]` | `[{ name, steamid }]`: players with full admin (`@css/root`) in the game. Editable later in the panel |

Secrets, generated into `terraform/secrets.auto.tfvars` by `scripts/init-secrets.sh` (mode 0600, never committed):

| Variable | Meaning |
|---|---|
| `bucket_suffix` | Random suffix: bucket names are globally unique |
| `agent_token` | Bearer token the panel uses to talk to the agent |
| `rcon_password`, `db_password` | RCON and MariaDB passwords |
| `panel_users` | Initial panel logins `{ name = password }` (change them in the panel) |
| `gslt` | Steam Game Server Login Token, set with `scripts/set-gslt.sh` |
| `steam_web_api_key` | Optional, for Workshop maps (`scripts/set-steam-web-key.sh`) |

Environment for `scripts/init-secrets.sh`: `GSLT`, `STEAM_WEB_API_KEY`, `PANEL_USERS="admin friend"` (a login is generated for each name).

### Remote Terraform state (optional)

By default the state is a local file `terraform/terraform.tfstate` (fine for one person; **back it up**, it contains the secrets). To keep it in a private Object Storage bucket (CI, several machines), export before `scripts/deploy.sh`:

```bash
export TF_STATE_BUCKET=my-tfstate-bucket
export AWS_ACCESS_KEY_ID=...        # static key of a service account with access to that bucket
export AWS_SECRET_ACCESS_KEY=...
```

The script then generates the git-ignored `terraform/backend.tf`. The same variables can live in `~/.cs2-ci/backend.env`.

## 2. Panel settings

Stored in `/var/lib/cs2-admin/settings.json`, edited on the Settings page.

| Key | Default | Meaning |
|---|---|---|
| `autoStopIdleMinutes` | `30` | Stop the game VM after this many minutes with zero human players. `0` turns auto-stop off |
| `startupGraceMinutes` | `20` | Do not count idleness during the first minutes after the VM starts |
| `playerLogin` | `true` | Allow accounts with the `player` role to sign in |
| `playerStart` | `false` | Let `player` accounts start the server |

Panel accounts (password and optional Steam link) are managed on the Users page. Roles: `admin`, `player`.

## 3. Game server state

Everything on the game pages (Server, Modes, Maps, Cvars, Plugins, Admins, Sounds, Teams and tags) is written to `state.json` and rendered into game configs. Fields:

| Key | Content |
|---|---|
| `server` | `hostname`, launch `map`, `preset`, `gameType` / `gameMode`, `maxPlayers`, `password`, `extraArgs` |
| `cvars` | Cvar overrides on top of the preset (names and values are validated) |
| `flags` | `autoUpdateGame`, `autoUpdatePlugins`, `insecure` (VAC off), `dotChat` (`.` commands in chat) |
| `plugins` | `{ pluginId: true/false }` for the catalogue plugins |
| `admins` | In-game admins `{ name, steamid, flags }` (default `@css/root`) |
| `maps` | Custom map list (Workshop maps) |
| `sounds` | Sound library entries for the in-game sound commands |
| `identity` | Team names, logos and flags for CT / T, per-player nicknames and clan tags |

Do not edit `state.json` by hand on the VM; use the panel, which validates. Presets (game modes and map presets) live in `app/lib/presets.js`; the plugin catalogue, including pinned versions (`pin`), in `app/lib/plugins.json`.

## 4. Environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `PORT` | demo mode | Port of `npm run demo` (default 8080, bound to 127.0.0.1 only) |
| `CS2ADMIN_ETC`, `CS2ADMIN_VAR` | panel | Config / secrets directory (`/etc/cs2-admin`) and data directory (`/var/lib/cs2-admin`). On the VM the panel port is `publicPort` in `/etc/cs2-admin/config.json` (default 8080); Caddy proxies to it |
| `CS2_ROOT`, `CS2_ETC` | agent | Game data root (`/srv/cs2`) and config directory |
| `AGENT_TOKEN` | agent | Bearer token (from the secrets file on the VM) |
| `CS2DEMO_CATALOG_DIR` | demo | Directory with an offline skin catalogue so `npm run demo` works without internet |
| `TF`, `YC_TOKEN` | deploy scripts | `TF=tofu` selects OpenTofu; `YC_TOKEN` defaults to `yc iam create-token` |
| `TF_STATE_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | `deploy.sh` | Remote state, see above |
