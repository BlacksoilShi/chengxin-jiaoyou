// 唯一写入者：按登录账号分库（schemaVersion 4）
//   accounts[user].inbound  = { [对方]: { replies, threadReplies, quotes, likes, retweets, mentions, total, lastAt } }  别人对你
//   accounts[user].outbound = { [对方]: { replies, likes, retweets, quotes, total, lastAt } }                          你对别人
//   accounts[user].seenInboundIds / seenOutboundIds 分开去重
const SCHEMA_VERSION = 4;
const MAX_USERS = 5000;
const MAX_SEEN = 20000;
const USER_RE = /^[a-z0-9_]{1,15}$/;

const IN_FIELDS = ['replies', 'threadReplies', 'likes', 'quotes', 'retweets', 'mentions'];
const OUT_FIELDS = ['replies', 'likes', 'retweets', 'quotes'];
const IN_FIELD = {
  reply: 'replies',              // 评你的帖：别人回复了你的原帖
  thread_reply: 'threadReplies', // 回你的楼：别人回复了你的回复
  like: 'likes',
  retweet: 'retweets',
  quote: 'quotes',
  mention: 'mentions'
};
const OUT_FIELD = {
  reply: 'replies',   // 我回复
  like: 'likes',      // 我点赞
  retweet: 'retweets',// 我转帖
  quote: 'quotes'     // 我引用
};
function sumFields(r, fields) {
  return fields.reduce((n, f) => n + (r[f] || 0), 0);
}

let chain = Promise.resolve();
function freshDebug() {
  return {
    lastOp: '', lastAt: 0, lastEvents: 0, lastStats: null,
    recent: [], totals: {}, byAction: {}, byOutbound: {}, path: '',
    recordOk: 0, recordDup: 0, recordFail: 0,
    outOk: 0, outDup: 0, outFail: 0,
    sync: null, oxSync: null
  };
}
let ixDebug = freshDebug();

function emptyAccount() {
  return {
    inbound: {},
    outbound: {},
    seenInboundIds: [],
    seenOutboundIds: [],
    lastSyncAt: 0,
    lastOutboundSyncAt: 0,
    displayName: ''
  };
}

// 旧账号结构（schema 3：interactions / seenNotificationIds）→ schema 4
function upgradeAccount(acc) {
  const a = { ...emptyAccount(), ...(acc || {}) };
  if (acc && acc.interactions && typeof acc.interactions === 'object') {
    a.inbound = { ...acc.interactions, ...(acc.inbound || {}) };
  }
  if (acc && Array.isArray(acc.seenNotificationIds)) {
    a.seenInboundIds = Array.from(new Set([...(acc.seenInboundIds || []), ...acc.seenNotificationIds])).slice(-MAX_SEEN);
  }
  delete a.interactions;
  delete a.seenNotificationIds;
  if (!a.inbound || typeof a.inbound !== 'object') a.inbound = {};
  if (!a.outbound || typeof a.outbound !== 'object') a.outbound = {};
  if (!Array.isArray(a.seenInboundIds)) a.seenInboundIds = [];
  if (!Array.isArray(a.seenOutboundIds)) a.seenOutboundIds = [];
  return a;
}

async function loadStore() {
  const data = await chrome.storage.local.get({
    schemaVersion: 0,
    interactions: {},
    seenNotificationIds: [],
    accounts: null,
    activeAccount: '',
    migratedToast: false
  });
  return ensureSchema(data);
}

async function ensureSchema(data) {
  if (data.schemaVersion === SCHEMA_VERSION && data.accounts && typeof data.accounts === 'object') {
    return data;
  }
  const prevVersion = data.schemaVersion || 0;
  const accounts = {};
  const srcAccounts = (data.accounts && typeof data.accounts === 'object') ? data.accounts : {};
  for (const [k, v] of Object.entries(srcAccounts)) accounts[k] = upgradeAccount(v);
  const activeAccount = typeof data.activeAccount === 'string' ? data.activeAccount.toLowerCase() : '';

  // schema ≤2：全局 interactions / seen → 当前账号或 _pending 的 inbound
  if (prevVersion < 3) {
    const oldIx = data.interactions && typeof data.interactions === 'object' ? data.interactions : {};
    const oldSeen = Array.isArray(data.seenNotificationIds) ? data.seenNotificationIds : [];
    if (Object.keys(oldIx).length || oldSeen.length) {
      const target = (activeAccount && USER_RE.test(activeAccount)) ? activeAccount : '_pending';
      const base = accounts[target] || emptyAccount();
      base.inbound = { ...oldIx, ...(base.inbound || {}) };
      base.seenInboundIds = Array.from(new Set([...(base.seenInboundIds || []), ...oldSeen])).slice(-MAX_SEEN);
      accounts[target] = base;
    }
  }

  const next = {
    schemaVersion: SCHEMA_VERSION,
    accounts,
    activeAccount,
    migratedToast: prevVersion > 0 && prevVersion < SCHEMA_VERSION ? true : !!data.migratedToast
  };
  await chrome.storage.local.set(next);
  try { await chrome.storage.local.remove(['interactions', 'seenNotificationIds', 'pendingMigrateToast']); } catch (_) {}
  return next;
}

chain = chain.then(() => loadStore()).catch((e) => console.warn('[x-oneway] migrate', e));

function touchSeen(seenArr, id) {
  const idx = seenArr.indexOf(id);
  if (idx >= 0) {
    seenArr.splice(idx, 1);
    seenArr.push(id);
    return true;
  }
  seenArr.push(id);
  if (seenArr.length > MAX_SEEN) seenArr.splice(0, seenArr.length - MAX_SEEN);
  return false;
}

function trimUsers(map) {
  const keys = Object.keys(map);
  if (keys.length <= MAX_USERS) return;
  keys.sort((a, b) => (map[a].lastAt || 0) - (map[b].lastAt || 0));
  for (const k of keys.slice(0, keys.length - MAX_USERS)) delete map[k];
}

async function resolveAccountKey(preferred) {
  const store = await loadStore();
  let key = (preferred || store.activeAccount || '').toLowerCase();
  if (!key || !USER_RE.test(key)) key = '_pending';
  store.accounts[key] = upgradeAccount(store.accounts[key]);
  return { store, key };
}

function mergeMaps(dest, src, fields) {
  for (const [u, rec] of Object.entries(src || {})) {
    const cur = dest[u];
    if (!cur) { dest[u] = { ...rec }; continue; }
    const r = { lastAt: Math.max(cur.lastAt || 0, rec.lastAt || 0) };
    for (const f of fields) r[f] = (cur[f] || 0) + (rec[f] || 0);
    r.total = sumFields(r, fields);
    dest[u] = r;
  }
}

function mergePendingInto(accounts, username) {
  const pending = accounts._pending;
  if (!pending || username === '_pending') return false;
  const p = upgradeAccount(pending);
  const dest = upgradeAccount(accounts[username]);
  mergeMaps(dest.inbound, p.inbound, IN_FIELDS);
  mergeMaps(dest.outbound, p.outbound, OUT_FIELDS);
  dest.seenInboundIds = Array.from(new Set([...dest.seenInboundIds, ...p.seenInboundIds])).slice(-MAX_SEEN);
  dest.seenOutboundIds = Array.from(new Set([...dest.seenOutboundIds, ...p.seenOutboundIds])).slice(-MAX_SEEN);
  if (!dest.lastSyncAt) dest.lastSyncAt = p.lastSyncAt || 0;
  if (!dest.lastOutboundSyncAt) dest.lastOutboundSyncAt = p.lastOutboundSyncAt || 0;
  accounts[username] = dest;
  delete accounts._pending;
  return true;
}

function setActiveAccount(username, displayName) {
  chain = chain.then(async () => {
    const store = await loadStore();
    const key = String(username || '').toLowerCase();
    if (!USER_RE.test(key)) return { ok: false, reason: 'invalid' };
    store.accounts[key] = upgradeAccount(store.accounts[key]);
    if (displayName) store.accounts[key].displayName = String(displayName).slice(0, 80);
    const mergedPending = mergePendingInto(store.accounts, key);
    const switched = store.activeAccount !== key;
    if (!switched && !mergedPending && !displayName) return { ok: true, switched: false, activeAccount: key };
    await chrome.storage.local.set({
      schemaVersion: SCHEMA_VERSION,
      accounts: store.accounts,
      activeAccount: key,
      migratedToast: mergedPending ? true : store.migratedToast
    });
    return { ok: true, switched, activeAccount: key, mergedPending };
  });
  return chain;
}

// direction: 'in' | 'out'
function record(direction, action, username, eventId) {
  chain = chain.then(async () => {
    const { store, key } = await resolveAccountKey();
    const acc = store.accounts[key];
    const isOut = direction === 'out';
    const mapName = isOut ? 'outbound' : 'inbound';
    const seenName = isOut ? 'seenOutboundIds' : 'seenInboundIds';
    const fields = isOut ? OUT_FIELDS : IN_FIELDS;
    const field = (isOut ? OUT_FIELD : IN_FIELD)[action];
    const map = { ...(acc[mapName] || {}) };
    const seen = acc[seenName].slice();

    // 入站 tw:<推文id>:<用户> 跨来源/跨类型只记一次；出站 key 已含类型前缀（like:/rt:/tw:/q:）
    const dedupeKey = isOut ? eventId : (eventId.startsWith('tw:') ? eventId : `${action}:${eventId}`);
    if (touchSeen(seen, dedupeKey)) {
      acc[seenName] = seen;
      await chrome.storage.local.set({ accounts: store.accounts });
      if (isOut) ixDebug.outDup += 1; else ixDebug.recordDup += 1;
      return { duplicate: true };
    }

    const blank = { total: 0, lastAt: 0 };
    for (const f of fields) blank[f] = 0;
    const rec = { ...blank, ...(map[username] || {}) };
    rec[field] = (rec[field] || 0) + 1;
    rec.total = sumFields(rec, fields);
    rec.lastAt = Date.now();
    map[username] = rec;
    trimUsers(map);

    acc[mapName] = map;
    acc[seenName] = seen;
    await chrome.storage.local.set({
      schemaVersion: SCHEMA_VERSION,
      accounts: store.accounts,
      activeAccount: store.activeAccount || (key !== '_pending' ? key : '')
    });
    if (isOut) ixDebug.outOk += 1; else ixDebug.recordOk += 1;
    return { duplicate: false };
  }).catch((e) => {
    console.warn('[x-oneway] record failed', e);
    if (direction === 'out') ixDebug.outFail += 1; else ixDebug.recordFail += 1;
    return { error: String(e) };
  });
  return chain;
}

function markSyncDone(scope, info) {
  chain = chain.then(async () => {
    const { store, key } = await resolveAccountKey();
    const acc = store.accounts[key];
    const now = Date.now();
    if (scope === 'outbound') acc.lastOutboundSyncAt = now;
    else acc.lastSyncAt = now;
    await chrome.storage.local.set({ accounts: store.accounts });
    const s = {
      at: now,
      account: key,
      pages: info?.pages || 0,
      events: info?.events || 0,
      status: info?.status || 'ok',
      detail: info?.detail || ''
    };
    if (scope === 'outbound') ixDebug.oxSync = s; else ixDebug.sync = s;
    persistDebug();
    return { ok: true, at: now, account: key };
  });
  return chain;
}

function clearActiveAccount(scope) {
  chain = chain.then(async () => {
    const store = await loadStore();
    const key = store.activeAccount || '_pending';
    const acc = upgradeAccount(store.accounts[key]);
    if (scope === 'inbound') {
      acc.inbound = {}; acc.seenInboundIds = []; acc.lastSyncAt = 0;
    } else if (scope === 'outbound') {
      acc.outbound = {}; acc.seenOutboundIds = []; acc.lastOutboundSyncAt = 0;
    } else {
      const dn = acc.displayName;
      Object.assign(acc, emptyAccount(), { displayName: dn });
    }
    store.accounts[key] = acc;
    await chrome.storage.local.set({ accounts: store.accounts, ixDebug: null });
    ixDebug = freshDebug();
    return { ok: true, account: key, scope: scope || 'all' };
  });
  return chain;
}

function persistDebug() {
  chrome.storage.local.set({
    ixDebug: {
      ...ixDebug,
      recent: (ixDebug.recent || []).slice(0, 20)
    }
  }).catch(() => {});
}

function accountSummary() {
  return loadStore().then((store) => {
    const key = store.activeAccount || '';
    const acc = upgradeAccount(key && store.accounts[key]);
    return {
      ok: true,
      activeAccount: key,
      displayName: acc.displayName || '',
      tracked: Object.keys(acc.inbound).length,
      trackedOut: Object.keys(acc.outbound).length,
      lastSyncAt: acc.lastSyncAt || 0,
      lastOutboundSyncAt: acc.lastOutboundSyncAt || 0,
      accountKeys: Object.keys(store.accounts || {}).filter((k) => k !== '_pending')
    };
  });
}

function fromXTab(sender) {
  const url = sender.url || sender.tab?.url || '';
  return /^https:\/\/(x|twitter)\.com\//.test(url);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  if (msg?.type === 'X_ONEWAY_ACCOUNT') {
    const u = typeof msg.username === 'string' ? msg.username.toLowerCase() : '';
    if (!USER_RE.test(u)) { sendResponse({ ok: false }); return true; }
    setActiveAccount(u, msg.displayName).then((r) => sendResponse(r));
    return true;
  }

  if (msg?.type === 'X_ONEWAY_ACCOUNT_GET') {
    accountSummary().then((r) => sendResponse(r));
    return true;
  }

  if (msg?.type === 'X_ONEWAY_IX_SYNC_DONE') {
    markSyncDone('inbound', msg.info || {}).then((r) => sendResponse(r));
    return true;
  }

  if (msg?.type === 'X_ONEWAY_OX_SYNC_DONE') {
    markSyncDone('outbound', msg.info || {}).then((r) => sendResponse(r));
    return true;
  }

  if (msg?.type === 'X_ONEWAY_IX_DEBUG') {
    const d = msg.debug || {};
    ixDebug.lastOp = d.lastOp || ixDebug.lastOp;
    ixDebug.lastAt = d.lastAt || ixDebug.lastAt;
    ixDebug.lastEvents = d.lastEvents ?? ixDebug.lastEvents;
    ixDebug.lastStats = d.lastStats || ixDebug.lastStats;
    if (Array.isArray(d.recent) && d.recent.length) {
      const map = new Map();
      for (const r of [...d.recent, ...(ixDebug.recent || [])]) {
        const k = `${r.dir || 'in'}:${r.action}:${r.notifId}`;
        if (!map.has(k)) map.set(k, r);
      }
      ixDebug.recent = Array.from(map.values()).slice(0, 24);
    }
    if (d.totals) ixDebug.totals = d.totals;
    if (d.byAction) ixDebug.byAction = d.byAction;
    if (d.byOutbound) ixDebug.byOutbound = d.byOutbound;
    if (d.path) ixDebug.path = d.path;
    if (d.sync) ixDebug.sync = d.sync;
    if (d.oxSync) ixDebug.oxSync = d.oxSync;
    persistDebug();
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === 'X_ONEWAY_IX_DEBUG_GET') {
    chrome.storage.local.get({ ixDebug: null }, (res) => {
      sendResponse({ ok: true, debug: res.ixDebug || ixDebug });
    });
    return true;
  }

  if (msg?.type === 'X_ONEWAY_IX') {
    if (!fromXTab(sender)) return false;
    if (!IN_FIELD[msg.action] || typeof msg.username !== 'string' || !USER_RE.test(msg.username)) return false;
    if (typeof msg.notifId !== 'string' || msg.notifId.length < 4) return false;
    record('in', msg.action, msg.username, msg.notifId).then((r) => {
      persistDebug();
      sendResponse({ ok: true, duplicate: !!r?.duplicate });
    });
    return true;
  }

  if (msg?.type === 'X_ONEWAY_OX') {
    if (!fromXTab(sender)) return false;
    if (!OUT_FIELD[msg.action] || typeof msg.username !== 'string' || !USER_RE.test(msg.username)) return false;
    if (typeof msg.key !== 'string' || !/^(like|rt|tw|q):\d{1,25}$/.test(msg.key)) return false;
    record('out', msg.action, msg.username, msg.key).then((r) => {
      persistDebug();
      sendResponse({ ok: true, duplicate: !!r?.duplicate });
    });
    return true;
  }

  if (msg?.type === 'X_ONEWAY_IX_CLEAR') {
    const scope = msg.scope === 'inbound' || msg.scope === 'outbound' ? msg.scope : '';
    clearActiveAccount(scope).then((r) => sendResponse(r));
    return true;
  }

  if (msg?.type === 'X_ONEWAY_IX_MIGRATED_ACK') {
    chrome.storage.local.set({ migratedToast: false }).then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});
