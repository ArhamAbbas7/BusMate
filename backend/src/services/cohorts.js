import { one, query as dbQuery } from '../db/index.js';
import { activeCohorts, activeInstance, nextSignupWindow, openSignupCohort } from '../lib/cohort.js';
import { getConfig, getWindows } from '../lib/platform.js';
import { todayISO } from '../lib/time.js';

/** Upsert a cohort instance row and return it. `q` may be a transaction handle. */
export async function ensureCohort(inst, q = { query: dbQuery }) {
  const r = await q.query(
    `INSERT INTO cohorts (code, start_date, end_date, signup_start, signup_end)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (code, start_date) DO UPDATE SET end_date = EXCLUDED.end_date
     RETURNING *`,
    [inst.code, inst.start_date, inst.end_date, inst.signup_start, inst.signup_end],
  );
  return r.rows[0];
}

/** Everything the UI needs to know about cohorts right now. */
export async function cohortState(today = todayISO()) {
  const windows = await getWindows();
  const forced = !!(await getConfig('force_signup_window', false));
  const active = activeCohorts(today, windows);
  const open = openSignupCohort(today, windows, forced);
  const next = nextSignupWindow(today, windows);
  return { today, windows, forced, active, open, next };
}

export async function activeCohortRow(code, today = todayISO()) {
  const windows = await getWindows();
  return ensureCohort(activeInstance(code, today, windows));
}

export async function cohortById(id) {
  return one(`SELECT * FROM cohorts WHERE id = $1`, [id]);
}
