/* ============================================================
   rng.js — أرقام عشوائية ثابتة البذرة
   ------------------------------------------------------------
   نفس البذرة = نفس البيانات حرفاً بحرف، على أي جهاز. فالاختبار
   الذي فشل اليوم يُعاد غداً على نفس البيانات بالضبط.
   (mulberry32: سريع وجيد التوزيع، وأكثر من كافٍ لبيانات تجربة)
   ============================================================ */
'use strict';

function rng(seed) {
  let a = (seed >>> 0) || 1;
  function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const r = {
    next,
    /* عدد صحيح بين a وb شاملاً */
    int(lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
    chance(p) { return next() < p; },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
    /* [[قيمة, وزن], ...] */
    weighted(pairs) {
      let total = 0;
      for (const [, w] of pairs) total += w;
      let x = next() * total;
      for (const [v, w] of pairs) { x -= w; if (x < 0) return v; }
      return pairs[pairs.length - 1][0];
    },
    /* توزيع بذيل طويل: أغلب القيم قرب lo وقليل منها كبير */
    skewed(lo, hi, power) {
      return lo + Math.floor(Math.pow(next(), power || 2) * (hi - lo + 1));
    },
    /* عدد مرات حدوث بمتوسط mean (بواسون — لعدد الفواتير في اليوم) */
    poisson(mean) {
      if (mean > 50) return Math.max(0, Math.round(mean + Math.sqrt(mean) * gauss()));
      const L = Math.exp(-mean);
      let k = 0, p = 1;
      do { k++; p *= next(); } while (p > L);
      return k - 1;
    },
    /* مولّد فرعي مستقل: تغيير جزء من البيانات لا يغيّر الباقي */
    fork(salt) { return rng(Math.floor(next() * 4294967296) ^ hash(String(salt))); }
  };
  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  return r;
}

/* بصمة نصية بسيطة (FNV-1a) — لاشتقاق البذور */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

module.exports = { rng, hash };
