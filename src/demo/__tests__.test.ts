import { describe, it, expect } from 'vitest';
import { DENVER_PLACES } from './denver';
import { DemoRoutingProvider, DemoWeatherProvider } from './providers';
import { findMyDay } from '@/core/pipeline';
import { query, at, STATUS } from '@/test/fixtures';
import { DemoPlacesProvider } from './providers';

describe('Denver demo dataset', () => {
  it('has unique ids and sane hours', () => {
    const ids = new Set(DENVER_PLACES.map((p) => p.id));
    expect(ids.size).toBe(DENVER_PLACES.length);
    for (const p of DENVER_PLACES) {
      expect(p.hours.weekly).toHaveLength(7);
      for (const day of p.hours.weekly) for (const iv of day) expect(iv.close).toBeGreaterThan(iv.open);
      expect(p.duration.typical).toBeGreaterThanOrEqual(p.duration.min);
    }
  });

  it('produces verified-open results for a Tuesday afternoon in Denver and never a closed one', async () => {
    const providers = { places: new DemoPlacesProvider(), weather: new DemoWeatherProvider('clear'), routing: new DemoRoutingProvider(), mode: 'demo' as const };
    const r = await findMyDay(query({ window: { start: at(13), end: at(18) } }), providers, STATUS);
    expect(r.recommendations.length).toBeGreaterThanOrEqual(3);
    for (const rec of r.recommendations) expect(rec.availability.state).toBe('OPEN_CONFIRMED');
    const ids = r.recommendations.map((x) => x.place.id);
    expect(ids).not.toContain('dnv-firefighters'); // temporarily closed
    expect(ids).not.toContain('dnv-urban-putt'); // unknown hours
    expect(ids).not.toContain('dnv-lakeside'); // out of season
    expect(ids).not.toContain('dnv-casa-bonita'); // closed Tuesdays
  });

  it('I-70 westbound weekend-morning traffic shows up as a delay, not a guess', async () => {
    const r = new DemoRoutingProvider();
    const sat = at(8, 0, '2026-10-10');
    const est = await r.estimate({ lat: 39.7392, lng: -104.9903 }, { lat: 39.7423, lng: -105.5121 }, 'drive', sat);
    expect(est?.trafficDelayMin).toBeGreaterThan(10);
    const walk = await r.estimate({ lat: 39.7392, lng: -104.9903 }, { lat: 39.7423, lng: -105.5121 }, 'walk', sat);
    expect(walk).toBeNull();
  });
});
