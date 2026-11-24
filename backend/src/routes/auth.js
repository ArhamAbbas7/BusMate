import crypto from 'node:crypto';
import { Router } from 'express';
import { authenticator } from 'otplib';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { requireAuth, signToken, verifyPassword, verifyToken } from '../lib/auth.js';
import { CONDUCTOR_SHORT_SESSION_DAYS, conductorStaysSignedIn } from '../lib/messageSwitches.js';
import { getFeatures } from '../lib/features.js';
import { HttpError, parse } from '../lib/http.js';
import { normalizePhone } from '../lib/phone.js';
import { rateLimit } from '../lib/ratelimit.js';
import { sendMessage } from '../messaging/index.js';
import { otpMessage } from '../messaging/messages.js';

const router = Router();
authenticator.options = { window: 1 };

const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, message: 'Too many sign-in attempts. Wait a minute and try again.' });

async function issueUserToken(user) {
  const token = await signToken({ sub: user.id, role: user.role, op: user.operator_id || undefined, name: user.name }, '12h');
  await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
  await audit({ id: user.id, role: user.role, name: user.name, operatorId: user.operator_id }, 'auth.login');
  return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, operatorId: user.operator_id } };
}

// FR-D-01 / FR-A-01
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
  const user = await one(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email]);
  if (!user || !(await verifyPassword(password, user.password_hash))) throw new HttpError(401, 'Wrong email or password.');
  if (user.status !== 'active') throw new HttpError(403, 'This account is disabled.');
  if (user.role === 'admin') {
    const op = await one(`SELECT status FROM operators WHERE id = $1`, [user.operator_id]);
    if (op?.status !== 'active') throw new HttpError(403, 'This bus service is suspended. Contact the platform team.');
  }
  if (user.totp_enabled) {
    const challenge = await signToken({ sub: user.id, purpose: '2fa' }, '5m');
    return res.json({ requires2fa: true, challenge });
  }
  res.json(await issueUserToken(user));
});

router.post('/login/2fa', loginLimiter, async (req, res) => {
  const { challenge, code } = parse(z.object({ challenge: z.string(), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }), req.body);
  let p;
  try {
    p = await verifyToken(challenge);
  } catch {
    throw new HttpError(401, 'Sign-in timed out. Start again.');
  }
  if (p.purpose !== '2fa') throw new HttpError(401, 'Invalid sign-in step.');
  const user = await one(`SELECT * FROM users WHERE id = $1`, [p.sub]);
  if (!user?.totp_enabled || !authenticator.verify({ token: code, secret: user.totp_secret })) {
    throw new HttpError(401, 'That code is not correct.');
  }
  res.json(await issueUserToken(user));
});

// FR-C-01: conductor phone OTP
const otpLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: 5,
  key: (req) => `otp:${normalizePhone(req.body?.phone) || req.ip}`,
  message: 'Too many codes requested. Try again in a few minutes.',
});
const hashOtp = (phone, code) => crypto.createHash('sha256').update(`${phone}:${code}:${config.jwtSecret}`).digest('hex');

router.post('/conductor/request-otp', otpLimiter, async (req, res) => {
  const { phone: raw } = parse(z.object({ phone: z.string().min(7) }), req.body);
  const phone = normalizePhone(raw);
  if (!phone) throw new HttpError(400, 'Enter a valid mobile number.');
  const c = await one(
    `SELECT c.*, o.status AS op_status FROM conductors c JOIN operators o ON o.id = c.operator_id WHERE c.phone = $1`,
    [phone],
  );
  if (!c || c.status !== 'active') throw new HttpError(404, 'This number is not registered as an active conductor. Ask your admin.');
  if (c.op_status !== 'active') throw new HttpError(403, 'This bus service is suspended.');
  const recent = await one(`SELECT 1 FROM otp_codes WHERE phone = $1 AND created_at > now() - interval '30 seconds'`, [phone]);
  if (recent) throw new HttpError(429, 'Please wait 30 seconds before requesting another code.');

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await query(`INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, now() + interval '5 minutes')`, [phone, hashOtp(phone, code)]);
  const sent = await sendMessage({ to: phone, message: otpMessage(code), operatorId: c.operator_id });
  if (sent.skipped && !config.exposeDevOtp) {
    throw new HttpError(503, 'Login codes are switched off right now. Ask the platform team to turn them back on.');
  }
  res.json({
    sent: sent.ok,
    phone,
    expiresInSeconds: 300,
    channel: sent.status === 'sent' ? 'whatsapp' : 'outbox',
    ...(config.exposeDevOtp ? { devCode: code } : {}),
  });
});

router.post('/conductor/verify-otp', loginLimiter, async (req, res) => {
  const body = parse(z.object({ phone: z.string(), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }), req.body);
  const phone = normalizePhone(body.phone);
  const otp = await one(
    `SELECT * FROM otp_codes WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
    [phone],
  );
  if (!otp) throw new HttpError(401, 'Code expired. Request a new one.');
  if (otp.attempts >= 5) throw new HttpError(429, 'Too many wrong attempts. Request a new code.');
  const ok = crypto.timingSafeEqual(Buffer.from(otp.code_hash), Buffer.from(hashOtp(phone, body.code)));
  if (!ok) {
    await query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);
    throw new HttpError(401, 'That code is not correct.');
  }
  await query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [otp.id]);
  const c = await one(`SELECT * FROM conductors WHERE phone = $1 AND status = 'active'`, [phone]);
  if (!c) throw new HttpError(401, 'Conductor not active.');
  await query(`UPDATE conductors SET last_login_at = now() WHERE id = $1`, [c.id]);
  // Conductors stay signed in until they sign out (or are deactivated), so no login code is paid for twice
  const stay = await conductorStaysSignedIn();
  const token = await signToken({ sub: c.id, role: 'conductor', op: c.operator_id, name: c.name }, stay ? null : `${CONDUCTOR_SHORT_SESSION_DAYS}d`);
  await audit({ id: c.id, role: 'conductor', name: c.name, operatorId: c.operator_id }, 'auth.conductor_login');
  res.json({ token, conductor: { id: c.id, name: c.name, phone: c.phone } });
});

router.get('/me', requireAuth(), async (req, res) => {
  const a = req.auth;
  const out = { role: a.role, id: a.id, name: a.name, impersonating: !!a.impersonatorId };
  if (a.role === 'developer') {
    const u = await one(`SELECT email, totp_enabled FROM users WHERE id = $1`, [a.id]);
    Object.assign(out, u);
  }
  if (a.role === 'admin' || a.role === 'conductor') {
    out.operator = await one(`SELECT id, name, slug, package, status FROM operators WHERE id = $1`, [a.operatorId]);
    if (a.role === 'admin') out.features = (await getFeatures(a.operatorId)).features;
  }
  res.json(out);
});

export default router;
