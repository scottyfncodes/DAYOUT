import type { WeatherCondition, WeatherForecast, WeatherSnapshot } from '../../core/types.js';

export interface OpenMeteoResponse {
  timezone: string;
  hourly?: {
    time: number[];
    temperature_2m: (number | null)[];
    precipitation_probability: (number | null)[];
    weather_code: (number | null)[];
    wind_speed_10m: (number | null)[];
  };
  daily?: { time: number[]; sunrise: number[]; sunset: number[] };
}

export function conditionFromCode(code: number): { condition: WeatherCondition; severe: boolean } {
  if (code === 0) return { condition: 'clear', severe: false };
  if (code <= 2) return { condition: 'partly', severe: false };
  if (code === 3) return { condition: 'cloudy', severe: false };
  if (code === 45 || code === 48) return { condition: 'fog', severe: false };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { condition: 'rain', severe: code === 65 || code === 67 || code === 82 };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { condition: 'snow', severe: code === 75 || code === 86 };
  if (code >= 95) return { condition: 'storm', severe: true };
  return { condition: 'cloudy', severe: false };
}

/** Normalize an Open-Meteo forecast. Missing samples are skipped, never invented. */
export function normalizeOpenMeteo(data: OpenMeteoResponse, now: number, windowStart: number): WeatherForecast | null {
  if (!data.hourly || !Array.isArray(data.hourly.time)) return null;
  const hourly: WeatherSnapshot[] = [];
  const h = data.hourly;
  for (let i = 0; i < h.time.length; i++) {
    const temp = h.temperature_2m[i];
    const code = h.weather_code[i];
    if (temp == null || code == null) continue;
    const c = conditionFromCode(code);
    const wind = h.wind_speed_10m[i] ?? 0;
    hourly.push({
      time: h.time[i]! * 1000,
      tempF: temp,
      condition: wind >= 30 && (c.condition === 'clear' || c.condition === 'partly') ? 'wind' : c.condition,
      precipProb: h.precipitation_probability[i] ?? 0,
      windMph: wind,
      severe: c.severe || wind >= 40,
    });
  }
  if (hourly.length === 0) return null;
  // Pick the sunrise/sunset of the day the window starts on.
  let sunrise: number | undefined;
  let sunset: number | undefined;
  if (data.daily) {
    for (let i = 0; i < data.daily.time.length; i++) {
      const dayStart = data.daily.time[i]! * 1000;
      if (windowStart >= dayStart && windowStart < dayStart + 86400000) {
        sunrise = data.daily.sunrise[i]! * 1000;
        sunset = data.daily.sunset[i]! * 1000;
      }
    }
  }
  return { timezone: data.timezone, hourly, sunrise, sunset, source: 'open-meteo', fetchedAt: now };
}
