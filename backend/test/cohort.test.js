import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeCohorts, nextSignupWindow, nextInstanceOf, openSignupCohort } from '../src/lib/cohort.js';
import { normalizePhone } from '../src/lib/phone.js';
import { addDays, daysBetween } from '../src/lib/time.js';

test('cohort A runs 1st to last day of month, B runs 15th to 14th', () => {
  const a = activeCohorts('2026-02-20');
  assert.deepEqual([a.A.start_date, a.A.end_date], ['2026-02-01', '2026-02-28']);
  assert.deepEqual([a.B.start_date, a.B.end_date], ['2026-02-15', '2026-03-14']);
  const b = activeCohorts('2026-03-03');
  assert.deepEqual([b.B.start_date, b.B.end_date], ['2026-02-15', '2026-03-14']);
  const leap = activeCohorts('2028-02-10');
  assert.equal(leap.A.end_date, '2028-02-29');
});

test('cohort B crosses the year boundary', () => {
  const c = activeCohorts('2026-12-20');
  assert.deepEqual([c.B.start_date, c.B.end_date], ['2026-12-15', '2027-01-14']);
  const d = activeCohorts('2027-01-10');
  assert.equal(d.B.start_date, '2026-12-15');
});

test('signup windows open only on 1st-5th and 15th-19th', () => {
  assert.equal(openSignupCohort('2026-11-01').code, 'A');
  assert.equal(openSignupCohort('2026-11-05').code, 'A');
  assert.equal(openSignupCohort('2026-11-06'), null);
  assert.equal(openSignupCohort('2026-11-15').code, 'B');
  assert.equal(openSignupCohort('2026-11-19').code, 'B');
  assert.equal(openSignupCohort('2026-11-22'), null);
});

test('forced window signs up into the most recently started cohort', () => {
  const f = openSignupCohort('2026-11-22', undefined, true);
  assert.equal(f.code, 'B');
  assert.equal(f.forced, true);
  assert.equal(openSignupCohort('2026-11-10', undefined, true).code, 'A');
});

test('next window and next instance', () => {
  assert.equal(nextSignupWindow('2026-11-22').signup_start, '2026-12-01');
  assert.equal(nextSignupWindow('2026-11-07').signup_start, '2026-11-15');
  assert.equal(nextSignupWindow('2026-12-25').signup_start, '2027-01-01');
  assert.equal(nextInstanceOf({ code: 'B', start_date: '2026-12-15' }).start_date, '2027-01-15');
});

test('date helpers', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-11-23', '2026-11-30'), 7);
});

test('phone normalisation', () => {
  assert.equal(normalizePhone('0300 1234567'), '+923001234567');
  assert.equal(normalizePhone('3001234567'), '+923001234567');
  assert.equal(normalizePhone('923001234567'), '+923001234567');
  assert.equal(normalizePhone('+92-300-1234567'), '+923001234567');
  assert.equal(normalizePhone('0092 300 1234567'), '+923001234567');
  assert.equal(normalizePhone('abc'), null);
  assert.equal(normalizePhone('123'), null);
});
