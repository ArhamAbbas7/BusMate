import { api, session } from '../api.js';
import { icon } from '../icons.js';
import { $, formValues, html, logo, qs, render } from '../ui.js';

const root = $('#app');
let challenge = null;

function redirect(role) {
  const next = qs('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  if (role === 'developer') location.href = safeNext?.startsWith('/dev') ? safeNext : '/dev/';
  else location.href = safeNext?.startsWith('/admin') ? safeNext : '/admin/';
}

function view() {
  render(
    root,
    html`<a href="/" class="brand center" style="justify-content:center;margin-bottom:24px">${logo(32)}<span style="font-size:15px">EV Bus Live</span></a>
    <div class="card">
      ${challenge
        ? html`<form id="f2">
            <span class="icon-tile mb-2">${icon('shield-check', 18)}</span>
            <h1>Two-step verification</h1>
            <p class="muted mt-1">Enter the 6-digit code from your authenticator app.</p>
            <div class="field"><label for="code">Verification code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required style="letter-spacing:.3em;font-family:var(--mono);font-size:16px"></div>
            <div class="error-text mb-1" id="err"></div>
            <button class="btn-primary btn-lg btn-block">Verify</button>
            <button type="button" class="btn-ghost btn-block mt-1" id="back">${icon('arrow-left', 14)} Back</button>
          </form>`
        : html`<form id="f1">
            <h1>Sign in</h1>
            <p class="muted mt-1">Operator admins and platform developers.</p>
            <div class="field mt-2"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" placeholder="you@company.com" required></div>
            <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
            <div class="error-text mb-1" id="err"></div>
            <button class="btn-primary btn-lg btn-block">Continue</button>
          </form>`}
    </div>
    <p class="small muted center mt-2">Conductor? <a class="link" href="/conductor/">Open the conductor app</a></p>`,
  );
  const f = $('form', root);
  f.querySelector('input').focus();
  $('#back')?.addEventListener('click', () => { challenge = null; view(); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('.btn-primary');
    btn.classList.add('busy');
    $('#err').textContent = '';
    try {
      const v = formValues(f);
      const r = challenge ? await api('/auth/login/2fa', { body: { challenge, code: v.code }, as: 'none' }) : await api('/auth/login', { body: v, as: 'none' });
      if (r.requires2fa) {
        challenge = r.challenge;
        return view();
      }
      session.staff = r.token;
      session.devBackup = null;
      redirect(r.user.role);
    } catch (err) {
      $('#err').textContent = err.message;
    } finally {
      btn.classList.remove('busy');
    }
  });
}

if (session.staff) {
  api('/auth/me').then((me) => redirect(me.role)).catch(() => view());
} else view();
