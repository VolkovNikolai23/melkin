export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Порядок между двумя соседями (дробные индексы). */
export function orderBetween(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return (b as number) - 1;
  if (b === undefined) return a + 1;
  return (a + b) / 2;
}
