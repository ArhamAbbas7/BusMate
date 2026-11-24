import { api } from '../api.js';
import { icon } from '../icons.js';
import { themeToggle } from '../theme.js';
import { $, html, logo, render } from '../ui.js';

const app = $('#app');

// Stylised map for the hero preview (pure SVG, no tiles)
const mockMap = html`<svg viewBox="0 0 520 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <g style="stroke:var(--border-strong)" stroke-width="10" fill="none" stroke-linecap="round">
    <path d="M-20 70 L540 40"/><path d="M-20 210 L540 250"/><path d="M120 -20 L160 320"/><path d="M360 -20 L330 320"/><path d="M-20 140 C120 150 220 120 540 150"/>
  </g>
  <g style="stroke:var(--surface)" stroke-width="6" fill="none" stroke-linecap="round">
    <path d="M-20 70 L540 40"/><path d="M-20 210 L540 250"/><path d="M120 -20 L160 320"/><path d="M360 -20 L330 320"/><path d="M-20 140 C120 150 220 120 540 150"/>
  </g>
  <rect x="190" y="170" width="90" height="60" rx="8" style="fill:var(--green-soft)"/><rect x="400" y="70" width="80" height="50" rx="8" style="fill:var(--green-soft)"/>
  <path d="M60 250 C140 230 150 160 230 140 S360 120 420 70" style="stroke:var(--map-line)" stroke-width="4" fill="none" stroke-linecap="round" opacity=".85"/>
  <path d="M60 250 C140 230 150 160 230 140" style="stroke:var(--green)" stroke-width="5" fill="none" stroke-linecap="round"/>
  <circle cx="60" cy="250" r="6" style="fill:var(--surface);stroke:var(--map-line)" stroke-width="3"/>
  <circle cx="420" cy="70" r="6" style="fill:var(--surface);stroke:var(--map-line)" stroke-width="3"/>
  <circle cx="230" cy="140" r="22" style="fill:var(--green)" opacity=".18"/>
  <circle cx="230" cy="140" r="14" fill="#18181b" stroke="#fff" stroke-width="3"/>
  <g transform="translate(222 132)" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="11" rx="2.5"/><path d="M2 8h12M5 15v-2M11 15v-2"/></g>
</svg>`;

render(
  app,
  html`
  <header class="site-nav"><div class="in">
    <a class="brand" href="/">${logo(28)}<span>EV Bus Live</span></a>
    <nav><a href="#how">How it works</a><a href="#portals">Portals</a><a href="/join/">For passengers</a></nav>
    <span class="spacer"></span>
    <span id="theme-slot"></span>
    <a class="btn btn-ghost" href="/login">Sign in</a>
    <a class="btn btn-primary" href="/join/">Get live tracking</a>
  </div></header>

  <main class="site-wrap">
    <section class="hero">
      <span class="pill"><span class="tag">New</span>Live tracking for electric bus fleets</span>
      <h1>Know where your bus is.<br><span class="soft">Right inside WhatsApp.</span></h1>
      <p class="lead">No app to install and no hardware to fit. The conductor's phone shares the bus location, and riders follow it from their WhatsApp group.</p>
      <div class="ctas">
        <a class="btn btn-primary btn-lg" href="/join/">Subscribe to a route ${icon('arrow-right', 16)}</a>
        <a class="btn btn-lg" href="/login">Operator sign in</a>
      </div>

      <div class="showcase mt-3" style="margin-top:56px">
        <div class="panel">
          <div class="panel-bar"><i></i><i></i><i></i><span>Live map · EV1 Towards University</span></div>
          <div class="mock-map">${mockMap}
            <div class="mock-card"><span class="icon-tile dark">${icon('bus-front', 18)}</span>
              <div><div class="strong">Bus is 4 minutes away</div><div class="small muted">Updated 12s ago · Model Town stop</div></div>
              <span class="badge live" style="margin-left:auto">Live</span></div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-bar"><i></i><i></i><i></i><span>WhatsApp · EV1 Towards · Cohort A</span></div>
          <div class="chat">
            <div class="bubble"><b>EV1 is now live</b>, towards University.<br>Started 07:42 by Imran.<br><span class="lnk">evbus.live/t/ev1</span><div class="time">07:42</div></div>
            <div class="bubble me">Perfect, leaving home now. Thanks!<div class="time">07:43</div></div>
            <div class="bubble"><b>Welcome Sara!</b> Your EV1 tracking is active until 30 Nov. Join your groups below.<div class="time">08:10</div></div>
          </div>
        </div>
      </div>
    </section>

    <section id="how" class="features">
      <div class="feature"><span class="icon-tile">${icon('smartphone', 18)}</span><h3>No app install</h3><p>Riders get live updates and a map link in a WhatsApp group they already use every day.</p></div>
      <div class="feature"><span class="icon-tile">${icon('navigation', 18)}</span><h3>No hardware</h3><p>The conductor taps Start. Their phone sends the bus position every 30 seconds, and keeps it when offline.</p></div>
      <div class="feature"><span class="icon-tile">${icon('shield-check', 18)}</span><h3>Built for operators</h3><p>Paid subscriptions with local wallets, clean 30-day cohorts and conductor compliance in one dashboard.</p></div>
    </section>

    <div id="portals" class="section-head"><div class="k">Portals</div><h2>One platform, four ways in</h2></div>
    <div class="grid grid-4">
      <a class="card portal" href="/join/"><span class="icon-tile">${icon('ticket', 18)}</span><h3>Passengers</h3><p>Subscribe to a route, pay with JazzCash or Easypaisa and receive your group links.</p><span class="go">Sign up ${icon('arrow-right', 14)}</span></a>
      <a class="card portal" href="/conductor/"><span class="icon-tile">${icon('id-card', 18)}</span><h3>Conductors</h3><p>Start and stop trips from your phone. One tap shares the bus location.</p><span class="go">Open conductor app ${icon('arrow-right', 14)}</span></a>
      <a class="card portal" href="/login"><span class="icon-tile">${icon('layout-dashboard', 18)}</span><h3>Operator admins</h3><p>Routes, conductors, payment checks, subscribers and the cohort calendar.</p><span class="go">Admin sign in ${icon('arrow-right', 14)}</span></a>
      <a class="card portal" href="/login"><span class="icon-tile">${icon('server', 18)}</span><h3>Platform</h3><p>Operators, packages and feature flags, system health and the audit log.</p><span class="go">Developer console ${icon('arrow-right', 14)}</span></a>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><div><h2>Find your bus service</h2><div class="card-sub">Choose your operator to subscribe.</div></div></div>
        <div id="services"><div class="skeleton"></div></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Local demo access</h2><div class="card-sub">Seeded accounts for this development build.</div></div>${icon('key-round', 18, 'muted')}</div>
        <dl class="kv small">
          <dt>Developer</dt><dd><code>dev@evbus.local</code> · <code>Dev@12345</code></dd>
          <dt>Admin</dt><dd><code>admin@evservices.local</code> · <code>Admin@12345</code></dd>
          <dt>Admin 2</dt><dd><code>admin@urbantransit.local</code> · <code>Admin@12345</code></dd>
          <dt>Conductor</dt><dd><code>0300 1234567</code> or <code>0300 7654321</code></dd>
        </dl>
        <p class="small muted mt-2 mb-0">WhatsApp isn't connected yet. Messages appear in Developer console → Message outbox.</p>
      </div>
    </div>

    <footer class="site-foot row between"><span class="row">${logo(22)} <span>EV Bus Live</span></span><span>No app. No hardware. Live tracking in WhatsApp.</span></footer>
  </main>`,
);

themeToggle($('#theme-slot'));

const ops = await api('/public/operators', { as: 'none' }).catch(() => []);
render(
  $('#services'),
  ops.length
    ? html`<div class="choice-grid">${ops.map((o) => html`<a class="choice" href="/join/?op=${encodeURIComponent(o.slug)}"><span class="icon-tile">${icon('bus', 18)}</span><span><span class="title">${o.name}</span><br><span class="sub muted">Subscribe to live tracking</span></span><span style="margin-left:auto" class="muted">${icon('chevron-right', 16)}</span></a>`)}</div>`
    : html`<p class="muted mb-0">No bus services are live yet.</p>`,
);
