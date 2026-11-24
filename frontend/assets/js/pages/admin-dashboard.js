import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { mountShell, pageHead } from '../shell.js';
import { callout, copyText, emptyState, fmtDate, fmtDateShort, fmtTime, html, liveBadge, money, onAction, poll, render, routeChip, timeAgo, toastError } from '../ui.js';

const me = await requireRole('admin');
let main = null;
const liveUrl = (token, dir) => `${location.origin}/live/?t=${encodeURIComponent(token)}&dir=${dir}`;

function usage(label, used, limit) {
  const pct = limit == null ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return html`<div><div class="row between small"><span class="muted">${label}</span><span class="strong tabular">${used} <span class="muted" style="font-weight:400">/ ${limit ?? '∞'}</span></span></div>
    <div class="progress mt-1"><span style="width:${limit == null ? 8 : pct}%"></span></div></div>`;
}

async function load() {
  const d = await api('/admin/dashboard');
  if (!main) {
    main = mountShell('admin', 'dashboard', me, d.counts);
    onAction(main, { copy: (el) => copyText(el.dataset.text, 'Link copied') });
  }
  const c = d.counts;
  const st = d.cohorts;
  const levelIcon = { warn: 'warn', info: 'info', ok: 'ok' };
  render(
    main,
    html`${pageHead('Overview', html`${d.operator.name} · ${fmtDate(st.today)}`, html`<a class="btn" href="/admin/payments">${icon('receipt', 15)} Verify payments</a><a class="btn btn-primary" href="/admin/subscribers">${icon('user-plus', 15)} Add subscriber</a>`)}
    ${d.alerts.length ? html`<div class="mb-3">${d.alerts.map((a) => callout(levelIcon[a.level] || 'info', a.text, a.link ? html`<a href="${a.link}" class="btn btn-sm">Review</a>` : ''))}</div>` : ''}
    <div class="stats">
      <div class="stat"><div class="label">Active subscribers</div><div class="value">${c.active_subs}</div><div class="hint">${c.active_a} in A · ${c.active_b} in B</div></div>
      <div class="stat"><div class="label">Pending payments</div><div class="value">${c.pending_payments}</div><div class="hint">${c.pending_payments ? html`<a href="/admin/payments">Review now</a>` : 'All verified'}</div></div>
      <div class="stat"><div class="label">Live trips</div><div class="value">${d.live.length}</div><div class="hint">${c.trips_today} trips today</div></div>
      <div class="stat"><div class="label">Revenue · 30 days</div><div class="value">${money(c.revenue_30d)}</div><div class="hint">Confirmed passenger payments</div></div>
    </div>
    <div class="grid grid-main">
      <div class="card flush">
        <div class="card-head"><div><h2>Live now</h2><div class="card-sub">Buses currently sharing their location</div></div><a href="/admin/trips" class="btn btn-sm btn-ghost">All trips ${icon('arrow-right', 14)}</a></div>
        ${d.live.length
          ? html`<div class="table-wrap"><table><thead><tr><th>Route</th><th>Direction</th><th>Conductor</th><th>Last GPS</th><th></th></tr></thead><tbody>
            ${d.live.map((t) => html`<tr><td>${routeChip(t.route_code)}</td><td>${t.direction_label}<div class="sub">since ${fmtTime(t.started_at)}</div></td><td>${t.conductor_name}</td><td>${liveBadge(timeAgo(t.last_ping_at))}</td>
              <td class="actions"><a class="btn btn-sm" href="${liveUrl(t.live_token, t.direction)}" target="_blank" rel="noopener">${icon('map-pin', 14)} Map</a><a class="btn btn-sm" href="/admin/trip?id=${t.id}">Details</a></td></tr>`)}
            </tbody></table></div>`
          : emptyState('bus-front', 'No buses are live', 'When a conductor taps Start, the trip appears here in real time.')}
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Cohorts</h2><div class="card-sub">Two 30-day cycles, 15 days apart</div></div><a href="/admin/cohorts" class="btn btn-sm btn-ghost">Calendar ${icon('arrow-right', 14)}</a></div>
        <dl class="kv">
          <dt><span class="badge cohort-a">A</span></dt><dd>${fmtDateShort(st.active.A.start_date)} – ${fmtDateShort(st.active.A.end_date)} <span class="muted" style="font-weight:400">· ${c.active_a} active</span></dd>
          <dt><span class="badge cohort-b">B</span></dt><dd>${fmtDateShort(st.active.B.start_date)} – ${fmtDateShort(st.active.B.end_date)} <span class="muted" style="font-weight:400">· ${c.active_b} active</span></dd>
          <dt>Signups</dt><dd>${st.open ? html`<span class="badge green">Open</span> until ${fmtDateShort(st.open.signup_end)}` : html`<span class="badge gray">Closed</span> <span class="muted" style="font-weight:400">opens ${fmtDateShort(st.next.signup_start)}</span>`}</dd>
          <dt>Waitlist</dt><dd>${c.waitlist} waiting</dd>
          <dt>Renewals</dt><dd>${c.expiring_soon} expiring in 7 days</dd>
        </dl>
      </div>
    </div>
    <div class="grid grid-2 mt-2">
      <div class="card">
        <div class="card-head"><div><h2>Passenger signup link</h2><div class="card-sub">Share it in buses, at stops and on social media.</div></div></div>
        <div class="copy-box"><code>${d.signupLink}</code><button class="btn-sm" data-action="copy" data-text="${d.signupLink}">${icon('copy', 14)} Copy</button></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Plan usage</h2><div class="card-sub"><span class="pkg">${d.operator.package}</span> plan</div></div><a href="/admin/settings" class="btn btn-sm btn-ghost">Details ${icon('arrow-right', 14)}</a></div>
        <div class="stack" style="gap:14px">${usage('Active routes', c.routes, d.features.max_routes)}${usage('Conductors', c.conductors, d.features.max_conductors)}</div>
      </div>
    </div>`,
  );
}

poll(() => load().catch(toastError), 20000);
