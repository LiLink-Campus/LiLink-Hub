# 小红书式图文笔记编辑器 — 设计

- 日期：2026-06-02
- 分支：`worktree-xiaohongshu-note-editor`
- 状态：待实现（已与用户对齐方向）

## 1. 背景与目标

发布中台的图文稿（视频号 / 小红书 / 抖音 的 `image_note` 形态）目前在创作页
（`src/app/(app)/studio/compose/imagetext/[id]/page.tsx`）用的是纯文本 `Textarea` 写文案、
话题留到「发布」步骤用独立字段填。长文（公众号）那条已有一套成熟的 Lexical Typora 式
WYSIWYG，但**小红书图文与公众号长文是两种不同范式**，不能直接照搬。

**目标**：把图文稿正文做成**贴合小红书后台实际效果**的轻富文本编辑器，让运营在中台内一处编完即所见即所得；
视频稿保持「上传 + 填 meta」不变。

**关键认知**：小红书笔记正文本质是「纯文本 + #话题 + emoji + 分段」，**不支持** H2 标题 / 加粗 / 列表 / 引用
那套富排版，图是「顶部一组」而非正文内联。照搬公众号长文的富排版，发到小红书这些样式会全部丢失，反而不贴合。

## 2. 范围

**做**：图文稿创作页的正文编辑器（小红书式轻富文本）、图组区体验打磨、右侧手机卡片实时预览、
按平台 limits 的字数/话题计数、`social-package` 的「正文为准」改造。

**不做**：视频稿页（已满足「上传+meta」，保持不动）、发布/审核/队列页结构、自动化 worker、状态机、
数据库迁移（复用现有字段）。

## 3. 已对齐的设计决策

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | 正文范式 | 小红书式轻富文本（#话题高亮+联想、emoji、分段、字数；**不做** H2/加粗/列表） | 小红书正文不支持富排版，照搬公众号长文会丢样式 |
| 2 | 图片范式 | 顶部图组（图文分离），沿用现状结构 | 贴合小红书「图组+标题+正文」形态 |
| 3 | 话题输入 | 正文内打 `#` 弹联想，`socialTags` 从正文解析 | 贴合小红书后台 |
| 4 | 编辑器技术 | 复用 Lexical（`@lexical/hashtag` + Typeahead），非自研 | 复用现有依赖/保存机制，技术栈统一 |
| 5 | 数据流 | **正文为准**：`socialDescription` 存含 #话题 的完整文案；`socialTags` 从正文解析镜像；发布包 caption 直接用正文 | 所见即所得，最贴小红书 |
| 6 | 实时预览 | 右侧小红书手机卡片 | 边编辑边看最终效果 |
| 7 | 话题联想源 | 本地词库 + 历史聚合，不显示伪造热度 | 我们没有小红书官方话题库；诚实可控 |

## 4. 用户体验 / 交互

- **标题**：单行输入 + 实时字数（按平台 `titleMax`：视频号 16 / 小红书 20 / 抖音 30）。超限标红提示但**不硬截**
  （发布时 `social-package` 已有截断+warning 兜底）。
- **图组**：多图九宫格，首图带「封面」角标，拖拽 / 上下键排序，选图上传后立即保存。沿用现有 `ImageThumb` 那套交互。
- **正文**：Lexical 编辑区，样式接近小红书正文（暖灰正文、舒适行距）。
  - 打 `#` 弹话题联想下拉（键盘上下选、回车/点击确认），选中即成蓝色 `HashtagNode`；继续打字不触发则按普通文本。
  - emoji 走系统输入法（不自建面板）。
  - 分段 = 换行（空行即段间距）。
  - 实时计数：正文字数（按 `bodyMax`，小红书 1000）、话题数（按 `tagsMax`，小红书 10），超限标红。
- **预览**：右侧手机卡片，实时映射图组（首图大图 + 其余张数）+ 标题 + 正文（#话题渲染成蓝色、保留换行）。

## 5. 组件架构

新建图文专用组件（就近放在 `compose/imagetext/[id]/` 下，遵循「上传/排序组件各目录各放一份」的现有约定）：

- **`NoteEditor.tsx`** — 容器：左侧 = 图组 + 标题 + 正文（Lexical），右侧 = `NotePreview`。负责加载/保存编排（沿用
  `_lib/actions` 的 `getContent / updateContent / uploadMedia` Server Actions）。
- **正文 Lexical 子树**（在 `NoteEditor` 内组装）：
  - nodes：`HashtagNode`（来自 `@lexical/hashtag`）。
  - plugins：`PlainTextPlugin`（或 `RichTextPlugin` 仅段落）、`HashtagPlugin`（自动 # 高亮）、
    自定义 `TopicTypeaheadPlugin`（基于 `LexicalTypeaheadMenuPlugin`，`#` 触发，数据源 = 本地词库+历史）、
    计数监听（`registerUpdateListener` 读 `textContent`）、`LoadAndSave`（纯文本往返 + 防抖保存）。
  - 落库：取编辑器纯文本（`$rootTextContent`，**保留换行**）存 `socialDescription`；`parseTopics(text)` 解析 #话题写 `socialTags`。
- **`NotePreview.tsx`** — 纯展示：小红书手机卡片（图组 + 标题 + 正文，#话题蓝色、保留换行）。
- **`topics.ts`** — `parseTopics(text): string[]`（提取 #词、去 #、trim、去重）+ 本地话题词库 + 联想匹配（前缀/包含）。

每个单元职责单一、可独立测试（`parseTopics`、`NotePreview` 渲染、`social-package` 编译均为纯逻辑）。

## 6. 数据流与存储（正文为准）

- `socialDescription`：编辑器纯文本，**含 #话题、emoji、换行**，是文案唯一真源。
- `socialTags`（`array<{tag}>`）：保存时 = `parseTopics(socialDescription)` 覆盖写。仅作「结构化镜像」，供：
  话题数校验/计数、浏览器 worker 的话题点选、发布步骤展示。
- **无需数据库迁移**：复用现有 `socialDescription` / `socialTags` / `socialImages` 字段。
- **向后兼容（平滑迁移到「正文为准」）**：加载旧稿时，若 `socialDescription` 未包含某个已存在于 `socialTags`
  的话题，则把这些话题**回填**进正文末尾（成为 `#话题`），使正文成为唯一真源；此后保存以正文为准。
  这样旧稿打开即自动并入，不丢话题。

## 7. `social-package` 调整（`renderers/social-package.ts`）

当前 `buildSocialPackage` 把 caption 拼成「截断版纯文本正文 + 话题行 + LiLink 链接」。改为「正文为准」：

- **caption** = `socialDescription` 原文（含 #话题）`+` 末尾补「正文中缺失的固定话题」（`#LiLink` / `#校园社交`，
  只补正文没有的，避免重复）`+` LiLink 链接行。即正文不再被「截断纯文本 + 话题行」替换。
- **hashtags**（发布包给 worker 点选 / 展示用）= `parseTopics(socialDescription)` ∪ 固定话题，去重，按 `tagsMax` 切片。
- **保留不变**：标题多源回退 + `titleMax` 截断+warning、素材按 role 收集、`validateAssets`、checklist。

注意：`social-package` 也被审核页 / 发布页预览复用，改它会**统一**影响这些预览——这是期望的（预览也应所见即所得）。
需回归这几处。

## 8. 话题联想数据源

- **本地词库**：一份可维护的预设话题常量（`topics.ts`），含固定话题（LiLink / 校园社交）+ 常用校园话题。
- **历史聚合**：从已有 `ChannelContents.socialTags` 去重聚合（Server Action 取近期 top N）。
- **不显示热度数字**（无真实数据，不伪造）。
- **匹配**：`#` 后输入前缀 → 过滤词库（初版用包含匹配；中文直接子串匹配）。
- 实现优先级：预设词库**必做**；历史聚合纳入本设计、若实现成本高可在落地时降级为「仅预设」并在 plan 标注。

## 9. 平台通用性

- `NoteEditor` 接收当前稿 `platform`，读 `getPlatformSpec(platform).limits` 决定标题/正文/话题计数上限。
- `image_note` 字段平台无关（`socialTitle` / `socialDescription` / `socialTags` / `socialImages`），故同一编辑器服务
  小红书 / 视频号 / 抖音的图文形态。
- `bodyMax` / `tagsMax` 在部分平台 spec 里可选（未设）；未设上限时只显示已用数、不显示上限、不标红。

## 10. 测试策略（Vitest）

- `parseTopics`：连续 `#`、`#词` 被空格/换行/标点终止、中英文混合、去 `#`、去重、trim。
- 计数边界：标题/正文/话题在各平台 limits 下的临界值。
- `social-package` 新逻辑：正文含 #话题时 caption **不重复**、固定话题**智能补**（缺则补、有则不重复）、
  `hashtags` 字段正确、标题截断仍生效；向后兼容（旧稿正文无 # 时仍能产出合理 caption）。
- Lexical 纯文本导出保留换行（对导出函数做单测；必要时 jsdom）。
- 纯逻辑（`parseTopics` / `social-package`）走普通单测；Lexical 组件交互若需真实浏览器则可 gated，不阻塞 CI。

## 11. 改动文件清单（预估）

- 改：`src/app/(app)/studio/compose/imagetext/[id]/page.tsx`（正文区换成 `NoteEditor`；图组逻辑复用/提取）。
- 新：`.../imagetext/[id]/NoteEditor.tsx`、`NotePreview.tsx`、`note-editor.module.css`、`topics.ts`。
- 改：`src/renderers/social-package.ts`（正文为准）。
- 新：相关 `tests/`（`parseTopics`、`social-package` 回归）。
- 依赖：确认 `@lexical/hashtag` 是否已安装；未装则 `npm install @lexical/hashtag`（实现阶段确认）。

## 12. 不做（YAGNI）

`@提及` 联想（无小红书用户图谱；手打 `@` 仅纯文本）、图片滤镜/裁剪、自建 emoji 面板（先靠输入法）、
草稿多版本、视频稿改造、话题热度数字。

## 13. 风险与未决

- `@lexical/hashtag` 依赖是否已装 —— 实现前确认，未装则安装。
- Lexical 纯文本导出的「段落→换行」映射需验证（保证 `socialDescription` 换行与编辑所见一致）。
- 历史聚合话题的范围/性能 —— 初版可只取近期少量；必要时降级为仅预设。
- `social-package` 改动会影响审核/发布预览 —— 期望统一，但需回归。
- **`platform/AGENTS.md` 提醒：这是改过的 Next.js（16），实现前先读 `node_modules/next/dist/docs/` 对应指南**
  （尤其 client 组件 `use(params)`、`(app)` 路由组不渲染 `<html>/<body>` 等现有硬约束）。
