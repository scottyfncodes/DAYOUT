// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BURST_MAX, burstLimited, sameSite } from './_lib';

function req(headers: Record<string, string | undefined>, extra: Partial<VercelRequest> = {}): VercelRequest {
  const clean = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined));
  return { headers: clean, query: {}, method: 'GET', ...extra } as unknown as VercelRequest;
}

function res() {
  const out = { status: 0, body: '', headers: {} as Record<string, string> };
  const r = {
    setHeader(k: string, v: string) {
      out.headers[k.toLowerCase()] = v;
      return r;
    },
    status(code: number) {
      out.status = code;
      return r;
    },
    send(b: string) {
      out.body = b;
      return r;
    },
  };
  return { r: r as unknown as VercelResponse, out };
}

const HOST = 'dayout-haveanapp.vercel.app';

describe('sameSite', () => {
  it('allows a same-host Origin', () => {
    expect(sameSite(req({ host: HOST, origin: `https://${HOST}` }))).toBe(true);
  });

  it('allows a same-host Referer when Origin is absent (same-origin GET)', () => {
    expect(sameSite(req({ host: HOST, referer: `https://${HOST}/plan?x=1` }))).toBe(true);
  });

  it('prefers x-forwarded-host over host', () => {
    expect(sameSite(req({ host: 'internal', 'x-forwarded-host': HOST, referer: `https://${HOST}/` }))).toBe(true);
  });

  it('refuses a request with neither Origin nor Referer', () => {
    expect(sameSite(req({ host: HOST }))).toBe(false);
  });

  it('refuses a foreign Origin, even with a same-host Referer', () => {
    expect(sameSite(req({ host: HOST, origin: 'https://evil.example', referer: `https://${HOST}/` }))).toBe(false);
  });

  it('refuses a foreign Referer', () => {
    expect(sameSite(req({ host: HOST, referer: 'https://evil.example/' }))).toBe(false);
  });

  it('refuses a lookalike host', () => {
    expect(sameSite(req({ host: HOST, origin: `https://${HOST}.evil.example` }))).toBe(false);
  });

  it('refuses an opaque "null" Origin and unparseable values', () => {
    expect(sameSite(req({ host: HOST, origin: 'null' }))).toBe(false);
    expect(sameSite(req({ host: HOST, referer: 'not a url' }))).toBe(false);
  });

  it('refuses when the host header is missing', () => {
    expect(sameSite(req({ origin: `https://${HOST}` }))).toBe(false);
  });
});

describe('burstLimited', () => {
  it('allows up to BURST_MAX calls per IP per minute, then limits, then resets', () => {
    const r = req({ 'x-forwarded-for': '203.0.113.7' });
    const t0 = 1_000_000;
    for (let i = 0; i < BURST_MAX; i++) expect(burstLimited(r, 'test-a', t0 + i)).toBe(false);
    expect(burstLimited(r, 'test-a', t0 + BURST_MAX)).toBe(true);
    expect(burstLimited(req({ 'x-forwarded-for': '203.0.113.8' }), 'test-a', t0 + BURST_MAX)).toBe(false);
    expect(burstLimited(r, 'test-a', t0 + 60_000)).toBe(false);
  });
});

describe('paid endpoints', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('/api/places returns 403 without Origin or Referer and never calls upstream', async () => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-key');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { default: places } = await import('./places');
    const { r, out } = res();
    await places(req({ host: HOST }, { query: { lat: '39.7', lng: '-104.9' } }), r);
    expect(out.status).toBe(403);
    expect(JSON.parse(out.body)).toEqual({ error: 'forbidden' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('/api/places returns 403 for a foreign Origin', async () => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-key');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { default: places } = await import('./places');
    const { r, out } = res();
    await places(req({ host: HOST, origin: 'https://evil.example' }, { query: { lat: '39.7', lng: '-104.9' } }), r);
    expect(out.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('/api/places hides upstream error text from the client', async () => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('upstream said something internal')));
    const { default: places } = await import('./places');
    const { r, out } = res();
    await places(req({ host: HOST, referer: `https://${HOST}/` }, { query: { lat: '39.7', lng: '-104.9', interests: 'food' } }), r);
    expect(out.status).toBe(502);
    expect(out.body).not.toContain('internal');
    expect(JSON.parse(out.body)).toEqual({ error: 'places unavailable' });
    expect(console.error).toHaveBeenCalled();
  });

  it('/api/route returns 403 without Origin or Referer', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { default: route } = await import('./route');
    const { r, out } = res();
    const body = { from: { lat: 39.7, lng: -104.9 }, to: [{ lat: 39.8, lng: -105 }], mode: 'drive' };
    await route(req({ host: HOST }, { method: 'POST', body }), r);
    expect(out.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('/api/route accepts a same-site Origin and hides upstream error text', async () => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('osrm internal detail')));
    const { default: route } = await import('./route');
    const { r, out } = res();
    const body = { from: { lat: 39.7, lng: -104.9 }, to: [{ lat: 39.8, lng: -105 }], mode: 'drive' };
    await route(req({ host: HOST, origin: `https://${HOST}` }, { method: 'POST', body }), r);
    expect(out.status).toBe(502);
    expect(JSON.parse(out.body)).toEqual({ error: 'routing unavailable' });
  });
});
