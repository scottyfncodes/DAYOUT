import { describe, it, expect } from 'vitest';
import { resolveWindow, toggleTuning, applyQuickMode, QUICK_MODES } from '../adjust';
import { encodePlan, decodePlan, makePlan } from '../plan';
import { at, TZ, query, place, ORIGIN } from '@/test/fixtures';

describe('time presets', () => {
  it('"we have 3 hours" is exactly 3 hours from now', () => {
    const w = resolveWindow({ kind: 'hours', hours: 3 }, at(13), TZ);
    expect(w.end - w.start).toBe(3 * 3600000);
  });
  it('"tonight" starts at 5 PM or now, whichever is later', () => {
    expect(resolveWindow({ kind: 'tonight' }, at(13), TZ).start).toBe(at(17));
    expect(resolveWindow({ kind: 'tonight' }, at(19, 7), TZ).start).toBe(at(19, 15));
  });
  it('"Saturday" resolves to the coming Saturday', () => {
    const w = resolveWindow({ kind: 'weekday', weekday: 6 }, at(13), TZ);
    expect(w.start).toBe(at(10, 0, '2026-10-10'));
  });
});

describe('make it better', () => {
  it('less driving caps distance; toggling again removes the cap', () => {
    const q1 = toggleTuning(query(), 'lessDriving');
    expect(q1.constraints.maxDistanceMiles).toBe(8);
    const q2 = toggleTuning(q1, 'lessDriving');
    expect(q2.constraints.maxDistanceMiles).toBeUndefined();
  });
  it('quick modes configure filters', () => {
    const rainy = QUICK_MODES.find((m) => m.id === 'rainy')!;
    const q = applyQuickMode(query(), rainy, at(13));
    expect(q.constraints.setting).toBe('indoor');
    expect(q.interests).toContain('arts');
  });
});

describe('plan share links', () => {
  it('round-trips through a URL-safe string', () => {
    const plan = makePlan(ORIGIN, { start: at(10), end: at(16) }, [place({ id: 'x', name: 'X Place' })], 'demo');
    const enc = encodePlan(plan);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    const dec = decodePlan(enc);
    expect(dec?.places[0]?.name).toBe('X Place');
    expect(dec?.title).toBe('TUESDAY IN DENVER');
  });
  it('rejects garbage', () => {
    expect(decodePlan('not-a-plan')).toBeNull();
  });
});
