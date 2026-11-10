# Third-party notices

This repository is [MIT](LICENSE) licensed. It does **not** contain the software below. The server downloads it from the upstream projects at install time and it stays under its own license. Nothing here is endorsed by those projects, and *Counter-Strike* is a trademark of Valve Corporation.

## Installed on the game VM at run time

| Software | Upstream | License |
|---|---|---|
| Counter-Strike 2 dedicated server (via SteamCMD) | Valve | Steam Subscriber Agreement / SteamCMD terms |
| Metamod:Source | alliedmods.net | zlib/libpng |
| CounterStrikeSharp | roflmuffin/CounterStrikeSharp | GPL-3.0 with an exception that allows MIT-licensed plugins |
| Plugins from the catalogue (`app/lib/plugins.json`) | MatchZy, cs2-WeaponPaints, MenuManager, PlayerSettings, AnyBaseLib, OpenPrefirePrac, ThirdPerson-Revamped, CS2-BhopCommand, CS2-OnlyHS, RadarColorFix, CS2-CustomVotes, AutomaticAds-CS2, AFKManager, cs2-roll-the-dice, CS2-Deathmatch, cs2-retakes, ChaseMod, cs2-rockthevote | Per project, see each repository (MIT and GPL-3.0 are the common ones) |
| MariaDB, Caddy, Node.js, Ubuntu packages | distribution packages | Their own licenses |
| Source2Viewer-CLI (extracts game sounds and logos) | ValveResourceFormat | MIT |

## Included in this repository

| Item | Source | License |
|---|---|---|
| Callout positions and place names (`app/lib/callouts.json`) | [cs2-callouts](https://github.com/sink3x/cs2-callouts), from navigation data processed with [awpy](https://github.com/pnxenopoulos/awpy) | MIT |
| **Map radar images** (`app/admin/public/callouts/*.webp`) | [Boltobserv](https://github.com/boltgolt/boltobserv) `src/maps/<map>/radar.png`, resized, transparent background filled with the panel's dark colour; Ancient and Anubis from Lexogrine | GPL-3.0 as distributed by Boltobserv (Ancient and Anubis: MIT). **The underlying artwork is Valve's**; see `app/admin/public/callouts/NOTICE.md`. To remove them, delete the directory; the Callouts page then shows an error for the missing images |
| CS2Panel plugin build (`app/plugins-bundled/CS2Panel.zip`) | [cs2-panel-plugin](https://github.com/sink3x/cs2-panel-plugin) | MIT |
| Preact (frontend build dependency) | preactjs/preact | MIT |
| Vite, TypeScript, esbuild (build tools) | their projects | MIT / Apache-2.0 |
| Map names and place names | Valve | Names only |

Workshop map preview images in the panel are loaded from their original hosts at run time (Steam Workshop and a community image set) and are not redistributed here.

If you are a rights holder and see something that should be changed, open an issue.
