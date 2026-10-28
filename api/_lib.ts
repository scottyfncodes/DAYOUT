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

function header(req: VercelRequest, name: string): string {
  const v = req.headers[name];
  return String(Array.isArray(v) ? v[0] : (v ?? '')).split(',')[0]!.trim().toLowerCase();
}

/**
 * Light abuse guard for endpoints that spend paid quota: the request must carry
 * an Origin or Referer on this same host. Requests with neither (curl, scripts)
 * are refused. The app's own fetches always send one: POSTs carry Origin, and
 * same-origin GETs carry Referer under the strict-origin-when-cross-origin
 * policy set in vercel.json. Headers can be forged, so this only stops casual
 * scripted use; the real spend ceiling is the Google Cloud quota on the key.
 */
export function sameSite(req: VercelRequest): boolean {
  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  const source = header(req, 'origin') || header(req, 'referer');
  if (!host || !source || source === 'null') return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

/**
 * Per-IP burst limit for paid endpoints. The window lives in this function
 * instance's memory only, so each serverless instance counts separately: it
 * blunts a burst from one client, it is not a global cap.
 */
const BURST_WINDOW_MS = 60_000;
export const BURST_MAX = 60;
const bursts = new Map<string, { start: number; count: number }>();
export function burstLimited(req: VercelRequest, bucket: string, now = Date.now()): boolean {
  const ip = header(req, 'x-real-ip') || header(req, 'x-forwarded-for') || 'unknown';
  const key = `${bucket}:${ip}`;
  const hit = bursts.get(key);
  if (!hit || now - hit.start >= BURST_WINDOW_MS) {
    bursts.delete(key);
    bursts.set(key, { start: now, count: 1 });
    if (bursts.size > 1000) bursts.delete(bursts.keys().next().value as string);
    return false;
  }
  hit.count += 1;
  return hit.count > BURST_MAX;
}

/** Logs the real failure server-side and returns a generic error to the client. */
export function upstreamError(res: VercelResponse, label: string, e: unknown) {
  console.error(`[api] ${label}:`, e);
  json(res, 502, { error: label });
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
