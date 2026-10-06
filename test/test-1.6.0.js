// node test/test-1.6.0.js — schema 3→4 迁移 + 出站 hook/被动补记 + 入站/出站隔离
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const ROOT = path.join(__dirname, '..');

// ---------- background ----------
async function bgTests() {
  let store = {
    schemaVersion: 3, activeAccount: 'blacksoil',
    accounts: { blacksoil: { interactions: { maqinuo0605: { replies: 2, likes: 1, total: 3, lastAt: 1 } }, seenNotificationIds: ['tw:1:maqinuo0605'], lastSyncAt: 5, displayName: 'B' } },
    interactions: { maqinuo0605: { replies: 2 } }, seenNotificationIds: ['x']
  };
  let listener;
  global.chrome = {
    runtime: { id: 'ext', onMessage: { addListener: (f) => { listener = f; } } },
    storage: { local: {
      get: async (defs) => { const o = {}; for (const k of Object.keys(defs)) o[k] = k in store ? JSON.parse(JSON.stringify(store[k])) : defs[k]; return o; },
      set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
      remove: async (ks) => { for (const k of ks) delete store[k]; }
    } }
  };
  eval(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'));
  const send = (msg) => new Promise((r) => listener(msg, { id: 'ext', url: 'https://x.com/home' }, r));
  await send({ type: 'X_ONEWAY_ACCOUNT_GET' });
  const acc = store.accounts.blacksoil;
  assert.strictEqual(store.schemaVersion, 4);
  assert.strictEqual(acc.inbound.maqinuo0605.replies, 2, 'interactions → inbound');
  assert.deepStrictEqual(acc.outbound, {}, 'outbound empty');
  assert.deepStrictEqual(acc.seenInboundIds, ['tw:1:maqinuo0605']);
  assert(!('interactions' in acc) && !('interactions' in store), 'legacy keys removed');

  await send({ type: 'X_ONEWAY_OX', action: 'like', username: 'maqinuo0605', key: 'like:100' });
  const dup = await send({ type: 'X_ONEWAY_OX', action: 'like', username: 'maqinuo0605', key: 'like:100' });
  assert(dup.duplicate, 'outbound dedupe');
  await send({ type: 'X_ONEWAY_OX', action: 'reply', username: 'maqinuo0605', key: 'tw:200' });
  await send({ type: 'X_ONEWAY_OX', action: 'quote', username: 'maqinuo0605', key: 'q:200' });
  await send({ type: 'X_ONEWAY_OX', action: 'retweet', username: 'maqinuo0605', key: 'rt:100' });
  // 同 id 入站 tw:200 与出站 tw:200 互不影响
  const inb = await send({ type: 'X_ONEWAY_IX', action: 'reply', username: 'maqinuo0605', notifId: 'tw:200:maqinuo0605' });
  assert(!inb.duplicate);
  // 非法 key 拒绝
  let rejected = listener({ type: 'X_ONEWAY_OX', action: 'like', username: 'x', key: 'bad' }, { id: 'ext', url: 'https://x.com/' }, () => {});
  assert.strictEqual(rejected, false);
  const o = store.accounts.blacksoil.outbound.maqinuo0605;
  console.log('outbound', o, 'inbound', store.accounts.blacksoil.inbound.maqinuo0605);
  assert.deepStrictEqual([o.replies, o.likes, o.retweets, o.quotes, o.total], [1, 1, 1, 1, 4]);
  assert.strictEqual(store.accounts.blacksoil.inbound.maqinuo0605.replies, 3);
  const sum = await send({ type: 'X_ONEWAY_ACCOUNT_GET' });
  assert.strictEqual(sum.trackedOut, 1);
  await send({ type: 'X_ONEWAY_IX_CLEAR', scope: 'outbound' });
  assert.deepStrictEqual(store.accounts.blacksoil.outbound, {});
  assert.strictEqual(store.accounts.blacksoil.inbound.maqinuo0605.replies, 3, 'scoped clear keeps inbound');
  console.log('BG 1.6 PASS');
}

// ---------- inject ----------
async function injectTests() {
  const posted = [];
  const me = 'blacksoil';
  global.location = { origin: 'https://x.com', pathname: '/home' };
  const domLinks = [{ getAttribute: () => '/dom_user/status/555' }];
  global.document = {
    cookie: 'ct0=abc',
    querySelector: (sel) => sel.includes('AppTabBar_Profile_Link') ? { getAttribute: () => '/' + me } : null,
    querySelectorAll: (sel) => sel.includes('/status/555') ? domLinks : []
  };
  global.window = global;
  window.fetch = async () => ({ ok: true, json: async () => ({}) });
  window.XMLHttpRequest = function () {}; window.XMLHttpRequest.prototype = { open() {}, send() {}, setRequestHeader() {} };
  window.postMessage = (m) => posted.push(m);
  window.addEventListener = () => {};
  eval(fs.readFileSync(path.join(ROOT, 'inject.js'), 'utf8'));
  const D = window.__xOnewayIxDebug;
  const user = (sn) => ({ user_results: { result: { __typename: 'User', rest_id: 'u' + sn, core: { screen_name: sn } } } });
  const tweet = (id, sn, legacy, extra) => ({ __typename: 'Tweet', rest_id: id, core: user(sn), legacy: { id_str: id, full_text: 'x', ...legacy }, ...(extra || {}) });
  const tl = (tweets) => ({ data: { home: { home_timeline_urt: { instructions: [{ entries: tweets.map((t, i) => ({ entryId: 'tweet-' + i, content: { itemContent: { __typename: 'TimelineTweet', tweet_results: { result: t } } } })) }] } } } });
  const G = (op) => `https://x.com/i/api/graphql/abc/${op}`;
  const ox = () => posted.filter((m) => m.__tag === 'x-oneway-ox/v1').map((m) => `${m.action}:${m.username}:${m.key}`);
  const ix = () => posted.filter((m) => m.__tag === 'x-oneway-ix/v1');

  // 1) 时间线被动：缓存作者 + favorited/retweeted + 我的回复/引用；自己帖子的 favorited 不算
  D.onApiResponse(G('HomeTimeline'), tl([
    tweet('100', 'alice', { favorited: true }),
    tweet('101', 'bob', { retweeted: true, favorited: false }),
    tweet('102', me, { in_reply_to_status_id_str: '90', in_reply_to_screen_name: 'carol' }),
    tweet('103', me, { is_quote_status: true }, { quoted_status_result: { result: tweet('80', 'dave', {}) } }),
    tweet('104', me, { favorited: true }),
    tweet('105', me, { in_reply_to_status_id_str: '104', in_reply_to_screen_name: me }),
    tweet('300', 'erin', {})
  ]));
  await new Promise((r) => setTimeout(r, 50));
  console.log(ox());
  assert.deepStrictEqual(ox().sort(), ['like:alice:like:100', 'quote:dave:q:103', 'reply:carol:tw:102', 'retweet:bob:rt:101'].sort());
  assert.strictEqual(ix().length, 0, 'timeline outbound never goes inbound');
  posted.length = 0;

  // 2) FavoriteTweet：作者来自缓存（erin 300）
  D.onApiResponse(G('FavoriteTweet'), { data: { favorite_tweet: 'Done' } }, JSON.stringify({ variables: { tweet_id: '300' } }));
  // 3) FavoriteTweet：缓存没有 → DOM
  D.onApiResponse(G('FavoriteTweet'), { data: { favorite_tweet: 'Done' } }, JSON.stringify({ variables: { tweet_id: '555' } }));
  // 4) 失败响应不记
  D.onApiResponse(G('FavoriteTweet'), { errors: [{ message: 'x' }] }, JSON.stringify({ variables: { tweet_id: '300' } }));
  // 5) CreateRetweet
  D.onApiResponse(G('CreateRetweet'), { data: { create_retweet: { retweet_results: { result: { rest_id: '999' } } } } }, JSON.stringify({ variables: { tweet_id: '100' } }));
  // 6) CreateTweet 回复
  D.onApiResponse(G('CreateTweet'), { data: { create_tweet: { tweet_results: { result: tweet('400', me, { in_reply_to_status_id_str: '300', in_reply_to_screen_name: 'erin' }) } } } },
    JSON.stringify({ variables: { tweet_text: 'hi', reply: { in_reply_to_tweet_id: '300' } } }));
  // 7) CreateTweet 引用（attachment_url）
  D.onApiResponse(G('CreateTweet'), { data: { create_tweet: { tweet_results: { result: tweet('401', me, { is_quote_status: true }) } } } },
    JSON.stringify({ variables: { tweet_text: 'q', attachment_url: 'https://x.com/Frank_1/status/77' } }));
  // 8) CreateNoteTweet 回复，响应缺 in_reply_to_screen_name → 用缓存
  D.onApiResponse(G('CreateNoteTweet'), { data: { notetweet_create: { tweet_results: { result: tweet('402', me, {}) } } } },
    JSON.stringify({ variables: { reply: { in_reply_to_tweet_id: '101' } } }));
  // 9) 自己回自己不计
  D.onApiResponse(G('CreateTweet'), { data: { create_tweet: { tweet_results: { result: tweet('403', me, { in_reply_to_status_id_str: '104', in_reply_to_screen_name: me }) } } } },
    JSON.stringify({ variables: { reply: { in_reply_to_tweet_id: '104' } } }));
  await new Promise((r) => setTimeout(r, 100));
  console.log(ox());
  assert.deepStrictEqual(ox().sort(), [
    'like:erin:like:300', 'like:dom_user:like:555', 'retweet:alice:rt:100',
    'reply:erin:tw:400', 'quote:Frank_1:q:401', 'reply:bob:tw:402'
  ].sort());
  assert.strictEqual(ix().length, 0, 'mutations never go inbound');
  posted.length = 0;

  // 10) 通知页响应：入站照常，出站只记 favorited（入站分类不受影响）
  location.pathname = '/notifications';
  const notif = { data: { viewer_v2: { user_results: { result: { rest_id: 'u' + me, notification_timeline: { timeline: { instructions: [{ entries: [
    { entryId: 'notification-1', content: { clientEventInfo: { element: 'user_replied_to_your_tweet' }, itemContent: { __typename: 'TimelineTweet', tweet_results: { result: tweet('500', 'gina', { in_reply_to_status_id_str: '104', in_reply_to_screen_name: me, conversation_id_str: '104', favorited: true }) } } } }
  ] }] } } } } } } };
  D.onApiResponse(G('NotificationsTimeline'), notif);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepStrictEqual(ix().map((m) => `${m.action}:${m.username}`), ['reply:gina']);
  assert.deepStrictEqual(ox(), ['like:gina:like:500']);
  console.log('INJECT 1.6 PASS');
}

(async () => {
  await bgTests();
  await injectTests();
  console.log('ALL 1.6 PASS');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
