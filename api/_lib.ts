import type { VercelRequest, VercelResponse } from '@vercel/node';

export const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY ?? '';

export function json(res: VercelResponse, status: number, body: unknown, cacheSeconds = 0) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (cacheSeconds > 0) res.setHeader('Cache-Control', `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`);
  else res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

export function num(v: unknown, fallback?: number): number | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === undefined || s === '') return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

export function str(v: unknown, fallback = ''): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s : fallback;
}

/** Light abuse guard for endpoints that spend paid quota: same-site requests only. */
export function sameSite(req: VercelRequest): boolean {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const origin = req.headers.origin ?? req.headers.referer;
  if (!origin) return true; // PWA/service-worker fetches may omit both
  try {
    return new URL(String(origin)).host === host;
  } catch {
    return false;
  }
}

const memo = new Map<string, { at: number; value: unknown }>();
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  memo.set(key, { at: Date.now(), value });
  if (memo.size > 500) memo.delete(memo.keys().next().value as string);
  return value;
}

export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export function todayIso(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
