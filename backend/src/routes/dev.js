// Developer (platform owner) console endpoints (SRS 4.1). Sees all operators (SR-14).
import os from 'node:os';
import { Router } from 'express';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../config.js';
import { dbKind, many, one, query, tx } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { hashPassword, requireAuth, signToken } from '../lib/auth.js';
import { FEATURE_INFO, assertLimit, getFeatures } from '../lib/features.js';
import { HttpError, conflict, notFound, parse } from '../lib/http.js';
import { MESSAGE_TYPES, conductorStaysSignedIn, getMessageSwitches, isMessageKey, recommendedSwitches, updateMessageSwitches } from '../lib/messageSwitches.js';
import { getAllConfig, getConfig, setConfig } from '../lib/platform.js';
import { activeChannel } from '../messaging/index.js';
import { cohortState } from '../services/cohorts.js';
import { jobStatus, runJobNow } from '../jobs.js';

const router = Router();
router.use(requireAuth('developer'));

export const PACKAGE_PRICES = { basic: 5000, premium: 15000, gold: 30000 };
const uuid = z.string().uuid();
const idParam = (req) => parse(uuid, req.params.id);
const featureValue = z.union([z.number(), z.boolean(), z.string(), z.null()]);

// ---------------------------------------------------------------- operators (FR-D-02..06)
const OP_STATS = `
  SELECT o.*,
    (SELECT count(*)::int FROM routes r WHERE r.operator_id = o.id AND r.status = 'active') AS routes,
    (SELECT count(*)::int FROM conductors c WHERE c.operator_id = o.id AND c.status = 'active') AS conductors,
    (SELECT count(*)::int FROM users u WHERE u.operator_id = o.id) AS admins,
    (SELECT count(*)::int FROM subscriptions s WHERE s.operator_id = o.id AND s.status = 'active') AS active_subscribers,
    (SELECT count(*)::int FROM subscriptions s WHERE s.operator_id = o.id AND s.status = 'pending') AS pending_payments,
    (SELECT count(*)::int FROM trip_sessions t WHERE t.operator_id = o.id AND t.status = 'active') AS live_trips,
    (SELECT count(*)::int FROM trip_sessions t WHERE t.operator_id = o.id AND t.started_at > now() - interval '7 days') AS trips_7d,
    (SELECT COALESCE(sum(amount),0)::int FROM subscriptions s WHERE s.operator_id = o.id AND s.payment_status = 'confirmed' AND s.confirmed_at > now() - interval '30 days') AS passenger_revenue_30d
  FROM operators o`;

router.get('/operators', async (req, res) => {
  const rows = await many(`${OP_STATS} ORDER BY o.created_at`);
  const active = rows.filter((r) => r.status === 'active');
  res.json({
    operators: rows.map((r) => ({ ...r, package_price: PACKAGE_PRICES[r.package] })),
    totals: {
      operators: rows.length,
      active: active.length,
      mrr: active.reduce((s, r) => s + PACKAGE_PRICES[r.package], 0),
      subscribers: rows.reduce((s, r) => s + r.active_subscribers, 0),
      liveTrips: rows.reduce((s, r) => s + r.live_trips, 0),
    },
    prices: PACKAGE_PRICES,
  });
});

const slug = z.string().trim().min(2).max(40).regex(/^[a-z0-9-]+$/, 'Slug may use lowercase letters, numbers and dashes');

router.post('/operators', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(100),
      slug,
      package: z.enum(['basic', 'premium', 'gold']).default('basic'),
      contact_email: z.string().email().or(z.literal('')).optional(),
      contact_phone: z.string().max(30).optional(),
      passenger_price: z.coerce.number().int().min(0).max(100000).default(350),
      admin: z.object({ name: z.string().trim().min(2).max(80), email: z.string().email(), password: z.string().min(8, 'Admin password must be at least 8 characters') }),
    }),
    req.body,
  );
  if (await one(`SELECT 1 FROM operators WHERE slug = $1`, [body.slug])) throw conflict('That slug is already taken.');
  if (await one(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [body.admin.email])) throw conflict('That admin email is already in use.');
  const hash = await hashPassword(body.admin.password);
  const id = await tx(async (q) => {
    const o = await q.query(
      `INSERT INTO operators (name, slug, package, contact_email, contact_phone, passenger_price) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [body.name, body.slug, body.package, body.contact_email || null, body.contact_phone || null, body.passenger_price],
    );
    await q.query(`INSERT INTO users (email, password_hash, name, role, operator_id) VALUES ($1,$2,$3,'admin',$4)`, [
      body.admin.email.toLowerCase(),
      hash,
      body.admin.name,
      o.rows[0].id,
    ]);
    return o.rows[0].id;
  });
  await audit(req.auth, 'operator.create', { operatorId: id, entityType: 'operator', entityId: id, details: { name: body.name, package: body.package } });
  res.status(201).json({ id });
});

router.get('/operators/:id', async (req, res) => {
  const id = idParam(req);
  const op = await one(`${OP_STATS} WHERE o.id = $1`, [id]);
  if (!op) throw notFound('Operator');
  const [features, overrides, admins] = await Promise.all([
    getFeatures(id),
    many(`SELECT * FROM operator_feature_overrides WHERE operator_id = $1 ORDER BY created_at DESC`, [id]),
    many(`SELECT id, name, email, status, last_login_at, created_at FROM users WHERE operator_id = $1 ORDER BY created_at`, [id]),
  ]);
  res.json({ operator: { ...op, package_price: PACKAGE_PRICES[op.package] }, features, overrides, admins, featureInfo: FEATURE_INFO });
});

router.patch('/operators/:id', async (req, res) => {
  const id = idParam(req);
  const cur = await one(`SELECT * FROM operators WHERE id = $1`, [id]);
  if (!cur) throw notFound('Operator');
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(100).optional(),
      slug: slug.optional(),
      contact_email: z.string().email().or(z.literal('')).optional(),
      contact_phone: z.string().max(30).optional(),
      passenger_price: z.coerce.number().int().min(0).max(100000).optional(),
    }),
    req.body,
  );
  if (body.slug && body.slug !== cur.slug && (await one(`SELECT 1 FROM operators WHERE slug = $1`, [body.slug]))) throw conflict('That slug is already taken.');
  await query(`UPDATE operators SET name = $2, slug = $3, contact_email = $4, contact_phone = $5, passenger_price = $6 WHERE id = $1`, [
    id,
    body.name ?? cur.name,
    body.slug ?? cur.slug,
    body.contact_email === undefined ? cur.contact_email : body.contact_email || null,
    body.contact_phone ?? cur.contact_phone,
    body.passenger_price ?? cur.passenger_price,
  ]);
  await audit(req.auth, 'operator.update', { operatorId: id, entityType: 'operator', entityId: id, details: body });
  res.json({ ok: true });
});

// FR-D-05
router.post('/operators/:id/status', async (req, res) => {
  const id = idParam(req);
  const { status } = parse(z.object({ status: z.enum(['active', 'suspended']) }), req.body);
  const r = await query(`UPDATE operators SET status = $2 WHERE id = $1`, [id, status]);
  if (!r.rowCount) throw notFound('Operator');
  if (status === 'suspended') {
    await query(`UPDATE trip_sessions SET status = 'completed', ended_at = now(), end_reason = 'operator_suspended' WHERE operator_id = $1 AND status = 'active'`, [id]);
  }
  await audit(req.auth, status === 'active' ? 'operator.reactivate' : 'operator.suspend', { operatorId: id, entityType: 'operator', entityId: id });
  res.json({ ok: true });
});

// FR-D-06
router.post('/operators/:id/package', async (req, res) => {
  const id = idParam(req);
  const { package: pkg } = parse(z.object({ package: z.enum(['basic', 'premium', 'gold']) }), req.body);
  const cur = await one(`SELECT package FROM operators WHERE id = $1`, [id]);
  if (!cur) throw notFound('Operator');
  await query(`UPDATE operators SET package = $2 WHERE id = $1`, [id, pkg]);
  const features = await getFeatures(id);
  const routes = await one(`SELECT count(*)::int AS n FROM routes WHERE operator_id = $1 AND status = 'active'`, [id]);
  const warnings = [];
  if (features.features.max_routes != null && routes.n > features.features.max_routes) {
    warnings.push(`Operator has ${routes.n} active routes but ${pkg} allows ${features.features.max_routes}. Existing routes keep working; new ones are blocked.`);
  }
  await audit(req.auth, 'operator.package_change', { operatorId: id, entityType: 'operator', entityId: id, details: { from: cur.package, to: pkg } });
  res.json({ ok: true, features, warnings });
});

router.post('/operators/:id/admins', async (req, res) => {
  const id = idParam(req);
  const body = parse(z.object({ name: z.string().trim().min(2).max(80), email: z.string().email(), password: z.string().min(8) }), req.body);
  const n = await one(`SELECT count(*)::int AS n FROM users WHERE operator_id = $1 AND status = 'active'`, [id]);
  await assertLimit(id, 'max_admins', n.n, 'admin accounts');
  if (await one(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [body.email])) throw conflict('That email is already in use.');
  const u = await one(`INSERT INTO users (email, password_hash, name, role, operator_id) VALUES ($1,$2,$3,'admin',$4) RETURNING id`, [
    body.email.toLowerCase(),
    await hashPassword(body.password),
    body.name,
    id,
  ]);
  await audit(req.auth, 'admin.create', { operatorId: id, entityType: 'user', entityId: u.id, details: { email: body.email } });
  res.status(201).json(u);
});

router.post('/users/:id/password', async (req, res) => {
  const id = idParam(req);
  const { password } = parse(z.object({ password: z.string().min(8) }), req.body);
  const r = await query(`UPDATE users SET password_hash = $2 WHERE id = $1 AND role = 'admin'`, [id, await hashPassword(password)]);
  if (!r.rowCount) throw notFound('Admin');
  await audit(req.auth, 'admin.password_reset', { entityType: 'user', entityId: id });
  res.json({ ok: true });
});

router.post('/users/:id/status', async (req, res) => {
  const id = idParam(req);
  const { status } = parse(z.object({ status: z.enum(['active', 'disabled']) }), req.body);
  const r = await query(`UPDATE users SET status = $2 WHERE id = $1 AND role = 'admin' RETURNING operator_id`, [id, status]);
  if (!r.rowCount) throw notFound('Admin');
  await audit(req.auth, `admin.${status}`, { operatorId: r.rows[0].operator_id, entityType: 'user', entityId: id });
  res.json({ ok: true });
});

// FR-D-10: impersonate an operator's admin (token tagged with imp = developer id, 1 hour)
router.post('/operators/:id/impersonate', async (req, res) => {
  const id = idParam(req);
  const admin = await one(`SELECT * FROM users WHERE operator_id = $1 AND role = 'admin' ORDER BY (status = 'active') DESC, created_at LIMIT 1`, [id]);
  if (!admin) throw conflict('This operator has no admin account to impersonate. Add one first.');
  const token = await signToken({ sub: admin.id, role: 'admin', op: id, name: `${admin.name} (via ${req.auth.name})`, imp: req.auth.id }, '1h');
  await audit(req.auth, 'developer.impersonate', { operatorId: id, entityType: 'user', entityId: admin.id });
  res.json({ token });
});

// ---------------------------------------------------------------- packages + overrides (FR-D-07..09)
router.get('/packages', async (req, res) => {
  const rows = await many(`SELECT * FROM package_features ORDER BY feature_key, package`);
  const matrix = {};
  for (const r of rows) (matrix[r.feature_key] ??= {})[r.package] = r.value;
  res.json({ matrix, featureInfo: FEATURE_INFO, prices: PACKAGE_PRICES });
});

router.put('/packages/:package/:feature', async (req, res) => {
  const pkg = parse(z.enum(['basic', 'premium', 'gold']), req.params.package);
  const feature = parse(z.string().regex(/^[a-z_]+$/), req.params.feature);
  const { value } = parse(z.object({ value: featureValue }), req.body);
  await query(
    `INSERT INTO package_features (package, feature_key, value) VALUES ($1,$2,$3) ON CONFLICT (package, feature_key) DO UPDATE SET value = EXCLUDED.value`,
    [pkg, feature, JSON.stringify(value)],
  );
  await audit(req.auth, 'package.feature_update', { details: { package: pkg, feature, value } });
  res.json({ ok: true });
});

router.post('/operators/:id/overrides', async (req, res) => {
  const id = idParam(req);
  const body = parse(
    z.object({ feature_key: z.string().regex(/^[a-z_]+$/), value: featureValue, reason: z.string().max(200).optional(), expires_at: z.string().datetime({ offset: true }).or(z.string().date()).optional().nullable() }),
    req.body,
  );
  if (!(await one(`SELECT 1 FROM operators WHERE id = $1`, [id]))) throw notFound('Operator');
  const r = await one(
    `INSERT INTO operator_feature_overrides (operator_id, feature_key, value, reason, expires_at, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [id, body.feature_key, JSON.stringify(body.value), body.reason || null, body.expires_at || null, req.auth.id],
  );
  await audit(req.auth, 'override.add', { operatorId: id, entityType: 'override', entityId: r.id, details: body });
  res.status(201).json(r);
});

router.delete('/overrides/:id', async (req, res) => {
  const id = idParam(req);
  const r = await query(`UPDATE operator_feature_overrides SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING operator_id, feature_key`, [id]);
  if (!r.rowCount) throw notFound('Override');
  await audit(req.auth, 'override.revoke', { operatorId: r.rows[0].operator_id, entityType: 'override', entityId: id, details: { feature: r.rows[0].feature_key } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- health + costs (FR-D-11/12)
router.get('/health', async (req, res) => {
  const t0 = performance.now();
  await one('SELECT 1');
  const dbLatencyMs = Math.round((performance.now() - t0) * 10) / 10;
  const stats = await one(`SELECT
      (SELECT count(*)::int FROM trip_sessions WHERE status = 'active') AS live_trips,
      (SELECT count(*)::int FROM location_pings WHERE created_at > now() - interval '1 hour') AS pings_1h,
      (SELECT count(*)::int FROM location_pings WHERE created_at > now() - interval '1 minute') AS pings_1m,
      (SELECT count(*)::int FROM delivery_log WHERE status IN ('sent','simulated') AND created_at > now() - interval '24 hours') AS messages_24h,
      (SELECT count(*)::int FROM delivery_log WHERE status = 'failed' AND created_at > now() - interval '24 hours') AS failed_messages_24h,
      (SELECT count(*)::int FROM trip_sessions WHERE status = 'auto_closed' AND ended_at > now() - interval '24 hours') AS auto_closed_24h,
      (SELECT count(*)::int FROM location_pings) AS total_pings,
      pg_database_size(current_database())::bigint AS db_bytes`);
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    database: { kind: dbKind(), latencyMs: dbLatencyMs, sizeBytes: stats.db_bytes },
    server: { uptimeSeconds: Math.round(process.uptime()), node: process.version, rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576), load: os.loadavg(), platform: `${os.platform()} ${os.arch()}` },
    messaging: { channel: activeChannel().name, whatsappConfigured: !!(config.whatsapp.token && config.whatsapp.phoneNumberId), exposeDevOtp: config.exposeDevOtp },
    stats,
    jobs: jobStatus(),
    cohorts: await cohortState(),
    devSecretInUse: config.devSecret,
  });
});

router.post('/jobs/:name/run', async (req, res) => {
  const result = await runJobNow(req.params.name);
  await audit(req.auth, 'job.run', { details: { job: req.params.name, result } });
  res.json(result);
});

router.get('/costs', async (req, res) => {
  const costPerMsg = Number(await getConfig('cost_per_message_pkr', DEFAULT_COST_PER_MESSAGE_PKR));
  const pkrPerUsd = Number(await getConfig('pkr_per_usd', 280));
  const byOp = await many(`
    SELECT o.id, o.name, o.package, o.status,
      (SELECT count(*)::int FROM delivery_log d WHERE d.operator_id = o.id AND d.created_at > now() - interval '30 days' AND d.status IN ('sent','simulated')) AS messages_30d,
      (SELECT count(*)::int FROM location_pings p JOIN trip_sessions t ON t.id = p.trip_session_id WHERE t.operator_id = o.id AND p.created_at > now() - interval '30 days') AS pings_30d,
      (SELECT count(*)::int FROM subscriptions s WHERE s.operator_id = o.id AND s.status = 'active') AS active_subscribers,
      (SELECT COALESCE(sum(amount),0)::int FROM subscriptions s WHERE s.operator_id = o.id AND s.payment_status = 'confirmed' AND s.confirmed_at > now() - interval '30 days') AS passenger_revenue_30d
    FROM operators o ORDER BY o.name`);
  const rows = byOp.map((o) => {
    const messagingCost = Math.round(o.messages_30d * costPerMsg);
    const packageRevenue = o.status === 'active' ? PACKAGE_PRICES[o.package] : 0;
    return { ...o, messaging_cost_pkr: messagingCost, package_revenue_pkr: packageRevenue };
  });
  const totals = rows.reduce(
    (t, r) => ({
      messages: t.messages + r.messages_30d,
      messagingCost: t.messagingCost + r.messaging_cost_pkr,
      packageRevenue: t.packageRevenue + r.package_revenue_pkr,
      passengerRevenue: t.passengerRevenue + r.passenger_revenue_30d,
    }),
    { messages: 0, messagingCost: 0, packageRevenue: 0, passengerRevenue: 0 },
  );
  // Fixed infra estimates from the business model (USD/month): demo $0, 1 operator ~$26, 10 operators ~$86
  const activeOps = rows.filter((r) => r.status === 'active').length;
  const infraUsd = activeOps === 0 ? 0 : activeOps <= 1 ? 26 : activeOps <= 10 ? 26 + ((86 - 26) * (activeOps - 1)) / 9 : 86 + (activeOps - 10) * 6;
  res.json({
    assumptions: { costPerMessagePkr: costPerMsg, pkrPerUsd, note: 'Infra is an estimate from the business model; messaging uses delivery_log x cost per message.' },
    rows,
    totals: { ...totals, infraUsd: Math.round(infraUsd), infraPkr: Math.round(infraUsd * pkrPerUsd), grossMarginPkr: totals.packageRevenue + totals.passengerRevenue - totals.messagingCost - Math.round(infraUsd * pkrPerUsd) },
  });
});

// ---------------------------------------------------------------- audit log (FR-D-13/14)
router.get('/audit', async (req, res) => {
  const f = parse(
    z.object({
      q: z.string().max(100).optional(),
      action: z.string().max(60).optional(),
      operator: uuid.optional(),
      role: z.enum(['developer', 'admin', 'conductor', 'passenger', 'system']).optional(),
      from: z.string().date().optional(),
      to: z.string().date().optional(),
      page: z.coerce.number().int().min(1).default(1),
    }),
    req.query,
  );
  const conds = ['1=1'];
  const params = [];
  const add = (sql, v) => {
    params.push(v);
    conds.push(sql.replaceAll('?', `$${params.length}`));
  };
  if (f.q) add(`(a.action ILIKE ? OR a.actor_label ILIKE ? OR a.entity_id ILIKE ? OR a.details::text ILIKE ?)`, `%${f.q}%`);
  if (f.action) add(`a.action LIKE ?`, `${f.action}%`);
  if (f.operator) add(`a.operator_id = ?`, f.operator);
  if (f.role) add(`a.actor_role = ?`, f.role);
  if (f.from) add(`a.created_at >= (?::date AT TIME ZONE '${config.timezone}')`, f.from);
  if (f.to) add(`a.created_at < ((?::date + 1) AT TIME ZONE '${config.timezone}')`, f.to);
  const pageSize = 50;
  const where = conds.join(' AND ');
  const total = await one(`SELECT count(*)::int AS n FROM audit_log a WHERE ${where}`, params);
  const rows = await many(
    `SELECT a.*, o.name AS operator_name FROM audit_log a LEFT JOIN operators o ON o.id = a.operator_id
      WHERE ${where} ORDER BY a.created_at DESC LIMIT ${pageSize} OFFSET ${(f.page - 1) * pageSize}`,
    params,
  );
  const actions = await many(`SELECT DISTINCT split_part(action, '.', 1) AS a FROM audit_log ORDER BY 1`);
  res.json({ rows, total: total.n, page: f.page, pageSize, actionGroups: actions.map((x) => x.a) });
});

// ---------------------------------------------------------------- outbox (simulated WhatsApp)
router.get('/outbox', async (req, res) => {
  const f = parse(z.object({ recipient: z.string().max(30).optional(), template: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
  const conds = ['1=1'];
  const params = [];
  if (f.recipient) {
    params.push(`%${f.recipient.replace(/\D/g, '').replace(/^0/, '')}%`);
    conds.push(`d.recipient LIKE $${params.length}`);
  }
  if (f.template) {
    params.push(f.template);
    conds.push(`d.template = $${params.length}`);
  }
  params.push(f.limit);
  const rows = await many(
    `SELECT d.*, o.name AS operator_name FROM delivery_log d LEFT JOIN operators o ON o.id = d.operator_id
      WHERE ${conds.join(' AND ')} ORDER BY d.created_at DESC LIMIT $${params.length}`,
    params,
  );
  const templates = await many(`SELECT template, count(*)::int AS n FROM delivery_log GROUP BY template ORDER BY template`);
  res.json({ rows, templates, channel: activeChannel().name });
});

// ---------------------------------------------------------------- paid message switches
// About $0.015 per utility/authentication template in Pakistan (Oct 2026 press reports) at Rs 280/USD
const DEFAULT_COST_PER_MESSAGE_PKR = 4.2;

router.get('/messages', async (req, res) => {
  const switches = await getMessageSwitches();
  const costPerMessage = Number(await getConfig('cost_per_message_pkr', DEFAULT_COST_PER_MESSAGE_PKR));
  // Renewal reminders share one template; split them into T-7 / T-3 by the day count in the text
  const counts = await many(`
    SELECT CASE WHEN template <> 'renewal_reminder' THEN template
                WHEN substring(body from 'ends in ([0-9]+) day')::int > 3 THEN 'renewal_reminder_7'
                ELSE 'renewal_reminder_3' END AS key,
           status, count(*)::int AS n
    FROM delivery_log WHERE created_at > now() - interval '30 days'
    GROUP BY 1, 2`);
  const tally = {};
  for (const r of counts) {
    const t = (tally[r.key] ||= { sent: 0, skipped: 0, failed: 0 });
    if (r.status === 'skipped') t.skipped += r.n;
    else if (r.status === 'failed') t.failed += r.n;
    else t.sent += r.n;
  }
  res.json({
    costPerMessage,
    channel: activeChannel().name,
    exposeDevOtp: config.exposeDevOtp,
    conductorStaySignedIn: await conductorStaysSignedIn(),
    types: MESSAGE_TYPES.map((t) => ({
      ...t,
      recommended: t.on,
      on: switches[t.key],
      last30: tally[t.key] || { sent: 0, skipped: 0, failed: 0 },
    })),
  });
});

router.put('/messages', async (req, res) => {
  const body = parse(
    z.object({
      switches: z.record(z.boolean()).optional(),
      preset: z.enum(['recommended', 'essential_only']).optional(),
      conductorStaySignedIn: z.boolean().optional(),
    }),
    req.body,
  );
  let patch = body.switches || {};
  for (const k of Object.keys(patch)) if (!isMessageKey(k)) throw new HttpError(400, `Unknown message type: ${k}`);
  if (body.preset === 'recommended') patch = recommendedSwitches();
  if (body.preset === 'essential_only') patch = Object.fromEntries(MESSAGE_TYPES.map((t) => [t.key, !!t.essential]));
  const switches = await updateMessageSwitches(patch);
  if (body.conductorStaySignedIn !== undefined) await setConfig('conductor_stay_signed_in', body.conductorStaySignedIn);
  await audit(req.auth, 'messages.update', { details: { ...(body.preset ? { preset: body.preset } : { switches: patch }), ...(body.conductorStaySignedIn !== undefined ? { conductorStaySignedIn: body.conductorStaySignedIn } : {}) } });
  res.json({ ok: true, switches });
});

// ---------------------------------------------------------------- platform config
const CONFIG_SCHEMAS = {
  force_signup_window: z.boolean(),
  trip_auto_close_minutes: z.number().int().min(2).max(240),
  cost_per_message_pkr: z.number().min(0).max(1000),
  pkr_per_usd: z.number().min(1).max(10000),
  platform_name: z.string().trim().min(2).max(60),
  signup_window_a: z.object({ start: z.number().int().min(1).max(28), end: z.number().int().min(1).max(28) }).refine((w) => w.end >= w.start, 'End must be after start'),
  signup_window_b: z.object({ start: z.number().int().min(1).max(28), end: z.number().int().min(1).max(28) }).refine((w) => w.end >= w.start, 'End must be after start'),
};

router.get('/config', async (req, res) => {
  const all = await getAllConfig();
  res.json({
    values: { cost_per_message_pkr: DEFAULT_COST_PER_MESSAGE_PKR, pkr_per_usd: 280, ...all },
    editable: Object.keys(CONFIG_SCHEMAS),
    env: {
      databaseKind: dbKind(),
      messagingChannel: activeChannel().name,
      publicBaseUrl: config.publicBaseUrl,
      timezone: config.timezone,
      exposeDevOtp: config.exposeDevOtp,
    },
  });
});

router.put('/config/:key', async (req, res) => {
  const schema = CONFIG_SCHEMAS[req.params.key];
  if (!schema) throw new HttpError(400, 'This setting cannot be edited here.');
  const { value } = parse(z.object({ value: schema }), req.body);
  if (req.params.key.startsWith('signup_window_')) {
    const other = await getConfig(req.params.key === 'signup_window_a' ? 'signup_window_b' : 'signup_window_a');
    if (other && value.start <= other.end && other.start <= value.end) throw new HttpError(400, 'Cohort A and B signup windows must not overlap.');
  }
  await setConfig(req.params.key, value);
  await audit(req.auth, 'config.update', { details: { key: req.params.key, value } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- developer 2FA (FR-D-01)
router.post('/2fa/setup', async (req, res) => {
  const u = await one(`SELECT email, totp_enabled FROM users WHERE id = $1`, [req.auth.id]);
  if (u.totp_enabled) throw conflict('2FA is already enabled.');
  const secret = authenticator.generateSecret();
  await query(`UPDATE users SET totp_secret = $2 WHERE id = $1`, [req.auth.id, secret]);
  const otpauth = authenticator.keyuri(u.email, (await getConfig('platform_name', 'EV Bus Live')) + ' Developer', secret);
  res.json({ secret, otpauth, qr: await QRCode.toDataURL(otpauth, { margin: 1, width: 220 }) });
});

router.post('/2fa/enable', async (req, res) => {
  const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
  const u = await one(`SELECT totp_secret FROM users WHERE id = $1`, [req.auth.id]);
  if (!u.totp_secret || !authenticator.verify({ token: code, secret: u.totp_secret })) throw new HttpError(400, 'That code is not correct. Check the time on your phone.');
  await query(`UPDATE users SET totp_enabled = true WHERE id = $1`, [req.auth.id]);
  await audit(req.auth, 'developer.2fa_enable');
  res.json({ ok: true });
});

router.post('/2fa/disable', async (req, res) => {
  const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
  const u = await one(`SELECT totp_secret, totp_enabled FROM users WHERE id = $1`, [req.auth.id]);
  if (!u.totp_enabled || !authenticator.verify({ token: code, secret: u.totp_secret })) throw new HttpError(400, 'That code is not correct.');
  await query(`UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = $1`, [req.auth.id]);
  await audit(req.auth, 'developer.2fa_disable');
  res.json({ ok: true });
});

export default router;
