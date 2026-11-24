// Trip lifecycle + GPS pings (SRS 6.3, SR-01..04)
import { config } from '../config.js';
import { many, one, query, tx } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { HttpError, conflict, notFound } from '../lib/http.js';
import { getConfig } from '../lib/platform.js';
import { tripGroupMessage } from '../messaging/messages.js';
import { cohortState } from './cohorts.js';

const TRIP_SELECT = `
  SELECT t.*, r.code AS route_code, r.name AS route_name, r.live_token, r.towards_label, r.backward_label,
         c.name AS conductor_name, c.phone AS conductor_phone
    FROM trip_sessions t
    JOIN routes r ON r.id = t.route_id
    JOIN conductors c ON c.id = t.conductor_id`;

export const directionLabel = (trip) => (trip.direction === 'towards' ? trip.towards_label : trip.backward_label);

export async function getTrip(id, { operatorId, conductorId } = {}) {
  const conds = ['t.id = $1'];
  const params = [id];
  if (operatorId) params.push(operatorId) && conds.push(`t.operator_id = $${params.length}`);
  if (conductorId) params.push(conductorId) && conds.push(`t.conductor_id = $${params.length}`);
  const t = await one(`${TRIP_SELECT} WHERE ${conds.join(' AND ')}`, params);
  if (!t) throw notFound('Trip');
  return t;
}

/** The message to paste into WhatsApp, plus which groups to paste it into (both cohorts, same direction). */
export async function groupMessageFor(trip) {
  const groups = await many(`SELECT * FROM route_groups WHERE route_id = $1 AND direction = $2 ORDER BY cohort`, [trip.route_id, trip.direction]);
  return {
    text: tripGroupMessage({
      routeCode: trip.route_code,
      routeName: trip.route_name,
      directionLabel: directionLabel(trip),
      conductorName: trip.conductor_name,
      startedAt: trip.started_at,
      liveToken: trip.live_token,
      direction: trip.direction,
      status: trip.status,
    }),
    groups: groups.map((g) => ({ cohort: g.cohort, wa_group_id: g.wa_group_id, invite_link: g.invite_link })),
  };
}

/** FR-C-05 */
export async function startTrip(auth, { routeId, direction }) {
  const route = await one(
    `SELECT r.* FROM routes r JOIN conductor_route_assignments a ON a.route_id = r.id
      WHERE r.id = $1 AND a.conductor_id = $2 AND r.operator_id = $3`,
    [routeId, auth.id, auth.operatorId],
  );
  if (!route) throw new HttpError(403, 'You are not assigned to this route.'); // SR-04
  if (route.status !== 'active') throw conflict('This route is not active.');

  const mine = await one(`SELECT id FROM trip_sessions WHERE conductor_id = $1 AND status = 'active'`, [auth.id]);
  if (mine) throw conflict('You already have a trip running. Stop it before starting another.', { tripId: mine.id }); // SR-01
  const busy = await one(
    `SELECT t.id, c.name FROM trip_sessions t JOIN conductors c ON c.id = t.conductor_id
      WHERE t.route_id = $1 AND t.direction = $2 AND t.status = 'active'`,
    [routeId, direction],
  );
  if (busy) throw conflict(`${route.code} ${direction === 'towards' ? route.towards_label : route.backward_label} is already live (conductor: ${busy.name}).`); // SR-02

  let tripId;
  try {
    tripId = (
      await one(`INSERT INTO trip_sessions (operator_id, conductor_id, route_id, direction) VALUES ($1,$2,$3,$4) RETURNING id`, [
        auth.operatorId,
        auth.id,
        routeId,
        direction,
      ])
    ).id;
  } catch (e) {
    if (e.code === '23505') throw conflict('A trip for this route and direction (or for you) just started. Refresh and try again.');
    throw e;
  }
  await audit(auth, 'trip.start', { entityType: 'trip', entityId: tripId, details: { route: route.code, direction } });
  const trip = await getTrip(tripId);
  return { trip, message: await groupMessageFor(trip) };
}

const validPing = (p) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);

/** FR-C-06 / FR-C-11 / FR-C-12: accept one or many pings (offline queue flushes arrive as a batch). */
export async function addPings(auth, tripId, pings) {
  const trip = await getTrip(tripId, { conductorId: auth.id });
  const now = Date.now();
  const startedAt = new Date(trip.started_at).getTime();
  const clean = pings
    .map((p) => ({ ...p, t: p.recordedAt ? new Date(p.recordedAt).getTime() : now }))
    .filter((p) => validPing(p) && Number.isFinite(p.t) && p.t <= now + 120000 && p.t >= startedAt - 60000)
    .sort((a, b) => a.t - b.t);
  if (!clean.length) return { accepted: 0, status: trip.status };

  let status = trip.status;
  if (status === 'completed') return { accepted: 0, status, message: 'Trip already stopped.' };
  if (status === 'auto_closed' && now - clean[clean.length - 1].t < 120000) {
    // Conductor came back online with fresh GPS: resume the trip if nobody else took the route meanwhile.
    try {
      await query(`UPDATE trip_sessions SET status = 'active', ended_at = NULL, end_reason = NULL WHERE id = $1`, [tripId]);
      status = 'active';
      await audit(auth, 'trip.resumed', { entityType: 'trip', entityId: tripId });
    } catch (e) {
      if (e.code !== '23505') throw e;
    }
  }

  await tx(async (q) => {
    const values = [];
    const params = [];
    for (const p of clean) {
      const b = params.length;
      params.push(tripId, p.lat, p.lng, p.accuracy ?? null, p.speed ?? null, p.heading ?? null, new Date(p.t).toISOString());
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`);
    }
    await q.query(`INSERT INTO location_pings (trip_session_id, lat, lng, accuracy, speed, heading, recorded_at) VALUES ${values.join(',')}`, params);
    const last = clean[clean.length - 1];
    await q.query(
      `UPDATE trip_sessions SET ping_count = ping_count + $2,
              last_lat = CASE WHEN last_ping_at IS NULL OR last_ping_at <= $3 THEN $4 ELSE last_lat END,
              last_lng = CASE WHEN last_ping_at IS NULL OR last_ping_at <= $3 THEN $5 ELSE last_lng END,
              last_ping_at = GREATEST(COALESCE(last_ping_at, $3), $3)
        WHERE id = $1`,
      [tripId, clean.length, new Date(last.t).toISOString(), last.lat, last.lng],
    );
  });
  return { accepted: clean.length, status };
}

/** FR-C-07 */
export async function stopTrip(auth, tripId) {
  const trip = await getTrip(tripId, { conductorId: auth.id });
  if (trip.status === 'active') {
    await query(`UPDATE trip_sessions SET status = 'completed', ended_at = now(), end_reason = 'conductor' WHERE id = $1`, [tripId]);
    await audit(auth, 'trip.stop', { entityType: 'trip', entityId: tripId });
  }
  return tripSummary(tripId);
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** FR-C-09 */
export async function tripSummary(tripId) {
  const trip = await getTrip(tripId);
  const pings = await many(`SELECT lat, lng, recorded_at FROM location_pings WHERE trip_session_id = $1 ORDER BY recorded_at`, [tripId]);
  let km = 0;
  for (let i = 1; i < pings.length; i++) km += haversineKm(pings[i - 1], pings[i]);
  const end = trip.ended_at ? new Date(trip.ended_at) : new Date();
  return {
    trip,
    directionLabel: directionLabel(trip),
    durationMinutes: Math.round((end - new Date(trip.started_at)) / 60000),
    distanceKm: Math.round(km * 100) / 100,
    pingCount: pings.length,
    path: pings.map((p) => [p.lat, p.lng]),
  };
}

/** SR-03: auto-close trips with no pings for N minutes. */
export async function autoCloseStaleTrips() {
  const minutes = Number(await getConfig('trip_auto_close_minutes', config.tripAutoCloseMinutes)) || config.tripAutoCloseMinutes;
  const rows = await many(
    `UPDATE trip_sessions SET status = 'auto_closed', ended_at = COALESCE(last_ping_at, started_at), end_reason = 'no_pings_${minutes}min'
      WHERE status = 'active' AND COALESCE(last_ping_at, started_at) < now() - ($1 || ' minutes')::interval
      RETURNING id, operator_id`,
    [String(minutes)],
  );
  for (const r of rows) {
    await audit({ role: 'system', name: 'auto-close' }, 'trip.auto_close', { operatorId: r.operator_id, entityType: 'trip', entityId: r.id });
  }
  return { closed: rows.length };
}

/** Public live map payload (FR-P-09 / FR-P-10) */
export async function liveView(token, direction) {
  const route = await one(
    `SELECT r.*, o.name AS operator_name, o.status AS operator_status, o.id AS op_id FROM routes r JOIN operators o ON o.id = r.operator_id WHERE r.live_token = $1`,
    [token],
  );
  if (!route || route.operator_status !== 'active') throw notFound('Live map');
  const dir = direction === 'backward' ? 'backward' : 'towards';
  const trips = await many(`${TRIP_SELECT} WHERE t.route_id = $1 AND t.status = 'active'`, [route.id]);
  const trip = trips.find((t) => t.direction === dir) || null;
  let trail = [];
  if (trip) {
    trail = (
      await many(`SELECT lat, lng FROM location_pings WHERE trip_session_id = $1 ORDER BY recorded_at DESC LIMIT 40`, [trip.id])
    ).reverse().map((p) => [p.lat, p.lng]);
  }
  const state = await cohortState();
  return {
    operator: route.operator_name,
    route: { code: route.code, name: route.name, towards_label: route.towards_label, backward_label: route.backward_label, path: route.path },
    direction: dir,
    directionLabel: dir === 'towards' ? route.towards_label : route.backward_label,
    active: !!trip && trip.last_lat != null,
    started: !!trip,
    bus: trip
      ? {
          lat: trip.last_lat,
          lng: trip.last_lng,
          lastPingAt: trip.last_ping_at,
          startedAt: trip.started_at,
          secondsAgo: trip.last_ping_at ? Math.round((Date.now() - new Date(trip.last_ping_at)) / 1000) : null,
        }
      : null,
    trail,
    otherDirectionLive: trips.some((t) => t.direction !== dir),
    mapCenter: config.mapCenter,
    serverTime: new Date().toISOString(),
    today: state.today,
  };
}

export { TRIP_SELECT };
