// Background jobs. Locally these run on timers inside the API process.
// On Azure they become Timer-triggered Functions calling the same service functions.
import { autoCloseStaleTrips } from './services/trips.js';
import { notifyWaitlist, sendRenewalReminders } from './services/subscriptions.js';
import { query } from './db/index.js';

const JOBS = {
  autoCloseTrips: { everyMs: 60_000, run: autoCloseStaleTrips, label: 'Auto-close trips with no GPS for 10 min (SR-03)' },
  renewalReminders: { everyMs: 15 * 60_000, run: sendRenewalReminders, label: 'Renewal reminders T-7 / T-3 (FR-P-12)' },
  waitlistNotify: { everyMs: 30 * 60_000, run: () => notifyWaitlist(), label: 'Notify waitlist when a signup window opens' },
  cleanupOtp: {
    everyMs: 60 * 60_000,
    run: async () => ({ deleted: (await query(`DELETE FROM otp_codes WHERE created_at < now() - interval '1 day'`)).rowCount }),
    label: 'Delete old OTP codes',
  },
};

const state = Object.fromEntries(Object.keys(JOBS).map((k) => [k, { lastRunAt: null, lastResult: null, lastError: null, running: false }]));
const timers = [];

async function runJob(name) {
  const job = JOBS[name];
  const s = state[name];
  if (s.running) return { skipped: 'already running' };
  s.running = true;
  try {
    s.lastResult = await job.run();
    s.lastError = null;
  } catch (e) {
    s.lastError = e.message;
    console.error(`[jobs] ${name} failed:`, e);
  } finally {
    s.lastRunAt = new Date().toISOString();
    s.running = false;
  }
  return { result: s.lastResult, error: s.lastError };
}

export function startJobs() {
  for (const [name, job] of Object.entries(JOBS)) {
    setTimeout(() => runJob(name), 5_000).unref();
    timers.push(setInterval(() => runJob(name), job.everyMs));
  }
}

export function stopJobs() {
  for (const t of timers) clearInterval(t);
}

export async function runJobNow(name) {
  if (!JOBS[name]) return { error: `Unknown job ${name}` };
  return runJob(name);
}

export function jobStatus() {
  return Object.entries(JOBS).map(([name, j]) => ({ name, label: j.label, everySeconds: j.everyMs / 1000, ...state[name] }));
}
