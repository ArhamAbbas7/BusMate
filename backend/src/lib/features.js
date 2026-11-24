// Feature flag resolution (SRS 6.7): package defaults, then per-operator overrides (unexpired) win.
import { many, one } from '../db/index.js';
import { HttpError } from './http.js';

export const FEATURE_INFO = {
  max_routes: { label: 'Max routes', type: 'limit' },
  max_admins: { label: 'Admin accounts', type: 'limit' },
  max_conductors: { label: 'Max conductors', type: 'limit' },
  routes_per_subscriber: { label: 'Routes per subscriber', type: 'limit' },
  trip_history_days: { label: 'Trip history (days)', type: 'limit' },
  passenger_map: { label: 'Passenger live map', type: 'bool' },
  auto_group_post: { label: 'Automated group posting', type: 'bool', future: true },
  eta_prediction: { label: 'ETA prediction', type: 'bool', future: true },
  custom_branding: { label: 'Custom branding', type: 'bool' },
  api_access: { label: 'API access', type: 'bool', future: true },
  sla: { label: 'SLA', type: 'text' },
  support: { label: 'Support', type: 'text' },
};

export async function getFeatures(operatorId) {
  const op = await one(`SELECT package FROM operators WHERE id = $1`, [operatorId]);
  if (!op) throw new HttpError(404, 'Operator not found');
  const base = await many(`SELECT feature_key, value FROM package_features WHERE package = $1`, [op.package]);
  const overrides = await many(
    `SELECT feature_key, value FROM operator_feature_overrides
      WHERE operator_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at`,
    [operatorId],
  );
  const features = {};
  for (const r of base) features[r.feature_key] = r.value;
  const overridden = [];
  for (const r of overrides) {
    features[r.feature_key] = r.value;
    overridden.push(r.feature_key);
  }
  return { package: op.package, features, overridden };
}

/** Throw 403 if adding one more item would exceed the limit. null = unlimited. */
export async function assertLimit(operatorId, key, currentCount, noun) {
  const { package: pkg, features } = await getFeatures(operatorId);
  const limit = features[key];
  if (limit !== null && limit !== undefined && currentCount >= Number(limit)) {
    throw new HttpError(403, `Your ${pkg} package allows up to ${limit} ${noun}. Ask the platform team to upgrade your package.`, {
      limit: key,
    });
  }
}
