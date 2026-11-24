// Sidebar layout for the developer console and operator admin.
import { logoutStaff, stopImpersonation } from './api.js';
import { icon } from './icons.js';
import { bindThemeSwitcher, themeSwitcher } from './theme.js';
import { $, html, initials, logo, pkgBadge, render } from './ui.js';

const NAV = {
  developer: [
    { section: 'Platform' },
    { id: 'operators', href: '/dev/', ico: 'building-2', label: 'Operators' },
    { id: 'packages', href: '/dev/packages', ico: 'sliders-horizontal', label: 'Packages' },
    { id: 'messages', href: '/dev/messages', ico: 'toggle-right', label: 'Paid messages' },
    { section: 'Monitoring' },
    { id: 'health', href: '/dev/health', ico: 'activity', label: 'System health' },
    { id: 'outbox', href: '/dev/outbox', ico: 'message-square-text', label: 'Message outbox' },
    { id: 'costs', href: '/dev/costs', ico: 'chart-no-axes-column', label: 'Costs' },
    { id: 'audit', href: '/dev/audit', ico: 'scroll-text', label: 'Audit log' },
    { section: 'Account' },
    { id: 'settings', href: '/dev/settings', ico: 'settings', label: 'Settings' },
  ],
  admin: [
    { section: 'Operations' },
    { id: 'dashboard', href: '/admin/', ico: 'layout-dashboard', label: 'Overview' },
    { id: 'trips', href: '/admin/trips', ico: 'bus-front', label: 'Trips' },
    { id: 'payments', href: '/admin/payments', ico: 'receipt', label: 'Payments', count: 'pending_payments' },
    { id: 'subscribers', href: '/admin/subscribers', ico: 'users', label: 'Subscribers' },
    { id: 'cohorts', href: '/admin/cohorts', ico: 'calendar-range', label: 'Cohorts', count: 'switch_due' },
    { id: 'waitlist', href: '/admin/waitlist', ico: 'hourglass', label: 'Waitlist' },
    { section: 'Setup' },
    { id: 'routes', href: '/admin/routes', ico: 'route', label: 'Routes' },
    { id: 'conductors', href: '/admin/conductors', ico: 'id-card', label: 'Conductors' },
    { id: 'settings', href: '/admin/settings', ico: 'settings', label: 'Settings' },
  ],
};

/**
 * Render the shell and return the content element.
 * counts: optional { pending_payments: n, ... } for nav badges.
 */
export function mountShell(role, active, me, counts = {}) {
  document.body.classList.add('app');
  const wsName = role === 'admin' ? me.operator?.name : 'EV Bus Live';
  const wsSub = role === 'admin' ? html`${pkgBadge(me.operator?.package)}` : html`Developer console`;
  render(
    document.body,
    html`
    ${me.impersonating ? html`<div class="banner banner-imp">${icon('eye', 15)}<span>Viewing <b>${me.operator?.name}</b> as its admin. Every action is logged.</span><button class="btn-sm" id="stop-imp">Exit impersonation</button></div>` : ''}
    <div class="shell" id="shell">
      <aside class="sidebar" id="sidebar">
        <div class="workspace">${logo(30)}<div style="min-width:0"><div class="ws-name">${wsName}</div><div class="ws-sub">${wsSub}</div></div></div>
        <nav class="nav">
          ${NAV[role].map((n) =>
            n.section
              ? html`<div class="nav-section">${n.section}</div>`
              : html`<a href="${n.href}" class="${n.id === active ? 'active' : ''}">${icon(n.ico, 16)}<span>${n.label}</span>${n.count && counts[n.count] ? html`<span class="count">${counts[n.count]}</span>` : ''}</a>`,
          )}
        </nav>
        <div class="sidebar-foot">
          <div class="row between" style="padding:0 6px 10px"><span class="small muted">Appearance</span>${themeSwitcher()}</div>
          <div class="user-chip">
            <span class="avatar">${initials(me.name)}</span>
            <div class="meta"><div class="who">${me.name}</div><div class="sub">${role === 'admin' ? 'Operator admin' : me.email || 'Developer'}</div></div>
            <button class="icon-btn" id="logout" title="Sign out" aria-label="Sign out">${icon('log-out', 16)}</button>
          </div>
        </div>
      </aside>
      <div class="main">
        <div class="topbar"><button class="icon-btn" id="menu" aria-label="Open menu">${icon('menu', 18)}</button><div class="brand">${logo(24)}<span>${wsName}</span></div></div>
        <main class="content" id="content"><div class="loading">Loading…</div></main>
      </div>
    </div>`,
  );
  $('#logout').addEventListener('click', () => (me.impersonating ? stopImpersonation() : logoutStaff()));
  $('#stop-imp')?.addEventListener('click', stopImpersonation);
  bindThemeSwitcher($('#sidebar'));
  const shell = $('#shell');
  $('#menu').addEventListener('click', () => {
    shell.classList.add('nav-open');
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.addEventListener('click', () => {
      shell.classList.remove('nav-open');
      scrim.remove();
    });
    document.body.appendChild(scrim);
  });
  return $('#content');
}

/** Page header. eyebrow is optional small text above the title (e.g. a back link). */
export function pageHead(title, subtitle, actions = '', eyebrow = '') {
  return html`<div class="page-head"><div>${eyebrow ? html`<div class="eyebrow">${eyebrow}</div>` : ''}<h1>${title}</h1>${subtitle ? html`<p>${subtitle}</p>` : ''}</div><div class="page-actions">${actions}</div></div>`;
}

/** Back link for detail pages. */
export const backLink = (href, label) => html`<a href="${href}" class="row" style="gap:4px">${icon('arrow-left', 14)}${label}</a>`;
