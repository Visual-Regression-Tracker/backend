export function nonNegativeNumber(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function booleanFlag(raw: string | undefined, fallback: boolean): boolean {
  const value = raw?.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value ?? '')) return true;
  if (['false', '0', 'no', 'off'].includes(value ?? '')) return false;
  return fallback;
}
