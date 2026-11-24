// Light / dark / system theme. The choice is stored per browser; "system" follows the OS setting.
import { icon } from './icons.js';
import { html, render } from './ui.js';

const KEY = 'evbus.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemeChoice() {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function isDark() {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr ? attr === 'dark' : media.matches;
}

export function setTheme(choice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch { /* storage blocked */ }
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
  window.dispatchEvent(new CustomEvent('themechange', { detail: { dark: isDark() } }));
}

media.addEventListener('change', () => {
  if (getThemeChoice() === 'system') window.dispatchEvent(new CustomEvent('themechange', { detail: { dark: isDark() } }));
});

/** Three-way segmented control (sidebar / settings). */
export function themeSwitcher() {
  const c = getThemeChoice();
  const opt = (v, ico, label) => html`<button type="button" class="${c === v ? 'active' : ''}" data-theme-set="${v}" title="${label}" aria-label="${label}" aria-pressed="${c === v}">${icon(ico, 14)}</button>`;
  return html`<div class="theme-seg" role="group" aria-label="Theme">${opt('light', 'sun', 'Light')}${opt('dark', 'moon', 'Dark')}${opt('system', 'monitor', 'System')}</div>`;
}

/** Wire every [data-theme-set] button under root. */
export function bindThemeSwitcher(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-set]');
    if (!b) return;
    setTheme(b.dataset.themeSet);
    for (const x of root.querySelectorAll('[data-theme-set]')) {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    }
  });
}

/**
 * Compact icon button that flips light <-> dark (for headers on public pages and the conductor app).
 * position: 'append' (default) or 'before-logout' (inserted before #logout).
 */
export function themeToggle(container, position = 'append') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn theme-toggle';
  const paint = () => {
    if (mounted && !btn.isConnected) return window.removeEventListener('themechange', paint);
    const dark = isDark();
    btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.setAttribute('aria-label', btn.title);
    render(btn, icon(dark ? 'sun' : 'moon', 17));
  };
  let mounted = false;
  btn.addEventListener('click', () => setTheme(isDark() ? 'light' : 'dark'));
  window.addEventListener('themechange', paint);
  paint();
  mounted = true;
  const logout = container.querySelector('#logout');
  if (position === 'before-logout' && logout) {
    const wrap = document.createElement('div');
    wrap.className = 'row nowrap';
    wrap.style.gap = '4px';
    logout.replaceWith(wrap);
    wrap.append(btn, logout);
  } else container.appendChild(btn);
  return btn;
}
