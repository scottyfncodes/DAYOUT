import { describe, it, expect } from 'vitest';
import { scoreCandidate } from '../scoring';
import { judgeWeather } from '../weather';
import { place, query, at } from '@/test/fixtures';
import type { WeatherSnapshot, TravelEstimate } from '../types';

const wx = (over: Partial<WeatherSnapshot>): WeatherSnapshot => ({ time: at(12), tempF: 68, condition: 'clear', precipProb: 0, windMph: 5, severe: false, ...over });
const drive = (min: number, delay: number | null = 0): TravelEstimate => ({ mode: 'drive', durationMin: min, distanceMiles: 5, trafficDelayMin: delay, source: 'demo' });

describe('weather scoring', () => {
  const park = place({ id: 'park', setting: 'outdoor', attributes: { exposure: 'full' } });
  const museum = place({ id: 'museum', setting: 'indoor', attributes: { exposure: 'none' } });

  it('downgrades outdoor activities in rain and lifts indoor ones', () => {
    const rain = wx({ condition: 'rain', precipProb: 80 });
    expect(judgeWeather(park, rain).score).toBeLessThan(0);
    expect(judgeWeather(museum, rain).score).toBeGreaterThan(0);
    const q = query();
    const a = scoreCandidate(park, q, drive(10), rain, at(17), at(13)).score;
    const b = scoreCandidate(park, q, drive(10), wx({}), at(17), at(13)).score;
    expect(a).toBeLessThan(b);
  });

  it('boosts outdoor options in excellent weather', () => {
    const v = judgeWeather(park, wx({ tempF: 70, condition: 'clear' }));
    expect(v.score).toBeGreaterThan(0.5);
    expect(v.note).toMatch(/70°F/);
  });

  it('marks exposed activities unsafe in storms', () => {
    expect(judgeWeather(park, wx({ condition: 'storm', severe: true })).unsafe).toBe(true);
    expect(judgeWeather(museum, wx({ condition: 'storm', severe: true })).unsafe).toBe(false);
  });

  it('is neutral when weather is unavailable', () => {
    expect(judgeWeather(park, null)).toEqual({ score: 0, unsafe: false });
  });
});

describe('transportation and parking scoring', () => {
  it('transit preference ranks transit-friendly places higher', () => {
    const near = place({ id: 'a', attributes: { exposure: 'none', transitFriendly: true } });
    const far = place({ id: 'b', attributes: { exposure: 'none', transitFriendly: false } });
    const q = query({ transport: 'transit' });
    const t: TravelEstimate = { mode: 'transit', durationMin: 20, distanceMiles: 4, trafficDelayMin: null, source: 'demo' };
    expect(scoreCandidate(near, q, t, null, at(17), at(12)).score).toBeGreaterThan(scoreCandidate(far, q, t, null, at(17), at(12)).score);
  });

  it('walking preference prefers walkable places', () => {
    const a = place({ id: 'a', attributes: { exposure: 'none', walkable: true } });
    const b = place({ id: 'b', attributes: { exposure: 'none', walkable: false } });
    const q = query({ transport: 'walk' });
    const t: TravelEstimate = { mode: 'walk', durationMin: 12, distanceMiles: 0.6, trafficDelayMin: null, source: 'demo' };
    expect(scoreCandidate(a, q, t, null, at(17), at(12)).score).toBeGreaterThan(scoreCandidate(b, q, t, null, at(17), at(12)).score);
  });

  it('parking difficulty lowers a driving recommendation; missing data is neutral', () => {
    const easy = place({ id: 'easy', parking: { difficulty: 'easy', cost: 'Free', type: 'lot', walkMin: 2 } });
    const hard = place({ id: 'hard', parking: { difficulty: 'hard', cost: '$20', type: 'garage', walkMin: 8 } });
    const unknown = place({ id: 'unk', parking: null });
    const q = query();
    const sEasy = scoreCandidate(easy, q, drive(10), null, at(17), at(12));
    const sHard = scoreCandidate(hard, q, drive(10), null, at(17), at(12));
    const sUnk = scoreCandidate(unknown, q, drive(10), null, at(17), at(12));
    expect(sEasy.score).toBeGreaterThan(sUnk.score);
    expect(sUnk.score).toBeGreaterThan(sHard.score);
    expect(sUnk.reasons.join(' ')).not.toMatch(/parking/i);
    expect(sUnk.cautions.join(' ')).not.toMatch(/parking/i);
  });

  it('traffic delay is a caution and a penalty', () => {
    const p = place({ id: 'p' });
    const calm = scoreCandidate(p, query(), drive(20, 0), null, at(17), at(12));
    const jam = scoreCandidate(p, query(), drive(20, 15), null, at(17), at(12));
    expect(jam.score).toBeLessThan(calm.score);
    expect(jam.cautions[0]).toMatch(/Traffic adds about 15 minutes/);
  });

  it('never exposes numeric precision in explanations', () => {
    const s = scoreCandidate(place({ id: 'p', categories: ['arts'] }), query({ interests: ['arts'] }), drive(8), wx({}), at(17), at(12));
    expect(s.reasons.join(' ')).not.toMatch(/\d+\.\d+%/);
    expect(s.reasons[0]).toMatch(/arts/);
  });
});
