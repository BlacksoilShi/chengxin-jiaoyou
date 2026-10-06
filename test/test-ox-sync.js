// node test/test-ox-sync.js — 手动「同步我的互动」：仅自己的 /likes，抄模板，温和翻页，10 分钟间隔
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const posted = []; const me = 'blacksoil'; const calls = [];
global.location = { origin: 'https://x.com', pathname: '/someone/likes' };
global.document = { cookie: 'ct0=abc', querySelector: (s) => s.includes('AppTabBar') ? { getAttribute: () => '/' + me } : null, querySelectorAll: () => [] };
global.window = global;
const tw = (id, sn) => ({ __typename: 'Tweet', rest_id: id, core: { user_results: { result: { core: { screen_name: sn } } } }, legacy: { id_str: id, favorited: true } });
const page = (ids, cursor) => ({ data: { user: { result: { timeline: { timeline: { instructions: [{ entries: [
  ...ids.map(([id, sn]) => ({ entryId: 'tweet-' + id, content: { itemContent: { tweet_results: { result: tw(id, sn) } } } })),
  ...(cursor ? [{ entryId: 'cursor-bottom-1', content: { cursorType: 'Bottom', value: cursor } }] : [])
] }] } } } } } });
window.fetch = async (url) => { calls.push(String(url)); const c = /cursor%22%3A%22c1/.test(url); return { ok: true, status: 200, json: async () => c ? page([['3', 'carol']], null) : page([['1', 'alice'], ['2', 'bob']], 'c1') }; };
window.XMLHttpRequest = function () {}; window.XMLHttpRequest.prototype = { open() {}, send() {}, setRequestHeader() {} };
window.postMessage = (m) => posted.push(m);
window.addEventListener = () => {};
eval(fs.readFileSync(path.join(__dirname, '..', 'inject.js'), 'utf8'));
const D = window.__xOnewayIxDebug;
const sync = () => posted.filter((m) => m.__tag === 'x-oneway-ix/sync' && m.scope === 'outbound');
(async () => {
  await D.runOutboundSync();
  assert(/自己的「喜欢」/.test(sync().pop().detail), 'refuse on others likes page');
  location.pathname = '/blacksoil/likes';
  // 页面自己的 Likes 请求（带 auth 头）→ 抄模板
  await window.fetch('https://x.com/i/api/graphql/QID/Likes?variables=' + encodeURIComponent(JSON.stringify({ userId: 'u1', count: 20 })) + '&features=%7B%7D',
    { headers: { authorization: 'Bearer x', 'x-csrf-token': 'abc' } });
  await new Promise((r) => setTimeout(r, 50));
  posted.length = 0; calls.length = 0;
  const t0 = Date.now();
  await D.runOutboundSync();
  const dt = Date.now() - t0;
  const ox = posted.filter((m) => m.__tag === 'x-oneway-ox/v1').map((m) => m.key);
  console.log(calls.length, 'requests', dt, 'ms', ox, sync().map((s) => s.kind));
  assert.strictEqual(calls.length, 2);
  assert(dt >= 2400, 'jitter between pages');
  assert.deepStrictEqual(ox.sort(), ['like:1', 'like:2', 'like:3']);
  assert.strictEqual(sync().pop().kind, 'done');
  posted.length = 0;
  await D.runOutboundSync();
  assert(/分钟后再试/.test(sync().pop().detail), '10 min gap');
  console.log('OX SYNC PASS');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
