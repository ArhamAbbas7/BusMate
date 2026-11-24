import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..');
dotenv.config({ path: path.join(BACKEND_ROOT, '.env'), quiet: true });

const env = process.env;
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

let jwtSecret = env.JWT_SECRET;
if (!jwtSecret || jwtSecret === 'change-me-to-a-long-random-string') {
  if (env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');
  // Stable per-machine dev secret so logins survive restarts
  jwtSecret = crypto.createHash('sha256').update(`ev-bus-dev:${BACKEND_ROOT}`).digest('hex');
}

const [lat, lng] = (env.MAP_CENTER || '31.5204,74.3587').split(',').map(Number);

export const config = {
  port: Number(env.PORT || 4000),
  publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 4000}`).replace(/\/$/, ''),
  jwtSecret,
  devSecret: jwtSecret === crypto.createHash('sha256').update(`ev-bus-dev:${BACKEND_ROOT}`).digest('hex'),
  timezone: env.APP_TIMEZONE || 'Asia/Karachi',
  defaultCountryCode: env.DEFAULT_COUNTRY_CODE || '92',
  databaseUrl: env.DATABASE_URL || '',
  // 'memory://' keeps the database in RAM (used by tests)
  pgliteDir: env.PGLITE_DIR || path.join(BACKEND_ROOT, 'data', 'pglite'),
  seedOnEmpty: bool(env.SEED_ON_EMPTY, true),
  messagingChannel: (env.MESSAGING_CHANNEL || 'console').toLowerCase(),
  whatsapp: {
    token: env.WHATSAPP_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    apiVersion: env.WHATSAPP_API_VERSION || 'v21.0',
  },
  exposeDevOtp: bool(env.EXPOSE_DEV_OTP, true),
  uploadDir: path.resolve(BACKEND_ROOT, env.UPLOAD_DIR || 'uploads'),
  frontendDir: path.join(PROJECT_ROOT, 'frontend'),
  mapCenter: { lat: lat || 31.5204, lng: lng || 74.3587 },
  // Business rules (SRS 4.5)
  tripAutoCloseMinutes: 10, // SR-03
  pingIntervalSeconds: 30, // FR-C-06
};
