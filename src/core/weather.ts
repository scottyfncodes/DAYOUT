import type { Place, WeatherCondition, WeatherForecast, WeatherSnapshot } from './types';

/** Nearest hourly snapshot to an instant, or null when the forecast doesn't cover it. */
export function weatherAt(forecast: WeatherForecast | null, time: number): WeatherSnapshot | null {
  if (!forecast || forecast.hourly.length === 0) return null;
  let best: WeatherSnapshot | null = null;
  let bestDist = Infinity;
  for (const h of forecast.hourly) {
    const d = Math.abs(h.time - time);
    if (d < bestDist) {
      best = h;
      bestDist = d;
    }
  }
  // More than 90 minutes from any sample means we don't actually know.
  return bestDist <= 90 * 60000 ? best : null;
}

export interface WeatherVerdict {
  /** -1 .. 1: negative hurts the activity, positive helps */
  score: number;
  /** hard exclusion for safety */
  unsafe: boolean;
  note?: string;
}

export function judgeWeather(place: Place, w: WeatherSnapshot | null): WeatherVerdict {
  if (!w) return { score: 0, unsafe: false };
  const exposure = place.attributes.exposure;
  const bad = w.condition === 'rain' || w.condition === 'snow' || w.condition === 'storm';
  const hot = w.tempF >= 90;
  const cold = w.tempF <= 28;
  const windy = w.windMph >= 25;

  if (exposure === 'none') {
    // Indoor options get a lift exactly when the outdoors is unpleasant.
    if (w.severe || w.condition === 'storm') return { score: 0.6, unsafe: false, note: 'A good call while it storms' };
    if (bad) return { score: 0.45, unsafe: false, note: `Dry and warm while it ${w.condition === 'snow' ? 'snows' : 'rains'}` };
    if (hot) return { score: 0.35, unsafe: false, note: `Cool escape from ${Math.round(w.tempF)}°F` };
    if (cold) return { score: 0.35, unsafe: false, note: `Warm escape from ${Math.round(w.tempF)}°F` };
    return { score: 0, unsafe: false };
  }

  if (w.severe || w.condition === 'storm') {
    if (exposure === 'full') return { score: -1, unsafe: true, note: 'Unsafe outdoors during storms' };
    return { score: -0.6, unsafe: false, note: 'Storms nearby' };
  }

  let score = 0;
  let note: string | undefined;
  if (bad) {
    score -= exposure === 'full' ? 0.8 : 0.4;
    note = w.condition === 'snow' ? 'Snow at that time' : `${Math.round(w.precipProb)}% chance of rain at that time`;
  } else if (w.precipProb >= 50) {
    score -= exposure === 'full' ? 0.35 : 0.15;
    note = `${Math.round(w.precipProb)}% chance of rain`;
  }
  if (hot) {
    score -= exposure === 'full' ? 0.5 : 0.25;
    note = note ?? `${Math.round(w.tempF)}°F — hot for this`;
  } else if (cold) {
    score -= exposure === 'full' ? 0.5 : 0.25;
    note = note ?? `${Math.round(w.tempF)}°F — bundle up`;
  }
  if (windy) {
    score -= 0.2;
    note = note ?? `Windy (${Math.round(w.windMph)} mph)`;
  }
  if (score === 0 && (w.condition === 'clear' || w.condition === 'partly') && w.tempF >= 50 && w.tempF <= 85) {
    score = exposure === 'full' ? 0.7 : 0.4;
    note = `${Math.round(w.tempF)}°F and ${w.condition === 'clear' ? 'clear' : 'mostly sunny'}`;
  }
  return { score: Math.max(-1, Math.min(1, score)), unsafe: false, note };
}

/** First hour in the forecast (after `from`) where rain/snow/storm begins, if any. */
export function nextPrecipitation(forecast: WeatherForecast | null, from: number, until: number): WeatherSnapshot | null {
  if (!forecast) return null;
  for (const h of forecast.hourly) {
    if (h.time < from || h.time > until) continue;
    if (h.condition === 'rain' || h.condition === 'snow' || h.condition === 'storm') return h;
  }
  return null;
}

export const CONDITION_EMOJI: Record<WeatherCondition, string> = {
  clear: '☀️',
  partly: '🌤️',
  cloudy: '☁️',
  fog: '🌫️',
  rain: '🌧️',
  snow: '❄️',
  storm: '⛈️',
  wind: '💨',
};

export function describeCondition(c: WeatherCondition): string {
  return {
    clear: 'Clear',
    partly: 'Partly sunny',
    cloudy: 'Cloudy',
    fog: 'Foggy',
    rain: 'Rain',
    snow: 'Snow',
    storm: 'Storms',
    wind: 'Windy',
  }[c];
}
