# Installation

*По-русски: [docs/ru/installation.md](ru/installation.md).*

From zero to a running CS2 server and admin panel on Yandex Cloud. Budget about **20 minutes of your time** plus the first download of the game (about 60 GB, runs on its own).

> Just want to look at the panel? `npm run demo` starts the real panel against a mock game server on <http://127.0.0.1:8080>. No cloud account needed.

## 1. What you need

| Requirement | Notes |
|---|---|
| A **Yandex Cloud** account with a billing account attached | <https://console.yandex.cloud/> |
| A **folder** for the stack | Use a dedicated one: deleting the folder removes everything. Note its `folder_id` and the `cloud_id` |
| A **Steam account** | For the Game Server Login Token (section 3). Use a secondary account if you enable skin changers |
| Your **SteamID64** | 17 digits starting with `7656119`. Look it up at <https://steamid.io> |
| A shell with `yc`, OpenTofu or Terraform (>= 1.6), `python3`, `node` (>= 18) and `npm` | **[Yandex Cloud Shell](https://shell.yandex.cloud/)** has all of them. A laptop works too: install the [yc CLI](https://yandex.cloud/en/docs/cli/quickstart) and run `yc init` |

Costs depend on the current Yandex Cloud price list, so check it before you start. The shape of the bill: the **game VM is billed only while it runs** (plus its 100 GB disk all the time); the **panel VM is small and always on**; Object Storage holds the backups. The panel stops the game VM after 30 idle minutes by default.

## 2. Deploy

```bash
git clone https://github.com/sink3x/cs2-server-admin-panel.git
cd cs2-server-admin-panel

cp terraform/terraform.tfvars.example terraform/terraform.tfvars
$EDITOR terraform/terraform.tfvars        # cloud_id, folder_id, your SteamID64 in cs2_admins

scripts/deploy.sh
```

`terraform.tfvars` is the only file you must edit:

```hcl
cloud_id  = "b1g..."           # yc resource-manager cloud list
folder_id = "b1g..."           # yc resource-manager folder list

cs2_admins = [
  { name = "you", steamid = "76561198000000000" },
]
```

What `scripts/deploy.sh` does:

1. builds the frontend and packs the application into `build/bundle.tgz` (`scripts/pack.sh`);
2. generates `terraform/secrets.auto.tfvars` (random agent token, RCON and DB passwords, panel logins; mode 0600, git-ignored) and **prints the first panel logins once**;
3. runs `init`, `validate`, and a two-stage `apply` (first the storage key, then everything else). It asks for confirmation; pass `--yes` to skip it;
4. prints the outputs: `panel_url`, `game_ip`, `connect`.

Use OpenTofu with `TF=tofu scripts/deploy.sh`.

**Write the printed logins down.** They are also in `terraform/secrets.auto.tfvars`. Back that file up privately: it holds every secret of the deployment.

### First boot

Both VMs configure themselves on first boot. The panel is reachable after a minute or two (Caddy obtains a Let's Encrypt certificate for `<ip-with-dashes>.sslip.io`, or for `panel_domain` if you set one). The game VM then downloads CS2 through SteamCMD, which takes **10 to 30 minutes**. The panel shows the progress on the Overview page.

## 3. The Steam server token (GSLT)

Without a token the server runs but is not reachable from the internet in the usual way.

1. Open <https://steamcommunity.com/dev/managegameservers> and create a token for **App ID `730`** (any memo).
2. Copy it, then run `scripts/set-gslt.sh`. It reads the clipboard, validates the format, writes it to `secrets.auto.tfvars`, applies it and restarts the game VM. The token is never printed.

You can also set `GSLT=<token> scripts/init-secrets.sh` before the very first deploy.

## 4. Open the panel and join

1. Open `panel_url` from the deploy output and sign in with the printed admin login. **Change the password** on the account page.
2. Press **Start**. The panel starts the VM; the first start also installs the game.
3. In CS2 open the console and run `connect <game_ip>:27015` (the `connect` output prints exactly that).

Add friends under **Users**. Players get a limited role: they can see the status and, if you allow it in the settings, start the server.

## 5. Optional steps

| Goal | How |
|---|---|
| Own domain for the panel | Set `panel_domain = "panel.example.com"` and point an A record to `panel_ip`. Apply again |
| Restrict who sees the panel | `panel_allowed_cidrs = ["203.0.113.7/32"]` |
| SSH access | `ssh_public_key = "ssh-ed25519 AAAA..."`, then `scripts/ssh.sh` |
| Bigger game VM | `cs2_cores = 4`. The data disk is separate, so nothing is lost |
| Workshop maps | `scripts/set-steam-web-key.sh` with a [Steam Web API key](https://steamcommunity.com/dev/apikey) |
| FACEIT lookups | `PANEL_URL=https://... scripts/set-faceit-key.sh` |

All variables are documented in [configuration.md](configuration.md).

## 6. Updating

Pull the new version and deploy again:

```bash
git pull
scripts/deploy.sh
```

- The **panel VM** is updated by Terraform (new bundle in its metadata) and restarted.
- The **game VM** takes the new bundle at its **next boot**. Running games are never interrupted by a deploy. Stop and start the VM from the panel when you want it.
- The game itself updates through SteamCMD on each start of the server.

Check the [changelog](../CHANGELOG.md) before major version updates.

### Optional: continuous deployment from GitHub Actions

For your own fork. The workflow is off until you opt in.

1. Create an Object Storage bucket for the Terraform state and a service account with a static key. Set `TF_STATE_BUCKET` and the key in the `production` environment (see `.github/workflows/deploy.yml` for the exact secrets and variables).
2. Add the secrets and variables to the **`production` environment** of your fork.
3. Set the repository variable `DEPLOY_ENABLED=true`.

Deploys then run after a green CI on `main`, and only from pushes in the same repository, never from pull requests. Keep the repository **private or reviewed**: whoever can change `main` can deploy to your cloud.

## 7. Back up and restore

- Backups run **every night and on every shutdown**; the latest 14 are kept in Object Storage. They contain `state.json`, plugin configs and a database dump.
- The Backups page of the panel restores any of them.
- If the data disk is ever empty (new disk), the game VM restores the newest backup on start.
- Keep `terraform/secrets.auto.tfvars` and the Terraform state yourself. They are not in the backups.

## 8. Troubleshooting

| Symptom | What to check |
|---|---|
| `deploy.sh` fails with an authentication error | `yc init` (or Cloud Shell session expired), then rerun |
| Panel opens with a certificate warning | Wait 2 minutes after the first boot. Let's Encrypt needs the VM to be reachable on ports 80/443 (`panel_allowed_cidrs` must allow it) |
| Server is up but friends cannot connect | Is the GSLT set? Is the VM `RUNNING`? Port UDP 27015 is open by Terraform. Check with `connect <ip>:27015` from outside |
| Overview says the agent is unreachable | The game VM is stopped or still booting; the agent listens on 8081 for the panel only |
| Workshop map does not load | A Steam Web API key is required, set it with `scripts/set-steam-web-key.sh` |
| Plugins missing after a restart | Panel > Plugins shows install errors; the agent log is `journalctl -u cs2-agent` (needs SSH) |
| Out of disk | Raise `cs2_data_disk_gb` and apply; grow the filesystem as for any Ubuntu disk |

More in the [FAQ](faq.md).

## 9. Removing everything

The data disk is protected by `prevent_destroy`, and the bucket is not force-destroyed, so a stray `destroy` cannot wipe your server. To remove the stack on purpose:

1. Download any backup you want to keep from the bucket.
2. Empty the bucket (console or `yc storage`).
3. Remove the `prevent_destroy` line in `terraform/compute.tf`, then `tofu destroy`.

Or simply delete the folder in the Yandex Cloud console, which removes every resource in it.
