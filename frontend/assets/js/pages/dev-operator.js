import { api, requireRole, startImpersonation } from '../api.js';
import { icon } from '../icons.js';
import { backLink, mountShell, pageHead } from '../shell.js';
import { badge, callout, confirmDialog, copyText, fmtDateTime, formValues, html, initials, modal, money, onAction, pkgBadge, qs, render, timeAgo, toast, toastError } from '../ui.js';

const me = await requireRole('developer');
const main = mountShell('developer', 'operators', me);
const id = qs('id');

const fmtVal = (v) => (v === null ? 'Unlimited' : v === true ? 'On' : v === false ? 'Off' : String(v));

function valueInput(info, value, name = 'value') {
  if (info?.type === 'bool') return html`<select name="${name}"><option value="true" ${value === true ? 'selected' : ''}>On</option><option value="false" ${value === false ? 'selected' : ''}>Off</option></select>`;
  if (info?.type === 'limit') return html`<input name="${name}" type="number" min="0" placeholder="Empty = unlimited" value="${value ?? ''}">`;
  return html`<input name="${name}" value="${value ?? ''}">`;
}
function parseValue(info, rawVal) {
  if (info?.type === 'bool') return rawVal === 'true';
  if (info?.type === 'limit') return rawVal === '' ? null : Number(rawVal);
  return rawVal;
}

let data;
async function load() {
  data = await api(`/dev/operators/${id}`);
  const audit = await api(`/dev/audit?operator=${id}`);
  const o = data.operator;
  const f = data.features;
  const signup = `${location.origin}/join/?op=${o.slug}`;
  render(
    main,
    html`${pageHead(
      html`${o.name} ${badge(o.status)}`,
      html`/${o.slug} · created ${fmtDateTime(o.created_at)}`,
      html`<button data-action="imp">${icon('eye', 15)} View as admin</button>
           ${o.status === 'active' ? html`<button class="btn-outline-danger" data-action="status" data-s="suspended">${icon('power', 15)} Suspend</button>` : html`<button class="btn-primary" data-action="status" data-s="active">Reactivate</button>`}`,
      backLink('/dev/', 'Operators'),
    )}
    ${o.status === 'suspended' ? html`<div class="mb-2">${callout('danger', 'This operator is suspended. Admins and conductors cannot sign in, and passenger signup and live maps are offline.')}</div>` : ''}
    <div class="stats">
      <div class="stat"><div class="label">Plan</div><div class="value pkg">${o.package}</div><div class="hint">${money(o.package_price)} / month</div></div>
      <div class="stat"><div class="label">Routes</div><div class="value">${o.routes}<small>/ ${fmtVal(f.features.max_routes)}</small></div><div class="hint">${o.conductors} conductors</div></div>
      <div class="stat"><div class="label">Subscribers</div><div class="value">${o.active_subscribers}</div><div class="hint">${o.pending_payments} pending payments</div></div>
      <div class="stat"><div class="label">Trips · 7 days</div><div class="value">${o.trips_7d}</div><div class="hint">${o.live_trips} live now</div></div>
    </div>
    <div class="grid grid-2">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h2>Details</h2></div></div>
          <form id="details">
            <div class="form-grid">
              <div class="field"><label>Name</label><input name="name" value="${o.name}" required></div>
              <div class="field"><label>Slug</label><input name="slug" value="${o.slug}" required></div>
              <div class="field"><label>Contact email</label><input name="contact_email" type="email" value="${o.contact_email || ''}"></div>
              <div class="field"><label>Contact phone</label><input name="contact_phone" value="${o.contact_phone || ''}"></div>
              <div class="field"><label>Passenger price (Rs)</label><input name="passenger_price" type="number" min="0" value="${o.passenger_price}"></div>
            </div>
            <button class="btn-primary">Save details</button>
          </form>
          <div class="divider"></div>
          <label>Passenger signup link</label>
          <div class="copy-box"><code>${signup}</code><button class="btn-sm" data-action="copy" data-text="${signup}">${icon('copy', 13)} Copy</button></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h2>Plan</h2><div class="card-sub">Feature limits change immediately.</div></div>${pkgBadge(o.package)}</div>
          <div class="tabs mb-0">${['basic', 'premium', 'gold'].map((p) => html`<button class="${o.package === p ? 'active' : ''}" data-action="pkg" data-p="${p}" ${o.package === p ? 'disabled' : ''} style="${o.package === p ? 'opacity:1' : ''}">${p[0].toUpperCase() + p.slice(1)}</button>`)}</div>
        </div>
        <div class="card">
          <div class="card-head"><div><h2>Admin accounts</h2></div><button class="btn-sm" data-action="add-admin">${icon('user-plus', 13)} Add admin</button></div>
          <ul class="list">
            ${data.admins.map(
              (a) => html`<li><span class="row nowrap" style="gap:10px"><span class="avatar">${initials(a.name)}</span><span><span class="strong">${a.name}</span> ${a.status !== 'active' ? badge(a.status) : ''}<div class="sub">${a.email} · last sign-in ${timeAgo(a.last_login_at)}</div></span></span>
                <span class="row nowrap"><button class="btn-sm btn-ghost" data-action="pw" data-id="${a.id}">${icon('key-round', 13)} Reset password</button>
                ${a.status === 'active' ? html`<button class="btn-sm btn-ghost" data-action="admin-status" data-id="${a.id}" data-s="disabled">Disable</button>` : html`<button class="btn-sm" data-action="admin-status" data-id="${a.id}" data-s="active">Enable</button>`}</span></li>`,
            )}
          </ul>
        </div>
      </div>
      <div class="stack">
        <div class="card flush">
          <div class="card-head"><div><h2>Effective features</h2><div class="card-sub">Plan defaults merged with any overrides.</div></div><button class="btn-sm" data-action="add-override">${icon('plus', 13)} Override</button></div>
          <div class="table-wrap mt-1"><table>
            <tbody>${Object.entries(data.featureInfo).map(
              ([k, info]) => html`<tr><td>${info.label}${info.future ? html` <span class="badge plain gray">Future</span>` : ''}</td><td class="text-right strong">${fmtVal(f.features[k])}</td><td class="text-right" style="width:110px">${f.overridden.includes(k) ? html`<span class="badge plain amber">Override</span>` : html`<span class="sub pkg">${o.package}</span>`}</td></tr>`,
            )}</tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h2>Overrides</h2><div class="card-sub">One-off exceptions, e.g. a trial of a higher plan.</div></div></div>
          ${data.overrides.length
            ? html`<ul class="list">${data.overrides.map((v) => {
                const expired = v.expires_at && new Date(v.expires_at) < new Date();
                const state = v.revoked_at ? 'revoked' : expired ? 'expired' : 'active';
                return html`<li><span><span class="strong">${data.featureInfo[v.feature_key]?.label || v.feature_key}</span> → ${fmtVal(v.value)} ${badge(state)}
                  <div class="sub">${v.reason || 'No reason given'} · ${v.expires_at ? `expires ${fmtDateTime(v.expires_at)}` : 'no expiry'}</div></span>
                  ${state === 'active' ? html`<button class="btn-sm btn-ghost" data-action="revoke" data-id="${v.id}">Revoke</button>` : ''}</li>`;
              })}</ul>`
            : html`<p class="muted mb-0 small">No overrides. This operator uses its plan defaults.</p>`}
        </div>
        <div class="card">
          <div class="card-head"><div><h2>Recent activity</h2></div><a class="btn btn-sm btn-ghost" href="/dev/audit?operator=${id}">Audit log ${icon('arrow-right', 13)}</a></div>
          <ul class="list small">${audit.rows.slice(0, 10).map((a) => html`<li><span><code>${a.action}</code> <span class="muted">· ${a.actor_label || a.actor_role}</span></span><span class="muted nowrap">${timeAgo(a.created_at)}</span></li>`)}</ul>
        </div>
      </div>
    </div>`,
  );

  main.querySelector('#details').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(e.target);
    try {
      await api(`/dev/operators/${id}`, { method: 'PATCH', body: { ...v, passenger_price: Number(v.passenger_price) } });
      toast('Saved');
      load();
    } catch (err) { toastError(err); }
  });
}

onAction(main, {
  copy: (el) => copyText(el.dataset.text),
  async imp() {
    try { startImpersonation((await api(`/dev/operators/${id}/impersonate`, { method: 'POST' })).token); } catch (e) { toastError(e); }
  },
  async status(el) {
    const s = el.dataset.s;
    if (s === 'suspended' && !(await confirmDialog('All admins and conductors are signed out, live trips end, and passenger signup and maps go offline.', { title: `Suspend ${data.operator.name}?`, confirmLabel: 'Suspend operator' }))) return;
    try { await api(`/dev/operators/${id}/status`, { body: { status: s } }); toast(s === 'active' ? 'Operator reactivated' : 'Operator suspended'); load(); } catch (e) { toastError(e); }
  },
  async pkg(el) {
    if (!(await confirmDialog(html`Move <b>${data.operator.name}</b> to the <b>${el.dataset.p}</b> plan? Limits update immediately.`, { title: 'Change plan', confirmLabel: 'Change plan', danger: false }))) return;
    try {
      const r = await api(`/dev/operators/${id}/package`, { body: { package: el.dataset.p } });
      r.warnings.forEach((w) => toast(w, 'error', 7000));
      toast('Plan updated');
      load();
    } catch (e) { toastError(e); }
  },
  async 'add-admin'() {
    const r = await modal({
      title: 'Add admin',
      body: html`<div class="field"><label>Name</label><input name="name" required></div><div class="field"><label>Email</label><input name="email" type="email" required></div><div class="field mb-0"><label>Temporary password</label><input name="password" minlength="8" required></div>`,
      onSubmit: (form) => api(`/dev/operators/${id}/admins`, { body: formValues(form) }),
    });
    if (r) { toast('Admin added'); load(); }
  },
  async pw(el) {
    const r = await modal({
      title: 'Reset password',
      body: html`<div class="field mb-0"><label>New password</label><input name="password" minlength="8" required></div>`,
      onSubmit: (form) => api(`/dev/users/${el.dataset.id}/password`, { body: formValues(form) }),
    });
    if (r) toast('Password reset');
  },
  async 'admin-status'(el) {
    try { await api(`/dev/users/${el.dataset.id}/status`, { body: { status: el.dataset.s } }); load(); } catch (e) { toastError(e); }
  },
  async 'add-override'() {
    const info = data.featureInfo;
    const r = await modal({
      title: 'Add feature override',
      description: 'Overrides take priority over the plan until revoked or expired.',
      body: html`<div class="field"><label>Feature</label><select name="feature_key" id="ov-key">${Object.entries(info).map(([k, i]) => html`<option value="${k}">${i.label}</option>`)}</select></div>
        <div class="field" id="ov-val"><label>Value</label>${valueInput(info.max_routes, data.features.features.max_routes)}</div>
        <div class="field"><label>Reason</label><input name="reason" placeholder="e.g. 30-day Premium trial"></div>
        <div class="field mb-0"><label>Expires <span class="muted" style="font-weight:400">(optional)</span></label><input name="expires_at" type="date"></div>`,
      onSubmit: (form) => {
        const v = formValues(form);
        return api(`/dev/operators/${id}/overrides`, { body: { feature_key: v.feature_key, value: parseValue(info[v.feature_key], v.value), reason: v.reason, expires_at: v.expires_at || null } });
      },
    });
    if (r) { toast('Override added'); load(); }
  },
  async revoke(el) {
    if (!(await confirmDialog('The plan default applies again immediately.', { title: 'Revoke override', confirmLabel: 'Revoke' }))) return;
    try { await api(`/dev/overrides/${el.dataset.id}`, { method: 'DELETE' }); load(); } catch (e) { toastError(e); }
  },
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'ov-key') {
    const k = e.target.value;
    render(document.getElementById('ov-val'), html`<label>Value</label>${valueInput(data.featureInfo[k], data.features.features[k])}`);
  }
});

if (!id) location.href = '/dev/';
else load().catch(toastError);
