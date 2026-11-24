import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { mountShell, pageHead } from '../shell.js';
import { $, badge, html, onAction, render, toast, toastError } from '../ui.js';

let me = await requireRole('developer');
const main = mountShell('developer', 'settings', me);

async function load() {
  me = await api('/auth/me');
  const c = await api('/dev/config');
  const v = c.values;
  const days = (name, val) => html`<input type="number" name="${name}" min="1" max="28" value="${val}" style="width:72px;text-align:center">`;
  render(
    main,
    html`${pageHead('Settings', 'Account security and platform-wide configuration.')}
    <div class="grid grid-main">
      <form class="card" id="cfg">
        <div class="card-head"><div><h2>Platform</h2><div class="card-sub">Applies to every operator.</div></div></div>
        <div class="setting-row">
          <div><div class="t">Force signup window open</div><div class="d">Testing only. Lets passengers sign up outside the windows. They join the most recently started cohort.</div></div>
          <label class="switch"><input type="checkbox" name="force_signup_window" ${v.force_signup_window ? 'checked' : ''}><span></span></label>
        </div>
        <div class="setting-row">
          <div><div class="t">Cohort A signup days</div><div class="d">The cohort starts on the first day and runs for a month.</div></div>
          <div class="row nowrap">${days('a_start', v.signup_window_a?.start)}<span class="muted">to</span>${days('a_end', v.signup_window_a?.end)}</div>
        </div>
        <div class="setting-row">
          <div><div class="t">Cohort B signup days</div><div class="d">Must not overlap cohort A.</div></div>
          <div class="row nowrap">${days('b_start', v.signup_window_b?.start)}<span class="muted">to</span>${days('b_end', v.signup_window_b?.end)}</div>
        </div>
        <div class="setting-row">
          <div><div class="t">Auto-close trips after</div><div class="d">Minutes without GPS before a trip ends itself. The spec default is 10.</div></div>
          <div class="row nowrap"><input type="number" name="trip_auto_close_minutes" min="2" max="240" value="${v.trip_auto_close_minutes}" style="width:80px;text-align:center"><span class="muted">min</span></div>
        </div>
        <div class="setting-row">
          <div><div class="t">Platform name</div></div>
          <input name="platform_name" value="${v.platform_name}" style="max-width:220px">
        </div>
        <div class="setting-row">
          <div><div class="t">Cost estimates</div><div class="d">Used on the Costs page.</div></div>
          <div class="row nowrap"><span class="small muted">Rs / message</span><input type="number" step="0.1" name="cost_per_message_pkr" value="${v.cost_per_message_pkr}" style="width:80px"><span class="small muted">Rs / USD</span><input type="number" name="pkr_per_usd" value="${v.pkr_per_usd}" style="width:80px"></div>
        </div>
        <div class="mt-2"><button class="btn-primary">Save configuration</button></div>
      </form>
      <div class="stack">
        <div class="card" id="tfa">
          <div class="card-head"><div><h2 class="row">${icon('shield-check', 16)} Two-step verification</h2></div>${me.totp_enabled ? badge('active', 'On') : badge('pending', 'Off')}</div>
          ${me.totp_enabled
            ? html`<p class="muted small">Signing in asks for a code from your authenticator app.</p>
                <form id="tfa-off" class="row nowrap"><input name="code" placeholder="6-digit code" inputmode="numeric" maxlength="6" required><button class="btn-outline-danger">Turn off</button></form>`
            : html`<p class="muted small">Protect the developer console with Google Authenticator, 1Password or any TOTP app.</p><button class="btn-primary" data-action="setup">Set up</button><div id="tfa-setup"></div>`}
        </div>
        <div class="card">
          <div class="card-head"><div><h2>Environment</h2><div class="card-sub">From <code>backend/.env</code>; restart to change.</div></div></div>
          <dl class="kv small">
            <dt>Database</dt><dd>${c.env.databaseKind}</dd>
            <dt>Messaging</dt><dd>${c.env.messagingChannel}</dd>
            <dt>Public URL</dt><dd>${c.env.publicBaseUrl}</dd>
            <dt>Timezone</dt><dd>${c.env.timezone}</dd>
            <dt>OTP on screen</dt><dd>${c.env.exposeDevOtp ? 'Yes' : 'No'}</dd>
          </dl>
        </div>
      </div>
    </div>`,
  );

  $('#cfg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const n = (k) => Number(fd.get(k));
    const updates = {
      force_signup_window: fd.get('force_signup_window') === 'on',
      trip_auto_close_minutes: n('trip_auto_close_minutes'),
      platform_name: String(fd.get('platform_name')),
      cost_per_message_pkr: n('cost_per_message_pkr'),
      pkr_per_usd: n('pkr_per_usd'),
    };
    const btn = e.target.querySelector('.btn-primary');
    btn.classList.add('busy');
    try {
      for (const [k, val] of Object.entries(updates)) {
        if (JSON.stringify(v[k]) !== JSON.stringify(val)) await api(`/dev/config/${k}`, { method: 'PUT', body: { value: val } });
      }
      const a = { start: n('a_start'), end: n('a_end') };
      const b = { start: n('b_start'), end: n('b_end') };
      const order = a.start > (v.signup_window_a?.start ?? 1) ? [['signup_window_b', b], ['signup_window_a', a]] : [['signup_window_a', a], ['signup_window_b', b]];
      for (const [k, val] of order) if (JSON.stringify(v[k]) !== JSON.stringify(val)) await api(`/dev/config/${k}`, { method: 'PUT', body: { value: val } });
      toast('Configuration saved');
      load();
    } catch (err) { toastError(err); } finally { btn.classList.remove('busy'); }
  });

  $('#tfa-off')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/dev/2fa/disable', { body: { code: e.target.code.value } }); toast('Two-step verification turned off'); load(); } catch (err) { toastError(err); }
  });
}

onAction(main, {
  async setup() {
    try {
      const s = await api('/dev/2fa/setup', { method: 'POST' });
      render(
        $('#tfa-setup'),
        html`<div class="divider"></div>
        <div class="row nowrap" style="align-items:flex-start;gap:16px"><img src="${s.qr}" alt="QR code for your authenticator app" width="140" height="140" style="border:1px solid var(--border);border-radius:10px;padding:6px;background:#fff">
        <div style="min-width:0"><div class="small strong">1. Scan with your app</div><div class="small muted mb-1">or enter <code style="word-break:break-all">${s.secret}</code></div>
        <div class="small strong">2. Enter the code</div>
        <form id="tfa-on" class="row nowrap mt-1"><input name="code" placeholder="123456" inputmode="numeric" maxlength="6" required><button class="btn-primary">Verify</button></form></div></div>`,
      );
      $('#tfa-on').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api('/dev/2fa/enable', { body: { code: e.target.code.value } }); toast('Two-step verification is on'); load(); } catch (err) { toastError(err); }
      });
    } catch (e) { toastError(e); }
  },
});

load().catch(toastError);
