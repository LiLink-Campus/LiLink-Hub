# 自动发布 UI + 结果回报闭环（PR#5）—— 设计与实施计划

> 状态：设计已与用户确认（2026-06-01，用户选择：自适应一键+命令 / 自动回报+人工确认 / 发布页面板+队列看板 / 共享密钥 token），待 Codex 计划评审。
> 依赖 PR#4「浏览器自动化发布引擎」（分支 worktree-multi-platform-publish）。本 PR 栈在其上，base=该分支。
> 关联：`2026-06-01-browser-automation-publish.md`、`src/automation/`、`src/endpoints/publish.ts`、`src/app/(app)/studio/`。

## Goal

让运营在中台直接驱动 PR#4 的浏览器自动发布：**发布页**与**发布队列看板**显示每条 `ready_to_publish` 稿的「一键发布（同机时）或可复制命令（分离部署时）+ 上次发布结果」；worker 跑完**自动把结果回写中台**展示；`status→已发布` 仍由运营人工确认（防误判）。

## 用户已定决策

- **触发：自适应一键+命令**。`LILINK_WORKER_LOCAL=1`（studio 与登录态同机）→ 显示「一键浏览器发布(草稿)」按钮；否则显示可复制命令。
- **回报：自动回报 + 人工确认**。worker 回写 `publishResult.browserPublish`；不自动改 status。
- **落点：发布页面板 + 队列看板**。
- **鉴权：共享密钥 token**（`WORKER_REPORT_TOKEN`）。

## 架构与组件

### 1. 数据（迁移：1 个 json 列）

`ChannelContents.publishResult` 组加字段 `browserPublish`（type `json`，readOnly，access.update:()=>false——同 publishResult 其它字段，只能经 endpoint 内部 payload.update 写）：
```ts
interface BrowserPublishResult {
  platform: ManualPlatformCode
  mode: 'image_note' | 'video'
  stage: 'staged' | 'published' | 'failed'  // staged=已填好待人工点；published=worker已点发布且成功；failed=出错
  draftUrl?: string                          // 成功页/草稿链接（尽力而为）
  error?: string                             // 失败原因（已脱敏）
  title?: string                             // 实际填入标题
  at: string                                 // ISO 时间
}
```

### 2. worker 回报（`src/automation/` + CLI）

- CLI 新增 `run --content-id <id>`：内部「读库导出 job（复用 export 逻辑）→ 发布」一步完成（手动与一键共用；现有 `--job/--package/--stdin` 保留）。
- CLI 新增 `--report`：发布结束（成功/失败都）`POST ${LILINK_STUDIO_URL}/api/channel-contents/<id>/browser-result`，头 `Authorization: Bearer ${LILINK_WORKER_REPORT_TOKEN}`，body 为 `BrowserPublishResult`。回报失败只 warn 不影响发布本身。
- 抽一个 `src/automation/report.ts`：`reportResult(studioUrl, token, id, result)`（纯 fetch + 错误吞掉），便于单测（mock fetch）。

### 3. 回报 endpoint（`src/endpoints/browserResult.ts`，挂在 ChannelContents）

`POST /:id/browser-result`：
- 鉴权：读 `Authorization: Bearer <token>`，与 `process.env.WORKER_REPORT_TOKEN` 常量时间比较；token 未配置 → 501（功能未启用）；不匹配 → 401。**不依赖登录会话**（worker 无 cookie）。
- 校验 body 形状（platform/mode/stage 合法值），id 存在。
- 经 `payload.update` 写 `publishResult.browserPublish`（Local API overrideAccess），**不改 status**。
- 返回 `{ ok: true }`。

### 4. 一键触发（server action，仅 `LILINK_WORKER_LOCAL=1`）

`studio/publish/[id]/actions.ts` 加 `triggerBrowserPublish(id)`：
- 仅当 `process.env.LILINK_WORKER_LOCAL === '1'` 才允许，否则抛中文错误。
- 鉴权：复用 `getPayloadAndUser`（必须登录运营）。
- `child_process.spawn('npx', ['tsx', 'scripts/publish-worker.ts', 'run', '--content-id', id, '--report'], { cwd: platformRoot, detached: true, stdio: 'ignore' })`，参数**数组传入、不拼 shell**；id 先校验是受支持平台的 ready_to_publish 稿。`unref()` 后立即返回「已启动」。worker headed 在运营屏幕弹浏览器；结果经 endpoint 回写，UI 轮询。
- 安全：固定命令、无 shell 注入面、env 门控、登录态在本机——契合自部署小团队模型。

### 5. UI：发布页面板（`studio/publish/[id]`）

`page.tsx` 服务端补充传入：`workerLocal:boolean`（env 派生）、`browserPublish`（最新结果）、`exportCmd/runCmd`（字符串，含 id）。`PublishEditor` 对手动平台、状态 approved/ready_to_publish 渲染新子组件 `BrowserPublishPanel`：
- workerLocal → 「一键浏览器发布（草稿）」按钮（调 `triggerBrowserPublish`，触发后轮询 `refreshBrowserResult(id)` 每 ~3s 看 `browserPublish` 更新）+ 可折叠「或手动命令」。
- 否则 → 可复制命令块（export + run，复用现有 `CopyableText` 模式）。
- 始终显示：上次结果（stage 徽章 / draftUrl 链接 / error / 时间）+ 刷新按钮 + 「标记已发布」（复用现有 markPublished 流转，仅 ready_to_publish 可点）。
- 新 server action `refreshBrowserResult(id)`：取最新 `publishResult.browserPublish` 返回（供轮询/刷新）。

### 6. UI：发布队列看板（新页 `studio/queue/page.tsx`）

服务端列出所有 `ready_to_publish`（手动平台）渠道稿（复用 `listReviewQueue` 思路或新查询），每行：标题 / 平台 / browserPublish 状态徽章 / 「复制命令 or 一键」/ 跳发布页。复用现有 `_ui` 卡片与主题。studio 导航加入口。

## Touch surface

- `src/collections/ChannelContents.ts` —— publishResult 加 `browserPublish` json 字段。
- `src/endpoints/browserResult.ts`（新）+ `src/payload.config.ts`（挂载该 endpoint）。
- `src/automation/report.ts`（新）、`scripts/publish-worker.ts`（`run --content-id`、`--report`）、`src/automation/run.ts`（支持 content-id 入口/回报钩子，按需）。
- `src/app/(app)/studio/publish/[id]/`：`page.tsx`（传 workerLocal/result/cmds）、`actions.ts`（triggerBrowserPublish/refreshBrowserResult）、`PublishEditor.tsx`（挂 BrowserPublishPanel）、新 `BrowserPublishPanel.tsx`。
- `src/app/(app)/studio/queue/page.tsx`（新）+ studio 导航入口。
- `src/app/(app)/studio/_lib/`：按需加 `listPublishQueue` 查询 + 命令字符串助手。
- `.env.example`：`WORKER_REPORT_TOKEN`、`LILINK_STUDIO_URL`、`LILINK_WORKER_LOCAL`。
- 文档：本 spec + 更新 `docs/browser-publish-worker.md`（加回报/一键/env 说明）。

## Edge cases & risks

- **迁移**：生产需 `payload migrate` 加 `browserPublish` 列（dev 走 push）。计入上线迁移清单。
- **spawn 安全**：仅 env 门控；参数数组、无 shell；headless 服务器误开 → worker 自身 doctor/启动失败有中文报错。
- **回报鉴权**：token 未配 → endpoint 501（不静默放行）；常量时间比较防时序。token 经 env，不入库/日志。
- **轮询**：触发后 UI 轮询 `browserPublish.at` 变化；worker 未回报（崩溃）→ 轮询超时给「请看 worker 终端」提示，不空转。
- **draft 语义**：一键默认 draft（worker 填好、headed 保留浏览器交人工点发布）；worker 回报 `stage:staged`。运营在弹出的浏览器点发布后，自行在中台点「标记已发布」。
- **零回归**：不改现有 publish/transition endpoint 与公众号路径；只新增。
- **Out of scope**：全自动 status 闭环；headless 一键；worker 实时 stdout streaming 到前端（用轮询替代）。

## Verification

- 单测：`browserResult` endpoint（token 校验 401/501、写库不改 status、body 校验）；`report.ts`（mock fetch 成功/失败吞错）；`triggerBrowserPublish`（mock child_process.spawn、env 门控、未登录/非法状态拒绝）；`run --content-id` 映射。
- 现有 `tsc --noEmit` + 全量 vitest（含 DB）保持绿；CI 不跑 build。
- 手动验证（明早，可选）：设 `LILINK_WORKER_LOCAL=1 WORKER_REPORT_TOKEN=xxx`，发布页点一键 → 浏览器弹出 → worker 回报 → 面板出结果。
- Codex 计划评审 + 代码评审。

## Alternatives considered

- **全自动 status 闭环**（否决，用户选人工确认）：平台是否真发成功难 100% 判定，误报「已发」风险。
- **worker stdout 实时 streaming（SSE）**（否决）：复杂且脆；轮询 `browserPublish` 足够。
- **Payload API Key 鉴权**（否决，用户选 token）：要改 Users useAPIKey + 生成密钥，比共享 token 重。
- **同分支并入 PR#4**（否决）：栈成独立 PR，引擎与 UI 各自聚焦评审、可独立合并（#4 合并后 GitHub 自动改基）。
