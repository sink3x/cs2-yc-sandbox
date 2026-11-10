# FAQ and limits

## What does it cost?
Check the current Yandex Cloud price list. The pattern: the game VM is billed while it is running (plus its disk always), the panel VM is small and always on, Object Storage holds backups. With auto-stop (default 30 idle minutes) you pay mostly for the hours you play.

## Can I run it outside Yandex Cloud?
The Terraform module targets Yandex Cloud only. The panel and the agent are plain Node.js and do not depend on the cloud except for `app/lib/yc.js` (start / stop the VM) and `app/lib/s3.js` (an S3-compatible client, so any S3 storage works). A port to another cloud means a new Terraform module and a replacement of `yc.js`. Contributions welcome.

## Does it work for a public server?
It is built for a private practice server for friends: a small VM, a password-protected panel, practice presets. Nothing stops you from opening it, but plugin choices, the skin changer and the VM size are tuned for a few players. For a public server read the Valve guidelines first.

## The skin changer is risky, what exactly?
See [plugins.md](plugins.md#skins-read-this-before-you-enable-weaponpaints). Short version: it violates Valve's server guidelines; use a secondary account for the token or switch it off.

## Why can't I change the T / CT icons at the bottom or the TAB scoreboard layout?
They are drawn by the game client from its own files. A server can change the *data* the client shows (team names, logos from the game's own files, flags, clan tags, nicknames) but not the layout. The Teams & tags page covers everything a server can do.

## My own sounds do not play for players
The panel can play uploaded files in the panel itself. Players hear only sounds their game already has: built-in game sounds, or sounds shipped in a Workshop addon that you create and add to the server.

## The server is up but nobody can connect
Is a GSLT set (`scripts/set-gslt.sh`)? Is the VM `RUNNING`? Is the first download finished (Overview shows the agent status)? Try `connect <game_ip>:27015` from the console.

## Where are my settings if the VM is recreated?
On the data disk (separate from the VM) and in nightly / shutdown backups in Object Storage. A new empty disk is filled from the newest backup automatically.

## How do I give a friend access?
Panel > Users > add an account (role `player`). A friend can also sign in with Steam if you allow it. Add them as an in-game admin on the Admins page if needed.

## Is it safe to put the panel on the internet?
It has HTTPS, hashed passwords, login rate limiting and roles. You can restrict it further with `panel_allowed_cidrs`. See [architecture.md](architecture.md#security-boundaries) and [SECURITY.md](../SECURITY.md).

## What is "demo mode"?
`npm run demo`: the real panel with a fake game server in memory, bound to localhost. Handy to look around, test a change, or record screenshots. It is not shipped to the VMs.

## Do you use telemetry?
No. The panel talks to your VMs, Yandex Cloud, GitHub (plugin downloads), Steam (profiles, Workshop) and, optionally, FACEIT. Nothing is sent to the maintainers.

## Is this affiliated with Valve?
No. Counter-Strike is a trademark of Valve Corporation.
