import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { reworkSuggestions, type ReworkSuggestion } from '@/core/itinerary';
import { encodePlan, makePlan } from '@/core/plan';
import { formatDuration, formatTime, formatDate } from '@/core/time';
import { statusLine } from '@/core/hours';
import { DataBadge, StopProblems, TravelChip, WeatherChip, cap } from './components';
import { useApp } from './state';

const MapView = lazy(() => import('./MapView'));

export function Day() {
  const app = useApp();
  const nav = useNavigate();
  const { day, itinerary, building, query, pool, dataMode } = app;
  const tz = query.origin.timezone;
  const [view, setView] = useState<'timeline' | 'map'>('timeline');
  const [shared, setShared] = useState<string | null>(null);
  const [rework, setRework] = useState<ReworkSuggestion[] | null>(null);

  const title = useMemo(() => `${formatDate(query.window.start, tz).toUpperCase()} · ${query.origin.label.split(',')[0]?.toUpperCase()}`, [query, tz]);

  const doRework = async () => {
    await app.rebuild();
    const it = app.itinerary;
    if (!it) return;
    const s = reworkSuggestions(it, pool, query);
    setRework(s);
  };

  const share = async () => {
    const plan = makePlan(query.origin, query.window, day, dataMode);
    const url = `${location.origin}/plan?d=${encodePlan(plan)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: plan.title, text: 'Our DayOut plan', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared('Link copied.');
    } catch {
      setShared(url);
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const next = [...day];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    app.reorderDay(next);
  };

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand"><span className="dot" />DAYOUT</Link>
        <div className="row">
          <DataBadge />
          <button type="button" className="icon-btn" aria-label="Back to results" onClick={() => nav('/results')}>←</button>
        </div>
      </header>

      <section className="section">
        <div className="small muted">{title}</div>
        <h2 className="headline">YOUR DAY</h2>

        {day.length === 0 ? (
          <div className="empty">
            <h2>NOTHING ADDED YET.</h2>
            <p>Tap ADD TO DAY on anything in your results and DayOut will lay the day out with travel, hours and buffers.</p>
            <Link className="btn primary" to="/results">BACK TO RESULTS</Link>
          </div>
        ) : (
          <>
            {itinerary && !itinerary.valid ? (
              <div className="banner danger" role="alert">
                <span className="ico" aria-hidden="true">⚠️</span>
                <div><strong>This day doesn’t work as-is.</strong><p>A stop is closed, unreachable or runs past your window. Tap REWORK MY DAY for swaps.</p></div>
              </div>
            ) : itinerary ? (
              <div className="banner" role="status">
                <span className="ico" aria-hidden="true">✅</span>
                <div><strong>Everything checks out.</strong><p>Every stop is confirmed open when you’d be there, with travel and buffers included.</p></div>
              </div>
            ) : null}

            {itinerary?.notes.map((n) => <p key={n} className="counts">{n}</p>)}

            <div className="tabs" role="tablist" style={{ marginTop: 14 }}>
              <button type="button" role="tab" aria-selected={view === 'timeline'} onClick={() => setView('timeline')}>TIMELINE</button>
              <button type="button" role="tab" aria-selected={view === 'map'} onClick={() => setView('map')}>MAP</button>
            </div>

            {view === 'map' ? (
              <div style={{ marginTop: 12 }}>
                <Suspense fallback={<div className="map" />}>
                  <MapView origin={query.origin} recommendations={[]} itinerary={itinerary} />
                </Suspense>
              </div>
            ) : (
              <div className="timeline" style={{ marginTop: 18 }} aria-busy={building}>
                {(itinerary?.stops ?? []).map((s, i) => {
                  const cls = s.problems.length ? 'bad' : s.warnings.length ? 'warn' : '';
                  return (
                    <div key={s.place.id}>
                      {s.travel || i === 0 ? <div className="leg"><TravelChip t={s.travel} /> {i === 0 ? 'from ' + query.origin.label : 'from previous stop'}</div> : null}
                      <div className={`stop ${cls}`}>
                        <div className="time">{formatTime(s.start, tz)}<small>{formatDuration((s.end - s.start) / 60000)}</small></div>
                        <article className="card compact">
                          <div className="row between" style={{ alignItems: 'flex-start' }}>
                            <div>
                              <h3 style={{ fontSize: 18 }}><button type="button" onClick={() => app.openSheet(s.place)} style={{ font: 'inherit', textAlign: 'left', textTransform: 'inherit' }}>{s.place.name}</button></h3>
                              <div className="cats">{s.place.categories.slice(0, 2).map(cap).join(' · ')} · until {formatTime(s.end, tz)}</div>
                            </div>
                            <div className="row" style={{ gap: 4 }}>
                              <button type="button" className="icon-btn" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                              <button type="button" className="icon-btn" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === day.length - 1}>↓</button>
                              <button type="button" className="icon-btn" aria-label="Remove" onClick={() => app.removeFromDay(s.place.id)}>✕</button>
                            </div>
                          </div>
                          <div className="facts">
                            <span className={s.availability.state === 'OPEN_CONFIRMED' ? 'open' : 'closed'}>{s.availability.state === 'OPEN_CONFIRMED' ? '● Confirmed open' : `○ ${statusLine(s.place, s.start).label}`}</span>
                            <WeatherChip w={s.weather} tz={tz} />
                          </div>
                          <StopProblems s={s} />
                        </article>
                      </div>
                    </div>
                  );
                })}
                {itinerary ? <p className="counts" style={{ marginLeft: -84 }}>Done by {formatTime(itinerary.endsAt, tz)} · your window ends {formatTime(query.window.end, tz)}.</p> : null}
              </div>
            )}

            {rework ? (
              <section style={{ marginTop: 16 }}>
                <h2 className="label">Rework</h2>
                {rework.length === 0 ? (
                  <div className="banner" role="status"><span className="ico" aria-hidden="true">👍</span><div><strong>Nothing needs changing.</strong><p>Every stop still works for its time slot.</p></div></div>
                ) : rework.map((r) => (
                  <div className="card compact" key={r.stop.place.id}>
                    <strong className="display" style={{ fontSize: 15 }}>{r.stop.place.name} — {formatTime(r.stop.start, tz)}</strong>
                    <p className="small" style={{ margin: '4px 0 8px' }}>{r.why} Swap it?</p>
                    <div className="chips">
                      {r.options.map((o) => (
                        <button type="button" key={o.place.id} className="chip" onClick={() => { app.replaceInDay(r.stop.place.id, o.place); setRework(null); }}>{o.place.name}</button>
                      ))}
                      {r.options.length === 0 ? <span className="muted small">No verified-open replacement in your results. Try FIND MY DAY again with a different time.</span> : null}
                      <button type="button" className="chip ghost" onClick={() => setRework(null)}>Keep original</button>
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            {shared ? <p className="counts">{shared}</p> : null}
            <div className="row wrap" style={{ marginTop: 16 }}>
              <button type="button" className="btn sm" onClick={share}>SAVE &amp; SHARE</button>
              <button type="button" className="btn sm" onClick={() => nav('/results')}>ADD MORE</button>
              <button type="button" className="btn sm danger" onClick={() => { if (confirm('Clear your day?')) app.clearDay(); }}>CLEAR</button>
            </div>
          </>
        )}
      </section>

      {day.length > 0 ? (
        <div className="cta-bar">
          <div className="inner">
            <button type="button" className="btn primary" onClick={doRework} disabled={building}>{building ? 'CHECKING…' : 'REWORK MY DAY'}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
