/* global L */
import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { createMap, endpoints, fit, token } from '../map.js';
import { backLink, mountShell, pageHead } from '../shell.js';
import { $, badge, cohortBadge, confirmDialog, copyText, html, onAction, qs, render, toast, toastError } from '../ui.js';

const me = await requireRole('admin');
const main = mountShell('admin', 'routes', me);
const id = qs('id');
const cfg = await api('/public/config', { as: 'none' });
const route = id
  ? await api(`/admin/routes/${id}`)
  : { code: '', name: '', towards_label: 'Towards', backward_label: 'Backward', path: [], groups: [], status: 'active', conductors: [] };
let path = [...(route.path || [])];

const g = (cohort, direction) => route.groups.find((x) => x.cohort === cohort && x.direction === direction) || {};
const liveUrl = (dir) => `${location.origin}/live/?t=${encodeURIComponent(route.live_token)}&dir=${dir}`;

render(
  main,
  html`${pageHead(id ? html`${route.code} ${badge(route.status)}` : 'New route', id ? route.name : 'Set up the route, its four WhatsApp groups and, optionally, its path on the map.', '', backLink('/admin/routes', 'Routes'))}
  <form id="route-form">
    <div class="grid grid-2">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h2>Details</h2><div class="card-sub">How the route appears to conductors and passengers.</div></div></div>
          <div class="form-grid">
            <div class="field"><label>Route code</label><input name="code" value="${route.code}" required placeholder="EV1" maxlength="20"></div>
            <div class="field"><label>Route name</label><input name="name" value="${route.name}" required placeholder="North Terminal – University Town"></div>
            <div class="field"><label>Forward direction</label><input name="towards_label" value="${route.towards_label}" required><div class="help">e.g. "Towards University"</div></div>
            <div class="field"><label>Return direction</label><input name="backward_label" value="${route.backward_label}" required><div class="help">e.g. "Towards North Terminal"</div></div>
          </div>
          ${id ? html`<div class="small muted row">${icon('id-card', 14)} ${route.conductors.length ? route.conductors.map((c) => c.name).join(', ') : 'No conductors assigned yet'}</div>` : ''}
        </div>
        <div class="card">
          <div class="card-head"><div><h2>WhatsApp groups</h2><div class="card-sub">Create four groups in WhatsApp, then paste each group's ID and invite link (Group info → Invite via link).</div></div></div>
          ${['A', 'B'].map(
            (cohort, i) => html`<div class="${i ? 'step' : ''}" style="${i ? 'margin-top:18px;padding-top:18px;border-top:1px solid var(--border)' : ''}">
              <div class="row between mb-1">${cohortBadge(cohort)}<span class="small muted">Signs up ${cohort === 'A' ? '1st–5th' : '15th–19th'}</span></div>
              ${['towards', 'backward'].map((dir) => {
                const grp = g(cohort, dir);
                return html`<div class="form-grid" style="grid-template-columns: minmax(0,1fr) minmax(0,1.5fr)">
                  <div class="field"><label>${dir === 'towards' ? 'Forward' : 'Return'} · group ID</label><input data-group="${cohort}:${dir}:wa_group_id" value="${grp.wa_group_id || ''}" required placeholder="1203630…@g.us"></div>
                  <div class="field"><label>Invite link</label><input data-group="${cohort}:${dir}:invite_link" value="${grp.invite_link || ''}" required type="url" placeholder="https://chat.whatsapp.com/…"></div>
                </div>`;
              })}</div>`,
          )}
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h2>Route path</h2><div class="card-sub">Click the map to trace the forward direction. Used for the passenger map and GPS simulation.</div></div><span class="badge mono plain" id="pt-count"></span></div>
          <div id="map" class="map"></div>
          <div class="row mt-1"><button type="button" class="btn-sm" data-action="undo">${icon('undo-2', 14)} Undo</button><button type="button" class="btn-sm" data-action="reverse">${icon('arrow-left-right', 14)} Reverse</button><span class="spacer"></span><button type="button" class="btn-sm btn-ghost" data-action="clear">${icon('trash-2', 14)} Clear</button></div>
        </div>
        ${id
          ? html`<div class="card">
            <div class="card-head"><div><h2>Live map links</h2><div class="card-sub">Pin these in the matching groups. Trip messages include them automatically.</div></div></div>
            <label>${route.towards_label}</label><div class="copy-box mb-2"><code>${liveUrl('towards')}</code><button type="button" class="btn-sm" data-action="copy" data-text="${liveUrl('towards')}">${icon('copy', 13)} Copy</button></div>
            <label>${route.backward_label}</label><div class="copy-box"><code>${liveUrl('backward')}</code><button type="button" class="btn-sm" data-action="copy" data-text="${liveUrl('backward')}">${icon('copy', 13)} Copy</button></div>
            <div class="divider"></div>
            <div class="row between"><span class="small muted">Links leaked? Issue new ones. The old links stop working.</span><button type="button" class="btn-sm btn-outline-danger" data-action="rotate">${icon('rotate-ccw', 13)} Regenerate</button></div>
          </div>`
          : ''}
      </div>
    </div>
    <div class="row mt-3"><button class="btn-primary btn-lg">${id ? 'Save changes' : 'Create route'}</button><a class="btn btn-lg btn-ghost" href="/admin/routes">Cancel</a></div>
  </form>`,
);

// ---- map editor
const map = createMap($('#map'), { center: [cfg.mapCenter.lat, cfg.mapCenter.lng] });
let line = null;
let marks = [];
function drawPath(refit = false) {
  line?.remove();
  marks.forEach((m) => m.remove());
  line = path.length ? L.polyline(path, { color: token('--map-line'), weight: 4, opacity: 0.8, lineCap: 'round', lineJoin: 'round' }).addTo(map) : null;
  marks = endpoints(map, path);
  $('#pt-count').textContent = `${path.length} point${path.length === 1 ? '' : 's'}`;
  if (refit) fit(map, [line], [cfg.mapCenter.lat, cfg.mapCenter.lng]);
}
map.on('click', (e) => {
  path.push([Math.round(e.latlng.lat * 1e6) / 1e6, Math.round(e.latlng.lng * 1e6) / 1e6]);
  drawPath();
});
drawPath(true);

onAction(main, {
  undo: () => { path.pop(); drawPath(); },
  reverse: () => { path.reverse(); drawPath(); },
  async clear() {
    if (path.length && (await confirmDialog('Remove every point from the route path?', { title: 'Clear path', confirmLabel: 'Clear path' }))) { path = []; drawPath(); }
  },
  copy: (el) => copyText(el.dataset.text, 'Link copied'),
  async rotate() {
    if (!(await confirmDialog('The links currently in your WhatsApp groups will stop working, so you will need to share the new ones.', { title: 'Regenerate live map links', confirmLabel: 'Regenerate' }))) return;
    try { await api(`/admin/routes/${id}/rotate-link`, { method: 'POST' }); toast('New links generated'); location.reload(); } catch (e) { toastError(e); }
  },
});

$('#route-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const groups = {};
  for (const inp of f.querySelectorAll('[data-group]')) {
    const [cohort, direction, key] = inp.dataset.group.split(':');
    groups[`${cohort}:${direction}`] ??= { cohort, direction };
    groups[`${cohort}:${direction}`][key] = inp.value.trim();
  }
  const el = f.elements;
  const body = {
    code: el.namedItem('code').value.trim(),
    name: el.namedItem('name').value.trim(),
    towards_label: el.namedItem('towards_label').value.trim(),
    backward_label: el.namedItem('backward_label').value.trim(),
    path,
    groups: Object.values(groups),
  };
  const btn = f.querySelector('.btn-primary');
  btn.classList.add('busy');
  try {
    const r = await api(id ? `/admin/routes/${id}` : '/admin/routes', { method: id ? 'PATCH' : 'POST', body });
    toast(id ? 'Route saved' : 'Route created');
    if (!id) location.href = `/admin/route?id=${r.id}`;
  } catch (err) {
    toastError(err);
  } finally {
    btn.classList.remove('busy');
  }
});
