import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GOOGLE_KEY, cached, fetchJson, json, num, sameSite, str, todayIso } from './_lib';
import { placeFromGoogle, typesForInterests, type GooglePlace } from '../src/providers/shared/google';
import type { Interest, Place } from '../src/core/types';

const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.types', 'places.primaryType',
  'places.rating', 'places.priceLevel', 'places.businessStatus', 'places.regularOpeningHours', 'places.currentOpeningHours',
  'places.googleMapsUri', 'places.websiteUri', 'places.editorialSummary', 'places.allowsDogs', 'places.goodForChildren',
  'places.reservable', 'places.outdoorSeating', 'places.accessibilityOptions',
].join(',');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!GOOGLE_KEY) return json(res, 503, { error: 'no verified places provider configured' });
  if (!sameSite(req)) return json(res, 403, { error: 'forbidden' });
  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  const radiusMiles = Math.min(31, Math.max(1, num(req.query.radius, 10)!));
  const tz = str(req.query.tz, 'UTC');
  const interests = str(req.query.interests)
    .split(',')
    .filter(Boolean) as Interest[];
  if (lat === undefined || lng === undefined) return json(res, 400, { error: 'lat,lng required' });

  const groups = typesForInterests(interests);
  const key = `places:${lat.toFixed(3)},${lng.toFixed(3)}:${radiusMiles}:${groups.flat().join('|')}`;
  try {
    const places = await cached(key, 5 * 60 * 1000, async () => {
      const today = todayIso(tz);
      const seen = new Map<string, Place>();
      await Promise.all(
        groups.map(async (includedTypes) => {
          const data = await fetchJson<{ places?: GooglePlace[] }>('https://places.googleapis.com/v1/places:searchNearby', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': FIELDS },
            body: JSON.stringify({
              includedTypes,
              maxResultCount: 20,
              rankPreference: 'POPULARITY',
              locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: Math.round(radiusMiles * 1609.34) } },
            }),
          });
          for (const g of data.places ?? []) {
            const p = placeFromGoogle(g, tz, today);
            if (p && !seen.has(p.id)) seen.set(p.id, p);
          }
        }),
      );
      return [...seen.values()];
    });
    json(res, 200, { places, source: 'google', fetchedAt: Date.now() }, 300);
  } catch (e) {
    json(res, 502, { error: 'places unavailable', detail: String(e) });
  }
}
