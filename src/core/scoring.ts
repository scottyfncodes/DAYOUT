import type { DayQuery, Place, TravelEstimate, WeatherSnapshot } from './types';
import { judgeWeather } from './weather';
import { formatDuration } from './time';

export interface ScoreBreakdown {
  score: number;
  reasons: string[];
  cautions: string[];
}

const BUDGET_LABEL = ['Free', '$', '$$', '$$$', '$$$$'];

/**
 * Score a candidate that has already passed every eligibility gate.
 * Numbers stay internal; only the sentences reach the user.
 */
export function scoreCandidate(
  place: Place,
  q: DayQuery,
  travel: TravelEstimate | null,
  weather: WeatherSnapshot | null,
  openUntil: number | undefined,
  leave: number,
): ScoreBreakdown {
  const reasons: string[] = [];
  const cautions: string[] = [];
  const t = q.tuning;
  let s = 50;

  // --- Preference fit -------------------------------------------------------
  const interests = effectiveInterests(q);
  const matches = place.categories.filter((c) => interests.includes(c));
  if (interests.length > 0) {
    s += Math.min(30, matches.length * 12);
    if (matches.length >= 2) reasons.push(`Hits ${matches.slice(0, 2).join(' and ')} — right in your lane.`);
    else if (matches.length === 1) reasons.push(`Great match for your ${matches[0]} preference.`);
    else s -= 8;
  }
  if (t.moreLocal && place.categories.includes('local')) s += 8;
  if (t.lessTouristy && place.categories.includes('tourist')) s -= 15;
  if (t.addWeird && place.categories.includes('weird')) s += 12;
  if (t.moreActive && place.categories.includes('active')) s += 10;
  if (t.moreActive && place.categories.includes('relaxed')) s -= 6;
  if (t.moreFood && place.categories.includes('food')) s += 12;
  if (t.moreOutdoors && place.setting === 'outdoor') s += 12;
  if (q.party === 'couple' && place.categories.includes('romantic')) s += 6;
  if ((q.party === 'family' || q.withKids) && place.categories.includes('family')) s += 8;

  // --- Weather --------------------------------------------------------------
  const wv = judgeWeather(place, weather);
  s += wv.score * 20;
  if (wv.note) {
    if (wv.score > 0.3) reasons.push(place.setting === 'indoor' ? wv.note + '.' : `${wv.note} — good conditions for this.`);
    else if (wv.score < -0.2) cautions.push(wv.note + '.');
  }

  // --- Travel ---------------------------------------------------------------
  if (travel) {
    const minutes = travel.durationMin + (travel.trafficDelayMin ?? 0);
    const tolerance = travelTolerance(q.transport);
    const over = Math.max(0, minutes - tolerance);
    s -= Math.min(25, over * 0.8);
    if (t.lessDriving && travel.mode === 'drive') s -= Math.min(20, minutes * 0.5);
    if (minutes <= 15) reasons.push(`Only ${formatDuration(minutes)} away${openUntil ? ` and open until ${fmtUntil(openUntil, place.timezone)}` : ''}.`);
    if (travel.trafficDelayMin !== null && travel.trafficDelayMin >= 10) {
      s -= 6;
      cautions.push(`Traffic adds about ${travel.trafficDelayMin} minutes right now.`);
    } else if (travel.trafficDelayMin !== null && travel.trafficDelayMin <= 3 && travel.mode === 'drive' && minutes > 15) {
      reasons.push('Traffic is currently light.');
    }
    if (q.constraints.avoidTraffic && (travel.trafficDelayMin ?? 0) >= 8) s -= 10;
    if (q.transport === 'transit') {
      if (place.attributes.transitFriendly) {
        s += 10;
        reasons.push('Easy to reach on transit.');
      } else s -= 12;
    }
    if (q.transport === 'walk' || q.transport === 'bike') {
      if (place.attributes.walkable) s += 6;
    }
  }

  // --- Parking (driving only; unknown is neutral, never invented) -----------
  if (travel?.mode === 'drive' || (!travel && q.transport === 'drive')) {
    const p = place.parking;
    if (p) {
      if (p.difficulty === 'easy') {
        s += 5;
        reasons.push('Parking is easier here than the alternatives.');
      } else if (p.difficulty === 'hard') {
        s -= 10;
        cautions.push(`Parking is tough${p.cost ? ` (${p.cost})` : ''}.`);
      }
      s -= Math.min(5, p.walkMin * 0.5);
    }
  }

  // --- Cost -----------------------------------------------------------------
  if (q.maxPrice !== null) {
    const headroom = q.maxPrice - place.priceLevel;
    s += Math.min(6, headroom * 3);
  }
  if (t.cheaper) {
    s -= place.priceLevel * 8;
    if (place.priceLevel === 0) reasons.push("It's free.");
  }

  // --- Time fit -------------------------------------------------------------
  if (openUntil) {
    const marginMin = (openUntil - leave) / 60000;
    if (marginMin < 30) {
      s -= 8;
      cautions.push(`Closes ${formatDuration(marginMin)} after your planned visit — tight.`);
    } else if (marginMin > 120) s += 3;
  }
  const windowMin = (q.window.end - q.window.start) / 60000;
  if (windowMin <= 180 && place.duration.typical <= windowMin * 0.6) s += 4;
  if (t.noReservations && (place.attributes.reservationRequired || place.attributes.reservationRecommended)) s -= 12;

  return { score: Math.round(Math.max(0, Math.min(100, s))), reasons: dedupe(reasons).slice(0, 3), cautions: dedupe(cautions).slice(0, 2) };
}

export function effectiveInterests(q: DayQuery) {
  const set = new Set(q.interests);
  if (q.tuning.moreFood) set.add('food');
  if (q.tuning.moreOutdoors) set.add('outdoors');
  if (q.tuning.moreLocal) set.add('local');
  if (q.tuning.addWeird) set.add('weird');
  if (q.tuning.moreActive) set.add('active');
  return [...set];
}

function travelTolerance(mode: DayQuery['transport']): number {
  switch (mode) {
    case 'walk':
      return 15;
    case 'bike':
      return 20;
    case 'transit':
      return 30;
    default:
      return 20;
  }
}

function fmtUntil(epoch: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
    .format(new Date(epoch))
    .replace(':00', '');
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

export function fitLabel(score: number): 'Great fit' | 'Good fit' | 'Worth it' {
  if (score >= 72) return 'Great fit';
  if (score >= 58) return 'Good fit';
  return 'Worth it';
}

export function priceLabel(level: number): string {
  return BUDGET_LABEL[level] ?? '$';
}
