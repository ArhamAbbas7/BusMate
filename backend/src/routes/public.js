// Passenger-facing endpoints - no login (FR-P-*)
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { many, one } from '../db/index.js';
import { getFeatures } from '../lib/features.js';
import { HttpError, notFound, parse } from '../lib/http.js';
import { normalizePhone } from '../lib/phone.js';
import { getConfig } from '../lib/platform.js';
import { rateLimit } from '../lib/ratelimit.js';
import { proofUpload } from '../lib/storage.js';
import { cohortState } from '../services/cohorts.js';
import { createSignup, getSubscription, joinWaitlist } from '../services/subscriptions.js';
import { liveView } from '../services/trips.js';

const router = Router();

async function activeOperator(slug) {
  const op = await one(`SELECT * FROM operators WHERE slug = $1`, [slug]);
  if (!op || op.status !== 'active') throw notFound('Bus service');
  return op;
}

router.get('/config', async (req, res) => {
  res.json({
    platformName: await getConfig('platform_name', 'EV Bus Live'),
    mapCenter: config.mapCenter,
    pingIntervalSeconds: config.pingIntervalSeconds,
    timezone: config.timezone,
    messagingChannel: config.messagingChannel,
  });
});

router.get('/operators', async (req, res) => {
  res.json(await many(`SELECT name, slug FROM operators WHERE status = 'active' ORDER BY name`));
});

router.get('/operators/:slug', async (req, res) => {
  const op = await activeOperator(req.params.slug);
  const routes = await many(
    `SELECT id, code, name, towards_label, backward_label FROM routes WHERE operator_id = $1 AND status = 'active' ORDER BY code`,
    [op.id],
  );
  const state = await cohortState();
  res.json({
    name: op.name,
    slug: op.slug,
    price: op.passenger_price,
    paymentInstructions: op.payment_instructions,
    routes,
    window: { open: state.open, next: state.next, today: state.today },
  });
});

const signupLimiter = rateLimit({ windowMs: 10 * 60_000, max: 10, message: 'Too many signups from this device. Try again later.' });

const phoneField = z.string().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid mobile number' });
  return p ?? '';
});

// FR-P-01..07
router.post('/operators/:slug/signup', signupLimiter, proofUpload.single('proof'), async (req, res) => {
  const op = await activeOperator(req.params.slug);
  const body = parse(
    z.object({
      routeId: z.string().uuid('Choose a route'),
      name: z.string().trim().min(2, 'Enter your name').max(80),
      phone: phoneField,
      paymentMethod: z.enum(['jazzcash', 'easypaisa', 'bank'], { errorMap: () => ({ message: 'Choose a payment method' }) }),
      paymentRef: z.string().trim().min(4, 'Enter the transaction ID from your payment').max(60),
    }),
    req.body,
  );
  const result = await createSignup(op, { ...body, proofFile: req.file?.filename });
  res.status(201).json(result);
});

// FR-P-11
router.post('/operators/:slug/waitlist', signupLimiter, async (req, res) => {
  const op = await activeOperator(req.params.slug);
  const body = parse(
    z.object({ routeId: z.string().uuid('Choose a route'), name: z.string().trim().min(2).max(80), phone: phoneField }),
    req.body,
  );
  res.status(201).json(await joinWaitlist(op, body));
});

// Status page after signup. The subscription id (random UUID) acts as the access key.
router.get('/subscriptions/:id', async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) throw notFound('Signup');
  const s = await getSubscription(req.params.id);
  const maps = s.status === 'active';
  res.json({
    id: s.id,
    name: s.subscriber_name,
    operator: s.operator_name,
    operatorSlug: s.operator_slug,
    route: `${s.route_code} - ${s.route_name}`,
    cohort: s.cohort_code,
    status: s.status,
    paymentStatus: s.payment_status,
    rejectionReason: s.rejection_reason,
    expiry: s.subscription_expiry || s.cohort_end,
    submittedAt: s.created_at,
    liveToken: maps ? s.live_token : null,
    towardsLabel: s.towards_label,
    backwardLabel: s.backward_label,
  });
});

// FR-P-09 / FR-P-10
router.get('/live/:token', async (req, res) => {
  const data = await liveView(req.params.token, req.query.dir);
  const route = await one(`SELECT operator_id FROM routes WHERE live_token = $1`, [req.params.token]);
  const { features } = await getFeatures(route.operator_id);
  if (features.passenger_map === false) throw new HttpError(403, 'The live map is not enabled for this service.');
  res.set('Cache-Control', 'no-store').json(data);
});

export default router;
