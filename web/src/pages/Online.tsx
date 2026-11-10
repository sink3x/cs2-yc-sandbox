import { useEffect, useRef, useState } from 'preact/hooks';
import { host, t, type LivePlayer } from '../host';

// «Игроки онлайн»: кто на сервере, кик / убить / команда / бан и сообщение всем в чат.
// Список берётся из обзора панели (его раз в 4 с обновляет старый интерфейс), отдельного опроса нет.

type Team = 'ct' | 't' | 'spec';
const TEAMS: Team[] = ['ct', 't', 'spec'];
const BAN_TERMS: [number, string][] = [[60, '1 час'], [1440, '1 день'], [10080, '7 дней'], [0, 'Навсегда']];
const SAY_MAX = 120;

type Act =
  | { action: 'kick' | 'slay'; id: number | string }
  | { action: 'team'; id: number | string; team: Team }
  | { action: 'ban'; id: number | string; minutes: number }
  | { action: 'say'; text: string };

const initial = (name: string | null): string => (name || '?').slice(0, 1).toUpperCase();

export function Online() {
  const [, setTick] = useState(0);
  const [banFor, setBanFor] = useState<number | string | null>(null);
  const [minutes, setMinutes] = useState(60);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // старый роутер размонтирование не вызывает: перерисовываем, пока элемент на экране
    host().onOverview(() => { if (root.current?.isConnected) setTick((n) => n + 1); });
  }, []);

  const send = async (body: Act, ok: string): Promise<boolean> => {
    setBusy(true);
    try {
      await host().api('POST', '/online/act', body);
      host().toast(t(ok), 's');
      window.setTimeout(() => host().refreshOverview(), 700);
      return true;
    } catch (e) {
      host().toast(e instanceof Error ? e.message : String(e), 'e');
      return false;
    } finally { setBusy(false); }
  };

  const sendMsg = async (): Promise<void> => {
    const text = msg.trim();
    if (!text) return;
    if (await send({ action: 'say', text }, 'Сообщение отправлено')) setMsg('');
  };

  const row = (p: LivePlayer) => {
    const name = p.name || '—';
    return (
      <div class="adm-row onl-row" key={String(p.id)}>
        <div class="adm-grid">
          <div class="adm-name">
            <span class="avatar ph" style="width:26px;height:26px;line-height:26px">{p.bot ? '🤖' : initial(p.name)}</span>
            <span>{name}</span>
            {p.bot ? <span class="pill">{t('бот')}</span> : null}
          </div>
          <div class="muted small onl-meta">{p.bot ? '' : `${t('пинг')} ${p.ping ?? '—'} · ${p.time ?? ''}`}</div>
          {p.bot ? (
            <div class="adm-act"><button class="btn" disabled={busy} onClick={() => void send({ action: 'kick', id: p.id }, 'Бот убран')}>{t('Убрать')}</button></div>
          ) : (
            <div class="adm-act onl-act">
              <button class="btn" disabled={busy} onClick={() => void send({ action: 'slay', id: p.id }, 'Убит')}>{t('Убить')}</button>
              {TEAMS.map((tm) => <button class="btn" key={tm} disabled={busy} onClick={() => void send({ action: 'team', id: p.id, team: tm }, 'Команда сменена')}>{tm === 'spec' ? 'Spec' : tm.toUpperCase()}</button>)}
              <button class="btn" disabled={busy} onClick={() => { if (window.confirm(`${t('Кикнуть игрока')} ${name}?`)) void send({ action: 'kick', id: p.id }, 'Игрок кикнут'); }}>{t('Кик')}</button>
              <button class="btn danger" disabled={busy} onClick={() => setBanFor(banFor === p.id ? null : p.id)}>{t('Бан…')}</button>
            </div>
          )}
        </div>
        {banFor === p.id && !p.bot ? (
          <div class="row" style="margin-top:10px">
            <span class="muted small">{t('Нужен плагин админ-команд CounterStrikeSharp (css_ban). Бан по userid — игрок отключится сразу.')}</span>
            <select aria-label={t('Срок')} value={String(minutes)} onChange={(e) => setMinutes(Number((e.currentTarget as HTMLSelectElement).value))}>
              {BAN_TERMS.map(([v, label]) => <option value={String(v)} key={v}>{t(label)}</option>)}
            </select>
            <button class="btn danger" disabled={busy} onClick={() => void send({ action: 'ban', id: p.id, minutes }, 'Игрок забанен').then((ok) => { if (ok) setBanFor(null); })}>{t('Забанить')}</button>
          </div>
        ) : null}
      </div>
    );
  };

  const ov = host().overview();
  const live = ov?.vm?.status === 'RUNNING' ? ov.server?.live ?? null : null;
  const all = live?.players ?? [];
  const humans = all.filter((p) => !p.bot);
  const bots = all.filter((p) => p.bot);

  return (
    <div ref={root}>
      <div class="card">
        <div class="row">
          <input type="text" maxLength={SAY_MAX} style="flex:1;min-width:180px" value={msg} placeholder={t('Сообщение всем в чат (до 120 символов)')} aria-label={t('Сообщение всем в чат (до 120 символов)')}
            onInput={(e) => setMsg((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void sendMsg(); }} />
          <button class="btn primary" disabled={busy || !msg.trim()} onClick={() => void sendMsg()}>{t('Отправить')}</button>
        </div>
        <div class="muted small" style="margin-top:6px">{t('Сообщение увидят все игроки в чате сервера. Без кавычек и «;».')}</div>
      </div>
      {!live ? (
        <div class="card muted">{t('Сервер выключен или ещё запускается — онлайн-списка нет.')}</div>
      ) : (
        <div class="card">
          <div class="muted small">{`${live.map ?? ''} · ${t('людей')}: ${humans.length}${live.maxPlayers ? ` / ${live.maxPlayers}` : ''} · ${t('ботов')}: ${bots.length}`}</div>
          {all.length ? <div class="adm-list">{[...humans, ...bots].map(row)}</div> : <div class="muted" style="margin-top:8px">{t('На сервере пока никого нет.')}</div>}
        </div>
      )}
    </div>
  );
}
