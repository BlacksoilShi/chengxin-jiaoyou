// node test/test-bg.js — 分项落库 + tw: 跨来源去重
const fs = require('fs'); const path = require('path'); const assert = require('assert');
let store = {}; let listener;
global.chrome = {
  runtime: { id: 'ext', onMessage: { addListener: (f) => { listener = f; } } },
  storage: { local: {
    get: async (defs) => { const o = {}; for (const k of Object.keys(defs)) o[k] = k in store ? JSON.parse(JSON.stringify(store[k])) : defs[k]; return o; },
    set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); }
  } }
};
eval(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'));
const send = (msg) => new Promise((r) => listener(msg, { id: 'ext', url: 'https://x.com/notifications' }, r));
(async () => {
  await send({ type: 'X_ONEWAY_ACCOUNT', username: 'blacksoil' });
  await send({ type: 'X_ONEWAY_IX', action: 'reply', username: 'maqinuo0605', notifId: 'tw:1001:maqinuo0605' });
  const dup = await send({ type: 'X_ONEWAY_IX', action: 'thread_reply', username: 'maqinuo0605', notifId: 'tw:1001:maqinuo0605' });
  assert(dup.duplicate, 'tw dedupe across actions');
  await send({ type: 'X_ONEWAY_IX', action: 'thread_reply', username: 'maqinuo0605', notifId: 'tw:1002:maqinuo0605' });
  await send({ type: 'X_ONEWAY_IX', action: 'quote', username: 'maqinuo0605', notifId: 'tw:1003:maqinuo0605' });
  await send({ type: 'X_ONEWAY_IX', action: 'like', username: 'maqinuo0605', notifId: 'like1:maqinuo0605' });
  const rec = store.accounts.blacksoil.inbound.maqinuo0605;
  console.log(rec);
  assert.strictEqual(rec.replies, 1); assert.strictEqual(rec.threadReplies, 1);
  assert.strictEqual(rec.quotes, 1); assert.strictEqual(rec.likes, 1); assert.strictEqual(rec.total, 4);
  console.log('BG PASS');
})();
