import { describe, it, expect } from 'vitest';
import { findMyDay } from '../pipeline';
import { H } from '../hours';
import { place, query, at, bundle, FixedRouting, forecast, STATUS } from '@/test/fixtures';

const open = place({ id: 'open', categories: ['arts'] });

describe('findMyDay gates', () => {
  it('recommends only OPEN_CONFIRMED places', async () => {
    const list = [
      open,
      place({ id: 'closed', hours: { confidence: 'verified', weekly: H.days({}) } }),
      place({ id: 'unknown', hours: { confidence: 'unknown', weekly: H.daily(540, 1020) } }),
      place({ id: 'likely', hours: { confidence: 'scheduled', weekly: H.daily(540, 1020) } }),
      place({ id: 'temp', hours: { confidence: 'verified', weekly: H.daily(540, 1020), temporarilyClosed: true } }),
    ];
    const r = await findMyDay(query(), bundle(list), STATUS);
    expect(r.recommendations.map((x) => x.place.id)).toEqual(['open']);
    expect(r.excluded).toMatchObject({ closed: 2, unknown_hours: 1, unverified_hours: 1 });
  });

  it('excludes a place when travel time pushes arrival past closing', async () => {
    const closesAt5 = place({ id: 'c5' });
    const q = query({ window: { start: at(16, 30), end: at(20) } });
    const r = await findMyDay(q, bundle([closesAt5], new FixedRouting(35)), STATUS);
    expect(r.recommendations).toHaveLength(0);
    expect(r.recommendations.find((x) => x.place.id === 'c5')).toBeUndefined();
  });

  it('includes the same place when there is time to arrive and finish', async () => {
    const q = query({ window: { start: at(15), end: at(20) } });
    const r = await findMyDay(q, bundle([open], new FixedRouting(35)), STATUS);
    expect(r.recommendations).toHaveLength(1);
    expect(r.recommendations[0]!.arrive).toBe(at(15, 35));
  });

  it('traffic delay affects arrival feasibility', async () => {
    // 20 min base → arrive 3:50 PM, done by 4:35. Add 30 min of traffic → arrive 4:20, can't finish by 5 PM.
    const q = query({ window: { start: at(15, 30), end: at(20) } });
    const slow = await findMyDay(q, bundle([open], new FixedRouting(20, 30)), STATUS);
    expect(slow.recommendations).toHaveLength(0);
    const fast = await findMyDay(q, bundle([open], new FixedRouting(20, 0)), STATUS);
    expect(fast.recommendations).toHaveLength(1);
  });

  it('excludes an activity whose minimum duration exceeds the window', async () => {
    const long = place({ id: 'long', duration: { min: 240, typical: 300 } });
    const q = query({ window: { start: at(10), end: at(13) } });
    const r = await findMyDay(q, bundle([long]), STATUS);
    expect(r.recommendations).toHaveLength(0);
    expect(r.excluded.does_not_fit_window).toBe(1);
  });

  it('schedules the visit at opening time when the user is free earlier', async () => {
    const opensAtNoon = place({ id: 'noon', hours: { confidence: 'verified', verifiedThrough: '2030-01-01', weekly: H.daily(H.t(12), H.t(20)) } });
    const r = await findMyDay(query(), bundle([opensAtNoon], new FixedRouting(10)), STATUS);
    expect(r.recommendations[0]!.arrive).toBe(at(12));
  });

  it('applies budget as a hard gate', async () => {
    const pricey = place({ id: 'pricey', priceLevel: 4 });
    const r = await findMyDay(query({ maxPrice: 2 }), bundle([pricey, open]), STATUS);
    expect(r.recommendations.map((x) => x.place.id)).toEqual(['open']);
    expect(r.excluded.budget).toBe(1);
  });

  it('applies dog and indoor/outdoor constraints as hard gates', async () => {
    const dogOk = place({ id: 'dog', setting: 'outdoor', attributes: { exposure: 'full', dogFriendly: true } });
    const noDog = place({ id: 'nodog', setting: 'outdoor', attributes: { exposure: 'full', dogFriendly: false } });
    const r = await findMyDay(query({ withDog: true, constraints: { setting: 'outdoor' } }), bundle([dogOk, noDog, open]), STATUS);
    expect(r.recommendations.map((x) => x.place.id)).toEqual(['dog']);
  });

  it('excludes fully exposed outdoor activities during severe weather', async () => {
    const hike = place({ id: 'hike', setting: 'outdoor', attributes: { exposure: 'full' } });
    const storm = forecast(() => ({ condition: 'storm', severe: true, precipProb: 90 }));
    const r = await findMyDay(query(), bundle([hike, open], new FixedRouting(10), storm), STATUS);
    expect(r.recommendations.map((x) => x.place.id)).toEqual(['open']);
    expect(r.excluded.severe_weather).toBe(1);
  });

  it('loosens distance once and says so, but never loosens the open gate', async () => {
    const far = place({ id: 'far', location: { lat: 39.95, lng: -104.99 } }); // ~14.5 mi north
    const closedFar = place({ id: 'closedfar', location: { lat: 39.95, lng: -104.99 }, hours: { confidence: 'verified', weekly: H.days({}) } });
    const q = query({ constraints: { maxDistanceMiles: 10 } });
    const r = await findMyDay(q, bundle([far, closedFar]), STATUS);
    expect(r.recommendations.map((x) => x.place.id)).toEqual(['far']);
    expect(r.relaxed).toMatch(/loosened your distance preference by 5 miles/);
  });

  it('keeps going when the weather provider fails', async () => {
    const b = bundle([open]);
    b.weather = { id: 'demo', forecast: async () => { throw new Error('down'); } };
    const r = await findMyDay(query(), b, STATUS);
    expect(r.recommendations).toHaveLength(1);
    expect(r.status.weather).toBe('unavailable');
    expect(r.weather).toBeNull();
  });

  it('returns an honest empty result when the places provider fails', async () => {
    const b = bundle([open]);
    b.places = { id: 'demo', search: async () => { throw new Error('down'); } };
    const r = await findMyDay(query(), b, STATUS);
    expect(r.recommendations).toHaveLength(0);
    expect(r.considered).toBe(0);
  });

  it('excludes places with no route instead of guessing', async () => {
    const r = await findMyDay(query({ transport: 'walk' }), bundle([open], new FixedRouting(() => null)), STATUS);
    expect(r.recommendations).toHaveLength(0);
    expect(r.excluded.no_route).toBe(1);
  });

  it('"we only have 2 hours" tuning shrinks the window', async () => {
    const long = place({ id: 'long', duration: { min: 150, typical: 180 } });
    const r = await findMyDay(query({ tuning: { maxMinutes: 120 } }), bundle([long, open]), STATUS);
    expect(r.recommendations.map((x) => x.place.id)).toEqual(['open']);
  });
});
