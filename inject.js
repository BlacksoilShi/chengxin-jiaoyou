// 诚信浇友（原 X 单向关注高亮）— 页面主世界（MAIN world）v1.7.3
// 1) 只读 hook 页面 GraphQL/REST 通知响应 + 单帖 TweetDetail（被动，不额外请求）
// 2) 进入通知页时「温和同步」：2.5–4s 抖动/页，单次 ≤15 页或 ≤300 事件，30 分钟冷却
// 3) 解析口径（1.5.1）：
//    reply         = 别人回复了你的原帖（评你的帖）
//    thread_reply  = 别人回复了你的回复（回你的楼）
//    quote         = 别人引用了你（含引用你的回复）
//    like          = 点赞你；retweet / mention 仅附带记录
//    你自己发的推文永远不记（入站）
// 4) 1.6.0「我互动」(outbound)，与入站完全分开上报：
//    a. 只读 hook 你自己操作成功的 GraphQL 响应：FavoriteTweet / CreateRetweet / CreateTweet / CreateNoteTweet
//    b. 页面自己加载的推文里：别人帖 favorited/retweeted=true、你发的回复/引用 → 被动补记（不额外请求）
//    c. 仅 popup 手动「同步我的互动」时，在你的 /likes 或 /with_replies 页温和翻页（默认不自动）
// 5) 1.7.0「一键关注」：从时间线用户对象学习 following；用户点击后用登录态调 Follow GraphQL（若已捕获）或 REST friendships/create；不批量、不自动
(() => {
  if (window.__xOnewayIxHooked) return;
  Object.defineProperty(window, '__xOnewayIxHooked', { value: true });

  const VERSION = '1.7.2';
  const MSG_TAG = 'x-oneway-ix/v1';
  const OX_TAG = 'x-oneway-ox/v1';
  const FOLLOW_TAG = 'x-oneway-ix/follow';
  const OX_MUTATION_RE = /^(FavoriteTweet|CreateRetweet|CreateTweet|CreateNoteTweet)$/;
  const FOLLOW_MUTATION_RE = /^(Follow|Unfollow|CreateFriendship|DestroyFriendship)$/;
  // 只读时间线类响应：用于 tweetId→作者缓存 + 被动补记「我互动」
  const OX_READ_RE = /(Timeline|TweetDetail|UserTweets|UserMedia|^Likes$|Search|TweetResultBy|Bookmarks|Conversation|Highlights|ListLatest|CommunityTweets)/i;
  const OX_SYNC_OPS = { likes: 'Likes', with_replies: 'UserTweetsAndReplies' };
  const OX_MAX_PAGES = 10;                 // 手动「同步我的互动」单次最多 10 页
  const OX_MIN_GAP_MS = 10 * 60 * 1000;    // 两次手动同步至少隔 10 分钟
  const DBG_TAG = 'x-oneway-ix/dbg';
  const CTRL_TAG = 'x-oneway-ix/ctrl';

  // UI 文案：由 content 经 ctrl 下发（MAIN 无 chrome.i18n）；缺省回落中文
  let I18N = {
    inj_follow_too_fast: '操作太快，请约 10 秒后再试',
    inj_follow_rate: '本分钟关注已达 $1 次，请稍后再试',
    inj_bad_user: '用户名无效',
    inj_follow_self: '不能关注自己',
    inj_already_following: '已关注',
    inj_no_auth: '尚未捕获登录态，请刷新页面后再试',
    inj_rate_429: '已被限流 (429)，请稍后再试',
    inj_relogin: '需重新登录',
    inj_follow_ok: '关注成功',
    inj_follow_fail_status: '关注失败 ($1)',
    inj_ox_busy: '已有同步在进行（一次只跑一个）',
    inj_ox_need_page: '请先打开你自己的「喜欢」或「回复」页（x.com/你/likes 或 /with_replies）',
    inj_ox_cooldown: '刚同步过，为避免限流请约 $1 分钟后再试',
    inj_ox_no_tpl: '未捕获到 $1 请求，请刷新该页后再点',
    inj_ox_no_headers: '尚未捕获到请求头，请刷新页面',
    inj_ox_left: '已离开页面，中止',
    inj_ox_done_detail: '$1（$2 $3 页 / $4 条，已去重）',
    inj_err_429: '429 限流：已停止，请过一段时间再试',
    inj_err_auth: '$1 未授权：请刷新页面',
    inj_err_pull: '拉取失败 $1',
    inj_sync_busy: '已有温和同步在进行（一次只跑一个）',
    inj_sync_notif_only: '仅通知页可同步',
    inj_sync_cd_auto: '30 分钟内已同步过，约 $1 分钟后再自动拉（页面自身加载的通知仍会记录）',
    inj_sync_cd_manual: '刚同步过，为避免限流请 $1 秒后再点温和同步',
    inj_sync_left_cancel: '已离开通知页，同步取消',
    inj_sync_no_headers: '尚未捕获到请求头，请稍候或刷新通知页',
    inj_sync_aborted: '已离开通知页，温和同步中止（$1 页 / $2 条）',
    inj_sync_capped: '温和同步完成：达单次上限（$1 页 / $2 条），30 分钟后可再拉',
    inj_sync_done: '温和同步完成（$1 页 / $2 条）',
    inj_sync_empty: '已请求但未识别到评/引/赞（可把 popup 捕获状态截图反馈）',
    toast_ox_done: '我互动同步完成'
  };
  function t(key, substitutions) {
    let msg = I18N[key] || key;
    const arr = substitutions == null ? [] : (Array.isArray(substitutions) ? substitutions : [substitutions]);
    for (let i = 0; i < arr.length; i++) {
      const n = String(i + 1);
      msg = msg.replace(new RegExp('\\$' + n + '\\$', 'g'), String(arr[i]));
      msg = msg.replace(new RegExp('\\$' + n + '(?!\\d)', 'g'), String(arr[i]));
    }
    return msg;
  }
  const SYNC_TAG = 'x-oneway-ix/sync';
  const USER_RE = /^[A-Za-z0-9_]{1,15}$/;
  const GQL_RE = /\/i\/api\/graphql\/([^/?#]+)\/([A-Za-z0-9_]+)/;
  const REST_NOTIF_RE = /\/i\/api\/2\/notifications\/(all|mentions|verified)\.json/i;
  const NOTIF_OP_RE = /^Notifications?Timeline$|^NotificationsTimelineV\d+$/i;
  const DETAIL_OP_RE = /^(TweetDetail|ThreadedConversation\w*|ConversationTimeline\w*)$/i;

  // ---- 温和同步参数 ----
  const MAX_PAGES = 15;              // 单次最多 15 页
  const MAX_EVENTS_SESSION = 300;    // 或 300 事件
  const COOLDOWN_MS = 30 * 60 * 1000; // 自动同步冷却 30 分钟
  const FORCE_MIN_GAP_MS = 3 * 60 * 1000; // 手动温和同步也至少隔 3 分钟
  const DELAY_MIN = 2500;            // 页间隔 2.5–4s 抖动
  const DELAY_MAX = 4000;
  const PAGE_COUNT = 20;             // 与网页端相同的每页条数
  const ALL_PAGE_SHARE = 10;         // 全部 ≤10 页，其余留给 Mentions

  const INSTR_PATHS = [
    ['data', 'viewer_v2', 'user_results', 'result', 'notification_timeline', 'timeline', 'instructions'],
    ['data', 'viewer', 'user_results', 'result', 'notification_timeline', 'timeline', 'instructions'],
    ['data', 'viewer_v2', 'notification_timeline', 'timeline', 'instructions'],
    ['data', 'notification_timeline', 'timeline', 'instructions'],
    ['data', 'viewer', 'timeline_response', 'timeline', 'instructions'],
    ['data', 'viewer_v2', 'user_results', 'result', 'notifications_timeline', 'timeline', 'instructions'],
    ['data', 'threaded_conversation_with_injections_v2', 'instructions'],
    ['data', 'threaded_conversation_with_injections', 'instructions']
  ];

  // ---- auth capture (memory only, never storage/logs with token values) ----
  let authBundle = null; // { authorization, csrf, authType, activeUser, clientLanguage, guestId }
  let gqlNotif = null;   // { queryId, op, features, fieldToggles, baseVariables, urlBase }
  const gqlOx = {};      // Likes / UserTweetsAndReplies 模板（仅手动同步用）
  let gqlFollow = null;  // { queryId, op, urlBase } — 从页面真实 Follow 请求抄
  const followBySn = new Map(); // sn → { following: bool|null, restId, at }
  const followById = new Map(); // restId → sn
  const followPerUserAt = new Map();
  const followStamps = [];
  const FOLLOW_PER_USER_MS = 10000;
  const FOLLOW_MAX_PER_MIN = 20;
  let syncState = {
    running: false,
    stop: false,
    force: false,
    lastSyncAt: 0,
    pages: 0,
    events: 0,
    status: '',
    detail: ''
  };

  function headerGet(headers, name) {
    if (!headers) return '';
    const want = name.toLowerCase();
    if (typeof headers.get === 'function') {
      return headers.get(name) || headers.get(want) || '';
    }
    if (Array.isArray(headers)) {
      for (const pair of headers) {
        if (pair && String(pair[0]).toLowerCase() === want) return String(pair[1] || '');
      }
      return '';
    }
    if (typeof headers === 'object') {
      for (const [k, v] of Object.entries(headers)) {
        if (String(k).toLowerCase() === want) return String(v || '');
      }
    }
    return '';
  }

  function captureAuthFromInit(input, init) {
    try {
      const headers = (init && init.headers) || (input && input.headers) || null;
      const authorization = headerGet(headers, 'authorization');
      const csrf = headerGet(headers, 'x-csrf-token');
      const authType = headerGet(headers, 'x-twitter-auth-type');
      const activeUser = headerGet(headers, 'x-twitter-active-user');
      const clientLanguage = headerGet(headers, 'x-twitter-client-language');
      const guestId = headerGet(headers, 'x-guest-token');
      if (authorization || csrf) {
        authBundle = {
          authorization: authorization || (authBundle && authBundle.authorization) || '',
          csrf: csrf || (authBundle && authBundle.csrf) || '',
          authType: authType || (authBundle && authBundle.authType) || 'OAuth2Session',
          activeUser: activeUser || (authBundle && authBundle.activeUser) || 'yes',
          clientLanguage: clientLanguage || (authBundle && authBundle.clientLanguage) || 'en',
          guestId: guestId || (authBundle && authBundle.guestId) || ''
        };
      }
    } catch (_) { /* ignore */ }
  }

  function ct0FromCookie() {
    try {
      const m = document.cookie.match(/(?:^|; )ct0=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    } catch (_) { return ''; }
  }

  function buildRequestHeaders() {
    const csrf = (authBundle && authBundle.csrf) || ct0FromCookie();
    const authorization = (authBundle && authBundle.authorization) || '';
    if (!authorization || !csrf) return null;
    const h = {
      'authorization': authorization,
      'x-csrf-token': csrf,
      'x-twitter-auth-type': (authBundle && authBundle.authType) || 'OAuth2Session',
      'x-twitter-active-user': (authBundle && authBundle.activeUser) || 'yes',
      'x-twitter-client-language': (authBundle && authBundle.clientLanguage) || 'en',
      'content-type': 'application/json'
    };
    if (authBundle && authBundle.guestId) h['x-guest-token'] = authBundle.guestId;
    return h;
  }

  function rememberGqlNotif(url, init) {
    try {
      const m = String(url || '').match(GQL_RE);
      if (!m) return;
      const queryId = m[1];
      const op = m[2];
      const isOxOp = op === OX_SYNC_OPS.likes || op === OX_SYNC_OPS.with_replies;
      if (!NOTIF_OP_RE.test(op) && !isOxOp) return; // 只认通知时间线 / 我的喜欢、回复时间线
      const u = new URL(url, location.origin);
      let features = null;
      let fieldToggles = null;
      let baseVariables = null;
      const vp = u.searchParams.get('variables');
      const fp = u.searchParams.get('features');
      const ft = u.searchParams.get('fieldToggles');
      if (vp) { try { baseVariables = JSON.parse(vp); } catch (_) {} }
      if (fp) { try { features = JSON.parse(fp); } catch (_) {} }
      if (ft) { try { fieldToggles = JSON.parse(ft); } catch (_) {} }
      if (init && init.body && typeof init.body === 'string') {
        try {
          const body = JSON.parse(init.body);
          if (body.variables) baseVariables = body.variables;
          if (body.features) features = body.features;
          if (body.fieldToggles) fieldToggles = body.fieldToggles;
        } catch (_) {}
      }
      if (baseVariables && typeof baseVariables === 'object') {
        baseVariables = { ...baseVariables };
        delete baseVariables.cursor;
      }
      if (isOxOp) {
        const prev = gqlOx[op];
        gqlOx[op] = {
          queryId, op,
          features: features || (prev && prev.features) || null,
          fieldToggles: fieldToggles || (prev && prev.fieldToggles) || null,
          baseVariables: baseVariables || (prev && prev.baseVariables) || null,
          urlBase: `${u.origin}/i/api/graphql/${queryId}/${op}`
        };
        return;
      }
      gqlNotif = {
        queryId,
        op,
        features: features || (gqlNotif && gqlNotif.features) || null,
        fieldToggles: fieldToggles || (gqlNotif && gqlNotif.fieldToggles) || null,
        baseVariables: baseVariables || (gqlNotif && gqlNotif.baseVariables) || null,
        urlBase: `${u.origin}/i/api/graphql/${queryId}/${op}`
      };
    } catch (_) { /* ignore */ }
  }


  function rememberFollowGql(url, init) {
    try {
      const m = String(url || '').match(GQL_RE);
      if (!m) return;
      const queryId = m[1];
      const op = m[2];
      if (!FOLLOW_MUTATION_RE.test(op)) return;
      if (!/^(Follow|CreateFriendship)$/.test(op)) return; // 只记「关注」模板
      const u = new URL(url, location.origin);
      gqlFollow = {
        queryId,
        op,
        urlBase: `${u.origin}/i/api/graphql/${queryId}/${op}`
      };
    } catch (_) { /* ignore */ }
  }

  function emitFollow(payload) {
    try { window.postMessage({ __tag: FOLLOW_TAG, ...payload }, location.origin); } catch (_) {}
  }

  function setFollowCache(sn, patch) {
    if (!sn || !USER_RE.test(sn)) return;
    const key = sn.toLowerCase();
    const prev = followBySn.get(key) || { following: null, restId: '', at: 0 };
    const next = {
      following: typeof patch.following === 'boolean' ? patch.following : prev.following,
      restId: (patch.restId && /^\d+$/.test(String(patch.restId))) ? String(patch.restId) : (prev.restId || ''),
      at: Date.now()
    };
    // 若 following 仍未知且无 restId 变化，可跳过广播
    const changed = prev.following !== next.following || prev.restId !== next.restId;
    followBySn.set(key, next);
    if (next.restId) followById.set(next.restId, key);
    if (changed) emitFollow({ kind: 'state', username: key, following: next.following, restId: next.restId });
  }

  function learnFromUserNode(node) {
    if (!node || typeof node !== 'object') return;
    let r = node.result || node;
    if (r.__typename === 'UserUnavailable') return;
    if (r.user && typeof r.user === 'object') r = r.user;
    const sn =
      r?.core?.screen_name ||
      r?.legacy?.screen_name ||
      (typeof r?.screen_name === 'string' ? r.screen_name : null);
    if (!sn || !USER_RE.test(sn)) return;
    const restId = String(r.rest_id || r.id_str || r.legacy?.id_str || '');
    let following = null;
    const rp = r.relationship_perspectives || r.relationshipPerspectives;
    if (rp && typeof rp.following === 'boolean') following = rp.following;
    else if (r.legacy && typeof r.legacy.following === 'boolean') following = r.legacy.following;
    else if (typeof r.following === 'boolean') following = r.following;
    setFollowCache(sn, {
      restId: /^\d+$/.test(restId) ? restId : '',
      following
    });
  }

  function learnUsersFromJson(json) {
    if (!json || typeof json !== 'object') return;
    try {
      const tweets = collectTweets(json);
      for (const raw of tweets) {
        const tr = unwrapTweet(raw);
        if (!tr) continue;
        const ur = tr.core?.user_results || tr.core?.userResults || tr.legacy?.user_results;
        if (ur) learnFromUserNode(ur);
      }
    } catch (_) {}
    // 轻量遍历常见路径，学习 relationship_perspectives.following
    const stack = [json];
    let steps = 0;
    while (stack.length && steps < 2500) {
      steps += 1;
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object') continue;
      if (Array.isArray(cur)) {
        for (let i = 0; i < cur.length && i < 80; i++) stack.push(cur[i]);
        continue;
      }
      if (cur.__typename === 'User' || (cur.rest_id && (cur.legacy?.screen_name || cur.core?.screen_name))) {
        learnFromUserNode(cur);
      }
      if (cur.user_results) learnFromUserNode(cur.user_results);
      if (cur.userResults) learnFromUserNode(cur.userResults);
      for (const k of Object.keys(cur)) {
        const v = cur[k];
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  }

  function followRateOk(sn) {
    const now = Date.now();
    const last = followPerUserAt.get(sn) || 0;
    if (now - last < FOLLOW_PER_USER_MS) return { ok: false, detail: t('inj_follow_too_fast') };
    while (followStamps.length && now - followStamps[0] > 60000) followStamps.shift();
    if (followStamps.length >= FOLLOW_MAX_PER_MIN) return { ok: false, detail: t('inj_follow_rate', [FOLLOW_MAX_PER_MIN]) };
    return { ok: true };
  }

  function markFollowAttempt(sn) {
    const now = Date.now();
    followPerUserAt.set(sn, now);
    followStamps.push(now);
  }

  async function createFollow(username, userIdHint) {
    const sn = String(username || '').toLowerCase();
    if (!USER_RE.test(sn)) {
      emitFollow({ kind: 'result', ok: false, username: sn, detail: t('inj_bad_user') });
      return;
    }
    if (isSelf(sn, selfName())) {
      emitFollow({ kind: 'result', ok: false, username: sn, detail: t('inj_follow_self') });
      return;
    }
    const cached = followBySn.get(sn);
    if (cached && cached.following === true) {
      emitFollow({ kind: 'result', ok: true, username: sn, following: true, detail: t('inj_already_following') });
      return;
    }
    const rate = followRateOk(sn);
    if (!rate.ok) {
      emitFollow({ kind: 'result', ok: false, username: sn, detail: rate.detail });
      return;
    }
    const headers = buildRequestHeaders();
    if (!headers) {
      emitFollow({ kind: 'result', ok: false, username: sn, detail: t('inj_no_auth') });
      return;
    }
    markFollowAttempt(sn);
    const userId = String(userIdHint || (cached && cached.restId) || '');
    // 1) GraphQL Follow（需已从页面抄到 queryId + 有 user_id）
    if (gqlFollow && /^\d+$/.test(userId)) {
      try {
        const body = JSON.stringify({ variables: { user_id: userId }, queryId: gqlFollow.queryId });
        const res = await window.__xOnewayOrigFetch(gqlFollow.urlBase, {
          method: 'POST', credentials: 'include', headers, mode: 'cors', body
        });
        if (res.status === 429) {
          emitFollow({ kind: 'result', ok: false, username: sn, detail: t('inj_rate_429') });
          return;
        }
        if (res.status === 401 || res.status === 403) {
          emitFollow({ kind: 'result', ok: false, username: sn, detail: t('inj_relogin') });
          return;
        }
        if (res.ok) {
          let json = null;
          try { json = await res.json(); } catch (_) {}
          const errMsg = json?.errors?.[0]?.message || '';
          if (errMsg) {
            if (/already|following|已关注/i.test(errMsg)) {
              setFollowCache(sn, { restId: userId, following: true });
              emitFollow({ kind: 'result', ok: true, username: sn, following: true, detail: t('inj_already_following') });
              return;
            }
            // GraphQL 失败再试 REST
          } else {
            setFollowCache(sn, { restId: userId, following: true });
            emitFollow({ kind: 'result', ok: true, username: sn, following: true, detail: t('inj_follow_ok') });
            return;
          }
        }
      } catch (_) { /* fall through to REST */ }
    }
    // 2) REST friendships/create（可用 screen_name，queryId 不轮换）
    try {
      const h = { ...headers, 'content-type': 'application/x-www-form-urlencoded' };
      const params = new URLSearchParams();
      if (/^\d+$/.test(userId)) params.set('user_id', userId);
      else params.set('screen_name', sn);
      params.set('skip_status', 'true');
      const res = await window.__xOnewayOrigFetch(`${location.origin}/i/api/1.1/friendships/create.json`, {
        method: 'POST', credentials: 'include', headers: h, mode: 'cors', body: params.toString()
      });
      if (res.status === 429) {
        emitFollow({ kind: 'result', ok: false, username: sn, detail: t('inj_rate_429') });
        return;
      }
      if (res.status === 401 || res.status === 403) {
        emitFollow({ kind: 'result', ok: false, username: sn, detail: t('inj_relogin') });
        return;
      }
      let json = null;
      try { json = await res.json(); } catch (_) {}
      if (!res.ok) {
        const err = json && json.errors && json.errors[0];
        if (err && (err.code === 158 || /already/i.test(String(err.message || '')))) {
          setFollowCache(sn, { restId: userId, following: true });
          emitFollow({ kind: 'result', ok: true, username: sn, following: true, detail: t('inj_already_following') });
          return;
        }
        emitFollow({
          kind: 'result', ok: false, username: sn,
          detail: String((err && err.message) || t('inj_follow_fail_status', [res.status])).slice(0, 80)
        });
        return;
      }
      const rid = String((json && (json.id_str || json.id)) || userId || '');
      setFollowCache(sn, { restId: rid, following: true });
      emitFollow({ kind: 'result', ok: true, username: sn, following: true, detail: t('inj_follow_ok') });
    } catch (e) {
      emitFollow({ kind: 'result', ok: false, username: sn, detail: String(e.message || e).slice(0, 80) });
    }
  }

  function handleFollowMutation(op, reqBody, json) {
    let userId = '';
    try {
      const body = typeof reqBody === 'string' ? JSON.parse(reqBody) : null;
      userId = String(body?.variables?.user_id || body?.variables?.userId || '');
    } catch (_) {}
    const sn = (userId && followById.get(userId)) || '';
    const following = /^(Follow|CreateFriendship)$/.test(op);
    if (json && json.errors && json.errors.length) return;
    if (sn) setFollowCache(sn, { restId: userId, following });
    else if (userId) {
      // 尚不知 screen_name：只记 id 侧，等后续学到 sn 再合并意义不大；忽略
    }
  }

  // ---- self identity (for reply-to-me / skip-self) ----
  let selfRestId = '';
  function selfName() {
    try {
      const a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
      const m = (a?.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
      return m ? m[1].toLowerCase() : '';
    } catch (_) { return ''; }
  }
  function learnSelfFromJson(json) {
    try {
      const r = json?.data?.viewer_v2?.user_results?.result || json?.data?.viewer?.user_results?.result;
      if (r && typeof r.rest_id === 'string') selfRestId = r.rest_id;
    } catch (_) {}
  }

  function screenNameOfUserResult(u) {
    if (!u || typeof u !== 'object') return null;
    const r0 = u.result || u;
    const r = r0.tweet || r0;
    const sn =
      r?.core?.screen_name ||
      r?.legacy?.screen_name ||
      r0?.core?.screen_name ||
      r0?.legacy?.screen_name ||
      (typeof r0?.screen_name === 'string' ? r0.screen_name : null) ||
      (typeof u.screen_name === 'string' ? u.screen_name : null);
    return typeof sn === 'string' && USER_RE.test(sn) ? sn : null;
  }

  // short stable hash so long notif ids never get truncated into collisions
  function fnv(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }
  function notifKey(id, sn) {
    const k = `${id}:${sn.toLowerCase()}`;
    if (k.length <= 110) return k; // 与 1.5.0 的点赞 key 保持一致，避免重复累计
    return `h${fnv(String(id))}${String(id).length}:${sn.toLowerCase()}`;
  }
  function tweetKey(tweetId, sn) {
    return `tw:${tweetId}:${sn.toLowerCase()}`; // 与 content.js 单帖 DOM 扫描共用，跨来源去重
  }

  function emit(action, username, notifId) {
    if (!username || !USER_RE.test(username)) return;
    if (!notifId || typeof notifId !== 'string') return;
    window.postMessage(
      { __tag: MSG_TAG, action, username, notifId: String(notifId).slice(0, 120) },
      location.origin
    );
  }

  function emitDebug(payload) {
    try { window.postMessage({ __tag: DBG_TAG, ...payload }, location.origin); } catch (_) {}
  }

  function emitSync(payload) {
    try { window.postMessage({ __tag: SYNC_TAG, ...payload }, location.origin); } catch (_) {}
  }

  // ---- classify grouped notifications (TimelineNotification) ----
  function classifyIcon(icon, text, element) {
    const el = String(element || '').toLowerCase();
    const ic = String(icon || '').toLowerCase();
    const tx = String(text || '').toLowerCase();

    if (/liked_your|like_multiple|users_liked|user_liked|like_icon_row/.test(el)) return 'like';
    if (/replied_to_your_reply|replied_to_your_comment/.test(el)) return 'thread_reply';
    if (/replied_to_your|users_replied|user_replied|reply_to_your/.test(el)) return 'reply';
    if (/quoted_your|users_quoted|user_quoted|quote_your/.test(el)) return 'quote';
    if (/retweeted_your|reposted_your|users_retweeted|user_retweeted|users_reposted|user_reposted/.test(el)) return 'retweet';
    if (/mentioned_you|users_mentioned|user_mentioned/.test(el)) return 'mention';
    if (/followed_you|users_followed|user_followed/.test(el)) return null;

    if (/quoted your|引用了你|转述了你/.test(tx)) return 'quote';
    if (/replied to your reply|回复了你的回复|回复了你的评论/.test(tx)) return 'thread_reply';

    if (ic.includes('heart') || ic.includes('favorite') ||
        (ic.includes('like') && !ic.includes('dislike') && !ic.includes('unlike'))) {
      return 'like';
    }
    if (ic.includes('quote')) return 'quote';
    if (ic.includes('reply') || ic.includes('speech') || ic.includes('conversation_bubble')) return 'reply';
    if (ic.includes('retweet') || ic.includes('repost') || ic.includes('recycle')) return 'retweet';
    if (ic.includes('mention') || ic === 'at_icon') return 'mention';

    if (/liked your|赞了你|点赞了你|喜欢了你/.test(tx)) return 'like';
    if (/replied to your|回复了你|评论了你|回应了你|replied to you/.test(tx)) return 'reply';
    if (/reposted your|retweeted your|转帖了你|转发了你|转推了你/.test(tx)) return 'retweet';
    if (/mentioned you|提及了你|提到了你/.test(tx)) return 'mention';
    if (/和另外\s*\d+\s*人/.test(tx) && /赞|喜欢|like/.test(tx)) return 'like';
    if (/and\s+\d+\s+others?.+(liked|like)/.test(tx)) return 'like';
    return null;
  }

  function actorsFromNotif(notif) {
    const users = [];
    const seen = new Set();
    const push = (sn) => {
      if (!sn) return;
      const key = sn.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      users.push(sn);
    };
    const tpl = notif?.template;
    const lists = [
      tpl?.from_users, tpl?.fromUsers,
      tpl?.aggregate_user_actions_v1?.from_users, tpl?.aggregateUserActionsV1?.fromUsers,
      notif?.from_users, notif?.fromUsers, notif?.users
    ];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const fu of list) {
        push(screenNameOfUserResult(fu?.user_results || fu?.userResults || fu));
        if (typeof fu?.screen_name === 'string' && USER_RE.test(fu.screen_name)) push(fu.screen_name);
      }
    }
    const entities = notif?.rich_message?.entities || notif?.message?.entities;
    if (Array.isArray(entities)) {
      for (const ent of entities) {
        push(screenNameOfUserResult(ent?.ref?.user_results || ent?.ref?.userResults ||
          ent?.user_results || ent?.userResults));
        const sn = ent?.ref?.user?.screen_name || ent?.screen_name;
        if (typeof sn === 'string' && USER_RE.test(sn)) push(sn);
      }
    }
    return users; // 只记可见 actors，不按「另外 N 人」虚增
  }

  function notifNodeOf(ic) {
    if (!ic || typeof ic !== 'object') return null;
    if (ic.notification_icon || ic.template || ic.rich_message || ic.__typename === 'TimelineNotification') return ic;
    const via = ic.notification_results?.result || ic.notificationResults?.result;
    if (via && typeof via === 'object') return via;
    return null;
  }

  // ---- tweet model ----
  function unwrapTweet(tr) {
    if (!tr || typeof tr !== 'object') return null;
    if (tr.tweet) tr = tr.tweet;
    if (tr.__typename === 'TweetTombstone' || tr.__typename === 'TweetUnavailable') return null;
    return tr;
  }

  function tweetInfo(trRaw) {
    const tr = unwrapTweet(trRaw);
    if (!tr) return null;
    const sn = screenNameOfUserResult(tr.core?.user_results || tr.core?.userResults || tr.legacy?.user_results);
    if (!sn) return null;
    const lg = tr.legacy || {};
    const id = String(tr.rest_id || lg.id_str || '');
    if (!/^\d+$/.test(id)) return null;
    const inReplyToId = String(lg.in_reply_to_status_id_str || lg.in_reply_to_status_id || '') || '';
    const inReplyToSn = typeof lg.in_reply_to_screen_name === 'string' ? lg.in_reply_to_screen_name : '';
    const inReplyToUid = String(lg.in_reply_to_user_id_str || '') || '';
    const convId = String(lg.conversation_id_str || '') || '';
    let quoted = null;
    const qr = tr.quoted_status_result?.result || tr.quotedStatusResult?.result;
    if (qr) {
      const q = unwrapTweet(qr);
      if (q) {
        quoted = {
          sn: screenNameOfUserResult(q.core?.user_results || q.core?.userResults) || '',
          isReply: !!(q.legacy?.in_reply_to_status_id_str)
        };
      }
    }
    const isQuote = !!(lg.is_quote_status || lg.quoted_status_id_str || quoted);
    return { id, sn, inReplyToId, inReplyToSn, inReplyToUid, convId, isQuote, quoted };
  }

  function isSelf(sn, me) {
    return !!(sn && me && sn.toLowerCase() === me);
  }

  // 判定一条别人发的推文对「我」是什么互动
  // parentMap: TweetDetail 中已知的 id → tweetInfo，用来判断被回复的是原帖还是我的回复
  function classifyTweet(t, me, hintElement, parentMap) {
    if (!t) return null;
    if (isSelf(t.sn, me)) return null; // 规则 4：自己发的推文（含你去评论别人）永远不记
    const el = String(hintElement || '').toLowerCase();
    if (t.inReplyToId) {
      const toMe = isSelf(t.inReplyToSn, me) ||
        (selfRestId && t.inReplyToUid === selfRestId) ||
        /replied_to_your/.test(el);
      if (toMe) {
        // 被回复的是我的原帖 → reply；是我的回复 → thread_reply
        const parent = parentMap && parentMap.get(t.inReplyToId);
        if (parent) {
          if (!parent.inReplyToId) return 'reply';
          // 我自己的连续线程（自己回自己）仍算原帖
          if (isSelf(parent.inReplyToSn, me)) return 'reply';
          return 'thread_reply';
        }
        if (/replied_to_your_reply/.test(el)) return 'thread_reply';
        if (t.convId && t.convId === t.inReplyToId) return 'reply';
        if (t.convId && t.convId !== t.inReplyToId) return 'thread_reply';
        return 'reply';
      }
      // 回复的是别人、只是带到了我
      if (t.isQuote && t.quoted && isSelf(t.quoted.sn, me)) return 'quote';
      return 'mention';
    }
    if (t.isQuote) {
      if (!t.quoted || !me || isSelf(t.quoted.sn, me) || !t.quoted.sn) return 'quote';
      return 'mention';
    }
    return 'mention';
  }

  // 统一遍历 instructions 里的条目（含 module items / TimelineAddToModule / ReplaceEntry）
  function forEachItem(instructions, fn) {
    if (!Array.isArray(instructions)) return;
    const visitEntry = (entry, parentEl) => {
      if (!entry || typeof entry !== 'object') return;
      const entryId = typeof entry.entryId === 'string' ? entry.entryId : '';
      if (/cursor-/.test(entryId)) return;
      const c = entry.content || entry.item || {};
      const el = c?.clientEventInfo?.element || c?.client_event_info?.element ||
        entry?.item?.clientEventInfo?.element || parentEl || '';
      if (c.cursorType || c.entryType === 'TimelineTimelineCursor' || c.__typename === 'TimelineTimelineCursor') return;
      const ic = c.itemContent || c.content?.itemContent || entry.item?.itemContent;
      if (ic) fn({ entryId, itemContent: ic, element: el });
      const items = c.items || c.moduleItems;
      if (Array.isArray(items)) {
        for (const it of items) visitEntry({ entryId: it.entryId || entryId, content: it.item || it }, el);
      }
    };
    for (const inst of instructions) {
      if (!inst || typeof inst !== 'object') continue;
      if (Array.isArray(inst.entries)) for (const e of inst.entries) visitEntry(e, '');
      if (inst.entry) visitEntry(inst.entry, '');
      if (Array.isArray(inst.moduleItems)) {
        for (const it of inst.moduleItems) visitEntry({ entryId: it.entryId, content: it.item || it }, '');
      }
    }
  }

  function bump(stats, action) {
    stats.parsed += 1;
    stats.byAction[action] = (stats.byAction[action] || 0) + 1;
  }

  function walkNotifInstructions(instructions, out, stats) {
    const me = selfName();
    forEachItem(instructions, ({ entryId, itemContent: ic, element }) => {
      // 关键修复：按 itemContent 类型分派，不按 entryId 前缀。
      // X 通知页的回复/引用条目 entryId 是 "notification-…" 但内容是 TimelineTweet，
      // 1.5.0 先走了 notification 分支，拿不到通知节点就 skip 了，评论因此一直是 0。
      const tr = ic.tweet_results?.result || ic.tweetResults?.result;
      if (tr || ic.__typename === 'TimelineTweet') {
        stats.seenTweetEntries += 1;
        const t = tweetInfo(tr);
        if (!t) { stats.skipNoNode += 1; return; }
        if (isSelf(t.sn, me)) { stats.skipSelf += 1; return; }
        const action = classifyTweet(t, me, element, null);
        if (!action) { stats.skipNoAction += 1; return; }
        out.push({ action, username: t.sn, notifId: tweetKey(t.id, t.sn) });
        bump(stats, action);
        return;
      }
      const notif = notifNodeOf(ic);
      if (!notif) { stats.skipNoNode += 1; return; }
      stats.seenNotifEntries += 1;
      const id = (typeof notif.id === 'string' && notif.id) ? notif.id : (entryId || 'unk');
      const icon = notif.notification_icon || notif.icon?.id || notif.icon || '';
      const text = notif.rich_message?.text || notif.message?.text || '';
      const action = classifyIcon(icon, text, element);
      if (!action) {
        stats.skipNoAction += 1;
        stats.lastSkipReason = `icon=${icon || '?'} el=${element || '?'} text=${String(text).slice(0, 40)}`;
        if (stats.unknownIcons.length < 6) {
          stats.unknownIcons.push({ icon: String(icon).slice(0, 40), el: String(element).slice(0, 40), text: String(text).slice(0, 60) });
        }
        return;
      }
      const actors = actorsFromNotif(notif).filter((sn) => !isSelf(sn, me));
      if (!actors.length) { stats.skipNoActor += 1; stats.lastSkipReason = `no actors icon=${icon}`; return; }
      for (const sn of actors) {
        out.push({ action, username: sn, notifId: notifKey(id, sn) });
        bump(stats, action);
      }
    });
  }

  // 单帖页（TweetDetail）被动解析：只记「回复我」的推文，不额外发请求
  function walkDetailInstructions(instructions, out, stats) {
    const me = selfName();
    if (!me) return;
    const all = [];
    forEachItem(instructions, ({ itemContent: ic }) => {
      const t = tweetInfo(ic.tweet_results?.result || ic.tweetResults?.result);
      if (t) all.push(t);
    });
    const map = new Map(all.map((t) => [t.id, t]));
    for (const t of all) {
      stats.seenTweetEntries += 1;
      if (isSelf(t.sn, me)) continue;
      if (!t.inReplyToId || !isSelf(t.inReplyToSn, me)) continue; // 只要回复我的
      const action = classifyTweet(t, me, '', map);
      if (action !== 'reply' && action !== 'thread_reply') continue;
      out.push({ action, username: t.sn, notifId: tweetKey(t.id, t.sn) });
      bump(stats, action);
    }
  }

  function pathGet(obj, path) {
    let cur = obj;
    for (const k of path) {
      if (!cur || typeof cur !== 'object') return null;
      cur = cur[k];
    }
    return cur;
  }

  function findInstructionArrays(json, budget = 12000) {
    const found = [];
    const seen = new Set();
    const add = (arr) => {
      if (!Array.isArray(arr) || !arr.length || seen.has(arr)) return;
      seen.add(arr);
      found.push(arr);
    };
    for (const p of INSTR_PATHS) add(pathGet(json, p));
    if (found.length) return found;
    if (json && typeof json === 'object') {
      const stack = [json];
      while (stack.length && budget-- > 0) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node)) {
          for (const v of node) if (v && typeof v === 'object') stack.push(v);
          continue;
        }
        if (Array.isArray(node.instructions) && node.instructions.length) add(node.instructions);
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (v && typeof v === 'object') stack.push(v);
        }
      }
    }
    return found;
  }

  function extractBottomCursor(json) {
    const arrays = findInstructionArrays(json);
    if (json?.timeline?.instructions) arrays.push(json.timeline.instructions);
    for (const instructions of arrays) {
      for (const inst of instructions) {
        const entries = [...(inst.entries || []), ...(inst.entry ? [inst.entry] : [])];
        for (const e of entries) {
          const id = e?.entryId || '';
          const ct = e?.content?.cursorType || e?.content?.itemContent?.cursorType ||
            e?.content?.operation?.cursor?.cursorType;
          if (ct === 'Bottom' || id.includes('cursor-bottom')) {
            const v = e?.content?.value || e?.content?.itemContent?.value || e?.content?.operation?.cursor?.value;
            if (typeof v === 'string' && v) return v;
          }
        }
      }
    }
    if (typeof json?.cursor?.bottom === 'string') return json.cursor.bottom;
    return null;
  }

  function processRestNotifications(json, out, stats) {
    const go = json?.globalObjects;
    if (!go || typeof go !== 'object') return;
    const me = selfName();
    const users = go.users || {};
    const resolveUser = (uid) => {
      if (uid == null) return null;
      const u = users[String(uid)];
      const sn = u && (u.screen_name || u.screenName);
      return typeof sn === 'string' && USER_RE.test(sn) ? sn : null;
    };
    const notifications = go.notifications || {};
    for (const [nid, notif] of Object.entries(notifications)) {
      if (!notif || typeof notif !== 'object') continue;
      stats.seenNotifEntries += 1;
      const icon = notif.icon?.id || notif.icon || notif.notification_icon || '';
      const text = notif.message?.text || notif.rich_message?.text || '';
      const action = classifyIcon(icon, text, '');
      if (!action) { stats.skipNoAction += 1; continue; }
      // REST 的 reply/quote 以 tweets 为准（能区分原帖/楼中楼），这里只取点赞/转帖等聚合项
      if (action === 'reply' || action === 'thread_reply' || action === 'quote' || action === 'mention') continue;
      const actors = new Set();
      const tpl = notif.template || {};
      const agg = tpl.aggregateUserActionsV1 || tpl.aggregate_user_actions_v1 || {};
      for (const fu of (agg.fromUsers || agg.from_users || [])) {
        const sn = (typeof fu === 'object') ? (resolveUser(fu.id || fu.user_id) || fu.screen_name) : resolveUser(fu);
        if (sn && USER_RE.test(sn) && !isSelf(sn, me)) actors.add(sn);
      }
      if (!actors.size) { stats.skipNoActor += 1; continue; }
      for (const sn of actors) {
        out.push({ action, username: sn, notifId: notifKey(nid, sn) });
        bump(stats, action);
      }
    }
    const tweets = go.tweets || {};
    for (const [tid, tw] of Object.entries(tweets)) {
      if (!tw || typeof tw !== 'object') continue;
      const sn = resolveUser(tw.user_id_str || tw.user_id);
      if (!sn || isSelf(sn, me)) continue;
      const q = tw.quoted_status_id_str ? tweets[tw.quoted_status_id_str] : null;
      const t = {
        id: String(tid), sn,
        inReplyToId: String(tw.in_reply_to_status_id_str || ''),
        inReplyToSn: tw.in_reply_to_screen_name || '',
        inReplyToUid: String(tw.in_reply_to_user_id_str || ''),
        convId: String(tw.conversation_id_str || ''),
        isQuote: !!(tw.is_quote_status || tw.quoted_status_id_str),
        quoted: q ? { sn: resolveUser(q.user_id_str) || '', isReply: !!q.in_reply_to_status_id_str } : null
      };
      const parentMap = new Map();
      if (t.inReplyToId && tweets[t.inReplyToId]) {
        const p = tweets[t.inReplyToId];
        parentMap.set(t.inReplyToId, { inReplyToId: String(p.in_reply_to_status_id_str || ''), inReplyToSn: p.in_reply_to_screen_name || '' });
      }
      const action = classifyTweet(t, me, '', parentMap);
      if (!action || action === 'mention') continue;
      stats.seenTweetEntries += 1;
      out.push({ action, username: sn, notifId: tweetKey(t.id, sn) });
      bump(stats, action);
    }
  }

  function newStats() {
    return {
      parsed: 0, skipNoNode: 0, skipNoAction: 0, skipNoActor: 0, skipSelf: 0,
      seenNotifEntries: 0, seenTweetEntries: 0, lastSkipReason: '',
      instrArrays: 0, rest: false, byAction: {}, unknownIcons: []
    };
  }

  // 首屏通知响应可能早于左侧导航渲染（拿不到自己的 handle）→ 延迟重试，避免把回复误判成提及
  function processWhenSelfKnown(url, json, meta, tries) {
    if (selfName() || (tries || 0) >= 24) return processResponse(url, json, meta);
    setTimeout(() => processWhenSelfKnown(url, json, meta, (tries || 0) + 1), 500);
    return null;
  }

  function processResponse(url, json, meta) {
    const urlStr = String(url || '');
    const m = urlStr.match(GQL_RE);
    const op = m ? m[2] : (REST_NOTIF_RE.test(urlStr) ? 'RestNotifications' : '');
    const isDetail = DETAIL_OP_RE.test(op);
    const isNotif = REST_NOTIF_RE.test(urlStr) || NOTIF_OP_RE.test(op) || /notif/i.test(op) ||
      (meta && meta.forceParse);
    if (!isDetail && !isNotif) return null;

    const events = [];
    const stats = newStats();
    try {
      if (isNotif) learnSelfFromJson(json);
      if (json?.globalObjects?.notifications || REST_NOTIF_RE.test(urlStr)) {
        stats.rest = true;
        processRestNotifications(json, events, stats);
      } else {
        const arrays = findInstructionArrays(json);
        stats.instrArrays = arrays.length;
        for (const instructions of arrays) {
          if (isDetail) walkDetailInstructions(instructions, events, stats);
          else walkNotifInstructions(instructions, events, stats);
        }
      }
    } catch (_) { /* never break the page */ }

    const uniq = [];
    const seenEv = new Set();
    for (const ev of events) {
      if (seenEv.has(ev.notifId)) continue;
      seenEv.add(ev.notifId);
      uniq.push(ev);
    }
    for (const ev of uniq) {
      try { emit(ev.action, ev.username, ev.notifId); } catch (_) {}
    }
    if (syncState.running && meta && meta.source === 'autofetch') syncState.events += uniq.length;

    if (isDetail) {
      try { window.postMessage({ __tag: 'x-oneway-ix/detail', path: location.pathname }, location.origin); } catch (_) {}
    }
    if (uniq.length || isNotif) {
      emitDebug({
        kind: 'parse',
        op: (meta && meta.opLabel) || op || '(unknown)',
        urlHit: true,
        events: uniq.length,
        sample: uniq.slice(0, 12).map((e) => ({ action: e.action, username: e.username, notifId: e.notifId })),
        stats,
        source: (meta && meta.source) || (isDetail ? 'thread' : 'hook')
      });
    }
    return { events: uniq, stats, cursor: extractBottomCursor(json) };
  }

  function isWatchUrl(url) {
    const u = String(url || '');
    if (REST_NOTIF_RE.test(u)) return true;
    const m = u.match(GQL_RE);
    return !!(m && (NOTIF_OP_RE.test(m[2]) || /notif/i.test(m[2]) || DETAIL_OP_RE.test(m[2])));
  }


  // ================= 我互动（outbound） =================
  const authorCache = new Map(); // tweetId → screen_name
  const AUTHOR_CACHE_MAX = 8000;
  function cacheAuthor(id, sn) {
    if (!id || !sn) return;
    if (authorCache.has(id)) authorCache.delete(id);
    authorCache.set(id, sn);
    if (authorCache.size > AUTHOR_CACHE_MAX) {
      const first = authorCache.keys().next().value;
      authorCache.delete(first);
    }
  }
  function authorFromDom(tweetId) {
    try {
      for (const a of document.querySelectorAll(`a[href*="/status/${tweetId}"]`)) {
        const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
        if (m && m[2] === tweetId && USER_RE.test(m[1]) && m[1].toLowerCase() !== 'i') return m[1];
      }
    } catch (_) {}
    return '';
  }
  function authorOf(tweetId) {
    return authorCache.get(tweetId) || authorFromDom(tweetId) || '';
  }

  // 有预算的遍历：收集响应里所有 Tweet 节点（含引用/转帖内嵌）
  function collectTweets(json, budget = 40000) {
    const out = [];
    const stack = [json];
    while (stack.length && budget-- > 0) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) { for (const v of node) if (v && typeof v === 'object') stack.push(v); continue; }
      if ((node.__typename === 'Tweet' || (node.rest_id && node.legacy && node.core)) && node.legacy) out.push(node);
      for (const k in node) {
        const v = node[k];
        if (v && typeof v === 'object') stack.push(v);
      }
    }
    return out;
  }

  const oxStats = { like: 0, retweet: 0, reply: 0, quote: 0, unresolved: 0 };
  function emitOut(action, username, key, source) {
    if (!username || !USER_RE.test(username)) return false;
    const me = selfName();
    if (me && username.toLowerCase() === me) return false; // 对自己的操作不计
    if (!/^(like|rt|tw|q):\d+$/.test(key)) return false;
    oxStats[action] = (oxStats[action] || 0) + 1;
    window.postMessage({ __tag: OX_TAG, action, username, key, source: source || 'hook' }, location.origin);
    return true;
  }

  // 被动：从页面已加载的推文里补记（favorited / retweeted / 我发的回复与引用）
  function outboundFromTweets(tweets, me, source) {
    let n = 0;
    for (const raw of tweets) {
      const t = tweetInfo(raw);
      if (!t) continue;
      cacheAuthor(t.id, t.sn);
      if (!me) continue;
      const lg = (unwrapTweet(raw) || {}).legacy || {};
      const mine = isSelf(t.sn, me);
      if (!mine) {
        if (lg.favorited === true && emitOut('like', t.sn, `like:${t.id}`, source)) n += 1;
        if (lg.retweeted === true && emitOut('retweet', t.sn, `rt:${t.id}`, source)) n += 1;
        continue;
      }
      // 我发的推文：转帖壳不算（原帖 retweeted=true 已覆盖）
      if (lg.retweeted_status_result || lg.retweeted_status_id_str) continue;
      if (t.inReplyToId && t.inReplyToSn && !isSelf(t.inReplyToSn, me)) {
        if (emitOut('reply', t.inReplyToSn, `tw:${t.id}`, source)) n += 1;
      }
      if (t.isQuote && t.quoted && t.quoted.sn && !isSelf(t.quoted.sn, me)) {
        if (emitOut('quote', t.quoted.sn, `q:${t.id}`, source)) n += 1;
      }
    }
    return n;
  }

  function outboundPassive(url, json, source) {
    try {
      const tweets = collectTweets(json);
      if (!tweets.length) return 0;
      const n = outboundFromTweets(tweets, selfName(), source || 'passive');
      if (n) emitDebug({ kind: 'ox', op: opOf(url), events: n, source: source || 'passive' });
      return n;
    } catch (_) { return 0; }
  }

  function opOf(url) {
    const m = String(url || '').match(GQL_RE);
    return m ? m[2] : '';
  }

  function parseBody(body) {
    if (!body) return null;
    if (typeof body === 'string') { try { return JSON.parse(body); } catch (_) { return null; } }
    return null;
  }

  function resolveLater(tweetId, cb) {
    let tries = 0;
    const tick = () => {
      const sn = authorOf(tweetId);
      if (sn) return cb(sn);
      if (++tries >= 4) { oxStats.unresolved += 1; return; }
      setTimeout(tick, 800 * tries);
    };
    tick();
  }

  // 只读：你自己的写操作成功后才记（不重放、不额外请求）
  function handleMutation(op, reqBody, json) {
    if (!json || typeof json !== 'object' || !json.data) return;
    if (Array.isArray(json.errors) && json.errors.length && !json.data) return;
    const body = parseBody(reqBody) || {};
    const v = body.variables || {};
    const me = selfName();
    if (op === 'FavoriteTweet') {
      if (!json.data.favorite_tweet) return;
      const id = String(v.tweet_id || '');
      if (!/^\d+$/.test(id)) return;
      resolveLater(id, (sn) => emitOut('like', sn, `like:${id}`, 'action'));
      return;
    }
    if (op === 'CreateRetweet') {
      if (!json.data.create_retweet) return;
      const id = String(v.tweet_id || '');
      if (!/^\d+$/.test(id)) return;
      resolveLater(id, (sn) => emitOut('retweet', sn, `rt:${id}`, 'action'));
      return;
    }
    // CreateTweet / CreateNoteTweet
    const created = collectTweets(json, 5000);
    for (const raw of created) { const ti = tweetInfo(raw); if (ti) cacheAuthor(ti.id, ti.sn); }
    const mineRaw = created.find((raw) => { const ti = tweetInfo(raw); return ti && isSelf(ti.sn, me); }) || created[0];
    const t = tweetInfo(mineRaw);
    if (!t) return;
    const replyTo = String(v.reply?.in_reply_to_tweet_id || t.inReplyToId || '');
    if (replyTo) {
      const sn = t.inReplyToSn || authorOf(replyTo);
      if (sn) emitOut('reply', sn, `tw:${t.id}`, 'action');
      else resolveLater(replyTo, (s2) => emitOut('reply', s2, `tw:${t.id}`, 'action'));
    }
    const att = String(v.attachment_url || '');
    let qsn = t.quoted && t.quoted.sn;
    if (!qsn && att) {
      const m = att.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/\d+/i);
      if (m) qsn = m[1];
    }
    if (qsn) emitOut('quote', qsn, `q:${t.id}`, 'action');
    emitDebug({ kind: 'ox', op, events: 1, source: 'action' });
  }

  function onApiResponse(url, json, reqBody) {
    try { learnUsersFromJson(json); } catch (_) {}
    const op = opOf(url);
    if (op && FOLLOW_MUTATION_RE.test(op)) {
      try { handleFollowMutation(op, reqBody, json); } catch (_) {}
    }
    if (op && OX_MUTATION_RE.test(op)) {
      const go = () => handleMutation(op, reqBody, json);
      if (selfName()) go(); else setTimeout(go, 1500);
      return;
    }
    if (isWatchUrl(url)) processWhenSelfKnown(url, json);
    if (op && (OX_READ_RE.test(op) || isWatchUrl(url))) {
      const run = (tries) => {
        if (selfName() || tries >= 24) { outboundPassive(url, json, 'passive'); return; }
        setTimeout(() => run(tries + 1), 500);
      };
      run(0);
    }
  }

  function isHookedUrl(url) {
    const op = opOf(url);
    if (op && (OX_MUTATION_RE.test(op) || OX_READ_RE.test(op) || FOLLOW_MUTATION_RE.test(op))) return true;
    if (/\/i\/api\/1\.1\/friendships\/(create|destroy)\.json/.test(String(url || ''))) return true;
    return isWatchUrl(url);
  }

  // ---- 手动「同步我的互动」：仅在 /<我>/likes 或 /<我>/with_replies，用户点击才跑 ----
  let oxState = { running: false, stop: false, lastAt: 0, pages: 0, events: 0, path: '' };
  function oxPageKind() {
    const me = selfName();
    const m = location.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/(likes|with_replies)\/?$/);
    if (!m || !me || m[1].toLowerCase() !== me) return '';
    return m[2];
  }
  function oxAbort() {
    return oxState.stop || location.pathname !== oxState.path;
  }
  async function oxSleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (oxAbort()) return false;
      await new Promise((r) => setTimeout(r, Math.min(250, end - Date.now())));
    }
    return !oxAbort();
  }
  function emitOxSync(payload) { emitSync({ scope: 'outbound', ...payload }); }

  async function runOutboundSync() {
    if (oxState.running || syncState.running) { emitOxSync({ kind: 'skip', detail: t('inj_ox_busy') }); return; }
    const kind = oxPageKind();
    if (!kind) { emitOxSync({ kind: 'skip', detail: t('inj_ox_need_page') }); return; }
    if (oxState.lastAt && Date.now() - oxState.lastAt < OX_MIN_GAP_MS) {
      const m = Math.ceil((OX_MIN_GAP_MS - (Date.now() - oxState.lastAt)) / 60000);
      emitOxSync({ kind: 'skip', detail: t('inj_ox_cooldown', [m]) });
      return;
    }
    const op = OX_SYNC_OPS[kind];
    oxState = { running: true, stop: false, lastAt: oxState.lastAt, pages: 0, events: 0, path: location.pathname };
    try {
      const end = Date.now() + 6000;
      while (!gqlOx[op] && Date.now() < end && !oxAbort()) await new Promise((r) => setTimeout(r, 300));
      const tpl = gqlOx[op];
      if (!tpl) { emitOxSync({ kind: 'error', status: 'error', detail: t('inj_ox_no_tpl', [op]) }); return; }
      const headers = buildRequestHeaders();
      if (!headers) { emitOxSync({ kind: 'error', status: 'error', detail: t('inj_ox_no_headers') }); return; }
      emitOxSync({ kind: 'start', feed: op });
      let cursor = null;
      let failStatus = 0;
      while (!oxAbort() && oxState.pages < OX_MAX_PAGES) {
        if (oxState.pages > 0 && !(await oxSleep(jitterDelay()))) break;
        const variables = { ...(tpl.baseVariables || {}), count: PAGE_COUNT };
        if (cursor) variables.cursor = cursor;
        const params = new URLSearchParams();
        params.set('variables', JSON.stringify(variables));
        if (tpl.features) params.set('features', JSON.stringify(tpl.features));
        if (tpl.fieldToggles) params.set('fieldToggles', JSON.stringify(tpl.fieldToggles));
        const url = `${tpl.urlBase}?${params.toString()}`;
        let json;
        try {
          const res = await window.__xOnewayOrigFetch(url, { method: 'GET', credentials: 'include', headers, mode: 'cors' });
          if (!res.ok) { failStatus = res.status; break; }
          json = await res.json();
        } catch (_) { failStatus = -1; break; }
        oxState.pages += 1;
        const n = outboundPassive(url, json, 'ox-sync');
        oxState.events += n;
        emitOxSync({ kind: 'progress', pages: oxState.pages, events: oxState.events, feed: op });
        const next = extractBottomCursor(json);
        if (!next || next === cursor) break;
        cursor = next;
      }
      if (failStatus) {
        emitOxSync({ kind: 'error', status: 'error', detail: errDetail(failStatus), pages: oxState.pages, events: oxState.events });
        return;
      }
      const aborted = oxAbort();
      emitOxSync({
        kind: 'done',
        status: aborted ? 'aborted' : 'done',
        detail: t('inj_ox_done_detail', [aborted ? t('inj_ox_left') : t('toast_ox_done'), op, oxState.pages, oxState.events]),
        pages: oxState.pages,
        events: oxState.events
      });
    } finally {
      if (oxState.pages > 0) oxState.lastAt = Date.now();
      oxState.running = false;
    }
  }

  // ---- 温和同步 ----
  function jitterDelay() {
    return DELAY_MIN + Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1));
  }

  function isNotifPath() {
    return /^\/notifications(\/(mentions|verified))?\/?$/.test(location.pathname);
  }

  function shouldAbort() {
    return syncState.stop || !isNotifPath();
  }

  // 分片等待：随时可因离开通知页/停止而立即返回
  async function gentleSleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (shouldAbort()) return false;
      await new Promise((r) => setTimeout(r, Math.min(250, end - Date.now())));
    }
    return !shouldAbort();
  }

  let inflight = null;
  async function fetchJson(url, headers) {
    inflight = new AbortController();
    try {
      const res = await window.__xOnewayOrigFetch(url, {
        method: 'GET', credentials: 'include', headers, mode: 'cors', signal: inflight.signal
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } finally {
      inflight = null;
    }
  }

  function budgetLeft() {
    return syncState.pages < MAX_PAGES && syncState.events < MAX_EVENTS_SESSION;
  }

  function progress(feed, n) {
    emitSync({ kind: 'progress', pages: syncState.pages, events: syncState.events, batch: n, feed });
  }

  async function pullGqlFeed(headers, timelineType, pageCap) {
    let cursor = null;
    let pages = 0;
    while (!shouldAbort() && budgetLeft() && pages < pageCap) {
      if (syncState.pages > 0) {
        if (!(await gentleSleep(jitterDelay()))) break;
      }
      const variables = { ...(gqlNotif.baseVariables || {}), timeline_type: timelineType, count: PAGE_COUNT };
      if (cursor) variables.cursor = cursor;
      const params = new URLSearchParams();
      params.set('variables', JSON.stringify(variables));
      if (gqlNotif.features) params.set('features', JSON.stringify(gqlNotif.features));
      if (gqlNotif.fieldToggles) params.set('fieldToggles', JSON.stringify(gqlNotif.fieldToggles));
      const url = `${gqlNotif.urlBase}?${params.toString()}`;
      let json;
      try {
        json = await fetchJson(url, headers);
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: true, aborted: true, pages };
        return { ok: false, status: e.status || 0, pages };
      }
      pages += 1;
      syncState.pages += 1;
      const result = processResponse(url, json, { forceParse: true, source: 'autofetch', opLabel: `${timelineType}#${pages}` });
      progress(timelineType, result?.events?.length || 0);
      const next = result?.cursor;
      if (!next || next === cursor) break;
      cursor = next;
    }
    return { ok: true, pages };
  }

  async function pullRestFeed(headers, kind, pageCap) {
    let cursor = null;
    let pages = 0;
    while (!shouldAbort() && budgetLeft() && pages < pageCap) {
      if (syncState.pages > 0) {
        if (!(await gentleSleep(jitterDelay()))) break;
      }
      let url = `${location.origin}/i/api/2/notifications/${kind}.json?include_user_entities=true&count=${PAGE_COUNT}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
      let json;
      try {
        json = await fetchJson(url, headers);
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: true, aborted: true, pages };
        return { ok: false, status: e.status || 0, pages };
      }
      pages += 1;
      syncState.pages += 1;
      const result = processResponse(url, json, { forceParse: true, source: 'autofetch', opLabel: `Rest:${kind}#${pages}` });
      progress(`rest-${kind}`, result?.events?.length || 0);
      const next = result?.cursor;
      if (!next || next === cursor) break;
      cursor = next;
    }
    return { ok: true, pages };
  }

  function errDetail(status) {
    if (status === 429) return t('inj_err_429');
    if (status === 401 || status === 403) return t('inj_err_auth', [status]);
    return t('inj_err_pull', [status || '']).trim();
  }

  async function waitForGql(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end && !(gqlNotif && gqlNotif.queryId)) {
      if (shouldAbort()) return false;
      await new Promise((r) => setTimeout(r, 300));
    }
    return !!(gqlNotif && gqlNotif.queryId);
  }

  async function runAutoSync(opts) {
    const force = !!(opts && opts.force);
    const lastSyncAt = Math.max(Number((opts && opts.lastSyncAt) || 0) || 0, syncState.lastSyncAt || 0);

    if (syncState.running || oxState.running) { emitSync({ kind: 'skip', detail: t('inj_sync_busy') }); return; }
    if (!isNotifPath()) { emitSync({ kind: 'skip', detail: t('inj_sync_notif_only') }); return; }
    const since = Date.now() - lastSyncAt;
    if (!force && lastSyncAt && since < COOLDOWN_MS) {
      const mins = Math.ceil((COOLDOWN_MS - since) / 60000);
      emitSync({ kind: 'skip', detail: t('inj_sync_cd_auto', [mins]) });
      return;
    }
    if (force && syncState.lastSyncAt && Date.now() - syncState.lastSyncAt < FORCE_MIN_GAP_MS) {
      const s = Math.ceil((FORCE_MIN_GAP_MS - (Date.now() - syncState.lastSyncAt)) / 1000);
      emitSync({ kind: 'skip', detail: t('inj_sync_cd_manual', [s]) });
      return;
    }

    syncState.running = true;
    syncState.stop = false;
    syncState.force = force;
    syncState.pages = 0;
    syncState.events = 0;
    syncState.status = 'running';
    syncState.detail = '';

    try {
      // 等页面自己的 NotificationsTimeline 请求，抄 queryId/features（最多 6 秒）
      const hasGql = await waitForGql(6000);
      if (shouldAbort()) { emitSync({ kind: 'skip', detail: t('inj_sync_left_cancel') }); return; }
      const headers = buildRequestHeaders();
      if (!headers) {
        emitSync({ kind: 'error', status: 'error', detail: t('inj_sync_no_headers') });
        return;
      }
      emitSync({ kind: 'start', force, gentle: true });

      const mentionsFirst = /\/notifications\/mentions/.test(location.pathname);
      const plan = mentionsFirst
        ? [['Mentions', MAX_PAGES], ['All', MAX_PAGES]]
        : [['All', ALL_PAGE_SHARE], ['Mentions', MAX_PAGES]];
      let failStatus = 0;
      let usedGql = false;

      if (hasGql) {
        for (const [tt, cap] of plan) {
          if (shouldAbort() || !budgetLeft()) break;
          const r = await pullGqlFeed(headers, tt, cap);
          if (r.ok) { usedGql = usedGql || r.pages > 0; continue; }
          failStatus = r.status;
          break;
        }
      }
      if (failStatus === 429 || failStatus === 401 || failStatus === 403) {
        syncState.status = 'error';
        syncState.detail = errDetail(failStatus);
        emitSync({ kind: 'error', status: 'error', detail: syncState.detail, pages: syncState.pages, events: syncState.events });
        return;
      }
      // 仅当 GraphQL 不可用时才退回 REST（不两套都拉，减少请求）
      if (!usedGql && !shouldAbort() && budgetLeft()) {
        const feeds = mentionsFirst ? [['mentions', MAX_PAGES]] : [['all', ALL_PAGE_SHARE], ['mentions', MAX_PAGES]];
        for (const [kind, cap] of feeds) {
          if (shouldAbort() || !budgetLeft()) break;
          const r = await pullRestFeed(headers, kind, cap);
          if (!r.ok) { failStatus = r.status; break; }
        }
        if (failStatus && syncState.pages === 0) {
          syncState.status = 'error';
          syncState.detail = errDetail(failStatus);
          emitSync({ kind: 'error', status: 'error', detail: syncState.detail, pages: 0, events: 0 });
          return;
        }
      }

      if (shouldAbort()) {
        emitSync({ kind: 'done', status: 'aborted', detail: t('inj_sync_aborted', [syncState.pages, syncState.events]), pages: syncState.pages, events: syncState.events });
        return;
      }
      const hitCap = !budgetLeft();
      syncState.status = hitCap ? 'capped' : 'done';
      syncState.detail = hitCap
        ? t('inj_sync_capped', [syncState.pages, syncState.events])
        : t('inj_sync_done', [syncState.pages, syncState.events]);
      if (syncState.events === 0 && syncState.pages > 0) {
        syncState.status = 'empty';
        syncState.detail = t('inj_sync_empty');
      }
      emitSync({ kind: 'done', status: syncState.status, detail: syncState.detail, pages: syncState.pages, events: syncState.events });
    } catch (e) {
      syncState.status = 'error';
      syncState.detail = String(e.message || e).slice(0, 80);
      emitSync({ kind: 'error', status: 'error', detail: syncState.detail, pages: syncState.pages, events: syncState.events });
    } finally {
      if (syncState.pages > 0) syncState.lastSyncAt = Date.now();
      syncState.running = false;
      syncState.stop = false;
    }
  }

  function stopAutoSync() {
    syncState.stop = true;
    try { if (inflight) inflight.abort(); } catch (_) {}
  }


  // ---- fetch hook ----
  const origFetch = window.fetch;
  window.__xOnewayOrigFetch = origFetch.bind(window);
  if (typeof origFetch === 'function') {
    const wrapped = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && (input.url || String(input)));
        if (/\/i\/api\//.test(String(url || ''))) {
          captureAuthFromInit(input, init);
          rememberGqlNotif(url, init);
          rememberFollowGql(url, init);
        }
      } catch (_) {}
      const p = origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && (input.url || String(input)));
        if (isHookedUrl(url)) {
          const reqBody = init && typeof init.body === 'string' ? init.body : '';
          p.then((res) => {
            if (!res || !res.ok) return;
            res.clone().json().then((json) => onApiResponse(url, json, reqBody)).catch(() => {});
          }).catch(() => {});
        }
      } catch (_) { /* never break the page */ }
      return p;
    };
    try { Object.defineProperty(wrapped, 'name', { value: 'fetch' }); } catch (_) {}
    window.fetch = wrapped;
  }

  // ---- XHR hook + header capture ----
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;
    const origSetHeader = XHR.prototype.setRequestHeader;
    XHR.prototype.open = function (method, url) {
      try {
        this.__xOnewayUrl = String(url || '');
        this.__xOnewayHeaders = {};
      } catch (_) {}
      return origOpen.apply(this, arguments);
    };
    XHR.prototype.setRequestHeader = function (k, v) {
      try {
        if (!this.__xOnewayHeaders) this.__xOnewayHeaders = {};
        this.__xOnewayHeaders[k] = v;
        const lk = String(k).toLowerCase();
        if (lk === 'authorization' || lk === 'x-csrf-token' || lk === 'x-twitter-auth-type' ||
            lk === 'x-twitter-active-user' || lk === 'x-twitter-client-language' || lk === 'x-guest-token') {
          captureAuthFromInit(null, { headers: this.__xOnewayHeaders });
        }
      } catch (_) {}
      return origSetHeader.apply(this, arguments);
    };
    XHR.prototype.send = function (body) {
      try {
        const url = this.__xOnewayUrl;
        if (/\/i\/api\//.test(String(url || ''))) {
          captureAuthFromInit(null, { headers: this.__xOnewayHeaders || {} });
          rememberGqlNotif(url, { body: typeof body === 'string' ? body : '' });
          rememberFollowGql(url, { body: typeof body === 'string' ? body : '' });
        }
        if (isHookedUrl(url)) {
          const reqBody = typeof body === 'string' ? body : '';
          this.addEventListener('load', () => {
            try {
              if (this.status < 200 || this.status >= 300) return;
              let json = null;
              if (this.responseType === 'json') json = this.response;
              else if (this.responseType === '' || this.responseType === 'text') {
                json = JSON.parse(this.responseText);
              }
              if (json) onApiResponse(url, json, reqBody);
            } catch (_) { /* ignore */ }
          });
        }
      } catch (_) { /* ignore */ }
      return origSend.apply(this, arguments);
    };
  }


  // control from content via postMessage（短窗去重，防止偶发双投）
  const recentCtrlAt = new Map(); // key → ts
  const CTRL_DEDUPE_MS = 800;
  function ctrlOnce(cmd, username) {
    const key = `${cmd}|${String(username || '').toLowerCase()}`;
    const now = Date.now();
    const last = recentCtrlAt.get(key) || 0;
    if (now - last < CTRL_DEDUPE_MS) return false;
    recentCtrlAt.set(key, now);
    if (recentCtrlAt.size > 80) {
      for (const [k, t] of recentCtrlAt) {
        if (now - t > CTRL_DEDUPE_MS * 4) recentCtrlAt.delete(k);
      }
    }
    return true;
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const d = ev.data;
    if (!d || d.__tag !== CTRL_TAG) return;
    if (d.cmd === 'i18n' && d.pack && typeof d.pack === 'object') {
      I18N = { ...I18N, ...d.pack };
      return;
    }
    if (d.cmd === 'sync-start') {
      if (!ctrlOnce('sync-start', d.force ? 'force' : 'auto')) return;
      runAutoSync({ force: !!d.force, lastSyncAt: Number(d.lastSyncAt) || 0 });
    } else if (d.cmd === 'sync-stop') {
      stopAutoSync();
    } else if (d.cmd === 'ox-sync-start') {
      if (!ctrlOnce('ox-sync-start', '')) return;
      runOutboundSync();
    } else if (d.cmd === 'ox-sync-stop') {
      oxState.stop = true;
    } else if (d.cmd === 'follow-create') {
      if (!ctrlOnce('follow-create', d.username)) return;
      createFollow(d.username, d.userId);
    } else if (d.cmd === 'follow-query') {
      const users = {};
      const list = Array.isArray(d.usernames) ? d.usernames : [];
      for (const u of list.slice(0, 80)) {
        const sn = String(u || '').toLowerCase();
        const c = followBySn.get(sn);
        if (c) users[sn] = { following: c.following, restId: c.restId || '' };
      }
      emitFollow({ kind: 'dump', users });
    } else if (d.cmd === 'sync-status') {
      emitSync({
        kind: 'status',
        running: syncState.running,
        pages: syncState.pages,
        events: syncState.events,
        hasAuth: !!buildRequestHeaders(),
        hasGql: !!(gqlNotif && gqlNotif.queryId)
      });
    }
  });

  // 离开页面立即中止
  window.addEventListener('pagehide', () => { stopAutoSync(); oxState.stop = true; });

  try {
    window.__xOnewayIxDebug = {
      findInstructionArrays, walkNotifInstructions, walkDetailInstructions,
      classifyIcon, classifyTweet, tweetInfo, actorsFromNotif,
      processRestNotifications, processResponse, runAutoSync, stopAutoSync,
      handleMutation, outboundPassive, onApiResponse, collectTweets, authorCache, runOutboundSync, oxStats, gqlOx,
      createFollow, followBySn, gqlFollow, learnUsersFromJson,
      version: VERSION
    };
  } catch (_) {}
})();
