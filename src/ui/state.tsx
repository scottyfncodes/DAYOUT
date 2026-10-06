import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type { DataStatus, DayQuery, FindResult, Itinerary, Interest, Origin, Place, Recommendation, Tuning } from '@/core/types';
import { findMyDay } from '@/core/pipeline';
import { buildItinerary } from '@/core/itinerary';
import { resolveWindow, applyQuickMode, toggleTuning, type WhenPreset, type QuickMode } from '@/core/adjust';
import { DemoPlacesProvider, DemoRoutingProvider, DemoWeatherProvider, type DemoWeatherScenario } from '@/demo/providers';
import { DENVER_CENTER, DENVER_TZ } from '@/demo/denver';
import { fetchLiveConfig, LivePlacesProvider, LiveRoutingProvider, LiveWeatherProvider, type LiveConfig } from '@/providers/live';
import type { ProviderBundle } from '@/providers/types';

export type DataMode = 'demo' | 'live';

export interface AppState {
  query: DayQuery;
  whenPreset: WhenPreset;
  dataMode: DataMode;
  liveConfig: LiveConfig | null | undefined; // undefined = not fetched yet
  demoScenario: DemoWeatherScenario;
  demoTraffic: 'normal' | 'heavy';
  results: FindResult | null;
  searching: boolean;
  error: string | null;
  day: Place[];
  itinerary: Itinerary | null;
  building: boolean;
  /** place currently open in the detail sheet */
  sheet: Recommendation | Place | null;
  /** results pool for rework / more-like-this */
  pool: Recommendation[];
}

type Action =
  | { type: 'query'; query: DayQuery }
  | { type: 'when'; preset: WhenPreset }
  | { type: 'mode'; mode: DataMode }
  | { type: 'liveConfig'; config: LiveConfig | null }
  | { type: 'scenario'; scenario: DemoWeatherScenario }
  | { type: 'traffic'; traffic: 'normal' | 'heavy' }
  | { type: 'searching' }
  | { type: 'results'; results: FindResult }
  | { type: 'error'; error: string }
  | { type: 'day'; day: Place[] }
  | { type: 'building' }
  | { type: 'itinerary'; itinerary: Itinerary | null }
  | { type: 'sheet'; item: Recommendation | Place | null };

export const DENVER_ORIGIN: Origin = { label: 'Denver, CO', point: DENVER_CENTER, timezone: DENVER_TZ };

export function defaultQuery(now = Date.now()): DayQuery {
  return {
    origin: DENVER_ORIGIN,
    window: resolveWindow({ kind: 'now' }, now, DENVER_TZ),
    party: 'couple',
    partySize: 2,
    withKids: false,
    withDog: false,
    maxPrice: null,
    interests: [],
    transport: 'drive',
    constraints: {},
    tuning: {},
  };
}

const STORAGE_KEY = 'dayout.v1';

function load(): Partial<AppState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw) as { query?: DayQuery; whenPreset?: WhenPreset; day?: Place[]; dataMode?: DataMode; demoScenario?: DemoWeatherScenario };
    const out: Partial<AppState> = {};
    if (saved.query && saved.whenPreset) {
      out.whenPreset = saved.whenPreset;
      out.query = { ...saved.query, window: resolveWindow(saved.whenPreset, Date.now(), saved.query.origin.timezone) };
    }
    if (saved.day) out.day = saved.day;
    if (saved.dataMode) out.dataMode = saved.dataMode;
    if (saved.demoScenario) out.demoScenario = saved.demoScenario;
    return out;
  } catch {
    return {};
  }
}

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'query':
      return { ...s, query: a.query };
    case 'when':
      return { ...s, whenPreset: a.preset, query: { ...s.query, window: resolveWindow(a.preset, Date.now(), s.query.origin.timezone) } };
    case 'mode':
      return { ...s, dataMode: a.mode, results: null, pool: [] };
    case 'liveConfig':
      return { ...s, liveConfig: a.config };
    case 'scenario':
      return { ...s, demoScenario: a.scenario };
    case 'traffic':
      return { ...s, demoTraffic: a.traffic };
    case 'searching':
      return { ...s, searching: true, error: null };
    case 'results':
      return { ...s, searching: false, results: a.results, pool: a.results.recommendations };
    case 'error':
      return { ...s, searching: false, error: a.error };
    case 'day':
      return { ...s, day: a.day };
    case 'building':
      return { ...s, building: true };
    case 'itinerary':
      return { ...s, building: false, itinerary: a.itinerary };
    case 'sheet':
      return { ...s, sheet: a.item };
  }
}

interface Ctx extends AppState {
  providers: ProviderBundle;
  status: DataStatus;
  setQuery(q: DayQuery): void;
  patchQuery(p: Partial<DayQuery>): void;
  setWhen(p: WhenPreset): void;
  setMode(m: DataMode): void;
  setScenario(s: DemoWeatherScenario): void;
  setTraffic(t: 'normal' | 'heavy'): void;
  toggleInterest(i: Interest): void;
  find(): Promise<void>;
  applyMode(m: QuickMode): Promise<void>;
  tune(key: keyof Tuning, value?: number): Promise<void>;
  addToDay(p: Place): void;
  removeFromDay(id: string): void;
  replaceInDay(oldId: string, p: Place): void;
  clearDay(): void;
  reorderDay(order: Place[]): void;
  openSheet(item: Recommendation | Place | null): void;
  rebuild(): Promise<void>;
}

const AppContext = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const loaded = useMemo(load, []);
  const [state, dispatch] = useReducer(reducer, undefined, (): AppState => ({
    query: loaded.query ?? defaultQuery(),
    whenPreset: loaded.whenPreset ?? { kind: 'now' },
    dataMode: loaded.dataMode ?? 'demo',
    liveConfig: undefined,
    demoScenario: loaded.demoScenario ?? 'clear',
    demoTraffic: 'normal',
    results: null,
    searching: false,
    error: null,
    day: loaded.day ?? [],
    itinerary: null,
    building: false,
    sheet: null,
    pool: [],
  }));

  const demoRouting = useRef(new DemoRoutingProvider());
  const liveRouting = useRef<LiveRoutingProvider | null>(null);

  useEffect(() => {
    fetchLiveConfig().then((c) => dispatch({ type: 'liveConfig', config: c }));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ query: state.query, whenPreset: state.whenPreset, day: state.day, dataMode: state.dataMode, demoScenario: state.demoScenario }),
      );
    } catch {
      /* private mode etc. */
    }
  }, [state.query, state.whenPreset, state.day, state.dataMode, state.demoScenario]);

  const liveAvailable = Boolean(state.liveConfig?.places);
  const effectiveMode: DataMode = state.dataMode === 'live' && liveAvailable ? 'live' : 'demo';

  const providers = useMemo<ProviderBundle>(() => {
    if (effectiveMode === 'live' && state.liveConfig) {
      if (!liveRouting.current || liveRouting.current.id !== state.liveConfig.routing) liveRouting.current = new LiveRoutingProvider(state.liveConfig.routing);
      return { places: new LivePlacesProvider(), weather: new LiveWeatherProvider(), routing: liveRouting.current, mode: 'live' };
    }
    demoRouting.current.setTraffic(state.demoTraffic);
    return { places: new DemoPlacesProvider(), weather: new DemoWeatherProvider(state.demoScenario), routing: demoRouting.current, mode: 'demo' };
  }, [effectiveMode, state.liveConfig, state.demoScenario, state.demoTraffic]);

  const status = useMemo<DataStatus>(() => {
    if (effectiveMode === 'live') {
      return {
        places: 'live',
        weather: 'live',
        routing: 'live',
        traffic: state.liveConfig?.traffic ? 'live' : 'unavailable',
        parking: 'unavailable',
      };
    }
    return { places: 'demo', weather: 'demo', routing: 'demo', traffic: 'demo', parking: 'demo' };
  }, [effectiveMode, state.liveConfig]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const statusRef = useRef(status);
  statusRef.current = status;

  const runFind = useCallback(async (q: DayQuery) => {
    dispatch({ type: 'searching' });
    try {
      const results = await findMyDay(q, providersRef.current, statusRef.current);
      dispatch({ type: 'results', results });
    } catch (e) {
      dispatch({ type: 'error', error: e instanceof Error ? e.message : 'Something went wrong.' });
    }
  }, []);

  const rebuild = useCallback(async () => {
    const s = stateRef.current;
    if (s.day.length === 0) {
      dispatch({ type: 'itinerary', itinerary: null });
      return;
    }
    dispatch({ type: 'building' });
    const weather = s.results?.weather ?? (await providersRef.current.weather.forecast(s.query.origin.point, s.query.window).catch(() => null));
    const it = await buildItinerary(s.day, s.query, providersRef.current.routing, weather);
    dispatch({ type: 'itinerary', itinerary: it });
  }, []);

  // Rebuild the day whenever its inputs change.
  useEffect(() => {
    void rebuild();
  }, [state.day, state.query.window, state.query.transport, providers, rebuild]);

  const ctx: Ctx = {
    ...state,
    dataMode: effectiveMode,
    providers,
    status,
    setQuery: (query) => dispatch({ type: 'query', query }),
    patchQuery: (p) => dispatch({ type: 'query', query: { ...stateRef.current.query, ...p } }),
    setWhen: (preset) => dispatch({ type: 'when', preset }),
    setMode: (mode) => dispatch({ type: 'mode', mode }),
    setScenario: (scenario) => dispatch({ type: 'scenario', scenario }),
    setTraffic: (traffic) => dispatch({ type: 'traffic', traffic }),
    toggleInterest: (i) => {
      const q = stateRef.current.query;
      const interests = q.interests.includes(i) ? q.interests.filter((x) => x !== i) : [...q.interests, i];
      dispatch({ type: 'query', query: { ...q, interests } });
    },
    find: async () => {
      // Re-resolve relative windows ("right now") at the moment of searching.
      const s = stateRef.current;
      const window = resolveWindow(s.whenPreset, Date.now(), s.query.origin.timezone);
      const q = { ...s.query, window };
      dispatch({ type: 'query', query: q });
      await runFind(q);
    },
    applyMode: async (m) => {
      const s = stateRef.current;
      if (effectiveMode === 'demo' && m.id === 'rainy') dispatch({ type: 'scenario', scenario: 'rain-afternoon' });
      const q = applyQuickMode(s.query, m, Date.now());
      dispatch({ type: 'query', query: q });
      if (m.when) dispatch({ type: 'when', preset: m.when });
      // Let the provider bundle pick up a scenario change before searching.
      await new Promise((r) => setTimeout(r, 0));
      await runFind(q);
    },
    tune: async (key, value) => {
      const q = toggleTuning(stateRef.current.query, key, value);
      dispatch({ type: 'query', query: q });
      await runFind(q);
    },
    addToDay: (p) => {
      const d = stateRef.current.day;
      if (d.some((x) => x.id === p.id)) return;
      dispatch({ type: 'day', day: [...d, p] });
    },
    removeFromDay: (id) => dispatch({ type: 'day', day: stateRef.current.day.filter((p) => p.id !== id) }),
    replaceInDay: (oldId, p) => dispatch({ type: 'day', day: stateRef.current.day.map((x) => (x.id === oldId ? p : x)) }),
    clearDay: () => dispatch({ type: 'day', day: [] }),
    reorderDay: (order) => dispatch({ type: 'day', day: order }),
    openSheet: (item) => dispatch({ type: 'sheet', item }),
    rebuild,
  };

  return <AppContext.Provider value={ctx}>{children}</AppContext.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}
