# 诚信浇友 · Edge Add-ons 上架步骤（v1.7.2）

上传包：`dist/诚信浇友-edge-1.7.2.zip`（manifest.json 在 zip 根目录，直接传，不要再套一层文件夹）

## 1. 注册开发者（通常免费）
1. 打开 Partner Center：<https://partner.microsoft.com/dashboard>
2. 用微软账号登录 → 注册 **Microsoft Edge 计划**（Edge program），选「个人」即可
3. 填姓名 / 邮箱 / 地区 → 完成（Edge 不收注册费）

## 2. 新建扩展
Partner Center → Microsoft Edge → **Overview** → **Create new extension**

## 3. 上传包（Packages）
- 拖入 `诚信浇友-edge-1.7.2.zip`，等待校验通过
- 校验会读 manifest 的 name / version / 权限；以后更新必须 **version 比上次大**

## 4. 可用性（Availability）
- 可见性：**Public**（公开）或 Hidden（仅链接可装，适合先给朋友试）
- 市场：默认全部，或只勾中国 / 你需要的地区

## 5. 属性（Properties）
- 类别：**Productivity**（或 Social）
- **隐私政策 URL**：本扩展会读取并本地保存用户名 / 互动数据，**必须填**一个公开可访问页面（GitHub Pages / 博客 / Notion 公开页均可），内容可直接用 `STORE_LISTING.md` 的「隐私政策要点」
- 网站 / 支持联系方式：可填 GitHub 仓库或你的 X 主页 / 邮箱
- 成人内容：否

## 6. 商店文案（Store listings，至少一种语言，中文即可）
| 项 | 要求 | 来源 |
|---|---|---|
| 名称 | 取自 manifest：诚信浇友 | 自动 |
| 描述 | 必填，**≥250 字符** | `STORE_LISTING.md` 详细描述 |
| 扩展图标 | 128×128（建议 300×300 PNG） | `icons/icon128.png` |
| 截图 | 建议 1–10 张，1280×800 或 640×480 | 列表 / 时间线实拍截图 |
| 小宣传图 | 440×280，可选 | 可用推文配图裁剪 |
| 短描述 / 搜索词 | 可选 | 「关注 回关 互动 X Twitter」 |

## 7. 提交审核
- **Notes for certification**（给审核员说明）粘贴 `STORE_LISTING.md` 的「测试说明」，并说明：需登录 X 账号测试；无远程代码；数据仅本地
- 点 **Publish** → 审核通常几天，最长约 7 个工作日；邮件通知结果

## 必填清单
- [ ] zip（manifest 在根目录，version 递增）
- [ ] 描述 ≥250 字符
- [ ] 128 图标
- [ ] 隐私政策公开 URL
- [ ] 类别
- [ ] 审核说明（测试步骤）

## 常见拒因
1. **缺隐私政策 / 链接打不开 / 内容与实际行为不符**（最常见）
2. 描述太短、只写一句话，或没讲清用了哪些权限、为什么
3. 截图与功能不符、带无关或误导内容
4. 名称/图标容易被认成官方 X（避免用 X/Twitter 官方 logo，名称里别写「官方」）
5. 审核员无法复现：没给测试步骤（需说明要登录 X 账号）
6. 包内有未使用的权限、压缩/混淆代码或远程代码
7. 功能疑似自动化操作平台账号（本扩展不自动点赞/关注，审核说明里写明）

## 参考文档
- 发布总览：<https://learn.microsoft.com/microsoft-edge/extensions/publish/publish-extension>
- 注册开发者：<https://learn.microsoft.com/microsoft-edge/extensions/publish/create-dev-account>
- 更新已发布扩展：<https://learn.microsoft.com/microsoft-edge/extensions/publish/update-extension>
- 开发者政策：<https://learn.microsoft.com/legal/microsoft-edge/extensions/developer-policies>

---

## Git 还是网盘？
- **Edge / Chrome 上架**：只能上传 **zip 包**，Git 仓库不能直接交商店。
- **网盘**：丢 zip 最快，适合自己备份 / 发朋友「加载已解压的扩展程序」本地装。
- **GitHub 公开仓库**：方便写更新说明、收 Issues，隐私政策可直接用 GitHub Pages 托管；上架仍需另打 zip。
- **推荐**：Git 存源码 + Releases 挂 zip；网盘只放 zip 当备份。

### 朋友本地安装（网盘 zip）
1. 解压到一个固定文件夹（别删）
2. Edge 打开 `edge://extensions`（Chrome：`chrome://extensions`）→ 打开「开发人员模式」
3. 「加载解压缩的扩展」→ 选该文件夹 → 刷新 x.com
