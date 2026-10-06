import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Recommendation, ExclusionReason } from '@/core/types';
import { ADJUSTMENTS } from '@/core/adjust';
import { moreLikeThis } from '@/core/pipeline';
import { weatherBanner } from '@/core/copy';
import { formatDate, formatTime } from '@/core/time';
import { Chip, DataBadge, PlaceCard } from './components';
import { useApp } from './state';
import { DEMO_DATASET_LABEL } from '@/demo/denver';

const MapView = lazy(() => import('./MapView'));

const REASON_LABEL: Record<ExclusionReason, string> = {
  closed: 'closed',
  opens_too_late: 'open too late',
  closes_before_arrival: 'closed before you could arrive',
  closes_during_visit: 'closing too soon',
  activity_unavailable: 'activity unavailable',
  unverified_hours: 'hours not verified',
  unknown_hours: 'hours unknown',
  too_far: 'too far',
  does_not_fit_window: "don't fit your window",
  budget: 'over budget',
  constraint: 'outside your filters',
  severe_weather: 'unsafe in this weather',
  no_route: 'no route',
};

export function Results() {
  const app = useApp();
  const nav = useNavigate();
  const { results, searching, error, query, pool, dataMode } = app;
  const [view, setView] = useState<'list' | 'map'>('list');
  const [similar, setSimilar] = useState<{ of: Recommendation; list: Recommendation[] } | null>(null);
  const tz = query.origin.timezone;
  const banner = results ? weatherBanner(query, results.weather) : null;

  // Landing here cold (reload, home-screen launch, shared link) should still produce a day.
  useEffect(() => {
    if (!results && !searching && !error) void app.find();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand"><span className="dot" />DAYOUT</Link>
        <div className="row">
          <DataBadge />
          <button type="button" className="icon-btn" aria-label="Edit search" onClick={() => nav('/')}>⚙︎</button>
        </div>
      </header>

      <section className="section">
        <div className="small muted">{query.origin.label} · {formatDate(query.window.start, tz)} · {formatTime(query.window.start, tz)}–{formatTime(query.window.end, tz)}</div>
        {searching ? (
          <>
            <h2 className="headline">CHECKING THE CLOCK, THE WEATHER AND THE DRIVE…</h2>
            <div className="stack"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
          </>
        ) : error ? (
          <div className="empty">
            <h2>SOMETHING BROKE.</h2>
            <p>{error}</p>
            <button type="button" className="btn primary" onClick={() => app.find()}>TRY AGAIN</button>
          </div>
        ) : !results ? (
          <div className="empty">
            <h2>NOTHING YET.</h2>
            <p>Set a few things on the home screen and tap FIND MY DAY.</p>
            <Link className="btn primary" to="/">START</Link>
          </div>
        ) : (
          <>
            <h2 className="headline">{results.headline}</h2>
            {banner ? (
              <div className="banner" role="status">
                <span className="ico" aria-hidden="true">{banner.icon}</span>
                <div><strong>{banner.title}</strong><p>{banner.body}</p></div>
              </div>
            ) : results.status.weather === 'unavailable' ? (
              <div className="banner warn" role="status">
                <span className="ico" aria-hidden="true">🌡️</span>
                <div><strong>Weather unavailable right now.</strong><p>Rankings ignore weather until it comes back. Hours and travel are still enforced.</p></div>
              </div>
            ) : null}
            {results.relaxed ? <p className="counts">Nothing fit perfectly. {results.relaxed}</p> : null}

            {results.recommendations.length > 0 ? (
              <>
                <h2 className="label" style={{ marginTop: 16 }}>Make it better</h2>
                <div className="chips scroll">
                  {ADJUSTMENTS.map((a) => (
                    <Chip key={a.key} className="mode" on={Boolean(query.tuning[a.key])} onClick={() => app.tune(a.key, a.value)}>{a.label}</Chip>
                  ))}
                </div>
                <div className="tabs" role="tablist" style={{ marginTop: 14 }}>
                  <button type="button" role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>RECOMMENDATIONS</button>
                  <button type="button" role="tab" aria-selected={view === 'map'} onClick={() => setView('map')}>MAP</button>
                </div>
              </>
            ) : null}

            {view === 'map' && results.recommendations.length > 0 ? (
              <div style={{ marginTop: 12 }}>
                <Suspense fallback={<div className="map" />}>
                  <MapView origin={query.origin} recommendations={results.recommendations} itinerary={app.itinerary} />
                </Suspense>
              </div>
            ) : null}

            {results.recommendations.length === 0 ? (
              <div className="empty">
                <h2>NOTHING VERIFIED OPEN</h2>
                <p>
                  {results.considered === 0 && dataMode === 'live'
                    ? "We couldn't reach a places provider for this area, so there's nothing we can confidently verify."
                    : "We couldn't confidently verify an open option matching your filters right now."}
                </p>
                <ExclusionSummary excluded={results.excluded} considered={results.considered} />
                <div className="chips" style={{ justifyContent: 'center', marginTop: 14 }}>
                  <Chip className="mode" onClick={() => { app.patchQuery({ constraints: { ...query.constraints, maxDistanceMiles: (query.constraints.maxDistanceMiles ?? 25) + 10 } }); void app.find(); }}>EXPAND DISTANCE</Chip>
                  <Chip className="mode" onClick={() => nav('/')}>CHANGE TIME</Chip>
                  <Chip className="mode" onClick={() => { app.patchQuery({ interests: [], constraints: {}, maxPrice: null, tuning: {} }); void app.find(); }}>TRY ANYTHING</Chip>
                  <Chip className="mode" onClick={() => { app.setWhen({ kind: 'tomorrow' }); void app.find(); }}>SHOW TOMORROW</Chip>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <h2 className="label">{results.recommendations.length} great fit{results.recommendations.length === 1 ? '' : 's'} — all confirmed open</h2>
                {similar ? (
                  <div className="card compact" style={{ marginBottom: 12 }}>
                    <div className="row between">
                      <strong className="display" style={{ fontSize: 13, letterSpacing: '0.1em' }}>MORE LIKE {similar.of.place.name.toUpperCase()}</strong>
                      <button type="button" className="chip sm" onClick={() => setSimilar(null)}>Close</button>
                    </div>
                    {similar.list.length === 0 ? <p className="muted small" style={{ margin: '8px 0 0' }}>Nothing else open in that lane right now.</p> : (
                      <div className="chips" style={{ marginTop: 8 }}>
                        {similar.list.map((r) => <Chip key={r.place.id} className="sm" onClick={() => app.openSheet(r)}>{r.place.name}</Chip>)}
                      </div>
                    )}
                  </div>
                ) : null}
                {results.recommendations.map((r) => (
                  <PlaceCard key={r.place.id} r={r} onMoreLikeThis={(of) => setSimilar({ of, list: moreLikeThis(of, pool) })} />
                ))}
                <ExclusionSummary excluded={results.excluded} considered={results.considered} />
              </div>
            )}
            <p className="small muted" style={{ marginTop: 16 }}>
              {dataMode === 'demo' ? DEMO_DATASET_LABEL : `Live data · places and hours from Google, weather from Open-Meteo, routing from ${app.liveConfig?.routing === 'google' ? 'Google' : 'OSRM (no traffic data)'}.`}
            </p>
          </>
        )}
      </section>

      <div className="cta-bar">
        <div className="inner">
          <button type="button" className="btn primary" onClick={() => nav('/day')} disabled={app.day.length === 0}>
            {app.day.length === 0 ? 'ADD STOPS TO BUILD YOUR DAY' : `BUILD MY DAY · ${app.day.length}`}
          </button>
        </div>
      </div>
    </>
  );
}

function ExclusionSummary({ excluded, considered }: { excluded: Partial<Record<ExclusionReason, number>>; considered: number }) {
  const parts = (Object.entries(excluded) as [ExclusionReason, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${REASON_LABEL[k]}`);
  if (considered === 0) return null;
  return (
    <p className="counts">
      We checked {considered} place{considered === 1 ? '' : 's'}{parts.length ? ` and set aside ${parts.join(', ')}` : ''}. Nothing unverified made the list.
    </p>
  );
}
