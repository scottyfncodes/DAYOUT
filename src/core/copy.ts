import type { DayQuery, Recommendation, WeatherForecast } from './types';
import { formatTime } from './time';
import { nextPrecipitation, weatherAt } from './weather';

/** A little personality. Never a chatbot. */
export function headlineFor(q: DayQuery, recs: Recommendation[], weather: WeatherForecast | null): string {
  const tz = q.origin.timezone;
  const windowMin = (q.window.end - q.window.start) / 60000;
  const now = weatherAt(weather, q.window.start);
  const precip = nextPrecipitation(weather, q.window.start, q.window.end);

  if (recs.length === 0) return 'NOTHING VERIFIED OPEN.';
  if (precip && precip.time > q.window.start + 20 * 60000) {
    return `${precip.condition === 'snow' ? 'SNOW' : 'RAIN'} AROUND ${formatTime(precip.time, tz)}. WE PLANNED AROUND IT.`;
  }
  if (now && (now.condition === 'rain' || now.condition === 'storm')) return 'RAIN? NO PROBLEM.';
  if (now && now.tempF >= 92) return `${Math.round(now.tempF)}°F OUT THERE. WE WENT FOR SHADE.`;
  if (now && now.tempF <= 25) return `${Math.round(now.tempF)}°F. WE KEPT IT INDOORS.`;
  if (windowMin <= 120) return `YOU'VE GOT ${Math.round(windowMin / 60) <= 1 ? 'AN HOUR OR SO' : `${Math.round(windowMin / 60)} HOURS`}. LET'S USE THEM.`;
  if (windowMin <= 360) return `YOU'VE GOT ${Math.round(windowMin / 60)} HOURS. LET'S USE THEM.`;
  if (weather?.sunset && q.window.end > weather.sunset && q.window.start < weather.sunset) {
    return `SUNSET IS AT ${formatTime(weather.sunset, tz)}. DON'T WASTE IT.`;
  }
  if (recs.every((r) => (r.travel?.durationMin ?? 0) <= 20)) return 'ALL OF THIS IS CLOSE. NO LONG DRIVES.';
  return 'GREAT FITS TODAY.';
}

export function weatherBanner(q: DayQuery, weather: WeatherForecast | null): { icon: string; title: string; body: string } | null {
  if (!weather) return null;
  const tz = q.origin.timezone;
  const now = weatherAt(weather, q.window.start);
  if (!now) return null;
  const precip = nextPrecipitation(weather, q.window.start, q.window.end);
  if (precip && precip.time > q.window.start + 10 * 60000) {
    return {
      icon: precip.condition === 'snow' ? '❄️' : '🌧️',
      title: `${precip.condition === 'snow' ? 'Snow' : 'Rain'} starts around ${formatTime(precip.time, tz)}.`,
      body: 'We moved outdoor options earlier and found indoor options for later.',
    };
  }
  if (now.condition === 'storm') return { icon: '⛈️', title: 'Storms right now.', body: 'Exposed outdoor activities are off the list until it passes.' };
  if (now.condition === 'rain') return { icon: '🌧️', title: 'Raining right now.', body: 'Indoor options are ranked higher. Covered outdoor spots still make the cut.' };
  if (now.condition === 'snow') return { icon: '❄️', title: 'Snowing right now.', body: 'Indoor options are ranked higher.' };
  if (now.tempF >= 90) return { icon: '☀️', title: `${Math.round(now.tempF)}°F this afternoon.`, body: 'Shaded, indoor, water-based and evening activities moved up.' };
  if (now.tempF <= 28) return { icon: '❄️', title: `${Math.round(now.tempF)}°F.`, body: 'Indoor options are ranked higher.' };
  if ((now.condition === 'clear' || now.condition === 'partly') && now.tempF >= 55 && now.tempF <= 85) {
    return { icon: '🌤️', title: 'Perfect weather to be outside.', body: 'We found several outdoor options worth prioritizing.' };
  }
  return { icon: '☁️', title: `${Math.round(now.tempF)}°F and ${now.condition}.`, body: 'Weather is a non-issue either way.' };
}
