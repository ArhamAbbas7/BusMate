// On/off switches for every paid WhatsApp message (Developer console -> Paid messages).
// Meta charges per template message, so each switch is a direct saving.
import { getConfig, setConfig } from './platform.js';

/**
 * key:       the switch id (usually the template name; renewal reminders are split by T-7 / T-3)
 * essential: switching it off breaks a core flow, so the UI asks for confirmation
 */
export const MESSAGE_TYPES = [
  { key: 'subscription_invite', audience: 'passenger', label: 'Welcome + group links', when: 'An admin confirms a payment, adds a subscriber or resends the invite.', essential: true, on: true,
    offNote: 'Passengers will not get their WhatsApp group links. Admins must share them by hand.' },
  { key: 'signup_received', audience: 'passenger', label: 'Signup received', when: 'A passenger submits the signup form. The status page already shows the same thing.', on: false },
  { key: 'payment_rejected', audience: 'passenger', label: 'Payment rejected', when: 'An admin rejects a payment proof.', on: true },
  { key: 'renewal_reminder_7', audience: 'passenger', label: 'Renewal reminder, 7 days before', when: 'A subscription ends in 4 to 7 days and has not been renewed.', on: false },
  { key: 'renewal_reminder_3', audience: 'passenger', label: 'Renewal reminder, 3 days before', when: 'A subscription ends in 3 days or less and has not been renewed.', on: true },
  { key: 'subscription_expired', audience: 'passenger', label: 'Subscription ended', when: 'The cycle switch expires someone who did not renew.', on: true },
  { key: 'cohort_switched', audience: 'passenger', label: 'Moved to the other cohort', when: 'An admin moves a subscriber to the other cohort. The new invite is a separate message.', on: true },
  { key: 'waitlist_joined', audience: 'passenger', label: 'Joined the waitlist', when: 'Someone joins the waitlist outside a signup window.', on: true },
  { key: 'signup_window_open', audience: 'passenger', label: 'Signups are open', when: 'A signup window opens and people are on the waitlist.', on: true },
  { key: 'conductor_login_code', audience: 'conductor', label: 'Conductor login code', when: 'A conductor signs in on a new phone.', essential: true, on: true,
    offNote: 'Conductors will not receive login codes, so new sign-ins only work while codes are shown on screen (EXPOSE_DEV_OTP=true).' },
];

const BY_KEY = Object.fromEntries(MESSAGE_TYPES.map((t) => [t.key, t]));
export const isMessageKey = (k) => Object.hasOwn(BY_KEY, k);

/** Current on/off state for every message type: defaults merged with saved overrides. */
export async function getMessageSwitches() {
  const saved = (await getConfig('message_switches', {})) || {};
  return Object.fromEntries(MESSAGE_TYPES.map((t) => [t.key, typeof saved[t.key] === 'boolean' ? saved[t.key] : t.on]));
}

export async function isMessageEnabled(key) {
  if (!isMessageKey(key)) return true; // unknown types are never silently dropped
  return (await getMessageSwitches())[key];
}

/** Merge a partial { key: boolean } update and store it. */
export async function updateMessageSwitches(patch) {
  const next = { ...(await getMessageSwitches()), ...patch };
  await setConfig('message_switches', next);
  return next;
}

export const recommendedSwitches = () => Object.fromEntries(MESSAGE_TYPES.map((t) => [t.key, t.on]));

/** Conductors stay signed in until they sign out themselves (or an admin deactivates them). */
export async function conductorStaysSignedIn() {
  return (await getConfig('conductor_stay_signed_in', true)) !== false;
}
export const CONDUCTOR_SHORT_SESSION_DAYS = 7;
