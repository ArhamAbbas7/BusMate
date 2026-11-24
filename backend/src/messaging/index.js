// Channel router (Risk 9: WhatsApp policy change -> swap channels here).
//  console  - writes to delivery_log as "simulated"; read it in Developer console > Outbox
//  whatsapp - WhatsApp Cloud API (needs WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID)
import { config } from '../config.js';
import { query } from '../db/index.js';
import { isMessageEnabled } from '../lib/messageSwitches.js';

const consoleChannel = {
  name: 'console',
  async send(to, message) {
    if (!process.env.OUTBOX_QUIET) console.log(`\n[outbox] -> ${to} (${message.template})\n${message.text}\n`);
    return { status: 'simulated' };
  },
};

const whatsappChannel = {
  name: 'whatsapp',
  async send(to, message) {
    const { token, phoneNumberId, apiVersion } = config.whatsapp;
    if (!token || !phoneNumberId) throw new Error('WhatsApp is not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)');
    const mode = (process.env.WHATSAPP_SEND_MODE || 'template').toLowerCase();
    const body = { messaging_product: 'whatsapp', to: to.replace(/^\+/, '') };
    if (mode === 'text') {
      // Only allowed inside the 24h customer-service window - handy for testing with your own number.
      body.type = 'text';
      body.text = { body: message.text, preview_url: true };
    } else {
      const components = [{ type: 'body', parameters: message.params.map((t) => ({ type: 'text', text: String(t) })) }];
      if (message.otpCode) {
        // Authentication templates carry the code in a copy-code URL button too
        components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: message.otpCode }] });
      }
      body.type = 'template';
      body.template = { name: message.template, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' }, components };
    }
    const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `WhatsApp API error ${res.status}`);
    return { status: 'sent', providerId: json?.messages?.[0]?.id ?? null };
  },
};

const channels = { console: consoleChannel, whatsapp: whatsappChannel };

export function activeChannel() {
  return channels[config.messagingChannel] || consoleChannel;
}

/**
 * Send a message and record it in delivery_log. Never throws - returns { ok, status, error }.
 */
export async function sendMessage({ to, message, operatorId = null, tripId = null }) {
  const channel = activeChannel();
  let result;
  if (!(await isMessageEnabled(message.switchKey || message.template).catch(() => true))) {
    // Switched off in Developer console -> Paid messages: not sent, not charged, still visible in the Outbox
    result = { status: 'skipped', error: 'Switched off in Paid messages' };
  } else {
    try {
      result = await channel.send(to, message);
    } catch (e) {
      result = { status: 'failed', error: e.message };
      console.error(`[messaging] ${channel.name} failed to ${to}:`, e.message);
    }
  }
  await query(
    `INSERT INTO delivery_log (operator_id, trip_session_id, channel, recipient, template, body, status, provider_id, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [operatorId, tripId, channel.name, to, message.template, message.text, result.status, result.providerId ?? null, result.error ?? null],
  ).catch((e) => console.error('[messaging] could not write delivery_log', e.message));
  return { ok: result.status === 'sent' || result.status === 'simulated', skipped: result.status === 'skipped', ...result };
}
