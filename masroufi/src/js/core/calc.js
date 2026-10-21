// Exact-enough arithmetic for the assistant's `calculate` tool: + − × ÷,
// parentheses, unary minus, decimals and "15%" (= 0.15). A tiny recursive-descent
// parser — never eval(). Results are rounded to 3 decimals (dirhams).

import { latinDigits } from './util.js';

export function evaluate(expr) {
  const src = latinDigits(String(expr || ''))
    .replace(/[×xX]/g, '*')
    .replace(/[÷:]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/[٫]/g, '.')
    .replace(/[,،٬](?=\d{3}\b)/g, '') // thousands separators
    .replace(/[,،]/g, '.')
    .replace(/\s+/g, '');
  if (!src) throw new Error('empty');
  let i = 0;

  const peek = () => src[i];
  const eat = (c) => (src[i] === c ? (i++, true) : false);

  function number() {
    const m = /^\d+(?:\.\d+)?|^\.\d+/.exec(src.slice(i));
    if (!m) throw new Error(`unexpected "${src[i] || 'end'}"`);
    i += m[0].length;
    let v = Number(m[0]);
    if (eat('%')) v /= 100;
    return v;
  }
  function factor() {
    if (eat('-')) return -factor();
    if (eat('+')) return factor();
    if (eat('(')) {
      const v = sum();
      if (!eat(')')) throw new Error('missing )');
      return eat('%') ? v / 100 : v;
    }
    return number();
  }
  function product() {
    let v = factor();
    for (;;) {
      if (eat('*')) v *= factor();
      else if (eat('/')) {
        const d = factor();
        if (d === 0) throw new Error('division by zero');
        v /= d;
      } else if (peek() === '(') v *= factor(); // 2(3+4)
      else return v;
    }
  }
  function sum() {
    let v = product();
    for (;;) {
      if (eat('+')) v += product();
      else if (eat('-')) v -= product();
      else return v;
    }
  }

  const v = sum();
  if (i < src.length) throw new Error(`unexpected "${src[i]}"`);
  if (!Number.isFinite(v)) throw new Error('not a number');
  return Math.round(v * 1000) / 1000;
}
