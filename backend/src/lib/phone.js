import { config } from '../config.js';

/**
 * Normalise a phone number to E.164 (+923001234567).
 * Accepts 03001234567, 3001234567, 923001234567, +92 300 1234567, 0092...
 * Returns null when it does not look like a phone number.
 */
export function normalizePhone(input, cc = config.defaultCountryCode) {
  let s = String(input ?? '').trim().replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) {
    if (s.startsWith('0')) s = `+${cc}${s.slice(1)}`;
    else if (s.startsWith(cc) && s.length > 10) s = `+${s}`;
    else s = `+${cc}${s}`;
  }
  return /^\+\d{10,15}$/.test(s) ? s : null;
}

/** +923001234567 -> 0300 1234567 style display for local numbers */
export function displayPhone(e164, cc = config.defaultCountryCode) {
  if (!e164) return '';
  if (e164.startsWith(`+${cc}`)) {
    const local = `0${e164.slice(cc.length + 1)}`;
    return `${local.slice(0, 4)} ${local.slice(4)}`;
  }
  return e164;
}
