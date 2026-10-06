// node test/test-sync.js — 验证温和间隔、Mentions 覆盖、离开通知页立即中止
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const posted = []; const calls = [];
global.location = { origin: 'https://x.com', pathname: '/notifications' };
global.document = { cookie: 'ct0=abc', querySelector: () => ({ getAttribute: () => '/blacksoil' }) };
global.window = global;
let n = 0;
window.fetch = async (url) => {
  calls.push({ url: String(url), at: Date.now() });
  n += 1;
  return { ok: true, status: 200, json: async () => ({ data: { viewer_v2: { user_results: { result: { notification_timeline: { timeline: { instructions: [{ entries: [
    { entryId: 'notification-' + n, content: { itemContent: { __typename: 'TimelineTweet', tweet_results: { result: { __typename: 'Tweet', rest_id: String(5000 + n), core: { user_results: { result: { core: { screen_name: 'u' + n } } } }, legacy: { in_reply_to_status_id_str: '1', in_reply_to_screen_name: 'blacksoil', conversation_id_str: '1' } } } } } },
    { entryId: 'cursor-bottom-' + n, content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'C' + n } }
  ] }] } } } } } } }) };
};
window.XMLHttpRequest = function () {}; window.XMLHttpRequest.prototype = { open() {}, send() {}, setRequestHeader() {} };
window.postMessage = (m) => posted.push(m);
window.addEventListener = () => {};
eval(fs.readFileSync(path.join(__dirname, '..', 'inject.js'), 'utf8'));
(async () => {
  // 页面自己的请求：让 hook 抄到 auth + queryId
  await window.fetch('https://x.com/i/api/graphql/QID/NotificationsTimeline?variables=' + encodeURIComponent(JSON.stringify({ timeline_type: 'All', count: 20 })) + '&features=%7B%7D', { headers: { authorization: 'Bearer X', 'x-csrf-token': 'abc' } });
  calls.length = 0;
  const t0 = Date.now();
  window.__xOnewayIxDebug.runAutoSync({ force: true });
  setTimeout(() => { location.pathname = '/home'; }, 9000); // 9 秒后离开通知页
  await new Promise((r) => setTimeout(r, 12000));
  const gaps = calls.slice(1).map((c, i) => c.at - calls[i].at);
  console.log('requests:', calls.length, 'gaps(ms):', gaps);
  for (const g of gaps) assert(g >= 2450 && g <= 4300, 'gap out of range ' + g);
  assert(calls.length >= 2 && calls.length <= 4, 'unexpected count');
  assert(calls.every((c) => /count%22%3A20/.test(c.url)));
  const sync = posted.filter((m) => m.__tag === 'x-oneway-ix/sync').map((m) => m.kind + (m.detail ? ':' + m.detail : ''));
  console.log(sync.join('\n'));
  assert(sync.some((s) => s.includes('中止')));
  const replies = posted.filter((m) => m.__tag === 'x-oneway-ix/v1' && m.action === 'reply').length;
  assert.strictEqual(replies, calls.length);
  // 立即再点：3 分钟内拒绝
  location.pathname = '/notifications'; posted.length = 0;
  await window.__xOnewayIxDebug.runAutoSync({ force: true });
  console.log(posted.filter((m) => m.__tag === 'x-oneway-ix/sync').map((m) => m.detail).join('\n'));
  // 自动同步 30 分钟冷却
  posted.length = 0;
  await window.__xOnewayIxDebug.runAutoSync({ force: false, lastSyncAt: Date.now() - 10 * 60000 });
  console.log(posted.filter((m) => m.__tag === 'x-oneway-ix/sync').map((m) => m.detail).join('\n'));
  // Mentions 覆盖：检查 plan
  const src = fs.readFileSync(path.join(__dirname, '..', 'inject.js'), 'utf8');
  assert(/\['All', ALL_PAGE_SHARE\], \['Mentions', MAX_PAGES\]/.test(src));
  console.log('SYNC PASS in', Date.now() - t0, 'ms');
  process.exit(0);
})();
