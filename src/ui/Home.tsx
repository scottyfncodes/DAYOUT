import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { INTERESTS, type Interest, type PriceLevel, type TransportMode, type Party } from '@/core/types';
import type { WhenPreset } from '@/core/adjust';
import { QUICK_MODES } from '@/core/adjust';
import { formatDate, formatTime, wallClock } from '@/core/time';
import { LiveGeocoder } from '@/providers/live';
import type { GeocodeResult } from '@/providers/types';
import { DENVER_TZ } from '@/demo/denver';
import { DEMO_SCENARIOS } from '@/demo/providers';
import { Chip, DataBadge } from './components';
import { useApp, DENVER_ORIGIN } from './state';

const DEMO_SPOTS: { label: string; lat: number; lng: number }[] = [
  { label: 'Downtown Denver', lat: 39.7392, lng: -104.9903 },
  { label: 'LoHi', lat: 39.7577, lng: -105.0085 },
  { label: 'RiNo', lat: 39.762, lng: -104.98 },
  { label: 'Cherry Creek', lat: 39.7174, lng: -104.9532 },
  { label: 'Golden', lat: 39.7555, lng: -105.2211 },
  { label: 'DIA (airport)', lat: 39.8561, lng: -104.6737 },
];

const WHEN: { label: string; preset: WhenPreset }[] = [
  { label: 'Right now', preset: { kind: 'now' } },
  { label: 'Tonight', preset: { kind: 'tonight' } },
  { label: 'Today', preset: { kind: 'today' } },
  { label: 'Tomorrow', preset: { kind: 'tomorrow' } },
  { label: 'Saturday', preset: { kind: 'weekday', weekday: 6 } },
  { label: 'Sunday', preset: { kind: 'weekday', weekday: 0 } },
  { label: 'We have 90 min', preset: { kind: 'hours', hours: 1.5 } },
  { label: 'We have 3 hours', preset: { kind: 'hours', hours: 3 } },
  { label: 'We have 6 hours', preset: { kind: 'hours', hours: 6 } },
];

const PARTY: { label: string; value: Party }[] = [
  { label: 'Just me', value: 'solo' },
  { label: 'Couple', value: 'couple' },
  { label: 'Friends', value: 'friends' },
  { label: 'Family', value: 'family' },
];

const TRANSPORT: { label: string; value: TransportMode }[] = [
  { label: '🚗 Drive', value: 'drive' },
  { label: '🚶 Walk', value: 'walk' },
  { label: '🚲 Bike', value: 'bike' },
  { label: '🚊 Transit', value: 'transit' },
  { label: '🚕 Rideshare', value: 'rideshare' },
  { label: "Don't care", value: 'any' },
];

function samePreset(a: WhenPreset, b: WhenPreset): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function Home() {
  const app = useApp();
  const nav = useNavigate();
  const { query, whenPreset, patchQuery, setWhen, toggleInterest, dataMode, liveConfig, setMode, demoScenario, setScenario, demoTraffic, setTraffic } = app;
  const tz = query.origin.timezone;
  const [where, setWhere] = useState(query.origin.label);
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [geoBusy, setGeoBusy] = useState(false);
  const debounce = useRef<number | undefined>(undefined);
  const isCustomRange = whenPreset.kind === 'range';

  useEffect(() => setWhere(query.origin.label), [query.origin.label]);

  const onWhere = (text: string) => {
    setWhere(text);
    window.clearTimeout(debounce.current);
    if (dataMode !== 'live' || text.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounce.current = window.setTimeout(async () => {
      try {
        setSuggestions(await new LiveGeocoder().search(text.trim()));
      } catch {
        setSuggestions([]);
      }
    }, 350);
  };

  const pick = (g: GeocodeResult) => {
    patchQuery({ origin: { label: g.label, point: g.point, timezone: g.timezone } });
    setSuggestions([]);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoBusy(false);
        const timezone = dataMode === 'live' ? Intl.DateTimeFormat().resolvedOptions().timeZone : DENVER_TZ;
        patchQuery({ origin: { label: 'My location', point: { lat: pos.coords.latitude, lng: pos.coords.longitude }, timezone } });
      },
      () => setGeoBusy(false),
      { timeout: 8000, maximumAge: 60000 },
    );
  };

  const go = async () => {
    nav('/results');
    await app.find();
  };

  const today = wallClock(Date.now(), tz).date;

  return (
    <>
      <header className="topbar">
        <span className="brand"><span className="dot" />DAYOUT</span>
        <DataBadge />
      </header>

      <section className="hero">
        <h1>WHAT ARE WE DOING?</h1>
        <p>Tell DayOut where, when and what you’re into. It checks the clock, the weather, the drive and the hours — then finds what actually makes sense.</p>
      </section>

      <section className="section">
        <h2 className="label">Quick modes</h2>
        <div className="chips scroll" role="list">
          {QUICK_MODES.map((m) => (
            <Chip key={m.id} className="mode" onClick={async () => { nav('/results'); await app.applyMode(m); }}>{m.label}</Chip>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="label">Where?</h2>
        <div className="field">
          <input
            className="input"
            value={where}
            onChange={(e) => onWhere(e.target.value)}
            placeholder={dataMode === 'live' ? 'Denver, Austin, Moab, “near Red Rocks”…' : 'Denver (demo)'}
            aria-label="Where"
            autoComplete="off"
            enterKeyHint="search"
          />
          <button type="button" className="icon-btn" aria-label="Use my location" onClick={useMyLocation} disabled={geoBusy} title="Use my location">
            {geoBusy ? '…' : '◎'}
          </button>
          {suggestions.length > 0 ? (
            <div className="suggest" role="listbox">
              {suggestions.map((s) => (
                <button type="button" key={`${s.point.lat},${s.point.lng}`} onClick={() => pick(s)} role="option" aria-selected={false}>
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {dataMode === 'demo' ? (
          <div className="chips scroll" style={{ marginTop: 10 }}>
            {DEMO_SPOTS.map((s) => (
              <Chip key={s.label} className="sm" on={query.origin.label === s.label} onClick={() => patchQuery({ origin: { label: s.label, point: { lat: s.lat, lng: s.lng }, timezone: DENVER_TZ } })}>
                {s.label}
              </Chip>
            ))}
          </div>
        ) : null}
      </section>

      <section className="section">
        <h2 className="label">When? <span>{formatDate(query.window.start, tz)} · {formatTime(query.window.start, tz)}–{formatTime(query.window.end, tz)}</span></h2>
        <div className="chips">
          {WHEN.map((w) => (
            <Chip key={w.label} on={samePreset(w.preset, whenPreset)} onClick={() => setWhen(w.preset)}>{w.label}</Chip>
          ))}
          <Chip on={isCustomRange} onClick={() => setWhen({ kind: 'range', date: today, startMin: 12 * 60, endMin: 18 * 60 })}>Custom</Chip>
        </div>
        {isCustomRange && whenPreset.kind === 'range' ? (
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <input className="input" type="date" value={whenPreset.date} aria-label="Date" onChange={(e) => setWhen({ ...whenPreset, date: e.target.value || today })} style={{ paddingRight: 12 }} />
            <input className="input" type="time" value={toHHMM(whenPreset.startMin)} aria-label="Start time" onChange={(e) => setWhen({ ...whenPreset, startMin: fromHHMM(e.target.value, whenPreset.startMin) })} style={{ paddingRight: 12 }} />
            <input className="input" type="time" value={toHHMM(whenPreset.endMin)} aria-label="End time" onChange={(e) => setWhen({ ...whenPreset, endMin: Math.max(fromHHMM(e.target.value, whenPreset.endMin), whenPreset.startMin + 30) })} style={{ paddingRight: 12 }} />
          </div>
        ) : null}
      </section>

      <section className="section">
        <h2 className="label">Who?</h2>
        <div className="chips">
          {PARTY.map((p) => (
            <Chip key={p.value} on={query.party === p.value} onClick={() => patchQuery({ party: p.value, partySize: p.value === 'solo' ? 1 : p.value === 'couple' ? 2 : Math.max(query.partySize, 3) })}>{p.label}</Chip>
          ))}
          <Chip on={query.withKids} onClick={() => patchQuery({ withKids: !query.withKids })}>👶 Kids</Chip>
          <Chip on={query.withDog} onClick={() => patchQuery({ withDog: !query.withDog })}>🐕 Dog</Chip>
        </div>
      </section>

      <section className="section">
        <h2 className="label">Budget</h2>
        <div className="chips">
          {([null, 0, 1, 2, 3, 4] as (PriceLevel | null)[]).map((b) => (
            <Chip key={String(b)} on={query.maxPrice === b} onClick={() => patchQuery({ maxPrice: b })}>
              {b === null ? 'Any' : b === 0 ? 'Free' : '$'.repeat(b)}
            </Chip>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="label">What are you into?</h2>
        <div className="chips">
          {INTERESTS.map((i: Interest) => (
            <Chip key={i} on={query.interests.includes(i)} onClick={() => toggleInterest(i)}>{cap(i)}</Chip>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="label">How do you want to get around?</h2>
        <div className="chips">
          {TRANSPORT.map((t) => (
            <Chip key={t.value} on={query.transport === t.value} onClick={() => patchQuery({ transport: t.value })}>{t.label}</Chip>
          ))}
        </div>

        <details className="more">
          <summary>More options</summary>
          <div className="chips" style={{ marginTop: 8 }}>
            <Chip on={query.constraints.setting === 'indoor'} onClick={() => patchQuery({ constraints: { ...query.constraints, setting: query.constraints.setting === 'indoor' ? undefined : 'indoor' } })}>Indoor</Chip>
            <Chip on={query.constraints.setting === 'outdoor'} onClick={() => patchQuery({ constraints: { ...query.constraints, setting: query.constraints.setting === 'outdoor' ? undefined : 'outdoor' } })}>Outdoor</Chip>
            {([
              ['dogFriendly', 'Dog-friendly'],
              ['kidFriendly', 'Kid-friendly'],
              ['accessible', 'Accessible'],
              ['noReservation', 'No reservation'],
              ['easyParking', 'Easy parking'],
              ['avoidTraffic', 'Avoid traffic'],
            ] as const).map(([k, label]) => (
              <Chip key={k} on={Boolean(query.constraints[k])} onClick={() => patchQuery({ constraints: { ...query.constraints, [k]: !query.constraints[k] || undefined } })}>{label}</Chip>
            ))}
          </div>
          <h2 className="label">Within</h2>
          <div className="chips">
            {[undefined, 2, 5, 10, 25, 50].map((m) => (
              <Chip key={String(m)} on={query.constraints.maxDistanceMiles === m} onClick={() => patchQuery({ constraints: { ...query.constraints, maxDistanceMiles: m } })}>{m ? `${m} mi` : 'Default'}</Chip>
            ))}
          </div>
        </details>

        <details className="more">
          <summary>Data &amp; demo controls</summary>
          <p className="small muted" style={{ margin: '4px 0 8px' }}>
            {liveConfig === undefined ? 'Checking live providers…' : liveConfig?.places ? 'Live places, hours, weather and routing are available on this deployment.' : 'No verified live places provider is configured, so DayOut runs the Denver demo. Weather and routing go live once a key is set server-side.'}
          </p>
          <div className="chips">
            <Chip on={dataMode === 'demo'} onClick={() => { setMode('demo'); patchQuery({ origin: DENVER_ORIGIN }); }}>Demo · Denver</Chip>
            <Chip on={dataMode === 'live'} disabled={!liveConfig?.places} onClick={() => setMode('live')} title={liveConfig?.places ? '' : 'Needs a server-side places provider'}>Live</Chip>
          </div>
          {dataMode === 'demo' ? (
            <>
              <h2 className="label">Simulated weather</h2>
              <div className="chips">
                {DEMO_SCENARIOS.map((s) => (
                  <Chip key={s.id} className="sm" on={demoScenario === s.id} onClick={() => setScenario(s.id)} title={s.blurb}>{s.label}</Chip>
                ))}
              </div>
              <h2 className="label">Simulated traffic</h2>
              <div className="chips">
                <Chip className="sm" on={demoTraffic === 'normal'} onClick={() => setTraffic('normal')}>Normal</Chip>
                <Chip className="sm" on={demoTraffic === 'heavy'} onClick={() => setTraffic('heavy')}>Heavy</Chip>
              </div>
            </>
          ) : null}
        </details>
      </section>

      <div className="cta-bar">
        <div className="inner">
          <button type="button" className="btn primary" onClick={go}>FIND MY DAY</button>
          {app.day.length > 0 ? <button type="button" className="btn" onClick={() => nav('/day')} style={{ flex: '0 0 auto' }}>YOUR DAY · {app.day.length}</button> : null}
        </div>
      </div>
    </>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function toHHMM(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}
function fromHHMM(v: string, fallback: number) {
  const [h, m] = v.split(':').map(Number);
  if (h === undefined || Number.isNaN(h)) return fallback;
  return h * 60 + (m ?? 0);
}
