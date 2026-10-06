import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { decodePlan } from '@/core/plan';
import { assessAvailability } from '@/core/hours';
import { formatTime, formatDate } from '@/core/time';
import { useApp } from './state';

/**
 * Read-only view of a shared plan. No account needed. Hours are re-checked
 * against the embedded place data; anything no longer open is flagged.
 */
export function SharedPlan() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const app = useApp();
  const plan = useMemo(() => decodePlan(params.get('d') ?? ''), [params]);
  if (!plan) {
    return (
      <div className="empty">
        <h2>THAT LINK DIDN’T WORK.</h2>
        <p>The plan may have been cut off when it was pasted.</p>
        <Link className="btn primary" to="/">OPEN DAYOUT</Link>
      </div>
    );
  }
  const tz = plan.origin.timezone;
  const slot = (plan.window.end - plan.window.start) / Math.max(1, plan.places.length);
  const stops = plan.places.map((p, i) => {
    const start = plan.window.start + i * slot;
    const end = Math.min(plan.window.end, start + p.duration.min * 60000);
    return { place: p, start, availability: assessAvailability(p, start, end) };
  });
  const changed = stops.filter((s) => s.availability.state !== 'OPEN_CONFIRMED');

  const open = () => {
    app.setQuery({
      ...app.query,
      origin: plan.origin,
      window: plan.window,
      interests: [...new Set(plan.places.flatMap((p) => p.categories))].slice(0, 4),
    });
    app.reorderDay(plan.places);
    nav('/day');
  };

  const replace = (placeId: string) => {
    const p = plan.places.find((x) => x.id === placeId);
    if (!p) return;
    app.setMode(plan.dataMode === 'live' ? 'live' : 'demo');
    app.setQuery({ ...app.query, origin: plan.origin, window: plan.window, interests: p.categories.slice(0, 3) });
    app.reorderDay(plan.places.filter((x) => x.id !== placeId));
    nav('/results');
    void app.find();
  };

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand"><span className="dot" />DAYOUT</Link>
      </header>
      <section className="plan-hero">
        <div className="eyebrow">DAYOUT · SHARED PLAN</div>
        <h1>{plan.title}</h1>
        <div className="muted">{formatDate(plan.window.start, tz)} · {formatTime(plan.window.start, tz)}–{formatTime(plan.window.end, tz)} · from {plan.origin.label}</div>
      </section>
      {changed.length > 0 ? (
        <section className="section">
          <div className="banner warn" role="alert">
            <span className="ico" aria-hidden="true">⚠️</span>
            <div>
              <strong>{changed.length === 1 ? 'This stop changed.' : `${changed.length} stops changed.`}</strong>
              <p>{changed.map((c) => c.place.name).join(', ')} {changed.length === 1 ? 'is' : 'are'} no longer confirmed open during the planned visit.</p>
            </div>
          </div>
        </section>
      ) : null}
      <ol className="plan-list">
        {stops.map((s) => (
          <li key={s.place.id}>
            <span className="t">{formatTime(s.start, tz)}</span>
            <div>
              <div className="n">{s.place.name}</div>
              <div className="small muted">{s.availability.state === 'OPEN_CONFIRMED' ? `Open until ${s.availability.openUntil ? formatTime(s.availability.openUntil, tz) : '—'}` : s.availability.reason}</div>
              {s.availability.state !== 'OPEN_CONFIRMED' ? <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => replace(s.place.id)}>FIND A REPLACEMENT</button> : null}
            </div>
          </li>
        ))}
      </ol>
      <section className="section">
        <p className="small muted">{plan.dataMode === 'demo' ? 'Built on the Denver demo dataset — hours are simulated.' : 'Hours were verified when this plan was shared and re-checked just now against the embedded data.'}</p>
        <button type="button" className="btn primary block" onClick={open}>OPEN IN DAYOUT</button>
        <p className="small muted" style={{ marginTop: 8 }}>Opens with these stops in your day so you can rework, reorder and re-share.</p>
      </section>
    </>
  );
}
