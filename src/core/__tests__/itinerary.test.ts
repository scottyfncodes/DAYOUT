import { describe, it, expect } from 'vitest';
import { buildItinerary, reworkSuggestions } from '../itinerary';
import { H } from '../hours';
import { place, query, at, FixedRouting, forecast } from '@/test/fixtures';
import type { Recommendation } from '../types';

const routing = new FixedRouting(15);

describe('buildItinerary', () => {
  it('sequences stops with travel time and buffers', async () => {
    const a = place({ id: 'a', duration: { min: 45, typical: 60 } });
    const b = place({ id: 'b', duration: { min: 45, typical: 60 }, location: { lat: 39.76, lng: -104.98 } });
    const it = await buildItinerary([a, b], query(), routing, null, { keepOrder: true });
    expect(it.valid).toBe(true);
    expect(it.stops[0]!.start).toBe(at(10, 15));
    expect(it.stops[0]!.end).toBe(at(11, 15));
    // 10-minute buffer + 15 min travel
    expect(it.stops[1]!.arrive).toBe(at(11, 40));
    expect(it.totalTravelMin).toBe(30);
  });

  it('respects opening hours by waiting for the door to open', async () => {
    const lunch = place({ id: 'lunch', hours: { confidence: 'verified', verifiedThrough: '2030-01-01', weekly: H.daily(H.t(11, 30), H.t(21)) } });
    const it = await buildItinerary([lunch], query(), routing, null);
    expect(it.stops[0]!.arrive).toBe(at(10, 15));
    expect(it.stops[0]!.start).toBe(at(11, 30));
    expect(it.stops[0]!.warnings[0]).toMatch(/Opens at 11:30 AM/);
  });

  it('reorders stops so a dinner-only place lands at dinner and an early-closing museum goes first', async () => {
    const museum = place({ id: 'museum', hours: { confidence: 'verified', verifiedThrough: '2030-01-01', weekly: H.daily(H.t(10), H.t(14)) }, duration: { min: 60, typical: 90 } });
    const dinner = place({ id: 'dinner', hours: { confidence: 'verified', verifiedThrough: '2030-01-01', weekly: H.daily(H.t(17), H.t(22)) }, duration: { min: 60, typical: 90 } });
    const q = query({ window: { start: at(10), end: at(21) } });
    const it = await buildItinerary([dinner, museum], q, routing, null);
    expect(it.valid).toBe(true);
    expect(it.stops.map((s) => s.place.id)).toEqual(['museum', 'dinner']);
  });

  it('rejects a multi-stop plan that cannot fit the window', async () => {
    const a = place({ id: 'a', duration: { min: 120, typical: 150 } });
    const b = place({ id: 'b', duration: { min: 120, typical: 150 } });
    const q = query({ window: { start: at(10), end: at(13) } });
    const it = await buildItinerary([a, b], q, routing, null);
    expect(it.valid).toBe(false);
    expect(it.stops.some((s) => s.problems.length > 0)).toBe(true);
  });

  it('flags a stop that is closed and reworks it with a same-category open option', async () => {
    const closed = place({ id: 'closed', categories: ['food'], hours: { confidence: 'verified', weekly: H.days({}) } });
    const q = query();
    const it = await buildItinerary([closed], q, routing, null);
    expect(it.valid).toBe(false);
    expect(it.stops[0]!.problems[0]).toMatch(/closed/i);

    const alt = place({ id: 'alt', categories: ['food'] });
    const other = place({ id: 'other', categories: ['arts'] });
    const pool: Recommendation[] = [alt, other].map((p) => ({
      place: p, availability: { state: 'OPEN_CONFIRMED', reason: '' }, travel: null, arrive: at(10), leave: at(11),
      weather: null, score: 70, fit: 'Good fit', reasons: [], cautions: [],
    }));
    const s = reworkSuggestions(it, pool, q);
    expect(s).toHaveLength(1);
    expect(s[0]!.options.map((o) => o.place.id)).toEqual(['alt']);
  });

  it('suggests indoor swaps when rain hits an outdoor stop', async () => {
    const park = place({ id: 'park', setting: 'outdoor', categories: ['outdoors'], attributes: { exposure: 'full' } });
    const rainAt2 = forecast((h) => (h >= 14 ? { condition: 'rain', precipProb: 85 } : {}));
    const q = query({ window: { start: at(14), end: at(18) } });
    const it = await buildItinerary([park], q, routing, rainAt2);
    const indoor = place({ id: 'museum', setting: 'indoor', categories: ['outdoors', 'arts'] });
    const outdoor2 = place({ id: 'park2', setting: 'outdoor', categories: ['outdoors'], attributes: { exposure: 'full' } });
    const pool: Recommendation[] = [indoor, outdoor2].map((p) => ({
      place: p, availability: { state: 'OPEN_CONFIRMED', reason: '' }, travel: null, arrive: at(14), leave: at(15),
      weather: null, score: 70, fit: 'Good fit', reasons: [], cautions: [],
    }));
    const s = reworkSuggestions(it, pool, q);
    expect(s).toHaveLength(1);
    expect(s[0]!.why).toMatch(/isn't looking great/);
    expect(s[0]!.options.map((o) => o.place.id)).toEqual(['museum']);
  });

  it('notes when outdoor stops are scheduled ahead of rain', async () => {
    const park = place({ id: 'park', setting: 'outdoor', categories: ['outdoors'], attributes: { exposure: 'full' } });
    const rainAt2 = forecast((h) => (h >= 14 ? { condition: 'rain', precipProb: 85 } : {}));
    const it = await buildItinerary([park], query(), routing, rainAt2);
    expect(it.notes.join(' ')).toMatch(/Rain moves in around 2 PM/);
  });
});
