// node test/test-1.5.1.js — 用伪 window 加载 inject.js，喂真实结构样例
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const posted = [];
const me = 'blacksoil';
global.location = { origin: 'https://x.com', pathname: '/notifications' };
global.document = {
  cookie: 'ct0=abc',
  querySelector: (sel) => sel.includes('AppTabBar_Profile_Link') ? { getAttribute: () => '/' + me } : null
};
global.window = global;
window.fetch = async () => ({ ok: true, json: async () => ({}) });
window.XMLHttpRequest = function () {}; window.XMLHttpRequest.prototype = { open() {}, send() {}, setRequestHeader() {} };
window.postMessage = (m) => posted.push(m);
window.addEventListener = () => {};
eval(fs.readFileSync(path.join(__dirname, '..', 'inject.js'), 'utf8'));
const D = window.__xOnewayIxDebug;

const user = (sn, id) => ({ user_results: { result: { __typename: 'User', rest_id: id || ('u' + sn), core: { screen_name: sn } } } });
const tweet = (id, sn, legacy, extra) => ({ __typename: 'Tweet', rest_id: id, core: user(sn), legacy: { id_str: id, full_text: 'x', ...legacy }, ...(extra || {}) });
const tEntry = (eid, tw, element) => ({ entryId: eid, content: { entryType: 'TimelineTimelineItem', clientEventInfo: { element: element || 'user_replied_to_your_tweet' }, itemContent: { __typename: 'TimelineTweet', tweet_results: { result: tw } } } });

const notifJson = { data: { viewer_v2: { user_results: { result: { rest_id: 'u' + me, notification_timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [
  // 1) 截图场景：@maqinuo0605 回复了我的原帖「多少价格」—— entryId 是 notification- 前缀！
  tEntry('notification-AAAB1', tweet('1001', 'maqinuo0605', { in_reply_to_status_id_str: '900', in_reply_to_screen_name: me, in_reply_to_user_id_str: 'u' + me, conversation_id_str: '900' })),
  // 2) 回你的楼：我在别人帖下评论(901)，对方回复我的评论
  tEntry('notification-AAAB2', tweet('1002', 'carol', { in_reply_to_status_id_str: '901', in_reply_to_screen_name: me, conversation_id_str: '800' })),
  // 3) 我自己的推文（我评论别人）—— 不应记
  tEntry('notification-AAAB3', tweet('1003', me, { in_reply_to_status_id_str: '700', in_reply_to_screen_name: 'dave', conversation_id_str: '700' })),
  // 4) 引用我的帖
  tEntry('notification-AAAB4', tweet('1004', 'erin', { is_quote_status: true, quoted_status_id_str: '900', conversation_id_str: '1004' }, { quoted_status_result: { result: tweet('900', me, {}) } }), 'user_quoted_your_tweet'),
  // 5) 引用我的回复 → 仍算引用
  tEntry('notification-AAAB5', tweet('1005', 'frank', { is_quote_status: true, quoted_status_id_str: '901' }, { quoted_status_result: { result: tweet('901', me, { in_reply_to_status_id_str: '800' }) } }), 'user_quoted_your_tweet'),
  // 6) 别人回复别人、只是带到我 → 提及
  tEntry('notification-AAAB6', tweet('1006', 'gina', { in_reply_to_status_id_str: '555', in_reply_to_screen_name: 'hank', conversation_id_str: '500' }), 'user_mentioned_you'),
  // 7) 分组点赞（TimelineNotification）
  { entryId: 'notification-like1', content: { clientEventInfo: { element: 'users_liked_your_tweet' }, itemContent: { __typename: 'TimelineNotification', id: 'like1', notification_icon: 'heart_icon', rich_message: { text: 'maqinuo0605 and 1 other liked your post' }, template: { aggregate_user_actions_v1: { from_users: [user('maqinuo0605'), user('ivy')] } } } } },
  // 8) 包在 module 里的回复
  { entryId: 'notification-mod', content: { entryType: 'TimelineTimelineModule', items: [{ entryId: 'x-tweet-1008', item: { itemContent: { __typename: 'TimelineTweet', tweet_results: { result: { __typename: 'TweetWithVisibilityResults', tweet: tweet('1008', 'jack', { in_reply_to_status_id_str: '900', in_reply_to_screen_name: me, conversation_id_str: '900' }) } } } } }] } },
  { entryId: 'cursor-bottom-1', content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'CUR2' } }
] }] } } } } } } };

posted.length = 0;
const r = D.processResponse('https://x.com/i/api/graphql/QID/NotificationsTimeline?variables=%7B%7D', notifJson);
const evs = posted.filter((m) => m.__tag === 'x-oneway-ix/v1').map((m) => `${m.action}:${m.username}:${m.notifId}`);
console.log(evs.join('\n'));
const has = (s) => assert(evs.includes(s), 'missing ' + s);
has('reply:maqinuo0605:tw:1001:maqinuo0605');
has('thread_reply:carol:tw:1002:carol');
has('quote:erin:tw:1004:erin');
has('quote:frank:tw:1005:frank');
has('mention:gina:tw:1006:gina');
has('like:maqinuo0605:like1:maqinuo0605');
has('like:ivy:like1:ivy');
has('reply:jack:tw:1008:jack');
assert(!evs.some((e) => e.includes(':' + me + ':')), 'self recorded');
assert.strictEqual(r.cursor, 'CUR2');

// TweetDetail：我的原帖 900 下的回复 + 楼中楼
const detail = { data: { threaded_conversation_with_injections_v2: { instructions: [{ type: 'TimelineAddEntries', entries: [
  tEntry('tweet-900', tweet('900', me, { conversation_id_str: '900' })),
  { entryId: 'conversationthread-1', content: { entryType: 'TimelineTimelineModule', items: [
    { entryId: 'conversationthread-1-tweet-1101', item: { itemContent: { __typename: 'TimelineTweet', tweet_results: { result: tweet('1101', 'kate', { in_reply_to_status_id_str: '900', in_reply_to_screen_name: me, conversation_id_str: '900' }) } } } },
    { entryId: 'conversationthread-1-tweet-1102', item: { itemContent: { __typename: 'TimelineTweet', tweet_results: { result: tweet('1102', me, { in_reply_to_status_id_str: '1101', in_reply_to_screen_name: 'kate', conversation_id_str: '900' }) } } } },
    { entryId: 'conversationthread-1-tweet-1103', item: { itemContent: { __typename: 'TimelineTweet', tweet_results: { result: tweet('1103', 'kate', { in_reply_to_status_id_str: '1102', in_reply_to_screen_name: me, conversation_id_str: '900' }) } } } },
    { entryId: 'conversationthread-1-tweet-1104', item: { itemContent: { __typename: 'TimelineTweet', tweet_results: { result: tweet('1104', 'leo', { in_reply_to_status_id_str: '1101', in_reply_to_screen_name: 'kate', conversation_id_str: '900' }) } } } }
  ] } }
] }] } } };
posted.length = 0;
location.pathname = '/' + me + '/status/900';
D.processResponse('https://x.com/i/api/graphql/QID2/TweetDetail?variables=%7B%7D', detail);
const dv = posted.filter((m) => m.__tag === 'x-oneway-ix/v1').map((m) => `${m.action}:${m.username}:${m.notifId}`);
console.log('--- detail\n' + dv.join('\n'));
assert.deepStrictEqual(dv.sort(), ['reply:kate:tw:1101:kate', 'thread_reply:kate:tw:1103:kate'].sort());
assert(posted.some((m) => m.__tag === 'x-oneway-ix/detail'));

// 旧 fixture 仍然兼容
posted.length = 0; location.pathname = '/notifications';
D.processResponse('https://x.com/i/api/graphql/Q/NotificationsTimeline', JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-notif.json'), 'utf8')));
console.log('--- old fixture\n' + posted.filter((m) => m.__tag === 'x-oneway-ix/v1').map((m) => `${m.action}:${m.username}`).join('\n'));
console.log('\nALL PASS');
