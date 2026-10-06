import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Itinerary, Origin, Recommendation } from '@/core/types';
import { formatDuration, formatTime } from '@/core/time';

function pin(label: string, cls = ''): L.DivIcon {
  return L.divIcon({ className: '', html: `<div class="pin ${cls}"><span>${label}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28] });
}

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0]!, 13);
    else map.fitBounds(L.latLngBounds(points), { padding: [28, 28] });
  }, [map, points]);
  return null;
}

export default function MapView({ origin, recommendations, itinerary }: { origin: Origin; recommendations: Recommendation[]; itinerary: Itinerary | null }) {
  const tz = origin.timezone;
  const planIds = new Set(itinerary?.stops.map((s) => s.place.id) ?? []);
  const route = useMemo<[number, number][]>(
    () => [[origin.point.lat, origin.point.lng], ...(itinerary?.stops.map((s) => [s.place.location.lat, s.place.location.lng] as [number, number]) ?? [])],
    [origin, itinerary],
  );
  const points = useMemo<[number, number][]>(
    () => [[origin.point.lat, origin.point.lng], ...recommendations.map((r) => [r.place.location.lat, r.place.location.lng] as [number, number]), ...route.slice(1)],
    [origin, recommendations, route],
  );
  return (
    <div className="map">
      <MapContainer center={[origin.point.lat, origin.point.lng]} zoom={12} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Fit points={points} />
        <Marker position={[origin.point.lat, origin.point.lng]} icon={pin('●', 'origin')}>
          <Popup>Start · {origin.label}</Popup>
        </Marker>
        {recommendations.filter((r) => !planIds.has(r.place.id)).map((r, i) => (
          <Marker key={r.place.id} position={[r.place.location.lat, r.place.location.lng]} icon={pin(String(i + 1))}>
            <Popup>
              <strong>{r.place.name}</strong><br />
              {r.travel ? `${formatDuration(r.travel.durationMin + (r.travel.trafficDelayMin ?? 0))} away · ` : ''}open until {r.availability.openUntil ? formatTime(r.availability.openUntil, tz) : '—'}
            </Popup>
          </Marker>
        ))}
        {itinerary?.stops.map((s, i) => (
          <Marker key={s.place.id} position={[s.place.location.lat, s.place.location.lng]} icon={pin(String(i + 1), 'plan')}>
            <Popup><strong>{formatTime(s.start, tz)}</strong> · {s.place.name}{s.travel ? <><br />{formatDuration(s.travel.durationMin + (s.travel.trafficDelayMin ?? 0))} from previous</> : null}</Popup>
          </Marker>
        ))}
        {route.length > 1 ? <Polyline positions={route} pathOptions={{ color: '#5ee0b0', weight: 4, opacity: 0.8, dashArray: '6 8' }} /> : null}
      </MapContainer>
    </div>
  );
}
