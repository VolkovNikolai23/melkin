/** Начало «учебного дня»: сутки сменяются в 4:00, чтобы ночные занятия считались вчерашними. */
export const DAY_START_HOUR = 4;

export function dayStart(now: number, hour = DAY_START_HOUR): number {
  const d = new Date(now);
  if (d.getHours() < hour) d.setDate(d.getDate() - 1);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
