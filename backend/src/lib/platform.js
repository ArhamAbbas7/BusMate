// platform_config access with a short cache.
import { many, query } from '../db/index.js';
import { DEFAULT_WINDOWS } from './cohort.js';

let cache = null;
let cachedAt = 0;

export async function getAllConfig() {
  if (cache && Date.now() - cachedAt < 5000) return cache;
  const rows = await many(`SELECT key, value FROM platform_config`);
  cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  cachedAt = Date.now();
  return cache;
}

export async function getConfig(key, fallback = null) {
  const all = await getAllConfig();
  return all[key] ?? fallback;
}

export async function setConfig(key, value) {
  await query(
    `INSERT INTO platform_config (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
  cache = null;
}

export async function getWindows() {
  const all = await getAllConfig();
  return {
    A: all.signup_window_a ?? DEFAULT_WINDOWS.A,
    B: all.signup_window_b ?? DEFAULT_WINDOWS.B,
  };
}
