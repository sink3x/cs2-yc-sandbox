'use strict';
// Учёт времени, пока игровая ВМ в статусе RUNNING. Панель видит статус раз в минуту, поэтому считаем между соседними наблюдениями;
// если панель простаивала (перезапуск), провал больше MAX_GAP не засчитываем: лучше недосчитать, чем выдумать часы.
// Дни — по UTC. Это учёт аптайма, а не счёт из облака: диск, адрес и трафик сюда не входят.
const MAX_GAP_MS = 150_000;
const KEEP_DAYS = 400;
const DAY = 86_400_000;

const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

function createUptime({ file, readJson, writeJsonAtomic, now = () => Date.now() }) {
  let data = readJson(file, null);
  if (!data || typeof data !== 'object' || typeof data.days !== 'object') data = { days: {}, lastAt: 0, lastRunning: false };

  function save() {
    const cut = dayKey(now() - KEEP_DAYS * DAY);
    for (const k of Object.keys(data.days)) if (k < cut) delete data.days[k];
    try { writeJsonAtomic(file, data); } catch { /* диск недоступен: учёт в памяти продолжается */ }
  }

  /** Вызывается при каждом опросе статуса ВМ. */
  function observe(status) {
    const t = now();
    if (data.lastRunning && data.lastAt && t > data.lastAt) {
      let from = Math.max(data.lastAt, t - MAX_GAP_MS);
      while (from < t) {
        const next = Math.min(t, (Math.floor(from / DAY) + 1) * DAY); // граница суток UTC
        const k = dayKey(from);
        data.days[k] = (data.days[k] || 0) + (next - from) / 1000;
        from = next;
      }
    }
    data.lastAt = t; data.lastRunning = status === 'RUNNING';
    save();
  }

  /** Часы за сегодня, 7 суток (включая сегодня) и текущий месяц + ряд за 14 суток. */
  function summary() {
    const t = now(); const today = dayKey(t); const month = today.slice(0, 7);
    const hours = (k) => Math.round(((data.days[k] || 0) / 3600) * 100) / 100;
    const sum = (pred) => Math.round((Object.entries(data.days).filter(([k]) => pred(k)).reduce((a, [, s]) => a + s, 0) / 3600) * 100) / 100;
    const since7 = dayKey(t - 6 * DAY);
    const series = Array.from({ length: 14 }, (_x, i) => { const k = dayKey(t - (13 - i) * DAY); return { day: k, hours: hours(k) }; });
    return { today: hours(today), last7: sum((k) => k >= since7 && k <= today), month: sum((k) => k.startsWith(month)), series, since: Object.keys(data.days).sort()[0] || null };
  }

  return { observe, summary };
}

module.exports = { createUptime, MAX_GAP_MS };
