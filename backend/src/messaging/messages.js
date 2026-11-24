// Message catalogue. Each message has:
//  - template: the WhatsApp template name you will register in Meta Business Manager
//  - params:   ordered body variables {{1}}, {{2}}, ... for that template
//  - text:     the full rendered text (used by the console Outbox and plain-text mode)
// When you create the templates in Meta, copy the `text` wording and replace values with {{n}}.
import { config } from '../config.js';
import { formatDate } from '../lib/time.js';

const base = () => config.publicBaseUrl;
export const liveMapUrl = (token, direction) => `${base()}/live/?t=${encodeURIComponent(token)}&dir=${direction}`;
export const signupUrl = (slug) => `${base()}/join/?op=${encodeURIComponent(slug)}`;

export function otpMessage(code) {
  return {
    template: 'conductor_login_code',
    params: [code],
    otpCode: code,
    text: `${code} is your conductor login code. It expires in 5 minutes. Do not share it.`,
  };
}

/** FR-A-14 / FR-P-08: invite links for both directions of the subscriber's cohort. */
export function inviteMessage({ name, operatorName, routeCode, routeName, cohort, expiry, towardsLabel, backwardLabel, towardsLink, backwardLink, liveToken }) {
  const towardsMap = liveMapUrl(liveToken, 'towards');
  const backwardMap = liveMapUrl(liveToken, 'backward');
  return {
    template: 'subscription_invite',
    params: [name, `${routeCode} ${routeName}`, formatDate(expiry), towardsLink || '-', backwardLink || '-'],
    text:
      `Welcome ${name}! Your ${operatorName} live tracking for ${routeCode} (${routeName}) is active until ${formatDate(expiry)} (cohort ${cohort}).\n\n` +
      `Join your groups:\n` +
      `👉 ${towardsLabel}: ${towardsLink || '(link not set yet)'}\n` +
      `👉 ${backwardLabel}: ${backwardLink || '(link not set yet)'}\n\n` +
      `Live map:\n${towardsLabel}: ${towardsMap}\n${backwardLabel}: ${backwardMap}`,
  };
}

export function signupReceivedMessage({ name, routeCode, operatorName }) {
  return {
    template: 'signup_received',
    params: [name, routeCode],
    text: `Hi ${name}, we received your ${operatorName} signup for ${routeCode}. We'll send your group links as soon as your payment is verified.`,
  };
}

export function paymentRejectedMessage({ name, routeCode, reason, slug }) {
  return {
    template: 'payment_rejected',
    params: [name, routeCode, reason],
    text: `Hi ${name}, we could not verify your payment for ${routeCode}. Reason: ${reason}. You can submit again here: ${signupUrl(slug)}`,
  };
}

/** FR-P-12: renewal reminders at T-7 and T-3 */
export function renewalReminderMessage({ name, routeCode, expiry, daysLeft, nextWindowStart, nextWindowEnd, slug }) {
  return {
    template: 'renewal_reminder',
    switchKey: daysLeft > 3 ? 'renewal_reminder_7' : 'renewal_reminder_3',
    params: [name, routeCode, String(daysLeft), formatDate(expiry), `${formatDate(nextWindowStart)} - ${formatDate(nextWindowEnd)}`],
    text:
      `Hi ${name}, your ${routeCode} live tracking ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${formatDate(expiry)}). ` +
      `Renew during the signup window ${formatDate(nextWindowStart)} - ${formatDate(nextWindowEnd)}: ${signupUrl(slug)}`,
  };
}

export function expiredMessage({ name, routeCode, slug, nextWindowStart, nextWindowEnd }) {
  return {
    template: 'subscription_expired',
    params: [name, routeCode, `${formatDate(nextWindowStart)} - ${formatDate(nextWindowEnd)}`],
    text: `Hi ${name}, your ${routeCode} subscription has ended. Next signup window: ${formatDate(nextWindowStart)} - ${formatDate(nextWindowEnd)}. ${signupUrl(slug)}`,
  };
}

export function waitlistJoinedMessage({ name, routeCode, nextWindowStart }) {
  return {
    template: 'waitlist_joined',
    params: [name, routeCode, formatDate(nextWindowStart)],
    text: `Hi ${name}, you're on the waitlist for ${routeCode}. We'll message you when signups open on ${formatDate(nextWindowStart)}.`,
  };
}

export function windowOpenMessage({ name, routeCode, windowEnd, slug }) {
  return {
    template: 'signup_window_open',
    params: [name, routeCode, formatDate(windowEnd)],
    text: `Hi ${name}, signups for ${routeCode} live tracking are open until ${formatDate(windowEnd)}. Sign up here: ${signupUrl(slug)}`,
  };
}

export function cohortSwitchedMessage({ name, routeCode, cohort, expiry }) {
  return {
    template: 'cohort_switched',
    params: [name, routeCode, cohort, formatDate(expiry)],
    text: `Hi ${name}, your ${routeCode} subscription moved to cohort ${cohort}, valid until ${formatDate(expiry)}. New group links follow.`,
  };
}

/** Text the conductor / admin copies into the WhatsApp group (FR-C-08, FR-A-19). Not sent automatically. */
export function tripGroupMessage({ routeCode, routeName, directionLabel, conductorName, startedAt, liveToken, direction, status }) {
  const time = new Date(startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: config.timezone });
  if (status && status !== 'active') {
    return `🚏 ${routeCode} ${directionLabel} trip has ended. Thank you for riding!`;
  }
  return (
    `🚌 ${routeCode} (${routeName}) is now LIVE - ${directionLabel}\n` +
    `Started ${time} by ${conductorName}\n\n` +
    `📍 Track the bus live: ${liveMapUrl(liveToken, direction)}`
  );
}
