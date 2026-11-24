// API client + token storage. Staff (developer/admin) and conductor sessions are kept separately,
// so one device can be logged in as both while testing.

const KEYS = { staff: 'evbus.staffToken', conductor: 'evbus.conductorToken', devBackup: 'evbus.devBackupToken' };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* private mode */ } },
};

export const session = {
  get staff() { return store.get(KEYS.staff); },
  set staff(v) { store.set(KEYS.staff, v); },
  get conductor() { return store.get(KEYS.conductor); },
  set conductor(v) { store.set(KEYS.conductor, v); },
  get devBackup() { return store.get(KEYS.devBackup); },
  set devBackup(v) { store.set(KEYS.devBackup, v); },
};

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/**
 * Call the backend. opts: { method, body (JSON), form (FormData), as: 'staff'|'conductor'|'none', blob: true }
 */
export async function api(path, opts = {}) {
  const { method = opts.body || opts.form ? 'POST' : 'GET', body, form, as = 'staff', blob = false } = opts;
  const headers = {};
  const token = as === 'none' ? null : session[as];
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  if (blob && res.ok) return res.blob();
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    if (res.status === 401 && as === 'staff' && !path.startsWith('/auth/login')) {
      session.staff = null;
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    }
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data);
  }
  return data;
}

/** Ensure a staff user with `role` is signed in; returns /auth/me. */
export async function requireRole(role) {
  if (!session.staff) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    return new Promise(() => {});
  }
  const me = await api('/auth/me');
  if (me.role !== role) {
    location.href = me.role === 'developer' ? '/dev/' : me.role === 'admin' ? '/admin/' : '/login';
    return new Promise(() => {});
  }
  return me;
}

export function logoutStaff() {
  session.staff = null;
  session.devBackup = null;
  location.href = '/login';
}

/** Developer -> act as an operator admin. */
export function startImpersonation(adminToken) {
  session.devBackup = session.staff;
  session.staff = adminToken;
  location.href = '/admin/';
}

export function stopImpersonation() {
  if (session.devBackup) {
    session.staff = session.devBackup;
    session.devBackup = null;
    location.href = '/dev/';
  } else logoutStaff();
}
