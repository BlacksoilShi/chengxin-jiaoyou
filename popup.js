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
      const who = res.activeAccount ? `@${res.activeAccount}` : '未识别';
      const sync = res.lastSyncAt ? fmtTime(res.lastSyncAt) : '尚未';
      const osync = res.lastOutboundSyncAt ? fmtTime(res.lastOutboundSyncAt) : '尚未';
      acctBox.innerHTML = `当前账号 <b>${who}</b><br/>被互动 <b>${res.tracked || 0}</b> 人 · 通知同步 ${sync}<br/>我互动 <b>${res.trackedOut || 0}</b> 人 · 手动同步 ${osync}`;
      return;
    }
  } catch (_) {}
  chrome.storage.local.get({ activeAccount: '', accounts: {} }, (r) => {
    const key = r.activeAccount || '';
    const acc = (key && r.accounts && r.accounts[key]) || null;
    const n = acc ? Object.keys(acc.inbound || acc.interactions || {}).length : 0;
    const o = acc ? Object.keys(acc.outbound || {}).length : 0;
    acctBox.innerHTML = `当前账号 <b>${key ? '@' + key : '未识别'}</b><br/>被互动 <b>${n}</b> 人 · 我互动 <b>${o}</b> 人`;
  });
}
refreshAccount();

const ACTION_ZH = { reply: '评你的帖', thread_reply: '回你的楼', like: '点赞你', quote: '引用你', retweet: '转帖你', mention: '提及你' };
const ACTION_CLS = { reply: 'tag-reply', like: 'tag-like', quote: 'tag-quote' };

function renderDebug(d) {
  if (!d) {
    dbgBox.textContent = '捕获状态：无。请打开通知页（会温和同步），或打开你自己的帖子。';
    return;
  }
  const lines = [];
  lines.push(`最近操作：${d.lastOp || '-'} @ ${fmtClock(d.lastAt)}`);
  lines.push(`被互动：本批 ${d.lastEvents ?? 0} · 写入 ${d.recordOk ?? 0} · 去重 ${d.recordDup ?? 0} · 失败 ${d.recordFail ?? 0}`);
  lines.push(`我互动：写入 ${d.outOk ?? 0} · 去重 ${d.outDup ?? 0} · 失败 ${d.outFail ?? 0}`);
  const bo = d.byOutbound || {};
  if (bo.reply || bo.like || bo.retweet || bo.quote) {
    lines.push(`本次我互动转发：我回复 ${bo.reply || 0} · 我点赞 ${bo.like || 0} · 我转帖 ${bo.retweet || 0} · 我引用 ${bo.quote || 0}`);
  }
  if (d.oxSync) {
    lines.push(`我互动同步：${d.oxSync.status || d.oxSync.kind || '-'} · ${d.oxSync.pages || 0} 页 / ${d.oxSync.events || 0} 条`);
    if (d.oxSync.detail) lines.push(`  ${d.oxSync.detail}`);
  }
  const by = d.byAction || (d.lastStats && d.lastStats.byAction) || {};
  if (by && (by.reply || by.thread_reply || by.like || by.quote || by.retweet || by.mention)) {
    lines.push(`本次转发：评你的帖 ${by.reply || 0} · 回你的楼 ${by.thread_reply || 0} · 引用你 ${by.quote || 0} · 点赞你 ${by.like || 0}` +
      ((by.retweet || by.mention) ? ` · 转帖 ${by.retweet || 0} · 提及 ${by.mention || 0}` : ''));
  }
  const st = d.lastStats || {};
  if (st && typeof st === 'object') {
    lines.push(`条目：notif ${st.seenNotifEntries || 0} / tweet ${st.seenTweetEntries || 0} · instr ${st.instrArrays || 0}${st.rest ? ' · REST' : ''}`);
    lines.push(`跳过：无节点 ${st.skipNoNode || 0} · 无类型 ${st.skipNoAction || 0} · 无用户 ${st.skipNoActor || 0} · 自己 ${st.skipSelf || 0}`);
    if (st.lastSkipReason) lines.push(`最近跳过：${st.lastSkipReason}`);
    if (Array.isArray(st.unknownIcons) && st.unknownIcons.length) {
      lines.push('未知 icon 样例：');
      for (const u of st.unknownIcons.slice(0, 4)) {
        lines.push(`  · icon=${u.icon || '?'} text=${(u.text || '').slice(0, 40)}`);
      }
    }
  }
  const tot = d.totals || {};
  if (tot.forwarded != null) {
    lines.push(`桥接转发 ${tot.forwarded || 0} · 限流 ${tot.rateLimited || 0} · 无效 ${tot.invalid || 0}`);
  }
  if (d.sync) {
    lines.push(`同步：${d.sync.status || d.sync.kind || '-'} · ${d.sync.pages || 0} 页 / ${d.sync.events || 0} 事件`);
    if (d.sync.detail) lines.push(`  ${d.sync.detail}`);
  }
  const recent = Array.isArray(d.recent) ? d.recent.slice(0, 10) : [];
  if (recent.length) {
    lines.push('最近捕获（可对照通知页）：');
    for (const r of recent) {
      const label = r.actionLabel || ACTION_ZH[r.action] || r.action;
      lines.push(`  · [${label}] @${r.username} (${r.stage || '?'}${r.source ? '/' + r.source : ''})`);
    }
  } else {
    lines.push('最近捕获：无');
  }

  // colorize action tags in HTML
  let html = lines.map((l, i) => {
    let s = l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.replace(/\[评你的帖\]/g, '<span class="tag-reply">[评你的帖]</span>')
      .replace(/\[回你的楼\]/g, '<span class="tag-thread">[回你的楼]</span>')
      .replace(/\[点赞你\]/g, '<span class="tag-like">[点赞你]</span>')
      .replace(/\[引用你\]/g, '<span class="tag-quote">[引用你]</span>')
      .replace(/\[(我回复|我点赞|我转帖|我引用)\]/g, '<span class="tag-out">[$1]</span>');
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
  setStatus('已刷新捕获状态');
});

const syncBtn = document.getElementById('syncNow');
let syncArmed = false;
syncBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus('没有活动标签页');
    return;
  }
  const url = tab.url || '';
  if (!/https:\/\/(x|twitter)\.com\//.test(url)) {
    setStatus('请先打开 x.com');
    return;
  }
  if (!/\/notifications/.test(url)) {
    setStatus('请先打开通知页 /notifications');
    return;
  }
  if (!syncArmed) {
    syncArmed = true;
    syncBtn.textContent = '确认温和同步？约 3 秒/页、最多 15 页（再点一次）';
    setTimeout(() => { syncArmed = false; syncBtn.textContent = '温和同步通知（较慢）'; }, 5000);
    return;
  }
  syncArmed = false;
  syncBtn.textContent = '温和同步通知（较慢）';
  setStatus('请求温和同步…');
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'X_ONEWAY_SYNC_NOW' });
    if (res?.ok) setStatus('已触发温和同步（2 秒后开始），看页面右下角 toast');
    else setStatus(res?.error || '同步失败');
  } catch (_) {
    setStatus('请刷新通知页后再点同步');
  }
});

const oxBtn = document.getElementById('oxSyncNow');
const OX_BTN_TEXT = '同步我的互动（手动·较慢）';
let oxArmed = false;
oxBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  if (!tab?.id || !/https:\/\/(x|twitter)\.com\//.test(url)) { setStatus('请先打开 x.com'); return; }
  if (!/\/[A-Za-z0-9_]{1,15}\/(likes|with_replies)\/?(\?|#|$)/.test(url)) {
    setStatus('请先打开你自己的「喜欢」(/likes) 或「回复」(/with_replies) 页');
    return;
  }
  if (!oxArmed) {
    oxArmed = true;
    oxBtn.textContent = '确认？约 3 秒/页、最多 10 页（再点一次）';
    setTimeout(() => { oxArmed = false; oxBtn.textContent = OX_BTN_TEXT; }, 5000);
    return;
  }
  oxArmed = false;
  oxBtn.textContent = OX_BTN_TEXT;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'X_ONEWAY_OX_SYNC_NOW' });
    if (res?.ok) setStatus('已触发我互动同步，看页面右下角 toast（别切走）');
    else setStatus(res?.error || '同步失败');
  } catch (_) {
    setStatus('请刷新该页后再点');
  }
});

const clearBtn = document.getElementById('clearIx');
let clearArmed = false;
clearBtn.addEventListener('click', async () => {
  if (!clearArmed) {
    clearArmed = true;
    clearBtn.textContent = '再点一次确认清空本账号（不清其他号）';
    setTimeout(() => { clearArmed = false; clearBtn.textContent = '清空本账号互动数据（被+我）'; }, 4000);
    return;
  }
  clearArmed = false;
  clearBtn.textContent = '清空本账号互动数据（被+我）';
  try {
    await chrome.runtime.sendMessage({ type: 'X_ONEWAY_IX_CLEAR' });
  } catch (_) {}
  refreshAccount();
  refreshDebug();
  setStatus('本账号互动数据已清空');
});

document.getElementById('scan').addEventListener('click', async () => {
  setStatus('扫描中…');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus('没有活动标签页');
    return;
  }
  const url = tab.url || '';
  if (!/https:\/\/(x|twitter)\.com\//.test(url)) {
    setStatus('请先打开 x.com 页面');
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'X_ONEWAY_SCAN' });
    if (res?.ok) {
      const extra = res.bluePending != null
        ? `（蓝V待回关 ${res.bluePending}，未回关 ${res.oneWayOut}）`
        : '';
      setStatus(`本页标记 ${res.marked} / 检查 ${res.checked}${extra}`);
    } else {
      setStatus(res?.error || '扫描失败，请刷新页面后重试');
    }
  } catch (err) {
    setStatus('请刷新 x.com 后再点扫描');
  }
});
