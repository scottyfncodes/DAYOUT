import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cached, fetchJson, json, num } from './_lib.js';
import { normalizeOpenMeteo, type OpenMeteoResponse } from '../src/providers/shared/openmeteo.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  const start = num(req.query.start, Date.now())!;
  if (lat === undefined || lng === undefined) return json(res, 400, { error: 'lat,lng required' });
  const key = `wx:${lat.toFixed(2)},${lng.toFixed(2)}`;
  try {
    const data = await cached(key, 10 * 60 * 1000, () =>
      fetchJson<OpenMeteoResponse>(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
          `&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&daily=sunrise,sunset` +
          `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=7&past_hours=6&timeformat=unixtime`,
      ),
    );
    const forecast = normalizeOpenMeteo(data, Date.now(), start);
    if (!forecast) return json(res, 502, { error: 'weather unavailable' });
    json(res, 200, forecast, 600);
  } catch (e) {
    json(res, 502, { error: 'weather unavailable', detail: String(e) });
  }
}
