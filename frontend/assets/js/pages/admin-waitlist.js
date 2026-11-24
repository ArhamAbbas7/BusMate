import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { mountShell, pageHead } from '../shell.js';
import { badge, callout, confirmDialog, emptyState, fmtDate, fmtDateTime, html, initials, onAction, phone, render, routeChip, toast, toastError } from '../ui.js';

const me = await requireRole('admin');
const main = mountShell('admin', 'waitlist', me);

async function load() {
  const d = await api('/admin/waitlist');
  const waiting = d.entries.filter((e) => e.status === 'waiting').length;
  render(
    main,
    html`${pageHead('Waitlist', 'People who tried to sign up outside a signup window. They are messaged automatically when the next window opens.',
      d.window.open ? html`<button class="btn-primary" data-action="notify" ${waiting ? '' : 'disabled'}>${icon('send', 15)} Notify ${waiting} now</button>` : '')}
    <div class="mb-2">${d.window.open
      ? callout('ok', html`Signups are open for <b>cohort ${d.window.open.code}</b> until ${fmtDate(d.window.open.signup_end)}.`)
      : callout('info', html`Signups are closed. The next window (cohort ${d.window.next.code}) opens on <b>${fmtDate(d.window.next.signup_start)}</b>, and everyone waiting is notified automatically.`)}</div>
    <div class="card flush">${d.entries.length
      ? html`<div class="table-wrap"><table>
        <thead><tr><th>Person</th><th>Route</th><th>Joined</th><th>Status</th><th></th></tr></thead>
        <tbody>${d.entries.map(
          (e) => html`<tr><td><div class="row nowrap" style="gap:10px"><span class="avatar">${initials(e.name)}</span><div><div class="strong">${e.name}</div><div class="sub tabular">${phone(e.phone)}</div></div></div></td>
            <td><span class="row nowrap">${routeChip(e.route_code, true)}<span class="small">${e.route_name}</span></span></td>
            <td class="nowrap">${fmtDateTime(e.created_at)}</td><td>${badge(e.status)}${e.notified_at ? html`<div class="sub">${fmtDateTime(e.notified_at)}</div>` : ''}</td>
            <td class="actions"><button class="btn-sm btn-ghost btn-icon" title="Remove" data-action="remove" data-id="${e.id}">${icon('x', 14)}</button></td></tr>`,
        )}</tbody></table></div>`
      : emptyState('hourglass', 'Nobody is waiting', 'People who try to subscribe outside a window show up here.')}</div>`,
  );
}

onAction(main, {
  async notify(el) {
    el.classList.add('busy');
    try { const r = await api('/admin/waitlist/notify', { method: 'POST' }); toast(r.reason || `Notified ${r.notified} people`); load(); } catch (e) { toastError(e); el.classList.remove('busy'); }
  },
  async remove(el) {
    if (!(await confirmDialog('Remove this person from the waitlist?', { title: 'Remove from waitlist', confirmLabel: 'Remove' }))) return;
    try { await api(`/admin/waitlist/${el.dataset.id}`, { method: 'DELETE' }); load(); } catch (e) { toastError(e); }
  },
});

load().catch(toastError);
