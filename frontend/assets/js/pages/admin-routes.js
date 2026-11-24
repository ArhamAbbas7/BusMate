import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { mountShell, pageHead } from '../shell.js';
import { badge, callout, confirmDialog, copyText, emptyState, html, liveBadge, onAction, render, routeChip, toast, toastError } from '../ui.js';

const me = await requireRole('admin');
const main = mountShell('admin', 'routes', me);
const liveUrl = (token, dir) => `${location.origin}/live/?t=${encodeURIComponent(token)}&dir=${dir}`;

async function load() {
  const { routes, maxRoutes } = await api('/admin/routes');
  const active = routes.filter((r) => r.status === 'active').length;
  const atLimit = maxRoutes != null && active >= maxRoutes;
  const newBtn = atLimit ? html`<button class="btn-primary" disabled title="Plan limit reached">${icon('plus', 15)} New route</button>` : html`<a class="btn btn-primary" href="/admin/route">${icon('plus', 15)} New route</a>`;
  render(
    main,
    html`${pageHead('Routes', html`${active} of ${maxRoutes ?? 'unlimited'} active routes. Each route has four WhatsApp groups: cohort A and B, in both directions.`, newBtn)}
    ${atLimit ? html`<div class="mb-2">${callout('info', 'You have reached the route limit for your plan. Contact the platform team to upgrade.')}</div>` : ''}
    <div class="card flush">${routes.length
      ? html`<div class="table-wrap"><table>
        <thead><tr><th>Route</th><th>Status</th><th>WhatsApp groups</th><th class="num">Subscribers</th><th class="num">Conductors</th><th>Live map links</th><th></th></tr></thead>
        <tbody>${routes.map(
          (r) => html`<tr>
            <td><a href="/admin/route?id=${r.id}" class="row nowrap" style="gap:10px">${routeChip(r.code)}<span><span class="strong">${r.name}</span>${r.live_trips ? html` ${liveBadge()}` : ''}</span></a></td>
            <td>${badge(r.status)}</td>
            <td>${r.groups_ready === 4 ? badge('active', 'All 4 linked') : badge('pending', `${r.groups_ready} of 4 linked`)}</td>
            <td class="num">${r.active_subs}</td><td class="num">${r.conductor_count}</td>
            <td class="nowrap"><button class="btn-sm" data-action="copy" data-text="${liveUrl(r.live_token, 'towards')}" title="Copy link: ${r.towards_label}">${icon('link', 13)} ${r.towards_label}</button>
              <button class="btn-sm" data-action="copy" data-text="${liveUrl(r.live_token, 'backward')}" title="Copy link: ${r.backward_label}">${icon('link', 13)} ${r.backward_label}</button></td>
            <td class="actions"><a class="btn btn-sm" href="/admin/route?id=${r.id}">${icon('pencil', 13)} Edit</a>
              ${r.status === 'active' ? html`<button class="btn-sm btn-icon btn-outline-danger" title="Delete route" data-action="delete" data-id="${r.id}" data-code="${r.code}">${icon('trash-2', 14)}</button>` : html`<button class="btn-sm" data-action="reactivate" data-id="${r.id}">Reactivate</button>`}</td>
          </tr>`,
        )}</tbody></table></div>`
      : emptyState('route', 'No routes yet', 'Create your first route and paste the invite links of its four WhatsApp groups.', html`<a class="btn btn-primary" href="/admin/route">${icon('plus', 15)} New route</a>`)}
    </div>`,
  );
}

onAction(main, {
  copy: (el) => copyText(el.dataset.text, 'Live map link copied'),
  async delete(el) {
    if (!(await confirmDialog(html`Delete route <b>${el.dataset.code}</b>? Routes with trips or subscribers are archived instead, so their history stays intact.`, { title: 'Delete route', confirmLabel: 'Delete route' }))) return;
    try {
      const r = await api(`/admin/routes/${el.dataset.id}`, { method: 'DELETE' });
      toast(r.message || 'Route deleted');
      load();
    } catch (e) { toastError(e); }
  },
  async reactivate(el) {
    try { await api(`/admin/routes/${el.dataset.id}`, { method: 'PATCH', body: { status: 'active' } }); toast('Route reactivated'); load(); } catch (e) { toastError(e); }
  },
});

load().catch(toastError);
