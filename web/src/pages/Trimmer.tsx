import { useEffect, useRef, useState } from 'preact/hooks';
import { host, t } from '../host';

/** Редактор обрезки звука: волна, два маркера, прослушивание выделенного, сохранение WAV (всё в браузере). */

interface Props {
  name: string;
  maxFile: number;
  /** Сохранить результат; replace — заменить исходный файл (только для .wav). */
  onSave(file: File, replace: boolean): Promise<void>;
  onClose(): void;
}

const FADE = 0.02; // секунд: микро-фейд на краях, чтобы не было щелчков
const fmt = (s: number): string => `${s.toFixed(2)} ${t('с')}`;

/** PCM16 WAV из диапазона буфера. Если файл не влезает в лимит — сводим в моно. */
export function encodeWav(buf: AudioBuffer, from: number, to: number, fade: boolean, limit: number): Blob {
  const rate = buf.sampleRate;
  const i0 = Math.max(0, Math.floor(from * rate));
  const i1 = Math.min(buf.length, Math.ceil(to * rate));
  const frames = Math.max(0, i1 - i0);
  let ch = buf.numberOfChannels;
  if (44 + frames * ch * 2 > limit && ch > 1) ch = 1;
  const bytes = 44 + frames * ch * 2;
  if (bytes > limit) throw new Error(t('Фрагмент слишком длинный: файл будет больше 8 МБ'));
  const out = new DataView(new ArrayBuffer(bytes));
  const w = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, bytes - 8, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, frames * ch * 2, true);
  const src = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const fadeN = fade ? Math.min(Math.floor(rate * FADE), Math.floor(frames / 2)) : 0;
  let o = 44;
  for (let i = 0; i < frames; i++) {
    let g = 1;
    if (fadeN) { if (i < fadeN) g = i / fadeN; else if (frames - 1 - i < fadeN) g = (frames - 1 - i) / fadeN; }
    for (let c = 0; c < ch; c++) {
      let v: number;
      if (ch === 1 && src.length > 1) { v = 0; for (const s of src) v += s[i0 + i] ?? 0; v /= src.length; } else v = src[c]?.[i0 + i] ?? 0;
      v = Math.max(-1, Math.min(1, v * g));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
    }
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

export function Trimmer({ name, maxFile, onSave, onClose }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [buf, setBuf] = useState<AudioBuffer | null>(null);
  const [error, setError] = useState('');
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [fade, setFade] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [head, setHead] = useState<number | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const src = useRef<AudioBufferSourceNode | null>(null);
  const raf = useRef(0);
  const drag = useRef<'a' | 'b' | null>(null);
  const peaks = useRef<Float32Array | null>(null);

  const isWav = /\.wav$/i.test(name);
  const dur = buf?.duration ?? 0;

  const stop = (): void => {
    cancelAnimationFrame(raf.current);
    try { src.current?.stop(); } catch { /* уже остановлен */ }
    src.current = null; setPlaying(false); setHead(null);
  };

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/sound-files/${encodeURIComponent(name)}`);
        if (!r.ok) throw new Error(r.statusText);
        const ac = new AudioContext(); ctx.current = ac;
        const decoded = await ac.decodeAudioData(await r.arrayBuffer());
        if (dead) return;
        setBuf(decoded); setA(0); setB(decoded.duration);
      } catch (e) { if (!dead) setError(`${t('Не удалось открыть файл для редактирования')}: ${e instanceof Error ? e.message : String(e)}`); }
    })();
    return () => { dead = true; stop(); void ctx.current?.close(); };
  }, [name]);

  // отрисовка волны и выделения
  const draw = (): void => {
    const c = canvas.current; if (!c || !buf) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(200, Math.floor(c.clientWidth * dpr)); const H = Math.floor(c.clientHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; peaks.current = null; }
    const g = c.getContext('2d'); if (!g) return;
    if (!peaks.current) {
      const p = new Float32Array(W); const step = buf.length / W;
      const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      for (let x = 0; x < W; x++) {
        let m = 0; const s0 = Math.floor(x * step); const s1 = Math.min(buf.length, Math.floor((x + 1) * step));
        const skip = Math.max(1, Math.floor((s1 - s0) / 64));
        for (let i = s0; i < s1; i += skip) for (const d of chans) { const v = Math.abs(d[i] ?? 0); if (v > m) m = v; }
        p[x] = m;
      }
      peaks.current = p;
    }
    const css = getComputedStyle(c);
    const accent = css.getPropertyValue('--accent').trim() || '#4c8dff'; const muted = css.getPropertyValue('--muted').trim() || '#888';
    g.clearRect(0, 0, W, H);
    const xa = (a / dur) * W; const xb = (b / dur) * W;
    g.fillStyle = accent; g.globalAlpha = 0.14; g.fillRect(xa, 0, xb - xa, H); g.globalAlpha = 1;
    const mid = H / 2;
    for (let x = 0; x < W; x++) {
      const h = Math.max(1, (peaks.current[x] ?? 0) * (H - 8) / 2);
      g.fillStyle = x >= xa && x <= xb ? accent : muted; g.globalAlpha = x >= xa && x <= xb ? 1 : 0.45;
      g.fillRect(x, mid - h, 1, h * 2);
    }
    g.globalAlpha = 1; g.fillStyle = accent;
    for (const x of [xa, xb]) { g.fillRect(x - 1.5 * dpr, 0, 3 * dpr, H); g.fillRect(x - 6 * dpr, H / 2 - 14 * dpr, 12 * dpr, 28 * dpr); }
    if (head !== null) { g.fillStyle = '#fff'; g.fillRect((head / dur) * W - dpr, 0, 2 * dpr, H); }
  };
  useEffect(draw, [buf, a, b, head]);
  useEffect(() => { const f = (): void => { peaks.current = null; draw(); }; window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); });

  const timeAt = (ev: PointerEvent): number => {
    const r = (ev.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return Math.max(0, Math.min(dur, ((ev.clientX - r.left) / r.width) * dur));
  };
  const onDown = (ev: PointerEvent): void => {
    if (!buf) return;
    const tt = timeAt(ev); const r = (ev.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const pxPerSec = r.width / dur;
    const da = Math.abs(tt - a) * pxPerSec; const db = Math.abs(tt - b) * pxPerSec;
    drag.current = da <= db ? 'a' : 'b';
    (ev.currentTarget as HTMLCanvasElement).setPointerCapture(ev.pointerId);
    onMove(ev);
  };
  const onMove = (ev: PointerEvent): void => {
    if (!drag.current) return;
    const tt = timeAt(ev); const min = 0.05;
    if (drag.current === 'a') setA(Math.min(tt, b - min)); else setB(Math.max(tt, a + min));
  };
  const setNum = (which: 'a' | 'b', v: number): void => {
    if (!Number.isFinite(v)) return;
    if (which === 'a') setA(Math.max(0, Math.min(v, b - 0.05))); else setB(Math.min(dur, Math.max(v, a + 0.05)));
  };

  const play = (): void => {
    if (!buf || !ctx.current) return;
    if (playing) { stop(); return; }
    const ac = ctx.current; void ac.resume();
    const s = ac.createBufferSource(); s.buffer = buf;
    const gain = ac.createGain(); s.connect(gain).connect(ac.destination);
    const len = b - a; const t0 = ac.currentTime;
    if (fade) { gain.gain.setValueAtTime(0, t0); gain.gain.linearRampToValueAtTime(1, t0 + Math.min(FADE, len / 2)); gain.gain.setValueAtTime(1, t0 + Math.max(0, len - FADE)); gain.gain.linearRampToValueAtTime(0, t0 + len); }
    s.start(0, a, len); src.current = s; setPlaying(true);
    s.onended = () => { if (src.current === s) stop(); };
    const tick = (): void => { setHead(a + (ac.currentTime - t0)); raf.current = requestAnimationFrame(tick); };
    tick();
  };

  const save = async (replace: boolean): Promise<void> => {
    if (!buf) return;
    setSaving(true);
    try {
      const wav = encodeWav(buf, a, b, fade, maxFile);
      const base = name.replace(/\.[^.]+$/, '');
      const file = new File([wav], replace ? name : `${base}-cut.wav`, { type: 'audio/wav' });
      await onSave(file, replace);
      onClose();
    } catch (e) { host().toast(e instanceof Error ? e.message : String(e), 'e'); } finally { setSaving(false); }
  };

  if (error) return <div class="snd-trim"><div class="banner">{error}</div><button class="btn" onClick={onClose}>{t('Закрыть')}</button></div>;
  if (!buf) return <div class="snd-trim muted">{t('Загрузка…')}</div>;

  return (
    <div class="snd-trim">
      <canvas ref={canvas} class="snd-wave" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
      <div class="snd-trim-row">
        <label>{t('Начало')} <input type="number" step="0.01" min="0" max={dur.toFixed(2)} value={a.toFixed(2)} onInput={(e) => setNum('a', parseFloat(e.currentTarget.value))} /></label>
        <label>{t('Конец')} <input type="number" step="0.01" min="0" max={dur.toFixed(2)} value={b.toFixed(2)} onInput={(e) => setNum('b', parseFloat(e.currentTarget.value))} /></label>
        <span class="muted small">{t('Длина')}: {fmt(b - a)} {t('из')} {fmt(dur)}</span>
      </div>
      <label class="snd-fade"><input type="checkbox" checked={fade} onChange={(e) => setFade(e.currentTarget.checked)} /> {t('Плавное начало и конец (без щелчков)')}</label>
      <div class="row">
        <button class="btn" onClick={play}>{playing ? `■ ${t('Стоп')}` : `▶ ${t('Прослушать выделенное')}`}</button>
        <button class="btn primary" disabled={saving} onClick={() => void save(false)}>{t('Сохранить как новый')}</button>
        {isWav ? <button class="btn" disabled={saving} onClick={() => void save(true)}>{t('Заменить исходный')}</button> : null}
        <button class="btn" onClick={onClose}>{t('Закрыть')}</button>
      </div>
      <div class="muted small">{t('Результат сохраняется как WAV. Тяните маркеры по волне или введите время.')}</div>
    </div>
  );
}
