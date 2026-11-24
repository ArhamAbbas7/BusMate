import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { mountShell, pageHead } from '../shell.js';
import { badge, cohortBadge, confirmDialog, copyText, emptyState, fmtDate, fmtDateShort, html, onAction, phone, render, routeChip, callout, toast, toastError } from '../ui.js';

const me = await requireRole('admin');
const main = mountShell('admin', 'cohorts', me);
let preview;
let lastRun = null;

const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);

function calendarView(cal, today) {
  const first = `${cal[0].start_date.slice(0, 8)}01`;
  const lastEnd = cal.reduce((m, c) => (c.end_date > m ? c.end_date : m), cal[0].end_date);
  const start = ms(first);
  const end = ms(lastEnd) + 86400000;
  const pct = (iso, plusDay = 0) => ((ms(iso) + plusDay * 86400000 - start) / (end - start)) * 100;
  const months = [];
  for (let d = new Date(start); d.getTime() < end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const next = new Date(d);
    next.setUTCMonth(next.getUTCMonth() + 1);
    months.push({ label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }), w: ((Math.min(next.getTime(), end) - d.getTime()) / (end - start)) * 100 });
  }
  const lane = (code) =>
    cal.filter((c) => c.code === code).map((c) => {
      const left = pct(c.start_date);
      const width = pct(c.end_date, 1) - left;
      const win = ((ms(c.signup_end) + 86400000 - ms(c.signup_start)) / (ms(c.end_date) + 86400000 - ms(c.start_date))) * 100;
      const n = c.counts.active || 0;
      return html`<div class="cal-bar ${code} ${c.end_date < today ? 'past' : ''} ${c.isActive ? 'current' : ''}" style="left:calc(${left}% + 2px);width:calc(${width}% - 4px)" title="Cohort ${code}: ${fmtDate(c.start_date)} – ${fmtDate(c.end_date)} · signup ${fmtDateShort(c.signup_start)} – ${fmtDateShort(c.signup_end)}">
        <span class="win" style="width:${win}%"></span><span><b>${code}</b> · ${fmtDateShort(c.start_date)} – ${fmtDateShort(c.end_date)} · ${n} active${c.counts.pending ? `, ${c.counts.pending} pending` : ''}</span></div>`;
    });
  return html`<div class="cal"><div class="cal-inner" style="padding-top:26px">
    <div class="cal-months">${months.map((m) => html`<div style="flex:0 0 ${m.w}%">${m.label}</div>`)}</div>
    <div class="cal-lane">${lane('A')}</div>
    <div class="cal-lane">${lane('B')}</div>
    <div class="cal-today" style="left:${pct(today)}%"><span>Today</span></div>
  </div></div>
  <div class="row small muted mt-1" style="gap:16px"><span class="row" style="gap:6px"><span style="width:14px;height:10px;border-radius:3px;background:repeating-linear-gradient(135deg,rgba(10,10,11,.15) 0 3px,transparent 3px 6px);border:1px solid var(--border-strong)"></span>Signup window</span><span>Each cohort has its own pair of WhatsApp groups per route.</span></div>`;
}

function removalCards(groups) {
  return html`<div class="grid grid-2">${groups.map(
    (g) => html`<div class="card" style="box-shadow:none;padding:16px">
      <div class="card-head" style="margin-bottom:10px"><div class="row">${routeChip(g.route_code, true)}<span class="strong">${g.direction_label}</span>${cohortBadge(g.cohort)}</div>
      <button class="btn-sm" data-action="copy-phones" data-phones="${g.members.map((m) => phone(m.phone)).join('\n')}">${icon('copy', 13)} Numbers</button></div>
      <ul class="list small">${g.members.map((m) => html`<li><span>${m.name}</span><span class="tabular muted">${phone(m.phone)}</span></li>`)}</ul>
    </div>`,
  )}</div>`;
}

async function load() {
  const [c, p] = await Promise.all([api('/admin/cohorts'), api('/admin/cycle-switch')]);
  preview = p;
  const st = c.state;
  const removals = lastRun?.removals?.length ? lastRun.removals : p.pendingRemovals;
  render(
    main,
    html`${pageHead('Cohorts', 'Two 30-day cohorts run side by side, 15 days apart. New subscribers can only join during each cohort’s 5-day signup window.')}
    <div class="stats" style="--cols:3">
      <div class="stat"><div class="label">${cohortBadge('A')}</div><div class="value" style="font-size:20px">${fmtDateShort(st.active.A.start_date)} – ${fmtDateShort(st.active.A.end_date)}</div><div class="hint">Signup ${fmtDateShort(st.active.A.signup_start)} – ${fmtDateShort(st.active.A.signup_end)}</div></div>
      <div class="stat"><div class="label">${cohortBadge('B')}</div><div class="value" style="font-size:20px">${fmtDateShort(st.active.B.start_date)} – ${fmtDateShort(st.active.B.end_date)}</div><div class="hint">Signup ${fmtDateShort(st.active.B.signup_start)} – ${fmtDateShort(st.active.B.signup_end)}</div></div>
      <div class="stat"><div class="label">Signup window</div><div class="value" style="font-size:20px">${st.open ? `Open · ${st.open.code}` : 'Closed'}</div><div class="hint">${st.open ? `Until ${fmtDate(st.open.signup_end)}${st.forced ? ' (forced open)' : ''}` : `Cohort ${st.next.code} opens ${fmtDate(st.next.signup_start)}`}</div></div>
    </div>
    <div class="card mb-2"><div class="card-head"><div><h2>Calendar</h2></div></div>${calendarView(c.calendar, st.today)}</div>

    <div class="card">
      <div class="card-head"><div><h2 class="row">${icon('refresh-cw', 16)} Cycle switch</h2><div class="card-sub">Run when a cohort ends, around the 1st and the 15th.</div></div>${p.due.length ? badge('pending', `${p.due.length} due`) : badge('active', 'Up to date')}</div>
      <p class="muted">Expires finished subscriptions, messages anyone who didn't renew, and lists who to remove from each WhatsApp group. People who renewed into the same cohort keep their groups.</p>
      ${lastRun ? html`<div class="mb-2">${callout('ok', html`Cycle switch complete: <b>${lastRun.expired}</b> expired, ${lastRun.renewed} had already renewed.`)}</div>` : ''}
      ${p.due.length
        ? html`<div class="card flush" style="box-shadow:none"><div class="table-wrap"><table>
          <thead><tr><th>Subscriber</th><th>Route</th><th>Cohort</th><th>Ended</th><th>Renewed</th></tr></thead>
          <tbody>${p.due.map((s) => html`<tr><td><div class="strong">${s.subscriber_name}</div><div class="sub tabular">${phone(s.subscriber_phone)}</div></td><td>${routeChip(s.route_code, true)}</td><td>${cohortBadge(s.cohort_code)}</td><td>${fmtDate(s.subscription_expiry)}</td>
            <td>${s.renewed ? badge('active', s.stays_in_groups ? 'Yes · same groups' : 'Yes · other cohort') : badge('expired', 'No')}</td></tr>`)}</tbody></table></div></div>
          <button class="btn-primary mt-2" data-action="run">${icon('refresh-cw', 15)} Run cycle switch</button>`
        : !lastRun ? emptyState('circle-check', 'Nothing to switch', p.expiringWithin7Days ? `${p.expiringWithin7Days} subscription(s) end within 7 days. They get an automatic renewal reminder on WhatsApp.` : 'No subscriptions have passed their cohort end.') : ''}
      ${removals.length
        ? html`<div class="section-title">${icon('users', 15)} Remove from WhatsApp groups</div>${removalCards(removals)}
          ${p.pendingRemovalIds.length ? html`<button class="mt-2" data-action="mark">${icon('check', 15)} Done, mark ${p.pendingRemovalIds.length} as removed</button>` : ''}`
        : ''}
    </div>`,
  );
}

onAction(main, {
  async run(el) {
    if (!(await confirmDialog(`Expire ${preview.due.length} subscription(s) whose cohort has ended?`, { title: 'Run cycle switch', confirmLabel: 'Run cycle switch', danger: false }))) return;
    el.classList.add('busy');
    try { lastRun = await api('/admin/cycle-switch/run', { method: 'POST' }); toast('Cycle switch complete'); load(); } catch (e) { toastError(e); el.classList.remove('busy'); }
  },
  'copy-phones': (el) => copyText(el.dataset.phones, 'Numbers copied'),
  async mark() {
    try { await api('/admin/cycle-switch/mark-removed', { body: { ids: preview.pendingRemovalIds } }); lastRun = null; toast('Marked as removed'); load(); } catch (e) { toastError(e); }
  },
});

load().catch(toastError);
