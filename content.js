(() => {
  const FOLLOWS_YOU_RE = /follows you|关注了你/i;
  const FOLLOW_RE = /^(follow|follow back|回关|关注)$/i;
  const CTRL_TAG = 'x-oneway-ix/ctrl';

  // 中文兜底：getMessage 失败或带 substitutions 在部分 Chromium/Edge 返回 "" 时不露出原始 key
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
        // 优先官方带参替换；部分 Edge/Chrome 会返回 ""
        const withSub = chrome.i18n.getMessage(key, substitutions);
        if (withSub && subsLanded(withSub, substitutions)) return withSub;
        // 勿先裸取：无参 getMessage 会把未提供的 $1 吃成空，只剩「被」「我」
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


  // MAIN-world inject 无 chrome.i18n：把 UI 文案包经 postMessage 下发
  const INJECT_I18N_KEYS = [
    'inj_follow_too_fast', 'inj_follow_rate', 'inj_bad_user', 'inj_follow_self',
    'inj_already_following', 'inj_no_auth', 'inj_rate_429', 'inj_relogin',
    'inj_follow_ok', 'inj_follow_fail_status', 'inj_ox_busy', 'inj_ox_need_page',
    'inj_ox_cooldown', 'inj_ox_no_tpl', 'inj_ox_no_headers', 'inj_ox_left',
    'inj_ox_done_detail', 'inj_err_429', 'inj_err_auth', 'inj_err_pull',
    'inj_sync_busy', 'inj_sync_notif_only', 'inj_sync_cd_auto', 'inj_sync_cd_manual',
    'inj_sync_left_cancel', 'inj_sync_no_headers', 'inj_sync_aborted',
    'inj_sync_capped', 'inj_sync_done', 'inj_sync_empty', 'toast_ox_done'
  ];
  function buildI18nPack() {
    const pack = {};
    for (const k of INJECT_I18N_KEYS) pack[k] = t(k);
    return pack;
  }

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

  function isNonBlueBadgeColor(cssColor) {
    const m = String(cssColor || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!m) return false;
    const r = +m[1], g = +m[2], b = +m[3];
    // 金 / 黄
    if (r > 180 && g > 140 && b < 120) return true;
    // 绿（企业等）
    if (g > 150 && r < 100 && b < 150) return true;
    // 灰
    if (Math.abs(r - g) < 25 && Math.abs(g - b) < 25 && r >= 100 && r <= 190) return true;
    return false;
  }

  function isBlueBadgeColor(cssColor) {
    const s = String(cssColor || '').toLowerCase().replace(/\s+/g, '');
    if (s.includes('1d9bf0') || s.includes('rgb(29,155,240)')) return true;
    const m = String(cssColor || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!m) return false;
    const r = +m[1], g = +m[2], b = +m[3];
    // X 蓝勾常见 rgb(29,155,240)；放宽一点兼容主题
    return b >= 180 && b > r && g >= 100 && g <= 210;
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

      // X 官方蓝勾多数 path 用 fill=currentColor，蓝色在 CSS color 上；
      // 1.7.2 要求「显式蓝填充」会漏掉这类图标。用计算色排除金/灰/绿后仍按蓝 V。
      try {
        const color = getComputedStyle(svg).color || '';
        if (isNonBlueBadgeColor(color)) continue;
        if (isBlueBadgeColor(color)) return true;
      } catch (_) {}
      return true;
    }

    // 兜底：不限 User-Name（部分 UserCell 结构差异）；放宽中文「认证」匹配
    for (const n of cell.querySelectorAll('[aria-label]')) {
      const a = n.getAttribute('aria-label') || '';
      if (
        /verified|已认证|认证账号|认证/i.test(a) &&
        !/government|政府|business|企业|组织|organization|gold|金牌/i.test(a)
      ) {
        return true;
      }
    }
    return false;
  }

  function ensureBadge(cell, kind) {
    const existing = cell.querySelector('.x-oneway-badge');
    const text = kind === 'blue-pending' ? t('badge_blue') : t('badge_oneway');
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
    const text = kind === 'blue-pending' ? t('badge_blue') : t('badge_oneway');
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

  function IN_PARTS() {
    return [
      ['replies', t('act_reply')],
      ['threadReplies', t('act_thread_reply')],
      ['quotes', t('act_quote')],
      ['likes', t('act_like')]
    ];
  }
  function OUT_PARTS() {
    return [
      ['replies', t('act_out_reply')],
      ['likes', t('act_out_like')],
      ['retweets', t('act_out_retweet')],
      ['quotes', t('act_out_quote')]
    ];
  }

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
      lines.push(t('tip_in_header', [String(n), user]));
      if (n > 0) {
        lines.push('  ' + IN_PARTS().map(([f, l]) => t('tip_part', [l, String(inRec[f] || 0)])).join(' · '));
        const extra = [];
        if (inRec.retweets) extra.push(t('tip_retweet_you', [String(inRec.retweets)]));
        if (inRec.mentions) extra.push(t('tip_mention_you', [String(inRec.mentions)]));
        if (extra.length) lines.push('  ' + extra.join(' · '));
        lines.push('  ' + t('tip_recent', [fmtDateTime(inRec.lastAt)]));
      } else {
        lines.push(t('tip_in_empty'));
      }
    }
    if (showOutbound) {
      const n = outTotal(outRec);
      lines.push(t('tip_out_header', [String(n), user]));
      if (n > 0) {
        lines.push('  ' + OUT_PARTS().map(([f, l]) => t('tip_part', [l, String(outRec[f] || 0)])).join(' · '));
        lines.push('  ' + t('tip_recent', [fmtDateTime(outRec.lastAt)]));
      } else {
        lines.push(t('tip_out_empty'));
      }
    }
    lines.push(t('tip_account', [activeAccount || '?']));
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
      if (showInbound && showOutbound) text = compact ? t('pill_none_short') : t('pill_none');
      else text = showInbound ? t('pill_in_none') : t('pill_out_none');
      pills.push({ text, cls: 'x-oneway-ix x-oneway-ix-none' });
    } else {
      if (showInbound) {
        pills.push({
          text: compact ? t('pill_in_short', [String(inN)]) : t('pill_in', [String(inN)]),
          cls: inN > 0 ? 'x-oneway-ix x-oneway-ix-in' : 'x-oneway-ix x-oneway-ix-in x-oneway-ix-zero'
        });
      }
      if (showOutbound) {
        pills.push({
          text: compact ? t('pill_out_short', [String(outN)]) : t('pill_out', [String(outN)]),
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
          btn.textContent = t('btn_follow');
        }
        btn.title = t('btn_follow_title', [user]);
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
        el.title = t('btn_follow_title_short', [user]);
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
      if (isListPage() && isFollowersPage()) toast(t('toast_scan_blue', [String(bluePending), String(checked)]));
      else if (isListPage()) toast(t('toast_scan_oneway', [String(oneWayOut), String(checked)]));
      else toast(t('toast_scan_tweets', [String(ixTweet)]));
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

  function pushI18nToInject() {
    try {
      postCtrl({ cmd: 'i18n', pack: buildI18nPack() });
    } catch (_) {}
  }
  pushI18nToInject();
  // inject may load after content; re-push shortly
  setTimeout(pushI18nToInject, 800);
  setTimeout(pushI18nToInject, 2500);


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
      toast(t('toast_selfcheck_miss', [String(authors.size), String(hit), String(miss), missing.length ? ' (@' + missing.join(' @') + ')' : '']), 4500);
    } else if (hit > 0) {
      toast(t('toast_selfcheck_ok', [String(hit)]), 2800);
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
        toast(t('toast_migrated'));
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
        sendResponse({ ok: false, error: t('err_open_notif') });
        toast(t('toast_open_notif'));
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
        sendResponse({ ok: false, error: t('err_open_ox', [me || t('err_open_ox_you')]) });
        toast(t('toast_open_ox'), 3200);
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
    if (by.reply) parts.push(t('toast_short_reply', [String(by.reply)]));
    if (by.thread_reply) parts.push(t('toast_short_thread', [String(by.thread_reply)]));
    if (by.quote) parts.push(t('toast_short_quote', [String(by.quote)]));
    if (by.like) parts.push(t('toast_short_like', [String(by.like)]));
    if (by.retweet) parts.push(t('toast_short_rt', [String(by.retweet)]));
    if (by.mention) parts.push(t('toast_short_mention', [String(by.mention)]));
    const mix = parts.length ? ` [${parts.join(' ')}]` : '';
    const op = d.lastOp ? ` · ${d.lastOp}` : '';
    if (parsed > 0 || skipped > 0 || st.instrArrays > 0 || st.rest) {
      toast(t('toast_notif_batch', [String(parsed), mix, String(skipped), String(sessionParsed), op]), 3200);
    } else if (d.lastOp) {
      toast(t('toast_notif_empty', [String(d.lastOp), String(st.instrArrays || 0)]), 3200);
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
          btn.textContent = t('btn_following');
          btn.classList.add('done');
          btn.disabled = true;
          followCache.set(sn, { following: true, restId: (followCache.get(sn) || {}).restId || '' });
          setTimeout(() => rescanSoon(), 600);
        } else {
          btn.dataset.busy = '0';
          btn.disabled = false;
          btn.textContent = t('btn_follow');
          toast(d.detail || t('toast_follow_fail'), 3200);
        }
      }
      if (d.ok) toast(d.detail || t('toast_follow_ok'), 1800);
      else if (!wraps.length) toast(d.detail || t('toast_follow_fail'), 3200);
    }
  });

  window.addEventListener('x-oneway-ix-sync', (ev) => {
    const d = ev.detail || {};
    if (d.scope === 'outbound') {
      if (d.kind === 'start') toast(t('toast_ox_start'), 3000);
      else if (d.kind === 'progress') toast(t('toast_ox_progress', [String(d.pages), String(d.events)]), 3600);
      else if (d.kind === 'done') { toast(d.detail || t('toast_ox_done'), 4500); loadAccountMeta(() => rescanSoon()); }
      else if (d.kind === 'error') toast(t('toast_ox_error', [d.detail || t('toast_unknown_err')]), 4500);
      else if (d.kind === 'skip') toast(d.detail || t('toast_ox_skip'), 3600);
      return;
    }
    if (d.kind === 'start') {
      toast(t('toast_sync_start'), 2600);
    } else if (d.kind === 'progress') {
      toast(t('toast_sync_progress', [String(d.pages), String(d.events)]), 3600);
    } else if (d.kind === 'done' || d.kind === 'capped' || d.kind === 'empty') {
      toast(d.detail || t('toast_sync_done', [String(d.pages || 0), String(d.events || 0)]), 4500);
      loadAccountMeta(() => {
        rescanSoon();
        setTimeout(selfCheckNotifDom, 1500);
      });
    } else if (d.kind === 'error') {
      toast(t('toast_sync_error', [d.detail || t('toast_unknown_err')]), 4500);
    } else if (d.kind === 'skip') {
      toast(d.detail || t('toast_sync_skip'), 3200);
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
