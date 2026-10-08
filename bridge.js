// 隔离世界桥：接收 inject 的入站（被互动）/ 出站（我互动）事件与同步状态，校验后分别转 background
(() => {
  const MSG_TAG = 'x-oneway-ix/v1';
  const DBG_TAG = 'x-oneway-ix/dbg';
  const SYNC_TAG = 'x-oneway-ix/sync';
  const OX_TAG = 'x-oneway-ox/v1';
  const FOLLOW_TAG = 'x-oneway-ix/follow';
  const OX_ACTIONS = new Set(['reply', 'like', 'retweet', 'quote']);
  const T_FALLBACKS = {
    act_out_reply: '我回复',
    act_out_like: '我点赞',
    act_out_retweet: '我转帖',
    act_out_quote: '我引用'
  };
  function applySubs(template, substitutions) {
    if (!template) return '';
    if (substitutions == null) return template;
    const arr = Array.isArray(substitutions) ? substitutions : [substitutions];
    return template.replace(/\$([1-9])/g, (_, d) => {
      const i = Number(d) - 1;
      return i >= 0 && i < arr.length ? String(arr[i] ?? '') : '';
    });
  }
  function t(key, substitutions) {
    try {
      const bare = chrome.i18n.getMessage(key);
      if (bare) return applySubs(bare, substitutions);
      const withSub = chrome.i18n.getMessage(
        key,
        substitutions == null ? undefined : substitutions
      );
      if (withSub) return withSub;
    } catch (_) {}
    const fb = T_FALLBACKS[key];
    if (fb) return applySubs(fb, substitutions);
    return key;
  }

  function OX_LABEL() {
    return {
      reply: t('act_out_reply'),
      like: t('act_out_like'),
      retweet: t('act_out_retweet'),
      quote: t('act_out_quote')
    };
  }
  const OX_KEY_RE = /^(like|rt|tw|q):\d{1,25}$/;
  const oxRecent = new Map();
  const oxStamps = [];
  let oxDbgTimer = null;
  const USER_RE = /^[A-Za-z0-9_]{1,15}$/;
  const ACTIONS = new Set(['reply', 'thread_reply', 'like', 'retweet', 'quote', 'mention']);
  function ACTION_LABEL() {
    return {
      reply: t('act_reply'),
      thread_reply: t('act_thread_reply'),
      like: t('act_like'),
      quote: t('act_quote'),
      retweet: t('act_retweet_short'),
      mention: t('act_mention_short')
    };
  }
  const recent = new Map();
  const stamps = [];

  const dbg = {
    lastOp: '',
    lastAt: 0,
    lastEvents: 0,
    lastStats: null,
    recent: [],
    totals: { forwarded: 0, recordedHint: 0, rateLimited: 0, invalid: 0, parseBatches: 0 },
    byAction: { reply: 0, thread_reply: 0, like: 0, quote: 0, retweet: 0, mention: 0 },
    byOutbound: { reply: 0, like: 0, retweet: 0, quote: 0 },
    sync: null,
    oxSync: null
  };

  function selfName() {
    const a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    const m = (a?.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})/);
    return m ? m[1].toLowerCase() : '';
  }

  function pushRecent(item) {
    dbg.recent.unshift(item);
    if (dbg.recent.length > 40) dbg.recent.length = 40;
  }

  function publishDebug(extra) {
    try {
      chrome.runtime.sendMessage({
        type: 'X_ONEWAY_IX_DEBUG',
        debug: {
          lastOp: dbg.lastOp,
          lastAt: dbg.lastAt,
          lastEvents: dbg.lastEvents,
          lastStats: dbg.lastStats,
          recent: dbg.recent.slice(0, 16),
          totals: { ...dbg.totals },
          byAction: { ...dbg.byAction },
          byOutbound: { ...dbg.byOutbound },
          sync: dbg.sync,
          oxSync: dbg.oxSync,
          path: location.pathname,
          ...extra
        }
      }).catch(() => {});
    } catch (_) { /* extension reloaded */ }

    try {
      window.dispatchEvent(new CustomEvent('x-oneway-ix-debug', { detail: { ...dbg, ...extra } }));
    } catch (_) {}
  }

  function publishSync(detail) {
    if (detail.scope === 'outbound') dbg.oxSync = { ...(dbg.oxSync || {}), ...detail, at: Date.now() };
    else dbg.sync = { ...(dbg.sync || {}), ...detail, at: Date.now() };
    try {
      window.dispatchEvent(new CustomEvent('x-oneway-ix-sync', { detail }));
    } catch (_) {}
    publishDebug({ toast: false });
  }

  // Account detection → background per-account store
  let lastAccount = '';
  function reportAccount() {
    const a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    const href = a?.getAttribute('href') || '';
    const m = href.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
    if (!m) return;
    const u = m[1].toLowerCase();
    if (u === lastAccount) return;
    lastAccount = u;
    let displayName = '';
    try {
      const aria = a.getAttribute('aria-label') || '';
      displayName = aria.replace(/profile|个人资料|的主页/ig, '').trim().slice(0, 80);
    } catch (_) {}
    try {
      chrome.runtime.sendMessage({ type: 'X_ONEWAY_ACCOUNT', username: u, displayName }).catch(() => {});
    } catch (_) {}
  }
  setInterval(reportAccount, 2000);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reportAccount, { once: true });
  } else {
    reportAccount();
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const d = ev.data;
    if (!d || typeof d !== 'object') return;

    if (d.__tag === SYNC_TAG) {
      publishSync(d);
      if (d.kind === 'done' || d.kind === 'error' || d.kind === 'empty' || d.kind === 'capped') {
        try {
          chrome.runtime.sendMessage({
            type: d.scope === 'outbound' ? 'X_ONEWAY_OX_SYNC_DONE' : 'X_ONEWAY_IX_SYNC_DONE',
            info: {
              pages: d.pages || 0,
              events: d.events || 0,
              status: d.status || d.kind,
              detail: d.detail || ''
            }
          }).catch(() => {});
        } catch (_) {}
      }
      return;
    }

    if (d.__tag === OX_TAG) {
      forwardOutbound(d);
      return;
    }

    if (d.__tag === FOLLOW_TAG) {
      try {
        window.dispatchEvent(new CustomEvent('x-oneway-follow', { detail: d }));
      } catch (_) {}
      return;
    }

    if (d.__tag === DBG_TAG) {
      if (d.kind === 'ox') {
        dbg.lastOp = `我互动:${String(d.op || d.source || '')}`;
        dbg.lastAt = Date.now();
        publishDebug({ toast: false });
        return;
      }
      if (d.kind === 'parse') {
        dbg.lastOp = String(d.op || '');
        dbg.lastAt = Date.now();
        dbg.lastEvents = Number(d.events) || 0;
        dbg.lastStats = d.stats || null;
        dbg.totals.parseBatches += 1;
        if (Array.isArray(d.sample)) {
          for (const s of d.sample) {
            pushRecent({
              action: s.action,
              actionLabel: ACTION_LABEL()[s.action] || s.action,
              username: s.username,
              notifId: s.notifId,
              at: dbg.lastAt,
              stage: 'parsed',
              source: d.source || 'hook'
            });
          }
        }
        publishDebug({ toast: true });
      }
      return;
    }

    if (d.__tag !== MSG_TAG) return;
    if (!ACTIONS.has(d.action) || typeof d.username !== 'string' || !USER_RE.test(d.username)) {
      dbg.totals.invalid += 1;
      return;
    }
    const notifId = typeof d.notifId === 'string' ? d.notifId.slice(0, 120) : '';
    if (!notifId || notifId.length < 4) {
      dbg.totals.invalid += 1;
      return;
    }
    const user = d.username.toLowerCase();
    if (user && user === selfName()) return;

    const now = Date.now();
    const key = `${d.action}:${user}:${notifId}`;
    if (recent.has(key) && now - recent.get(key) < 60000) return;
    recent.set(key, now);
    if (recent.size > 800) {
      for (const [k, t] of recent) if (now - t > 60000) recent.delete(k);
    }

    while (stamps.length && now - stamps[0] > 60000) stamps.shift();
    if (stamps.length >= 400) {
      dbg.totals.rateLimited += 1;
      return;
    }
    stamps.push(now);
    dbg.totals.forwarded += 1;
    if (dbg.byAction[d.action] != null) dbg.byAction[d.action] += 1;
    pushRecent({
      action: d.action,
      actionLabel: ACTION_LABEL()[d.action] || d.action,
      username: user,
      notifId,
      at: now,
      stage: 'forwarded'
    });

    try {
      chrome.runtime.sendMessage({
        type: 'X_ONEWAY_IX',
        action: d.action,
        username: user,
        notifId
      }).then((res) => {
        if (res?.ok) dbg.totals.recordedHint += 1;
        if (res?.duplicate) {
          pushRecent({
            action: d.action,
            actionLabel: ACTION_LABEL()[d.action] || d.action,
            username: user,
            notifId,
            at: Date.now(),
            stage: 'duplicate'
          });
        }
      }).catch(() => {});
    } catch (_) { /* extension reloaded */ }
  });

  function forwardOutbound(d) {
    if (!OX_ACTIONS.has(d.action) || typeof d.username !== 'string' || !USER_RE.test(d.username) ||
        typeof d.key !== 'string' || !OX_KEY_RE.test(d.key)) {
      dbg.totals.invalid += 1;
      return;
    }
    const user = d.username.toLowerCase();
    if (user === selfName()) return;
    const now = Date.now();
    if (oxRecent.has(d.key) && now - oxRecent.get(d.key) < 120000) return;
    oxRecent.set(d.key, now);
    if (oxRecent.size > 1500) {
      for (const [k, t] of oxRecent) if (now - t > 120000) oxRecent.delete(k);
    }
    while (oxStamps.length && now - oxStamps[0] > 60000) oxStamps.shift();
    if (oxStamps.length >= 400) { dbg.totals.rateLimited += 1; return; }
    oxStamps.push(now);
    dbg.byOutbound[d.action] = (dbg.byOutbound[d.action] || 0) + 1;
    pushRecent({
      dir: 'out',
      action: d.action,
      actionLabel: OX_LABEL()[d.action],
      username: user,
      notifId: d.key,
      at: now,
      stage: 'forwarded',
      source: String(d.source || 'hook').slice(0, 20)
    });
    try {
      chrome.runtime.sendMessage({ type: 'X_ONEWAY_OX', action: d.action, username: user, key: d.key })
        .then(() => {
          if (oxDbgTimer) return;
          oxDbgTimer = setTimeout(() => { oxDbgTimer = null; publishDebug({ toast: false }); }, 1500);
        })
        .catch(() => {});
    } catch (_) { /* extension reloaded */ }
  }

  // content may ask bridge to forward ctrl to page, or ping debug
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'X_ONEWAY_IX_DEBUG_PING') {
        sendResponse({ ok: true, debug: dbg });
        return true;
      }
      // X_ONEWAY_SYNC_NOW 由 content.js 统一处理（带 2s+ 启动延迟），这里不再直接触发，避免双队列
      return false;
    });
  } catch (_) {}

  // 1.7.2：content 只 postMessage 直达 inject，不再监听 x-oneway-ix-ctrl 二次转发
})();
