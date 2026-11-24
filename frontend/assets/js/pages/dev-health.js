import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { mountShell, pageHead } from '../shell.js';
import { badge, bytes, callout, fmtDate, html, num, onAction, poll, render, timeAgo, toast, toastError } from '../ui.js';

const me = await requireRole('developer');
const main = mountShell('developer', 'health', me);

function uptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

async function load() {
  const h = await api('/dev/health');
  const s = h.stats;
  const c = h.cohorts;
  render(
    main,
    html`${pageHead(html`System health ${badge('active', 'Operational')}`, 'Refreshes every 10 seconds.')}
    ${h.devSecretInUse || h.messaging.channel === 'console' ? html`<div class="stack mb-2" style="gap:8px">
      ${h.devSecretInUse ? callout('warn', html`A development <code>JWT_SECRET</code> is in use. Set a strong one in <code>backend/.env</code> before going live.`) : ''}
      ${h.messaging.channel === 'console' ? callout('info', html`Messaging is in <b>outbox mode</b>, so WhatsApp messages are recorded rather than sent. Set <code>MESSAGING_CHANNEL=whatsapp</code> when your Cloud API is ready.`, html`<a class="btn btn-sm" href="/dev/outbox">Open outbox</a>`) : ''}
    </div>` : ''}
    <div class="stats">
      <div class="stat"><div class="label">${icon('radio', 14)} Live trips</div><div class="value">${s.live_trips}</div><div class="hint">${s.auto_closed_24h} auto-closed in 24h</div></div>
      <div class="stat"><div class="label">${icon('map-pin', 14)} GPS pings · 1h</div><div class="value">${num(s.pings_1h)}</div><div class="hint">${s.pings_1m} in the last minute</div></div>
      <div class="stat"><div class="label">${icon('message-square', 14)} Messages · 24h</div><div class="value">${num(s.messages_24h)}</div><div class="hint">${s.failed_messages_24h} failed</div></div>
      <div class="stat"><div class="label">${icon('database', 14)} DB latency</div><div class="value">${h.database.latencyMs}<small>ms</small></div><div class="hint">${bytes(h.database.sizeBytes)} · ${num(s.total_pings)} pings</div></div>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><div><h2>Runtime</h2></div>${icon('server', 18, 'muted')}</div>
        <dl class="kv">
          <dt>Database</dt><dd>${h.database.kind}</dd>
          <dt>Uptime</dt><dd>${uptime(h.server.uptimeSeconds)}</dd>
          <dt>Node.js</dt><dd>${h.server.node} <span class="muted" style="font-weight:400">· ${h.server.platform}</span></dd>
          <dt>Memory</dt><dd>${h.server.rssMb} MB RSS · ${h.server.heapMb} MB heap</dd>
          <dt>Messaging</dt><dd>${h.messaging.channel} ${h.messaging.whatsappConfigured ? badge('active', 'WhatsApp configured') : badge('pending', 'WhatsApp not configured')}</dd>
          <dt>OTP on screen</dt><dd>${h.messaging.exposeDevOtp ? 'Yes · development only' : 'No'}</dd>
        </dl>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Cohorts</h2><div class="card-sub">${fmtDate(c.today)}</div></div>${icon('calendar-range', 18, 'muted')}</div>
        <dl class="kv">
          <dt><span class="badge cohort-a">A</span></dt><dd>${fmtDate(c.active.A.start_date)} – ${fmtDate(c.active.A.end_date)}</dd>
          <dt><span class="badge cohort-b">B</span></dt><dd>${fmtDate(c.active.B.start_date)} – ${fmtDate(c.active.B.end_date)}</dd>
          <dt>Signup window</dt><dd>${c.open ? html`${badge('active', 'Open')} cohort ${c.open.code}${c.forced ? ' (forced)' : ''}` : html`${badge('inactive', 'Closed')} <span class="muted" style="font-weight:400">cohort ${c.next.code} opens ${fmtDate(c.next.signup_start)}</span>`}</dd>
        </dl>
      </div>
    </div>
    <div class="card flush mt-2">
      <div class="card-head"><div><h2>Background jobs</h2><div class="card-sub">Run inside the API process locally; become timer Functions on Azure.</div></div></div>
      <div class="table-wrap mt-1"><table>
        <thead><tr><th>Job</th><th>Schedule</th><th>Last run</th><th>Result</th><th></th></tr></thead>
        <tbody>${h.jobs.map(
          (j) => html`<tr><td><div class="strong mono" style="font-size:13px">${j.name}</div><div class="sub">${j.label}</div></td><td class="nowrap">Every ${j.everySeconds >= 60 ? `${j.everySeconds / 60} min` : `${j.everySeconds}s`}</td>
            <td class="nowrap">${j.running ? badge('pending', 'Running') : timeAgo(j.lastRunAt)}</td>
            <td>${j.lastError ? html`<span class="error-text">${j.lastError}</span>` : html`<code class="small muted">${j.lastResult ? JSON.stringify(j.lastResult) : '–'}</code>`}</td>
            <td class="actions"><button class="btn-sm" data-action="run" data-job="${j.name}">${icon('play', 12)} Run</button></td></tr>`,
        )}</tbody>
      </table></div>
    </div>`,
  );
}

onAction(main, {
  async run(el) {
    try {
      const r = await api(`/dev/jobs/${el.dataset.job}/run`, { method: 'POST' });
      toast(r.error ? `Failed: ${r.error}` : `Done: ${JSON.stringify(r.result)}`, r.error ? 'error' : 'ok');
      load();
    } catch (e) { toastError(e); }
  },
});

poll(() => load().catch(toastError), 10000);
