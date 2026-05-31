# LiLink 运营内容工作台（友好前端）设计

- 日期：2026-05-31
- 状态：草案（待 review）
- 关联：第一期公众号闭环（已合并）、多平台人工发布包（PR#2，已合并）

## 1. 背景与目标

**现状痛点**：运营目前只能用 Payload 自带的 `/admin` 后台操作渠道稿——所有字段（平台、标题、作者、摘要、正文、封面、各平台素材、状态、发布结果……）堆在一个大表单里，对 0 基础运营**看不懂在干嘛**；正文编辑与 meta 填写混在一起，没有引导、体验割裂。

**目标**：在 `(app)` 路由组内自建一套 **0 基础 0 门槛、丝滑引导**的运营前端「内容工作台」。运营**只用这套**，永不接触 `/admin`（`/admin` 保留给管理员/开发做后台兜底管理）。核心流程：

> 创作（只管写）→ 发布（选渠道 + 填 meta）→ 提交审核 → 审核队列（通过/打回）→ 发布

**正文与 meta 分两步**是硬要求：创作页只专注内容主体，meta 留到发布步骤。

## 2. 范围（v1）

**三种创作形式分开**（创作入口按形式分叉）：

| 形式 | 平台 | v1 做法 |
|---|---|---|
| 📄 长文 | 公众号 | 完整闭环：所见即所得富文本 + 实时手机预览 + 一键发到公众号草稿箱 |
| 🖼 图文 | 小红书 / 视频号 / 抖音 | PR#2 人工发布包：上传多图 + 文案 → 生成发布包 → 人工发布 |
| 🎬 视频 | 视频号 / 抖音 | PR#2 人工发布包：上传视频 + 封面 + 文案 → 生成发布包 → 人工发布 |

**长文平台扩展位**：长文 v1 仅激活公众号，但**保留多平台扩展点**——因不同平台长文渲染格式不同，每个平台对应自己的 renderer（见 `renderers/index.ts` 注册表）。发布步骤的平台选择由注册表驱动，未激活平台显示占位。

**不做（YAGNI）**：定时发布、多人协同实时编辑、数据看板、A/B、评论系统、独立 reviewer 角色（v1 登录运营即可审核）。

## 3. 信息架构与路由（均在 `(app)` 内）

```
/login            友好登录页（未登录统一跳此；复用 payload 鉴权）
/studio           工作台：我的内容（按状态分组：草稿/审核中/已通过/已发布）+「开始创作 ✎」
   └ 开始创作 → 选形式：📄长文 / 🖼图文 / 🎬视频（3 张卡片）
/studio/compose/[form]/[id]   创作页（form ∈ article | imagetext | video），自动存草稿
/studio/publish/[id]          发布配置页：选平台 + 填 meta + 预览 →「提交审核」
/studio/review                审核队列：in_review 列表 + 预览 + 通过/打回；通过后发布
/preview/channel-contents/[id]  复用现有预览页（长文所见即所得手机预览）
```

## 4. 三种创作形式（创作页内容）

- **长文**：标题 + 沉浸式富文本编辑器（正文）。
- **图文**：标题 + 多图上传（可拖拽排序）+ 正文/文案。
- **视频**：标题 + 视频上传 + 封面（横/竖）+ 正文/文案。

三者共用「自动存草稿 + 顶部进度（创作 ▸ 发布 ▸ 审核）」骨架，仅创作区不同。

## 5. 数据与状态映射

一次创作 = 一条 `ChannelContent`：

| 形式 | 关键字段 |
|---|---|
| 长文 | `platform=wechat`、`body`(Lexical)、`wxTitle/wxAuthor/wxDigest/coverImage/sourceUrl/renderConfig` |
| 图文 | `platform∈{xiaohongshu,weixin_channels,douyin}`、`contentMode=image_note`、`socialTitle/socialDescription/socialTags/socialImages` |
| 视频 | `contentMode=video`、`videoFile/horizontalCover/verticalCover/socialTitle/socialDescription/socialTags` |

- **选题（`post` 必填）自动处理**：创作首次保存时若无 `post`，自动建一个 `posts`（选题名取标题或「未命名草稿」，owner=当前用户）并挂上，**运营全程无感**。倾向实现：创作流程先 `POST /api/posts` 再建 channel-content（不改 collection 语义）。
- **工作流**：`draft → in_review → approved →（published | ready_to_publish → published）`，复用现有 `transition` 端点。
- **发布**：长文走 `publish` 端点（→公众号草稿，`published`）；图文/视频走 `publish` 端点（→`manual_ready`，`ready_to_publish`），人工在平台发布后手动 `transition` 到 `published`。
- `status/publishResult/transitionLog` 已是 API 只读（只能经端点改）；前端一律走端点，不直接 patch。

## 6. 长文编辑器（核心，最重）

- 在 `(app)` 用 `lexical` + `@lexical/react`（Payload 已依赖 `lexical`，复用其底层包）自建一个干净友好的所见即所得富文本编辑器。
- **节点集与 `ChannelContents.body` 的 lexicalEditor features 严格对齐**：段落、H2/H3/H4、加粗、斜体、有序/无序列表、引用、链接、上传图片(media)。产出 `SerializedEditorState`，与现有 `renderToInlineHtml` **100% 兼容**（同一套节点类型）。
- 工具条精简友好（标题/加粗/列表/引用/插图/链接），中文 tooltip；移动端可用。
- 插图：上传到 media 集合（`/api/media`），插入 `upload` 节点（value=media id）；预览/发布时 `depth` populate 出 `url`。
- 实时预览：右侧手机框，**与发布共用同一份 `renderToInlineHtml`**，所见即所得。
- 兼容性契约：以 `lexical-to-wechat.test.ts` 的节点形状为契约；新增「编辑器输出 → 渲染」快照测试，保证编辑器产出能被渲染层正确处理、不掉格式。

## 7. 发布步骤（平台与 meta 分离 + 长文扩展位）

- **长文平台选择**：由 `renderers/index.ts` 注册表驱动；v1 仅 `wechat` 激活，其他长文平台显示「敬请期待」占位。**不同平台长文渲染格式不同 → 各自对应一个 renderer，预览按所选平台的 renderer 出图。**
- **meta 表单按形式/平台动态**：公众号（作者/摘要/封面/阅读原文/CTA）；图文/视频（话题标签/封面/形态）。
- **发布前校验**（友好提示，不报错堆栈）：公众号需封面；图文需 ≥1 图；视频需视频文件——复用 `social-package` 的 warnings 与公众号 preflight 思路。

## 8. 审核队列

- 列表：默认 `in_review`（可切看其他状态）。
- 操作：预览、**通过**（→`approved`）、**打回**（→`draft`，填 reason，写 `transitionLog`）。
- 通过后：长文「一键发布到公众号草稿箱」（`publish`→`published`）；图文/视频「生成发布包」（`publish`→`ready_to_publish`）+ 展示发布包 + 人工发布指引，人工发布后「标记已发布」（`transition`→`published`）。
- 角色：v1 同一登录运营即可审核（现有 access 足够）；未来可加 reviewer 角色，预留但不强分。

## 9. 后端改动（极小，复用为主）

- **新增**：自动选题（§5）——倾向前端创建流程先建 `posts` 再建 `channel-contents`；不改 collection。
- **不改**：collections 字段/access、`publish`/`transition`/`inlineHtml` 端点、渲染层、发布器。
- 可选：一个轻量「我的内容」查询（REST `/api/channel-contents?where=...` 或 server action 包一层）。

## 10. 鉴权与 API

- 服务端组件：`payload.auth({ headers })` 读会话（复用预览页写法）；未登录跳 `/login`。
- 客户端写操作：优先用 Next **server actions** 包一层（在服务端用 payload local API 或带 cookie 调 REST），避免前端直拼鉴权/校验逻辑。
- 复用现有端点：`/api/channel-contents/:id/publish`、`/transition`、`/api/media`。

## 11. 视觉与交互

- **微光玫瑰格调**（与公众号成品、品牌一致）：玫瑰强调 `#c2706c`、暖灰正文 `#4a4340`、淡底 `#fdf6f5`、宋体标题 + 无衬线正文。
- 0 门槛：大按钮、清晰分步、每步一件事、中文引导与空状态指引、危险操作二次确认。
- 响应式，移动优先（运营可能用手机/平板）。

## 12. 测试策略

- 后端（若加自动选题流程）：vitest 单测。
- 编辑器 → 渲染：快照/单测，断言产出被 `renderToInlineHtml` 正确渲染（复用 `lexical-to-wechat.test.ts` 黑/白名单契约）。
- 流程：组件测试 + Playwright e2e，至少覆盖长文主路径（登录→创作→发布→提交→审核通过→发草稿）。
- 复用现有 renderer/publisher/workflow 测试，保证零回归。

## 13. 里程碑（供 writing-plans 细化）

1. `(app)` 工作台骨架 + 鉴权 + 友好登录 + 我的内容列表。
2. 创作入口（3 形式选择卡）。
3. 长文：富文本编辑器 + 自动存草稿 + 自动选题 + 实时预览。
4. 长文发布步骤（平台选择含扩展位 + meta + 校验）+ 提交审核。
5. 审核队列（通过/打回）+ 长文一键发草稿。
6. 图文 / 视频：创作（上传+文案）+ 发布（平台+话题+封面+发布包预览）+ 提交审核 + 发布包/人工发布。
7. 视觉打磨 + e2e。
