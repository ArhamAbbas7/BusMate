import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { mountShell, pageHead } from '../shell.js';
import { $, badge, debounce, emptyState, fmtDateTime, html, phone, poll, render, timeAgo, toastError } from '../ui.js';

const me = await requireRole('developer');
const main = mountShell('developer', 'outbox', me);
const filters = { recipient: '', template: '' };

render(
  main,
  html`${pageHead('Message outbox', html`Every WhatsApp message the platform sends: invites, login codes and reminders. Messages you switched off in <a class="link" href="/dev/messages">Paid messages</a> show here as not sent. Refreshes every 5 seconds.`, html`<span id="chan"></span>`)}
  <div class="toolbar">
    <div class="search">${icon('search', 15)}<input id="f-to" placeholder="Filter by number, e.g. 0300…" inputmode="tel"></div>
    <select id="f-tpl"><option value="">All message types</option></select>
  </div>
  <div class="card flush"><div id="list"><div class="skeleton" style="margin:20px"></div></div></div>`,
);

let tplLoaded = false;
async function load() {
  const p = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const d = await api(`/dev/outbox?${p}`);
  render($('#chan'), d.channel === 'console' ? badge('simulated', 'Outbox mode') : badge('active', 'WhatsApp live'));
  if (!tplLoaded) {
    tplLoaded = true;
    const sel = $('#f-tpl');
    for (const t of d.templates) sel.add(new Option(`${t.template.replace(/_/g, ' ')} (${t.n})`, t.template));
  }
  render(
    $('#list'),
    d.rows.length
      ? d.rows.map((m) => {
          const otp = m.template === 'conductor_login_code' ? m.body.match(/^\d{6}/)?.[0] : null;
          return html`<div class="wa-item">
            <div class="wa-meta"><div class="to">${phone(m.recipient)}</div>
              <div>${m.template.replace(/_/g, ' ')}</div><div>${m.operator_name || 'Platform'}</div>
              <div title="${fmtDateTime(m.created_at)}">${timeAgo(m.created_at)}</div><div class="mt-1">${m.status === 'skipped' ? badge('skipped', 'Switched off') : badge(m.status)}</div></div>
            <div><div class="wa-bubble ${m.status === 'failed' ? 'failed' : m.status === 'skipped' ? 'skipped' : ''}">${m.body}</div>
              ${otp ? html`<div class="otp-chip">${icon('key-round', 15)}${otp}</div>` : ''}
              ${m.status === 'skipped' ? html`<div class="small muted mt-1">Not sent and not charged. <a class="link" href="/dev/messages">Paid messages</a></div>` : m.error ? html`<div class="error-text">${m.error}</div>` : ''}</div>
          </div>`;
        })
      : emptyState('inbox', 'No messages yet', 'Confirm a payment or request a conductor login code to see one here.'),
  );
}

$('#f-to').addEventListener('input', debounce((e) => { filters.recipient = e.target.value.trim(); load().catch(toastError); }, 300));
$('#f-tpl').addEventListener('change', (e) => { filters.template = e.target.value; load().catch(toastError); });
poll(() => load().catch(toastError), 5000);
