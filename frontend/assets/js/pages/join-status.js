// Passenger signup status page
import { api } from '../api.js';
import { icon } from '../icons.js';
import { themeToggle } from '../theme.js';
import { $, cohortBadge, fmtDate, fmtDateTime, html, logo, poll, qs, render } from '../ui.js';

const app = $('#app');
const id = qs('id');

function shell(body, opName = 'EV Bus Live') {
  render(app, html`<div class="public-wrap"><div class="public-head"><a class="brand" href="/">${logo(30)}<span>${opName}<small>Signup status</small></span></a><span id="theme-slot"></span></div>${body}</div>`);
  themeToggle($('#theme-slot'));
}

function view(d) {
  const confirmed = d.paymentStatus === 'confirmed' || d.paymentStatus === 'waived';
  const rejected = d.paymentStatus === 'rejected';
  const live = (dir) => `/live/?t=${encodeURIComponent(d.liveToken)}&dir=${dir}`;
  const first = d.name.split(' ')[0];
  shell(
    html`<h1 style="font-size:28px;letter-spacing:-0.035em">${confirmed ? `You're all set, ${first}` : rejected ? 'Payment not verified' : `Thanks, ${first}. We're checking your payment`}</h1>
      <p class="muted mt-1 mb-3 row">${d.route} · ${cohortBadge(d.cohort)}${confirmed ? html` · valid until ${fmtDate(d.expiry)}` : ''}</p>
      <div class="card" style="padding:24px">
        <ul class="timeline">
          <li class="done"><span class="tdot">${icon('check', 12)}</span><b>Signup received</b><div class="sub">${fmtDateTime(d.submittedAt)}</div></li>
          <li class="${confirmed ? 'done' : rejected ? 'failed' : 'current'}"><span class="tdot">${confirmed ? icon('check', 12) : rejected ? icon('x', 12) : ''}</span><b>${rejected ? 'Payment rejected' : 'Payment verified'}</b>
            <div class="sub">${confirmed ? 'Verified by the operator' : rejected ? d.rejectionReason : 'Usually within a few hours during the signup window'}</div></li>
          <li class="${confirmed ? 'done' : ''}"><span class="tdot">${confirmed ? icon('check', 12) : ''}</span><b>WhatsApp group links sent</b><div class="sub">${confirmed ? 'Check WhatsApp for your two group links, one for each direction.' : 'Sent automatically once your payment is verified'}</div></li>
        </ul>
        ${rejected ? html`<a class="btn btn-primary btn-lg btn-block mt-3" href="/join/?op=${encodeURIComponent(d.operatorSlug)}">Try again</a>` : ''}
      </div>
      ${confirmed && d.liveToken
        ? html`<div class="section-title">${icon('map-pin', 15)} Live map</div>
          <div class="grid grid-2"><a class="btn btn-primary btn-xl" href="${live('towards')}">${icon('arrow-right', 16)} ${d.towardsLabel}</a><a class="btn btn-xl" href="${live('backward')}">${icon('arrow-left', 16)} ${d.backwardLabel}</a></div>
          <p class="small muted mt-2">Bookmark these links. They're also pinned in your WhatsApp groups.</p>`
        : ''}
      ${!confirmed && !rejected ? html`<p class="small muted center mt-2 row" style="justify-content:center">${icon('loader-circle', 14)} This page updates automatically</p>` : ''}`,
    d.operator,
  );
  return confirmed || rejected;
}

const notFound = (msg = '') => shell(html`<div class="card"><h1>Signup not found</h1>${msg ? html`<p class="muted mt-1">${msg}</p>` : ''}<a class="btn mt-2" href="/join/">Sign up</a></div>`);

if (!id) notFound();
else {
  const stop = poll(async () => {
    try {
      const d = await api(`/public/subscriptions/${encodeURIComponent(id)}`, { as: 'none' });
      if (view(d)) stop();
    } catch (e) {
      notFound(e.message);
      stop();
    }
  }, 15000);
}
