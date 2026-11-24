import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { mountShell, pageHead } from '../shell.js';
import { badge, callout, confirmDialog, html, money, num, onAction, render, toast, toastError } from '../ui.js';

const me = await requireRole('developer');
const main = mountShell('developer', 'messages', me);
let d;

const rs = (n) => (n > 0 && n < 100 ? `Rs ${n.toFixed(n < 10 ? 1 : 0)}` : money(Math.round(n)));

function row(t) {
  const { sent, skipped, failed } = t.last30;
  const meta = [
    `${num(sent)} sent`,
    skipped ? `${num(skipped)} not sent` : null,
    failed ? `${num(failed)} failed` : null,
    sent ? `≈ ${rs(sent * d.costPerMessage)}` : null,
  ].filter(Boolean).join(' · ');
  return html`<div class="setting-row">
    <div style="min-width:0">
      <div class="t row" style="gap:8px">${t.label}${t.essential ? badge('pending', 'Essential') : ''}${t.on !== t.recommended ? html`<span class="small muted">Recommended: ${t.recommended ? 'on' : 'off'}</span>` : ''}</div>
      <div class="d">${t.when}</div>
      <div class="small muted mt-1">Last 30 days: ${meta}</div>
    </div>
    <label class="switch" title="${t.on ? 'On' : 'Off'}"><input type="checkbox" data-key="${t.key}" ${t.on ? 'checked' : ''} aria-label="${t.label}"><span></span></label>
  </div>`;
}

async function load() {
  d = await api('/dev/messages');
  const on = d.types.filter((t) => t.on).length;
  const sent = d.types.reduce((s, t) => s + t.last30.sent, 0);
  const skipped = d.types.reduce((s, t) => s + t.last30.skipped, 0);
  const passengers = d.types.filter((t) => t.audience === 'passenger');
  const conductors = d.types.filter((t) => t.audience === 'conductor');
  render(
    main,
    html`${pageHead(
      'Paid messages',
      'Meta charges for every WhatsApp message the platform sends on its own. Switch off the ones you don’t need. A switched-off message is not sent or charged, and still shows in the Outbox as not sent.',
      html`<button class="btn-sm" data-action="preset" data-p="essential_only">${icon('bell-off', 14)} Essentials only</button><button class="btn-sm" data-action="preset" data-p="recommended">${icon('rotate-ccw', 14)} Recommended</button>`,
    )}
    <div class="stats" style="--cols:4">
      <div class="stat"><div class="label">Switched on</div><div class="value">${on}<span class="muted" style="font-size:16px"> / ${d.types.length}</span></div><div class="hint">message types</div></div>
      <div class="stat"><div class="label">Sent, last 30 days</div><div class="value">${num(sent)}</div><div class="hint">${d.channel === 'console' ? 'Outbox mode, nothing charged yet' : 'through WhatsApp'}</div></div>
      <div class="stat"><div class="label">Estimated cost</div><div class="value">${rs(sent * d.costPerMessage)}</div><div class="hint">at Rs ${d.costPerMessage} per message · <a class="link" href="/dev/settings">change</a></div></div>
      <div class="stat"><div class="label">Saved by switches</div><div class="value">${rs(skipped * d.costPerMessage)}</div><div class="hint">${num(skipped)} messages not sent</div></div>
    </div>
    ${d.channel === 'console' ? html`<div class="mb-2">${callout('info', html`WhatsApp isn’t connected yet, so messages only go to the <a href="/dev/outbox">Outbox</a> and cost nothing. These switches apply the same way once it’s live.`)}</div>` : ''}
    <div class="grid grid-main">
      <div class="card">
        <div class="card-head"><div><h2 class="row">${icon('users', 16)} Passenger messages</h2><div class="card-sub">Sent to one passenger at a time.</div></div></div>
        ${passengers.map(row)}
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h2 class="row">${icon('id-card', 16)} Conductors</h2><div class="card-sub">Fewer sign-ins means fewer paid login codes.</div></div></div>
          ${conductors.map(row)}
          <div class="setting-row">
            <div><div class="t">Keep conductors signed in</div><div class="d">${d.conductorStaySignedIn ? 'Conductors sign in once per phone and stay signed in until they tap Sign out or an admin deactivates them.' : 'Conductors are signed out after 7 days and need a new login code.'}</div></div>
            <label class="switch"><input type="checkbox" id="stay" ${d.conductorStaySignedIn ? 'checked' : ''} aria-label="Keep conductors signed in"><span></span></label>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><h2 class="row">${icon('piggy-bank', 16)} Always free</h2></div></div>
          <ul class="list small">
            <li><span>Trip updates in WhatsApp groups</span><span class="muted">posted by the conductor or admin</span></li>
            <li><span>Passenger live map</span><span class="muted">opened from a link</span></li>
            <li><span>Signup and status pages</span><span class="muted">on the website</span></li>
          </ul>
        </div>
      </div>
    </div>`,
  );
}

main.addEventListener('change', async (e) => {
  const input = e.target;
  if (input.id === 'stay') {
    try {
      await api('/dev/messages', { method: 'PUT', body: { conductorStaySignedIn: input.checked } });
      toast(input.checked ? 'Conductors now stay signed in' : 'Conductors are signed out after 7 days');
      load();
    } catch (err) { input.checked = !input.checked; toastError(err); }
    return;
  }
  const key = input.dataset.key;
  if (!key) return;
  const t = d.types.find((x) => x.key === key);
  if (!input.checked && t.essential) {
    const ok = await confirmDialog(t.offNote, { title: `Switch off “${t.label}”?`, confirmLabel: 'Switch off', danger: true });
    if (!ok) { input.checked = true; return; }
  }
  try {
    await api('/dev/messages', { method: 'PUT', body: { switches: { [key]: input.checked } } });
    toast(`${t.label}: ${input.checked ? 'on' : 'off'}`);
    load();
  } catch (err) { input.checked = !input.checked; toastError(err); }
});

onAction(main, {
  async preset(el) {
    const essentials = el.dataset.p === 'essential_only';
    if (essentials && !(await confirmDialog('Only the welcome invite and the conductor login code stay on. Every reminder and notice is switched off.', { title: 'Keep essentials only?', confirmLabel: 'Switch the rest off', danger: false }))) return;
    try {
      await api('/dev/messages', { method: 'PUT', body: { preset: el.dataset.p } });
      toast(essentials ? 'Only essential messages are on' : 'Recommended switches restored');
      load();
    } catch (e) { toastError(e); }
  },
});

load().catch(toastError);
