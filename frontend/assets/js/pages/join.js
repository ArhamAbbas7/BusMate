// Passenger signup (FR-P-01..07, FR-P-11)
import { api } from '../api.js';
import { icon } from '../icons.js';
import { themeToggle } from '../theme.js';
import { $, callout, copyText, fmtDate, html, logo, money, onAction, qs, render, routeChip, toastError } from '../ui.js';

const app = $('#app');
const slug = qs('op');
const PAY = {
  jazzcash: { name: 'JazzCash', color: '#b0122c', ico: 'wallet' },
  easypaisa: { name: 'Easypaisa', color: '#12a150', ico: 'wallet' },
  bank: { name: 'Bank transfer', color: '#1e3a8a', ico: 'landmark' },
};
const s = { op: null, routeId: null, method: null };

function header(sub = '') {
  return html`<div class="public-head"><a class="brand" href="/">${logo(30)}<span>${s.op?.name || 'EV Bus Live'}${sub ? html`<small>${sub}</small>` : ''}</span></a><span id="theme-slot"></span></div>`;
}
function mountHeaderToggle() {
  const slot = $('#theme-slot');
  if (slot) themeToggle(slot);
}

async function chooseOperator() {
  const ops = await api('/public/operators', { as: 'none' });
  render(
    app,
    html`<div class="public-wrap">${header()}
      <h1 style="font-size:28px;letter-spacing:-0.035em">Choose your bus service</h1>
      <p class="muted mt-1 mb-3">Get live bus location in WhatsApp. No app needed.</p>
      ${ops.length ? html`<div class="choice-grid">${ops.map((o) => html`<a class="choice" href="?op=${encodeURIComponent(o.slug)}"><span class="icon-tile">${icon('bus', 18)}</span><span class="title">${o.name}</span><span style="margin-left:auto" class="faint">${icon('chevron-right', 18)}</span></a>`)}</div>` : html`<div class="card"><p class="muted mb-0">No services are available yet.</p></div>`}
    </div>`,
  );
  mountHeaderToggle();
}

function routeChoices() {
  return html`<div class="choice-grid">${s.op.routes.map(
    (r) => html`<button type="button" class="choice ${s.routeId === r.id ? 'selected' : ''}" data-action="route" data-id="${r.id}">
      ${routeChip(r.code)}<span style="min-width:0"><span class="title">${r.name}</span><br><span class="sub muted">${r.towards_label} ⇄ ${r.backward_label}</span></span><span class="tick">${icon('check', 12)}</span></button>`,
  )}</div>`;
}

function payDetails() {
  const pi = s.op.paymentInstructions || {};
  const acct = pi[s.method];
  if (!acct?.account) return callout('warn', 'This payment method is not set up yet. Please choose another.');
  return html`<div class="card" style="background:var(--canvas);box-shadow:none;padding:16px">
    <div class="row between"><span class="muted small">Send exactly</span><span class="strong tabular" style="font-size:18px">${money(s.op.price)}</span></div>
    <div class="divider" style="margin:12px 0"></div>
    <dl class="kv small">
      ${s.method === 'bank' ? html`<dt>Bank</dt><dd>${acct.bank}</dd>` : ''}
      <dt>Account</dt><dd><code style="font-size:13px;color:var(--text)">${acct.account}</code><button type="button" class="btn-sm btn-ghost btn-icon" title="Copy account number" data-action="copy" data-text="${acct.account}">${icon('copy', 13)}</button></dd>
      <dt>Title</dt><dd>${acct.title}</dd>
    </dl>
    ${pi.note ? html`<p class="small muted mt-1 mb-0">${pi.note}</p>` : ''}
  </div>`;
}

function signupView() {
  const w = s.op.window;
  const methods = Object.keys(PAY).filter((k) => s.op.paymentInstructions?.[k]?.account);
  render(
    app,
    html`<div class="public-wrap">${header('Live tracking')}
      <span class="pill mb-2"><span class="tag">Open</span>Signups close ${fmtDate(w.open.signup_end)}${w.open.forced ? ' · test mode' : ''}</span>
      <h1 style="font-size:30px;letter-spacing:-0.04em;margin-top:14px">Know exactly where your bus is</h1>
      <p class="muted mt-1 mb-3">Live bus location in WhatsApp for <b style="color:var(--text)">${money(s.op.price)}</b> per 30 days. You'll join cohort ${w.open.code}, valid until ${fmtDate(w.open.end_date)}.</p>
      <form id="f" class="card" novalidate style="padding:24px">
        <div class="step"><div class="step-label"><span class="n">1</span>Your route</div>${routeChoices()}</div>
        <div class="step"><div class="step-label"><span class="n">2</span>Your details</div>
          <div class="field"><label for="name">Full name</label><input id="name" name="name" required autocomplete="name"></div>
          <div class="field mb-0"><label for="phone">WhatsApp number</label><input id="phone" name="phone" required inputmode="tel" autocomplete="tel" placeholder="0300 1234567"><div class="help">Your group invite links are sent to this number.</div></div></div>
        <div class="step"><div class="step-label"><span class="n">3</span>Payment</div>
          <div class="choice-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${methods.map((m) => html`<button type="button" class="choice ${s.method === m ? 'selected' : ''}" data-action="method" data-m="${m}"><span class="pay-logo" style="background:${PAY[m].color};width:32px;height:32px;border-radius:9px">${icon(PAY[m].ico, 15)}</span><span class="title">${PAY[m].name}</span></button>`)}</div>
          <div id="pay-details" class="mt-2">${s.method ? payDetails() : ''}</div>
          <div class="field mt-2"><label for="ref">Transaction ID</label><input id="ref" name="paymentRef" required placeholder="From your payment confirmation" autocomplete="off"></div>
          <div class="field mb-0"><label for="proof">Payment screenshot <span class="muted" style="font-weight:400">(recommended)</span></label><input id="proof" name="proof" type="file" accept="image/*,application/pdf"><div class="help">Helps the operator verify your payment faster.</div></div></div>
        <div class="error-text mt-2" id="err"></div>
        <button class="btn-primary btn-xl btn-block mt-3">Submit for verification</button>
        <p class="small muted center mt-2 mb-0">Once verified, you'll receive two WhatsApp group links (one per direction) and a live map link.</p>
      </form></div>`,
  );
  mountHeaderToggle();
  $('#f').addEventListener('submit', submit);
}

function closedView(nextOverride) {
  const n = nextOverride || s.op.window.next;
  render(
    app,
    html`<div class="public-wrap">${header('Live tracking')}
      <span class="pill mb-2"><span class="tag" style="background:var(--subtle);color:var(--muted)">Closed</span>Next signups open ${fmtDate(n.signup_start)}</span>
      <h1 style="font-size:30px;letter-spacing:-0.04em;margin-top:14px">Signups open twice a month</h1>
      <p class="muted mt-1 mb-3">Everyone starts on the same 30-day cycle. The next window runs <b style="color:var(--text)">${fmtDate(n.signup_start)} – ${fmtDate(n.signup_end)}</b>. Join the waitlist and we'll message you on WhatsApp the moment it opens.</p>
      <form id="w" class="card" style="padding:24px">
        <div class="step"><div class="step-label"><span class="n">1</span>Your route</div>${routeChoices()}</div>
        <div class="step"><div class="step-label"><span class="n">2</span>Your details</div>
          <div class="field"><label for="name">Full name</label><input id="name" name="name" required></div>
          <div class="field mb-0"><label for="phone">WhatsApp number</label><input id="phone" name="phone" required inputmode="tel" placeholder="0300 1234567"></div></div>
        <div class="error-text mt-2" id="err"></div>
        <button class="btn-primary btn-xl btn-block mt-3">${icon('bell', 17)} Notify me</button>
      </form></div>`,
  );
  mountHeaderToggle();
  $('#w').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('.btn-primary');
    $('#err').textContent = '';
    if (!s.routeId) return ($('#err').textContent = 'Choose your route.');
    btn.classList.add('busy');
    try {
      const r = await api(`/public/operators/${encodeURIComponent(slug)}/waitlist`, { body: { routeId: s.routeId, name: f.elements.namedItem('name').value, phone: f.elements.namedItem('phone').value }, as: 'none' });
      render(app, html`<div class="public-wrap">${header('Waitlist')}<div class="card center" style="padding:40px 24px"><div class="summary-ico" style="width:52px;height:52px;border-radius:14px;background:var(--primary);color:var(--on-primary);display:grid;place-items:center;margin:0 auto 16px">${icon('check', 24)}</div><h1>${r.alreadyWaiting ? "You're already on the list" : "You're on the list"}</h1><p class="muted mt-1 mb-0">We'll message you on WhatsApp when signups open on <b style="color:var(--text)">${fmtDate(r.nextWindow.signup_start)}</b>.</p></div></div>`);
      mountHeaderToggle();
    } catch (err) {
      $('#err').textContent = err.message;
      btn.classList.remove('busy');
    }
  });
}

async function submit(e) {
  e.preventDefault();
  const f = e.target;
  const err = $('#err');
  err.textContent = '';
  if (!s.routeId) return (err.textContent = 'Choose your route.');
  if (!s.method) return (err.textContent = 'Choose how you paid.');
  const fd = new FormData(f);
  fd.set('routeId', s.routeId);
  fd.set('paymentMethod', s.method);
  if (!fd.get('proof')?.size) fd.delete('proof');
  const btn = f.querySelector('.btn-primary');
  btn.classList.add('busy');
  try {
    const r = await api(`/public/operators/${encodeURIComponent(slug)}/signup`, { form: fd, as: 'none' });
    try {
      const mine = JSON.parse(localStorage.getItem('evbus.mySignups') || '[]');
      localStorage.setItem('evbus.mySignups', JSON.stringify([r.id, ...mine.filter((x) => x !== r.id)].slice(0, 10)));
    } catch { /* ignore */ }
    location.href = `/join/status?id=${r.id}`;
  } catch (e2) {
    if (e2.data?.windowClosed) return closedView(e2.data.nextWindow);
    err.textContent = e2.message;
    btn.classList.remove('busy');
  }
}

onAction(app, {
  route(el) {
    s.routeId = el.dataset.id;
    for (const b of app.querySelectorAll('[data-action=route]')) b.classList.toggle('selected', b.dataset.id === s.routeId);
  },
  method(el) {
    s.method = el.dataset.m;
    for (const b of app.querySelectorAll('[data-action=method]')) b.classList.toggle('selected', b.dataset.m === s.method);
    render($('#pay-details'), payDetails());
  },
  copy: (el) => copyText(el.dataset.text, 'Account number copied'),
});

async function boot() {
  if (!slug) return chooseOperator();
  try {
    s.op = await api(`/public/operators/${encodeURIComponent(slug)}`, { as: 'none' });
    document.title = `Sign up · ${s.op.name}`;
    if (!s.op.routes.length) {
      render(app, html`<div class="public-wrap">${header()}<div class="card"><p class="mb-0">No routes are available yet.</p></div></div>`);
      return mountHeaderToggle();
    }
    if (s.op.window.open) signupView();
    else closedView();
  } catch (e) {
    render(app, html`<div class="public-wrap">${header()}<div class="card"><h1>Service not found</h1><p class="muted mt-1">${e.message}</p><a class="btn" href="/join/">See all services</a></div></div>`);
    mountHeaderToggle();
  }
}
boot().catch(toastError);
