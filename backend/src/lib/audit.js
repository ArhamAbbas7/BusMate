import { query } from '../db/index.js';

/**
 * Write an audit_log row. `actor` is req.auth, or { role: 'system' } / { role: 'passenger', name: phone }.
 * Failures never break the request.
 */
export async function audit(actor, action, { operatorId = null, entityType = null, entityId = null, details = {} } = {}) {
  try {
    const d = { ...details };
    if (actor?.impersonatorId) d.impersonated_by = actor.impersonatorId;
    await query(
      `INSERT INTO audit_log (actor_id, actor_role, actor_label, operator_id, action, entity_type, entity_id, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        actor?.id ?? null,
        actor?.role ?? 'system',
        actor?.name ?? null,
        operatorId ?? actor?.operatorId ?? null,
        action,
        entityType,
        entityId == null ? null : String(entityId),
        JSON.stringify(d),
      ],
    );
  } catch (e) {
    console.error('[audit] failed to write', action, e.message);
  }
}
