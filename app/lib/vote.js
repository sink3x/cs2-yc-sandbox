'use strict';
// Голосование за карту в панели: админ выбирает 2–6 карт и срок, игроки (и админы) голосуют на странице «Сервер».
// Один голос на аккаунт, голос можно сменить до конца. Итог — карта с наибольшим числом голосов (ничья — та, что раньше в списке).
const { MAP_RE, WORKSHOP_RE } = require('./util');

const MIN_OPTIONS = 2; const MAX_OPTIONS = 6; const MAX_MINUTES = 30;
const SHOW_RESULT_MS = 10 * 60_000; // итог показывается ещё 10 минут
const err = (m, status = 400) => Object.assign(new Error(m), { status });

function createVote({ now = () => Date.now() } = {}) {
  let v = null; // { id, options:[{id,label}], votes: Map(voter→optionId), startedAt, endsAt, by, auto, closedAt, winner, applied }
  let seq = 0;

  function settle() { // истёк срок → закрываем; возвращает голосование, если оно только что закрылось
    if (v && !v.closedAt && now() >= v.endsAt) return close(false);
    return null;
  }
  function close(early) {
    const counts = new Map(v.options.map((o) => [o.id, 0]));
    for (const id of v.votes.values()) counts.set(id, (counts.get(id) || 0) + 1);
    let best = null; let bestN = 0;
    for (const o of v.options) { const n = counts.get(o.id); if (n > bestN) { best = o.id; bestN = n; } }
    v.closedAt = now(); v.winner = best; v.early = Boolean(early);
    return v;
  }

  return {
    start({ options, minutes = 3, auto = true, by = '' }) {
      settle();
      if (v && !v.closedAt) throw err('vote already running', 409);
      const list = Array.isArray(options) ? options : [];
      const opts = []; const seen = new Set();
      for (const o of list) {
        const id = String(o && o.id != null ? o.id : o);
        if (!(MAP_RE.test(id) || WORKSHOP_RE.test(id))) throw err(`bad map: ${id}`);
        if (seen.has(id)) continue; seen.add(id);
        opts.push({ id, label: String((o && o.label) || id).slice(0, 60) });
      }
      if (opts.length < MIN_OPTIONS || opts.length > MAX_OPTIONS) throw err(`vote needs ${MIN_OPTIONS}-${MAX_OPTIONS} different maps`);
      const m = Number(minutes);
      if (!Number.isFinite(m) || m < 1 || m > MAX_MINUTES) throw err(`minutes must be 1-${MAX_MINUTES}`);
      v = { id: ++seq, options: opts, votes: new Map(), startedAt: now(), endsAt: now() + Math.round(m * 60_000), by: String(by).slice(0, 64), auto: Boolean(auto), closedAt: 0, winner: null, applied: false };
      return v;
    },
    cast(voter, optionId) {
      settle();
      if (!v || v.closedAt) throw err('no active vote', 409);
      if (!voter) throw err('voter required');
      if (!v.options.some((o) => o.id === String(optionId))) throw err('unknown option');
      v.votes.set(String(voter), String(optionId));
    },
    stop() { settle(); if (!v || v.closedAt) throw err('no active vote', 409); return close(true); },
    settle,
    /** Закрытое голосование с победителем, которое ещё не применено к серверу (один раз). */
    takePending() { settle(); if (v && v.closedAt && v.auto && v.winner && !v.applied) { v.applied = true; return v; } return null; },
    view(voter) {
      settle();
      if (!v || (v.closedAt && now() - v.closedAt > SHOW_RESULT_MS)) return { active: false, finished: false };
      const counts = new Map(v.options.map((o) => [o.id, 0]));
      for (const id of v.votes.values()) counts.set(id, counts.get(id) + 1);
      return {
        active: !v.closedAt, finished: Boolean(v.closedAt), id: v.id, endsAt: new Date(v.endsAt).toISOString(), remainingSec: v.closedAt ? 0 : Math.max(0, Math.ceil((v.endsAt - now()) / 1000)),
        options: v.options.map((o) => ({ ...o, votes: counts.get(o.id) })), total: v.votes.size, myVote: (voter && v.votes.get(String(voter))) || null,
        winner: v.winner, auto: v.auto, by: v.by,
      };
    },
  };
}

module.exports = { createVote, MIN_OPTIONS, MAX_OPTIONS, MAX_MINUTES };
