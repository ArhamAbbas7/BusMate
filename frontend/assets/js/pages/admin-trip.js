/* global L */
import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { busIcon, createMap, endpoints, fit, routeLine } from '../map.js';
import { backLink, mountShell, pageHead } from '../shell.js';
import { $, badge, cohortBadge, copyText, fmtDateTime, html, liveBadge, onAction, qs, render, routeChip, toastError } from '../ui.js';

const me = await requireRole('admin');
const main = mountShell('admin', 'trips', me);
const id = qs('id');
const d = await api(`/admin/trips/${id}`).catch((e) => { toastError(e); throw e; });
const t = d.trip;

render(
  main,
  html`${pageHead(html`${routeChip(t.route_code)} ${d.directionLabel} ${t.status === 'active' ? liveBadge() : badge(t.status)}`, html`${t.route_name} · ${t.conductor_name} · ${fmtDateTime(t.started_at)}`, '', backLink('/admin/trips', 'Trips'))}
  <div class="stats">
    <div class="stat"><div class="label">Duration</div><div class="value">${d.durationMinutes}<small>min</small></div></div>
    <div class="stat"><div class="label">Distance</div><div class="value">${d.distanceKm}<small>km</small></div></div>
    <div class="stat"><div class="label">GPS points</div><div class="value">${d.pingCount}</div></div>
    <div class="stat"><div class="label">Ended</div><div class="value" style="font-size:18px;margin-top:10px">${t.ended_at ? fmtDateTime(t.ended_at) : 'Still running'}</div>${t.end_reason ? html`<div class="hint">${t.end_reason === 'conductor' ? 'Stopped by conductor' : t.end_reason.replace(/_/g, ' ')}</div>` : ''}</div>
  </div>
  <div class="grid grid-main">
    <div class="card" style="padding:12px"><div id="map" class="map tall"></div>
      <div class="row small muted" style="padding:10px 6px 2px;gap:16px"><span class="row" style="gap:6px"><span style="width:18px;border-top:3px dashed #a1a1aa"></span>Planned route</span><span class="row" style="gap:6px"><span style="width:18px;border-top:3px solid #12a150"></span>Actual path</span></div></div>
    <div class="card">
      <div class="card-head"><div><h2>WhatsApp message</h2><div class="card-sub">Post in both groups for this direction. Cohort A and B ride the same bus.</div></div></div>
      <div class="msg-preview">${d.message.text}</div>
      <button class="btn-primary btn-block mt-2" data-action="copy">${icon('copy', 15)} Copy message</button>
      <div class="section-title">Groups</div>
      <ul class="list">${d.message.groups.map((g) => html`<li><span class="row">${cohortBadge(g.cohort)}<code class="small muted">${g.wa_group_id || 'ID not set'}</code></span>${g.invite_link ? html`<a class="btn btn-sm btn-ghost" href="${g.invite_link}" target="_blank" rel="noopener">Open ${icon('arrow-up-right', 13)}</a>` : ''}</li>`)}</ul>
    </div>
  </div>`,
);

const map = createMap($('#map'));
const planned = routeLine(map, t.direction === 'backward' ? [...(d.routePath || [])].reverse() : d.routePath, { color: '#a1a1aa', opacity: 0.9, weight: 3, dashArray: '6 8' });
const actual = d.path.length ? L.polyline(d.path, { color: '#12a150', weight: 5, lineCap: 'round', lineJoin: 'round' }).addTo(map) : null;
endpoints(map, d.path);
if (t.status === 'active' && t.last_lat != null) L.marker([t.last_lat, t.last_lng], { icon: busIcon() }).addTo(map);
fit(map, [actual, planned]);

onAction(main, { copy: () => copyText(d.message.text, 'Message copied. Paste it in WhatsApp.') });
