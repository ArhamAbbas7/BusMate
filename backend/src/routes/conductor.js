// Conductor mobile web endpoints (SRS 4.3)
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { many, one } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { conflict, parse } from '../lib/http.js';
import { TRIP_SELECT, addPings, directionLabel, getTrip, groupMessageFor, startTrip, stopTrip, tripSummary } from '../services/trips.js';

const router = Router();
router.use(requireAuth('conductor'));

const idParam = (req) => parse(z.string().uuid(), req.params.id);

// FR-C-02: only assigned, active routes of the conductor's own operator (SR-13)
router.get('/me', async (req, res) => {
  const a = req.auth;
  const [conductor, routes, current] = await Promise.all([
    one(
      `SELECT c.id, c.name, c.phone, o.name AS operator_name FROM conductors c JOIN operators o ON o.id = c.operator_id WHERE c.id = $1`,
      [a.id],
    ),
    many(
      `SELECT r.id, r.code, r.name, r.towards_label, r.backward_label, r.path,
              (SELECT json_agg(t.direction) FROM trip_sessions t WHERE t.route_id = r.id AND t.status = 'active') AS live_directions
         FROM routes r JOIN conductor_route_assignments a ON a.route_id = r.id
        WHERE a.conductor_id = $1 AND r.operator_id = $2 AND r.status = 'active' ORDER BY r.code`,
      [a.id, a.operatorId],
    ),
    one(`${TRIP_SELECT} WHERE t.conductor_id = $1 AND t.status = 'active'`, [a.id]),
  ]);
  res.json({
    conductor,
    routes,
    currentTrip: current ? { ...current, direction_label: directionLabel(current), message: await groupMessageFor(current) } : null,
    pingIntervalSeconds: config.pingIntervalSeconds,
    mapCenter: config.mapCenter,
  });
});

router.get('/trips/recent', async (req, res) => {
  const rows = await many(`${TRIP_SELECT} WHERE t.conductor_id = $1 ORDER BY t.started_at DESC LIMIT 10`, [req.auth.id]);
  res.json(rows.map((t) => ({ ...t, direction_label: directionLabel(t) })));
});

// FR-C-03..05
router.post('/trips', async (req, res) => {
  const body = parse(z.object({ routeId: z.string().uuid('Choose a route'), direction: z.enum(['towards', 'backward']) }), req.body);
  const r = await startTrip(req.auth, body);
  res.status(201).json({ ...r, trip: { ...r.trip, direction_label: directionLabel(r.trip) } });
});

const pingSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().nullable().optional(),
  speed: z.number().nullable().optional(),
  heading: z.number().nullable().optional(),
  recordedAt: z.union([z.string(), z.number()]).optional(),
});

// FR-C-06 / FR-C-12: single ping or queued batch
router.post('/trips/:id/pings', async (req, res) => {
  const body = parse(z.object({ pings: z.array(pingSchema).min(1).max(500) }), req.body);
  res.json(await addPings(req.auth, idParam(req), body.pings));
});

// FR-C-07 / FR-C-09
router.post('/trips/:id/stop', async (req, res) => res.json(await stopTrip(req.auth, idParam(req))));

router.get('/trips/:id/summary', async (req, res) => {
  const id = idParam(req);
  await getTrip(id, { conductorId: req.auth.id });
  res.json(await tripSummary(id));
});

// FR-C-08
router.get('/trips/:id/message', async (req, res) => {
  const trip = await getTrip(idParam(req), { conductorId: req.auth.id });
  if (!trip) throw conflict('Trip not found');
  res.json(await groupMessageFor(trip));
});

export default router;
