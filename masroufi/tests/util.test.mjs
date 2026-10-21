import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../src/js/core/util.js';

const strip = (s) => s.replace(/[⁦⁩]/g, '');

test('toMilli parses Western/Arabic digits, separators and rounding', () => {
  assert.equal(U.toMilli('12.5'), 12500);
  assert.equal(U.toMilli('١٢٫٥'), 12500);
  assert.equal(U.toMilli('1,250.75'), 1250750);
  assert.equal(U.toMilli('0.0005'), 1);
  assert.equal(U.toMilli('0.0004'), 0);
  assert.equal(U.toMilli('-3'), -3000);
  assert.ok(Number.isNaN(U.toMilli('abc')));
  assert.ok(Number.isNaN(U.toMilli('')));
  assert.equal(U.toMilli(2.5), 2500);
});

test('milliToInput / fmtMoney', () => {
  assert.equal(U.milliToInput(12500), '12.5');
  assert.equal(U.milliToInput(2000000), '2000');
  assert.equal(strip(U.fmtMoney(1250500)), '1,250.5 د.ل');
  assert.equal(strip(U.fmtMoney(-12500)), '-12.5 د.ل');
  assert.equal(strip(U.fmtMoney(5000, { sign: 'always' })), '+5 د.ل');
  assert.equal(strip(U.fmtMoney(15000000, { compact: true, currency: false })), '15 ألف');
  U.setFormatPrefs({ digits: 'arab' });
  assert.equal(strip(U.fmtMoney(1250500, { currency: false })), '١٬٢٥٠٫٥');
  U.setFormatPrefs({ digits: 'latin' });
});

test('date helpers', () => {
  assert.equal(U.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(U.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(U.diffDays('2026-10-20', '2026-11-20'), 31);
  assert.equal(U.addMonths('2026-12', 1), '2027-01');
  assert.equal(U.addMonths('2026-01', -1), '2025-12');
  assert.equal(U.addMonths('2026-05', -17), '2024-12');
  assert.equal(U.dayInMonth('2028-02', 31), '2028-02-29');
  assert.equal(U.dayInMonth('2026-02', 31), '2026-02-28');
  assert.equal(U.fmtIn(0), 'اليوم');
  assert.equal(U.fmtIn(1), 'بكرة');
  assert.equal(U.fmtIn(2), 'بعد يومين');
  assert.equal(U.fmtIn(-5), 'قبل 5 أيام');
  assert.equal(U.fmtDays(30), '30 يوم');
});

test('zonedParts in Africa/Tripoli (UTC+2)', () => {
  const p = U.zonedParts(Date.parse('2026-10-20T22:30:00Z'), 'Africa/Tripoli');
  assert.deepEqual(p, { date: '2026-10-21', time: '00:30', minutes: 30 });
});

test('intlPhone normalizes Libyan numbers for WhatsApp', () => {
  assert.equal(U.intlPhone('0912345678'), '218912345678');
  assert.equal(U.intlPhone('091-234 5678'), '218912345678');
  assert.equal(U.intlPhone('+218 91 234 5678'), '218912345678');
  assert.equal(U.intlPhone('00218912345678'), '218912345678');
  assert.equal(U.intlPhone('٠٩١٢٣٤٥٦٧٨'), '218912345678');
  assert.equal(U.intlPhone('912345678'), '218912345678');
  assert.equal(U.intlPhone(''), '');
});

test('fold makes Arabic search forgiving', () => {
  assert.equal(U.fold('أحمد'), U.fold('احمد'));
  assert.equal(U.fold('قهوة'), U.fold('قهوه'));
  assert.ok(U.fold('مُصْرُوف').includes('مصروف'));
});
