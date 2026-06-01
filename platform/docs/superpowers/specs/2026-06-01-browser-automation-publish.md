# 浏览器自动化发布引擎（视频号 / 小红书 / 抖音）—— 设计与实施计划

> 状态：Step 2 plan —— Codex 计划评审已完成（gpt-5.5/xhigh，8/10），反馈已并入下文（见各节「Codex 修正」与 §Codex 评审采纳清单）
> 日期：2026-06-01
> 关联：`2026-05-31-multiplatform-publishing-infra.md`、`src/renderers/social-package.ts`、`src/publishers/manual.ts`、`src/platforms/registry.ts`

## Goal

把视频号 / 小红书 / 抖音三平台从「只生成人工复制粘贴的发布包」升级为「**Playwright 浏览器自动化**：复用运营在受控浏览器里建立的登录态，自动填标题/正文/话题、上传图文或视频、设封面，**默认只存草稿**，等人工点最终发布」。在没有真实账号的当下，用 **流程契约单测（FakeDriver）+ 本地 fixture HTML 真浏览器集成测试 + 真实登录页 checkLogin 探测 + Codex 评审** 多路验证方案可行；用户明早带登录态扫码后即可真机联调。

## 背景与现状（已读代码确认）

- 发布走 `POST /api/channel-contents/:id/publish` → `publishers[platform].publish()`。
  - `wechat` → 官方 API 建草稿（`stage=draft_created` → status `published`）。
  - `weixin_channels / xiaohongshu / douyin` → `ManualPublisher` 生成 `SocialPublishPackage` 存进 `publishResult.manualPackage`（`stage=manual_ready` → status `ready_to_publish`）。
- `SocialPublishPackage`（`renderers/social-package.ts`）已含发布所需全部数据：`platform / mode / publishUrl / title / caption / hashtags / assets[{role,url,filename...}] / checklist / warnings`。**素材 url 已是 OSS 1h presigned 直链**（Media afterRead hook）。源码两处注释明确写了 *"A future Playwright worker can consume this same package"* —— 本设计兑现它。
- 状态机（`workflow/states.ts`）：`approved → ready_to_publish → published`。
- 现有 TS 脚本运行约定：`cd platform && set -a; source .env; set +a; npx tsx scripts/xxx.ts`（见 `scripts/wx-test.ts`）。worker CLI 沿用此约定。

**关键环境事实（已实测）：**
- `playwright-core` + 系统 Chrome（`/usr/bin/google-chrome` v148）在本仓库环境可真实启动；`getByRole('button',{name:'发布'})` 中文文本定位、contenteditable `.fill()` 均正常。
- 三平台创作者页本环境可达（`creator.douyin.com` / `creator.xiaohongshu.com` / `channels.weixin.qq.com` 均 HTTP 200）→ 可跑「真实登录页 checkLogin」探测，无账号也能证明能识别未登录态。

## 借鉴的成熟开源框架（已实地读源码）

- **dreammis/social-auto-upload**（~1.2 万 star，Python + Playwright，多平台自动上传事实标准）：抖音 `uploader/douyin_uploader`、视频号 `uploader/tencent_uploader`、小红书 `uploader/xhs_uploader`。借鉴其**登录态用 storage_state/cookie 持久化 + 扫码引导、`cookie_auth` 校验失效、上传后轮询处理进度、默认可存草稿、定时发布**的工程模式与选择器策略。
- gitcoffee-os/postbot（registry.ts 已引用，交叉验证发布入口 URL）。
- Playwright 官方 `launchPersistentContext` / `storageState` / `setInputFiles` 文档。
- 各平台选择器细节由 `research-social-publish-automation` workflow 调研落入 `uploaders/selectors.ts`，**每条选择器标注来源**（真实页面观察 / 参考仓库 / 推测），并在 Codex 代码评审中交叉核对。

> ⚠️ 三平台均**无面向个人/中小运营的稳定开放发布 API**（抖音开放平台视频发布 API 需企业资质+应用审核+OAuth；小红书内容 API 邀请制；视频号内容发布无 API、仅小店/跳转类接口）。故浏览器自动化是**技术上可用的运营辅助路径**——但这不等于平台条款允许，**需业务方确认平台条款与账号风险**。官方 API 作为未来可选 uploader 预留接口（`registry.automation` 已有 `official_api` 取值）。

## 架构

### 决策 1：worker 是独立 Node 进程，不塞进 Next 服务

Playwright 不能跑在部署的 Next 服务里（无登录态、serverless 不宜常驻浏览器、上传视频是长任务会阻塞请求）。worker 作为**独立 CLI 进程**，跑在运营本机或专用 VPS（登录态所在处），消费 `SocialPublishPackage` 派生的 `BrowserPublishJob`，驱动 Chrome 完成发布。与 social-auto-upload 一致。

### 决策 2：依赖 `playwright-core`（非 `playwright`），驱动系统/指定 Chrome

`playwright-core` **无 postinstall 浏览器下载** → `npm ci` / CI 保持轻量、绿。浏览器优先 `channel:'chrome'`，`PW_EXECUTABLE_PATH` 兜底指定路径。**运行环境契约**（Codex 修正）：worker 启动前做 preflight（Chrome 可执行 + 版本、storage 目录可写、临时目录可写、能 setInputFiles）；失败时给「`npx playwright install chromium` 受控 fallback」而非仅文档提示。

### 决策 3：session 用 `launchPersistentContext` + userDataDir（Codex 修正）

视频号/小红书登录态是复杂 SPA（依赖 localStorage/IndexedDB/权限状态），纯 `storageState` 易丢。**主方案用 `launchPersistentContext({ userDataDir })`** 每平台一个持久化 profile，比 storageState 更完整。
- profile 默认放 `~/.lilink/publish-sessions/<platform>/`（**不在 repo 内**），目录权限 `0700`。
- **session 文件等同账号凭据**：文档明确不得上传/共享/提交；`.gitignore` 兜底忽略任何本地 session 目录；提供 `logout` 命令清除。

### 决策 4：`PageDriver` 依赖注入 —— 无浏览器下可确定性测试

uploader 只依赖最小 `PageDriver` 接口（`goto / fill / click / setInputFiles / waitForVisible / waitForHidden / type / getText / count / isEnabled / ...`）：
- `PlaywrightDriver`：真实实现（playwright-core），薄、易评审。
- `FakeDriver`：测试用，记录调用序列、可编排「元素存在/可见/可用」与「点击后出现下一步」。

→ uploader 的**流程契约**（填了什么、传了哪些文件、默认走草稿不点发布、未登录抛错、视频 vs 图文分支）可在 CI 用 FakeDriver 确定性断言。**注意（Codex 修正）：FakeDriver 测的是「我写下的流程契约」，不是真实平台可行性证据**；真实平台可行性由「真浏览器 fixture 测试（验证 PlaywrightDriver 对真实 DOM 的操作能力）+ 真实登录页 checkLogin 探测 + 明早登录态联调」共同支撑。三者职责分明、不混淆。

### 模块（全部新增，对现有发布链路零行为改动）

```
src/automation/
  driver.ts          # PageDriver 接口 + PlaywrightDriver（playwright-core）+ launch/preflight/选浏览器
  fake-driver.ts     # 测试用 FakeDriver（记录动作序列 / 可编排 DOM 状态）
  session.ts         # 每平台 userDataDir 路径(~/.lilink/...，0700)、persistent context、logout
  assets.ts          # presigned url → 本地临时文件（含校验/限大小/保留扩展名/finally 清理）
  job.ts             # BrowserPublishJob 类型 + buildBrowserJob(manualPackage)（纯映射，不重渲染）
  uploaders/
    types.ts         # Uploader 接口：{ platform, checkLogin(driver), publish(driver, job, opts) }
    selectors.ts     # 三平台选择器集中为命名常量（每条标来源），便于评审与漂移维护
    douyin.ts xiaohongshu.ts weixin-channels.ts
    index.ts         # platform → uploader 注册表
  run.ts             # runBrowserPublish(job, opts)：preflight→launch→pick uploader→login gate→publish→result
  errors.ts          # NeedsLoginError / PreflightError / SelectorNotFoundError（可操作中文报错）
  index.ts           # barrel
scripts/
  publish-worker.ts  # CLI：doctor / login / export / run / logout（见下）
```

### CLI 命令（Codex 修正：补「明早可跑」的端到端路径）

- `doctor [--platform p]`：preflight 自检（Chrome 可启动、fixture 可跑、storage/temp 目录权限）。
- `login --platform <p>`：headed 打开发布页，运营扫码；持久化到 userDataDir。
- `export --content-id <id> --out job.json`：用 Payload Local API（`getPayload({config})`，与现有 scripts 同模式）读该稿 `publishResult.manualPackage` → 写出 `BrowserPublishJob` JSON。**这是「从 `ready_to_publish` 稿件到 worker」的关键一环**。
- `run (--job job.json | --package manualPackage.json | --stdin) [--headed] [--draft|--publish] [--fill-only] [--slow-mo ms] [--dry-run]`：执行发布。**默认 `--draft`**；`--publish` 必须显式且二次确认；`--fill-only` 半自动降级（只开页+下载素材+填字段，上传/保存交人工）。
- `logout --platform <p>`：清除该平台 userDataDir 登录态。

**明早端到端流程**（写进文档）：studio 现有发布生成 manualPackage → `npx tsx scripts/publish-worker.ts export --content-id <id> --out job.json` → `... login --platform xiaohongshu`（扫码）→ `... run --job job.json --headed --draft` → 平台草稿箱核对 → 人工点发布。

### `BrowserPublishJob` 契约（worker 输入）

```ts
interface BrowserPublishJob {
  platform: 'weixin_channels' | 'xiaohongshu' | 'douyin'
  mode: 'image_note' | 'video'
  publishUrl: string
  title: string
  caption: string            // 正文（已含话题/链接，来自 social-package，不重渲染）
  hashtags: string[]
  assets: { role: 'image'|'video'|'horizontal_cover'|'vertical_cover'; url?: string; filename?: string }[]
  limits: { titleMax: number; bodyMax?: number; tagsMax?: number }
  contentId?: string
}
```
`buildBrowserJob` 仅从 `SocialPublishPackage` 直接映射（纯函数、易测、不与现有 renderer 产生双源）。

## Touch surface

- `src/automation/**`（全新，约 12 文件）。
- `scripts/publish-worker.ts`（全新）。
- `package.json` —— 加 `playwright-core` 依赖 + `tsx` devDep（让 worker 可靠运行）；**风险单列**：新增依赖、lockfile 变更、CI `npm ci` 范围。
- `.gitignore`（platform/）—— 忽略本地 session/临时目录兜底（`~/.lilink` 在 home 外、本不会进 repo，仍兜底防误放）。
- `src/platforms/registry.ts` —— 仅在 `notes` 标注「已支持浏览器自动化」，不改数据契约。
- `tests/automation/**`（全新）—— 流程契约单测、job 映射单测、fixture HTML（含非 happy-path）、selector-contract 测试、gated 真浏览器集成测试。
- `vitest.config.ts` —— include 已是 `tests/**/*.test.ts`，无需改；真浏览器测试用 `describe.skipIf(!process.env.RUN_BROWSER_TESTS)` gate（与现有 `skipIf(!DATABASE_URI)` 同模式）。
- `docs/superpowers/specs/2026-06-01-browser-automation-publish.md`（本文件）。
- **承诺（措辞收紧）**：不改变现有 HTTP 发布链路与状态机行为；仅新增独立 worker 能力。**不改** `endpoints/publish.ts`、`publishers/*`、`renderers/social-package.ts`、studio 现有发布流程。闭环回报（worker→status published）与 studio UI 面板留 PR#5。

## Edge cases & risks（含 Codex 修正）

- **选择器漂移**：选择器集中命名常量 + 优先 role/placeholder/文本/`input[type=file]` 稳健策略 + 每步超时与中文可操作报错（指明哪步、建议人工接管/`--fill-only`）+ 文档「漂移维护清单」。
- **登录态过期**：`checkLogin` 检测；失效抛 `NeedsLoginError`，提示重跑 `login`。
- **素材 url 过期/损坏**（assets.ts）：下载前校验响应（状态码 + content-type）、URL 过期(403/链接失效)给「请重新生成发布包」中文提示、保留原始扩展名/MIME、限制最大文件大小、`finally` 清理临时文件。
- **风控/频控**：默认 headed、默认存草稿、单次单稿、`--slow-mo`/小随机延时、人工确认；不承诺规避风控。registry 小红书 notes 已警示「避免高频批量」。
- **CI 无浏览器**：真浏览器测试 gate；CI 只跑流程契约 + job 纯逻辑 + selector-contract（对 fixture）测试。
- **视频上传/转码慢**：轮询「上传完成」标志再继续；超时给可操作报错。
- **Out of scope（本 PR 不做）**：① worker 自动回报结果 + 状态机闭环（PR#5）；② studio 登录状态/一键浏览器发布/结果 UI 面板（PR#5）；③ 官方 API uploader（仅留接口）；④ X / B 站。

## Verification

- [ ] 非变异检查：`npx tsc --noEmit`；`npx vitest run --no-file-parallelism` 全绿（含现有 DB 测试，需 `lilink-pg` 5433）。
- [ ] 新增测试：`job.test.ts`（映射/截断/缺素材告警）、`uploaders.fake.test.ts`（三平台流程契约 + 默认不点发布 + 未登录抛错 + 视频/图文分支）、`selectors-contract.test.ts`（每条选择器在对应 fixture 中唯一/合理匹配）、`playwright.fixture.test.ts`（gated，真 Chrome 驱动 fixture：标题填入/setInputFiles/话题/草稿|发布；含未登录页、上传中→完成、按钮 disabled→enabled）。
- [ ] 真浏览器证据：本机 `RUN_BROWSER_TESTS=1` 跑 fixture 集成测试 + 对三平台真实登录页跑 `checkLogin` 返回「未登录」，贴输出。
- [ ] Codex 代码评审：选择器/流程对照参考仓库 + 功能正确性 + edge case。
- [ ] PR + CI 绿。
- [ ] 文档写明用户明早端到端联调流程（export→login→run --draft）。

## Alternatives considered（含 Codex 补充）

- **官方 API 直发**（否决为主路径）：三平台对个人/中小运营无可用开放发布 API。留作未来可选 uploader。
- **worker 跑在 Next 服务内**（否决）：无登录态、serverless 不宜常驻浏览器、长任务阻塞。
- **依赖 `playwright`（含浏览器下载）**（否决）：`npm ci`/CI 触发下载，重且 CDN 可能 flaky。`playwright-core` + 自带 Chrome 更稳。
- **纯 `storageState`（非 persistent context）**（降级为次选）：复杂 SPA 登录态易丢 localStorage/IndexedDB。主用 `launchPersistentContext`；storageState 作为可移植导出的次选。
- **CDP 接管运营已开的 Chrome（`--remote-debugging-port`）**（高级 fallback，不作主路径）：复用真实 profile、扫码/风控更接近人工；但安全暴露面大、现有标签状态不可控、测试复现差、误操作风险高。
- **浏览器扩展/书签脚本半自动**（备选）：风控感知更像人工；但安装/权限成本高、测试发布复杂、不擅长批量素材。选择器漂移严重时再考虑。
- **半自动降级（`--fill-only`）**（已纳入本 PR）：若真实上传/转码选择器不稳，至少自动开页+下载素材+填标题正文话题，上传与保存人工完成——明早即便全自动失败也有可交付收益。

## Codex 评审采纳清单（gpt-5.5/xhigh）

1. 运行环境契约 + `doctor` 命令 + chromium 受控 fallback ✅
2. 测试分层措辞收紧（FakeDriver=流程契约，非可行性主证据）+ fixture 非 happy-path + 选择器来源标注 + selector-contract 测试 + 真实登录页 checkLogin 探测 ✅
3. 「零回归」措辞收紧为「不改现有 HTTP 发布链路/状态机行为」+ package.json/lockfile/.gitignore 列入 touch surface + assets.ts 健壮性 + buildBrowserJob 不重渲染 ✅
4. 补「明早可跑」端到端路径：`export --content-id`（读 manualPackage）+ `--package` 直接消费 + 文档端到端流程 ✅
5. session 安全：`~/.lilink/publish-sessions/`(0700)、等同凭据不外传、`logout` 命令、默认 `--draft`+`--publish` 二次确认+测试断言默认不点发布、`--slow-mo`、合规措辞「需业务方确认条款」✅
6. Alternatives 补 CDP/persistent-context/扩展/半自动降级 ✅

## Codex 代码评审采纳（gpt-5.5/xhigh，第二轮）

对实现的逐条评审与修复：
- [Critical] uploader 一度是桩 → 已实现完整 `createUploader` 工厂流程。
- [High] `publish-worker.ts` tsc 报错（ChannelContent→Record 直转）→ 经 `unknown` 二步转。
- [High] `export` 改为**优先读已持久化的 `publishResult.manualPackage`**（与中台 ready_to_publish 一致），缺失才从字段重建并告警；error 级告警阻断导出。
- [High] 视频号 `image_note` 误路由到视频页 → `publishUrl` 改为 mode 相关（图文走 finderNewLifeCreate）。
- [High] `--fill-only --publish` 非法组合 → 显式拒绝。
- [High] 抖音图文上传后跳 `content/post/image` → `afterUploadUrl` 正则容 publish/post/video/post/image 三者。
- [Medium] `run.ts` 清理与关浏览器改 `Promise.allSettled`，cleanup 失败不掩盖原始错误、不泄漏浏览器。
- [Medium] `assets.ts` 加 `AbortController` 下载超时；报错/日志**脱敏 presigned URL**（去 query 签名）。
- [Medium] 非 fill-only 却无素材 → 硬失败，不发空内容。
- [Medium] 小红书正文优先 `.ql-editor[contenteditable]`，避免选到占位节点。
- [Medium] `.gitignore` 补本地 session/job 文件忽略（凭据兜底）。
- 补「失败注入」契约测试（上传卡住/发布不跳转/无素材硬失败），回应「FakeDriver 自证」质疑。

## 真实登录页探测证据（无账号，验证 loginMarkers 非自证）

用系统 Chrome 全新（未登录）context 打开三平台真实创作者页，核对 `loginMarkers` 是否真能识别未登录（2026-06-01 实测）：
- **抖音** `creator.douyin.com/.../upload`：停在上传页，`text=扫码登录` 命中 → ✓
- **小红书** `creator.xiaohongshu.com/publish?target=video`：302 到 `/login?redirectReason=401`，`div[class*="login-box"]` 命中 → ✓
- **视频号** `channels.weixin.qq.com/platform/post/create`：302 到 `/login.html`，`iframe[src*="login"]` 命中 → ✓

三平台均能正确识别未登录（checkLogin 会抛 NeedsLoginError）。说明明早 `login` 流程能正确触发扫码、登录态校验可用。（注：小红书/视频号的 `text=扫码登录` 文案 marker 未命中，靠 login-box/iframe 兜底——markers 取并集，冗余无害。）
