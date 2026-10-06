import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GOOGLE_KEY, json } from './_lib';

/** Reports which live providers are configured. Booleans only — never the keys. */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  json(
    res,
    200,
    {
      places: GOOGLE_KEY ? 'google' : null,
      routing: GOOGLE_KEY ? 'google' : 'osrm',
      traffic: GOOGLE_KEY ? 'google' : null,
      weather: 'open-meteo',
      geocode: 'open-meteo',
    },
    60,
  );
}
