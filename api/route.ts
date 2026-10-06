import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GOOGLE_KEY, cached, fetchJson, json, sameSite } from './_lib.js';
import type { LatLng, TransportMode, TravelEstimate } from '../src/core/types.js';

type Mode = Exclude<TransportMode, 'any'>;

interface Body {
  from: LatLng;
  to: LatLng[];
  mode: Mode;
  departAt?: number;
}

const OSRM_PROFILE: Partial<Record<Mode, string>> = { drive: 'driving', rideshare: 'driving', walk: 'walking', bike: 'cycling' };
const GOOGLE_MODE: Record<Mode, string> = { drive: 'DRIVE', rideshare: 'DRIVE', walk: 'WALK', bike: 'BICYCLE', transit: 'TRANSIT' };

/**
 * Batch travel estimates from one origin to many destinations.
 * Google Routes (traffic-aware) when a key is configured, otherwise OSRM
 * (no traffic — reported as null, never guessed). Transit needs Google.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  if (!sameSite(req)) return json(res, 403, { error: 'forbidden' });
  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Body;
  if (!body?.from || !Array.isArray(body.to) || body.to.length === 0 || body.to.length > 60) return json(res, 400, { error: 'bad request' });
  const mode = body.mode;
  const departAt = body.departAt && body.departAt > Date.now() + 60000 ? body.departAt : undefined;
  const key = `route:${mode}:${body.from.lat.toFixed(4)},${body.from.lng.toFixed(4)}:${body.to.map((t) => `${t.lat.toFixed(4)},${t.lng.toFixed(4)}`).join(';')}:${departAt ? Math.round(departAt / 600000) : 'now'}`;
  try {
    const estimates = await cached(key, 5 * 60 * 1000, () => (GOOGLE_KEY ? google(body.from, body.to, mode, departAt) : osrm(body.from, body.to, mode)));
    json(res, 200, { estimates }, 120);
  } catch (e) {
    json(res, 502, { error: 'routing unavailable', detail: String(e) });
  }
}

async function osrm(from: LatLng, to: LatLng[], mode: Mode): Promise<(TravelEstimate | null)[]> {
  const profile = OSRM_PROFILE[mode];
  if (!profile) return to.map(() => null);
  const coords = [from, ...to].map((p) => `${p.lng},${p.lat}`).join(';');
  const data = await fetchJson<{ code: string; durations?: (number | null)[][]; distances?: (number | null)[][] }>(
    `https://router.project-osrm.org/table/v1/${profile}/${coords}?sources=0&annotations=duration,distance`,
    { headers: { 'User-Agent': 'DayOut/0.1 (https://github.com/scottyfncodes/DAYOUT)' } },
  );
  if (data.code !== 'Ok' || !data.durations?.[0]) throw new Error('osrm error');
  return to.map((_, i) => {
    const d = data.durations![0]![i + 1];
    const m = data.distances?.[0]?.[i + 1];
    if (d == null) return null;
    return {
      mode,
      durationMin: Math.round(d / 60) + (mode === 'rideshare' ? 6 : 0),
      distanceMiles: m == null ? 0 : Math.round((m / 1609.34) * 10) / 10,
      trafficDelayMin: null,
      source: 'osrm',
    };
  });
}

async function google(from: LatLng, to: LatLng[], mode: Mode, departAt?: number): Promise<(TravelEstimate | null)[]> {
  const travelMode = GOOGLE_MODE[mode];
  const body: Record<string, unknown> = {
    origins: [{ waypoint: { location: { latLng: { latitude: from.lat, longitude: from.lng } } } }],
    destinations: to.map((t) => ({ waypoint: { location: { latLng: { latitude: t.lat, longitude: t.lng } } } })),
    travelMode,
  };
  if (travelMode === 'DRIVE') body.routingPreference = 'TRAFFIC_AWARE';
  if (departAt && travelMode !== 'WALK' && travelMode !== 'BICYCLE') body.departureTime = new Date(departAt).toISOString();
  const rows = await fetchJson<{ originIndex: number; destinationIndex: number; duration?: string; staticDuration?: string; distanceMeters?: number; condition?: string }[]>(
    'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,staticDuration,distanceMeters,condition' },
      body: JSON.stringify(body),
    },
  );
  const out: (TravelEstimate | null)[] = to.map(() => null);
  for (const r of rows) {
    if (r.condition !== 'ROUTE_EXISTS' || !r.duration) continue;
    const dur = parseSeconds(r.duration) / 60;
    const stat = r.staticDuration ? parseSeconds(r.staticDuration) / 60 : null;
    out[r.destinationIndex] = {
      mode,
      durationMin: Math.round(stat ?? dur) + (mode === 'rideshare' ? 6 : 0),
      distanceMiles: Math.round(((r.distanceMeters ?? 0) / 1609.34) * 10) / 10,
      trafficDelayMin: travelMode === 'DRIVE' && stat !== null ? Math.max(0, Math.round(dur - stat)) : null,
      source: 'google',
    };
  }
  return out;
}

function parseSeconds(s: string): number {
  return Number(s.replace(/s$/, '')) || 0;
}
