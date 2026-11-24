import { HttpError } from './http.js';

/** Small in-memory rate limiter (fine for one server; swap for Redis/Azure later). */
export function rateLimit({ windowMs, max, key = (req) => req.ip, message = 'Too many attempts. Please wait a moment.' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    const entry = hits.get(k);
    if (!entry || entry.reset < now) {
      hits.set(k, { count: 1, reset: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) throw new HttpError(429, message);
    next();
  };
}
