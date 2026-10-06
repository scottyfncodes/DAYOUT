/**
 * Timezone-aware wall-clock helpers built on Intl so the engine can reason
 * about "10:30 AM in Denver" without a date library.
 */

export interface WallClock {
  /** ISO date in the zone, YYYY-MM-DD */
  date: string;
  year: number;
  month: number; // 1-12
  day: number;
  /** 0 = Sunday */
  weekday: number;
  /** minutes since local midnight */
  minutes: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function wallClock(epochMs: number, tz: string): WallClock {
  const parts = formatter(tz).formatToParts(new Date(epochMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return {
    date: `${year}-${pad(month)}-${pad(day)}`,
    year,
    month,
    day,
    weekday: WEEKDAYS[get('weekday')] ?? 0,
    minutes: hour * 60 + minute,
  };
}

/** Offset of `tz` from UTC at the given instant, in minutes. */
export function tzOffsetMinutes(epochMs: number, tz: string): number {
  const w = wallClock(epochMs, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, Math.floor(w.minutes / 60), w.minutes % 60);
  // epochMs is rounded to the minute so the comparison is exact.
  return Math.round((asUtc - Math.floor(epochMs / 60000) * 60000) / 60000);
}

/**
 * Convert a zone-local wall clock (date + minutes since midnight) to an instant.
 * Minutes may exceed 1440 (next day) or be negative.
 */
export function zonedEpoch(date: string, minutes: number, tz: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d) + minutes * 60000;
  // First guess using the offset at the naive instant, then correct once for DST edges.
  let guess = naive - tzOffsetMinutes(naive, tz) * 60000;
  const off2 = tzOffsetMinutes(guess, tz);
  guess = naive - off2 * 60000;
  return guess;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "10:30 AM" style for a given instant in a zone. */
export function formatTime(epochMs: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
    .format(new Date(epochMs))
    .replace(':00', '')
    .toUpperCase()
    .replace(/\s/g, ' ');
}

export function formatDay(epochMs: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(epochMs));
}

export function formatDate(epochMs: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(epochMs),
  );
}

/** Minutes-of-day → "4 PM" / "4:30 PM". Handles values ≥ 1440 by wrapping. */
export function formatMinutes(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  return mm === 0 ? `${h12} ${suffix}` : `${h12}:${pad(mm)} ${suffix}`;
}

export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (r === 0) return `${h} hr`;
  return `${h} hr ${r} min`;
}

/** Human duration range: "1–2 hours" */
export function formatDurationRange(min: number, typical: number): string {
  if (typical < 60) return `${min}–${typical} min`;
  const lo = Math.round((min / 60) * 2) / 2;
  const hi = Math.round((typical / 60) * 2) / 2;
  if (lo === hi) return `~${trim(hi)} hr`;
  return `${trim(lo)}–${trim(hi)} hr`;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export const MINUTE = 60000;
export const HOUR = 3600000;
