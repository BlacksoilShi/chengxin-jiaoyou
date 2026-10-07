(() => {
  const FOLLOWS_YOU_RE = /follows you|关注了你/i;
  const FOLLOW_RE = /^(follow|follow back|回关|关注)$/i;
  const CTRL_TAG = 'x-oneway-ix/ctrl';

  let scanTimer = null;
  let observer = null;
  let autoScan = true;
  let showInbound = true;
  let showOutbound = true;
  let showQuickFollow = true; // 1.7.0 时间线一键关注，默认开，popup 可关
  let inbound = {};
  let outbound = {};
  const followCache = new Map(); // sn → { following: bool|null, restId }
  const pendingFollow = new Set(); // 点击关注后、结果返回前，避免 rescan 重置按钮
  function showAnyIx() { return showInbound || showOutbound; }
  function showTweetExtras() { return showAnyIx() || showQuickFollow; }
  let activeAccount = '';
  let lastSyncAt = 0;
  let lastPath = location.pathname;
  let syncStartedForPath = '';

  function toast(msg, ms = 2200) {
    let el = document.querySelector('.x-oneway-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'x-oneway-toast';
      document.documentElement.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  function isNotificationsPage() {
    return /^\/notifications(\/(mentions|verified))?\/?$/.test(location.pathname);
  }

  function isListPage() {
    const path = location.pathname;
    return /\/(following|followers|verified_followers)\/?$/.test(path) ||
      /\/followers_you_follow\/?$/.test(path);
  }

  function isFollowersPage() {
    return /\/(followers|verified_followers)\/?$/.test(location.pathname);
  }

  function isFollowingPage() {
    return /\/following\/?$/.test(location.pathname);
  }

  function textOf(node) {
    return (node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function cellFollowsYou(cell) {
    if (isFollowersPage()) return true;
    const nodes = cell.querySelectorAll('span, div');
    for (const n of nodes) {
      const t = textOf(n);
      if (!t || t.length > 40) continue;
      if (FOLLOWS_YOU_RE.test(t)) return true;
    }
    return false;
  }

  function cellFollowingState(cell) {
    const buttons = cell.querySelectorAll('button, div[role="button"]');
    for (const btn of buttons) {
      const raw = textOf(btn);
      const aria = btn.getAttribute('aria-label') || '';
      const label = `${aria} ${raw}`;
      // 回关 / Follow back 优先视为未关注（可点回关）
      if (/follow back|回关/i.test(label)) return 'not-following';
      // 已关注态：精确匹配按钮文案，避免 Followings / following count 误伤
      if (
        /^(正在关注|已关注|Following|Unfollow|取消关注)$/i.test(raw) ||
        /^(正在关注|已关注|Following|Unfollow|取消关注)\b/i.test(aria) ||
        (/\bUnfollow\b|\b取消关注\b/i.test(label))
      ) {
        return 'following';
      }
      if (FOLLOW_RE.test(raw) || /\bfollow @|关注 @/i.test(label) || /^(关注|Follow)$/i.test(raw)) {
        return 'not-following';
      }
    }
    return 'unknown';
  }

  function cellIsBlueVerified(cell) {
    const icons = cell.querySelectorAll(
      '[data-testid="icon-verified"], svg[data-testid="icon-verified"], svg[aria-label*="Verified" i], svg[aria-label*="认证" i], svg[aria-label*="已认证" i]'
    );
    for (const icon of icons) {
      const svg = icon.tagName.toLowerCase() === 'svg' ? icon : icon.querySelector('svg') || icon;
      const aria = `${svg.getAttribute('aria-label') || ''} ${icon.getAttribute('aria-label') || ''}`;
      if (/government|政府|business|企业|组织|organization|gold|金牌/i.test(aria)) continue;

      let sawNonBlue = false;
      let sawBlue = false;
      for (const path of svg.querySelectorAll('path')) {
        const fill = (path.getAttribute('fill') || '').toLowerCase();
        if (!fill || fill === 'currentcolor' || fill === 'none') continue;
        if (
          fill.includes('e2b719') ||
          fill.includes('829aab') ||
          fill.includes('c2c2') ||
          fill.includes('00ba7c') ||
          fill.includes('f4bb') ||
          fill.includes('ffd4')
        ) {
          sawNonBlue = true;
          break;
        }
        if (fill.includes('1d9bf0') || fill === '#1d9bf0' || fill.includes('1d9bf')) {
          sawBlue = true;
        }
      }
      if (sawNonBlue) continue;
      if (sawBlue) return true;
      // 有认证图标但无明确蓝色填充：不假定为蓝 V（金/灰/政府等已在上方过滤）
      continue;
    }

    const name = cell.querySelector('[data-testid="User-Name"]');
    if (name) {
      for (const n of name.querySelectorAll('[aria-label]')) {
        const a = n.getAttribute('aria-label') || '';
        if (/verified|已认证|认证账号/i.test(a) && !/government|政府|business|企业|组织/i.test(a)) {
          return true;
        }
      }
    }
    return false;
  }

  function ensureBadge(cell, kind) {
    const existing = cell.querySelector('.x-oneway-badge');
    const text = kind === 'blue-pending' ? '蓝V待回关' : '未回关';
    const cls = kind === 'blue-pending' ? 'x-oneway-badge x-oneway-badge-blue' : 'x-oneway-badge';
    if (existing) {
      existing.className = cls;
      existing.textContent = text;
      return;
    }
    const badge = document.createElement('span');
    badge.className = cls;
    badge.textContent = text;
    const nameLine =
      cell.querySelector('[data-testid="User-Name"]') ||
      cell.querySelector('a[role="link"]') ||
      cell;
    nameLine.appendChild(badge);
  }

  function clearMark(cell) {
    if (!cell.classList.contains('x-oneway-highlight') &&
        !cell.classList.contains('x-oneway-highlight-blue') &&
        !cell.querySelector('.x-oneway-badge')) return;
    cell.classList.remove('x-oneway-highlight', 'x-oneway-highlight-blue');
    cell.querySelectorAll('.x-oneway-badge').forEach((n) => n.remove());
  }

  function mark(cell, kind) {
    const want = kind === 'blue-pending' ? 'x-oneway-highlight-blue' : 'x-oneway-highlight';
    const other = kind === 'blue-pending' ? 'x-oneway-highlight' : 'x-oneway-highlight-blue';
    const badge = cell.querySelector('.x-oneway-badge');
    const text = kind === 'blue-pending' ? '蓝V待回关' : '未回关';
    if (cell.classList.contains(want) && !cell.classList.contains(other) && badge && badge.textContent === text) return;
    clearMark(cell);
    cell.classList.add(want);
    ensureBadge(cell, kind === 'blue-pending' ? 'blue-pending' : 'out');
  }

  const RESERVED = new Set([
    'home', 'explore', 'notifications', 'messages', 'i', 'settings', 'search', 'compose',
    'following', 'followers', 'verified_followers', 'followers_you_follow', 'lists',
    'communities', 'premium', 'jobs', 'hashtag', 'tos', 'privacy', 'login', 'logout', 'signup'
  ]);

  function cellUsername(cell) {
    for (const a of cell.querySelectorAll('a[href^="/"]')) {
      const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
      if (m && !RESERVED.has(m[1].toLowerCase())) return m[1].toLowerCase();
    }
    return null;
  }

  function fmtDateTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const IN_PARTS = [
    ['replies', '评你的帖'],
    ['threadReplies', '回你的楼'],
    ['quotes', '引用你'],
    ['likes', '点赞你']
  ];
  const OUT_PARTS = [
    ['replies', '我回复'],
    ['likes', '我点赞'],
    ['retweets', '我转帖'],
    ['quotes', '我引用']
  ];

  function inTotal(rec) {
    if (!rec) return 0;
    return (rec.replies || 0) + (rec.threadReplies || 0) + (rec.quotes || 0) +
      (rec.likes || 0) + (rec.retweets || 0) + (rec.mentions || 0);
  }
  function outTotal(rec) {
    if (!rec) return 0;
    return (rec.replies || 0) + (rec.likes || 0) + (rec.retweets || 0) + (rec.quotes || 0);
  }
  const ixTotal = inTotal; // 自检沿用

  function ixTitle(user, inRec, outRec) {
    const lines = [];
    if (showInbound) {
      const n = inTotal(inRec);
      lines.push(`【被互动 ${n}】@${user} 对你`);
      if (n > 0) {
        lines.push('  ' + IN_PARTS.map(([f, l]) => `${l} ${inRec[f] || 0}`).join(' · '));
        const extra = [];
        if (inRec.retweets) extra.push(`转帖你 ${inRec.retweets}`);
        if (inRec.mentions) extra.push(`提及你 ${inRec.mentions}`);
        if (extra.length) lines.push('  ' + extra.join(' · '));
        lines.push(`  最近：${fmtDateTime(inRec.lastAt)}`);
      } else {
        lines.push('  暂无（进通知页温和同步 / 打开你的帖子累计）');
      }
    }
    if (showOutbound) {
      const n = outTotal(outRec);
      lines.push(`【我互动 ${n}】你对 @${user}`);
      if (n > 0) {
        lines.push('  ' + OUT_PARTS.map(([f, l]) => `${l} ${outRec[f] || 0}`).join(' · '));
        lines.push(`  最近：${fmtDateTime(outRec.lastAt)}`);
      } else {
        lines.push('  暂无（安装后你回复/点赞/转帖/引用会实时记；历史可在你的喜欢/回复页手动同步）');
      }
    }
    lines.push(`（账号 @${activeAccount || '?'} · 仅本机累计）`);
    return lines.join('\n');
  }

  // compact = 时间线（窄）；列表用长标签
  function ixView(user, compact) {
    if (!showInbound && !showOutbound) return null;
    const me = myHandle();
    if (me && user === me) return null; // 自己的行不标
    const inRec = inbound[user];
    const outRec = outbound[user];
    const inN = showInbound ? inTotal(inRec) : 0;
    const outN = showOutbound ? outTotal(outRec) : 0;
    const pills = [];
    if (inN === 0 && outN === 0) {
      let text;
      if (showInbound && showOutbound) text = compact ? '暂无' : '暂无互动';
      else text = showInbound ? '被·暂无' : '我·暂无';
      pills.push({ text, cls: 'x-oneway-ix x-oneway-ix-none' });
    } else {
      if (showInbound) {
        pills.push({
          text: compact ? `被 ${inN}` : `被互动 ${inN}`,
          cls: inN > 0 ? 'x-oneway-ix x-oneway-ix-in' : 'x-oneway-ix x-oneway-ix-in x-oneway-ix-zero'
        });
      }
      if (showOutbound) {
        pills.push({
          text: compact ? `我 ${outN}` : `我互动 ${outN}`,
          cls: outN > 0 ? 'x-oneway-ix x-oneway-ix-out' : 'x-oneway-ix x-oneway-ix-out x-oneway-ix-zero'
        });
      }
    }
    const title = ixTitle(user, inRec || {}, outRec || {});
    const sig = `${user}|${pills.map((p) => p.cls + ':' + p.text).join('|')}`;
    return { pills, title, sig };
  }

  function clearIxIn(root) {
    root.querySelectorAll('.x-oneway-ixwrap, .x-oneway-ix').forEach((n) => n.remove());
  }

  function findListIxAnchor(cell, user) {
    const nodes = cell.querySelectorAll('span, div');
    for (const n of nodes) {
      if (n.closest('.x-oneway-ixwrap, .x-oneway-badge')) continue;
      if (n.children.length > 0) continue;
      const t = textOf(n);
      if (t && t.length <= 20 && FOLLOWS_YOU_RE.test(t)) return { node: n, mode: 'after' };
    }
    if (user) {
      const re = new RegExp(`^/${user}/?$`, 'i');
      let fallback = null;
      for (const a of cell.querySelectorAll('a[href^="/"]')) {
        if (!re.test(a.getAttribute('href') || '')) continue;
        const t = textOf(a);
        if (t.startsWith('@') || t.toLowerCase() === user.toLowerCase()) {
          return { node: a, mode: 'after' };
        }
        if (!fallback) fallback = a;
      }
      if (fallback) return { node: fallback, mode: 'after' };
    }
    const un = cell.querySelector('[data-testid="User-Name"]');
    return { node: un || cell, mode: 'append' };
  }

  function placeIx(el, anchor) {
    if (anchor.mode === 'append') {
      if (el.parentNode !== anchor.node) anchor.node.appendChild(el);
      return;
    }
    const host = anchor.node.parentNode;
    if (!host) {
      anchor.node.appendChild?.(el);
      return;
    }
    if (el.parentNode !== host || el.previousSibling !== anchor.node) {
      host.insertBefore(el, anchor.node.nextSibling);
    }
  }

  function isFollowingCached(user) {
    const c = followCache.get(user);
    return !!(c && c.following === true);
  }

  // 1.7.1：不再整卡扫描页面按钮（"following" 子串等误判会把一键关注藏掉）。
  // 仅当关注状态明确为 true 时隐藏；unknown / false 都显示。
  function shouldShowQuickFollow(user) {
    return !!(showQuickFollow && user && !isFollowingCached(user));
  }

  function onFollowClick(btn, user) {
    if (!btn || !user) return;
    if (btn.dataset.busy === '1' || pendingFollow.has(user)) return;
    pendingFollow.add(user);
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.textContent = '…';
    const c = followCache.get(user);
    postCtrl({ cmd: 'follow-create', username: user, userId: (c && c.restId) || '' });
  }

  function renderIx(root, user, anchor, compact, opts = {}) {
    const wantFollow = !!opts.followBtn;
    const view = user ? ixView(user, compact) : null;
    if (!view && !wantFollow) { clearIxIn(root); return; }
    const followSig = wantFollow ? 'f1' : 'f0';
    const sig = `${view ? view.sig : 'noview'}|${followSig}`;
    let el = root.querySelector('.x-oneway-ixwrap');
    if (el && el.dataset.sig === sig && el.isConnected) {
      const placed = anchor.mode === 'append'
        ? el.parentNode === anchor.node
        : el.previousSibling === anchor.node;
      if (placed) {
        if (view) el.title = view.title;
        return;
      }
    }
    if (!el) {
      el = document.createElement('span');
      el.className = 'x-oneway-ixwrap';
    }
    if (el.dataset.sig !== sig) {
      el.textContent = '';
      if (wantFollow) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'x-oneway-follow-btn';
        if (pendingFollow.has(user)) {
          btn.textContent = '…';
          btn.disabled = true;
          btn.dataset.busy = '1';
        } else {
          btn.textContent = '关注';
        }
        btn.title = `关注 @${user}（诚信浇友 · 仅你点击时关注）`;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onFollowClick(btn, user);
        }, true);
        el.appendChild(btn);
      }
      if (view) {
        for (const p of view.pills) {
          const s = document.createElement('span');
          s.className = p.cls;
          s.textContent = p.text;
          el.appendChild(s);
        }
        el.title = view.title;
      } else {
        el.title = `关注 @${user}`;
      }
      el.dataset.sig = sig;
    } else if (view) {
      el.title = view.title;
    }
    el.dataset.user = user;
    placeIx(el, anchor);
    root.querySelectorAll('.x-oneway-ixwrap').forEach((n) => { if (n !== el) n.remove(); });
    root.querySelectorAll('.x-oneway-ix').forEach((n) => { if (!n.closest('.x-oneway-ixwrap')) n.remove(); });
  }

  function markIxList(cell) {
    if (!showAnyIx()) { clearIxIn(cell); return; }
    const user = cellUsername(cell);
    if (!user) { clearIxIn(cell); return; }
    renderIx(cell, user, findListIxAnchor(cell, user), false);
  }

  function tweetAuthorUserName(article) {
    return article.querySelector('[data-testid="User-Name"]');
  }

  function tweetUsername(article) {
    const un = tweetAuthorUserName(article);
    if (!un) return null;
    for (const a of un.querySelectorAll('a[href*="/status/"]')) {
      const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})\/status\/\d+/);
      if (m && !RESERVED.has(m[1].toLowerCase())) return m[1].toLowerCase();
    }
    for (const a of un.querySelectorAll('a[href^="/"]')) {
      const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
      if (m && !RESERVED.has(m[1].toLowerCase())) return m[1].toLowerCase();
    }
    return null;
  }

  function findTweetIxAnchor(userNameEl) {
    const time = userNameEl.querySelector('time');
    if (time) return { node: time.closest('a') || time, mode: 'after' };
    const statusLinks = userNameEl.querySelectorAll('a[href*="/status/"]');
    if (statusLinks.length) {
      return { node: statusLinks[statusLinks.length - 1], mode: 'after' };
    }
    return { node: userNameEl, mode: 'append' };
  }

  function markIxTweet(article) {
    const un = tweetAuthorUserName(article);
    if (!un) return;
    const user = tweetUsername(article);
    if (!user) { clearIxIn(un); return; }
    const me = myHandle();
    if (me && user === me) { clearIxIn(un); return; }
    // 时间线：仅「已确认关注」时不显示；未知/未关注都在「被/我」前插「关注」
    const followBtn = shouldShowQuickFollow(user);
    if (!showAnyIx() && !followBtn) { clearIxIn(un); return; }
    renderIx(un, user, findTweetIxAnchor(un), true, { followBtn });
  }

  function classify(cell) {
    const state = cellFollowingState(cell);
    const followsYou = cellFollowsYou(cell);
    const blue = cellIsBlueVerified(cell);

    if (isFollowersPage()) {
      if (blue && state === 'not-following') return 'blue-pending';
      if (blue && state === 'unknown') {
        const hasFollowBtn = Array.from(cell.querySelectorAll('button, div[role="button"]'))
          .some((b) => FOLLOW_RE.test(textOf(b)) || /follow @|关注 @/i.test(b.getAttribute('aria-label') || ''));
        if (hasFollowBtn) return 'blue-pending';
      }
      return null;
    }

    // 仅在明确「正在关注」且对方未回关时标「未回关」；unknown 不标，等按钮文案就绪
    if (state === 'following' && !followsYou) return 'out';
    return null;
  }

  function scan(reason = 'manual') {
    let checked = 0;
    let marked = 0;
    let bluePending = 0;
    let oneWayOut = 0;
    let ixList = 0;
    let ixTweet = 0;

    if (isListPage()) {
      document.querySelectorAll('[data-testid="UserCell"]').forEach((cell) => {
        checked += 1;
        markIxList(cell);
        ixList += 1;
        const kind = classify(cell);
        if (kind) {
          mark(cell, kind);
          marked += 1;
          if (kind === 'blue-pending') bluePending += 1;
          else oneWayOut += 1;
        } else {
          clearMark(cell);
        }
      });
    } else if (!showAnyIx()) {
      document.querySelectorAll('[data-testid="UserCell"] .x-oneway-ixwrap').forEach((n) => n.remove());
    }

    if (showTweetExtras()) {
      document.querySelectorAll('article[data-testid="tweet"]').forEach((article) => {
        markIxTweet(article);
        ixTweet += 1;
      });
    } else {
      document.querySelectorAll('article[data-testid="tweet"] .x-oneway-ixwrap, article[data-testid="tweet"] .x-oneway-ix').forEach((n) => n.remove());
      if (isListPage()) {
        document.querySelectorAll('[data-testid="UserCell"] .x-oneway-ixwrap, [data-testid="UserCell"] .x-oneway-ix').forEach((n) => n.remove());
      }
    }

    if (reason === 'manual') {
      if (isListPage() && isFollowersPage()) toast(`蓝V待回关 ${bluePending} / ${checked}`);
      else if (isListPage()) toast(`未回关 ${oneWayOut} / ${checked}`);
      else toast(`已标注帖子 ${ixTweet}`);
    }
    return {
      ok: true, checked, marked, bluePending, oneWayOut,
      ixList, ixTweet, reason, path: location.pathname
    };
  }

  function shouldAutoScan() {
    if (autoScan && isListPage()) return true;
    if (showTweetExtras()) return true;
    if (/\/status\/\d+\/?$/.test(location.pathname)) return true; // 单帖兜底扫描
    return false;
  }

  function scheduleScan() {
    if (!shouldAutoScan()) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan('auto'), 350);
    scheduleThreadScan();
  }

  function isOwnUiNode(node) {
    if (!node || node.nodeType !== 1 || !node.classList) return false;
    return node.classList.contains('x-oneway-badge') ||
      node.classList.contains('x-oneway-ixwrap') ||
      node.classList.contains('x-oneway-ix') ||
      node.classList.contains('x-oneway-follow-btn') ||
      node.classList.contains('x-oneway-toast') ||
      node.classList.contains('x-oneway-highlight') ||
      node.classList.contains('x-oneway-highlight-blue');
  }

  function mutationNodeRelevant(node) {
    if (!node || node.nodeType !== 1) return false;
    if (isOwnUiNode(node)) return false;
    if (node.matches?.('[data-testid="UserCell"], article[data-testid="tweet"], [data-testid="User-Name"]')) {
      return true;
    }
    if (node.querySelector?.('[data-testid="UserCell"], article[data-testid="tweet"], [data-testid="User-Name"]')) {
      return true;
    }
    // 关注按钮文案等在 UserCell/tweet 内局部变动
    if (node.closest?.('[data-testid="UserCell"], article[data-testid="tweet"], [data-testid="User-Name"]')) {
      return true;
    }
    return false;
  }

  function mutationsRelevant(mutations) {
    for (const m of mutations) {
      if (m.type !== 'childList') continue;
      for (const node of m.addedNodes) {
        if (mutationNodeRelevant(node)) return true;
      }
      for (const node of m.removedNodes) {
        if (mutationNodeRelevant(node)) return true;
      }
      if (mutationNodeRelevant(m.target)) return true;
    }
    return false;
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
      if (!mutationsRelevant(mutations)) return;
      scheduleScan();
    });
    const root = document.body || document.documentElement;
    observer.observe(root, { childList: true, subtree: true });
  }

  function rescanSoon() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan('auto'), 200);
  }


  // ---- 单帖页兜底：打开「你自己的帖子」时，扫描页面上回复你的作者（不打任何 API）----
  // 主通路是 inject.js 被动解析 TweetDetail 响应（精确判断 in_reply_to = 你）；
  // 只有该页没捕获到 TweetDetail 时才用 DOM 兜底，且只认「直接回复焦点帖」的条目。
  const DETAIL_TAG = 'x-oneway-ix/detail';
  const detailSeenPaths = new Set();
  const threadSent = new Set();
  let threadTimer = null;

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const d = ev.data;
    if (d && d.__tag === DETAIL_TAG && typeof d.path === 'string') detailSeenPaths.add(d.path);
  });

  function myHandle() {
    const a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    const m = (a?.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
    return m ? m[1].toLowerCase() : (activeAccount || '');
  }

  function threadPageInfo() {
    const m = location.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
    return m ? { author: m[1].toLowerCase(), id: m[2] } : null;
  }

  function articleStatus(article) {
    const un = tweetAuthorUserName(article);
    const t = un && un.querySelector('time');
    const a = t && t.closest('a[href*="/status/"]');
    const m = (a?.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
    return m ? { user: m[1].toLowerCase(), id: m[2] } : null;
  }

  function isFocalArticle(article, page) {
    for (const a of article.querySelectorAll('a[href*="/status/"]')) {
      const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
      if (m && m[2] === page.id && m[1].toLowerCase() === page.author && a.querySelector('time')) return true;
    }
    return false;
  }

  function replyingToHandles(article) {
    for (const n of article.querySelectorAll('div')) {
      if (n.closest('[data-testid="tweetText"]')) continue;
      const t = textOf(n);
      if (t.length > 160 || !/^(Replying to|回复|回覆)\s*@/i.test(t)) continue;
      const hs = [];
      for (const a of n.querySelectorAll('a[href^="/"]')) {
        const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
        if (m) hs.push(m[1].toLowerCase());
      }
      return hs;
    }
    return null;
  }

  function idGreater(a, b) {
    try { return BigInt(a) > BigInt(b); } catch (_) { return a.length > b.length || (a.length === b.length && a > b); }
  }

  function scanThreadReplies() {
    const page = threadPageInfo();
    if (!page) return;
    const me = myHandle();
    if (!me || page.author !== me) return; // 只看你自己的帖
    if (detailSeenPaths.has(location.pathname)) return; // 已由 TweetDetail 精确解析
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const focalIdx = articles.findIndex((a) => isFocalArticle(a, page));
    if (focalIdx < 0) return;
    // 焦点帖本身是不是回复：上方有祖先帖，且直接上级不是你自己 → 你的楼（回你的楼）
    let action = 'reply';
    if (focalIdx > 0) {
      const parent = articleStatus(articles[focalIdx - 1]);
      if (parent && parent.user !== me) action = 'thread_reply';
    }
    const cells = Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"]'));
    let cutoff = null; // 「发现更多」推荐区之后全部忽略
    for (const c of cells) {
      if (c.querySelector('article')) continue;
      if (/^(Discover more|More posts|发现更多|更多帖子|探索更多)/i.test(textOf(c))) { cutoff = c; break; }
    }
    let prevWasFocalOrBreak = true;
    let prevCell = articles[focalIdx].closest('[data-testid="cellInnerDiv"]');
    let sent = 0;
    for (let i = focalIdx + 1; i < articles.length && sent < 60; i++) {
      const art = articles[i];
      if (cutoff && (cutoff.compareDocumentPosition(art) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      const cell = art.closest('[data-testid="cellInnerDiv"]');
      // 两条回复之间夹着无帖子的分隔 cell → 新一组对话；否则是上一条的楼中楼（不是直接回你）
      let gap = false;
      if (prevCell && cell) {
        let n = prevCell.nextElementSibling;
        while (n && n !== cell) {
          if (!n.querySelector('article')) { gap = true; break; }
          n = n.nextElementSibling;
        }
      }
      const directGroupStart = prevWasFocalOrBreak || gap;
      prevCell = cell;
      prevWasFocalOrBreak = false;
      const st = articleStatus(art);
      if (!st || st.user === me || RESERVED.has(st.user)) continue;
      if (!idGreater(st.id, page.id)) continue;
      const rt = replyingToHandles(art);
      const toMe = rt ? rt.includes(me) && rt[0] === me : directGroupStart;
      if (!toMe) continue;
      const key = `tw:${st.id}:${st.user}`;
      if (threadSent.has(key)) continue;
      threadSent.add(key);
      sent += 1;
      try {
        chrome.runtime.sendMessage({ type: 'X_ONEWAY_IX', action, username: st.user, notifId: key }).catch(() => {});
      } catch (_) {}
    }
  }

  function scheduleThreadScan() {
    if (!threadPageInfo()) return;
    if (threadTimer) return; // 节流而非防抖：X 页面持续变动时也能按时触发
    // 给 TweetDetail 被动解析留时间，之后才兜底
    threadTimer = setTimeout(() => { threadTimer = null; scanThreadReplies(); }, 2500);
  }

  // ---- auto sync control ----
  // 只走 postMessage → inject（MAIN）。勿再 dispatchEvent：bridge 会二次转发导致 follow/sync 执行两遍
  function postCtrl(detail) {
    try {
      window.postMessage({ __tag: CTRL_TAG, ...detail }, location.origin);
    } catch (_) {}
  }

  function loadAccountMeta(cb) {
    chrome.storage.local.get({ activeAccount: '', accounts: {} }, (res) => {
      activeAccount = (res.activeAccount || '').toLowerCase();
      const acc = (activeAccount && res.accounts && res.accounts[activeAccount]) ||
        (res.accounts && res.accounts._pending) || null;
      if (acc) {
        inbound = acc.inbound || acc.interactions || {};
        outbound = acc.outbound || {};
        lastSyncAt = acc.lastSyncAt || 0;
      } else {
        inbound = {};
        outbound = {};
        lastSyncAt = 0;
      }
      if (typeof cb === 'function') cb();
    });
  }

  function maybeStartSync(force) {
    if (!isNotificationsPage()) return;
    if (!force && syncStartedForPath === location.pathname) return;
    syncStartedForPath = location.pathname;
    // slight delay so page fires first request → we capture auth/queryId
    // 启动延迟 2–3 秒：先让页面自己发出通知请求（便于抄 queryId），也避免一进页就并发
    setTimeout(() => {
      if (!isNotificationsPage()) return;
      postCtrl({
        cmd: 'sync-start',
        force: !!force,
        lastSyncAt: force ? 0 : lastSyncAt
      });
    }, 2000 + Math.floor(Math.random() * 1000));
  }

  function stopSync() {
    postCtrl({ cmd: 'sync-stop' });
    syncStartedForPath = '';
  }

  // ---- notifications DOM self-check: visible reply authors vs storage ----
  let lastSelfCheckAt = 0;
  function selfCheckNotifDom() {
    if (!isNotificationsPage()) return;
    const now = Date.now();
    if (now - lastSelfCheckAt < 25000) return;
    lastSelfCheckAt = now;

    const authors = new Set();
    // Tweet-like cells on notifications (replies / quotes shown as tweets)
    document.querySelectorAll('article[data-testid="tweet"], div[data-testid="notification"]').forEach((node) => {
      // reply/quote authors from User-Name
      const un = node.querySelector('[data-testid="User-Name"]');
      if (un) {
        for (const a of un.querySelectorAll('a[href^="/"]')) {
          const href = a.getAttribute('href') || '';
          const m = href.match(/^\/([A-Za-z0-9_]{1,15})(?:\/status\/\d+)?\/?$/);
          if (m && !RESERVED.has(m[1].toLowerCase())) {
            authors.add(m[1].toLowerCase());
            break;
          }
        }
      }
    });
    // Also scan notification text rows for @handles near 回复/引用
    document.querySelectorAll('[data-testid="notification"]').forEach((node) => {
      const t = textOf(node);
      if (!/回复|评论|引用|replied|quoted|liked|赞了|点赞/i.test(t)) return;
      for (const a of node.querySelectorAll('a[href^="/"]')) {
        const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
        if (m && !RESERVED.has(m[1].toLowerCase())) authors.add(m[1].toLowerCase());
      }
    });

    if (authors.size === 0) return;
    let hit = 0;
    let miss = 0;
    const missing = [];
    for (const u of authors) {
      const rec = inbound[u];
      const has = ixTotal(rec) > 0;
      if (has) hit += 1;
      else {
        miss += 1;
        if (missing.length < 5) missing.push(u);
      }
    }
    if (miss > 0) {
      toast(`自检：DOM 可见 ${authors.size} 人 · 库中有 ${hit} · 缺 ${miss}${missing.length ? '（如 @' + missing.join(' @') + '）' : ''}`, 4500);
    } else if (hit > 0) {
      toast(`自检：本页可见 ${hit} 人互动均已入库`, 2800);
    }
  }

  chrome.storage.sync.get({ autoScan: true, showInteractions: true, showInbound: null, showOutbound: null, showQuickFollow: true }, (cfg) => {
    autoScan = !!cfg.autoScan;
    // 1.5.x 只有 showInteractions：未设置新开关时沿用旧值
    showInbound = cfg.showInbound == null ? !!cfg.showInteractions : !!cfg.showInbound;
    showOutbound = cfg.showOutbound == null ? !!cfg.showInteractions : !!cfg.showOutbound;
    showQuickFollow = cfg.showQuickFollow !== false;
    if (shouldAutoScan()) scheduleScan();
  });

  loadAccountMeta(() => {
    chrome.storage.local.get({ migratedToast: false }, (res) => {
      if (res.migratedToast) {
        toast('已升级：分「被互动 / 我互动」两块；时间线可一键关注（popup 可关）');
        try { chrome.runtime.sendMessage({ type: 'X_ONEWAY_IX_MIGRATED_ACK' }).catch(() => {}); } catch (_) {}
      }
      if (shouldAutoScan()) scheduleScan();
      if (isNotificationsPage()) maybeStartSync(false);
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.autoScan) {
        autoScan = !!changes.autoScan.newValue;
        if (shouldAutoScan()) scheduleScan();
      }
      if (changes.showInbound) {
        showInbound = !!changes.showInbound.newValue;
        rescanSoon();
      }
      if (changes.showOutbound) {
        showOutbound = !!changes.showOutbound.newValue;
        rescanSoon();
      }
      if (changes.showQuickFollow) {
        showQuickFollow = changes.showQuickFollow.newValue !== false;
        rescanSoon();
      }
    }
    if (area === 'local') {
      if (changes.accounts || changes.activeAccount) {
        loadAccountMeta(() => rescanSoon());
      }
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'X_ONEWAY_SCAN') {
      sendResponse(scan('manual'));
      return true;
    }
    if (msg?.type === 'X_ONEWAY_SYNC_NOW') {
      if (!isNotificationsPage()) {
        sendResponse({ ok: false, error: '请先打开 x.com/notifications' });
        toast('请先打开通知页再同步');
        return true;
      }
      syncStartedForPath = '';
      maybeStartSync(true);
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === 'X_ONEWAY_OX_SYNC_NOW') {
      const me = myHandle();
      const m = location.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/(likes|with_replies)\/?$/);
      if (!me || !m || m[1].toLowerCase() !== me) {
        sendResponse({ ok: false, error: `请先打开 x.com/${me || '你的账号'}/likes 或 /with_replies` });
        toast('请先打开你自己的「喜欢」或「回复」页再同步我的互动', 3200);
        return true;
      }
      setTimeout(() => postCtrl({ cmd: 'ox-sync-start' }), 1200 + Math.floor(Math.random() * 800));
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  setInterval(() => {
    if (location.pathname !== lastPath) {
      const prev = lastPath;
      lastPath = location.pathname;
      scheduleScan();
      if (isNotificationsPage()) {
        maybeStartSync(false);
      } else if (/^\/notifications/.test(prev)) {
        stopSync();
      }
      if (/\/(likes|with_replies)\/?$/.test(prev)) postCtrl({ cmd: 'ox-sync-stop' });
    }
  }, 800);

  // parse batch toast
  let lastToastAt = 0;
  let sessionParsed = 0;
  window.addEventListener('x-oneway-ix-debug', (ev) => {
    const d = ev.detail || {};
    if (!isNotificationsPage()) return;
    if (d.toast === false) return; // 同步状态事件由 x-oneway-ix-sync 负责 toast
    if (d.sync && d.sync.kind === 'progress') return; // 同步中由「温和同步中…第 n 页」toast 负责
    const st = d.lastStats || {};
    const parsed = Number(d.lastEvents) || 0;
    const skipped = (st.skipNoNode || 0) + (st.skipNoAction || 0) + (st.skipNoActor || 0);
    sessionParsed += parsed;
    const now = Date.now();
    if (now - lastToastAt < 1800) return;
    lastToastAt = now;
    const by = st.byAction || d.byAction || {};
    const parts = [];
    if (by.reply) parts.push(`评帖${by.reply}`);
    if (by.thread_reply) parts.push(`回楼${by.thread_reply}`);
    if (by.quote) parts.push(`引${by.quote}`);
    if (by.like) parts.push(`赞${by.like}`);
    if (by.retweet) parts.push(`转${by.retweet}`);
    if (by.mention) parts.push(`提${by.mention}`);
    const mix = parts.length ? ` [${parts.join(' ')}]` : '';
    const op = d.lastOp ? ` · ${d.lastOp}` : '';
    if (parsed > 0 || skipped > 0 || st.instrArrays > 0 || st.rest) {
      toast(`通知：本批 ${parsed} 条${mix} · 跳过 ${skipped}（累计 ${sessionParsed}）${op}`, 3200);
    } else if (d.lastOp) {
      toast(`通知：捕获 ${d.lastOp}，未解析出评/赞/引（instr=${st.instrArrays || 0}）`, 3200);
    }
  });

  window.addEventListener('x-oneway-follow', (ev) => {
    const d = ev.detail || {};
    if (d.kind === 'state' && d.username) {
      const sn = String(d.username).toLowerCase();
      const prev = followCache.get(sn) || {};
      followCache.set(sn, {
        following: typeof d.following === 'boolean' ? d.following : prev.following,
        restId: d.restId || prev.restId || ''
      });
      rescanSoon();
      return;
    }
    if (d.kind === 'dump' && d.users && typeof d.users === 'object') {
      for (const [sn, c] of Object.entries(d.users)) {
        followCache.set(String(sn).toLowerCase(), {
          following: c && typeof c.following === 'boolean' ? c.following : null,
          restId: (c && c.restId) || ''
        });
      }
      rescanSoon();
      return;
    }
    if (d.kind === 'result' && d.username) {
      const sn = String(d.username).toLowerCase();
      pendingFollow.delete(sn);
      const wraps = document.querySelectorAll(`.x-oneway-ixwrap[data-user="${sn}"]`);
      for (const wrap of wraps) {
        const btn = wrap.querySelector('.x-oneway-follow-btn');
        if (!btn) continue;
        if (d.ok && d.following) {
          btn.textContent = '已关注';
          btn.classList.add('done');
          btn.disabled = true;
          followCache.set(sn, { following: true, restId: (followCache.get(sn) || {}).restId || '' });
          setTimeout(() => rescanSoon(), 600);
        } else {
          btn.dataset.busy = '0';
          btn.disabled = false;
          btn.textContent = '关注';
          toast(d.detail || '关注失败', 3200);
        }
      }
      if (d.ok) toast(d.detail || '关注成功', 1800);
      else if (!wraps.length) toast(d.detail || '关注失败', 3200);
    }
  });

  window.addEventListener('x-oneway-ix-sync', (ev) => {
    const d = ev.detail || {};
    if (d.scope === 'outbound') {
      if (d.kind === 'start') toast('同步我的互动中…（约 3 秒/页，最多 10 页，别切走）', 3000);
      else if (d.kind === 'progress') toast(`同步我的互动…第 ${d.pages} 页 · 识别 ${d.events}`, 3600);
      else if (d.kind === 'done') { toast(d.detail || '我互动同步完成', 4500); loadAccountMeta(() => rescanSoon()); }
      else if (d.kind === 'error') toast(`我互动同步停止：${d.detail || '未知错误'}`, 4500);
      else if (d.kind === 'skip') toast(d.detail || '已跳过', 3600);
      return;
    }
    if (d.kind === 'start') {
      toast('温和同步中…（约 3 秒/页，最多 15 页）', 2600);
    } else if (d.kind === 'progress') {
      toast(`温和同步中…第 ${d.pages} 页 · 事件 ${d.events}`, 3600);
    } else if (d.kind === 'done' || d.kind === 'capped' || d.kind === 'empty') {
      toast(d.detail || `温和同步完成 ${d.pages || 0} 页 / ${d.events || 0} 条`, 4500);
      loadAccountMeta(() => {
        rescanSoon();
        setTimeout(selfCheckNotifDom, 1500);
      });
    } else if (d.kind === 'error') {
      toast(`温和同步停止：${d.detail || '未知错误'}`, 4500);
    } else if (d.kind === 'skip') {
      toast(d.detail || '已跳过同步', 3200);
    }
  });

  // periodic self-check while on notif page
  setInterval(() => {
    if (isNotificationsPage()) selfCheckNotifDom();
  }, 30000);

  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  scheduleScan();
})();
