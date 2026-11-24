import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { mountShell, pageHead } from '../shell.js';
import { $, badge, cohortBadge, confirmDialog, debounce, emptyState, fmtDate, formValues, html, initials, methodLabel, modal, onAction, phone, qs, render, routeChip, toast, toastError } from '../ui.js';

const me = await requireRole('admin');
const main = mountShell('admin', 'subscribers', me);
const f = { status: qs('status') || 'active', route: '', cohort: '', q: '' };
const routes = (await api('/admin/routes')).routes;
let rows = [];

render(
  main,
  html`${pageHead('Subscribers', 'Everyone subscribed to live tracking, by cohort and route.', html`<button class="btn-primary" data-action="add">${icon('user-plus', 15)} Add subscriber</button>`)}
  <div class="row between" style="align-items:flex-start">
    <div class="tabs" id="tabs">${['active', 'pending', 'expired', 'cancelled', 'rejected', 'all'].map((t) => html`<button data-action="tab" data-t="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`)}</div>
    <div class="toolbar">
      <div class="search">${icon('search', 15)}<input id="q" placeholder="Search name or number"></div>
      <select id="route"><option value="">All routes</option>${routes.map((r) => html`<option value="${r.id}">${r.code} · ${r.name}</option>`)}</select>
      <select id="cohort" style="min-width:130px"><option value="">Both cohorts</option><option value="A">Cohort A</option><option value="B">Cohort B</option></select>
    </div>
  </div>
  <div class="card flush"><div id="table"></div><div class="card-foot" id="count"></div></div>`,
);

async function load() {
  for (const t of $('#tabs').children) t.classList.toggle('active', t.dataset.t === f.status);
  const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  rows = await api(`/admin/subscriptions?${p}`);
  $('#count').textContent = `${rows.length} subscriber${rows.length === 1 ? '' : 's'}`;
  render(
    $('#table'),
    rows.length
      ? html`<div class="table-wrap"><table>
      <thead><tr><th>Subscriber</th><th>Route</th><th>Cohort</th><th>Status</th><th>Valid until</th><th>Payment</th><th></th></tr></thead>
      <tbody>${rows.map(
        (s) => html`<tr>
          <td><div class="row nowrap" style="gap:10px"><span class="avatar">${initials(s.subscriber_name)}</span><div><div class="strong">${s.subscriber_name}${s.source !== 'signup' ? html` <span class="badge plain gray">${s.source}</span>` : ''}</div><div class="sub tabular">${phone(s.subscriber_phone)}</div></div></div></td>
          <td>${routeChip(s.route_code, true)}</td>
          <td>${cohortBadge(s.cohort_code)}</td>
          <td>${badge(s.status)}${s.status === 'expired' && !s.removed_from_groups ? html`<div class="sub">Still in groups</div>` : ''}</td>
          <td class="nowrap">${fmtDate(s.subscription_expiry || s.cohort_end)}</td>
          <td class="small">${methodLabel(s.payment_method)}<div class="sub mono">${s.payment_ref || ''}</div></td>
          <td class="actions">${s.status === 'active'
            ? html`<button class="btn-sm" data-action="invite" data-id="${s.id}" title="Send the group links again">${icon('send', 13)} Resend</button><button class="btn-sm" data-action="switch" data-id="${s.id}">${icon('repeat', 13)} Move to ${s.cohort_code === 'A' ? 'B' : 'A'}</button><button class="btn-sm btn-icon btn-outline-danger" title="Remove" data-action="remove" data-id="${s.id}">${icon('trash-2', 13)}</button>`
            : s.status === 'pending' ? html`<a class="btn btn-sm" href="/admin/payments">Verify</a>` : ''}</td>
        </tr>`,
      )}</tbody></table></div>`
      : emptyState('users', 'No subscribers found', f.q || f.route || f.cohort ? 'Try clearing the filters.' : `There are no ${f.status === 'all' ? '' : f.status} subscribers yet.`),
  );
}

const find = (id) => rows.find((r) => r.id === id);
const groupList = (groups) => html`<ul class="list mt-1">${groups.map((g) => html`<li><span class="row">${cohortBadge(g.cohort)} <span class="small">${g.direction === 'towards' ? 'Forward' : 'Return'}</span></span><code class="small">${g.wa_group_id}</code></li>`)}</ul>`;

onAction(main, {
  tab(el) { f.status = el.dataset.t; load().catch(toastError); },
  async add() {
    const r = await modal({
      title: 'Add subscriber',
      description: 'Skips the signup window and payment check, e.g. for cash payments or complimentary access. The invite is sent immediately.',
      wide: true,
      submitLabel: 'Add & send invite',
      body: html`<div class="form-grid">
          <div class="field"><label>Name</label><input name="name" required></div>
          <div class="field"><label>WhatsApp number</label><input name="phone" required inputmode="tel" placeholder="0300 1234567"></div>
          <div class="field"><label>Route</label><select name="routeId" required>${routes.filter((x) => x.status === 'active').map((x) => html`<option value="${x.id}">${x.code} · ${x.name}</option>`)}</select></div>
          <div class="field"><label>Cohort</label><select name="cohort"><option value="">Automatic</option><option value="A">Cohort A</option><option value="B">Cohort B</option></select></div>
          <div class="field mb-0"><label>Payment</label><select name="paymentMethod"><option value="cash">Cash</option><option value="jazzcash">JazzCash</option><option value="easypaisa">Easypaisa</option><option value="bank">Bank transfer</option><option value="manual">Complimentary</option></select></div>
          <div class="field mb-0"><label>Reference <span class="muted" style="font-weight:400">(optional)</span></label><input name="paymentRef"></div>
        </div>`,
      onSubmit: (form) => {
        const v = formValues(form);
        if (!v.cohort) delete v.cohort;
        return api('/admin/subscriptions', { body: v });
      },
    });
    if (r) { toast('Subscriber added and invite sent'); load(); }
  },
  async invite(el) {
    try { const r = await api(`/admin/subscriptions/${el.dataset.id}/resend-invite`, { method: 'POST' }); toast(r.ok ? 'Invite sent' : r.skipped ? 'WhatsApp invites are switched off by the platform team' : `Failed: ${r.error}`, r.ok ? 'ok' : 'error'); } catch (e) { toastError(e); }
  },
  async switch(el) {
    const s = find(el.dataset.id);
    const to = s.cohort_code === 'A' ? 'B' : 'A';
    if (!(await confirmDialog(html`<b>${s.subscriber_name}</b> moves from cohort ${s.cohort_code} to cohort ${to}. Their expiry changes to cohort ${to}'s end date and they receive new group links.`, { title: `Move to cohort ${to}`, confirmLabel: `Move to ${to}`, danger: false }))) return;
    try {
      const r = await api(`/admin/subscriptions/${s.id}/switch-cohort`, { method: 'POST' });
      await modal({ title: 'Cohort changed', hideSubmit: true, cancelLabel: 'Done', body: html`<p>${s.subscriber_name} is now in cohort ${to}, valid until <b>${fmtDate(r.subscription.subscription_expiry)}</b>. New links were sent.</p><p class="mb-0">Remove <b class="tabular">${phone(s.subscriber_phone)}</b> from their previous groups:</p>${groupList(r.removeFromGroups)}` });
      load();
    } catch (e) { toastError(e); }
  },
  async remove(el) {
    const s = find(el.dataset.id);
    if (!(await confirmDialog(html`Remove <b>${s.subscriber_name}</b>'s subscription to ${s.route_code}? This can't be undone.`, { title: 'Remove subscriber', confirmLabel: 'Remove' }))) return;
    try {
      const r = await api(`/admin/subscriptions/${s.id}`, { method: 'DELETE' });
      await modal({ title: 'Subscriber removed', hideSubmit: true, cancelLabel: 'Done', body: html`<p class="mb-0">Now remove <b class="tabular">${phone(s.subscriber_phone)}</b> from these WhatsApp groups:</p>${groupList(r.removeFromGroups)}` });
      load();
    } catch (e) { toastError(e); }
  },
});

$('#q').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); load().catch(toastError); }));
$('#route').addEventListener('change', (e) => { f.route = e.target.value; load().catch(toastError); });
$('#cohort').addEventListener('change', (e) => { f.cohort = e.target.value; load().catch(toastError); });
load().catch(toastError);
