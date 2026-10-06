import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cached, fetchJson, json, str } from './_lib.js';

interface OmGeo {
  results?: { name: string; latitude: number; longitude: number; timezone: string; admin1?: string; country_code?: string; feature_code?: string }[];
}
interface Nominatim {
  display_name: string;
  lat: string;
  lon: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = str(req.query.q).trim().slice(0, 100);
  if (q.length < 2) return json(res, 400, { error: 'q required' });
  try {
    const results = await cached(`geo:${q.toLowerCase()}`, 24 * 3600 * 1000, async () => {
      const om = await fetchJson<OmGeo>(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`);
      const hits = (om.results ?? []).map((r) => ({
        label: [r.name, r.admin1, r.country_code === 'US' ? undefined : r.country_code].filter(Boolean).join(', '),
        point: { lat: r.latitude, lng: r.longitude },
        timezone: r.timezone,
      }));
      if (hits.length) return hits;
      // Fall back to Nominatim for landmarks ("near Red Rocks"), then resolve the timezone.
      const nom = await fetchJson<Nominatim[]>(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q.replace(/^near\s+/i, ''))}&format=jsonv2&limit=3`,
        { headers: { 'User-Agent': 'DayOut/0.1 (https://github.com/scottyfncodes/DAYOUT)' } },
      );
      const out = [];
      for (const n of nom.slice(0, 2)) {
        const lat = Number(n.lat);
        const lng = Number(n.lon);
        const tzRes = await fetchJson<{ timezone?: string }>(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&timezone=auto&forecast_days=1`);
        if (!tzRes.timezone) continue;
        out.push({ label: n.display_name.split(',').slice(0, 2).join(','), point: { lat, lng }, timezone: tzRes.timezone });
      }
      return out;
    });
    json(res, 200, { results }, 3600);
  } catch (e) {
    json(res, 502, { error: 'geocoding unavailable', detail: String(e) });
  }
}
