// Passenger signup, payment verification, auto-invite, cohort switch, renewals, waitlist (SRS 6.4, 6.8)
import { many, one, query, tx } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { activeInstance, nextInstanceOf } from '../lib/cohort.js';
import { getFeatures } from '../lib/features.js';
import { HttpError, conflict, notFound } from '../lib/http.js';
import { getWindows } from '../lib/platform.js';
import { daysBetween, todayISO } from '../lib/time.js';
import { sendMessage } from '../messaging/index.js';
import {
  cohortSwitchedMessage,
  expiredMessage,
  inviteMessage,
  paymentRejectedMessage,
  renewalReminderMessage,
  signupReceivedMessage,
  waitlistJoinedMessage,
  windowOpenMessage,
} from '../messaging/messages.js';
import { activeCohortRow, cohortState, ensureCohort } from './cohorts.js';

const SUB_SELECT = `
  SELECT s.*, sb.name AS subscriber_name, sb.phone AS subscriber_phone,
         r.code AS route_code, r.name AS route_name, r.live_token, r.towards_label, r.backward_label,
         c.code AS cohort_code, c.start_date AS cohort_start, c.end_date AS cohort_end,
         o.name AS operator_name, o.slug AS operator_slug
    FROM subscriptions s
    JOIN subscribers sb ON sb.id = s.subscriber_id
    JOIN routes r ON r.id = s.route_id
    JOIN cohorts c ON c.id = s.cohort_id
    JOIN operators o ON o.id = s.operator_id`;

export async function getSubscription(id, operatorId = null) {
  const row = await one(`${SUB_SELECT} WHERE s.id = $1 ${operatorId ? 'AND s.operator_id = $2' : ''}`, operatorId ? [id, operatorId] : [id]);
  if (!row) throw notFound('Subscription');
  return row;
}

async function routeGroups(routeId, cohortCode) {
  const rows = await many(`SELECT * FROM route_groups WHERE route_id = $1 AND cohort = $2`, [routeId, cohortCode]);
  return { towards: rows.find((g) => g.direction === 'towards'), backward: rows.find((g) => g.direction === 'backward') };
}

/** Send (or resend) the WhatsApp invite with both direction links for the subscription's cohort. */
export async function sendInvite(subId) {
  const s = await getSubscription(subId);
  const g = await routeGroups(s.route_id, s.cohort_code);
  const msg = inviteMessage({
    name: s.subscriber_name,
    operatorName: s.operator_name,
    routeCode: s.route_code,
    routeName: s.route_name,
    cohort: s.cohort_code,
    expiry: s.subscription_expiry,
    towardsLabel: s.towards_label,
    backwardLabel: s.backward_label,
    towardsLink: g.towards?.invite_link,
    backwardLink: g.backward?.invite_link,
    liveToken: s.live_token,
  });
  const result = await sendMessage({ to: s.subscriber_phone, message: msg, operatorId: s.operator_id });
  if (result.ok) await query(`UPDATE subscriptions SET invite_sent_at = now() WHERE id = $1`, [subId]);
  return result;
}

async function upsertSubscriber(q, phone, name) {
  const r = await q.query(
    `INSERT INTO subscribers (phone, name) VALUES ($1,$2)
     ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name RETURNING *`,
    [phone, name],
  );
  return r.rows[0];
}

/** Read the limit BEFORE opening a transaction (embedded Postgres serialises queries; nested reads would deadlock). */
async function routesPerSubscriberLimit(operatorId) {
  return (await getFeatures(operatorId)).features.routes_per_subscriber ?? null;
}

async function assertRoutesPerSubscriber(q, limit, operatorId, subscriberId, cohortId, routeId) {
  if (limit === null || limit === undefined) return;
  const r = await q.query(
    `SELECT count(DISTINCT route_id)::int AS n FROM subscriptions
      WHERE operator_id = $1 AND subscriber_id = $2 AND cohort_id = $3 AND route_id <> $4 AND status IN ('pending','active')`,
    [operatorId, subscriberId, cohortId, routeId],
  );
  if (r.rows[0].n >= Number(limit)) {
    throw new HttpError(409, `Each subscriber can follow ${limit} route${limit == 1 ? '' : 's'} per cycle on this service.`);
  }
}

/** FR-P-01..07: passenger signup during an open window. */
export async function createSignup(operator, { routeId, name, phone, paymentMethod, paymentRef, proofFile }) {
  const route = await one(`SELECT * FROM routes WHERE id = $1 AND operator_id = $2 AND status = 'active'`, [routeId, operator.id]);
  if (!route) throw notFound('Route');
  const state = await cohortState();
  if (!state.open) {
    throw new HttpError(409, 'Signups are closed right now. Join the waitlist and we will message you when the next window opens.', {
      windowClosed: true,
      nextWindow: state.next,
    });
  }
  const cohort = await ensureCohort(state.open);
  const limit = await routesPerSubscriberLimit(operator.id);

  const sub = await tx(async (q) => {
    const subscriber = await upsertSubscriber(q, phone, name);
    await assertRoutesPerSubscriber(q, limit, operator.id, subscriber.id, cohort.id, route.id);
    const existing = (
      await q.query(
        `SELECT * FROM subscriptions WHERE subscriber_id = $1 AND route_id = $2 AND cohort_id = $3 AND status IN ('pending','active')`,
        [subscriber.id, route.id, cohort.id],
      )
    ).rows[0];
    if (existing?.status === 'active') throw conflict('You already have an active subscription for this route in this cycle.');
    const hadBefore = (
      await q.query(`SELECT 1 FROM subscriptions WHERE subscriber_id = $1 AND route_id = $2 AND status IN ('active','expired') LIMIT 1`, [
        subscriber.id,
        route.id,
      ])
    ).rows.length;
    let row;
    if (existing) {
      // Re-submission while pending: replace payment details
      row = (
        await q.query(
          `UPDATE subscriptions SET payment_method = $2, payment_ref = $3, proof_path = COALESCE($4, proof_path), created_at = now()
            WHERE id = $1 RETURNING *`,
          [existing.id, paymentMethod, paymentRef, proofFile ?? null],
        )
      ).rows[0];
    } else {
      row = (
        await q.query(
          `INSERT INTO subscriptions (operator_id, subscriber_id, route_id, cohort_id, status, payment_status, payment_method, payment_ref, proof_path, amount, source)
           VALUES ($1,$2,$3,$4,'pending','pending',$5,$6,$7,$8,$9) RETURNING *`,
          [operator.id, subscriber.id, route.id, cohort.id, paymentMethod, paymentRef, proofFile ?? null, operator.passenger_price, hadBefore ? 'renewal' : 'signup'],
        )
      ).rows[0];
    }
    await q.query(`UPDATE signup_waitlist SET status = 'converted' WHERE route_id = $1 AND phone = $2 AND status IN ('waiting','notified')`, [
      route.id,
      phone,
    ]);
    return row;
  });

  await sendMessage({
    to: phone,
    message: signupReceivedMessage({ name, routeCode: route.code, operatorName: operator.name }),
    operatorId: operator.id,
  });
  await audit({ role: 'passenger', name: phone }, 'subscription.signup', {
    operatorId: operator.id,
    entityType: 'subscription',
    entityId: sub.id,
    details: { route: route.code, cohort: cohort.code, forcedWindow: !!state.open.forced },
  });
  return { id: sub.id, status: sub.status, cohort: cohort.code, cohortEnd: cohort.end_date, route: route.code };
}

/** FR-A-12 + FR-A-14: confirm payment, activate, auto-invite. */
export async function confirmPayment(auth, subId) {
  const today = todayISO();
  const sub = await tx(async (q) => {
    const s = (
      await q.query(
        `SELECT s.*, c.end_date FROM subscriptions s JOIN cohorts c ON c.id = s.cohort_id
          WHERE s.id = $1 AND s.operator_id = $2 FOR UPDATE OF s`,
        [subId, auth.operatorId],
      )
    ).rows[0];
    if (!s) throw notFound('Payment');
    if (s.status !== 'pending') throw conflict(`This payment is already ${s.payment_status}.`);
    return (
      await q.query(
        `UPDATE subscriptions SET payment_status = 'confirmed', status = 'active', subscription_start = $2, subscription_expiry = $3,
                confirmed_by = $4, confirmed_at = now() WHERE id = $1 RETURNING *`,
        [subId, today, s.end_date, auth.id],
      )
    ).rows[0];
  });
  const invite = await sendInvite(sub.id);
  await audit(auth, 'payment.confirm', { entityType: 'subscription', entityId: sub.id, details: { invite: invite.status } });
  return { subscription: await getSubscription(sub.id), invite };
}

/** FR-A-13 */
export async function rejectPayment(auth, subId, reason) {
  const s = await getSubscription(subId, auth.operatorId);
  if (s.status !== 'pending') throw conflict(`This payment is already ${s.payment_status}.`);
  await query(`UPDATE subscriptions SET payment_status = 'rejected', status = 'rejected', rejection_reason = $2, confirmed_by = $3, confirmed_at = now() WHERE id = $1`, [
    subId,
    reason,
    auth.id,
  ]);
  await sendMessage({
    to: s.subscriber_phone,
    message: paymentRejectedMessage({ name: s.subscriber_name, routeCode: s.route_code, reason, slug: s.operator_slug }),
    operatorId: s.operator_id,
  });
  await audit(auth, 'payment.reject', { entityType: 'subscription', entityId: subId, details: { reason } });
  return getSubscription(subId);
}

/** FR-A-23: admin adds a subscriber manually (bypasses the signup window). */
export async function adminAddSubscription(auth, { routeId, name, phone, cohort: cohortCode, paymentMethod, paymentRef }) {
  const route = await one(`SELECT * FROM routes WHERE id = $1 AND operator_id = $2`, [routeId, auth.operatorId]);
  if (!route) throw notFound('Route');
  const operator = await one(`SELECT * FROM operators WHERE id = $1`, [auth.operatorId]);
  let code = cohortCode;
  if (!code) {
    const st = await cohortState();
    code = st.open?.code || (st.active.A.start_date >= st.active.B.start_date ? 'A' : 'B');
  }
  const cohort = await activeCohortRow(code);
  const today = todayISO();
  const limit = await routesPerSubscriberLimit(auth.operatorId);
  const sub = await tx(async (q) => {
    const subscriber = await upsertSubscriber(q, phone, name);
    await assertRoutesPerSubscriber(q, limit, auth.operatorId, subscriber.id, cohort.id, route.id);
    const r = await q.query(
      `INSERT INTO subscriptions (operator_id, subscriber_id, route_id, cohort_id, status, payment_status, payment_method, payment_ref, amount, source,
                                  subscription_start, subscription_expiry, confirmed_by, confirmed_at)
       VALUES ($1,$2,$3,$4,'active','confirmed',$5,$6,$7,'admin',$8,$9,$10, now()) RETURNING *`,
      [auth.operatorId, subscriber.id, route.id, cohort.id, paymentMethod || 'manual', paymentRef || null, operator.passenger_price, today, cohort.end_date, auth.id],
    );
    return r.rows[0];
  });
  const invite = await sendInvite(sub.id);
  await audit(auth, 'subscription.admin_add', { entityType: 'subscription', entityId: sub.id, details: { route: route.code, cohort: code } });
  return { subscription: await getSubscription(sub.id), invite };
}

/** FR-A-24 */
export async function removeSubscription(auth, subId) {
  const s = await getSubscription(subId, auth.operatorId);
  if (!['active', 'pending'].includes(s.status)) throw conflict('Only active or pending subscriptions can be removed.');
  await query(`UPDATE subscriptions SET status = 'cancelled', expired_at = now() WHERE id = $1`, [subId]);
  await audit(auth, 'subscription.remove', { entityType: 'subscription', entityId: subId, details: { phone: s.subscriber_phone } });
  const groups = await routeGroups(s.route_id, s.cohort_code);
  return { removed: true, removeFromGroups: [groups.towards, groups.backward].filter(Boolean) };
}

/** FR-A-20: move one active subscription to the other cohort (A->B or B->A). */
export async function switchCohort(auth, subId) {
  const s = await getSubscription(subId, auth.operatorId);
  if (s.status !== 'active') throw conflict('Only active subscriptions can switch cohort.');
  const targetCode = s.cohort_code === 'A' ? 'B' : 'A';
  const target = await activeCohortRow(targetCode);
  await query(`UPDATE subscriptions SET cohort_id = $2, subscription_expiry = $3, source = 'switch', reminder7_sent_at = NULL, reminder3_sent_at = NULL WHERE id = $1`, [
    subId,
    target.id,
    target.end_date,
  ]);
  const oldGroups = await routeGroups(s.route_id, s.cohort_code);
  await sendMessage({
    to: s.subscriber_phone,
    message: cohortSwitchedMessage({ name: s.subscriber_name, routeCode: s.route_code, cohort: targetCode, expiry: target.end_date }),
    operatorId: s.operator_id,
  });
  await sendInvite(subId);
  await audit(auth, 'subscription.switch_cohort', {
    entityType: 'subscription',
    entityId: subId,
    details: { from: s.cohort_code, to: targetCode, newExpiry: target.end_date },
  });
  return { subscription: await getSubscription(subId), removeFromGroups: [oldGroups.towards, oldGroups.backward].filter(Boolean) };
}

/** Active subscriptions whose cohort has ended. `renewed` = same person already has a newer live sub on the route. */
async function dueForSwitch(operatorId, today) {
  return many(
    `${SUB_SELECT}
      WHERE s.operator_id = $1 AND s.status = 'active' AND s.subscription_expiry < $2
      ORDER BY r.code, c.code, sb.name`,
    [operatorId, today],
  ).then((rows) => withRenewalFlag(rows));
}

async function withRenewalFlag(rows) {
  for (const r of rows) {
    const newer = await one(
      `SELECT s.id, c.code FROM subscriptions s JOIN cohorts c ON c.id = s.cohort_id
        WHERE s.subscriber_id = $1 AND s.route_id = $2 AND s.id <> $3 AND s.status IN ('pending','active') AND c.start_date > $4
        LIMIT 1`,
      [r.subscriber_id, r.route_id, r.id, r.cohort_start],
    );
    r.renewed = !!newer;
    // Same cohort letter = same WhatsApp groups, so a renewed member stays in the group
    r.stays_in_groups = !!newer && newer.code === r.cohort_code;
  }
  return rows;
}

function groupRemovals(rows, groupsByRoute) {
  const out = {};
  for (const r of rows) {
    if (r.stays_in_groups) continue;
    for (const dir of ['towards', 'backward']) {
      const key = `${r.route_id}:${r.cohort_code}:${dir}`;
      const g = groupsByRoute[r.route_id]?.find((x) => x.cohort === r.cohort_code && x.direction === dir);
      out[key] ??= {
        route_code: r.route_code,
        cohort: r.cohort_code,
        direction: dir,
        direction_label: dir === 'towards' ? r.towards_label : r.backward_label,
        wa_group_id: g?.wa_group_id || '',
        invite_link: g?.invite_link || '',
        members: [],
      };
      out[key].members.push({ subscription_id: r.id, name: r.subscriber_name, phone: r.subscriber_phone });
    }
  }
  return Object.values(out);
}

async function groupsFor(routeIds) {
  if (!routeIds.length) return {};
  const rows = await many(`SELECT * FROM route_groups WHERE route_id = ANY($1::uuid[])`, [routeIds]);
  const by = {};
  for (const g of rows) (by[g.route_id] ??= []).push(g);
  return by;
}

export async function cycleSwitchPreview(operatorId) {
  const today = todayISO();
  const due = await dueForSwitch(operatorId, today);
  const pending = await withRenewalFlag(
    await many(`${SUB_SELECT} WHERE s.operator_id = $1 AND s.status = 'expired' AND s.removed_from_groups = false ORDER BY r.code, sb.name`, [operatorId]),
  );
  const groups = await groupsFor([...new Set([...due, ...pending].map((r) => r.route_id))]);
  const soon = await one(
    `SELECT count(*)::int AS n FROM subscriptions WHERE operator_id = $1 AND status = 'active' AND subscription_expiry BETWEEN $2 AND ($2::date + 7)`,
    [operatorId, today],
  );
  return {
    today,
    due,
    dueRemovals: groupRemovals(due, groups),
    pendingRemovals: groupRemovals(pending, groups),
    pendingRemovalIds: pending.filter((p) => !p.stays_in_groups).map((p) => p.id),
    expiringWithin7Days: soon.n,
  };
}

/** Process the cycle switch: expire ended subscriptions (SR-17) and report who to remove from which group. */
export async function runCycleSwitch(auth) {
  const today = todayISO();
  const due = await dueForSwitch(auth.operatorId, today);
  if (!due.length) return { expired: 0, renewed: 0, removals: [] };
  const ids = due.map((d) => d.id);
  await query(`UPDATE subscriptions SET status = 'expired', expired_at = now() WHERE id = ANY($1::uuid[])`, [ids]);
  // Renewed members who stay in the same groups need no manual removal
  const stayIds = due.filter((d) => d.stays_in_groups).map((d) => d.id);
  if (stayIds.length) await query(`UPDATE subscriptions SET removed_from_groups = true WHERE id = ANY($1::uuid[])`, [stayIds]);
  const windows = await getWindows();
  for (const d of due.filter((x) => !x.renewed)) {
    const next = nextInstanceOf({ code: d.cohort_code, start_date: d.cohort_start }, windows);
    await sendMessage({
      to: d.subscriber_phone,
      message: expiredMessage({
        name: d.subscriber_name,
        routeCode: d.route_code,
        slug: d.operator_slug,
        nextWindowStart: next.signup_start,
        nextWindowEnd: next.signup_end,
      }),
      operatorId: d.operator_id,
    });
  }
  const groups = await groupsFor([...new Set(due.map((r) => r.route_id))]);
  const result = { expired: due.length, renewed: due.filter((d) => d.renewed).length, removals: groupRemovals(due, groups) };
  await audit(auth, 'cohort.cycle_switch', { details: { expired: result.expired, renewed: result.renewed } });
  return result;
}

export async function markRemovedFromGroups(auth, ids) {
  const r = await query(
    `UPDATE subscriptions SET removed_from_groups = true WHERE operator_id = $1 AND id = ANY($2::uuid[]) AND status IN ('expired','cancelled')`,
    [auth.operatorId, ids],
  );
  await audit(auth, 'cohort.mark_removed', { details: { count: r.rowCount } });
  return { updated: r.rowCount };
}

/** FR-P-11 */
export async function joinWaitlist(operator, { routeId, name, phone }) {
  const route = await one(`SELECT * FROM routes WHERE id = $1 AND operator_id = $2 AND status = 'active'`, [routeId, operator.id]);
  if (!route) throw notFound('Route');
  const r = await query(
    `INSERT INTO signup_waitlist (operator_id, route_id, name, phone) VALUES ($1,$2,$3,$4)
     ON CONFLICT (route_id, phone) WHERE status = 'waiting' DO NOTHING RETURNING id`,
    [operator.id, route.id, name, phone],
  );
  const state = await cohortState();
  if (r.rows.length) {
    await sendMessage({
      to: phone,
      message: waitlistJoinedMessage({ name, routeCode: route.code, nextWindowStart: state.next.signup_start }),
      operatorId: operator.id,
    });
  }
  return { joined: true, alreadyWaiting: !r.rows.length, nextWindow: state.next };
}

/** Notify waitlisted people when a window is open. Pass operatorId to limit to one operator. */
export async function notifyWaitlist(operatorId = null) {
  const state = await cohortState();
  if (!state.open) return { notified: 0, reason: 'No signup window is open right now.' };
  const rows = await many(
    `SELECT w.*, r.code AS route_code, o.slug FROM signup_waitlist w
       JOIN routes r ON r.id = w.route_id JOIN operators o ON o.id = w.operator_id
      WHERE w.status = 'waiting' AND o.status = 'active' ${operatorId ? 'AND w.operator_id = $1' : ''}`,
    operatorId ? [operatorId] : [],
  );
  for (const w of rows) {
    await sendMessage({
      to: w.phone,
      message: windowOpenMessage({ name: w.name, routeCode: w.route_code, windowEnd: state.open.signup_end, slug: w.slug }),
      operatorId: w.operator_id,
    });
    await query(`UPDATE signup_waitlist SET status = 'notified', notified_at = now() WHERE id = $1`, [w.id]);
  }
  return { notified: rows.length };
}

/** FR-P-12: T-7 and T-3 renewal reminders (runs from the job scheduler). */
export async function sendRenewalReminders() {
  const today = todayISO();
  const windows = await getWindows();
  const rows = await withRenewalFlag(
    await many(
      `${SUB_SELECT} WHERE s.status = 'active' AND o.status = 'active'
         AND s.subscription_expiry BETWEEN $1 AND ($1::date + 7)
         AND (s.reminder7_sent_at IS NULL OR s.reminder3_sent_at IS NULL)`,
      [today],
    ),
  );
  let sent = 0;
  for (const s of rows) {
    if (s.renewed) continue;
    const daysLeft = daysBetween(today, s.subscription_expiry);
    let col = null;
    if (daysLeft <= 3 && !s.reminder3_sent_at) col = 'reminder3_sent_at';
    else if (daysLeft > 3 && daysLeft <= 7 && !s.reminder7_sent_at) col = 'reminder7_sent_at';
    if (!col) continue;
    const next = nextInstanceOf({ code: s.cohort_code, start_date: s.cohort_start }, windows);
    await sendMessage({
      to: s.subscriber_phone,
      message: renewalReminderMessage({
        name: s.subscriber_name,
        routeCode: s.route_code,
        expiry: s.subscription_expiry,
        daysLeft,
        nextWindowStart: next.signup_start,
        nextWindowEnd: next.signup_end,
        slug: s.operator_slug,
      }),
      operatorId: s.operator_id,
    });
    // Sending the 3-day reminder also covers the 7-day one if it was missed
    await query(
      `UPDATE subscriptions SET ${col} = now() ${col === 'reminder3_sent_at' ? ', reminder7_sent_at = COALESCE(reminder7_sent_at, now())' : ''} WHERE id = $1`,
      [s.id],
    );
    sent++;
  }
  return { sent };
}

export { SUB_SELECT, activeInstance };
