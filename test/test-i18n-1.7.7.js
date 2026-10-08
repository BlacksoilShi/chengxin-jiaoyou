/**
 * Node smoke: pill t() must keep counts (1.7.7).
 * Simulates Edge/Chrome quirks that caused 「被」「我」 without digits.
 * Run: node test/test-i18n-1.7.7.js
 */

function applySubs(template, substitutions) {
  if (!template) return '';
  if (substitutions == null) return template;
  const arr = Array.isArray(substitutions) ? substitutions : [substitutions];
  let msg = String(template);
  for (let i = 0; i < arr.length; i++) {
    const n = String(i + 1);
    const val = String(arr[i] ?? '');
    msg = msg.replace(new RegExp('\\$' + n + '\\$', 'g'), val);
    msg = msg.replace(new RegExp('\\$' + n + '(?!\\d)', 'g'), val);
  }
  return msg;
}

function subsLanded(text, substitutions) {
  if (substitutions == null) return true;
  const arr = Array.isArray(substitutions) ? substitutions : [substitutions];
  return arr.every((s) => {
    if (s == null || String(s) === '') return true;
    return String(text).includes(String(s));
  });
}

const T_FALLBACKS = {
  pill_in_short: '被 $1',
  pill_out_short: '我 $1',
  pill_in: '被互动 $1',
  pill_out: '我互动 $1'
};

const MSGS = {
  pill_in_short: '被 $1',
  pill_out_short: '我 $1',
  pill_in: '被互动 $1',
  pill_out: '我互动 $1'
};

/** 1.7.7 t() with injectable getMessage */
function makeT(getMessage) {
  return function t(key, substitutions) {
    try {
      if (substitutions != null) {
        const withSub = getMessage(key, substitutions);
        if (withSub && subsLanded(withSub, substitutions)) return withSub;
        const fb = T_FALLBACKS[key];
        if (fb) return applySubs(fb, substitutions);
        const bare = getMessage(key);
        if (bare && /\$[1-9]\$?/.test(bare)) return applySubs(bare, substitutions);
        if (withSub) return withSub;
      } else {
        const bare = getMessage(key);
        if (bare) return bare;
      }
    } catch (_) {}
    const fb = T_FALLBACKS[key];
    if (fb) return applySubs(fb, substitutions);
    return key;
  };
}

/** 1.7.6 broken: bare-first (Chromium strips $1 when no subs) */
function t176(key, substitutions) {
  const bare = getMessageStrip(key); // no subs → strips
  if (bare) return applySubs(bare, substitutions);
  return key;
}

function getMessageStrip(key, subs) {
  const tpl = MSGS[key] || '';
  if (arguments.length >= 2 && subs != null) return ''; // Edge empty with-subs
  return tpl.replace(/\$[1-9]/g, ''); // bare strips placeholders
}

function getMessageOk(key, subs) {
  const tpl = MSGS[key] || key;
  if (arguments.length >= 2 && subs != null) return applySubs(tpl, subs);
  return tpl.replace(/\$[1-9]/g, '');
}

const tFixStrip = makeT(getMessageStrip);
const tFixOk = makeT(getMessageOk);

const cases = [
  ['fix+strip pill_in_short 3', () => tFixStrip('pill_in_short', ['3']), '被 3'],
  ['fix+strip pill_out_short 1', () => tFixStrip('pill_out_short', ['1']), '我 1'],
  ['fix+strip zero', () => tFixStrip('pill_in_short', ['0']), '被 0'],
  ['fix+ok pill_in_short', () => tFixOk('pill_in_short', ['3']), '被 3'],
  ['fix+ok long', () => tFixOk('pill_in', ['12']), '被互动 12'],
  ['legacy176 loses digit', () => t176('pill_in_short', ['3']), '被 '],
];

let fail = 0;
for (const [name, fn, expect] of cases) {
  const got = fn();
  const ok = got === expect;
  console.log(`${ok ? 'OK' : 'FAIL'}  ${name}: got=${JSON.stringify(got)} expect=${JSON.stringify(expect)}`);
  if (!ok) fail++;
}

// Product requirement: contains digit
const s = tFixStrip('pill_in_short', ['3']);
if (!String(s).includes('3')) {
  console.log('FAIL  contains 3');
  fail++;
} else {
  console.log('OK  contains 3');
}

if (fail) {
  console.error(fail + ' failed');
  process.exit(1);
}
console.log('all passed');
