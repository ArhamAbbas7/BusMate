import { api, requireRole, startImpersonation } from '../api.js';
import { icon } from '../icons.js';
import { mountShell, pageHead } from '../shell.js';
import { badge, callout, emptyState, formValues, html, initials, liveBadge, modal, money, num, onAction, pkgBadge, render, toast, toastError } from '../ui.js';

const me = await requireRole('developer');
const main = mountShell('developer', 'operators', me);

async function load() {
  const d = await api('/dev/operators');
  const t = d.totals;
  render(
    main,
    html`${pageHead('Operators', 'Every bus service on the platform. Each one is fully isolated from the others.', html`<button class="btn-primary" data-action="new">${icon('plus', 15)} New operator</button>`)}
    ${!me.totp_enabled ? html`<div class="mb-2">${callout('warn', html`Two-step verification is off for your developer account.`, html`<a class="btn btn-sm" href="/dev/settings">Turn on</a>`)}</div>` : ''}
    <div class="stats">
      <div class="stat"><div class="label">Operators</div><div class="value">${t.operators}</div><div class="hint">${t.active} active</div></div>
      <div class="stat"><div class="label">Plan revenue</div><div class="value">${money(t.mrr)}</div><div class="hint">Monthly, from active operators</div></div>
      <div class="stat"><div class="label">Active subscribers</div><div class="value">${num(t.subscribers)}</div><div class="hint">Across all operators</div></div>
      <div class="stat"><div class="label">Live trips</div><div class="value">${t.liveTrips}</div><div class="hint">Right now</div></div>
    </div>
    <div class="card flush">${d.operators.length
      ? html`<div class="table-wrap"><table>
        <thead><tr><th>Operator</th><th>Plan</th><th>Status</th><th class="num">Routes</th><th class="num">Conductors</th><th class="num">Subscribers</th><th class="num">Pending</th><th class="num">Trips · 7d</th><th class="num">Revenue · 30d</th><th></th></tr></thead>
        <tbody>${d.operators.map(
          (o) => html`<tr>
            <td><a href="/dev/operator?id=${o.id}" class="row nowrap" style="gap:10px"><span class="avatar dark">${initials(o.name)}</span><span><span class="strong">${o.name}</span><div class="sub">/${o.slug}</div></span></a></td>
            <td>${pkgBadge(o.package)}</td>
            <td>${o.live_trips ? liveBadge(`${o.live_trips} live`) : badge(o.status)}</td>
            <td class="num">${o.routes}</td><td class="num">${o.conductors}</td><td class="num">${o.active_subscribers}</td>
            <td class="num">${o.pending_payments || html`<span class="faint">0</span>`}</td><td class="num">${o.trips_7d}</td><td class="num">${money(o.passenger_revenue_30d)}</td>
            <td class="actions"><button class="btn-sm btn-ghost" data-action="imp" data-id="${o.id}" title="Open this operator's admin">${icon('eye', 13)} View as admin</button><a class="btn btn-sm" href="/dev/operator?id=${o.id}">Manage</a></td>
          </tr>`,
        )}</tbody></table></div>`
      : emptyState('building-2', 'No operators yet', 'Create the first bus service to get started.')}</div>`,
  );
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

onAction(main, {
  async imp(el) {
    try {
      const r = await api(`/dev/operators/${el.dataset.id}/impersonate`, { method: 'POST' });
      startImpersonation(r.token);
    } catch (e) { toastError(e); }
  },
  async new() {
    const r = await modal({
      title: 'New operator',
      description: 'Creates an isolated workspace and its first admin account.',
      wide: true,
      submitLabel: 'Create operator',
      body: html`<div class="form-grid">
        <div class="field"><label>Company name</label><input name="name" required placeholder="Metro EV Lines"></div>
        <div class="field"><label>Slug</label><input name="slug" required pattern="[a-z0-9-]+" placeholder="metro-ev-lines"><div class="help">Used in the passenger signup link.</div></div>
        <div class="field"><label>Plan</label><select name="package"><option value="basic">Basic · Rs 5,000/mo · 5 routes</option><option value="premium">Premium · Rs 15,000/mo · 20 routes</option><option value="gold">Gold · Rs 30,000/mo · unlimited</option></select></div>
        <div class="field"><label>Passenger price (Rs per 30 days)</label><input name="passenger_price" type="number" value="350" min="0"></div>
        <div class="field"><label>Contact email</label><input name="contact_email" type="email"></div>
        <div class="field"><label>Contact phone</label><input name="contact_phone"></div>
      </div>
      <div class="section-title" style="margin-top:8px">First admin</div>
      <div class="form-grid">
        <div class="field"><label>Name</label><input name="admin_name" required></div>
        <div class="field"><label>Email</label><input name="admin_email" type="email" required></div>
        <div class="field mb-0"><label>Temporary password</label><input name="admin_password" type="text" minlength="8" required><div class="help">At least 8 characters. Share it securely.</div></div>
      </div>`,
      onSubmit: async (form) => {
        const v = formValues(form);
        return api('/dev/operators', {
          body: {
            name: v.name, slug: v.slug, package: v.package, passenger_price: Number(v.passenger_price), contact_email: v.contact_email, contact_phone: v.contact_phone,
            admin: { name: v.admin_name, email: v.admin_email, password: v.admin_password },
          },
        });
      },
    });
    if (r) {
      toast('Operator created');
      location.href = `/dev/operator?id=${r.id}`;
    }
  },
});

// Auto-fill the slug from the name inside the "New operator" modal
document.addEventListener('input', (e) => {
  if (e.target.name === 'name' && e.target.closest('.modal')) {
    const slug = e.target.form.elements.slug;
    if (slug && !slug.dataset.touched) slug.value = slugify(e.target.value);
  }
  if (e.target.name === 'slug' && e.target.closest('.modal')) e.target.dataset.touched = '1';
});

load().catch(toastError);
