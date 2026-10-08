const T_FALLBACKS = {
  pill_in: '被互动 $1',
  pill_in_short: '被 $1',
  pill_out: '我互动 $1',
  pill_out_short: '我 $1',
  pill_none: '暂无互动',
  pill_none_short: '暂无',
  pill_in_none: '被·暂无',
  pill_out_none: '我·暂无',
  badge_oneway: '未回关',
  badge_blue: '蓝V待回关',
  btn_follow: '关注',
  btn_following: '已关注',
  btn_follow_title: '关注 @$1（诚信浇友 · 仅你点击时关注）',
  btn_follow_title_short: '关注 @$1',
  tip_in_header: '【被互动 $1】@$2 对你',
  tip_out_header: '【我互动 $1】你对 @$2',
  tip_part: '$1 $2',
  tip_recent: '最近：$1',
  tip_in_empty: '  暂无（进通知页温和同步 / 打开你的帖子累计）',
  tip_out_empty: '  暂无（安装后你回复/点赞/转帖/引用会实时记；历史可在你的喜欢/回复页手动同步）',
  tip_account: '（账号 @$1 · 仅本机累计）',
  tip_retweet_you: '转帖你 $1',
  tip_mention_you: '提及你 $1',
  act_reply: '评你的帖',
  act_thread_reply: '回你的楼',
  act_quote: '引用你',
  act_like: '点赞你',
  act_out_reply: '我回复',
  act_out_like: '我点赞',
  act_out_retweet: '我转帖',
  act_out_quote: '我引用',
  extVersionLabel: 'v$1'
};

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

function t(key, substitutions) {
  try {
    if (substitutions != null) {
      const withSub = chrome.i18n.getMessage(key, substitutions);
      if (withSub && subsLanded(withSub, substitutions)) return withSub;
      const fb = T_FALLBACKS[key];
      if (fb) return applySubs(fb, substitutions);
      const bare = chrome.i18n.getMessage(key);
      if (bare && /\$[1-9]\$?/.test(bare)) return applySubs(bare, substitutions);
      if (withSub) return withSub;
    } else {
      const bare = chrome.i18n.getMessage(key);
      if (bare) return bare;
    }
  } catch (_) {}
  const fb = T_FALLBACKS[key];
  if (fb) return applySubs(fb, substitutions);
  return key;
}


function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const msg = t(key);
    if (!msg || msg === key) return;
    if (el.tagName === 'TITLE') el.textContent = msg;
    else el.textContent = msg;
  });
  const ver = chrome.runtime.getManifest().version;
  const verEl = document.getElementById('verLabel');
  if (verEl) verEl.textContent = t('extVersionLabel', [ver]);
  document.documentElement.lang = chrome.i18n.getUILanguage() || 'zh-CN';
}
applyI18n();

const statusEl = document.getElementById('status');
const autoScanEl = document.getElementById('autoScan');
const showInEl = document.getElementById('showInbound');
const showOutEl = document.getElementById('showOutbound');
const showFollowEl = document.getElementById('showQuickFollow');
const acctBox = document.getElementById('acctBox');
const dbgBox = document.getElementById('dbgBox');

function setStatus(text) {
  statusEl.textContent = text;
}

chrome.storage.sync.get({ autoScan: true, showInteractions: true, showInbound: null, showOutbound: null, showQuickFollow: true }, (cfg) => {
  autoScanEl.checked = !!cfg.autoScan;
  showInEl.checked = cfg.showInbound == null ? !!cfg.showInteractions : !!cfg.showInbound;
  showOutEl.checked = cfg.showOutbound == null ? !!cfg.showInteractions : !!cfg.showOutbound;
  showFollowEl.checked = cfg.showQuickFollow !== false;
});

autoScanEl.addEventListener('change', () => {
  chrome.storage.sync.set({ autoScan: autoScanEl.checked });
});

showInEl.addEventListener('change', () => {
  chrome.storage.sync.set({ showInbound: showInEl.checked });
});
showOutEl.addEventListener('change', () => {
  chrome.storage.sync.set({ showOutbound: showOutEl.checked });
});
showFollowEl.addEventListener('change', () => {
  chrome.storage.sync.set({ showQuickFollow: showFollowEl.checked });
});

function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtClock(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function refreshAccount() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'X_ONEWAY_ACCOUNT_GET' });
    if (res?.ok) {
      const who = res.activeAccount ? `@${res.activeAccount}` : t('acct_unknown');
      const sync = res.lastSyncAt ? fmtTime(res.lastSyncAt) : t('acct_never');
      const osync = res.lastOutboundSyncAt ? fmtTime(res.lastOutboundSyncAt) : t('acct_never');
      acctBox.innerHTML = t('acct_line', [who, String(res.tracked || 0), sync, String(res.trackedOut || 0), osync]);
      return;
    }
  } catch (_) {}
  chrome.storage.local.get({ activeAccount: '', accounts: {} }, (r) => {
    const key = r.activeAccount || '';
    const acc = (key && r.accounts && r.accounts[key]) || null;
    const n = acc ? Object.keys(acc.inbound || acc.interactions || {}).length : 0;
    const o = acc ? Object.keys(acc.outbound || {}).length : 0;
    const who = key ? '@' + key : t('acct_unknown');
    acctBox.innerHTML = t('acct_line_simple', [who, String(n), String(o)]);
  });
}
refreshAccount();

const ACTION_KEYS = {
  reply: 'act_reply',
  thread_reply: 'act_thread_reply',
  like: 'act_like',
  quote: 'act_quote',
  retweet: 'act_retweet',
  mention: 'act_mention'
};
const ACTION_CLS = { reply: 'tag-reply', thread_reply: 'tag-thread', like: 'tag-like', quote: 'tag-quote' };
const OUT_ACTION_CLS = { reply: 'tag-out', like: 'tag-out', retweet: 'tag-out', quote: 'tag-out' };

function actionLabel(action, actionLabelRaw) {
  if (ACTION_KEYS[action]) return t(ACTION_KEYS[action]);
  return actionLabelRaw || action || '';
}

function renderDebug(d) {
  if (!d) {
    dbgBox.textContent = t('dbg_empty');
    return;
  }
  const lines = [];
  lines.push({ html: false, text: t('dbg_lastOp', [d.lastOp || '-', fmtClock(d.lastAt)]) });
  lines.push({ html: false, text: t('dbg_inbound', [String(d.lastEvents ?? 0), String(d.recordOk ?? 0), String(d.recordDup ?? 0), String(d.recordFail ?? 0)]) });
  lines.push({ html: false, text: t('dbg_outbound', [String(d.outOk ?? 0), String(d.outDup ?? 0), String(d.outFail ?? 0)]) });
  const bo = d.byOutbound || {};
  if (bo.reply || bo.like || bo.retweet || bo.quote) {
    lines.push({ html: false, text: t('dbg_ox_fwd', [String(bo.reply || 0), String(bo.like || 0), String(bo.retweet || 0), String(bo.quote || 0)]) });
  }
  if (d.oxSync) {
    lines.push({ html: false, text: t('dbg_ox_sync', [String(d.oxSync.status || d.oxSync.kind || '-'), String(d.oxSync.pages || 0), String(d.oxSync.events || 0)]) });
    if (d.oxSync.detail) lines.push({ html: false, text: `  ${d.oxSync.detail}` });
  }
  const by = d.byAction || (d.lastStats && d.lastStats.byAction) || {};
  if (by && (by.reply || by.thread_reply || by.like || by.quote || by.retweet || by.mention)) {
    let s = t('dbg_fwd', [String(by.reply || 0), String(by.thread_reply || 0), String(by.quote || 0), String(by.like || 0)]);
    if (by.retweet || by.mention) s += t('dbg_fwd_extra', [String(by.retweet || 0), String(by.mention || 0)]);
    lines.push({ html: false, text: s });
  }
  const st = d.lastStats || {};
  if (st && typeof st === 'object') {
    lines.push({ html: false, text: t('dbg_entries', [String(st.seenNotifEntries || 0), String(st.seenTweetEntries || 0), String(st.instrArrays || 0), st.rest ? t('dbg_rest_suffix') : '']) });
    lines.push({ html: false, text: t('dbg_skip', [String(st.skipNoNode || 0), String(st.skipNoAction || 0), String(st.skipNoActor || 0), String(st.skipSelf || 0)]) });
    if (st.lastSkipReason) lines.push({ html: false, text: t('dbg_lastSkip', [String(st.lastSkipReason)]) });
    if (Array.isArray(st.unknownIcons) && st.unknownIcons.length) {
      lines.push({ html: false, text: t('dbg_unknownIcons') });
      for (const u of st.unknownIcons.slice(0, 4)) {
        lines.push({ html: false, text: `  · icon=${u.icon || '?'} text=${(u.text || '').slice(0, 40)}` });
      }
    }
  }
  const tot = d.totals || {};
  if (tot.forwarded != null) {
    lines.push({ html: false, text: t('dbg_bridge', [String(tot.forwarded || 0), String(tot.rateLimited || 0), String(tot.invalid || 0)]) });
  }
  if (d.sync) {
    lines.push({ html: false, text: t('dbg_sync', [String(d.sync.status || d.sync.kind || '-'), String(d.sync.pages || 0), String(d.sync.events || 0)]) });
    if (d.sync.detail) lines.push({ html: false, text: `  ${d.sync.detail}` });
  }
  const recent = Array.isArray(d.recent) ? d.recent.slice(0, 10) : [];
  if (recent.length) {
    lines.push({ html: false, text: t('dbg_recent_header') });
    for (const r of recent) {
      const label = actionLabel(r.action, r.actionLabel);
      const cls = ACTION_CLS[r.action] || OUT_ACTION_CLS[r.action] || '';
      const safeUser = String(r.username || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const safeLabel = String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const stage = `${r.stage || '?'}${r.source ? '/' + r.source : ''}`;
      const labeled = cls
        ? `  · [<span class="${cls}">${safeLabel}</span>] @${safeUser} (${stage})`
        : `  · [${safeLabel}] @${safeUser} (${stage})`;
      lines.push({ html: true, text: labeled });
    }
  } else {
    lines.push({ html: false, text: t('dbg_recent_none') });
  }

  const html = lines.map((l, i) => {
    let s = l.html ? l.text : l.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return i === 0 ? `<b>${s}</b>` : s;
  }).join('\n');
  dbgBox.innerHTML = html;
}

async function refreshDebug() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'X_ONEWAY_IX_DEBUG_GET' });
    renderDebug(res?.debug);
  } catch (_) {
    chrome.storage.local.get({ ixDebug: null }, (r) => renderDebug(r.ixDebug));
  }
}
refreshDebug();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.accounts || changes.activeAccount) refreshAccount();
    if (changes.ixDebug) renderDebug(changes.ixDebug.newValue);
  }
});

document.getElementById('refreshDbg').addEventListener('click', () => {
  refreshDebug();
  refreshAccount();
  setStatus(t('status_refreshed'));
});

const syncBtn = document.getElementById('syncNow');
const SYNC_BTN_TEXT = () => t('popup_syncNow');
let syncArmed = false;
syncBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus(t('status_no_tab'));
    return;
  }
  const url = tab.url || '';
  if (!/https:\/\/(x|twitter)\.com\//.test(url)) {
    setStatus(t('status_open_x'));
    return;
  }
  if (!/\/notifications/.test(url)) {
    setStatus(t('status_open_notif'));
    return;
  }
  if (!syncArmed) {
    syncArmed = true;
    syncBtn.textContent = t('status_sync_confirm');
    setTimeout(() => { syncArmed = false; syncBtn.textContent = SYNC_BTN_TEXT(); }, 5000);
    return;
  }
  syncArmed = false;
  syncBtn.textContent = SYNC_BTN_TEXT();
  setStatus(t('status_sync_requesting'));
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'X_ONEWAY_SYNC_NOW' });
    if (res?.ok) setStatus(t('status_sync_triggered'));
    else setStatus(res?.error || t('status_sync_fail'));
  } catch (_) {
    setStatus(t('status_sync_refresh'));
  }
});

const oxBtn = document.getElementById('oxSyncNow');
const OX_BTN_TEXT = () => t('popup_oxSyncNow');
let oxArmed = false;
oxBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  if (!tab?.id || !/https:\/\/(x|twitter)\.com\//.test(url)) { setStatus(t('status_open_x')); return; }
  if (!/\/[A-Za-z0-9_]{1,15}\/(likes|with_replies)\/?(\?|#|$)/.test(url)) {
    setStatus(t('status_ox_open'));
    return;
  }
  if (!oxArmed) {
    oxArmed = true;
    oxBtn.textContent = t('status_ox_confirm');
    setTimeout(() => { oxArmed = false; oxBtn.textContent = OX_BTN_TEXT(); }, 5000);
    return;
  }
  oxArmed = false;
  oxBtn.textContent = OX_BTN_TEXT();
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'X_ONEWAY_OX_SYNC_NOW' });
    if (res?.ok) setStatus(t('status_ox_triggered'));
    else setStatus(res?.error || t('status_sync_fail'));
  } catch (_) {
    setStatus(t('status_ox_refresh'));
  }
});

const clearBtn = document.getElementById('clearIx');
const CLEAR_BTN_TEXT = () => t('popup_clearIx');
let clearArmed = false;
clearBtn.addEventListener('click', async () => {
  if (!clearArmed) {
    clearArmed = true;
    clearBtn.textContent = t('status_clear_confirm');
    setTimeout(() => { clearArmed = false; clearBtn.textContent = CLEAR_BTN_TEXT(); }, 4000);
    return;
  }
  clearArmed = false;
  clearBtn.textContent = CLEAR_BTN_TEXT();
  try {
    await chrome.runtime.sendMessage({ type: 'X_ONEWAY_IX_CLEAR' });
  } catch (_) {}
  refreshAccount();
  refreshDebug();
  setStatus(t('status_cleared'));
});

document.getElementById('scan').addEventListener('click', async () => {
  setStatus(t('status_scanning'));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus(t('status_no_tab'));
    return;
  }
  const url = tab.url || '';
  if (!/https:\/\/(x|twitter)\.com\//.test(url)) {
    setStatus(t('status_open_x_page'));
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'X_ONEWAY_SCAN' });
    if (res?.ok) {
      const extra = res.bluePending != null
        ? t('status_scan_extra', [String(res.bluePending), String(res.oneWayOut)])
        : '';
      setStatus(t('status_scan_ok', [String(res.marked), String(res.checked)]) + extra);
    } else {
      setStatus(res?.error || t('status_scan_fail'));
    }
  } catch (err) {
    setStatus(t('status_scan_refresh'));
  }
});
