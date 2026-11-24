// Operator admin endpoints (SRS 4.2). Every query is scoped by req.auth.operatorId (SR-11/12).
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { many, one, query, tx } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { requireAuth } from '../lib/auth.js';
import { calendar } from '../lib/cohort.js';
import { assertLimit, getFeatures } from '../lib/features.js';
import { HttpError, conflict, notFound, parse } from '../lib/http.js';
import { normalizePhone } from '../lib/phone.js';
import { getWindows } from '../lib/platform.js';
import { proofPath } from '../lib/storage.js';
import { signupUrl } from '../messaging/messages.js';
import { cohortState } from '../services/cohorts.js';
import {
  SUB_SELECT,
  adminAddSubscription,
  confirmPayment,
  cycleSwitchPreview,
  markRemovedFromGroups,
  notifyWaitlist,
  rejectPayment,
  removeSubscription,
  runCycleSwitch,
  sendInvite,
  getSubscription,
  switchCohort,
} from '../services/subscriptions.js';
import { TRIP_SELECT, directionLabel, getTrip, groupMessageFor, tripSummary } from '../services/trips.js';

const router = Router();
router.use(requireAuth('admin'));

const uuid = z.string().uuid();
const idParam = (req) => parse(uuid, req.params.id);
const phoneField = z.string().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid mobile number' });
  return p ?? '';
});

// ---------------------------------------------------------------- dashboard (FR-A-02)
router.get('/dashboard', async (req, res) => {
  const op = req.auth.operatorId;
  const state = await cohortState();
  const [operator, counts, live, missingLinks, featureInfo] = await Promise.all([
    one(`SELECT id, name, slug, package, passenger_price FROM operators WHERE id = $1`, [op]),
    one(
      `SELECT
        (SELECT count(*)::int FROM routes WHERE operator_id = $1 AND status = 'active') AS routes,
        (SELECT count(*)::int FROM conductors WHERE operator_id = $1 AND status = 'active') AS conductors,
        (SELECT count(*)::int FROM subscriptions WHERE operator_id = $1 AND status = 'active') AS active_subs,
        (SELECT count(*)::int FROM subscriptions s JOIN cohorts c ON c.id = s.cohort_id WHERE s.operator_id = $1 AND s.status = 'active' AND c.code = 'A') AS active_a,
        (SELECT count(*)::int FROM subscriptions s JOIN cohorts c ON c.id = s.cohort_id WHERE s.operator_id = $1 AND s.status = 'active' AND c.code = 'B') AS active_b,
        (SELECT count(*)::int FROM subscriptions WHERE operator_id = $1 AND status = 'pending') AS pending_payments,
        (SELECT count(*)::int FROM signup_waitlist WHERE operator_id = $1 AND status = 'waiting') AS waitlist,
        (SELECT count(*)::int FROM subscriptions WHERE operator_id = $1 AND status = 'active' AND subscription_expiry < $2) AS switch_due,
        (SELECT count(*)::int FROM subscriptions WHERE operator_id = $1 AND status = 'active' AND subscription_expiry BETWEEN $2 AND ($2::date + 7)) AS expiring_soon,
        (SELECT count(*)::int FROM trip_sessions WHERE operator_id = $1 AND (started_at AT TIME ZONE $3)::date = $2::date) AS trips_today,
        (SELECT COALESCE(sum(amount),0)::int FROM subscriptions WHERE operator_id = $1 AND payment_status = 'confirmed' AND confirmed_at > now() - interval '30 days') AS revenue_30d`,
      [op, state.today, config.timezone],
    ),
    many(`${TRIP_SELECT} WHERE t.operator_id = $1 AND t.status = 'active' ORDER BY t.started_at`, [op]),
    many(
      `SELECT r.code, count(*)::int AS n FROM route_groups g JOIN routes r ON r.id = g.route_id
        WHERE r.operator_id = $1 AND r.status = 'active' AND (g.invite_link = '' OR g.wa_group_id = '') GROUP BY r.code`,
      [op],
    ),
    getFeatures(op),
  ]);

  const alerts = [];
  if (counts.switch_due) alerts.push({ level: 'warn', text: `Cycle switch due: ${counts.switch_due} subscription(s) have passed their cohort end.`, link: '/admin/cohorts' });
  if (counts.pending_payments) alerts.push({ level: 'info', text: `${counts.pending_payments} payment(s) waiting for verification.`, link: '/admin/payments' });
  for (const m of missingLinks) alerts.push({ level: 'warn', text: `Route ${m.code} has ${m.n} WhatsApp group(s) without an ID or invite link.`, link: '/admin/routes' });
  for (const t of live) {
    const age = t.last_ping_at ? (Date.now() - new Date(t.last_ping_at)) / 1000 : (Date.now() - new Date(t.started_at)) / 1000;
    if (age > 120) alerts.push({ level: 'warn', text: `${t.route_code} ${directionLabel(t)} (${t.conductor_name}) has not sent GPS for ${Math.round(age / 60)} min.`, link: '/admin/trips' });
  }
  if (state.open) alerts.push({ level: 'ok', text: `Signup window for cohort ${state.open.code} is open until ${state.open.signup_end}${state.forced ? ' (forced open by platform)' : ''}.` });

  res.json({
    operator,
    signupLink: signupUrl(operator.slug),
    features: featureInfo.features,
    counts,
    live: live.map((t) => ({ ...t, direction_label: directionLabel(t) })),
    cohorts: state,
    alerts,
  });
});

router.get('/features', async (req, res) => res.json(await getFeatures(req.auth.operatorId)));

// ---------------------------------------------------------------- operator settings
router.get('/settings', async (req, res) => {
  res.json(await one(`SELECT id, name, slug, package, contact_email, contact_phone, passenger_price, payment_instructions FROM operators WHERE id = $1`, [req.auth.operatorId]));
});

router.patch('/settings', async (req, res) => {
  const acct = z.object({ account: z.string().trim().max(60).default(''), title: z.string().trim().max(80).default(''), bank: z.string().trim().max(80).optional() });
  const body = parse(
    z.object({
      contact_email: z.string().email().or(z.literal('')).optional(),
      contact_phone: z.string().max(30).optional(),
      payment_instructions: z.object({ jazzcash: acct.optional(), easypaisa: acct.optional(), bank: acct.optional(), note: z.string().max(300).optional() }).optional(),
    }),
    req.body,
  );
  const cur = await one(`SELECT * FROM operators WHERE id = $1`, [req.auth.operatorId]);
  await query(`UPDATE operators SET contact_email = $2, contact_phone = $3, payment_instructions = $4 WHERE id = $1`, [
    req.auth.operatorId,
    body.contact_email ?? cur.contact_email,
    body.contact_phone ?? cur.contact_phone,
    JSON.stringify(body.payment_instructions ?? cur.payment_instructions),
  ]);
  await audit(req.auth, 'operator.settings_update');
  res.json({ ok: true });
});

// ---------------------------------------------------------------- routes (FR-A-03..05)
const groupSchema = z.object({
  cohort: z.enum(['A', 'B']),
  direction: z.enum(['towards', 'backward']),
  wa_group_id: z.string().trim().min(1, 'WhatsApp group ID is required').max(120),
  invite_link: z.string().trim().url('Invite link must be a URL').max(300),
});
const groupsSchema = z
  .array(groupSchema)
  .length(4, 'A route needs exactly 4 WhatsApp groups (cohort A/B x towards/backward)')
  .refine((gs) => new Set(gs.map((g) => `${g.cohort}:${g.direction}`)).size === 4, 'Each cohort + direction combination must appear once');
const pathSchema = z.array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])).max(2000);
const routeBase = {
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9-]+$/, 'Code may use letters, numbers and dashes'),
  name: z.string().trim().min(2).max(100),
  towards_label: z.string().trim().min(1).max(60).default('Towards'),
  backward_label: z.string().trim().min(1).max(60).default('Backward'),
  path: pathSchema.default([]),
};

async function routeWithGroups(id, operatorId) {
  const r = await one(`SELECT * FROM routes WHERE id = $1 AND operator_id = $2`, [id, operatorId]);
  if (!r) throw notFound('Route');
  r.groups = await many(`SELECT * FROM route_groups WHERE route_id = $1 ORDER BY cohort, direction DESC`, [id]);
  r.conductors = await many(
    `SELECT c.id, c.name FROM conductors c JOIN conductor_route_assignments a ON a.conductor_id = c.id WHERE a.route_id = $1 ORDER BY c.name`,
    [id],
  );
  return r;
}

router.get('/routes', async (req, res) => {
  const routes = await many(
    `SELECT r.*,
        (SELECT count(*)::int FROM subscriptions s WHERE s.route_id = r.id AND s.status = 'active') AS active_subs,
        (SELECT count(*)::int FROM conductor_route_assignments a WHERE a.route_id = r.id) AS conductor_count,
        (SELECT count(*)::int FROM trip_sessions t WHERE t.route_id = r.id AND t.status = 'active') AS live_trips,
        (SELECT count(*)::int FROM route_groups g WHERE g.route_id = r.id AND g.invite_link <> '' AND g.wa_group_id <> '') AS groups_ready
       FROM routes r WHERE r.operator_id = $1 ORDER BY r.status, r.code`,
    [req.auth.operatorId],
  );
  const { features } = await getFeatures(req.auth.operatorId);
  res.json({ routes, maxRoutes: features.max_routes });
});

router.get('/routes/:id', async (req, res) => res.json(await routeWithGroups(idParam(req), req.auth.operatorId)));

router.post('/routes', async (req, res) => {
  const body = parse(z.object({ ...routeBase, groups: groupsSchema }), req.body);
  const n = await one(`SELECT count(*)::int AS n FROM routes WHERE operator_id = $1 AND status = 'active'`, [req.auth.operatorId]);
  await assertLimit(req.auth.operatorId, 'max_routes', n.n, 'active routes'); // SR-07/08
  const id = await tx(async (q) => {
    const r = await q.query(
      `INSERT INTO routes (operator_id, code, name, towards_label, backward_label, path, live_token) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.auth.operatorId, body.code.toUpperCase(), body.name, body.towards_label, body.backward_label, JSON.stringify(body.path), crypto.randomBytes(12).toString('base64url')],
    );
    for (const g of body.groups) {
      await q.query(`INSERT INTO route_groups (route_id, cohort, direction, wa_group_id, invite_link) VALUES ($1,$2,$3,$4,$5)`, [
        r.rows[0].id,
        g.cohort,
        g.direction,
        g.wa_group_id,
        g.invite_link,
      ]);
    }
    return r.rows[0].id;
  });
  await audit(req.auth, 'route.create', { entityType: 'route', entityId: id, details: { code: body.code } });
  res.status(201).json(await routeWithGroups(id, req.auth.operatorId));
});

router.patch('/routes/:id', async (req, res) => {
  const id = idParam(req);
  const cur = await routeWithGroups(id, req.auth.operatorId);
  const body = parse(
    z.object({
      code: routeBase.code.optional(),
      name: routeBase.name.optional(),
      towards_label: z.string().trim().min(1).max(60).optional(),
      backward_label: z.string().trim().min(1).max(60).optional(),
      path: pathSchema.optional(),
      status: z.enum(['active', 'inactive']).optional(),
      groups: groupsSchema.optional(),
    }),
    req.body,
  );
  if (body.status === 'active' && cur.status !== 'active') {
    const n = await one(`SELECT count(*)::int AS n FROM routes WHERE operator_id = $1 AND status = 'active'`, [req.auth.operatorId]);
    await assertLimit(req.auth.operatorId, 'max_routes', n.n, 'active routes');
  }
  await tx(async (q) => {
    await q.query(
      `UPDATE routes SET code = $2, name = $3, towards_label = $4, backward_label = $5, path = $6, status = $7 WHERE id = $1`,
      [
        id,
        (body.code ?? cur.code).toUpperCase(),
        body.name ?? cur.name,
        body.towards_label ?? cur.towards_label,
        body.backward_label ?? cur.backward_label,
        JSON.stringify(body.path ?? cur.path),
        body.status ?? cur.status,
      ],
    );
    for (const g of body.groups ?? []) {
      await q.query(
        `INSERT INTO route_groups (route_id, cohort, direction, wa_group_id, invite_link) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (route_id, cohort, direction) DO UPDATE SET wa_group_id = EXCLUDED.wa_group_id, invite_link = EXCLUDED.invite_link`,
        [id, g.cohort, g.direction, g.wa_group_id, g.invite_link],
      );
    }
  });
  await audit(req.auth, 'route.update', { entityType: 'route', entityId: id, details: { fields: Object.keys(body) } });
  res.json(await routeWithGroups(id, req.auth.operatorId));
});

// FR-A-05: routes with history are archived instead of deleted, so trips/subscriptions stay intact
router.delete('/routes/:id', async (req, res) => {
  const id = idParam(req);
  const r = await routeWithGroups(id, req.auth.operatorId);
  const live = await one(`SELECT 1 FROM trip_sessions WHERE route_id = $1 AND status = 'active'`, [id]);
  if (live) throw conflict('This route has a live trip. Stop it first.');
  const history = await one(
    `SELECT (SELECT count(*) FROM trip_sessions WHERE route_id = $1)::int + (SELECT count(*) FROM subscriptions WHERE route_id = $1)::int AS n`,
    [id],
  );
  if (history.n > 0) {
    await query(`UPDATE routes SET status = 'inactive' WHERE id = $1`, [id]);
    await audit(req.auth, 'route.archive', { entityType: 'route', entityId: id, details: { code: r.code } });
    return res.json({ archived: true, message: `${r.code} has trip or subscriber history, so it was archived (inactive) instead of deleted.` });
  }
  await query(`DELETE FROM routes WHERE id = $1`, [id]);
  await audit(req.auth, 'route.delete', { entityType: 'route', entityId: id, details: { code: r.code } });
  res.json({ deleted: true });
});

router.post('/routes/:id/rotate-link', async (req, res) => {
  const id = idParam(req);
  await routeWithGroups(id, req.auth.operatorId);
  await query(`UPDATE routes SET live_token = $2 WHERE id = $1`, [id, crypto.randomBytes(12).toString('base64url')]);
  await audit(req.auth, 'route.rotate_live_link', { entityType: 'route', entityId: id });
  res.json(await routeWithGroups(id, req.auth.operatorId));
});

// ---------------------------------------------------------------- conductors (FR-A-06..09)
router.get('/conductors', async (req, res) => {
  const rows = await many(
    `SELECT c.*,
        COALESCE((SELECT json_agg(json_build_object('id', r.id, 'code', r.code) ORDER BY r.code)
                    FROM conductor_route_assignments a JOIN routes r ON r.id = a.route_id WHERE a.conductor_id = c.id), '[]'::json) AS routes,
        (SELECT count(*)::int FROM trip_sessions t WHERE t.conductor_id = c.id) AS trip_count,
        (SELECT t.id FROM trip_sessions t WHERE t.conductor_id = c.id AND t.status = 'active' LIMIT 1) AS active_trip_id,
        (SELECT max(t.started_at) FROM trip_sessions t WHERE t.conductor_id = c.id) AS last_trip_at
       FROM conductors c WHERE c.operator_id = $1 ORDER BY c.status, c.name`,
    [req.auth.operatorId],
  );
  res.json(rows);
});

async function setAssignments(q, operatorId, conductorId, routeIds) {
  if (routeIds.length) {
    const ok = await q.query(`SELECT count(*)::int AS n FROM routes WHERE operator_id = $1 AND id = ANY($2::uuid[])`, [operatorId, routeIds]);
    if (ok.rows[0].n !== new Set(routeIds).size) throw new HttpError(400, 'One or more routes do not belong to your service.');
  }
  await q.query(`DELETE FROM conductor_route_assignments WHERE conductor_id = $1`, [conductorId]);
  for (const rid of new Set(routeIds)) {
    await q.query(`INSERT INTO conductor_route_assignments (conductor_id, route_id) VALUES ($1,$2)`, [conductorId, rid]);
  }
}

router.post('/conductors', async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(2).max(80), phone: phoneField, routeIds: z.array(uuid).default([]) }), req.body);
  const n = await one(`SELECT count(*)::int AS n FROM conductors WHERE operator_id = $1 AND status = 'active'`, [req.auth.operatorId]);
  await assertLimit(req.auth.operatorId, 'max_conductors', n.n, 'conductors');
  const exists = await one(`SELECT 1 FROM conductors WHERE phone = $1`, [body.phone]);
  if (exists) throw conflict('A conductor with this phone number already exists.');
  const id = await tx(async (q) => {
    const r = await q.query(`INSERT INTO conductors (operator_id, name, phone) VALUES ($1,$2,$3) RETURNING id`, [req.auth.operatorId, body.name, body.phone]);
    await setAssignments(q, req.auth.operatorId, r.rows[0].id, body.routeIds);
    return r.rows[0].id;
  });
  await audit(req.auth, 'conductor.create', { entityType: 'conductor', entityId: id, details: { name: body.name } });
  res.status(201).json({ id });
});

async function ownConductor(req) {
  const id = idParam(req);
  const c = await one(`SELECT * FROM conductors WHERE id = $1 AND operator_id = $2`, [id, req.auth.operatorId]);
  if (!c) throw notFound('Conductor');
  return c;
}

router.patch('/conductors/:id', async (req, res) => {
  const c = await ownConductor(req);
  const body = parse(z.object({ name: z.string().trim().min(2).max(80).optional(), phone: phoneField.optional() }), req.body);
  if (body.phone && body.phone !== c.phone) {
    const exists = await one(`SELECT 1 FROM conductors WHERE phone = $1`, [body.phone]);
    if (exists) throw conflict('Another conductor already uses this phone number.');
  }
  await query(`UPDATE conductors SET name = $2, phone = $3 WHERE id = $1`, [c.id, body.name ?? c.name, body.phone ?? c.phone]);
  await audit(req.auth, 'conductor.update', { entityType: 'conductor', entityId: c.id });
  res.json({ ok: true });
});

router.post('/conductors/:id/status', async (req, res) => {
  const c = await ownConductor(req);
  const { status } = parse(z.object({ status: z.enum(['active', 'inactive']) }), req.body);
  if (status === 'active' && c.status !== 'active') {
    const n = await one(`SELECT count(*)::int AS n FROM conductors WHERE operator_id = $1 AND status = 'active'`, [req.auth.operatorId]);
    await assertLimit(req.auth.operatorId, 'max_conductors', n.n, 'conductors');
  }
  if (status === 'inactive') {
    await query(`UPDATE trip_sessions SET status = 'completed', ended_at = now(), end_reason = 'conductor_deactivated' WHERE conductor_id = $1 AND status = 'active'`, [c.id]);
  }
  await query(`UPDATE conductors SET status = $2 WHERE id = $1`, [c.id, status]);
  await audit(req.auth, status === 'active' ? 'conductor.activate' : 'conductor.deactivate', { entityType: 'conductor', entityId: c.id });
  res.json({ ok: true });
});

router.put('/conductors/:id/routes', async (req, res) => {
  const c = await ownConductor(req);
  const { routeIds } = parse(z.object({ routeIds: z.array(uuid) }), req.body);
  await tx((q) => setAssignments(q, req.auth.operatorId, c.id, routeIds));
  await audit(req.auth, 'conductor.assign_routes', { entityType: 'conductor', entityId: c.id, details: { routes: routeIds.length } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- payments (FR-A-10..14)
router.get('/payments', async (req, res) => {
  const status = parse(z.enum(['pending', 'confirmed', 'rejected', 'all']).default('pending'), req.query.status);
  const rows = await many(
    `${SUB_SELECT} WHERE s.operator_id = $1 ${status === 'all' ? '' : 'AND s.payment_status = $2'}
      ORDER BY ${status === 'pending' ? 's.created_at ASC' : 'COALESCE(s.confirmed_at, s.created_at) DESC'} LIMIT 500`,
    status === 'all' ? [req.auth.operatorId] : [req.auth.operatorId, status],
  );
  res.json(rows.map((r) => ({ ...r, has_proof: !!r.proof_path, proof_path: undefined })));
});

router.get('/payments/:id/proof', async (req, res) => {
  const s = await getSubscription(idParam(req), req.auth.operatorId);
  const p = proofPath(s.proof_path);
  if (!p) throw notFound('Proof file');
  res.set('Cache-Control', 'private, no-store').sendFile(p);
});

router.post('/payments/:id/confirm', async (req, res) => res.json(await confirmPayment(req.auth, idParam(req))));

router.post('/payments/:id/reject', async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Give a reason the passenger will understand').max(200) }), req.body);
  res.json(await rejectPayment(req.auth, idParam(req), reason));
});

// ---------------------------------------------------------------- subscribers (FR-A-15/16/20/23/24)
router.get('/subscriptions', async (req, res) => {
  const f = parse(
    z.object({
      status: z.enum(['active', 'expired', 'pending', 'cancelled', 'rejected', 'all']).default('active'),
      route: uuid.optional(),
      cohort: z.enum(['A', 'B']).optional(),
      q: z.string().max(60).optional(),
    }),
    req.query,
  );
  const conds = ['s.operator_id = $1'];
  const params = [req.auth.operatorId];
  const add = (sql, v) => {
    params.push(v);
    conds.push(sql.replace('?', `$${params.length}`));
  };
  if (f.status !== 'all') add('s.status = ?', f.status);
  if (f.route) add('s.route_id = ?', f.route);
  if (f.cohort) add('c.code = ?', f.cohort);
  if (f.q) {
    // Match name, or phone digits typed in local format (0300...) against stored +92300...
    const digits = f.q.replace(/\D/g, '').replace(/^0/, '');
    params.push(`%${f.q}%`, `%${digits || f.q}%`);
    conds.push(`(sb.name ILIKE $${params.length - 1} OR sb.phone LIKE $${params.length})`);
  }
  const rows = await many(`${SUB_SELECT} WHERE ${conds.join(' AND ')} ORDER BY s.subscription_expiry NULLS LAST, sb.name LIMIT 1000`, params);
  res.json(rows.map((r) => ({ ...r, proof_path: undefined })));
});

router.post('/subscriptions', async (req, res) => {
  const body = parse(
    z.object({
      routeId: uuid,
      name: z.string().trim().min(2).max(80),
      phone: phoneField,
      cohort: z.enum(['A', 'B']).optional(),
      paymentMethod: z.enum(['jazzcash', 'easypaisa', 'bank', 'cash', 'manual']).optional(),
      paymentRef: z.string().trim().max(60).optional(),
    }),
    req.body,
  );
  res.status(201).json(await adminAddSubscription(req.auth, body));
});

router.delete('/subscriptions/:id', async (req, res) => res.json(await removeSubscription(req.auth, idParam(req))));
router.post('/subscriptions/:id/switch-cohort', async (req, res) => res.json(await switchCohort(req.auth, idParam(req))));
router.post('/subscriptions/:id/resend-invite', async (req, res) => {
  const id = idParam(req);
  const s = await getSubscription(id, req.auth.operatorId);
  if (s.status !== 'active') throw conflict('Invites can only be sent to active subscribers.');
  const r = await sendInvite(id);
  await audit(req.auth, 'subscription.resend_invite', { entityType: 'subscription', entityId: id });
  res.json(r);
});

// ---------------------------------------------------------------- trips (FR-A-17/18/19)
router.get('/trips/live', async (req, res) => {
  const rows = await many(`${TRIP_SELECT} WHERE t.operator_id = $1 AND t.status = 'active' ORDER BY t.started_at`, [req.auth.operatorId]);
  res.json(rows.map((t) => ({ ...t, direction_label: directionLabel(t) })));
});

router.get('/trips', async (req, res) => {
  const f = parse(
    z.object({ route: uuid.optional(), conductor: uuid.optional(), status: z.enum(['active', 'completed', 'auto_closed']).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }),
    req.query,
  );
  const { features } = await getFeatures(req.auth.operatorId);
  const conds = ['t.operator_id = $1'];
  const params = [req.auth.operatorId];
  if (features.trip_history_days != null) {
    params.push(String(features.trip_history_days));
    conds.push(`t.started_at > now() - ($${params.length} || ' days')::interval`);
  }
  for (const [col, v] of [['t.route_id', f.route], ['t.conductor_id', f.conductor], ['t.status', f.status]]) {
    if (v) {
      params.push(v);
      conds.push(`${col} = $${params.length}`);
    }
  }
  params.push(f.limit);
  const rows = await many(`${TRIP_SELECT} WHERE ${conds.join(' AND ')} ORDER BY t.started_at DESC LIMIT $${params.length}`, params);
  res.json({ historyDays: features.trip_history_days, trips: rows.map((t) => ({ ...t, direction_label: directionLabel(t) })) });
});

router.get('/trips/:id', async (req, res) => {
  const id = idParam(req);
  await getTrip(id, { operatorId: req.auth.operatorId });
  const summary = await tripSummary(id);
  const route = await one(`SELECT path FROM routes WHERE id = $1`, [summary.trip.route_id]);
  res.json({ ...summary, routePath: route.path, message: await groupMessageFor(summary.trip) });
});

// Admin can end a trip the conductor forgot to stop (Risk 2)
router.post('/trips/:id/end', async (req, res) => {
  const id = idParam(req);
  const t = await getTrip(id, { operatorId: req.auth.operatorId });
  if (t.status !== 'active') throw conflict('Trip is not active.');
  await query(`UPDATE trip_sessions SET status = 'completed', ended_at = now(), end_reason = 'admin' WHERE id = $1`, [id]);
  await audit(req.auth, 'trip.admin_end', { entityType: 'trip', entityId: id });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- waitlist (FR-A-21)
router.get('/waitlist', async (req, res) => {
  const rows = await many(
    `SELECT w.*, r.code AS route_code, r.name AS route_name FROM signup_waitlist w JOIN routes r ON r.id = w.route_id
      WHERE w.operator_id = $1 AND w.status <> 'removed' ORDER BY w.status DESC, w.created_at`,
    [req.auth.operatorId],
  );
  const state = await cohortState();
  res.json({ entries: rows, window: { open: state.open, next: state.next } });
});

router.post('/waitlist/notify', async (req, res) => {
  const r = await notifyWaitlist(req.auth.operatorId);
  await audit(req.auth, 'waitlist.notify', { details: r });
  res.json(r);
});

router.delete('/waitlist/:id', async (req, res) => {
  const r = await query(`UPDATE signup_waitlist SET status = 'removed' WHERE id = $1 AND operator_id = $2`, [idParam(req), req.auth.operatorId]);
  if (!r.rowCount) throw notFound('Waitlist entry');
  res.json({ ok: true });
});

// ---------------------------------------------------------------- cohorts + cycle switch (FR-A-20/22)
router.get('/cohorts', async (req, res) => {
  const state = await cohortState();
  const windows = await getWindows();
  const cal = calendar(state.today, 3, windows);
  const counts = await many(
    `SELECT c.code, c.start_date, s.status, count(*)::int AS n FROM subscriptions s JOIN cohorts c ON c.id = s.cohort_id
      WHERE s.operator_id = $1 GROUP BY c.code, c.start_date, s.status`,
    [req.auth.operatorId],
  );
  for (const inst of cal) {
    inst.counts = Object.fromEntries(counts.filter((c) => c.code === inst.code && c.start_date === inst.start_date).map((c) => [c.status, c.n]));
    inst.isActive = state.active[inst.code].start_date === inst.start_date;
    inst.isOpen = state.open?.code === inst.code && state.open?.start_date === inst.start_date;
  }
  res.json({ state, calendar: cal });
});

router.get('/cycle-switch', async (req, res) => res.json(await cycleSwitchPreview(req.auth.operatorId)));
router.post('/cycle-switch/run', async (req, res) => res.json(await runCycleSwitch(req.auth)));
router.post('/cycle-switch/mark-removed', async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(uuid).min(1) }), req.body);
  res.json(await markRemovedFromGroups(req.auth, ids));
});

export default router;
