# DAYOUT

**What are we doing?**

DayOut is a mobile-first, constraint-aware day planner. Tell it where you are, when you're free, who's coming, what you're into and how you're getting around. It checks the clock, the weather, the drive and the opening hours, then finds things you can actually do.

Part of the same family as **PowNow** (ski), **TREAD** (outdoor routes) and **RIDEOUT** (riding destinations).

## The rules

1. **Never send someone to a closed business.** Only places confirmed open for the relevant part of the visit (`OPEN_CONFIRMED`) are ever recommended. `OPEN_LIKELY`, `UNKNOWN` and `CLOSED` are excluded, and the UI says how many were set aside.
2. **Never invent real-world information.** Missing weather, traffic or parking data is reported as unavailable, never guessed.
3. **Make the decision feel easy.** A handful of taps, FIND MY DAY, done.

## How it works

```
USER INPUT → DISCOVER → VERIFY EXISTS → VERIFY OPEN → VERIFY ACTIVITY → VERIFY ARRIVAL
→ VERIFY CONSTRAINTS → WEATHER → TRAFFIC → TRANSPORT → PARKING → SCORE → RANK → RECOMMEND
```

Availability is an eligibility gate, not a ranking factor. See `src/core/pipeline.ts`.

- `src/core/` — pure domain engine: hours & availability (`hours.ts`), feasibility pipeline, scoring with human explanations, itinerary builder with rework, quick modes and adjustments, share-link encoding. Fully unit-tested.
- `src/providers/` — provider interfaces (places, weather, routing, geocoding) and live clients that only ever talk to our own `/api` endpoints.
- `api/` — Vercel serverless functions. Keys live here, in environment variables, never in the browser.
- `src/demo/` — the Denver demonstration dataset (simulated hours, weather, traffic, parking), clearly labelled DEMO DATA in the UI.
- `src/ui/` — React PWA: Home, Results, Day (timeline + map), Shared Plan, detail sheet.

## Live data

| Need | Provider | Key required |
| --- | --- | --- |
| Places, existence, verified date-specific hours | Google Places API (New) | `GOOGLE_MAPS_API_KEY` |
| Routing with traffic, transit | Google Routes API | `GOOGLE_MAPS_API_KEY` |
| Routing without traffic (fallback) | OSRM public server | none |
| Weather, sunrise/sunset | Open-Meteo | none |
| Geocoding | Open-Meteo geocoding, Nominatim fallback | none |

Without `GOOGLE_MAPS_API_KEY` there is no source of *verified* hours, so DayOut runs the Denver demo and says so. Set the variable in the Vercel project (Production + Preview) and the Live mode switches on automatically; the key is only ever read server-side.

## Develop

```
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run build      # tsc + vite build (+ PWA service worker)
```

## Deploy

Pushes to `main` deploy to Vercel (project `dayout`). `vercel.json` rewrites every non-`/api` path to `index.html` for SPA routing.
