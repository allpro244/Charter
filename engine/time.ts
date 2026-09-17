// The calendar. Day 0 is 2024-01-01 (a Monday). Pure arithmetic on UTC.

export const EPOCH_UTC = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;

export interface CalendarDate {
  y: number;
  m: number; // 1 to 12
  d: number; // 1 to 31
  dow: number; // 0 = Sunday
}

export function dateOf(day: number): CalendarDate {
  const t = new Date(EPOCH_UTC + day * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() };
}

export function dayOf(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isMonthEnd(day: number): boolean {
  const { y, m, d } = dateOf(day);
  return d === daysInMonth(y, m);
}

export function isQuarterEnd(day: number): boolean {
  const { m } = dateOf(day);
  return isMonthEnd(day) && m % 3 === 0;
}

export function isYearEnd(day: number): boolean {
  const { m, d } = dateOf(day);
  return m === 12 && d === 31;
}

// Months since 2024-01.
export function monthIndex(day: number): number {
  const { y, m } = dateOf(day);
  return (y - 2024) * 12 + (m - 1);
}

export function quarterOf(day: number): { y: number; q: number } {
  const { y, m } = dateOf(day);
  return { y, q: Math.floor((m - 1) / 3) + 1 };
}

export function formatDate(day: number): string {
  const { y, m, d } = dateOf(day);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isWeekend(day: number): boolean {
  const dow = dateOf(day).dow;
  return dow === 0 || dow === 6;
}
