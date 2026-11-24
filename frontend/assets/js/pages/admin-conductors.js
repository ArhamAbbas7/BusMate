import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { mountShell, pageHead } from '../shell.js';
import { badge, confirmDialog, emptyState, formValues, html, initials, liveBadge, modal, onAction, phone, render, routeChip, timeAgo, toast, toastError } from '../ui.js';

const me = await requireRole('admin');
const main = mountShell('admin', 'conductors', me);
let routes = [];
let conductors = [];

const routeChecks = (selected = []) =>
  routes.length
    ? html`<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">${routes.map(
        (r) => html`<label class="check-card"><input type="checkbox" name="routeIds" data-multi value="${r.id}" ${selected.includes(r.id) ? 'checked' : ''}>${routeChip(r.code, true)}<span class="small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.name}</span></label>`,
      )}</div>`
    : html`<p class="muted mb-0">No active routes yet.</p>`;

async function load() {
  [conductors, routes] = await Promise.all([api('/admin/conductors'), api('/admin/routes').then((r) => r.routes.filter((x) => x.status === 'active'))]);
  render(
    main,
    html`${pageHead('Conductors', 'Conductors sign in with their mobile number and a one-time code, and only see the routes you assign to them.', html`<button class="btn-primary" data-action="add">${icon('user-plus', 15)} Add conductor</button>`)}
    <div class="card flush">${conductors.length
      ? html`<div class="table-wrap"><table>
      <thead><tr><th>Conductor</th><th>Mobile</th><th>Status</th><th>Routes</th><th class="num">Trips</th><th>Last trip</th><th></th></tr></thead>
      <tbody>${conductors.map(
        (c) => html`<tr>
          <td><div class="row nowrap" style="gap:10px"><span class="avatar">${initials(c.name)}</span><div><div class="strong">${c.name} ${c.active_trip_id ? liveBadge('On trip') : ''}</div><div class="sub">Signed in ${timeAgo(c.last_login_at)}</div></div></div></td>
          <td class="nowrap tabular">${phone(c.phone)}</td>
          <td>${badge(c.status)}</td>
          <td><div class="row" style="gap:4px">${c.routes.length ? c.routes.map((r) => routeChip(r.code, true)) : html`<span class="sub">None</span>`}</div></td>
          <td class="num">${c.trip_count}</td><td class="nowrap">${timeAgo(c.last_trip_at)}</td>
          <td class="actions"><button class="btn-sm" data-action="assign" data-id="${c.id}">${icon('route', 13)} Routes</button><button class="btn-sm btn-icon" title="Edit" data-action="edit" data-id="${c.id}">${icon('pencil', 13)}</button>
            ${c.status === 'active' ? html`<button class="btn-sm btn-icon btn-outline-danger" title="Deactivate" data-action="status" data-id="${c.id}" data-s="inactive">${icon('power', 13)}</button>` : html`<button class="btn-sm" data-action="status" data-id="${c.id}" data-s="active">Activate</button>`}</td>
        </tr>`,
      )}</tbody></table></div>`
      : emptyState('id-card', 'No conductors yet', 'Add a conductor with their mobile number. They receive their login code there.', html`<button class="btn-primary" data-action="add">${icon('user-plus', 15)} Add conductor</button>`)}
      <div class="card-foot row between"><span>Conductor app</span><a class="link" href="/conductor/" target="_blank" rel="noopener">${location.host}/conductor ${icon('arrow-up-right', 13)}</a></div>
    </div>`,
  );
}

const find = (id) => conductors.find((c) => c.id === id);

onAction(main, {
  async add() {
    const r = await modal({
      title: 'Add conductor',
      description: 'They will sign in with this number and a one-time code.',
      wide: true,
      submitLabel: 'Add conductor',
      body: html`<div class="form-grid"><div class="field"><label>Full name</label><input name="name" required></div>
        <div class="field"><label>Mobile number</label><input name="phone" inputmode="tel" required placeholder="0300 1234567"></div></div>
        <div class="field mb-0"><label>Routes</label>${routeChecks()}</div>`,
      onSubmit: (form) => api('/admin/conductors', { body: formValues(form) }),
    });
    if (r) { toast('Conductor added'); load(); }
  },
  async edit(el) {
    const c = find(el.dataset.id);
    const r = await modal({
      title: 'Edit conductor',
      body: html`<div class="field"><label>Full name</label><input name="name" value="${c.name}" required></div><div class="field mb-0"><label>Mobile number</label><input name="phone" value="${phone(c.phone)}" required></div>`,
      onSubmit: (form) => api(`/admin/conductors/${c.id}`, { method: 'PATCH', body: formValues(form) }),
    });
    if (r) { toast('Saved'); load(); }
  },
  async assign(el) {
    const c = find(el.dataset.id);
    const r = await modal({
      title: `Routes for ${c.name}`,
      description: 'Conductors can only start trips on the routes selected here.',
      wide: true,
      body: routeChecks(c.routes.map((x) => x.id)),
      onSubmit: (form) => api(`/admin/conductors/${c.id}/routes`, { method: 'PUT', body: { routeIds: formValues(form).routeIds || [] } }),
    });
    if (r) { toast('Routes updated'); load(); }
  },
  async status(el) {
    const c = find(el.dataset.id);
    if (el.dataset.s === 'inactive' && !(await confirmDialog(html`<b>${c.name}</b> won't be able to sign in${c.active_trip_id ? ', and their live trip will end' : ''}.`, { title: 'Deactivate conductor', confirmLabel: 'Deactivate' }))) return;
    try { await api(`/admin/conductors/${c.id}/status`, { body: { status: el.dataset.s } }); load(); } catch (e) { toastError(e); }
  },
});

load().catch(toastError);
