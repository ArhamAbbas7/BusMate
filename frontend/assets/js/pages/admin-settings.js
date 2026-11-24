import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { mountShell, pageHead } from '../shell.js';
import { $, copyText, html, money, onAction, pkgBadge, render, toast, toastError } from '../ui.js';

const me = await requireRole('admin');
const main = mountShell('admin', 'settings', me);
const fmtVal = (v) => (v === null ? 'Unlimited' : v === true ? html`<span class="row" style="gap:4px;color:var(--green-strong)">${icon('check', 14)} Included</span>` : v === false ? html`<span class="faint">Not included</span>` : String(v));
const LABELS = {
  max_routes: 'Active routes', max_admins: 'Admin accounts', max_conductors: 'Conductors', routes_per_subscriber: 'Routes per subscriber', trip_history_days: 'Trip history (days)',
  passenger_map: 'Passenger live map', auto_group_post: 'Automated group posting', eta_prediction: 'ETA prediction', custom_branding: 'Custom branding', api_access: 'API access', sla: 'Uptime SLA', support: 'Support',
};
const METHODS = [
  ['jazzcash', 'JazzCash', '#b0122c', 'wallet'],
  ['easypaisa', 'Easypaisa', '#12a150', 'wallet'],
  ['bank', 'Bank transfer', '#1e3a8a', 'landmark'],
];

async function load() {
  const [s, f] = await Promise.all([api('/admin/settings'), api('/admin/features')]);
  const pi = s.payment_instructions || {};
  const signup = `${location.origin}/join/?op=${s.slug}`;
  render(
    main,
    html`${pageHead('Settings', html`${s.name} · passengers pay ${money(s.passenger_price)} per 30 days`)}
    <div class="grid grid-main">
      <form class="card" id="pay">
        <div class="card-head"><div><h2>Payment accounts</h2><div class="card-sub">Shown to passengers on the signup page. Leave an account empty to hide that method.</div></div></div>
        ${METHODS.map(([key, title, color, ico], i) => html`<div style="${i ? 'border-top:1px solid var(--border);padding-top:18px;margin-top:4px' : ''}">
          <div class="row mb-2"><span class="pay-logo" style="background:${color};width:32px;height:32px;border-radius:9px">${icon(ico, 15)}</span><span class="strong">${title}</span></div>
          <div class="form-grid">
            ${key === 'bank' ? html`<div class="field" style="grid-column:1/-1"><label>Bank name</label><input name="bank.bank" value="${pi.bank?.bank || ''}"></div>` : ''}
            <div class="field"><label>${key === 'bank' ? 'IBAN / account number' : 'Account number'}</label><input name="${key}.account" value="${pi[key]?.account || ''}"></div>
            <div class="field"><label>Account title</label><input name="${key}.title" value="${pi[key]?.title || ''}"></div>
          </div></div>`)}
        <div class="divider"></div>
        <div class="field"><label>Note for passengers</label><textarea name="note" placeholder="e.g. Send the exact amount and keep your transaction ID.">${pi.note || ''}</textarea></div>
        <div class="form-grid">
          <div class="field"><label>Contact email</label><input name="contact_email" type="email" value="${s.contact_email || ''}"></div>
          <div class="field"><label>Contact phone</label><input name="contact_phone" value="${s.contact_phone || ''}"></div>
        </div>
        <button class="btn-primary">Save changes</button>
      </form>
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h2>Signup link</h2><div class="card-sub">Where passengers subscribe and pay.</div></div></div>
          <div class="copy-box"><code>${signup}</code><button class="btn-sm" data-action="copy" data-text="${signup}">${icon('copy', 13)} Copy</button></div>
          <a class="btn btn-sm btn-ghost mt-1" href="${signup}" target="_blank" rel="noopener">Preview page ${icon('arrow-up-right', 13)}</a>
        </div>
        <div class="card flush">
          <div class="card-head"><div><h2>Your plan</h2><div class="card-sub">Contact the platform team to change plans.</div></div>${pkgBadge(s.package)}</div>
          <div class="table-wrap mt-1"><table><tbody>${Object.entries(LABELS).map(([k, l]) => html`<tr><td class="muted">${l}</td><td class="text-right strong">${fmtVal(f.features[k])}${f.overridden.includes(k) ? html` <span class="badge plain amber">Custom</span>` : ''}</td></tr>`)}</tbody></table></div>
        </div>
      </div>
    </div>`,
  );

  $('#pay').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const get = (k) => String(fd.get(k) || '').trim();
    const body = {
      contact_email: get('contact_email'),
      contact_phone: get('contact_phone'),
      payment_instructions: {
        jazzcash: { account: get('jazzcash.account'), title: get('jazzcash.title') },
        easypaisa: { account: get('easypaisa.account'), title: get('easypaisa.title') },
        bank: { bank: get('bank.bank'), account: get('bank.account'), title: get('bank.title') },
        note: get('note'),
      },
    };
    const btn = e.target.querySelector('.btn-primary');
    btn.classList.add('busy');
    try { await api('/admin/settings', { method: 'PATCH', body }); toast('Settings saved'); } catch (err) { toastError(err); } finally { btn.classList.remove('busy'); }
  });
}

onAction(main, { copy: (el) => copyText(el.dataset.text) });
load().catch(toastError);
