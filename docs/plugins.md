# Plugins

The panel has a **plugin catalogue** (`app/lib/plugins.json`). Each entry is a CounterStrikeSharp or Metamod plugin that the agent downloads from its GitHub release when you switch it on, and keeps up to date (`autoUpdatePlugins`) or pinned to a tag (`pin`). Switching a plugin on or off is a toggle on the Plugins page; the change is applied at the next server start.

## Catalogue

| Plugin | Upstream | On by default | What it gives you |
|---|---|---|---|
| **CS2Panel** | [sink3x/cs2-panel-plugin](https://github.com/sink3x/cs2-panel-plugin) | yes | `!menu` in-game menu, `css_playsound`, animals, `css_refreshskins`, team and player identity. Installed from the copy bundled with the panel |
| MatchZy | shobhit-pathak/MatchZy | yes | Practice commands (`.prac`, `.bot`, `.spawn`, `.rethrow`, `.timer`, `.savenade`), scrims and pugs |
| WeaponPaints | Nereziel/cs2-WeaponPaints | yes | Skins, knives, gloves, agents via `!ws` / `!skins`. **Against Valve's server rules, see below** |
| ThirdPerson | KKNecmi/ThirdPerson-Revamped | yes | `!tp` third person view |
| Bhop | LeqenddC/CS2-BhopCommand | yes | `!bhop` toggles bunny hopping for everybody |
| OnlyHS | LeqenddC/CS2-OnlyHS | yes | `!onlyhs` head-shot-only damage |
| RadarColorFix | srwiruwiru/RadarColorFix-CS2 | yes | Distinct radar colours for players |
| OpenPrefirePrac | lengran/OpenPrefirePrac | no | Prefire practice against bots (`!prefire`) |
| RockTheVote | abnerfs/cs2-rockthevote | no | `!rtv`, `!nextmap`. Off until it supports the current CounterStrikeSharp. The panel has its own map vote |
| CustomVotes | imi-tat0r/CS2-CustomVotes | no | Player votes defined in the plugin config |
| AutomaticAds | wiruwiru/AutomaticAds-CS2 | no | Timed chat announcements |
| AFKManager | srwiruwiru/AFKManager | no | Kick or move AFK players. Can annoy on a practice server |
| RollTheDice | Kandru/cs2-roll-the-dice | no | Chaotic `!rtd` effects |
| Deathmatch | NockyCZ/CS2-Deathmatch | no | A deathmatch mode. A separate game mode, not an add-on |
| Retakes | B3none/cs2-retakes | no | Retakes mode. Replaces normal rounds |
| ChaseMod | ipsvn/ChaseMod | no | Hide and seek / chase |
| MenuManager, PlayerSettings, AnyBaseLib | NickFox007 | dependency | Libraries required by WeaponPaints, installed automatically with it |

Licenses differ per plugin (MIT and GPL-3.0 are both present). Nothing from these plugins is stored in this repository: they are downloaded to your server at install time and keep their own licenses. See [THIRD_PARTY.md](../THIRD_PARTY.md).

## Adding your own entry

Add an object to `app/lib/plugins.json`:

```json
{
  "id": "myplugin",
  "repo": "owner/repo",
  "license": "MIT",
  "desc": "What it does in one sentence"
}
```

- `id` becomes the key in `state.json > plugins`. It is also registered in `PLUGIN_IDS`.
- The release asset must be a ZIP laid out like the usual CounterStrikeSharp release (`addons/counterstrikesharp/plugins/<Name>/...`). The installer picks the first `.zip` that is not a Windows or source archive; set `pin: { tag, asset }` to fix a version and an exact asset regex.
- `dependency: true` hides the entry from the UI and installs it only when another plugin needs it.
- Run `npm test`: `plugins.test.js` and `install-pinned.test.js` check the catalogue shape.

## Skins: read this before you enable WeaponPaints

Skin changers modify what the server tells clients about item ownership. **Valve's Game Server Operation Guidelines forbid them**, and servers that use them can have their **Game Server Login Token revoked** (the account that created it can also be affected). The plugin is on by default because this project was built for a private practice server, but it is entirely optional:

- Turn it off on the Plugins page, or
- Create the GSLT on a separate, throw-away Steam account, and
- Do not advertise the server publicly.

You use this at your own risk; the maintainers are not responsible for banned tokens or accounts.

## CS2Panel in the game

The first-party plugin ([source](https://github.com/sink3x/cs2-panel-plugin)):

| Command | What |
|---|---|
| `!menu` | In-game chat menu |
| `css_playsound <id>` | Play a sound from the panel's sound library. Built-in game sounds play at once; your own files need a Workshop addon on the clients |
| `css_spawnanimal`, `css_killanimals` | Spawn and remove decorative animals |
| `css_refreshskins` | Apply a skin change without waiting for a respawn |

Full command list, permissions and build instructions: [cs2-panel-plugin](https://github.com/sink3x/cs2-panel-plugin).

Team names, logos, flags, clan tags and nicknames are set on the **Teams & tags** page of the panel and applied by this plugin. What the game does not allow a server to change (the side icons at the bottom of the screen, the layout of the TAB scoreboard) stays as is, see the [FAQ](faq.md).
