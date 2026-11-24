import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { mountShell, pageHead } from '../shell.js';
import { $, badge, confirmDialog, duration, emptyState, fmtDateTime, fmtTime, html, liveBadge, onAction, poll, render, routeChip, timeAgo, toast, toastError } from '../ui.js';

const me = await requireRole('admin');
const main = mountShell('admin', 'trips', me);
const routes = (await api('/admin/routes')).routes;
const f = { route: '', status: '' };

render(
  main,
  html`${pageHead('Trips', 'Live trips refresh every 15 seconds. Open a trip to copy its WhatsApp message.')}
  <div class="card flush mb-2"><div class="card-head"><div><h2 class="row">${icon('radio', 16)} Live now</h2></div></div><div id="live"><div class="skeleton" style="margin:16px 20px"></div></div></div>
  <div class="card flush">
    <div class="card-head"><div><h2>History</h2><div class="card-sub" id="hist-note"></div></div>
      <div class="row"><select id="route" style="width:auto"><option value="">All routes</option>${routes.map((r) => html`<option value="${r.id}">${r.code}</option>`)}</select>
      <select id="status" style="width:auto"><option value="">All statuses</option><option value="completed">Completed</option><option value="auto_closed">Auto-closed</option><option value="active">Active</option></select></div></div>
    <div id="history" class="mt-1"></div>
  </div>`,
);

async function loadLive() {
  const live = await api('/admin/trips/live');
  render(
    $('#live'),
    live.length
      ? html`<div class="table-wrap"><table>
      <thead><tr><th>Route</th><th>Direction</th><th>Conductor</th><th>Running</th><th>Last GPS</th><th class="num">Pings</th><th></th></tr></thead>
      <tbody>${live.map((t) => {
        const age = t.last_ping_at ? (Date.now() - new Date(t.last_ping_at)) / 1000 : Infinity;
        return html`<tr><td>${routeChip(t.route_code)}</td><td>${t.direction_label}</td><td>${t.conductor_name}</td><td class="nowrap">${duration(t.started_at)} <span class="sub">since ${fmtTime(t.started_at)}</span></td>
          <td>${age > 120 ? badge('pending', `No signal · ${timeAgo(t.last_ping_at)}`) : liveBadge(timeAgo(t.last_ping_at))}</td><td class="num">${t.ping_count}</td>
          <td class="actions"><a class="btn btn-sm" href="/admin/trip?id=${t.id}">Open</a><button class="btn-sm btn-ghost" data-action="end" data-id="${t.id}">End trip</button></td></tr>`;
      })}</tbody></table></div>`
      : emptyState('bus-front', 'No buses are live right now', 'Trips appear here the moment a conductor taps Start.'),
  );
}

async function loadHistory() {
  const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const d = await api(`/admin/trips?${p}`);
  $('#hist-note').textContent = d.historyDays ? `Your plan keeps ${d.historyDays} days of trip history` : 'Unlimited trip history';
  render(
    $('#history'),
    d.trips.length
      ? html`<div class="table-wrap"><table>
      <thead><tr><th>Started</th><th>Route</th><th>Direction</th><th>Conductor</th><th>Duration</th><th class="num">Pings</th><th>Status</th><th></th></tr></thead>
      <tbody>${d.trips.map(
        (t) => html`<tr><td class="nowrap">${fmtDateTime(t.started_at)}</td><td>${routeChip(t.route_code, true)}</td><td>${t.direction_label}</td><td>${t.conductor_name}</td>
          <td class="tabular">${duration(t.started_at, t.ended_at)}</td><td class="num">${t.ping_count}</td><td>${t.status === 'active' ? liveBadge() : badge(t.status)}${t.end_reason && !['conductor'].includes(t.end_reason) ? html`<div class="sub">${t.end_reason.replace(/_/g, ' ')}</div>` : ''}</td>
          <td class="actions"><a class="btn btn-sm btn-ghost" href="/admin/trip?id=${t.id}">View ${icon('chevron-right', 13)}</a></td></tr>`,
      )}</tbody></table></div>`
      : emptyState('clock', 'No trips found', 'Try a different route or status.'),
  );
}

onAction(main, {
  async end(el) {
    if (!(await confirmDialog('Use this if the conductor forgot to tap Stop. Passengers will see the bus as offline.', { title: 'End trip', confirmLabel: 'End trip' }))) return;
    try { await api(`/admin/trips/${el.dataset.id}/end`, { method: 'POST' }); toast('Trip ended'); loadLive(); loadHistory(); } catch (e) { toastError(e); }
  },
});
$('#route').addEventListener('change', (e) => { f.route = e.target.value; loadHistory().catch(toastError); });
$('#status').addEventListener('change', (e) => { f.status = e.target.value; loadHistory().catch(toastError); });
poll(() => loadLive().catch(toastError), 15000);
loadHistory().catch(toastError);
