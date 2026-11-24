// Conductor mobile web app (SRS 4.3): OTP login, route + direction, START/STOP, GPS every 30 s,
// offline ping queue (FR-C-11/12), graceful GPS-denied handling (FR-C-10), screen wake lock, GPS simulator.
import { api, session } from '../api.js';
import { icon } from '../icons.js';
import { themeToggle } from '../theme.js';
import { $, confirmDialog, copyText, emptyState, html, initials, logo, onAction, render, routeChip, toast, toastError, fmtTime, timeAgo, cohortBadge } from '../ui.js';

render($('#brand'), html`${logo(28)}<span>Conductor<small id="op-name">EV Bus Live</small></span>`);
themeToggle($('.cd-top'), 'before-logout');

const app = $('#app');
const capi = (path, opts = {}) => api(path, { ...opts, as: 'conductor' });
let state = { view: 'loading', me: null, routeId: null, direction: null, trip: null, summary: null, phone: '', devCode: null };

// ------------------------------------------------------------------ GPS engine
const gps = {
  watchId: null,
  fix: null, // { lat, lng, accuracy, speed, heading, t }
  error: null, // 'denied' | 'unavailable' | 'insecure' | null
  simulate: false,
  simIndex: 0,
  simPath: [],
  timer: null,
  sent: 0,
  lastSentAt: null,
  wakeLock: null,
  intervalMs: 30000,
};

const queueKey = (tripId) => `evbus.pingQueue.${tripId}`;
function readQueue(tripId) {
  try { return JSON.parse(localStorage.getItem(queueKey(tripId)) || '[]'); } catch { return []; }
}
function writeQueue(tripId, q) {
  try { q.length ? localStorage.setItem(queueKey(tripId), JSON.stringify(q.slice(-2000))) : localStorage.removeItem(queueKey(tripId)); } catch { /* storage full */ }
}

function startWatch() {
  if (gps.simulate) return;
  if (!window.isSecureContext) { gps.error = 'insecure'; return; }
  if (!('geolocation' in navigator)) { gps.error = 'unavailable'; return; }
  if (gps.watchId != null) return;
  gps.watchId = navigator.geolocation.watchPosition(
    (p) => {
      gps.error = null;
      gps.fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading, t: Date.now() };
      if (!gps.lastSentAt) tick(); // send the very first fix immediately
      updateLive();
    },
    (err) => {
      gps.error = err.code === 1 ? 'denied' : 'unavailable';
      updateLive();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  );
}
function stopWatch() {
  if (gps.watchId != null) navigator.geolocation.clearWatch(gps.watchId);
  gps.watchId = null;
}

// Simulated movement along the route path (for testing without a phone)
function densify(path, steps = 12) {
  const out = [];
  for (let i = 0; i < path.length - 1; i++) {
    for (let s = 0; s < steps; s++) {
      const f = s / steps;
      out.push([path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f]);
    }
  }
  if (path.length) out.push(path[path.length - 1]);
  return out;
}
function simulatedFix() {
  if (!gps.simPath.length) {
    const c = state.me?.mapCenter || { lat: 31.52, lng: 74.35 };
    gps.simPath = densify([[c.lat - 0.02, c.lng - 0.03], [c.lat, c.lng], [c.lat + 0.02, c.lng + 0.03]]);
  }
  const p = gps.simPath[Math.min(gps.simIndex, gps.simPath.length - 1)];
  gps.simIndex = gps.simIndex >= gps.simPath.length - 1 ? 0 : gps.simIndex + 1;
  return { lat: p[0] + (Math.random() - 0.5) * 0.00008, lng: p[1] + (Math.random() - 0.5) * 0.00008, accuracy: 6 + Math.random() * 6, speed: 7 + Math.random() * 4, heading: null, t: Date.now() };
}

async function flush() {
  const tripId = state.trip?.id;
  if (!tripId) return;
  const q = readQueue(tripId);
  if (!q.length || !navigator.onLine) return;
  try {
    const r = await capi(`/conductor/trips/${tripId}/pings`, { body: { pings: q.slice(0, 500) } });
    writeQueue(tripId, readQueue(tripId).slice(Math.min(q.length, 500)));
    gps.sent += r.accepted;
    gps.lastSentAt = Date.now();
    if (r.status === 'completed') return tripEndedRemotely('This trip was ended by your admin.');
    if (r.status === 'auto_closed') return tripEndedRemotely('This trip was closed automatically because no GPS was received for 10 minutes. Start a new trip to continue.');
  } catch (e) {
    if (e.status === 401) return signOut();
    // offline or server unreachable: keep the queue, retry next tick
  }
  updateLive();
}

function tick() {
  if (!state.trip) return;
  const fix = gps.simulate ? simulatedFix() : gps.fix;
  if (gps.simulate) gps.fix = fix;
  if (fix && Date.now() - fix.t < 60000) {
    const q = readQueue(state.trip.id);
    q.push({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy ?? null, speed: fix.speed ?? null, heading: fix.heading ?? null, recordedAt: new Date(fix.t).toISOString() });
    writeQueue(state.trip.id, q);
  }
  flush();
}

function startEngine() {
  stopEngine();
  gps.intervalMs = gps.simulate ? 5000 : (state.me?.pingIntervalSeconds || 30) * 1000;
  if (gps.simulate) {
    const r = state.me.routes.find((x) => x.id === state.trip.route_id);
    const path = r?.path?.length ? (state.trip.direction === 'backward' ? [...r.path].reverse() : r.path) : [];
    gps.simPath = path.length ? densify(path) : [];
    gps.simIndex = 0;
    stopWatch();
    tick();
  } else startWatch();
  gps.timer = setInterval(tick, gps.intervalMs);
  requestWakeLock();
}
function stopEngine() {
  clearInterval(gps.timer);
  gps.timer = null;
  stopWatch();
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !gps.wakeLock && document.visibilityState === 'visible') {
      gps.wakeLock = await navigator.wakeLock.request('screen');
      gps.wakeLock.addEventListener('release', () => { gps.wakeLock = null; });
    }
  } catch { /* not supported or denied */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.trip) {
    requestWakeLock();
    tick();
  }
});
window.addEventListener('online', flush);

function tripEndedRemotely(msg) {
  stopEngine();
  const id = state.trip.id;
  state.trip = null;
  toast(msg, 'error', 8000);
  capi(`/conductor/trips/${id}/summary`).then((s) => { state.summary = s; state.view = 'summary'; draw(); }).catch(() => boot());
}

// ------------------------------------------------------------------ views
function viewLogin() {
  const step = state.devCode !== null || state.otpSent ? 'code' : 'phone';
  render(
    app,
    html`<div style="padding:28px 4px 20px"><span class="icon-tile mb-2">${icon(step === 'phone' ? 'smartphone' : 'key-round', 18)}</span>
      <h1>${step === 'phone' ? 'Sign in to start trips' : 'Enter your code'}</h1>
      <p class="muted mt-1 mb-0">${step === 'phone' ? 'Use the mobile number your operator registered.' : html`We sent a 6-digit code to <b class="tabular" style="color:var(--text)">${state.phone}</b>.`}</p></div>
    <div class="cd-card">
      ${step === 'phone'
        ? html`<form id="f-phone"><label for="ph">Mobile number</label><input id="ph" class="cd-input" name="phone" inputmode="tel" autocomplete="tel" placeholder="0300 1234567" value="${state.phone}" required>
          <div class="error-text" id="err"></div><button class="btn-primary btn-xl btn-block mt-2">Send code ${icon('arrow-right', 17)}</button></form>`
        : html`${state.devCode ? html`<div class="dev-hint" style="margin-top:0"><span>Development build: no SMS yet.<b>${state.devCode}</b></span><button class="btn-sm" data-action="fill">Use code</button></div>` : ''}
          <form id="f-code"><input class="cd-otp" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······" required aria-label="6-digit code">
          <div class="error-text" id="err"></div><button class="btn-primary btn-xl btn-block mt-2">Sign in</button>
          <button type="button" class="btn-ghost btn-block mt-1" data-action="change-phone">Use a different number</button></form>`}
    </div>
    <p class="small muted center">Demo numbers: 0300 1234567 · 0300 7654321</p>`,
  );
  const f = $('form', app);
  f.querySelector('input').focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('.btn-primary');
    btn.classList.add('busy');
    $('#err').textContent = '';
    try {
      if (step === 'phone') {
        state.phone = f.phone.value.trim();
        const r = await api('/auth/conductor/request-otp', { body: { phone: state.phone }, as: 'none' });
        state.otpSent = true;
        state.devCode = r.devCode ?? null;
        draw();
      } else {
        const r = await api('/auth/conductor/verify-otp', { body: { phone: state.phone, code: f.code.value.trim() }, as: 'none' });
        session.conductor = r.token;
        state.devCode = null;
        state.otpSent = false;
        boot();
      }
    } catch (err) {
      $('#err').textContent = err.message;
    } finally {
      btn.classList.remove('busy');
    }
  });
}

function viewHome() {
  const me = state.me;
  const route = me.routes.find((r) => r.id === state.routeId);
  render(
    app,
    html`<div class="cd-hello"><span class="avatar" style="width:42px;height:42px;font-size:14px">${initials(me.conductor.name)}</span><div><h1>${me.conductor.name.split(' ')[0]}</h1><div class="muted small">${me.conductor.operator_name}</div></div></div>
    <div class="cd-card">
      <div class="cd-label"><span class="n">1</span>Choose your route</div>
      ${me.routes.length
        ? me.routes.map((r) => html`<button class="route-btn ${r.id === state.routeId ? 'selected' : ''}" data-action="route" data-id="${r.id}">${routeChip(r.code)}<span style="flex:1;min-width:0"><span class="nm">${r.name}</span><br><span class="small muted">${r.towards_label} ⇄ ${r.backward_label}</span></span>${(r.live_directions || []).length ? html`<span class="badge live">${r.live_directions.length} live</span>` : icon('chevron-right', 18, 'faint')}</button>`)
        : emptyState('route', 'No routes assigned', 'Ask your operator to assign you a route.')}
    </div>
    ${route
      ? html`<div class="cd-card">
        <div class="cd-label"><span class="n">2</span>Choose direction</div>
        <div class="dir-grid">${['towards', 'backward'].map((d) => {
          const busy = (route.live_directions || []).includes(d);
          return html`<button class="dir-btn ${state.direction === d ? 'selected' : ''}" data-action="dir" data-d="${d}" ${busy ? 'disabled' : ''}>${icon(d === 'towards' ? 'arrow-right' : 'arrow-left', 18)}<span>${d === 'towards' ? route.towards_label : route.backward_label}${busy ? html`<br><span class="small muted" style="font-weight:400">Another bus is already live</span>` : ''}</span></button>`;
        })}</div>
      </div>`
      : ''}
    ${route && state.direction ? html`<button class="btn-primary big-start" data-action="start">${icon('play', 18)} Start trip</button><p class="small muted center mt-1">Your location is shared only while the trip runs. Keep this page open.</p>` : ''}
    <div class="cd-label" style="margin:24px 2px 10px">Recent trips</div><div class="cd-card" id="recent"><div class="skeleton" style="min-height:40px"></div></div>`,
  );
  capi('/conductor/trips/recent').then((rows) => {
    const el = $('#recent');
    if (!el) return;
    render(el, rows.length ? html`<ul class="list">${rows.map((t) => html`<li><span class="row nowrap" style="gap:10px">${routeChip(t.route_code, true)}<span><span class="strong">${t.direction_label}</span><br><span class="sub">${timeAgo(t.started_at)} · ${t.ping_count} GPS points</span></span></span>${t.status === 'active' ? html`<span class="badge live">Live</span>` : html`<span class="badge gray">${t.status.replace('_', ' ')}</span>`}</li>`)}</ul>` : html`<p class="muted small mb-0">No trips yet.</p>`);
  }).catch(() => {});
}

function gpsStateHtml() {
  const box = (cls, ico, body) => html`<div class="gps-state ${cls}">${icon(ico, 16)}<span>${body}</span></div>`;
  if (gps.simulate) return box('warn', 'flask-conical', html`<b>Simulated GPS.</b> The bus moves along the route every 5 seconds. Turn this off on a real bus.`);
  if (gps.error === 'insecure') return box('bad', 'lock', html`<b>Location needs HTTPS.</b> Open this page over https:// or on localhost to use real GPS, or turn on simulation below.`);
  if (gps.error === 'denied') return box('bad', 'circle-alert', html`<b>Location is blocked.</b> Allow location for this site in your browser settings, then reload. Trips end after 10 minutes without GPS.`);
  if (gps.error === 'unavailable') return box('warn', 'satellite', html`<b>Searching for GPS.</b> Move near a window or outside.`);
  if (!gps.fix) return box('warn', 'satellite', html`Waiting for the first GPS fix…`);
  return box('ok', 'locate-fixed', html`<b>GPS connected</b> · ±${Math.round(gps.fix.accuracy || 0)} m · ${timeAgo(gps.fix.t)}`);
}

function viewLive() {
  const t = state.trip;
  render(
    app,
    html`<div class="live-head">
      <div class="live-pill"><span class="live-dot"></span>Live · sharing location</div>
      <div class="route">${t.route_code}</div>
      <div class="dir">${icon(t.direction === 'backward' ? 'arrow-left' : 'arrow-right', 15)}${t.direction_label}</div>
      <div class="timer" id="timer">00:00:00</div>
      <div class="timer-l">Started ${fmtTime(t.started_at)}</div>
    </div>
    <div class="cd-card">
      <div class="stat-row">
        <div><div class="v" id="s-sent">${gps.sent}</div><div class="l">Sent</div></div>
        <div><div class="v" id="s-queue">0</div><div class="l">Queued</div></div>
        <div><div class="v" id="s-last">–</div><div class="l">Last upload</div></div>
      </div>
      <div class="mt-2" id="gps-state">${gpsStateHtml()}</div>
      <div id="offline" class="gps-state warn mt-1" hidden>${icon('wifi-off', 16)}<span><b>You're offline.</b> Locations are saved on this phone and upload automatically when you reconnect.</span></div>
    </div>
    <div class="cd-card">
      <div class="cd-label">${icon('message-square', 14)} WhatsApp message</div>
      <div class="msg-preview small">${t.message?.text || ''}</div>
      <button class="btn-primary btn-lg btn-block mt-2" data-action="copy">${icon('copy', 16)} Copy message</button>
      <ul class="list small mt-2">${(t.message?.groups || []).map((g) => html`<li>${cohortBadge(g.cohort)}${g.invite_link ? html`<a class="btn btn-sm btn-ghost" href="${g.invite_link}" target="_blank" rel="noopener">Open group ${icon('arrow-up-right', 13)}</a>` : html`<span class="muted">Link not set</span>`}</li>`)}</ul>
    </div>
    <div class="cd-card sim-toggle">
      <span><span class="strong">Simulate GPS</span><br><span class="small muted">Test without being on a bus</span></span>
      <label class="switch"><input type="checkbox" id="sim" ${gps.simulate ? 'checked' : ''} aria-label="Simulate GPS"><span></span></label>
    </div>
    <button class="big-stop" data-action="stop">${icon('circle-stop', 18)} Stop trip</button>
    <p class="small muted center mt-1">Keep this screen open while driving.</p>`,
  );
  $('#sim').addEventListener('change', (e) => {
    gps.simulate = e.target.checked;
    try { localStorage.setItem('evbus.simulate', gps.simulate ? '1' : ''); } catch { /* ignore */ }
    gps.error = null;
    startEngine();
    updateLive();
  });
  updateLive();
}

function updateLive() {
  if (state.view !== 'live' || !state.trip) return;
  const s = Math.floor((Date.now() - new Date(state.trip.started_at).getTime()) / 1000);
  const tEl = $('#timer');
  if (tEl) tEl.textContent = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('#s-sent', gps.sent);
  set('#s-queue', readQueue(state.trip.id).length);
  set('#s-last', gps.lastSentAt ? timeAgo(gps.lastSentAt).replace(' ago', '') : '–');
  const g = $('#gps-state');
  if (g) render(g, gpsStateHtml());
  const off = $('#offline');
  if (off) off.hidden = navigator.onLine;
}
setInterval(updateLive, 1000);

function viewSummary() {
  const s = state.summary;
  render(
    app,
    html`<div class="cd-card center" style="padding:28px 20px">
      <div class="summary-ico">${icon('check', 26)}</div><h1>Trip complete</h1>
      <p class="muted mt-1">${s.trip.route_code} · ${s.directionLabel}</p>
      <div class="stat-row mt-3" style="text-align:center">
        <div><div class="v">${s.durationMinutes}</div><div class="l">Minutes</div></div>
        <div><div class="v">${s.distanceKm}</div><div class="l">Kilometres</div></div>
        <div><div class="v">${s.pingCount}</div><div class="l">GPS points</div></div>
      </div>
    </div>
    <button class="btn-primary big-start" data-action="home">Back to routes</button>`,
  );
}

function draw() {
  $('#logout').hidden = !session.conductor;
  if (state.view === 'login') viewLogin();
  else if (state.view === 'home') viewHome();
  else if (state.view === 'live') viewLive();
  else if (state.view === 'summary') viewSummary();
}

onAction(app, {
  fill: () => { const i = $('input[name=code]'); i.value = state.devCode; i.form.requestSubmit(); },
  'change-phone': () => { state.otpSent = false; state.devCode = null; draw(); },
  route: (el) => { state.routeId = el.dataset.id; state.direction = null; draw(); },
  dir: (el) => { state.direction = el.dataset.d; draw(); },
  async start(el) {
    el.classList.add('busy');
    try {
      const r = await capi('/conductor/trips', { body: { routeId: state.routeId, direction: state.direction } });
      state.trip = { ...r.trip, message: r.message };
      gps.sent = 0;
      gps.lastSentAt = null;
      gps.fix = null;
      state.view = 'live';
      draw();
      startEngine();
      toast('Trip started. Remember to post the message in WhatsApp.');
    } catch (e) {
      toastError(e);
      el.classList.remove('busy');
      if (e.status === 409) boot();
    }
  },
  copy: () => copyText(state.trip.message.text, 'Copied. Paste it in your WhatsApp groups.'),
  async stop(el) {
    if (!(await confirmDialog('Stop this trip? Passengers will see that the bus is no longer live.', { confirmLabel: 'Stop trip' }))) return;
    el.classList.add('busy');
    try {
      tick();
      await flush();
      stopEngine();
      const s = await capi(`/conductor/trips/${state.trip.id}/stop`, { method: 'POST' });
      writeQueue(state.trip.id, []);
      state.trip = null;
      state.summary = s;
      state.view = 'summary';
      gps.wakeLock?.release().catch(() => {});
      draw();
    } catch (e) {
      toastError(e);
      el.classList.remove('busy');
    }
  },
  home: () => { state.summary = null; state.routeId = null; state.direction = null; boot(); },
});

function signOut() {
  stopEngine();
  session.conductor = null;
  state = { view: 'login', me: null, routeId: null, direction: null, trip: null, summary: null, phone: '', devCode: null };
  draw();
}
$('#logout').addEventListener('click', async () => {
  if (state.trip && !(await confirmDialog('You have a live trip. Signing out stops sending its location. Continue?', { confirmLabel: 'Sign out' }))) return;
  signOut();
});

async function boot() {
  if (!session.conductor) { state.view = 'login'; return draw(); }
  try {
    state.me = await capi('/conductor/me');
    $('#op-name').textContent = state.me.conductor.operator_name;
    try { gps.simulate = localStorage.getItem('evbus.simulate') === '1'; } catch { /* ignore */ }
    if (state.me.currentTrip) {
      state.trip = state.me.currentTrip;
      state.view = 'live';
      draw();
      startEngine();
    } else {
      state.view = 'home';
      draw();
    }
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      toast(e.message, 'error');
      return signOut();
    }
    render(app, html`<div class="cd-card"><p class="error-text">${e.message}</p><button data-action="home">Try again</button></div>`);
  }
}

boot();
