// End-to-end API test of the SRS acceptance flow, on an in-memory database.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory://';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'evbus-test-'));
process.env.MESSAGING_CHANNEL = 'console';
process.env.EXPOSE_DEV_OTP = 'true';
process.env.OUTBOX_QUIET = 'true';

const { initDb, closeDb, one, query } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { seed, DEMO_ACCOUNTS } = await import('../src/db/seed.js');
const { createApp } = await import('../src/app.js');
const { autoCloseStaleTrips } = await import('../src/services/trips.js');
const { authenticator } = await import('otplib');

let server;
let base;

before(async () => {
  await initDb();
  await migrate();
  const log = console.log;
  console.log = () => {};
  await seed();
  console.log = log;
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server?.close();
  await closeDb();
});

async function api(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + url, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const login = async (email, password) => (await api('POST', '/auth/login', { body: { email, password } })).data.token;
const groups = (tag) =>
  ['A', 'B'].flatMap((cohort) =>
    ['towards', 'backward'].map((direction) => ({ cohort, direction, wa_group_id: `${tag}-${cohort}-${direction}@g.us`, invite_link: `https://chat.whatsapp.com/${tag}${cohort}${direction}` })),
  );

test('full platform flow', async (t) => {
  const dev = await login(DEMO_ACCOUNTS.developer.email, DEMO_ACCOUNTS.developer.password);
  const admin = await login(DEMO_ACCOUNTS.admin.email, DEMO_ACCOUNTS.admin.password);
  const admin2 = await login(DEMO_ACCOUNTS.admin2.email, DEMO_ACCOUNTS.admin2.password);
  assert.ok(dev && admin && admin2, 'all demo logins work');

  const routes = (await api('GET', '/admin/routes', { token: admin })).data.routes;
  const ev1 = routes.find((r) => r.code === 'EV1');
  const ev3 = routes.find((r) => r.code === 'EV3');

  await t.test('wrong password is rejected', async () => {
    assert.equal((await api('POST', '/auth/login', { body: { email: DEMO_ACCOUNTS.admin.email, password: 'nope' } })).status, 401);
  });

  await t.test('tenant isolation (acceptance 16)', async () => {
    const r2 = (await api('GET', '/admin/routes', { token: admin2 })).data.routes;
    assert.deepEqual(r2.map((r) => r.code), ['UT1']);
    assert.equal((await api('GET', `/admin/routes/${ev1.id}`, { token: admin2 })).status, 404);
    assert.equal((await api('GET', '/dev/operators', { token: admin })).status, 403);
    const subs2 = (await api('GET', '/admin/subscriptions?status=all', { token: admin2 })).data;
    assert.ok(subs2.every((s) => s.route_code === 'UT1'));
  });

  await t.test('route needs exactly 4 groups (SR-05) and package limits apply (SR-07, acceptance 15)', async () => {
    const bad = await api('POST', '/admin/routes', { token: admin, body: { code: 'EVX', name: 'Bad route', groups: groups('X').slice(0, 3) } });
    assert.equal(bad.status, 400);
    assert.equal((await api('POST', '/admin/routes', { token: admin, body: { code: 'EV4', name: 'Route four', groups: groups('EV4') } })).status, 201);
    assert.equal((await api('POST', '/admin/routes', { token: admin, body: { code: 'EV5', name: 'Route five', groups: groups('EV5') } })).status, 201);
    const blocked = await api('POST', '/admin/routes', { token: admin, body: { code: 'EV6', name: 'Route six', groups: groups('EV6') } });
    assert.equal(blocked.status, 403, 'basic package stops at 5 routes');
    const op1 = (await api('GET', '/dev/operators', { token: dev })).data.operators.find((o) => o.slug === 'ev-services');
    const up = await api('POST', `/dev/operators/${op1.id}/package`, { token: dev, body: { package: 'premium' } });
    assert.equal(up.data.features.features.max_routes, 20);
    assert.equal((await api('POST', '/admin/routes', { token: admin, body: { code: 'EV6', name: 'Route six', groups: groups('EV6') } })).status, 201);
    // Override wins over package; revoke restores it
    const ov = await api('POST', `/dev/operators/${op1.id}/overrides`, { token: dev, body: { feature_key: 'eta_prediction', value: false, reason: 'test' } });
    assert.equal(ov.status, 201);
    assert.equal((await api('GET', '/admin/features', { token: admin })).data.features.eta_prediction, false);
    await api('DELETE', `/dev/overrides/${ov.data.id}`, { token: dev });
    assert.equal((await api('GET', '/admin/features', { token: admin })).data.features.eta_prediction, true);
  });

  let imran;
  let bilal;
  let tripId;
  await t.test('conductor OTP login (acceptance 3)', async () => {
    const req1 = await api('POST', '/auth/conductor/request-otp', { body: { phone: '0300 1234567' } });
    assert.equal(req1.status, 200);
    assert.match(req1.data.devCode, /^\d{6}$/);
    assert.equal((await api('POST', '/auth/conductor/verify-otp', { body: { phone: '03001234567', code: '000000' === req1.data.devCode ? '111111' : '000000' } })).status, 401);
    imran = (await api('POST', '/auth/conductor/verify-otp', { body: { phone: '03001234567', code: req1.data.devCode } })).data.token;
    assert.ok(imran);
    const req2 = await api('POST', '/auth/conductor/request-otp', { body: { phone: '03007654321' } });
    bilal = (await api('POST', '/auth/conductor/verify-otp', { body: { phone: '03007654321', code: req2.data.devCode } })).data.token;
    const claims = JSON.parse(Buffer.from(imran.split('.')[1], 'base64url').toString());
    assert.equal(claims.exp, undefined, 'conductors stay signed in by default (no expiry)');
    assert.equal((await api('POST', '/auth/conductor/request-otp', { body: { phone: '03009999999' } })).status, 404);
  });

  await t.test('trip rules SR-01/02/04 and GPS pings (acceptance 4, 5, 10, 11)', async () => {
    const me = (await api('GET', '/conductor/me', { token: imran })).data;
    assert.deepEqual(me.routes.map((r) => r.code), ['EV1', 'EV2']);
    assert.equal((await api('POST', '/conductor/trips', { token: imran, body: { routeId: ev3.id, direction: 'towards' } })).status, 403);
    const start = await api('POST', '/conductor/trips', { token: imran, body: { routeId: ev1.id, direction: 'towards' } });
    assert.equal(start.status, 201);
    tripId = start.data.trip.id;
    assert.match(start.data.message.text, /LIVE/);
    assert.equal(start.data.message.groups.length, 2, 'message goes to cohort A and B groups for this direction');
    assert.equal((await api('POST', '/conductor/trips', { token: imran, body: { routeId: ev1.id, direction: 'backward' } })).status, 409, 'one trip per conductor');

    const live0 = await api('GET', `/public/live/${ev1.live_token}?dir=towards`);
    assert.equal(live0.data.active, false, 'no position until first ping');
    const [lat, lng] = ev1.path[0];
    const now = Date.now();
    const pings = [0, 1, 2].map((i) => ({ lat: lat + i * 0.001, lng: lng + i * 0.001, accuracy: 10, recordedAt: new Date(now - (2 - i) * 30000).toISOString() }));
    const p = await api('POST', `/conductor/trips/${tripId}/pings`, { token: imran, body: { pings } });
    assert.equal(p.data.accepted, 3);
    const live = await api('GET', `/public/live/${ev1.live_token}?dir=towards`);
    assert.equal(live.data.active, true);
    assert.equal(live.data.bus.lat, lat + 0.002);
    const other = await api('GET', `/public/live/${ev1.live_token}?dir=backward`);
    assert.equal(other.data.active, false, 'FR-P-10 no active service in the other direction');
    assert.equal(other.data.otherDirectionLive, true);

    const admLive = (await api('GET', '/admin/trips/live', { token: admin })).data;
    assert.ok(admLive.some((x) => x.id === tripId));
    const stop = await api('POST', `/conductor/trips/${tripId}/stop`, { token: imran });
    assert.equal(stop.data.trip.status, 'completed');
    assert.equal(stop.data.pingCount, 3);
    assert.ok(stop.data.distanceKm > 0);
    const hist = (await api('GET', '/admin/trips', { token: admin })).data.trips;
    assert.ok(hist.some((x) => x.id === tripId), 'acceptance 12: admin sees trip in history');
    assert.equal((await api('GET', `/admin/trips/${tripId}`, { token: admin2 })).status, 404);
  });

  await t.test('auto-close after 10 min without pings (SR-03)', async () => {
    const ev2 = routes.find((r) => r.code === 'EV2');
    const s = await api('POST', '/conductor/trips', { token: bilal, body: { routeId: ev2.id, direction: 'towards' } });
    assert.equal(s.status, 201);
    await query(`UPDATE trip_sessions SET started_at = now() - interval '20 minutes' WHERE id = $1`, [s.data.trip.id]);
    const r = await autoCloseStaleTrips();
    assert.equal(r.closed, 1);
    assert.equal((await one(`SELECT status FROM trip_sessions WHERE id = $1`, [s.data.trip.id])).status, 'auto_closed');
  });

  let subId;
  await t.test('signup window, waitlist, payment proof, confirm + auto-invite (acceptance 6-8, 17)', async () => {
    await api('PUT', '/dev/config/force_signup_window', { token: dev, body: { value: false } });
    const info = (await api('GET', '/public/operators/ev-services')).data;
    if (!info.window.open) {
      const fd = new FormData();
      Object.entries({ routeId: ev1.id, name: 'Test Rider', phone: '03331112222', paymentMethod: 'jazzcash', paymentRef: 'TX12345' }).forEach(([k, v]) => fd.append(k, v));
      const closed = await api('POST', '/public/operators/ev-services/signup', { form: fd });
      assert.equal(closed.status, 409);
      assert.equal(closed.data.windowClosed, true);
      const wl = await api('POST', '/public/operators/ev-services/waitlist', { body: { routeId: ev1.id, name: 'Test Rider', phone: '03331112222' } });
      assert.equal(wl.status, 201);
    }
    await api('PUT', '/dev/config/force_signup_window', { token: dev, body: { value: true } });
    const fd = new FormData();
    Object.entries({ routeId: ev1.id, name: 'Test Rider', phone: '03331112222', paymentMethod: 'jazzcash', paymentRef: 'TX12345' }).forEach(([k, v]) => fd.append(k, v));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    fd.append('proof', new Blob([png], { type: 'image/png' }), 'receipt.png');
    const signup = await api('POST', '/public/operators/ev-services/signup', { form: fd });
    assert.equal(signup.status, 201, JSON.stringify(signup.data));
    subId = signup.data.id;
    const wlAfter = await one(`SELECT status FROM signup_waitlist WHERE phone = '+923331112222' ORDER BY created_at DESC LIMIT 1`);
    if (wlAfter) assert.equal(wlAfter.status, 'converted');

    const pending = (await api('GET', '/admin/payments?status=pending', { token: admin })).data;
    const mine = pending.find((x) => x.id === subId);
    assert.ok(mine?.has_proof);
    const proof = await fetch(`${base}/admin/payments/${subId}/proof`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.equal(proof.status, 200);
    assert.equal((await api('POST', `/admin/payments/${subId}/confirm`, { token: admin2 })).status, 404, 'other operator cannot confirm');
    const conf = await api('POST', `/admin/payments/${subId}/confirm`, { token: admin });
    assert.equal(conf.data.subscription.status, 'active');
    assert.equal(conf.data.invite.status, 'simulated');
    const inv = await one(`SELECT body FROM delivery_log WHERE recipient = '+923331112222' AND template = 'subscription_invite'`);
    assert.match(inv.body, /chat\.whatsapp\.com/);
    assert.match(inv.body, /live\/\?t=/);
    const status = (await api('GET', `/public/subscriptions/${subId}`)).data;
    assert.equal(status.status, 'active');
    assert.equal((await api('POST', `/admin/payments/${subId}/confirm`, { token: admin })).status, 409);
    const received = await one(`SELECT status FROM delivery_log WHERE recipient = '+923331112222' AND template = 'signup_received'`);
    assert.equal(received.status, 'skipped', 'signup-received message is off by default');
  });

  await t.test('paid message switches', async () => {
    const d = (await api('GET', '/dev/messages', { token: dev })).data;
    const state = Object.fromEntries(d.types.map((x) => [x.key, x.on]));
    assert.equal(state.signup_received, false);
    assert.equal(state.renewal_reminder_7, false);
    assert.equal(state.renewal_reminder_3, true);
    assert.equal(d.conductorStaySignedIn, true);
    assert.equal((await api('GET', '/dev/messages', { token: admin })).status, 403, 'admins cannot change platform switches');
    assert.equal((await api('PUT', '/dev/messages', { token: dev, body: { switches: { nope: true } } })).status, 400);

    // Invite off: confirm still works, nothing is sent, invite_sent_at stays empty
    assert.equal((await api('PUT', '/dev/messages', { token: dev, body: { switches: { subscription_invite: false } } })).status, 200);
    const fd = new FormData();
    Object.entries({ routeId: ev1.id, name: 'Quiet Rider', phone: '03334445555', paymentMethod: 'easypaisa', paymentRef: 'EP998877' }).forEach(([k, v]) => fd.append(k, v));
    const signup = await api('POST', '/public/operators/ev-services/signup', { form: fd });
    assert.equal(signup.status, 201, JSON.stringify(signup.data));
    const conf = (await api('POST', `/admin/payments/${signup.data.id}/confirm`, { token: admin })).data;
    assert.equal(conf.invite.skipped, true);
    assert.equal(conf.invite.ok, false);
    assert.equal((await one(`SELECT invite_sent_at FROM subscriptions WHERE id = $1`, [signup.data.id])).invite_sent_at, null);

    // Presets
    await api('PUT', '/dev/messages', { token: dev, body: { preset: 'essential_only' } });
    const ess = (await api('GET', '/dev/messages', { token: dev })).data.types;
    assert.deepEqual(ess.filter((x) => x.on).map((x) => x.key).sort(), ['conductor_login_code', 'subscription_invite']);
    await api('PUT', '/dev/messages', { token: dev, body: { preset: 'recommended' } });
    assert.equal((await api('GET', '/dev/messages', { token: dev })).data.types.find((x) => x.key === 'subscription_invite').on, true);

    // Short conductor sessions when "stay signed in" is off
    await api('PUT', '/dev/messages', { token: dev, body: { conductorStaySignedIn: false } });
    await query(`DELETE FROM otp_codes WHERE phone = '+923001234567'`); // skip the 30 s resend cooldown
    const code = (await api('POST', '/auth/conductor/request-otp', { body: { phone: '03001234567' } })).data.devCode;
    const tok = (await api('POST', '/auth/conductor/verify-otp', { body: { phone: '03001234567', code } })).data.token;
    const claims = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());
    assert.equal(claims.exp - claims.iat, 7 * 86400);
    await api('PUT', '/dev/messages', { token: dev, body: { conductorStaySignedIn: true } });
  });

  await t.test('reject payment', async () => {
    const pending = (await api('GET', '/admin/payments?status=pending', { token: admin })).data;
    const r = await api('POST', `/admin/payments/${pending[0].id}/reject`, { token: admin, body: { reason: 'Transaction ID not found' } });
    assert.equal(r.data.status, 'rejected');
  });

  await t.test('switch cohort, manual add/remove (FR-A-20/23/24)', async () => {
    const before = (await api('GET', `/public/subscriptions/${subId}`)).data.cohort;
    const sw = await api('POST', `/admin/subscriptions/${subId}/switch-cohort`, { token: admin });
    assert.equal(sw.status, 200);
    assert.notEqual(sw.data.subscription.cohort_code, before);
    const add = await api('POST', '/admin/subscriptions', { token: admin, body: { routeId: ev3.id, name: 'Walk In', phone: '03440000000', cohort: 'A', paymentMethod: 'cash' } });
    assert.equal(add.status, 201);
    const rm = await api('DELETE', `/admin/subscriptions/${add.data.subscription.id}`, { token: admin });
    assert.equal(rm.data.removed, true);
  });

  await t.test('cycle switch expires ended subscriptions (acceptance 13, 14)', async () => {
    const prev = (await api('GET', '/admin/cycle-switch', { token: admin })).data;
    assert.ok(prev.due.some((d) => d.subscriber_name === 'Kamran Yousaf'));
    const run = await api('POST', '/admin/cycle-switch/run', { token: admin });
    assert.ok(run.data.expired >= 1);
    const expired = (await api('GET', '/admin/subscriptions?status=expired', { token: admin })).data;
    assert.ok(expired.some((s) => s.subscriber_name === 'Kamran Yousaf'));
    const ids = (await api('GET', '/admin/cycle-switch', { token: admin })).data.pendingRemovalIds;
    assert.ok(ids.length >= 1);
    assert.ok((await api('POST', '/admin/cycle-switch/mark-removed', { token: admin, body: { ids } })).data.updated >= 1);
  });

  await t.test('developer: suspend, impersonate, audit, health, outbox', async () => {
    const ops = (await api('GET', '/dev/operators', { token: dev })).data.operators;
    const op2 = ops.find((o) => o.slug === 'urban-transit');
    await api('POST', `/dev/operators/${op2.id}/status`, { token: dev, body: { status: 'suspended' } });
    assert.equal((await api('GET', '/admin/dashboard', { token: admin2 })).status, 403);
    assert.equal((await api('GET', '/public/operators/urban-transit')).status, 404);
    await api('POST', `/dev/operators/${op2.id}/status`, { token: dev, body: { status: 'active' } });
    assert.equal((await api('GET', '/admin/dashboard', { token: admin2 })).status, 200);

    const imp = await api('POST', `/dev/operators/${op2.id}/impersonate`, { token: dev });
    const dash = await api('GET', '/admin/dashboard', { token: imp.data.token });
    assert.equal(dash.data.operator.slug, 'urban-transit');
    const audit = (await api('GET', '/dev/audit?q=impersonate', { token: dev })).data;
    assert.ok(audit.total >= 1);
    assert.equal((await api('GET', '/dev/health', { token: dev })).data.status, 'ok');
    assert.ok((await api('GET', '/dev/outbox', { token: dev })).data.rows.length > 0);
    assert.equal((await api('GET', '/dev/costs', { token: dev })).status, 200);
  });

  await t.test('developer 2FA (FR-D-01)', async () => {
    const setup = (await api('POST', '/dev/2fa/setup', { token: dev })).data;
    assert.match(setup.qr, /^data:image\/png/);
    assert.equal((await api('POST', '/dev/2fa/enable', { token: dev, body: { code: authenticator.generate(setup.secret) } })).status, 200);
    const step1 = (await api('POST', '/auth/login', { body: DEMO_ACCOUNTS.developer })).data;
    assert.equal(step1.requires2fa, true);
    assert.equal(step1.token, undefined);
    const step2 = await api('POST', '/auth/login/2fa', { body: { challenge: step1.challenge, code: authenticator.generate(setup.secret) } });
    assert.ok(step2.data.token);
  });
});
