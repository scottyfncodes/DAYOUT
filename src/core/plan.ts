import type { Origin, Place, SavedPlan, TimeWindow } from './types';
import { formatDay } from './time';

/** Compact, URL-safe plan encoding for share links. No account required. */
export function encodePlan(plan: SavedPlan): string {
  const json = JSON.stringify(plan);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodePlan(encoded: string): SavedPlan | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as SavedPlan;
    if (parsed?.version !== 1 || !Array.isArray(parsed.places)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function makePlan(origin: Origin, window: TimeWindow, places: Place[], dataMode: 'live' | 'demo'): SavedPlan {
  const city = origin.label.split(',')[0]?.trim() ?? origin.label;
  return {
    version: 1,
    id: Math.random().toString(36).slice(2, 10),
    title: `${formatDay(window.start, origin.timezone).toUpperCase()} IN ${city.toUpperCase()}`,
    createdAt: Date.now(),
    origin,
    window,
    placeIds: places.map((p) => p.id),
    places,
    dataMode,
  };
}
