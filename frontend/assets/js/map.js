// Leaflet + OpenStreetMap helpers (no API key). Pages must include /vendor/leaflet/leaflet.js + .css.
// To switch to Google Maps later, replace this module only.
/* global L */
import { icon } from './icons.js';

const DEFAULT_CENTER = [31.5204, 74.3587];

export function createMap(el, { center, zoom = 13 } = {}) {
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(center || DEFAULT_CENTER, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  return map;
}

export function busIcon(stale = false) {
  return L.divIcon({ className: '', html: `<div class="bus-marker ${stale ? 'stale' : ''}">${icon('bus-front', 17)}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] });
}

/** Current value of a CSS colour token, so map lines follow light/dark mode. */
export const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function routeLine(map, path, opts = {}) {
  if (!path?.length) return null;
  return L.polyline(path, { color: token('--map-line'), weight: 4, opacity: 0.55, lineCap: 'round', lineJoin: 'round', ...opts }).addTo(map);
}

export function endpoints(map, path) {
  if (!path?.length) return [];
  const dot = (ll, label) => L.circleMarker(ll, { radius: 6, color: token('--map-line'), weight: 3, fillColor: token('--surface'), fillOpacity: 1 }).addTo(map).bindTooltip(label);
  return [dot(path[0], 'Start'), dot(path[path.length - 1], 'End')];
}

export function fit(map, layers, fallbackCenter) {
  const pts = [];
  for (const l of layers.filter(Boolean)) {
    if (l.getLatLngs) pts.push(...l.getLatLngs().flat(2));
    else if (l.getLatLng) pts.push(l.getLatLng());
  }
  if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
  else if (pts.length === 1) map.setView(pts[0], 15);
  else if (fallbackCenter) map.setView(fallbackCenter, 13);
}
