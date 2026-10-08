/**
 * Node smoke test for cellIsBlueVerified logic (mirrored helpers).
 * Run: node test/test-blue-1.7.5.js
 */
function isNonBlueBadgeColor(cssColor) {
  const m = String(cssColor || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return false;
  const r = +m[1], g = +m[2], b = +m[3];
  if (r > 180 && g > 140 && b < 120) return true;
  if (g > 150 && r < 100 && b < 150) return true;
  if (Math.abs(r - g) < 25 && Math.abs(g - b) < 25 && r >= 100 && r <= 190) return true;
  return false;
}
function isBlueBadgeColor(cssColor) {
  const s = String(cssColor || '').toLowerCase().replace(/\s+/g, '');
  if (s.includes('1d9bf0') || s.includes('rgb(29,155,240)')) return true;
  const m = String(cssColor || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return false;
  const r = +m[1], g = +m[2], b = +m[3];
  return b >= 180 && b > r && g >= 100 && g <= 210;
}

/** Simulate post-path decision for a verified icon */
function decide(pathFills, computedColor, aria = 'Verified account') {
  if (/government|政府|business|企业|组织|organization|gold|金牌/i.test(aria)) return false;
  let sawNonBlue = false, sawBlue = false;
  for (const fill0 of pathFills) {
    const fill = (fill0 || '').toLowerCase();
    if (!fill || fill === 'currentcolor' || fill === 'none') continue;
    if (['e2b719','829aab','c2c2','00ba7c','f4bb','ffd4'].some(x => fill.includes(x))) {
      sawNonBlue = true; break;
    }
    if (fill.includes('1d9bf')) sawBlue = true;
  }
  if (sawNonBlue) return false;
  if (sawBlue) return true;
  if (isNonBlueBadgeColor(computedColor)) return false;
  if (isBlueBadgeColor(computedColor)) return true;
  return true; // currentColor / unknown → blue V
}

const cases = [
  ['currentColor blue', ['currentColor'], 'rgb(29, 155, 240)', true],
  ['explicit blue fill', ['#1D9BF0'], 'rgb(0,0,0)', true],
  ['currentColor no computed → still blue', ['currentColor'], '', true],
  ['gold fill', ['#e2b719'], 'rgb(226,183,25)', false],
  ['gold computed', ['currentColor'], 'rgb(226, 183, 25)', false],
  ['gray computed', ['currentColor'], 'rgb(130, 154, 171)', false],
  ['gov aria', ['currentColor'], 'rgb(29,155,240)', false, 'Government account'],
  ['empty paths + blue color', [], 'rgb(29, 155, 240)', true],
];

let fail = 0;
for (const [name, fills, color, expect, aria] of cases) {
  const got = decide(fills, color, aria);
  const ok = got === expect;
  console.log(`${ok ? 'OK' : 'FAIL'}  ${name}: got=${got} expect=${expect}`);
  if (!ok) fail++;
}
if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('all passed');
