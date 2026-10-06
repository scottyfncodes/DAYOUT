import type { ActivityWindow, Availability, HoursData, HoursInterval, Place, WeeklyHours } from './types';
import { addDays, formatMinutes, formatTime, wallClock, weekdayOf, zonedEpoch } from './time';

export interface EpochInterval {
  start: number;
  end: number;
}

/**
 * Resolve the open intervals (as instants) that could cover a visit on `date`
 * in the place's timezone. Includes the previous day's intervals that run past
 * midnight, so a 10 PM–2 AM bar is open at 1 AM.
 */
export function intervalsAround(
  weekly: WeeklyHours,
  overrides: Record<string, HoursInterval[] | 'closed'> | undefined,
  date: string,
  tz: string,
): EpochInterval[] {
  const out: EpochInterval[] = [];
  for (const d of [addDays(date, -1), date, addDays(date, 1)]) {
    const override = overrides?.[d];
    let intervals: HoursInterval[];
    if (override === 'closed') intervals = [];
    else if (override) intervals = override;
    else intervals = weekly[weekdayOf(d)] ?? [];
    for (const iv of intervals) {
      if (iv.close <= iv.open) continue;
      out.push({ start: zonedEpoch(d, iv.open, tz), end: zonedEpoch(d, iv.close, tz) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function inSeason(date: string, season: HoursData['season']): boolean {
  if (!season) return true;
  const md = date.slice(5);
  if (season.from <= season.to) return md >= season.from && md <= season.to;
  // wraps the new year, e.g. Nov 15 – Mar 31
  return md >= season.from || md <= season.to;
}

/**
 * Find the covering interval for [arrive, leave], or the next interval that
 * starts at/after `arrive`.
 */
export function findCoverage(
  intervals: EpochInterval[],
  arrive: number,
  leave: number,
): { covering?: EpochInterval; next?: EpochInterval; current?: EpochInterval } {
  let next: EpochInterval | undefined;
  let current: EpochInterval | undefined;
  for (const iv of intervals) {
    if (iv.start <= arrive && iv.end >= leave) return { covering: iv };
    if (iv.start <= arrive && iv.end > arrive) current = iv;
    if (iv.start > arrive && (!next || iv.start < next.start)) next = iv;
  }
  return { next, current };
}

/**
 * Determine whether a place is open for a visit from `arrive` to `leave`.
 *
 * This is the product's hard gate. Only OPEN_CONFIRMED may be recommended.
 */
export function assessAvailability(place: Place, arrive: number, leave: number): Availability {
  const h = place.hours;
  const tz = place.timezone;
  if (h.permanentlyClosed) return { state: 'CLOSED', reason: 'Permanently closed' };
  if (h.temporarilyClosed) return { state: 'CLOSED', reason: 'Temporarily closed' };
  if (h.confidence === 'unknown') return { state: 'UNKNOWN', reason: "Hours couldn't be verified" };

  const local = wallClock(arrive, tz);
  if (!inSeason(local.date, h.season)) return { state: 'CLOSED', reason: 'Closed for the season' };

  const intervals = intervalsAround(h.weekly, h.overrides, local.date, tz);
  const { covering, next, current } = findCoverage(intervals, arrive, leave);

  if (!covering) {
    if (current) {
      return {
        state: 'CLOSED',
        reason: `Closes at ${formatTime(current.end, tz)} — not enough time`,
        openUntil: current.end,
        opensAt: next?.start,
      };
    }
    if (next && wallClock(next.start, tz).date === local.date) {
      return { state: 'CLOSED', reason: `Opens at ${formatTime(next.start, tz)}`, opensAt: next.start };
    }
    const override = h.overrides?.[local.date];
    if (override === 'closed') return { state: 'CLOSED', reason: 'Closed today (special hours)' };
    const weekly = h.weekly[local.weekday] ?? [];
    if (weekly.length === 0) return { state: 'CLOSED', reason: `Closed ${dayName(local.weekday)}s` };
    return { state: 'CLOSED', reason: 'Closed at that time' };
  }

  // Door is open. Now check activity-level availability (kitchen, last entry, event).
  for (const act of place.activities ?? []) {
    const problem = checkActivity(act, arrive, leave, local.date, tz);
    if (problem) return { state: 'CLOSED', reason: problem, openUntil: covering.end };
  }

  const confirmed = h.confidence === 'verified' && (!h.verifiedThrough || local.date <= h.verifiedThrough);
  return {
    state: confirmed ? 'OPEN_CONFIRMED' : 'OPEN_LIKELY',
    reason: confirmed ? `Open until ${formatTime(covering.end, tz)}` : 'Hours not verified for this date',
    openUntil: covering.end,
  };
}

function checkActivity(act: ActivityWindow, arrive: number, leave: number, date: string, tz: string): string | null {
  const intervals = intervalsAround(act.weekly, act.overrides, date, tz);
  const need = act.mustCover === 'arrival' ? arrive : leave;
  const { covering, current, next } = findCoverage(intervals, arrive, need);
  if (covering) return null;
  if (current) {
    const label = act.kind === 'kitchen' ? 'Kitchen closes' : act.kind === 'lastEntry' ? 'Last entry' : `${act.label} ends`;
    return `${label} at ${formatTime(current.end, tz)}`;
  }
  if (next) {
    const label = act.kind === 'event' ? `${act.label} starts` : `${act.label} available from`;
    return `${label} ${formatTime(next.start, tz)}`;
  }
  return `${act.label} not available`;
}

/**
 * Earliest instant ≥ `earliest` at which a visit of `durationMin` minutes can
 * start fully inside an open interval and finish by `latest`. Returns null if
 * none exists. Does not consider activity windows beyond the door being open —
 * callers re-run assessAvailability on the chosen slot.
 */
export function earliestVisitStart(
  place: Place,
  earliest: number,
  latest: number,
  durationMin: number,
): number | null {
  const h = place.hours;
  if (h.confidence === 'unknown' || h.permanentlyClosed || h.temporarilyClosed) return null;
  const tz = place.timezone;
  const date = wallClock(earliest, tz).date;
  if (!inSeason(date, h.season)) return null;
  const dur = durationMin * 60000;
  const intervals = intervalsAround(h.weekly, h.overrides, date, tz);
  for (const iv of intervals) {
    const start = Math.max(iv.start, earliest);
    if (start + dur <= iv.end && start + dur <= latest) {
      // Activity windows (e.g. a kitchen) may need a later start than the door; probe forward in 15-min steps.
      let t = start;
      while (t + dur <= Math.min(iv.end, latest)) {
        if (assessAvailability(place, t, t + dur).state !== 'CLOSED') return t;
        t += 15 * 60000;
      }
    }
  }
  return null;
}

export function dayName(weekday: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday] ?? '';
}

/** Short human line for a day's hours, e.g. "10 AM–5 PM" or "Closed". */
export function describeHours(place: Place, date: string): string {
  const override = place.hours.overrides?.[date];
  const intervals = override === 'closed' ? [] : override ?? place.hours.weekly[weekdayOf(date)] ?? [];
  if (place.hours.temporarilyClosed) return 'Temporarily closed';
  if (place.hours.confidence === 'unknown') return 'Hours unknown';
  if (intervals.length === 0) return 'Closed';
  return intervals.map((iv) => `${formatMinutes(iv.open)}–${formatMinutes(iv.close)}`).join(', ');
}

/** Status line relative to `now`: OPEN NOW · until 8 PM, OPENS AT 4 PM, CLOSED. */
export function statusLine(place: Place, now: number): { label: string; detail?: string; open: boolean } {
  const a = assessAvailability(place, now, now + 60000);
  const tz = place.timezone;
  if (a.state === 'OPEN_CONFIRMED' || a.state === 'OPEN_LIKELY') {
    return { label: 'OPEN NOW', detail: a.openUntil ? `until ${formatTime(a.openUntil, tz)}` : undefined, open: true };
  }
  if (a.opensAt) return { label: `OPENS AT ${formatTime(a.opensAt, tz)}`, open: false };
  if (a.state === 'UNKNOWN') return { label: 'HOURS UNKNOWN', open: false };
  return { label: 'CLOSED', detail: a.reason, open: false };
}

/** Convenience builders for datasets and tests. */
export const H = {
  /** same hours every day */
  daily(open: number, close: number): WeeklyHours {
    return Array.from({ length: 7 }, () => [{ open, close }]);
  },
  /** map weekday index → intervals; missing days are closed */
  days(map: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, HoursInterval[]>>): WeeklyHours {
    return Array.from({ length: 7 }, (_, i) => map[i as 0] ?? []);
  },
  t(h: number, m = 0): number {
    return h * 60 + m;
  },
};
