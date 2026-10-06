import { describe, it, expect } from 'vitest';
import { hoursFromGoogle, placeFromGoogle, weeklyFromPeriods, type GooglePlace } from '../google';
import { conditionFromCode, normalizeOpenMeteo } from '../openmeteo';
import { assessAvailability } from '@/core/hours';
import { at } from '@/test/fixtures';

describe('google normalizer', () => {
  it('builds weekly hours, including overnight periods', () => {
    const weekly = weeklyFromPeriods([
      { open: { day: 2, hour: 17, minute: 0 }, close: { day: 3, hour: 2, minute: 0 } },
      { open: { day: 3, hour: 9, minute: 0 }, close: { day: 3, hour: 17, minute: 0 } },
    ]);
    expect(weekly[2]).toEqual([{ open: 1020, close: 1560 }]);
    expect(weekly[3]).toEqual([{ open: 540, close: 1020 }]);
  });

  it('treats dated currentOpeningHours as verified and missing dates as closed', () => {
    const g: GooglePlace = {
      id: 'x',
      displayName: { text: 'X' },
      location: { latitude: 39.7, longitude: -104.9 },
      types: ['museum'],
      businessStatus: 'OPERATIONAL',
      regularOpeningHours: { periods: [{ open: { day: 2, hour: 10, minute: 0 }, close: { day: 2, hour: 17, minute: 0 } }] },
      currentOpeningHours: {
        periods: [
          { open: { day: 2, hour: 10, minute: 0, date: { year: 2026, month: 10, day: 6 } }, close: { day: 2, hour: 15, minute: 0, date: { year: 2026, month: 10, day: 6 } } },
        ],
      },
    };
    const h = hoursFromGoogle(g, '2026-10-06');
    expect(h.confidence).toBe('verified');
    expect(h.verifiedThrough).toBe('2026-10-06');
    expect(h.overrides?.['2026-10-06']).toEqual([{ open: 600, close: 900 }]);
    const p = placeFromGoogle(g, 'America/Denver', '2026-10-06')!;
    // Special hours today (closes 3 PM) override the weekly template (closes 5 PM).
    expect(assessAvailability(p, at(15, 30), at(16)).state).toBe('CLOSED');
    expect(assessAvailability(p, at(13), at(14)).state).toBe('OPEN_CONFIRMED');
    // Beyond the verified range it is only "likely".
    expect(assessAvailability(p, at(13, 0, '2026-10-13'), at(14, 0, '2026-10-13')).state).toBe('OPEN_LIKELY');
  });

  it('marks places without hours as unknown and closed statuses as closed', () => {
    expect(hoursFromGoogle({ id: 'a' }, '2026-10-06').confidence).toBe('unknown');
    expect(hoursFromGoogle({ id: 'b', businessStatus: 'CLOSED_TEMPORARILY', regularOpeningHours: { periods: [] } }, '2026-10-06').temporarilyClosed).toBe(true);
  });

  it('never invents parking', () => {
    const p = placeFromGoogle({ id: 'x', displayName: { text: 'X' }, location: { latitude: 1, longitude: 2 } }, 'UTC', '2026-10-06')!;
    expect(p.parking).toBeNull();
  });
});

describe('open-meteo normalizer', () => {
  it('maps WMO codes', () => {
    expect(conditionFromCode(0).condition).toBe('clear');
    expect(conditionFromCode(61).condition).toBe('rain');
    expect(conditionFromCode(95)).toEqual({ condition: 'storm', severe: true });
  });
  it('skips missing samples rather than inventing them', () => {
    const f = normalizeOpenMeteo(
      { timezone: 'UTC', hourly: { time: [1, 2], temperature_2m: [60, null], precipitation_probability: [0, 0], weather_code: [0, 0], wind_speed_10m: [3, 3] } },
      0,
      0,
    );
    expect(f?.hourly).toHaveLength(1);
  });
  it('returns null on an empty payload', () => {
    expect(normalizeOpenMeteo({ timezone: 'UTC' }, 0, 0)).toBeNull();
  });
});
