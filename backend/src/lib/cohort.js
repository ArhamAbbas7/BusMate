// Cohort maths (SRS 6.5). Pure functions - no database - so they are easy to test.
//
// Cohort A: signup 1st-5th, active 1st -> last day of the month
// Cohort B: signup 15th-19th, active 15th -> 14th of next month
// A cohort starts on its window's first day and ends the day before the same day next month.
// Both cohorts are therefore active at the same time; each has its own pair of WhatsApp groups.
import { addDays, parts, ymd } from './time.js';

export const DEFAULT_WINDOWS = { A: { start: 1, end: 5 }, B: { start: 15, end: 19 } };
export const COHORT_CODES = ['A', 'B'];

/** The cohort instance with `code` that starts in year y / month m. */
export function cohortInstance(code, y, m, windows = DEFAULT_WINDOWS) {
  const w = windows[code];
  const start = ymd(y, m, w.start);
  return {
    code,
    start_date: start,
    end_date: addDays(ymd(y, m + 1, w.start), -1),
    signup_start: start,
    signup_end: ymd(y, m, w.end),
  };
}

/** The instance of `code` that is running on `today`. */
export function activeInstance(code, today, windows = DEFAULT_WINDOWS) {
  const { y, m, d } = parts(today);
  return d >= windows[code].start ? cohortInstance(code, y, m, windows) : cohortInstance(code, y, m - 1, windows);
}

/** Both running cohort instances, keyed by code. */
export function activeCohorts(today, windows = DEFAULT_WINDOWS) {
  return { A: activeInstance('A', today, windows), B: activeInstance('B', today, windows) };
}

/**
 * The cohort whose signup window is open today, or null.
 * With force=true (dev/testing), signups go to the most recently started cohort.
 */
export function openSignupCohort(today, windows = DEFAULT_WINDOWS, force = false) {
  const { y, m } = parts(today);
  for (const code of COHORT_CODES) {
    const inst = cohortInstance(code, y, m, windows);
    if (today >= inst.signup_start && today <= inst.signup_end) return { ...inst, forced: false };
  }
  if (!force) return null;
  const act = activeCohorts(today, windows);
  const latest = act.A.start_date >= act.B.start_date ? act.A : act.B;
  return { ...latest, forced: true };
}

/** The next signup window that opens after today. */
export function nextSignupWindow(today, windows = DEFAULT_WINDOWS) {
  const { y, m } = parts(today);
  const candidates = [];
  for (const offset of [0, 1, 2]) {
    for (const code of COHORT_CODES) candidates.push(cohortInstance(code, y, m + offset, windows));
  }
  return candidates.filter((c) => c.signup_start > today).sort((a, b) => a.signup_start.localeCompare(b.signup_start))[0];
}

/** The next instance of the same cohort code (used for renewals). */
export function nextInstanceOf(inst, windows = DEFAULT_WINDOWS) {
  const { y, m } = parts(inst.start_date);
  return cohortInstance(inst.code, y, m + 1, windows);
}

/** Calendar of cohort instances for a span of months (for the admin calendar). */
export function calendar(today, months = 3, windows = DEFAULT_WINDOWS) {
  const { y, m } = parts(today);
  const out = [];
  for (let i = -1; i < months; i++) {
    for (const code of COHORT_CODES) out.push(cohortInstance(code, y, m + i, windows));
  }
  return out.sort((a, b) => a.start_date.localeCompare(b.start_date));
}
