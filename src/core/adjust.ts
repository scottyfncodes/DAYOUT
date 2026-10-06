import type { DayQuery, Tuning, TimeWindow, Interest, Constraints, PriceLevel } from './types';
import { wallClock, zonedEpoch, addDays, HOUR } from './time';

export type TuningKey = keyof Tuning;

export const ADJUSTMENTS: { key: TuningKey; label: string; value?: number }[] = [
  { key: 'cheaper', label: 'MAKE IT CHEAPER' },
  { key: 'moreActive', label: 'MAKE IT MORE ACTIVE' },
  { key: 'lessDriving', label: 'LESS DRIVING' },
  { key: 'moreLocal', label: 'MORE LOCAL' },
  { key: 'moreFood', label: 'MORE FOOD' },
  { key: 'moreOutdoors', label: 'MORE OUTDOORS' },
  { key: 'lessTouristy', label: 'LESS TOURISTY' },
  { key: 'addWeird', label: 'ADD SOMETHING WEIRD' },
  { key: 'noReservations', label: 'NO RESERVATIONS' },
  { key: 'maxMinutes', label: 'WE ONLY HAVE 2 HOURS', value: 120 },
];

export function toggleTuning(q: DayQuery, key: TuningKey, value?: number): DayQuery {
  const tuning = { ...q.tuning };
  if (key === 'maxMinutes') {
    tuning.maxMinutes = tuning.maxMinutes ? undefined : value ?? 120;
  } else {
    tuning[key] = !tuning[key];
  }
  const constraints = { ...q.constraints };
  if (key === 'lessDriving' && tuning.lessDriving) constraints.maxDistanceMiles = Math.min(constraints.maxDistanceMiles ?? 25, 8);
  if (key === 'lessDriving' && !tuning.lessDriving) delete constraints.maxDistanceMiles;
  return { ...q, tuning, constraints };
}

/* ------------------------------------------------------------------------- */
/* Time presets                                                               */
/* ------------------------------------------------------------------------- */

export type WhenPreset =
  | { kind: 'now' }
  | { kind: 'tonight' }
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'weekday'; weekday: number }
  | { kind: 'hours'; hours: number }
  | { kind: 'range'; date: string; startMin: number; endMin: number };

/** Resolve a preset into a concrete window relative to `now` in `tz`. */
export function resolveWindow(preset: WhenPreset, now: number, tz: string): TimeWindow {
  const w = wallClock(now, tz);
  const startOfToday = zonedEpoch(w.date, 0, tz);
  const roundUp15 = (t: number) => Math.ceil(t / (15 * 60000)) * 15 * 60000;
  switch (preset.kind) {
    case 'now':
      return { start: now, end: Math.min(zonedEpoch(w.date, 23 * 60, tz), now + 6 * HOUR) };
    case 'hours':
      return { start: now, end: now + preset.hours * HOUR };
    case 'tonight': {
      const start = Math.max(now, zonedEpoch(w.date, 17 * 60, tz));
      return { start: roundUp15(start), end: zonedEpoch(w.date, 23 * 60 + 30, tz) };
    }
    case 'today': {
      const start = Math.max(now, zonedEpoch(w.date, 9 * 60, tz));
      return { start: roundUp15(start), end: zonedEpoch(w.date, 22 * 60, tz) };
    }
    case 'tomorrow': {
      const d = addDays(w.date, 1);
      return { start: zonedEpoch(d, 10 * 60, tz), end: zonedEpoch(d, 21 * 60, tz) };
    }
    case 'weekday': {
      let delta = (preset.weekday - w.weekday + 7) % 7;
      if (delta === 0 && w.minutes > 18 * 60) delta = 7;
      const d = addDays(w.date, delta);
      const start = delta === 0 ? roundUp15(Math.max(now, zonedEpoch(d, 10 * 60, tz))) : zonedEpoch(d, 10 * 60, tz);
      return { start, end: zonedEpoch(d, 21 * 60, tz) };
    }
    case 'range': {
      void startOfToday;
      return { start: zonedEpoch(preset.date, preset.startMin, tz), end: zonedEpoch(preset.date, preset.endMin, tz) };
    }
  }
}

/* ------------------------------------------------------------------------- */
/* Quick modes                                                                */
/* ------------------------------------------------------------------------- */

export interface QuickMode {
  id: string;
  label: string;
  when?: WhenPreset;
  interests?: Interest[];
  constraints?: Constraints;
  tuning?: Tuning;
  maxPrice?: PriceLevel | null;
  party?: DayQuery['party'];
}

export const QUICK_MODES: QuickMode[] = [
  { id: 'tonight', label: 'TONIGHT', when: { kind: 'tonight' }, interests: ['food', 'nightlife', 'music'] },
  { id: 'weekend', label: 'THIS WEEKEND', when: { kind: 'weekday', weekday: 6 }, interests: ['outdoors', 'food', 'local'] },
  { id: 'three-hours', label: 'WE HAVE 3 HOURS', when: { kind: 'hours', hours: 3 } },
  { id: 'rainy', label: 'RAINY DAY', constraints: { setting: 'indoor' }, interests: ['arts', 'food', 'coffee', 'shopping'] },
  { id: 'cheap', label: 'CHEAP DAY', maxPrice: 1, tuning: { cheaper: true }, interests: ['outdoors', 'scenic', 'local'] },
  { id: 'date', label: 'DATE DAY', party: 'couple', interests: ['romantic', 'food', 'scenic', 'arts'] },
  { id: 'family', label: 'FAMILY DAY', party: 'family', interests: ['family', 'outdoors', 'active'], constraints: { kidFriendly: true } },
  { id: 'outdoor', label: 'OUTDOOR DAY', constraints: { setting: 'outdoor' }, interests: ['outdoors', 'scenic', 'active'] },
  { id: 'weird', label: 'WEIRD DAY', interests: ['weird', 'local', 'arts'], tuning: { addWeird: true } },
  { id: 'tourist', label: 'TOURIST DAY', interests: ['tourist', 'history', 'scenic', 'food'] },
];

export function applyQuickMode(q: DayQuery, mode: QuickMode, now: number): DayQuery {
  return {
    ...q,
    window: mode.when ? resolveWindow(mode.when, now, q.origin.timezone) : q.window,
    interests: mode.interests ?? q.interests,
    constraints: { ...q.constraints, ...(mode.constraints ?? {}) },
    tuning: { ...q.tuning, ...(mode.tuning ?? {}) },
    maxPrice: mode.maxPrice === undefined ? q.maxPrice : mode.maxPrice,
    party: mode.party ?? q.party,
  };
}
