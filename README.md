# 诚信浇友 v1.7.1

> Honest Mutuals · X 关注与互动标注（原名「X 单向关注高亮」）

Chrome / Edge（Chromium 111+）通用 Manifest V3 扩展。

## 打赏支持

如果这个扩展帮到你，欢迎微信扫码请杯咖啡（可选）：

<p align="center">
  <img src="docs/wechat-tip.jpg" alt="微信赞赏码" width="280" />
</p>

## 功能

1. **正在关注**（`/following`）：高亮「我已关注、对方未回关」→ 橙色「未回关」
2. **关注者**（`/followers`、`/verified_followers`）：高亮「蓝 V 且你还没回关」→ 蓝色「蓝V待回关」
3. **互动两块**（列表 handle 行 + 时间线作者行），两枚胶囊：
   - 列表：`被互动 3` `我互动 5`；时间线（窄）：`被 3` `我 5`
   - 一边有数就两边都显示（为 0 的那边是淡色描边）；两边都 0 → 一枚淡色「暂无互动」（时间线「暂无」）
   - 只开一块时，0 显示「被·暂无」或「我·暂无」；你自己的行不标
   - 悬停分两段：

   | 模块 | 悬停分项 | 含义 | 存储字段 |
   |---|---|---|---|
   | **被互动**（别人对你，绿色） | 评你的帖 | 别人回复了**你的原帖** | `inbound.replies` |
   | | 回你的楼 | 你去评论后，对方**回复了你的回复** | `inbound.threadReplies` |
   | | 引用你 | 别人引用你的帖/回复 | `inbound.quotes` |
   | | 点赞你 | 别人点赞你的帖/回复 | `inbound.likes` |
   | | 转帖你 / 提及你 | 附带记录（有数才显示） | `inbound.retweets / mentions` |
   | **我互动**（你对别人，紫色） | 我回复 | 你回复了对方的帖 | `outbound.replies` |
   | | 我点赞 | 你点赞了对方的帖 | `outbound.likes` |
   | | 我转帖 | 你转帖了对方的帖 | `outbound.retweets` |
   | | 我引用 | 你引用了对方的帖 | `outbound.quotes` |

   - 两块**严格分开**：你发的内容永远不会进「被互动」；别人的操作永远不会进「我互动」。
   - popup 可分别开关「显示被互动」「显示我互动」（1.5.x 的「显示互动标注」关着的话两块都默认关）。

4. **时间线一键关注（1.7.0）**
   - 仅在 `article[data-testid=tweet]` 作者行：若判断**当前账号未关注**该作者，在「被互动 / 我互动」**之前**显示小胶囊「关注」
   - 顺序：`关注` → `被 N` → `我 N`
   - 关注状态：从页面已加载的 GraphQL 用户对象学习 `relationship_perspectives.following` / `legacy.following`；不确定时**仍显示**按钮（点后若已关注会提示并隐藏）
   - 点击后用你的网页登录态调用与 X 网页相同的关注接口（优先抄到的 GraphQL `Follow`；否则 REST `friendships/create.json`）。**仅单次点击**；同一用户 10 秒内不可重复点；全局约每分钟最多 20 次
   - 列表 UserCell 已有原生关注按钮，**不重复插入**
   - popup「时间线显示关注按钮」默认开，可关
   - **不会**自动扫列表批量关注

### ⚠️ 「被互动」数据来源（与 1.5.1 相同，未加大请求）

- **通知页温和同步**：进入 `/notifications` 约 2–3 秒后，复用页面登录态分页拉通知（先「全部」≤10 页，再 Mentions）。页间隔 **2.5–4 秒**抖动；单次 ≤**15 页**或 **300 条**；自动 **30 分钟冷却**；手动按钮需二次确认且距上次 ≥3 分钟；离开通知页立即中止；遇 429/401 即停。token 只在内存，不写 storage、不打日志。
- **被动**：页面自己加载的通知、你打开**自己的帖子**时加载的回复（TweetDetail，DOM 兜底）。
- 只拿得到通知里还能翻到的范围，不是官方全量历史。

### ⚠️ 「我互动」数据来源与局限

按优先级：
1. **实时 hook（主路径，零额外请求）**：页面主世界只读 hook 你自己操作成功后的 GraphQL 响应：
   - `FavoriteTweet` → 我点赞（目标作者：tweetId→作者缓存，缓存没有就从页面上该帖的链接取）
   - `CreateRetweet` → 我转帖
   - `CreateTweet` / `CreateNoteTweet`：带 `reply` → 我回复；带 `attachment_url` / 引用 → 我引用（同时是回复+引用会各记一次）
   - 只认成功响应；对自己的帖操作（自回自、赞自己）不计；**取消赞/取消转帖不扣减**
2. **被动补记（零额外请求）**：浏览任何时间线 / 对方主页 / 对话页时，页面已加载的推文里：别人的帖带 `favorited=true` → 我点赞、`retweeted=true` → 我转帖；你发的回复 → 我回复；你发的引用 → 我引用。按推文 ID 去重，所以重复看到不会重复记。
3. **手动温和补历史（默认关闭）**：只有你在**自己的**「喜欢」页（`x.com/你/likes`）或「回复」页（`x.com/你/with_replies`）点 popup「同步我的互动」（需二次确认）才会翻页：抄页面自己的 `Likes` / `UserTweetsAndReplies` 请求模板，页间隔 2.5–4 秒、单次 ≤**10 页**、两次至少隔 **10 分钟**、离开该页即停、与通知同步互斥。
- 局限：**我互动主要是安装后实时累计**；历史只能靠第 2/3 条补一部分（喜欢页只能翻到较近的若干页，转帖历史基本只能靠浏览时遇到），手机 App / 其他浏览器上的操作记不到。

### 关于官方 X API

X 开发者 API 有 *Liked Tweets*（`GET /2/users/:id/liked_tweets`）、用户推文时间线等端点，能查你点赞过/发过的内容，但需要开发者账号、按套餐计费且额度有限，还要自己保管 Bearer / OAuth 凭据。本扩展**不要求填写任何 API Key**，以网页登录态下的被动 hook + 可选的手动温和同步为主。

## 安装 / 更新

### Chrome
1. `chrome://extensions`
2. 开发者模式 → 加载已解压的扩展程序 → 选择本文件夹
3. **更新后点「重新加载」，再刷新已打开的 x.com**

### Edge
1. `edge://extensions`
2. 开发人员模式 → 加载解压缩的扩展 → 选择本文件夹
3. **更新后点「重新加载」，再刷新 x.com**

## 用法

1. 打开 https://x.com/notifications → 约 2 秒后开始温和同步「被互动」（约 30–60 秒，别切走）。
2. 平时照常点赞 / 转帖 / 回复 / 引用 → 「我互动」实时 +1。
3. 想补「我互动」历史：打开 `x.com/你的用户名/likes`（或 `/with_replies`）→ popup「同步我的互动（手动·较慢）」→ 再点一次确认。
4. 看关注/粉丝列表或时间线 → `被互动 N` `我互动 N`（时间线 `被 N` `我 N`），悬停看两段明细。
5. 时间线未关注的作者行可点「关注」一键关注（可在 popup 关闭该按钮）。
6. popup：当前账号、被互动/我互动各跟踪多少人、上次同步时间；清空只清**当前账号**（两块一起）。

## 存储（schemaVersion 4）

```
accounts[我的handle] = {
  inbound:  { [对方]: { replies, threadReplies, quotes, likes, retweets, mentions, total, lastAt } },
  outbound: { [对方]: { replies, likes, retweets, quotes, total, lastAt } },
  seenInboundIds:  [...],   // 入站去重（tw:<推文id>:<用户> / 通知id）
  seenOutboundIds: [...],   // 出站去重（like:<id> / rt:<id> / tw:<我的推文id> / q:<我的推文id>）
  lastSyncAt, lastOutboundSyncAt, displayName
}
```
- 升级迁移：旧 `interactions` → `inbound`，旧 `seenNotificationIds` → `seenInboundIds`，`outbound` 空起步；不再写顶层镜像字段。
- 换号自动切库；未识别账号时先记到 `_pending`，识别后合并。

## 实现说明

- `inject.js`（MAIN）：hook fetch/XHR。入站：通知 / TweetDetail 解析 + 通知页温和同步。出站：写操作成功响应 + 时间线类只读响应（tweetId→作者缓存、favorited/retweeted/我的回复引用）+ 手动 Likes/UserTweetsAndReplies 同步。入站与出站用不同 postMessage 通道。
- `bridge.js`：两通道分别校验、短窗去重、限流，转 `X_ONEWAY_IX` / `X_ONEWAY_OX`。
- `background.js`：唯一写入者，schema 4 迁移、分账号分方向记账。
- `content.js`：两枚胶囊打标、进/出通知页启停同步、我互动手动同步入口、DOM 自检。
- 测试：`node test/test-1.6.0.js`、`test-ox-sync.js`、`test-bg.js`、`test-1.5.1.js`、`test-sync.js`；UI/DOM 测试需 jsdom（`NODE_PATH=… node test/test-ui-1.6.0.js`）。

## 说明

- 不自动关注 / 取关 / 点赞 / 发帖
- 蓝 V 识别依赖页面图标，X 改版可能需调整
- X 改 API 时互动统计可能失效，需更新扩展
- 风险：过度同步 → **429**；登录失效 → **401**（toast 会提示）

## 版本

### v1.6.1
- 品牌更名为「诚信浇友」（Honest Mutuals），仅改名称与文案，功能同 1.6.0

### v1.6.0
- 新增「我互动」模块（我回复 / 我点赞 / 我转帖 / 我引用），与「被互动」分两枚胶囊同时显示；popup 分别开关
- 我互动来源：写操作成功响应实时 hook + 浏览时被动补记 + 你自己喜欢/回复页的手动温和同步（默认关）
- 存储 schema 4：`inbound` / `outbound` 分开、去重 ID 分开；旧数据迁入 inbound
- 通知温和同步参数不变

### v1.5.1
- **修复评论一直为 0**：X 通知里的回复/引用条目 `entryId` 是 `notification-…`、内容却是 `TimelineTweet`，旧版按前缀走了通知分支被丢弃；现在按内容类型分派（含 module 包裹的条目）
- 评论口径拆分：评你的帖 / 回你的楼 / 引用你 / 点赞你；自己的推文一律不计
- 新增单帖通路：打开你自己的帖子时被动记录回复（TweetDetail 解析 + DOM 兜底），不额外请求
- 温和同步：2.5–4s 抖动、≤15 页/300 事件、30 分钟冷却、2s+ 启动延迟、单队列、离页即停；覆盖 Mentions；REST 仅兜底
- 首屏通知早于导航渲染时延迟解析，避免把回复误判成提及；长通知 ID 改哈希，修复分组点赞截断撞 key

### v1.5.0
- 通知页自动分页拉取（限速/上限/10 分钟冷却；popup 可强制同步）
- 按登录账号分库存；换号不串；迁移 schema 2→3
- 加强评论 / 引用 / 分组点赞解析；popup 最近捕获区分三类；通知页 DOM 自检

### v1.4.1
- 修复通知记不上：TimelineTweet 回复、分组点赞、REST notifications、toast/popup 捕获状态
