// Small UI toolkit: safe HTML templating, formatting, toasts, modals, clipboard.
import { icon } from './icons.js';

// ---------- safe HTML ----------
class SafeHtml {
  constructor(s) { this.__html = s; }
  toString() { return this.__html; }
}
export const raw = (s) => new SafeHtml(String(s ?? ''));
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function toHtml(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHtml) return v.__html;
  if (Array.isArray(v)) return v.map(toHtml).join('');
  return esc(v);
}
/** Tagged template: interpolated values are escaped unless they come from html`` or raw(). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? toHtml(vals[i]) : ''); });
  return new SafeHtml(out);
}
export function render(el, content) {
  el.innerHTML = toHtml(content);
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Delegate clicks on [data-action] inside root to handlers[action](el, event). */
export function onAction(root, handlers) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const fn = handlers[el.dataset.action];
    if (fn) {
      e.preventDefault();
      fn(el, e);
    }
  });
}

// ---------- brand ----------
/** The product mark: a route line ending in a live dot. */
export function logo(size = 28) {
  const g = Math.round(size * 0.62);
  return html`<span class="brand-mark" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.29)}px">${raw(
    `<svg width="${g}" height="${g}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5.5 18.5c0-3.6 2.7-5.5 6.5-5.5s6.5-1.9 6.5-5.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="5.5" cy="18.5" r="2.2" fill="currentColor"/><circle cx="18.5" cy="7" r="3" fill="#22c55e"/></svg>`,
  )}</span>`;
}
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

// ---------- formatting ----------
const TZ = 'Asia/Karachi';
const isDateOnly = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
export function fmtDate(v) {
  if (!v) return '–';
  const d = isDateOnly(v) ? new Date(`${v}T00:00:00Z`) : new Date(v);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: isDateOnly(v) ? 'UTC' : TZ });
}
export function fmtDateShort(v) {
  if (!v) return '–';
  return new Date(`${v}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
export function fmtDateTime(v) {
  if (!v) return '–';
  return new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
export function fmtTime(v) {
  if (!v) return '–';
  return new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
export function timeAgo(v) {
  if (!v) return 'never';
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export function duration(fromIso, toIso) {
  const min = Math.max(0, Math.round(((toIso ? new Date(toIso) : new Date()) - new Date(fromIso)) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
}
export const money = (n) => `Rs ${Number(n || 0).toLocaleString('en-PK')}`;
export const num = (n) => Number(n || 0).toLocaleString('en-PK');
export function phone(e164) {
  if (!e164) return '';
  if (e164.startsWith('+92')) {
    const l = `0${e164.slice(3)}`;
    return `${l.slice(0, 4)} ${l.slice(4)}`;
  }
  return e164;
}
export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

const STATUS = {
  active: 'green', confirmed: 'green', sent: 'green', ok: 'green', converted: 'green', completed: 'gray',
  simulated: 'violet', notified: 'blue',
  pending: 'amber', waiting: 'amber',
  auto_closed: 'gray', skipped: 'gray', inactive: 'gray', expired: 'gray', cancelled: 'gray', removed: 'gray', disabled: 'gray', revoked: 'gray',
  rejected: 'red', failed: 'red', suspended: 'red',
};
export function badge(status, label) {
  return html`<span class="badge ${STATUS[status] || 'gray'}">${label ?? String(status).replace(/_/g, ' ')}</span>`;
}
export function pkgBadge(p) {
  return html`<span class="badge plain pkg ${p === 'gold' ? 'gold' : p === 'premium' ? 'blue' : 'gray'}">${p}</span>`;
}
export const cohortBadge = (c) => html`<span class="badge cohort-${String(c).toLowerCase()}">Cohort ${c}</span>`;
export const liveBadge = (label = 'Live') => html`<span class="badge live">${label}</span>`;
export const routeChip = (code, light = false) => html`<span class="route-chip ${light ? 'light' : ''}">${code}</span>`;
export const methodLabel = (m) => ({ jazzcash: 'JazzCash', easypaisa: 'Easypaisa', bank: 'Bank transfer', cash: 'Cash', manual: 'Complimentary' })[m] || m || '–';

/** Empty state block. */
export function emptyState(ico, title, desc = '', action = '') {
  return html`<div class="empty"><div class="empty-ico">${icon(ico, 20)}</div><div class="t">${title}</div>${desc ? html`<div class="d">${desc}</div>` : ''}${action}</div>`;
}

const ALERT_ICONS = { info: 'info', warn: 'triangle-alert', ok: 'circle-check', danger: 'circle-alert' };
/** Callout with icon. */
export function callout(level, body, action = '') {
  return html`<div class="alert ${level}">${icon(ALERT_ICONS[level] || 'info', 16)}<div class="alert-body">${body}</div>${action ? html`<div class="alert-action">${action}</div>` : ''}</div>`;
}

// ---------- toasts ----------
let toastBox;
export function toast(message, type = 'ok', ms = 3500) {
  if (!toastBox) {
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    toastBox.setAttribute('role', 'status');
    document.body.appendChild(toastBox);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  render(t, html`${icon(type === 'error' ? 'circle-x' : 'circle-check', 16)}<span>${message}</span>`);
  toastBox.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
export const toastError = (e) => toast(e?.message || String(e), 'error', 5000);

// ---------- modals ----------
/**
 * Open a modal. `body` is html``. `onSubmit(form, modal)` runs when the primary button / form submits;
 * return false to keep it open. Resolves with the onSubmit result, or null if closed.
 */
export function modal({ title, description = '', body, submitLabel = 'Save', cancelLabel = 'Cancel', danger = false, wide = false, onSubmit, hideSubmit = false }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    render(
      back,
      html`<form class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" novalidate>
        <div class="modal-head"><div><h2>${title}</h2>${description ? html`<p class="muted small mt-1 mb-0">${description}</p>` : ''}</div><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x', 16)}</button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">
          <button type="button" data-close>${cancelLabel}</button>
          ${hideSubmit ? '' : html`<button type="submit" class="${danger ? 'btn-danger' : 'btn-primary'}">${submitLabel}</button>`}
        </div>
      </form>`,
    );
    document.body.appendChild(back);
    const form = back.querySelector('form');
    const close = (v) => {
      back.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => e.key === 'Escape' && close(null);
    document.addEventListener('keydown', onKey);
    back.addEventListener('mousedown', (e) => e.target === back && close(null));
    back.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(null)));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!onSubmit) return close(true);
      const btn = form.querySelector('[type=submit]');
      const errBox = form.querySelector('.modal-error') || form.querySelector('.modal-body').appendChild(Object.assign(document.createElement('div'), { className: 'error-text modal-error' }));
      errBox.textContent = '';
      btn?.classList.add('busy');
      try {
        const r = await onSubmit(form, back);
        if (r !== false) close(r ?? true);
      } catch (err) {
        errBox.textContent = err.message || String(err);
      } finally {
        btn?.classList.remove('busy');
      }
    });
    setTimeout(() => form.querySelector('.modal-body input:not([type=hidden]):not([type=checkbox]), .modal-body select, .modal-body textarea')?.focus(), 30);
  });
}

export function confirmDialog(message, { title = 'Are you sure?', confirmLabel = 'Confirm', danger = true } = {}) {
  return modal({ title, body: html`<p class="mb-0">${message}</p>`, submitLabel: confirmLabel, danger }).then((r) => !!r);
}

// ---------- forms ----------
export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.multi !== undefined) {
        out[el.name] ??= [];
        if (el.checked) out[el.name].push(el.value);
      } else out[el.name] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else if (el.type !== 'file' && el.type !== 'submit' && el.type !== 'button') out[el.name] = el.value.trim();
  }
  return out;
}

export async function withBusy(btn, fn) {
  btn?.classList.add('busy');
  try {
    return await fn();
  } finally {
    btn?.classList.remove('busy');
  }
}

// ---------- clipboard ----------
export async function copyText(text, label = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(label);
}

export const qs = (name) => new URLSearchParams(location.search).get(name);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function debounce(fn, ms = 300) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** Run fn now and every `ms` while the tab is visible. Returns stop(). */
export function poll(fn, ms) {
  let stopped = false;
  let timer;
  const tick = async () => {
    if (stopped) return;
    if (!document.hidden) {
      try { await fn(); } catch (e) { console.warn(e); }
    }
    timer = setTimeout(tick, ms);
  };
  tick();
  return () => { stopped = true; clearTimeout(timer); };
}

export { icon };
