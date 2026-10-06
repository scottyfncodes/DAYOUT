import { useEffect, type ReactNode } from 'react';
import type { Place, Recommendation, TravelEstimate, WeatherSnapshot, ItineraryStop } from '@/core/types';
import { formatDuration, formatDurationRange, formatTime, wallClock } from '@/core/time';
import { priceLabel } from '@/core/scoring';
import { CONDITION_EMOJI } from '@/core/weather';
import { describeHours, statusLine } from '@/core/hours';
import { formatMiles } from '@/core/geo';
import { useApp } from './state';

export function Chip({ on, onClick, children, className = '', disabled, title }: { on?: boolean; onClick?: () => void; children: ReactNode; className?: string; disabled?: boolean; title?: string }) {
  return (
    <button type="button" className={`chip ${className}`} aria-pressed={on} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function DataBadge() {
  const { dataMode, liveConfig } = useApp();
  if (dataMode === 'live') return <span className="badge live"><span className="dot" /> Live data</span>;
  return (
    <span className="badge demo" title={liveConfig?.places ? 'Switch to live in settings' : 'No verified live places provider is configured on this deployment.'}>
      <span className="dot" /> Demo data · Denver
    </span>
  );
}

const MODE_ICON: Record<TravelEstimate['mode'], string> = { drive: '🚗', walk: '🚶', bike: '🚲', transit: '🚊', rideshare: '🚕' };

export function TravelChip({ t }: { t: TravelEstimate | null }) {
  if (!t) return <span className="warn">🧭 No route</span>;
  const delay = t.trafficDelayMin;
  return (
    <span title={`${formatMiles(t.distanceMiles)}${t.source === 'demo' ? ' · simulated' : ''}`}>
      {MODE_ICON[t.mode]} {formatDuration(t.durationMin)}
      {delay !== null && delay > 0 ? <em style={{ color: 'var(--warn)', fontStyle: 'normal' }}>&nbsp;+{delay} traffic</em> : null}
      {t.transfers ? ` · ${t.transfers} transfer${t.transfers > 1 ? 's' : ''}` : ''}
      {t.mode === 'rideshare' ? ' · + pickup' : ''}
    </span>
  );
}

export function ParkingChip({ p, mode }: { p: Place['parking']; mode?: TravelEstimate['mode'] }) {
  if (mode && mode !== 'drive' && mode !== 'rideshare') return null;
  if (!p) return <span className="muted" title="No parking data available — we never guess.">🅿️ Parking unknown</span>;
  const label = p.difficulty === 'easy' ? 'Parking easy' : p.difficulty === 'hard' ? 'Parking difficult' : 'Parking moderate';
  return (
    <span className={p.difficulty === 'hard' ? 'warn' : ''}>
      🅿️ {label} · {p.cost}{p.walkMin >= 5 ? ` · ${p.walkMin} min walk` : ''}
    </span>
  );
}

export function WeatherChip({ w, until, tz }: { w: WeatherSnapshot | null; until?: number; tz: string }) {
  if (!w) return <span className="muted">🌡️ Weather unavailable</span>;
  const text =
    w.condition === 'clear' || w.condition === 'partly'
      ? `${w.condition === 'clear' ? 'Clear' : 'Mostly sunny'}${until ? ` until ${formatTime(until, tz)}` : ''}`
      : `${Math.round(w.tempF)}°F · ${w.condition}${w.precipProb >= 40 ? ` ${Math.round(w.precipProb)}%` : ''}`;
  return <span>{CONDITION_EMOJI[w.condition]} {text}</span>;
}

export function OpenChip({ place, at }: { place: Place; at: number }) {
  const s = statusLine(place, at);
  return (
    <span className={s.open ? 'open' : 'closed'}>
      {s.open ? '●' : '○'} {s.label}{s.detail ? ` · ${s.detail}` : ''}
    </span>
  );
}

export function Facts({ r }: { r: Recommendation }) {
  const { query } = useApp();
  const tz = query.origin.timezone;
  return (
    <div className="facts">
      <span className="open">● Open until {r.availability.openUntil ? formatTime(r.availability.openUntil, tz) : '—'}</span>
      <WeatherChip w={r.weather} tz={tz} />
      <TravelChip t={r.travel} />
      <ParkingChip p={r.place.parking} mode={r.travel?.mode ?? 'drive'} />
      <span>💰 {r.place.costNote ?? priceLabel(r.place.priceLevel)}</span>
      <span>⏱️ {formatDurationRange(r.place.duration.min, r.place.duration.typical)}</span>
    </div>
  );
}

export function PlaceCard({ r, onMoreLikeThis }: { r: Recommendation; onMoreLikeThis?: (r: Recommendation) => void }) {
  const { day, addToDay, removeFromDay, openSheet, query } = useApp();
  const inDay = day.some((p) => p.id === r.place.id);
  const fitClass = r.fit === 'Great fit' ? '' : r.fit === 'Good fit' ? 'good' : 'worth';
  const tz = query.origin.timezone;
  return (
    <article className="card" aria-label={r.place.name}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h3>
            <button type="button" onClick={() => openSheet(r)} style={{ textAlign: 'left', font: 'inherit', textTransform: 'inherit' }}>
              {r.place.name}
            </button>
          </h3>
          <div className="cats">{r.place.categories.slice(0, 3).map(cap).join(' · ')}{r.place.neighborhood ? ` · ${r.place.neighborhood}` : ''}</div>
        </div>
        <span className={`fit ${fitClass}`}>{r.fit}</span>
      </div>
      <p className="pitch">{r.place.summary}</p>
      <Facts r={r} />
      <div className="why">
        <strong>Why DayOut likes it</strong>
        {r.reasons.length === 0 ? <p>Open, reachable and inside your window — that already puts it ahead of most of the city.</p> : null}
        {r.reasons.map((x) => <p key={x}>{x}</p>)}
        {r.cautions.map((x) => <p key={x} className="caution">{x}</p>)}
        <p className="muted small">Plan on {formatTime(r.arrive, tz)}–{formatTime(r.leave, tz)}.</p>
      </div>
      <div className="actions">
        {inDay ? (
          <button type="button" className="btn quiet" onClick={() => removeFromDay(r.place.id)}>✓ IN YOUR DAY</button>
        ) : (
          <button type="button" className="btn primary" onClick={() => addToDay(r.place)}>ADD TO DAY</button>
        )}
        {onMoreLikeThis ? <button type="button" className="btn" onClick={() => onMoreLikeThis(r)}>MORE LIKE THIS</button> : null}
      </div>
    </article>
  );
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Bottom sheet answering the nine questions every activity should answer. */
export function PlaceSheet() {
  const { sheet, openSheet, day, addToDay, removeFromDay, query, status } = useApp();
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openSheet(null);
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [sheet, openSheet]);
  if (!sheet) return null;
  const rec = 'place' in sheet ? (sheet as Recommendation) : null;
  const place = rec ? rec.place : (sheet as Place);
  const tz = place.timezone;
  const when = rec?.arrive ?? query.window.start;
  const inDay = day.some((p) => p.id === place.id);
  const today = wallClock(when, tz).date;
  return (
    <>
      <div className="sheet-backdrop" onClick={() => openSheet(null)} aria-hidden="true" />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={place.name}>
        <div className="grab" />
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <h2>{place.name}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => openSheet(null)}>✕</button>
        </div>
        <div className="cats">{place.categories.map(cap).join(' · ')}{place.neighborhood ? ` · ${place.neighborhood}` : ''}</div>
        <dl className="qa">
          <dt>What is it?</dt>
          <dd>{place.summary}</dd>
          {place.pitch ? (<><dt>Why should I care?</dt><dd>{place.pitch}</dd></>) : null}
          <dt>Is it open when I can go?</dt>
          <dd>
            <OpenChip place={place} at={when} /> <span className="muted small">· Hours {describeHours(place, today)}</span>
            {rec ? <div className="small muted">Planned {formatTime(rec.arrive, tz)}–{formatTime(rec.leave, tz)} · {rec.availability.reason}</div> : null}
          </dd>
          <dt>How much does it cost?</dt>
          <dd>{place.costNote ?? priceLabel(place.priceLevel)}{place.attributes.reservationRequired ? ' · Reservation required' : place.attributes.reservationRecommended ? ' · Reservation recommended' : ''}</dd>
          <dt>How long should I allow?</dt>
          <dd>{formatDurationRange(place.duration.min, place.duration.typical)}</dd>
          <dt>How do I get there?</dt>
          <dd>{rec?.travel ? <TravelChip t={rec.travel} /> : <span className="muted">Add it to your day to see the route from your last stop.</span>}{place.address ? <div className="small muted">{place.address}</div> : null}</dd>
          <dt>What is parking like?</dt>
          <dd>{place.parking ? <ParkingChip p={place.parking} /> : <span className="muted">No parking data{status.parking === 'unavailable' ? ' from the live provider' : ''} — we don’t guess.</span>}</dd>
          <dt>Current conditions</dt>
          <dd>{rec ? <WeatherChip w={rec.weather} tz={tz} /> : <span className="muted">Shown once it’s in your plan.</span>}</dd>
        </dl>
        <div className="row" style={{ marginTop: 18, gap: 8 }}>
          {inDay ? (
            <button type="button" className="btn quiet block" onClick={() => removeFromDay(place.id)}>REMOVE FROM DAY</button>
          ) : (
            <button type="button" className="btn primary block" onClick={() => { addToDay(place); openSheet(null); }}>ADD TO DAY</button>
          )}
          {place.url ? <a className="btn" href={place.url} target="_blank" rel="noreferrer">SITE ↗</a> : null}
        </div>
        {place.source === 'demo' ? <p className="small muted" style={{ marginTop: 12 }}>Demo data: hours, parking and conditions are simulated.</p> : null}
      </section>
    </>
  );
}

export function StopProblems({ s }: { s: ItineraryStop }) {
  return (
    <>
      {s.problems.map((p) => <div key={p} className="problem">⚠️ {p}</div>)}
      {s.warnings.map((w) => <div key={w} className="warning">{w}</div>)}
    </>
  );
}
