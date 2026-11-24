import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { mountShell, pageHead } from '../shell.js';
import { $, badge, cohortBadge, emptyState, fmtDate, fmtDateTime, html, methodLabel, modal, money, onAction, phone, qs, render, routeChip, timeAgo, toast, toastError } from '../ui.js';

const me = await requireRole('admin');
const main = mountShell('admin', 'payments', me);
let tab = qs('status') || 'pending';
let rows = [];
const blobUrls = [];
const PAY_COLORS = { jazzcash: '#b0122c', easypaisa: '#12a150', bank: '#1e3a8a' };

render(
  main,
  html`${pageHead('Payments', 'Match each proof against your JazzCash, Easypaisa or bank statement. Confirming activates the subscription and sends the WhatsApp invite automatically.')}
  <div class="tabs" id="tabs">${['pending', 'confirmed', 'rejected', 'all'].map((t) => html`<button data-action="tab" data-t="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`)}</div>
  <div id="list"><div class="skeleton" style="min-height:220px"></div></div>`,
);

async function proofThumb(id) {
  try {
    const blob = await api(`/admin/payments/${id}/proof`, { blob: true });
    const url = URL.createObjectURL(blob);
    blobUrls.push(url);
    return { url, pdf: blob.type === 'application/pdf' };
  } catch {
    return null;
  }
}

async function load() {
  for (const t of $('#tabs').children) t.classList.toggle('active', t.dataset.t === tab);
  blobUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  rows = await api(`/admin/payments?status=${tab}`);
  if (!rows.length) {
    return render($('#list'), html`<div class="card">${tab === 'pending' ? emptyState('circle-check', "You're all caught up", 'No payments are waiting for verification.') : emptyState('receipt', 'Nothing here yet')}</div>`);
  }
  render(
    $('#list'),
    html`<div class="grid grid-2">${rows.map(
      (p) => html`<div class="card" id="p-${p.id}" style="display:flex;flex-direction:column">
        <div class="card-head"><div class="row nowrap" style="gap:12px"><span class="pay-logo" style="background:${PAY_COLORS[p.payment_method] || '#3f3f46'}">${icon(p.payment_method === 'bank' ? 'landmark' : 'wallet', 17)}</span>
          <div><h2>${p.subscriber_name}</h2><div class="card-sub tabular">${phone(p.subscriber_phone)}</div></div></div>${badge(p.payment_status)}</div>
        <div class="row nowrap" style="align-items:flex-start;gap:18px">
          <div class="proof" data-id="${p.id}" style="width:104px;flex-shrink:0">${p.has_proof ? html`<div class="skeleton" style="height:140px"></div>` : html`<div class="empty small" style="padding:26px 6px;border:1px dashed var(--border-strong);border-radius:10px">${icon('image', 18)}<div class="mt-1">No screenshot</div></div>`}</div>
          <dl class="kv small" style="flex:1">
            <dt>Route</dt><dd>${routeChip(p.route_code, true)} <span style="font-weight:400">${p.route_name}</span></dd>
            <dt>Cohort</dt><dd>${cohortBadge(p.cohort_code)} <span class="muted" style="font-weight:400">until ${fmtDate(p.cohort_end)}</span></dd>
            <dt>Method</dt><dd>${methodLabel(p.payment_method)}</dd>
            <dt>Reference</dt><dd><code>${p.payment_ref || '–'}</code></dd>
            <dt>Amount</dt><dd class="tabular">${money(p.amount)}</dd>
            <dt>Submitted</dt><dd title="${fmtDateTime(p.created_at)}">${timeAgo(p.created_at)}</dd>
            ${p.rejection_reason ? html`<dt>Reason</dt><dd style="color:var(--red-strong)">${p.rejection_reason}</dd>` : ''}
            ${p.confirmed_at ? html`<dt>${p.payment_status === 'rejected' ? 'Rejected' : 'Confirmed'}</dt><dd>${fmtDateTime(p.confirmed_at)}</dd>` : ''}
          </dl>
        </div>
        ${p.payment_status === 'pending' ? html`<div class="row" style="margin-top:auto;padding-top:18px"><button class="btn-primary" data-action="confirm" data-id="${p.id}">${icon('check', 15)} Confirm & send invite</button><button class="btn-ghost" data-action="reject" data-id="${p.id}">Reject</button></div>` : ''}
      </div>`,
    )}</div>`,
  );
  for (const p of rows.filter((x) => x.has_proof)) {
    proofThumb(p.id).then((t) => {
      const box = document.querySelector(`.proof[data-id="${p.id}"]`);
      if (!box) return;
      if (!t) return render(box, html`<div class="small error-text">Proof file missing</div>`);
      render(box, t.pdf
        ? html`<a class="btn btn-sm" href="${t.url}" target="_blank" rel="noopener">${icon('file-text', 14)} Open PDF</a>`
        : html`<img src="${t.url}" alt="Payment proof" data-action="zoom" data-src="${t.url}" style="width:104px;height:140px;object-fit:cover;object-position:top;border-radius:10px;border:1px solid var(--border);cursor:zoom-in;box-shadow:var(--shadow-xs)">`);
    });
  }
}

onAction(main, {
  tab(el) { tab = el.dataset.t; history.replaceState(null, '', `?status=${tab}`); load().catch(toastError); },
  zoom(el) { modal({ title: 'Payment proof', body: html`<img src="${el.dataset.src}" alt="Payment proof" style="width:100%;border-radius:10px;border:1px solid var(--border)">`, hideSubmit: true, cancelLabel: 'Close' }); },
  async confirm(el) {
    el.classList.add('busy');
    try {
      const r = await api(`/admin/payments/${el.dataset.id}/confirm`, { method: 'POST' });
      if (r.invite.skipped) toast('Confirmed. The WhatsApp invite is switched off, so share the group links with this passenger yourself.', 'ok', 6000);
      else toast(r.invite.ok ? `Confirmed. Invite ${r.invite.status === 'simulated' ? 'recorded in the outbox' : 'sent on WhatsApp'}.` : 'Confirmed, but the invite failed to send. Resend it from Subscribers.', r.invite.ok ? 'ok' : 'error');
      load();
    } catch (e) { toastError(e); el.classList.remove('busy'); }
  },
  async reject(el) {
    const p = rows.find((x) => x.id === el.dataset.id);
    const r = await modal({
      title: 'Reject payment',
      description: `${p.subscriber_name} receives this reason on WhatsApp with a link to try again.`,
      danger: true,
      submitLabel: 'Reject payment',
      body: html`<div class="field"><label>Reason</label><select name="preset" id="preset"><option>Transaction ID not found in our statement</option><option>Amount received is less than ${money(p.amount)}</option><option>Screenshot is unclear or does not match</option><option value="">Other…</option></select></div>
        <div class="field mb-0"><input name="reason" id="reason" placeholder="Write a reason" hidden></div>`,
      onSubmit: (form) => {
        const reason = form.preset.value || form.reason.value;
        return api(`/admin/payments/${p.id}/reject`, { body: { reason } });
      },
    });
    if (r) { toast('Payment rejected'); load(); }
  },
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'preset') {
    const other = !e.target.value;
    const r = document.getElementById('reason');
    r.hidden = !other;
    r.required = other;
    if (other) r.focus();
  }
});

load().catch(toastError);
