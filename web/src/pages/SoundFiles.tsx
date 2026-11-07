import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { host, t } from '../host';

interface SoundFile { name: string; size: number; mtime: number }
type SyncState = 'synced' | 'pending' | 'outdated' | 'error';
interface SyncInfo { state: SyncState; at: number | null; error: string | null; busy: boolean }
interface Limits { maxFile: number; maxFiles: number; maxTotal: number }
interface FilesResponse { files: SoundFile[]; sync: SyncInfo; limits: Limits }

const OK_EXT = /\.(wav|mp3|ogg)$/i;
const SYNC_TEXT: Record<SyncState, [string, string]> = {
  synced: ['ok', 'На игровой ВМ: всё доставлено'],
  pending: ['warn', 'Ждёт доставки на игровую ВМ (она выключена или идёт сверка)'],
  outdated: ['bad', 'Агент на игровой ВМ старый и не принимает файлы: перезапустите ВМ, когда на ней никого нет'],
  error: ['bad', 'Не удалось доставить файлы на игровую ВМ'],
};
const sizeText = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

class UploadError extends Error {
  constructor(message: string, readonly status: number, readonly raw: string) { super(message); }
}

async function upload(file: File, overwrite: boolean): Promise<void> {
  const r = await fetch(`/api/sound-files?name=${encodeURIComponent(file.name)}${overwrite ? '&overwrite=1' : ''}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'cs2panel' }, body: file,
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new UploadError(host().ruErr(j.error ?? r.statusText), r.status, j.error ?? '');
  }
}

export function SoundFiles() {
  const [data, setData] = useState<FilesResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    window.clearTimeout(timer.current);
    try {
      const r = await host().api<FilesResponse>('GET', '/sound-files');
      setData(r); setLoadError('');
      // опрос идёт, пока страница на экране: старый роутер просто убирает элемент, размонтирования он не вызывает
      if (r.sync.busy || r.sync.state === 'pending') timer.current = window.setTimeout(() => { if (root.current?.isConnected) void load(); }, 4000);
    } catch (e) { setLoadError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => {
    void load();
    return () => { window.clearTimeout(timer.current); audio.current?.pause(); };
  }, [load]);

  /** Обёртка действия: блокирует кнопки, показывает ошибку тостом. */
  const run = async (fn: () => Promise<void>, ok?: string): Promise<void> => {
    setBusy(true);
    try { await fn(); if (ok) host().toast(t(ok), 's'); } catch (e) { host().toast(e instanceof Error ? e.message : String(e), 'e'); } finally { setBusy(false); }
  };

  const onFiles = (list: FileList | File[]): void => {
    const files = [...list];
    if (!files.length || !data) return;
    void run(async () => {
      for (const f of files) {
        if (!OK_EXT.test(f.name)) throw new Error(t('Только файлы .wav, .mp3 и .ogg'));
        if (f.size > data.limits.maxFile) throw new Error(`${f.name}: ${t('файл больше 8 МБ')}`);
      }
      let done = 0;
      for (const f of files) {
        try { await upload(f, false); } catch (e) {
          if (e instanceof UploadError && e.status === 409 && /already exists/.test(e.raw)) {
            if (!window.confirm(`${f.name}: ${t('файл с таким именем уже есть. Заменить?')}`)) continue;
            await upload(f, true);
          } else throw e;
        }
        done++;
      }
      await load();
      if (done) host().toast(`${t('Загружено файлов')}: ${done}`, 's');
    });
  };

  const preview = (name: string): void => {
    audio.current?.pause();
    if (playing === name) { setPlaying(null); return; }
    const a = new Audio(`/api/sound-files/${encodeURIComponent(name)}`);
    audio.current = a; setPlaying(name);
    const stop = (): void => setPlaying((p) => (p === name ? null : p));
    a.onended = stop;
    a.onerror = () => { stop(); host().toast(t('Не удалось воспроизвести файл'), 'e'); };
    a.play().catch(() => a.onerror?.(new Event('error')));
  };

  const saveRename = (f: SoundFile): void => {
    const ext = f.name.slice(f.name.lastIndexOf('.'));
    const base = draft.trim();
    setRenaming(null);
    if (!base || `${base}${ext}` === f.name) return;
    void run(async () => {
      await host().api('POST', `/sound-files/${encodeURIComponent(f.name)}/rename`, { to: `${base}${ext}` });
      await load();
    }, 'Переименовано');
  };

  const remove = (f: SoundFile): void => {
    if (!window.confirm(`${t('Удалить файл')} ${f.name}? ${t('Он пропадёт и с игровой ВМ.')}`)) return;
    void run(async () => { await host().api('DELETE', `/sound-files/${encodeURIComponent(f.name)}`); await load(); }, 'Файл удалён');
  };

  const syncNow = (): void => void run(async () => { await host().api('POST', '/sound-files-sync'); await load(); }, 'Сверка выполнена');

  if (loadError) return <div class="card snd-files"><h3>{t('Свои аудиофайлы')}</h3><div class="banner">{loadError}</div></div>;
  if (!data) return <div class="card snd-files"><h3>{t('Свои аудиофайлы')}</h3><div class="muted">{t('Загрузка…')}</div></div>;

  const [pillKind, pillText] = SYNC_TEXT[data.sync.state] ?? SYNC_TEXT.error;
  const total = data.files.reduce((a, x) => a + x.size, 0);

  return (
    <div class="card snd-files" ref={root}>
      <h3>{t('Свои аудиофайлы')}</h3>
      <p class="muted small">
        {t('Файлы хранятся в панели и сами доставляются на игровую ВМ (папка data/custom-sounds), в том числе когда ВМ включится позже. Игрокам они сами не попадают: клиент получает звуки только из Workshop-аддона. Здесь удобно держать исходники для такого аддона.')}
      </p>
      <div class="row">
        <span class={`pill ${pillKind}`}><i />{t(pillText)}</span>
        {data.sync.state === 'error' && data.sync.error ? <span class="muted small">{data.sync.error}</span> : null}
        <button class="btn" disabled={busy} onClick={syncNow}>{t('Сверить сейчас')}</button>
      </div>
      <div
        class={`snd-drop${over ? ' over' : ''}`} tabIndex={0} role="button"
        onClick={() => picker.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer) onFiles(e.dataTransfer.files); }}
      >
        <b>{t('Загрузить звук')}</b>
        <span class="muted small">{t('Перетащите файлы сюда или нажмите. WAV, MP3 или OGG, до 8 МБ каждый.')}</span>
      </div>
      <input
        ref={picker} type="file" hidden multiple accept=".wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg"
        onChange={(e) => { const el = e.currentTarget; const list = [...(el.files ?? [])]; el.value = ''; onFiles(list); }}
      />
      {data.files.length ? (
        <div class="snd-list">
          {data.files.map((f) => (
            <div class="snd-row" key={f.name}>
              {renaming === f.name ? (
                <div class="snd-name"><div class="row">
                  <input
                    type="text" value={draft} maxLength={48} style="width:200px" aria-label={t('Новое имя')} autoFocus
                    onInput={(e) => setDraft(e.currentTarget.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveRename(f); if (e.key === 'Escape') setRenaming(null); }}
                  />
                  <span class="muted">{f.name.slice(f.name.lastIndexOf('.'))}</span>
                  <button class="btn primary" onClick={() => saveRename(f)}>{t('Сохранить')}</button>
                  <button class="btn" onClick={() => setRenaming(null)}>{t('Отмена')}</button>
                </div></div>
              ) : (
                <div class="snd-name">
                  <b>{f.name}</b>
                  <span class="muted small">{sizeText(f.size)} · {new Date(f.mtime).toLocaleString(host().locale)}</span>
                </div>
              )}
              <button class="btn snd-pv" title={t('Прослушать')} aria-label={t('Прослушать')} onClick={() => preview(f.name)}>{playing === f.name ? '■' : '▶'}</button>
              <button class="btn" onClick={() => { setDraft(f.name.slice(0, f.name.lastIndexOf('.'))); setRenaming(f.name); }}>{t('Переименовать')}</button>
              <a class="btn" href={`/api/sound-files/${encodeURIComponent(f.name)}?dl=1`} download={f.name}>{t('Скачать')}</a>
              <button class="btn danger" disabled={busy} onClick={() => remove(f)}>{t('Удалить')}</button>
            </div>
          ))}
        </div>
      ) : <div class="muted">{t('Файлов пока нет.')}</div>}
      {data.files.length ? <div class="muted small">{data.files.length} / {data.limits.maxFiles} · {sizeText(total)} / {Math.round(data.limits.maxTotal / 1048576)} MB</div> : null}
    </div>
  );
}
