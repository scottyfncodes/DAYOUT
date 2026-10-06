import { describe, it, expect } from 'vitest';
import { assessAvailability, earliestVisitStart, statusLine, H } from '../hours';
import { place, at, TZ } from '@/test/fixtures';
import { zonedEpoch } from '../time';

describe('availability gate', () => {
  it('confirms a verified place open across the whole visit', () => {
    const a = assessAvailability(place({ id: 'a' }), at(10), at(11));
    expect(a.state).toBe('OPEN_CONFIRMED');
    expect(a.openUntil).toBe(at(17));
  });

  it('excludes a place that is closed that weekday', () => {
    const p = place({ id: 'mon', hours: { confidence: 'verified', weekly: H.days({ 2: [] , 3: [{ open: 600, close: 1020 }] }) } });
    const a = assessAvailability(p, at(10), at(11)); // Tuesday
    expect(a.state).toBe('CLOSED');
    expect(a.reason).toMatch(/Closed Tuesdays/);
  });

  it('excludes a place that opens after the requested time', () => {
    const p = place({ id: 'late', hours: { confidence: 'verified', weekly: H.daily(H.t(16), H.t(22)) } });
    const a = assessAvailability(p, at(10), at(11));
    expect(a.state).toBe('CLOSED');
    expect(a.reason).toBe('Opens at 4 PM');
    expect(a.opensAt).toBe(at(16));
  });

  it('excludes a place that closes before arrival', () => {
    const p = place({ id: 'early', hours: { confidence: 'verified', weekly: H.daily(H.t(6), H.t(9)) } });
    expect(assessAvailability(p, at(10), at(11)).state).toBe('CLOSED');
  });

  it('excludes a place that closes during the visit', () => {
    const a = assessAvailability(place({ id: 'a' }), at(16, 30), at(17, 30));
    expect(a.state).toBe('CLOSED');
    expect(a.reason).toMatch(/Closes at 5 PM/);
  });

  it('excludes holiday closures via date overrides', () => {
    const p = place({ id: 'hol', hours: { confidence: 'verified', weekly: H.daily(540, 1020), overrides: { '2026-10-06': 'closed' } } });
    const a = assessAvailability(p, at(10), at(11));
    expect(a.state).toBe('CLOSED');
    expect(a.reason).toMatch(/special hours/);
  });

  it('honours early-close overrides', () => {
    const p = place({ id: 'early-close', hours: { confidence: 'verified', weekly: H.daily(540, 1020), overrides: { '2026-10-06': [{ open: 540, close: 720 }] } } });
    expect(assessAvailability(p, at(10), at(11)).state).toBe('OPEN_CONFIRMED');
    expect(assessAvailability(p, at(12, 30), at(13)).state).toBe('CLOSED');
  });

  it('excludes temporary closures', () => {
    const p = place({ id: 'tmp', hours: { confidence: 'verified', weekly: H.daily(540, 1020), temporarilyClosed: true } });
    expect(assessAvailability(p, at(10), at(11))).toMatchObject({ state: 'CLOSED', reason: 'Temporarily closed' });
  });

  it('marks unknown hours as UNKNOWN (never open)', () => {
    const p = place({ id: 'unk', hours: { confidence: 'unknown', weekly: H.daily(540, 1020) } });
    expect(assessAvailability(p, at(10), at(11)).state).toBe('UNKNOWN');
  });

  it('downgrades weekly-template-only hours to OPEN_LIKELY', () => {
    const p = place({ id: 'sched', hours: { confidence: 'scheduled', weekly: H.daily(540, 1020) } });
    expect(assessAvailability(p, at(10), at(11)).state).toBe('OPEN_LIKELY');
  });

  it('downgrades verified data past its verified-through date', () => {
    const p = place({ id: 'stale', hours: { confidence: 'verified', verifiedThrough: '2026-10-05', weekly: H.daily(540, 1020) } });
    expect(assessAvailability(p, at(10), at(11)).state).toBe('OPEN_LIKELY');
  });

  it('handles hours that run past midnight', () => {
    const bar = place({ id: 'bar', hours: { confidence: 'verified', verifiedThrough: '2030-01-01', weekly: H.daily(H.t(17), H.t(26)) } });
    // 1 AM Wednesday is covered by Tuesday's 5 PM – 2 AM interval.
    const a = assessAvailability(bar, at(1, 0, '2026-10-07'), at(1, 30, '2026-10-07'));
    expect(a.state).toBe('OPEN_CONFIRMED');
    expect(a.openUntil).toBe(zonedEpoch('2026-10-07', 120, TZ));
  });

  it('excludes when the kitchen closes before the visit ends even if the bar is open', () => {
    const p = place({
      id: 'kitchen',
      hours: { confidence: 'verified', verifiedThrough: '2030-01-01', weekly: H.daily(H.t(11), H.t(23)) },
      activities: [{ label: 'Kitchen', kind: 'kitchen', mustCover: 'visit', weekly: H.daily(H.t(11), H.t(21)) }],
    });
    expect(assessAvailability(p, at(19), at(20)).state).toBe('OPEN_CONFIRMED');
    const late = assessAvailability(p, at(20, 30), at(21, 30));
    expect(late.state).toBe('CLOSED');
    expect(late.reason).toBe('Kitchen closes at 9 PM');
  });

  it('excludes when final admission has passed', () => {
    const p = place({
      id: 'museum',
      activities: [{ label: 'Last entry', kind: 'lastEntry', mustCover: 'arrival', weekly: H.daily(H.t(9), H.t(16)) }],
    });
    expect(assessAvailability(p, at(16, 15), at(17)).state).toBe('CLOSED');
    expect(assessAvailability(p, at(15, 45), at(17)).state).toBe('OPEN_CONFIRMED');
  });

  it('respects seasonal operation', () => {
    const p = place({ id: 'summer', hours: { confidence: 'verified', verifiedThrough: '2030-01-01', weekly: H.daily(600, 1200), season: { from: '05-15', to: '09-15' } } });
    expect(assessAvailability(p, at(11), at(12)).state).toBe('CLOSED');
    expect(assessAvailability(p, at(11, 0, '2026-07-04'), at(12, 0, '2026-07-04')).state).toBe('OPEN_CONFIRMED');
  });
});

describe('earliestVisitStart', () => {
  it('waits for opening when arriving early', () => {
    const p = place({ id: 'a' });
    expect(earliestVisitStart(p, at(8), at(17), 60)).toBe(at(9));
  });
  it('returns null when nothing fits before close', () => {
    expect(earliestVisitStart(place({ id: 'a' }), at(16, 30), at(20), 60)).toBeNull();
  });
  it('returns null when the window ends too early', () => {
    expect(earliestVisitStart(place({ id: 'a' }), at(10), at(10, 30), 60)).toBeNull();
  });
});

describe('statusLine', () => {
  it('reports OPEN NOW with closing time', () => {
    expect(statusLine(place({ id: 'a' }), at(12))).toEqual({ label: 'OPEN NOW', detail: 'until 5 PM', open: true });
  });
  it('reports OPENS AT when closed before opening', () => {
    expect(statusLine(place({ id: 'a' }), at(7)).label).toBe('OPENS AT 9 AM');
  });
});
