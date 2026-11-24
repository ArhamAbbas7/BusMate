/* global L */
// Passenger live map (FR-P-09, FR-P-10). Opened from the link in the WhatsApp group.
import { api } from '../api.js';
import { icon } from '../icons.js';
import { busIcon, createMap, endpoints, routeLine, token } from '../map.js';
import { themeToggle } from '../theme.js';
import { $, html, liveBadge, poll, qs, render, routeChip, timeAgo } from '../ui.js';

const app = $('#app');
const tok = qs('t');
let dir = qs('dir') === 'backward' ? 'backward' : 'towards';
let map;
let bus;
let trail;
let routeLayer;
let ends = [];
let first = true;
let lastData;

render(app, html`<div id="livemap"></div><div class="live-bar"><div class="live-card" id="head"><div class="skeleton" style="min-height:52px"></div></div></div><div class="live-status"><div class="status-card" id="status"><div class="skeleton" style="min-height:42px;flex:1"></div></div></div>`);

function drawHead(d) {
  render(
    $('#head'),
    html`<div class="top">${routeChip(d.route.code)}<div style="min-width:0;flex:1"><div class="route-name">${d.route.name}</div><div class="op">${d.operator}</div></div>
      ${d.active ? liveBadge() : html`<span class="badge gray">Offline</span>`}<span id="theme-slot"></span></div>
    <div class="dir-toggle">
      <a href="?t=${encodeURIComponent(tok)}&dir=towards" class="${dir === 'towards' ? 'active' : ''}" data-dir="towards">${icon('arrow-right', 14)}${d.route.towards_label}</a>
      <a href="?t=${encodeURIComponent(tok)}&dir=backward" class="${dir === 'backward' ? 'active' : ''}" data-dir="backward">${icon('arrow-left', 14)}${d.route.backward_label}</a>
    </div>`,
  );
  themeToggle($('#theme-slot'));
}

function drawStatus(d) {
  const el = $('#status');
  if (d.active) {
    const stale = d.bus.secondsAgo > 90;
    el.className = 'status-card';
    render(el, html`<span class="ico-wrap">${icon('bus-front', 20)}</span><div><div class="big">${stale ? 'Weak signal · last known position' : 'Bus is on the move'}</div><div class="muted small">Updated ${timeAgo(d.bus.lastPingAt)} · started ${new Date(d.bus.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div></div><button class="btn-sm" id="center">${icon('crosshair', 14)} Find bus</button>`);
    $('#center').addEventListener('click', () => map.setView([d.bus.lat, d.bus.lng], 16));
  } else {
    el.className = 'status-card off';
    render(
      el,
      html`<span class="ico-wrap">${icon(d.started ? 'satellite' : 'clock', 20)}</span><div><div class="big">${d.started ? 'Bus is starting' : 'No active service right now'}</div><div class="muted small">${d.started ? 'Waiting for the first GPS position.' : d.otherDirectionLive ? 'A bus is live in the other direction.' : 'This page updates by itself when the bus starts.'}</div></div>`,
    );
  }
}

function drawRoute(d) {
  routeLayer?.remove();
  ends.forEach((x) => x.remove());
  const path = d.route.path || [];
  const directed = dir === 'backward' ? [...path].reverse() : path;
  routeLayer = directed.length ? routeLine(map, directed) : null;
  ends = directed.length ? endpoints(map, directed) : [];
}

function drawMap(d) {
  if (!map) map = createMap($('#livemap'), { center: [d.mapCenter.lat, d.mapCenter.lng], zoom: 13 });
  if (!routeLayer) drawRoute(d);
  trail?.remove();
  trail = d.trail.length > 1 ? L.polyline(d.trail, { color: token('--green'), weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(map) : null;
  if (d.active) {
    const ll = [d.bus.lat, d.bus.lng];
    const stale = d.bus.secondsAgo > 90;
    if (!bus) bus = L.marker(ll, { icon: busIcon(stale), zIndexOffset: 1000 }).addTo(map);
    else {
      bus.setLatLng(ll);
      bus.setIcon(busIcon(stale));
    }
  } else if (bus) {
    bus.remove();
    bus = null;
  }
  if (first) {
    first = false;
    if (d.active) map.setView([d.bus.lat, d.bus.lng], 15);
    else if (routeLayer) map.fitBounds(routeLayer.getBounds(), { padding: [40, 140] });
  }
}

async function refresh() {
  const d = await api(`/public/live/${encodeURIComponent(tok)}?dir=${dir}`, { as: 'none' });
  lastData = d;
  document.title = `${d.route.code} ${d.directionLabel} · Live`;
  drawHead(d);
  drawStatus(d);
  drawMap(d);
}

// Switch direction without reloading the page
app.addEventListener('click', (e) => {
  const a = e.target.closest('[data-dir]');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.dir === dir) return;
  dir = a.dataset.dir;
  history.replaceState(null, '', `?t=${encodeURIComponent(tok)}&dir=${dir}`);
  routeLayer?.remove();
  ends.forEach((x) => x.remove());
  routeLayer = null;
  ends = [];
  first = true;
  refresh().catch(showError);
});

// Redraw line colours when the theme changes
window.addEventListener('themechange', () => {
  if (!lastData || !map) return;
  drawRoute(lastData);
  drawMap(lastData);
});

function showError(e) {
  const el = $('#status');
  el.className = 'status-card off';
  render(el, html`<span class="ico-wrap">${icon('circle-alert', 20)}</span><div><div class="big">${e.status === 404 ? 'This live map link is not valid' : 'Connection problem'}</div><div class="muted small">${e.status === 404 ? 'Ask your bus service for the current link.' : 'Retrying automatically…'}</div></div>`);
}

if (!tok) showError({ status: 404 });
else poll(() => refresh().catch(showError), 10000);
// Keep "updated x ago" fresh between polls
setInterval(() => lastData && drawStatus({ ...lastData, bus: lastData.bus && { ...lastData.bus, secondsAgo: lastData.bus.lastPingAt ? (Date.now() - new Date(lastData.bus.lastPingAt)) / 1000 : 0 } }), 5000);
