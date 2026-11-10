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
  /** Код языка интерфейса: ru | en | de | fr. */
  lang: string;
  /** Роль текущего пользователя: admin | player. */
  role: string;
  /** Параметр маршрута (например, карта на странице callouts). */
  slug: string;
  /** Переход на страницу старого интерфейса. */
  go(page: string, slug?: string): void;
  /** Последний обзор панели (раз в 4 с обновляется старым интерфейсом) или null. */
  overview(): Overview | null;
  /** Вызвать cb при каждом новом обзоре (один подписчик на страницу). */
  onOverview(cb: () => void): void;
  /** Запросить обзор прямо сейчас. */
  refreshOverview(): void;
}

export interface LivePlayer { id: number | string; name: string | null; bot: boolean; ping?: number | string; time?: string }
export interface Overview {
  vm?: { status?: string };
  server?: { live?: { map?: string; maxPlayers?: number; players?: LivePlayer[] } | null } | null;
}

let current: Host | null = null;
export const setHost = (h: Host): void => { current = h; };
export const host = (): Host => {
  if (!current) throw new Error('UI host is not set');
  return current;
};
/** Короткий перевод для разметки. */
export const t = (text: string): string => host().tr(text);
