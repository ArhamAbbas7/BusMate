import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';
import { one } from '../db/index.js';
import { HttpError } from './http.js';
import { CONDUCTOR_SHORT_SESSION_DAYS, conductorStaysSignedIn } from './messageSwitches.js';

const key = new TextEncoder().encode(config.jwtSecret);

export const hashPassword = (pw) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);

/**
 * Token claims: sub (user/conductor id), role, op (operator id), name, imp (impersonating developer id)
 */
export async function signToken(claims, expiresIn = '12h') {
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt();
  if (expiresIn) jwt.setExpirationTime(expiresIn); // null = no expiry (conductor "stay signed in")
  return jwt.sign(key);
}

export async function verifyToken(token) {
  const { payload } = await jwtVerify(token, key);
  return payload;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/**
 * Require a signed-in principal with one of `roles`.
 * Sets req.auth = { id, role, operatorId, name, impersonatorId }.
 * Tenant isolation (SR-11/12/13): operatorId ALWAYS comes from the token, never from the request.
 */
export function requireAuth(...roles) {
  return async (req, res, next) => {
    const token = bearer(req);
    if (!token) throw new HttpError(401, 'Please sign in.');
    let p;
    try {
      p = await verifyToken(token);
    } catch {
      throw new HttpError(401, 'Your session has expired. Please sign in again.');
    }
    if (p.purpose) throw new HttpError(401, 'Please finish signing in.');
    if (roles.length && !roles.includes(p.role)) throw new HttpError(403, 'You do not have access to this area.');

    if (p.role === 'conductor') {
      const c = await one(
        `SELECT c.status, o.status AS op_status FROM conductors c JOIN operators o ON o.id = c.operator_id WHERE c.id = $1`,
        [p.sub],
      );
      if (!c || c.status !== 'active') throw new HttpError(401, 'This conductor account is not active.');
      if (c.op_status !== 'active') throw new HttpError(403, 'This bus service is currently suspended.');
      // A no-expiry session falls back to the short limit if "stay signed in" is switched off later
      if (!p.exp && !(await conductorStaysSignedIn()) && Date.now() / 1000 - (p.iat || 0) > CONDUCTOR_SHORT_SESSION_DAYS * 86400) {
        throw new HttpError(401, 'Your session has expired. Please sign in again.');
      }
    } else if (p.role === 'admin') {
      const op = await one(`SELECT status FROM operators WHERE id = $1`, [p.op]);
      if (!op) throw new HttpError(401, 'Operator not found.');
      if (op.status !== 'active' && !p.imp) throw new HttpError(403, 'This bus service is currently suspended. Contact the platform team.');
      if (!p.imp) {
        const u = await one(`SELECT status FROM users WHERE id = $1`, [p.sub]);
        if (!u || u.status !== 'active') throw new HttpError(401, 'This account is disabled.');
      }
    } else if (p.role === 'developer') {
      const u = await one(`SELECT status FROM users WHERE id = $1 AND role = 'developer'`, [p.sub]);
      if (!u || u.status !== 'active') throw new HttpError(401, 'This account is disabled.');
    }

    req.auth = { id: p.sub, role: p.role, operatorId: p.op || null, name: p.name, impersonatorId: p.imp || null };
    next();
  };
}
