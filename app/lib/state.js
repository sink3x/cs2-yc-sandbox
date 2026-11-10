'use strict';
// Declarative server state (state.json on the persistent data disk), its validation, and the
// renderers that turn it into cfg files / admins.json / launch arguments. Everything here is pure.
const path = require('node:path');
const registry = require('./plugins.json');
const { PRESETS } = require('./presets');
const { STEAMID64_RE, CVAR_NAME_RE, MAP_RE, WORKSHOP_RE, cvarValueOk } = require('./util');
// Звук: id в библиотеке и то, что подставляется в клиентскую команду «play …» (путь/событие без пробелов, кавычек и «;»).
const SOUND_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SOUND_PLAY_RE = /^[A-Za-z0-9_./-]{1,160}$/;

const ADMIN_FLAGS = ['@css/root', '@css/generic', '@css/reservation', '@css/ban', '@css/unban', '@css/kick',
  '@css/changemap', '@css/cvar', '@css/config', '@css/rcon', '@css/slay', '@css/chat', '@css/vote', '@css/cheats'];

const PLUGIN_IDS = registry.map((p) => p.id);

function defaultState({ hostname = 'sandbox-cs-1', admins = [] } = {}) {
  const plugins = {};
  for (const p of registry) plugins[p.id] = Boolean(p.default) && !p.dependency;
  return {
    version: 1,
    server: {
      hostname, map: 'de_dust2', preset: 'practice',
      gameType: PRESETS.practice.gameType, gameMode: PRESETS.practice.gameMode,
      maxPlayers: 10, password: '', extraArgs: '',
    },
    cvars: { ...PRESETS.practice.cvars },
    flags: { autoUpdateGame: true, autoUpdatePlugins: true, insecure: false, dotChat: true },
    plugins,
    admins: admins.map((a) => ({ name: a.name, steamid: a.steamid, flags: a.flags || ['@css/root'] })),
    maps: [],
    sounds: [],
  };
}

/** Validate + normalise user supplied state. Returns { ok, errors, state }. */
function validateState(input, base = defaultState(), opts = {}) {
  const errors = [];
  const s = JSON.parse(JSON.stringify(base));
  // A state file written by an older version lacks keys that were added later; without defaults those keys
  // would be silently dropped below ("flag resets itself after saving").
  const dflt = defaultState();
  s.flags = { ...dflt.flags, ...(s.flags || {}) };
  s.plugins = { ...dflt.plugins, ...(s.plugins || {}) };
  if (!Array.isArray(s.sounds)) s.sounds = [];
  const inp = input && typeof input === 'object' ? input : {};
  const bad = (m) => errors.push(m);

  if (inp.server && typeof inp.server === 'object') {
    const v = inp.server;
    if (v.hostname !== undefined) {
      if (typeof v.hostname === 'string' && v.hostname.length >= 1 && v.hostname.length <= 64 && !/[";\\\r\n]/.test(v.hostname)) s.server.hostname = v.hostname;
      else bad('server.hostname: 1-64 chars, no quotes/semicolons');
    }
    if (v.map !== undefined) {
      if (typeof v.map === 'string' && (MAP_RE.test(v.map) || WORKSHOP_RE.test(v.map))) s.server.map = v.map;
      else bad('server.map: map name or workshop id');
    }
    if (v.preset !== undefined) {
      if (v.preset === 'custom' || PRESETS[v.preset]) s.server.preset = v.preset; else bad('server.preset: unknown');
    }
    for (const k of ['gameType', 'gameMode']) {
      if (v[k] !== undefined) {
        if (Number.isInteger(v[k]) && v[k] >= 0 && v[k] <= 4) s.server[k] = v[k]; else bad(`server.${k}: integer 0-4`);
      }
    }
    if (v.maxPlayers !== undefined) {
      if (Number.isInteger(v.maxPlayers) && v.maxPlayers >= 2 && v.maxPlayers <= 64) s.server.maxPlayers = v.maxPlayers;
      else bad('server.maxPlayers: 2-64');
    }
    if (v.password !== undefined) {
      if (typeof v.password === 'string' && /^[A-Za-z0-9_.!@#-]{0,32}$/.test(v.password)) s.server.password = v.password;
      else bad('server.password: up to 32 chars [A-Za-z0-9_.!@#-]');
    }
    if (v.extraArgs !== undefined) {
      if (typeof v.extraArgs === 'string' && /^[A-Za-z0-9_+\-.= ]{0,200}$/.test(v.extraArgs)) s.server.extraArgs = v.extraArgs.trim();
      else bad('server.extraArgs: only [A-Za-z0-9_+-.=] and spaces');
    }
  }

  if (inp.cvars !== undefined) {
    if (inp.cvars && typeof inp.cvars === 'object' && !Array.isArray(inp.cvars)) {
      const out = {};
      const entries = Object.entries(inp.cvars);
      if (entries.length > 300) bad('cvars: too many entries');
      for (const [k, val] of entries.slice(0, 300)) {
        const sv = String(val);
        if (!CVAR_NAME_RE.test(k)) { bad(`cvars.${k}: bad name`); continue; }
        if (!cvarValueOk(sv)) { bad(`cvars.${k}: bad value`); continue; }
        out[k] = sv;
      }
      s.cvars = out;
    } else bad('cvars: object expected');
  }

  if (inp.flags && typeof inp.flags === 'object') {
    for (const k of Object.keys(s.flags)) if (inp.flags[k] !== undefined) s.flags[k] = Boolean(inp.flags[k]);
  }

  if (inp.plugins && typeof inp.plugins === 'object') {
    for (const id of PLUGIN_IDS) if (inp.plugins[id] !== undefined) s.plugins[id] = Boolean(inp.plugins[id]);
    // режимы игры (Retakes, Deathmatch, HNS…) взаимоисключающие: два сразу ломают раунды друг другу
    const groups = {};
    for (const p of registry) if (p.group && s.plugins[p.id]) (groups[p.group] = groups[p.group] || []).push(p.title);
    for (const list of Object.values(groups)) if (list.length > 1) bad(`plugins: ${list.join(' и ')} — взаимоисключающие режимы игры, включите только один`);
  }

  if (inp.admins !== undefined) {
    if (!Array.isArray(inp.admins) || inp.admins.length > 30) bad('admins: array up to 30');
    else {
      const seen = new Set();
      const list = [];
      for (const a of inp.admins) {
        const name = typeof a.name === 'string' ? a.name.trim() : '';
        if (!/^[\w .\-]{1,32}$/.test(name)) { bad(`admins: bad name "${name}"`); continue; }
        if (!STEAMID64_RE.test(String(a.steamid))) { bad(`admins: bad SteamID64 for ${name}`); continue; }
        if (seen.has(a.steamid)) { bad(`admins: duplicate ${a.steamid}`); continue; }
        const flags = Array.isArray(a.flags) ? a.flags.filter((f) => ADMIN_FLAGS.includes(f)) : [];
        if (!flags.length) { bad(`admins: ${name} needs at least one flag`); continue; }
        seen.add(a.steamid);
        list.push({ name, steamid: String(a.steamid), flags });
      }
      // Защищённые админы (владелец): их нельзя удалить и нельзя лишить @css/root — иначе можно запереть себя на собственном сервере.
      for (const id of opts.protect || []) {
        const a = list.find((x) => x.steamid === id);
        if (!a) bad(`admins: protected ${id} cannot be removed`);
        else if (!a.flags.includes('@css/root')) bad(`admins: protected ${id} must keep @css/root`);
      }
      s.admins = list;
    }
  }

  if (inp.maps !== undefined) {
    if (!Array.isArray(inp.maps) || inp.maps.length > 100) bad('maps: array up to 100');
    else {
      s.maps = [];
      for (const m of inp.maps) {
        const id = String(m.id || '');
        const label = String(m.label || id).slice(0, 48);
        if (!(MAP_RE.test(id) || WORKSHOP_RE.test(id)) || /[";\\\r\n]/.test(label)) { bad(`maps: bad entry ${id}`); continue; }
        s.maps.push({ id, label });
      }
    }
  }

  if (inp.sounds !== undefined) {
    if (!Array.isArray(inp.sounds) || inp.sounds.length > 100) bad('sounds: array up to 100');
    else {
      const list = []; const seen = new Set(); let okAll = true;
      for (const x of inp.sounds) {
        const id = String((x && x.id) || ''); const play = String((x && x.play) || ''); const title = String((x && x.title) || id).slice(0, 48);
        if (!SOUND_ID_RE.test(id) || !SOUND_PLAY_RE.test(play) || /[\u0000-\u001f"\\]/.test(title)) { bad(`sounds: bad entry ${id}`); okAll = false; continue; }
        if (seen.has(id)) { bad(`sounds: duplicate ${id}`); okAll = false; continue; }
        seen.add(id); list.push({ id, title, play });
      }
      if (okAll) s.sounds = list;
    }
  }

  return { ok: errors.length === 0, errors, state: s };
}

/** Plugin ids that must be installed given the enabled set (deps included). */
function requiredPlugins(state) {
  const need = new Set();
  const byId = Object.fromEntries(registry.map((p) => [p.id, p]));
  const add = (id) => {
    if (need.has(id) || !byId[id]) return;
    need.add(id);
    for (const d of byId[id].needs || []) add(d);
  };
  for (const id of PLUGIN_IDS) if (state.plugins[id]) add(id);
  return [...need];
}

function renderOverrides(state) {
  const lines = ['// Generated by the cs2-yc-sandbox agent from state.json. Edit in the admin panel, not here.'];
  for (const k of Object.keys(state.cvars).sort()) lines.push(`${k} "${state.cvars[k]}"`);
  return lines.join('\n') + '\n';
}

function renderServerCfg(state, secrets = {}) {
  const lines = [
    '// Generated by the cs2-yc-sandbox agent. Edit in the admin panel, not here.',
    `hostname "${state.server.hostname}"`,
    `sv_password "${state.server.password || ''}"`,
    `rcon_password "${secrets.RCON_PASSWORD || ''}"`,
    'sv_hibernate_when_empty 0',
    'sv_logfile 1',
    'mp_logdetail 3', // урон/убийства в лог — для статистики панели
    'log on',
    'exec sandbox/overrides.cfg',
  ];
  return lines.join('\n') + '\n';
}

/** Библиотека звуков для плагина CS2Panel: { id: { play, title } }. */
function renderSounds(state) {
  const out = {};
  for (const x of state.sounds || []) out[x.id] = { play: x.play, title: x.title };
  return JSON.stringify(out, null, 2) + '\n';
}

function renderCssAdmins(state) {
  const out = {};
  for (const a of state.admins) out[a.name] = { identity: a.steamid, flags: a.flags };
  return JSON.stringify(out, null, 2) + '\n';
}

function renderMatchzyAdmins(state) {
  const out = {};
  for (const a of state.admins) out[a.steamid] = '';
  return JSON.stringify(out, null, 2) + '\n';
}

/** Argument vector for the cs2 binary (no shell involved). */
function launchArgs(state, secrets = {}) {
  const s = state.server;
  const args = ['-dedicated', '-console', '-usercon', '-ip', '0.0.0.0', '-port', '27015',
    '-maxplayers', String(s.maxPlayers), '+game_type', String(s.gameType), '+game_mode', String(s.gameMode)];
  if (WORKSHOP_RE.test(s.map)) args.push('+host_workshop_map', s.map); else args.push('+map', s.map);
  if (secrets.GSLT) args.push('+sv_setsteamaccount', secrets.GSLT);
  if (secrets.STEAM_WEB_API_KEY) args.push('-authkey', secrets.STEAM_WEB_API_KEY);
  if (state.flags.insecure) args.push('-insecure');
  if (s.extraArgs) args.push(...s.extraArgs.split(/\s+/).filter(Boolean));
  return args;
}

/** Patch CounterStrikeSharp core.json: WeaponPaints needs FollowCS2ServerGuidelines=false; chat triggers «!» «.» «/». */
function patchCoreJson(existing, state) {
  const base = existing && typeof existing === 'object' ? existing : {
    PublicChatTrigger: ['!'], SilentChatTrigger: ['/'], FollowCS2ServerGuidelines: true,
    PluginHotReloadEnabled: true, PluginAutoLoadEnabled: true, ServerLanguage: 'en',
    UnlockConCommands: true, UnlockConVars: true,
  };
  // Чат-команды: «!» и «.» — обычные (видны в чате), «/» — тихие (сообщение скрывается). Точку можно отключить флагом dotChat.
  const dot = !state.flags || state.flags.dotChat !== false;
  const pub = new Set(Array.isArray(base.PublicChatTrigger) ? base.PublicChatTrigger : ['!']); pub.add('!'); if (dot) pub.add('.'); else pub.delete('.');
  const silent = new Set(Array.isArray(base.SilentChatTrigger) ? base.SilentChatTrigger : ['/']); silent.add('/');
  return { ...base, PublicChatTrigger: [...pub], SilentChatTrigger: [...silent], FollowCS2ServerGuidelines: !state.plugins.weaponpaints };
}

const GAME_DIR = '/srv/cs2/server/game/csgo';
function paths(gameDir = GAME_DIR) {
  const css = path.join(gameDir, 'addons/counterstrikesharp');
  return {
    gameDir,
    cfgDir: path.join(gameDir, 'cfg'),
    serverCfg: path.join(gameDir, 'cfg/server.cfg'),
    overrides: path.join(gameDir, 'cfg/sandbox/overrides.cfg'),
    css,
    cssAdmins: path.join(css, 'configs/admins.json'),
    cssCore: path.join(css, 'configs/core.json'),
    cssPlugins: path.join(css, 'plugins'),
    cssPluginsDisabled: path.join(css, 'plugins_disabled'),
    wpConfig: path.join(css, 'configs/plugins/WeaponPaints/WeaponPaints.json'),
    cssSounds: path.join(css, 'configs/plugins/CS2Panel/sounds.json'),
    matchzyAdmins: path.join(gameDir, 'cfg/MatchZy/admins.json'),
  };
}

module.exports = {
  ADMIN_FLAGS, PLUGIN_IDS, defaultState, validateState, requiredPlugins, renderOverrides, renderServerCfg,
  renderCssAdmins, renderSounds, SOUND_ID_RE, SOUND_PLAY_RE, renderMatchzyAdmins, launchArgs, patchCoreJson, paths, registry,
};
