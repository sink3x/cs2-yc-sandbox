import { useEffect, useState } from 'preact/hooks';
import { host, t } from '../host';

// Callouts: схемы карт и названия мест. Данные: GET /api/callouts, картинки: /callouts/<карта>.webp.
// Админ может переименовать место, перенести метку, сменить сторону, скрыть официальное место (и вернуть) и добавить своё.

type Side = 't' | 'm' | 'ct';
type RawPlace = [string, number, number, Side, 'a' | 'b' | 'm', number];
interface MapDef { name: string; box?: [number, number, number]; conf: 'high' | 'mid' | 'low'; places: RawPlace[] }
interface Added { id: string; name: string; x: number; y: number; side: Side }
interface Custom { rename: Record<string, string>; move: Record<string, [number, number]>; added: Record<string, Added[]>; side: Record<string, Side>; deleted: string[] }
interface Data { maps: Record<string, MapDef>; names: Record<string, Record<string, string>>; custom?: Partial<Custom> }
interface Place { key: string; id?: string; en: string; x: number; y: number; side: Side; near: string; lvl: number; custom: boolean; renamed: boolean; moved: boolean; sided: boolean; name: string }
interface Draft { map: string; x: number; y: number; name: string; side: Side }

// версия картинок радаров: меняйте при замене файлов, иначе браузер неделю держит старые
const IMG_V = 2;
const SIDE_LABEL: Record<Side, string> = { t: 'Сторона T', m: 'Центр карты', ct: 'Сторона CT' };
const NEAR: Record<string, string> = { a: 'Рядом с точкой A', b: 'Рядом с точкой B', m: 'Между точками A и B' };
const LVL = ['Низкая', 'Средняя', 'Высокая'];
const CONF = {
  mid: 'Положение мест на этой карте определено с небольшой погрешностью.',
  low: 'Карта сильно переработана в CS2: положение мест здесь примерное, ориентируйтесь на названия.',
};
const SIDES: [Side, string][] = [['t', 'T'], ['m', 'Центр'], ['ct', 'CT']];

const norm = (c?: Partial<Custom>): Custom => ({ rename: c?.rename ?? {}, move: c?.move ?? {}, added: c?.added ?? {}, side: c?.side ?? {}, deleted: c?.deleted ?? [] });
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

function placesOf(d: Data, id: string, lang: string): Place[] {
  const cu = norm(d.custom);
  const label = (en: string): string => { const n = d.names[en]; return lang === 'en' || !n ? en : (n[lang] || en); };
  const base = d.maps[id]!.places.filter(([en]) => !cu.deleted.includes(`${id}|${en}`)).map(([en, x, y, side, near, lvl]): Place => {
    const key = `${id}|${en}`; const mv = cu.move[key]; const sd = cu.side[key];
    return { key, en, x: mv ? mv[0] : x, y: mv ? mv[1] : y, side: sd ?? side, near, lvl, custom: false, renamed: !!cu.rename[key], moved: !!mv, sided: !!sd && sd !== side, name: cu.rename[key] ?? label(en) };
  });
  const own = (cu.added[id] ?? []).map((a): Place => ({ key: `${id}|${a.id}`, id: a.id, en: '', x: a.x, y: a.y, side: a.side, near: 'm', lvl: -1, custom: true, renamed: false, moved: false, sided: false, name: a.name }));
  return base.concat(own);
}

function Seg<K extends string>({ value, items, onPick }: { value: K; items: [K, string][]; onPick(k: K): void }) {
  return <div class="seg" role="group">{items.map(([k, label]) => <button key={k} class={value === k ? 'on' : ''} onClick={() => onPick(k)}>{t(label)}</button>)}</div>;
}

export function Callouts() {
  const H = host();
  const lang = H.lang;
  const canEdit = H.role !== 'player';
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [side, setSide] = useState<'' | Side>('');
  const [lvl, setLvl] = useState('');
  const [all, setAll] = useState(false);
  const [mode, setMode] = useState<'add' | 'move' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { H.api<Data>('GET', '/callouts').then(setData).catch((e: Error) => setError(e.message)); }, []);

  if (error) return <div class="banner">{error}</div>;
  if (!data) return <div class="muted">{t('Загрузка…')}</div>;

  const ids = Object.keys(data.maps);
  const id = ids.includes(H.slug) ? H.slug : ids[0]!;
  const map = data.maps[id]!;
  const places = placesOf(data, id, lang);
  const byKey = new Map(places.map((p) => [p.key, p]));
  const cur = sel ? byKey.get(sel) ?? null : null;
  const sorted = [...places].sort((a, b) => a.name.localeCompare(b.name, lang));
  const multi = places.some((p) => p.lvl >= 0);
  const enName = (en: string): string => { const n = data.names[en]; return lang === 'en' || !n ? en : (n[lang] || en); };

  const match = (p: Place): boolean => {
    if (side && p.side !== side) return false;
    if (multi && lvl && String(p.lvl) !== lvl) return false;
    const s = q.trim().toLowerCase(); if (!s) return true;
    return p.name.toLowerCase().includes(s) || p.en.toLowerCase().includes(s) || (!!p.en && enName(p.en).toLowerCase().includes(s));
  };
  const shown = sorted.filter(match);

  /** Сохранить правки целиком. */
  const save = async (next: Custom, okMsg?: string): Promise<void> => {
    setBusy(true);
    try {
      const r = await H.api<{ custom: Custom }>('PUT', '/callouts/custom', next);
      setData({ ...data, custom: r.custom });
      if (okMsg) H.toast(t(okMsg), 's');
    } catch (e) { H.toast(e instanceof Error ? e.message : String(e), 'e'); } finally { setBusy(false); }
  };
  const edit = (fn: (n: Custom) => void, okMsg?: string): Promise<void> => { const n = clone(norm(data.custom)); fn(n); return save(n, okMsg); };

  const [bx, by, bs] = map.box ?? [0, 0, 1000];
  const k = bs / 1000;

  const onSvgClick = (e: MouseEvent): void => {
    if (!mode) return;
    const svg = e.currentTarget as SVGSVGElement; const m = svg.getScreenCTM(); if (!m) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(m.inverse());
    const x = Math.min(1000, Math.max(0, Math.round(p.x * 10) / 10)); const y = Math.min(1000, Math.max(0, Math.round(p.y * 10) / 10));
    if (mode === 'add') { setDraft({ map: id, x, y, name: draft?.name ?? '', side: draft?.side ?? 'm' }); setMode(null); return; }
    if (mode === 'move' && cur) {
      setMode(null);
      void edit((n) => {
        if (cur.custom) n.added[id] = (n.added[id] ?? []).map((a) => (a.id === cur.id ? { ...a, x, y } : a));
        else n.move[cur.key] = [x, y];
      }, 'Положение сохранено');
    }
  };
  const pick = (key: string): void => { setSel(sel === key ? null : key); setDraft(null); };

  const point = (p: { name: string; side: Side; x: number; y: number; custom: boolean; site?: boolean }, cls: string, onPick?: () => void) => (
    <g class={`co-pt s-${p.side}${p.site ? ' site' : ''}${p.custom ? ' own' : ''} ${cls}`} tabIndex={0} role="button" aria-label={p.name} transform={`translate(${p.x} ${p.y})`}
      onClick={(e) => { if (mode) return; e.stopPropagation(); onPick?.(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(); } }}>
      <circle r={(p.site ? 11 : 7) * k} />
      <text x={12 * k} y={5 * k}>{p.name}</text>
    </g>
  );

  const hidden = norm(data.custom).deleted.filter((key) => key.startsWith(`${id}|`));

  return (
    <div>
      <div class="tabs" role="tablist">
        {ids.map((m) => <button key={m} class={m === id ? 'on' : ''} role="tab" aria-selected={m === id} onClick={() => { setSel(null); setLvl(''); setMode(null); setDraft(null); H.go('callouts', m); }}>{data.maps[m]!.name}</button>)}
      </div>
      {map.conf !== 'high' ? <div class="banner">{t(CONF[map.conf])}</div> : null}
      {mode === 'add' ? <div class="banner">{t('Нажмите на схему, чтобы поставить метку своего места.')}</div> : null}
      {mode === 'move' ? <div class="banner">{t('Нажмите на схему, куда перенести выбранную метку.')}</div> : null}
      <div class="co-wrap">
        <div>
          <div class={`co-map${mode ? ' co-pick' : ''}${all ? ' co-all' : ''}`}>
            <svg class="co-svg" viewBox={`${bx} ${by} ${bs} ${bs}`} role="group" aria-label={t('Места на карте')} style={`--k:${k.toFixed(3)}`} onClick={onSvgClick}>
              <image href={`/callouts/${id}.webp?v=${IMG_V}`} x={0} y={0} width={1000} height={1000} preserveAspectRatio="none"><title>{map.name}</title></image>
              {places.filter((p) => p.key !== sel).map((p) => point({ ...p, site: !p.custom && (p.en === 'A Site' || p.en === 'B Site') }, `${match(p) ? '' : 'dim'}`, () => pick(p.key)))}
              {cur ? point({ ...cur, site: !cur.custom && (cur.en === 'A Site' || cur.en === 'B Site') }, 'on', () => pick(cur.key)) : null}
              {draft && draft.map === id ? point({ name: draft.name || t('Новое место'), side: draft.side, x: draft.x, y: draft.y, custom: true }, 'on draft') : null}
            </svg>
          </div>
          <div class="row">
            <button class={`btn${all ? ' on' : ''}`} onClick={() => setAll(!all)}>{t('Все названия на схеме')}</button>
            {canEdit ? <button class={`btn${mode === 'add' ? ' on' : ''}`} onClick={() => { setMode(mode === 'add' ? null : 'add'); setSel(null); }}>{t('Добавить своё место')}</button> : null}
            <span class="muted">{t(`Найдено: ${shown.length}`)}</span>
          </div>
        </div>
        <div>
          <div class="row">
            <input type="text" placeholder={t('Поиск места…')} aria-label={t('Поиск места')} value={q} onInput={(e) => setQ(e.currentTarget.value)} />
            <Seg value={side} items={[['', 'Все'], ['t', 'T'], ['m', 'Центр'], ['ct', 'CT']]} onPick={(k) => setSide(k as '' | Side)} />
          </div>
          {multi ? <div class="row"><span class="muted">{t('Высота')}</span><Seg value={lvl} items={[['', 'Все'], ['0', 'Низкая'], ['1', 'Средняя'], ['2', 'Высокая']]} onPick={setLvl} /></div> : null}
          <div class="co-list">
            {shown.map((p) => (
              <button key={p.key} class={`co-item s-${p.side}${sel === p.key ? ' on' : ''}`} onClick={() => pick(p.key)}>
                <i class="co-dot" /><span class="co-n">{p.name}</span>{p.en && p.name !== p.en ? <span class="muted co-en">{p.en}</span> : null}
              </button>
            ))}
            {shown.length ? null : <div class="muted">{t('Ничего не найдено')}</div>}
          </div>
          <div class="card co-detail">
            {draft && draft.map === id
              ? <DraftForm draft={draft} setDraft={setDraft} busy={busy} onAgain={() => setMode('add')} onCancel={() => { setDraft(null); setMode(null); }}
                  onSave={async () => {
                    const nm = draft.name.trim(); if (!nm) { H.toast(t('Введите название места'), 'e'); return; }
                    const used = new Set((norm(data.custom).added[id] ?? []).map((a) => a.id));
                    let n = Date.now() % 1e6; let nid: string; do { nid = `c${n.toString(36)}`; n++; } while (used.has(nid));
                    const d0 = draft; setDraft(null);
                    await edit((c) => { c.added[id] = [...(c.added[id] ?? []), { id: nid, name: nm, x: d0.x, y: d0.y, side: d0.side }]; }, 'Место добавлено');
                  }} />
              : cur
                ? <Detail p={cur} map={map} mapId={id} canEdit={canEdit} busy={busy} mode={mode} setMode={setMode} edit={edit} clear={() => setSel(null)} label={enName} />
                : <div class="muted">{t(mode === 'add' ? 'Нажмите на схему, чтобы поставить метку.' : 'Выберите место на схеме или в списке.')}</div>}
          </div>
        </div>
      </div>
      {canEdit && hidden.length ? (
        <div class="card co-hidden">
          <h3>{t('Скрытые места')} ({hidden.length})</h3>
          <div class="chips">{hidden.map((key) => <button key={key} class="chip" title={t('Вернуть')} disabled={busy} onClick={() => void edit((n) => { n.deleted = n.deleted.filter((x) => x !== key); }, 'Место возвращено')}>↩ {enName(key.slice(id.length + 1))}</button>)}</div>
          <div class="row"><button class="btn" disabled={busy} onClick={() => void edit((n) => { n.deleted = n.deleted.filter((x) => !x.startsWith(`${id}|`)); }, 'Место возвращено')}>{t('Вернуть все')}</button></div>
        </div>
      ) : null}
      <p class="muted co-note">{t('Схема построена по навигационной сетке карты (это не радар Valve). Названия мест — официальные, из данных Valve; ru/de/fr — общепринятые названия. Положение меток примерное.')}</p>
    </div>
  );
}

function DraftForm({ draft, setDraft, busy, onSave, onAgain, onCancel }: { draft: Draft; setDraft(d: Draft): void; busy: boolean; onSave(): void; onAgain(): void; onCancel(): void }) {
  return (
    <div>
      <h3>{t('Новое место')}</h3>
      <div class="row"><input type="text" maxLength={40} value={draft.name} placeholder={t('Название места')} aria-label={t('Название места')} onInput={(e) => setDraft({ ...draft, name: e.currentTarget.value })} /></div>
      <div class="row"><Seg value={draft.side} items={SIDES} onPick={(s) => setDraft({ ...draft, side: s })} /></div>
      <div class="row">
        <button class="btn primary" disabled={busy} onClick={onSave}>{t('Сохранить')}</button>
        <button class="btn" onClick={onAgain}>{t('Выбрать точку заново')}</button>
        <button class="btn" onClick={onCancel}>{t('Отмена')}</button>
      </div>
    </div>
  );
}

interface DetailProps {
  p: Place; map: MapDef; mapId: string; canEdit: boolean; busy: boolean; mode: 'add' | 'move' | null;
  setMode(m: 'add' | 'move' | null): void; edit(fn: (n: Custom) => void, okMsg?: string): Promise<void>; clear(): void; label(en: string): string;
}

function Detail({ p, map, mapId, canEdit, busy, mode, setMode, edit, clear, label }: DetailProps) {
  const [name, setName] = useState(p.name);
  const [shownKey, setShownKey] = useState(p.key);
  if (shownKey !== p.key) { setShownKey(p.key); setName(p.name); }
  const H = host();
  const copy = (): void => {
    (navigator.clipboard ? navigator.clipboard.writeText(p.name) : Promise.reject(new Error('no clipboard')))
      .then(() => H.toast(t('Скопировано'), 's'), () => H.toast(t('Не удалось скопировать'), 'e'));
  };
  const saveName = (): void => {
    const nm = name.trim();
    if (p.custom && !nm) { H.toast(t('Введите название места'), 'e'); return; }
    void edit((n) => {
      if (p.custom) n.added[mapId] = (n.added[mapId] ?? []).map((a) => (a.id === p.id ? { ...a, name: nm } : a));
      else if (!nm || nm === label(p.en)) delete n.rename[p.key]; else n.rename[p.key] = nm;
    }, 'Сохранено');
  };
  const setSide = (s: Side): void => { void edit((n) => { if (p.custom) n.added[mapId] = (n.added[mapId] ?? []).map((a) => (a.id === p.id ? { ...a, side: s } : a)); else n.side[p.key] = s; }); };
  const reset = (): void => { void edit((n) => { delete n.rename[p.key]; delete n.move[p.key]; delete n.side[p.key]; }, 'Сброшено к исходному'); };
  const remove = (): void => {
    void host().confirm(t(p.custom ? 'Удалить это место?' : 'Скрыть это место? Его можно вернуть в списке скрытых мест.'), { ok: p.custom ? 'Удалить' : 'Скрыть', danger: Boolean(p.custom) }).then((yes) => {
      if (!yes) return;
      clear();
      void edit((n) => {
        if (p.custom) { n.added[mapId] = (n.added[mapId] ?? []).filter((a) => a.id !== p.id); if (!n.added[mapId]!.length) delete n.added[mapId]; }
        else { n.deleted = [...new Set([...n.deleted, p.key])]; delete n.rename[p.key]; delete n.move[p.key]; delete n.side[p.key]; } // официальное место только скрываем
      }, p.custom ? 'Место удалено' : 'Место скрыто');
    });
  };
  return (
    <div>
      <h3>{map.name}</h3>
      <div class="co-title">{p.name}</div>
      <dl class="kv">
        {p.custom ? <><dt>{t('Тип')}</dt><dd>{t('Своё место')}</dd></> : <><dt>{t('Название в игре')}</dt><dd>{p.en}</dd></>}
        <dt>{t('Расположение')}</dt><dd>{t(SIDE_LABEL[p.side])}{p.custom ? null : <> · {t(NEAR[p.near] ?? '')}</>}</dd>
        {p.lvl >= 0 ? <><dt>{t('Высота')}</dt><dd>{t(LVL[p.lvl] ?? '')}</dd></> : null}
      </dl>
      <div class="row"><button class="btn" onClick={copy}>{t('Скопировать название')}</button></div>
      {canEdit ? (
        <div class="co-edit">
          <div class="row">
            <input type="text" maxLength={40} value={name} aria-label={t('Своё название')} onInput={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveName(); }} />
            <button class="btn primary" disabled={busy} onClick={saveName}>{t('Сохранить название')}</button>
          </div>
          <div class="row"><span class="muted">{t('Сторона')}</span><Seg value={p.side} items={SIDES} onPick={setSide} /></div>
          <div class="row">
            <button class={`btn${mode === 'move' ? ' on' : ''}`} onClick={() => setMode(mode === 'move' ? null : 'move')}>{t('Перенести метку')}</button>
            {!p.custom && (p.renamed || p.moved || p.sided) ? <button class="btn" disabled={busy} onClick={reset}>{t('Сбросить к исходному')}</button> : null}
            <button class="btn danger" disabled={busy} onClick={remove}>{t(p.custom ? 'Удалить место' : 'Скрыть место')}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
