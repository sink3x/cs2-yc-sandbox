// Мост к старому интерфейсу: всё, что острову нужно от страницы, передаётся явно (без обращения к глобалам).
export interface Host {
  /** Перевод текста интерфейса (словарь ru/en/de/fr старой части). */
  tr(text: string): string;
  /** JSON-запрос к API панели: путь без префикса /api. Ошибка уже переведена. */
  api<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  /** Перевод серверной ошибки на русский (как делает api()). */
  ruErr(text: string): string;
  toast(message: string, kind?: 's' | 'e'): void;
  /** Язык интерфейса для дат. */
  locale: string;
}

let current: Host | null = null;
export const setHost = (h: Host): void => { current = h; };
export const host = (): Host => {
  if (!current) throw new Error('UI host is not set');
  return current;
};
/** Короткий перевод для разметки. */
export const t = (text: string): string => host().tr(text);
