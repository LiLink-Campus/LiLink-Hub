# 小红书式图文笔记编辑器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **本计划将由 dynamic workflow 执行（用户指定）**：研究 → 并行实现独立模块 → 核心编辑器 → 集成验证。

**Goal:** 把图文稿创作页的纯文本文案区，换成贴合小红书的轻富文本笔记编辑器（顶部图组 + 标题 + #话题联想/高亮正文 + emoji + 实时字数 + 右侧手机卡片预览），数据流「正文为准」。

**Architecture:** 复用 Lexical（`@lexical/hashtag` 做 #高亮 + `LexicalTypeaheadMenuPlugin` 做联想），正文存纯文本 `socialDescription`、`socialTags` 从正文解析镜像；`social-package` 改为「正文为准、不重复拼话题、向后兼容旧稿」。视频稿不动，无数据库迁移。

**Tech Stack:** Next.js 16 + Payload 3.85 + React + Lexical 0.41 + TypeScript(ESM) + Vitest。

> ⚠️ **实现前必读** `platform/AGENTS.md`：这是改过的 Next.js 16。client 组件 `params` 用 `use()` 解包；`(app)` 路由组内**绝不**渲染 `<html>/<body>`；写 Lexical typeahead 前对照 `platform/node_modules/@lexical/react/LexicalTypeaheadMenuPlugin.d.ts` 确认 API 签名。

---

## 文件结构（决定 task 边界）

| 文件 | 责任 | 类型 |
|---|---|---|
| `compose/imagetext/[id]/topics.ts` | `parseTopics` / `PRESET_TOPICS` / `matchTopics` 纯函数 + 预设词库 | 新建（无 'use client'/'use server'） |
| `compose/imagetext/[id]/NotePreview.tsx` | 小红书手机卡片预览（纯展示） | 新建 client |
| `compose/imagetext/[id]/NoteBody.tsx` | 正文 Lexical 子树（#高亮 + 联想 + 计数 + 纯文本往返） | 新建 client |
| `compose/imagetext/[id]/NoteEditor.tsx` | 容器：图组 + 标题 + NoteBody + NotePreview + 加载/保存编排 | 新建 client |
| `compose/imagetext/[id]/note-editor.module.css` | 编辑器 + 预览样式 | 新建 |
| `compose/imagetext/[id]/page.tsx` | 极简：`use(params)` → `<NoteEditor>` | 改 |
| `_lib/actions.ts` | 新增 `listRecentSocialTags()` 历史话题聚合 | 改 |
| `renderers/social-package.ts` | 「正文为准」改造（caption/hashtags） | 改 |
| `tests/social-package.test.ts` | 更新断言 + 新增正文为准/兼容用例 | 改 |
| `tests/topics.test.ts` | `parseTopics`/`matchTopics` 单测 | 新建 |

## 接口契约（锁定，各 task 必须一致）

```ts
// topics.ts
export const PRESET_TOPICS: string[]                              // 不带 #
export function parseTopics(text: string): string[]              // 提取#话题：不带#、trim、去重、保序
export function matchTopics(prefix: string, pool: string[], limit?: number): string[]  // 前缀过滤，不带#

// _lib/actions.ts
export async function listRecentSocialTags(): Promise<string[]>  // 历史 socialTags 聚合去重，不带#

// NotePreview.tsx
export function NotePreview(props: { title: string; body: string; images: { id: string; url: string }[] }): JSX.Element

// NoteBody.tsx
export interface NoteBodyProps {
  initialText: string
  suggestions: string[]                                  // 联想池(不带#)= PRESET_TOPICS ∪ 历史
  onChange: (text: string, topics: string[]) => void     // 每次内容变更上报纯文本 + parseTopics(text)
}
export function NoteBody(props: NoteBodyProps): JSX.Element

// NoteEditor.tsx
export function NoteEditor(props: { contentId: string }): JSX.Element
```

数据流：`NoteBody.onChange(text, topics)` → 容器防抖 `updateContent(id, { socialDescription: text, socialTags: topics.map(t => ({ tag: t })) })` → 同步更新 `NotePreview`。

---

## Task 0：环境准备

**Files:** `platform/package.json`（改）

- [ ] **Step 1: worktree 链接 node_modules**（git worktree 不带 node_modules，否则 tsc/vitest 跑不了）

Run（在 worktree 根）：
```bash
ln -sfn /home/nanzhi/projects/LiLink-Hub/platform/node_modules platform/node_modules
ls platform/node_modules/@lexical/hashtag >/dev/null && echo OK
```
Expected: `OK`

- [ ] **Step 2: 显式声明 `@lexical/hashtag` 依赖**（现是传递依赖，CI `npm ci` 不保证装）

在 `platform/package.json` 的 dependencies 里 `@lexical/list` 一行后加：
```json
    "@lexical/hashtag": "^0.41.0",
```

- [ ] **Step 3: 基线验证可跑**

Run: `cd platform && npx tsc --noEmit && npx vitest run tests/social-package.test.ts`
Expected: tsc 无错；既有 social-package 测试 PASS（作为改造前基线）。

- [ ] **Step 4: Commit**
```bash
git add platform/package.json && git commit -m "chore(deps): 显式声明 @lexical/hashtag（图文笔记编辑器用）"
```

---

## Task 1：`topics.ts` 话题解析与词库（TDD）

**Files:** Create `compose/imagetext/[id]/topics.ts`、Test `tests/topics.test.ts`

- [ ] **Step 1: 写失败测试** `tests/topics.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { parseTopics, matchTopics, PRESET_TOPICS } from '../src/app/(app)/studio/compose/imagetext/[id]/topics'

describe('parseTopics', () => {
  it('提取多个话题，去#、trim、保序', () => {
    expect(parseTopics('今天 #校园社交 聊聊 #LiLink')).toEqual(['校园社交', 'LiLink'])
  })
  it('相邻 # 互相分隔', () => {
    expect(parseTopics('#a#b')).toEqual(['a', 'b'])
  })
  it('中文标点终止话题', () => {
    expect(parseTopics('#校园社交，很棒。#大学生活')).toEqual(['校园社交', '大学生活'])
  })
  it('去重', () => {
    expect(parseTopics('#x 和 #x')).toEqual(['x'])
  })
  it('无话题返回空', () => {
    expect(parseTopics('纯文案没有标签')).toEqual([])
  })
})

describe('matchTopics', () => {
  it('按前缀(包含)过滤候选', () => {
    expect(matchTopics('校园', ['校园社交', '大学生活', '校园日常'])).toEqual(['校园社交', '校园日常'])
  })
  it('空前缀返回去重后的池(截断到 limit)', () => {
    expect(matchTopics('', ['a', 'a', 'b'], 2)).toEqual(['a', 'b'])
  })
})

describe('PRESET_TOPICS', () => {
  it('含固定运营话题', () => {
    expect(PRESET_TOPICS).toContain('LiLink')
    expect(PRESET_TOPICS).toContain('校园社交')
  })
})
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd platform && npx vitest run tests/topics.test.ts` → FAIL（模块不存在）

- [ ] **Step 3: 实现** `topics.ts`
```ts
// 图文话题工具：从正文纯文本解析 #话题、提供联想词库与前缀匹配。
// 纯函数，无副作用，client/server 通用（不要加 'use client'/'use server'）。

/** 预设话题（不带 #）：固定运营话题 + 常用校园话题，作为联想候选基底。 */
export const PRESET_TOPICS: string[] = [
  'LiLink', '校园社交', '大学生活', '校园日常', '大学生', '社团活动',
  '校园活动', '搭子', '宿舍生活', '开学季', '期末季', '校园美食',
]

// #话题边界：到空白 / 另一个# / 常见中英文标点为止。
const TOPIC_RE = /#([^\s#,，。、!！?？;；:：~（）()【】"'\n\r\t]+)/g

/** 从正文提取话题（不带#、trim、去重、保序）。 */
export function parseTopics(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(TOPIC_RE)) {
    const tag = m[1].trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

/** 前缀匹配候选（不带#、去重、截断到 limit）。空前缀=返回去重池。 */
export function matchTopics(prefix: string, pool: string[], limit = 8): string[] {
  const q = prefix.trim().toLowerCase()
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of pool) {
    if (!t || seen.has(t)) continue
    if (!q || t.toLowerCase().includes(q)) {
      seen.add(t)
      out.push(t)
      if (out.length >= limit) break
    }
  }
  return out
}
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd platform && npx vitest run tests/topics.test.ts` → PASS
- [ ] **Step 5: Commit** — `git add ... && git commit -m "feat(studio): 图文话题解析 topics.ts（parseTopics/matchTopics/词库）"`

---

## Task 2：`social-package` 正文为准改造（TDD）

**Files:** Modify `src/renderers/social-package.ts`、`tests/social-package.test.ts`

**改造要点（正文为准 + 向后兼容）：**
1. `hashtagsFor(cc, bodyText)` 增加正文解析来源：`tags = [...parseTopics(bodyText), ...socialTags(cc), ...postTags(cc.post), 'LiLink', '校园社交']`，仍 normalize 去#去空格去重、加#。
2. caption 改为：`body`（`socialDescription` 优先，按 `bodyMax` 截断+warning，不变）`+` 仅补「正文里缺失的话题」`missing = hashtags.filter(h => !parseTopics(body).map(normalizeTag).includes(normalizeTag(h)))` `+` LiLink 链接行。
3. 这样：新稿（话题在正文）→ 不重复，只补固定话题；旧稿（socialTags 独立、正文无#）→ missing=全部，等价旧行为（兼容）。

- [ ] **Step 1: 改测试** `tests/social-package.test.ts`（在现有用例基础上，更新/新增）
```ts
// 新稿：正文已含 #话题 → caption 不重复该话题，仅补缺失的固定话题
it('正文含#话题时 caption 不重复拼接', () => {
  const pkg = buildSocialPackage({
    platform: 'xiaohongshu', contentMode: 'image_note',
    socialTitle: '标题', socialDescription: '正文很棒 #校园社交 #LiLink',
    socialImages: [{ id: 1, url: 'https://x/1.jpg' }],
  })
  // #校园社交 / #LiLink 只在正文里出现一次，不再有额外话题行重复它们
  expect(pkg.caption.match(/#校园社交/g)?.length).toBe(1)
  expect(pkg.caption.match(/#LiLink/g)?.length).toBe(1)
  expect(pkg.hashtags).toContain('#校园社交')
})

// 旧稿：socialTags 独立、正文无# → 仍把话题补成话题行（向后兼容）
it('旧稿正文无#时仍补话题行', () => {
  const pkg = buildSocialPackage({
    platform: 'xiaohongshu', contentMode: 'image_note',
    socialTitle: '标题', socialDescription: '纯文案没有标签',
    socialTags: [{ tag: '校园社交' }],
    socialImages: [{ id: 1, url: 'https://x/1.jpg' }],
  })
  expect(pkg.caption).toContain('#校园社交')
})
```
（同时检查并修正现有断言里「假设 caption 总是 body+话题行」的用例。）

- [ ] **Step 2: 跑测试确认失败** — Run: `cd platform && npx vitest run tests/social-package.test.ts` → 新用例 FAIL
- [ ] **Step 3: 实现改造**（`import { parseTopics } from '...'`——注意 social-package 在 `renderers/`，从 `compose/imagetext/[id]/topics` 相对 import 路径较深；**改为把 `parseTopics` 也导出一份在 renderers 可直接用，或把 topics.ts 提到更中性的位置**。实现时决定：建议新建 `src/renderers/topics.ts` 仅放 `parseTopics`，编辑器侧 `topics.ts` re-export 它，避免跨 `app/` 深路径 import。在 plan 落地时统一。）按上面 3 点改 `hashtagsFor` 与 caption 组装。
- [ ] **Step 4: 跑测试确认通过** — `cd platform && npx vitest run tests/social-package.test.ts` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(publish): social-package 正文为准（话题不重复拼接 + 兼容旧稿）"`

---

## Task 3：`listRecentSocialTags` 历史话题聚合

**Files:** Modify `_lib/actions.ts`

- [ ] **Step 1: 实现 Server Action**（聚合最近渠道稿的 socialTags，去重，不带#；失败返回 `[]` 不抛——联想是增强项不该让页面崩）
```ts
/** 历史话题聚合：取最近渠道稿的 socialTags 去重（不带#），供编辑器联想候选。失败返回空数组。 */
export async function listRecentSocialTags(): Promise<string[]> {
  try {
    const { payload, user } = await getPayloadAndMaybeUser()
    if (!user) return []
    const res = await payload.find({
      collection: CHANNEL_CONTENTS,
      depth: 0, limit: 100, sort: '-updatedAt',
      overrideAccess: false, user: user as never,
    })
    const seen = new Set<string>()
    const out: string[] = []
    for (const doc of res.docs as unknown as Record<string, unknown>[]) {
      const tags = doc.socialTags
      if (!Array.isArray(tags)) continue
      for (const t of tags) {
        const tag = typeof t === 'string' ? t : (t as Record<string, unknown>)?.tag
        const s = typeof tag === 'string' ? tag.trim() : ''
        if (s && !seen.has(s)) { seen.add(s); out.push(s) }
      }
    }
    return out.slice(0, 50)
  } catch {
    return []
  }
}
```
- [ ] **Step 2: 验证** — Run: `cd platform && npx tsc --noEmit` → 无错。
- [ ] **Step 3: Commit** — `git commit -m "feat(studio): listRecentSocialTags 历史话题聚合（编辑器联想用）"`

---

## Task 4：`NotePreview.tsx` 手机卡片预览

**Files:** Create `compose/imagetext/[id]/NotePreview.tsx`、`note-editor.module.css`（预览部分）

实现一个纯展示组件（接口见契约）：竖向手机卡片——首图大图（`images[0]`，无图给占位）+ 其余张数角标；标题（粗体）；正文按 `\n` 分段渲染，`#话题`用正则染成小红书蓝（`#1d72b8`/类似）。复用 `_lib/theme` 的 colors/fonts。话题渲染用 `String.split` 按 `parseTopics` 或行内正则 `/#[^\s#…]+/` 包裹 `<span class={styles.topic}>`。

- [ ] **Step 1: 实现组件 + 样式**（完整代码，参考 `_ui` 与 `video/page.tsx` 的内联组件风格；正文话题高亮用行内正则切分）。
- [ ] **Step 2: 验证** — `cd platform && npx tsc --noEmit` 无错。
- [ ] **Step 3: Commit** — `git commit -m "feat(studio): NotePreview 小红书手机卡片预览"`

---

## Task 5：`NoteBody.tsx` 正文 Lexical 编辑器（核心）

**Files:** Create `compose/imagetext/[id]/NoteBody.tsx`

**对照** `platform/node_modules/@lexical/react/LexicalTypeaheadMenuPlugin.d.ts` 与 `@lexical/hashtag` 的导出确认 API 后实现。结构：
- `LexicalComposer`（nodes: `[HashtagNode]`，theme: `{ hashtag: styles.hashtag, paragraph: styles.paragraph }`）。
- `PlainTextPlugin`（正文不需要富节点）+ `HistoryPlugin` + `HashtagPlugin`（来自 `@lexical/react/LexicalHashtagPlugin`，自动把 #词 变 `HashtagNode`）。
- `TopicTypeahead`：用 `LexicalTypeaheadMenuPlugin` + `useBasicTypeaheadTriggerMatch('#', { minLength: 0 })`，候选 `matchTopics(query, suggestions)`，选中时把当前 query 替换为 `#词`（用 `$splitNodeContainingQuery`/option 提供的方式；对照 .d.ts）。下拉用绝对定位菜单（`anchorElementRef`）。
- 计数 + 上报：`registerUpdateListener` → `editorState.read(() => $getRoot().getTextContent())` → `onChange(text, parseTopics(text))`。
- 初始化：`editor.update(() => { $getRoot().clear(); 按 initialText 用 $createParagraphNode/$createTextNode 注入，按 \n 分段 })`；只挂载一次。

- [ ] **Step 1: 实现 NoteBody**（含 typeahead 下拉、hashtag 高亮、计数上报；纯文本导出保留换行——段落间用 `\n`）。
- [ ] **Step 2: 验证类型** — `cd platform && npx tsc --noEmit` 无错。
- [ ] **Step 3: Commit** — `git commit -m "feat(studio): NoteBody 正文编辑器（#话题高亮+联想+计数）"`

---

## Task 6：`NoteEditor.tsx` 容器

**Files:** Create `compose/imagetext/[id]/NoteEditor.tsx`

组合：左列 = 图组（移植旧 `imagetext/page.tsx` 的 `ImageThumb` + 多图上传/排序/删除逻辑）+ 标题（`TextInput` + 实时字数，上限取 `getPlatformSpec(doc.platform).limits.titleMax`）+ `NoteBody`；右列 = `NotePreview`（随标题/正文/图组实时更新）。加载用 `getContent`，并行 `listRecentSocialTags`；`suggestions = dedupe([...PRESET_TOPICS, ...history])`。保存：标题 blur / 图组变更 / NoteBody.onChange 防抖（800ms）→ `updateContent`。**向后兼容**：加载后若 `socialDescription` 未包含某个已存在 `socialTags` 的话题，则把这些话题追加进初始正文末尾（`#话题`），实现「正文为准」平滑迁移。底部「保存草稿 / 下一步：发布 ▸」沿用旧逻辑跳 `/studio/publish/[id]`。

- [ ] **Step 1: 实现 NoteEditor**（完整容器，复用 `_ui`/`_lib/actions`/`theme`；图组逻辑从旧 page 移植）。
- [ ] **Step 2: 验证** — `cd platform && npx tsc --noEmit` 无错。
- [ ] **Step 3: Commit** — `git commit -m "feat(studio): NoteEditor 容器（图组+标题+正文+预览+保存）"`

---

## Task 7：接入 `page.tsx`

**Files:** Modify `compose/imagetext/[id]/page.tsx`

- [ ] **Step 1: 极简化**——`use(params)` 取 id → 渲染 `<StepHeader current="create" />` + 标题区 + `<NoteEditor contentId={id} />`。删除旧的表单态/上传/排序（已移进 NoteEditor）。保留加载/错误的兜底可放进 NoteEditor。
- [ ] **Step 2: 验证** — `cd platform && npx tsc --noEmit` 无错。
- [ ] **Step 3: Commit** — `git commit -m "feat(studio): 图文创作页接入小红书式 NoteEditor"`

---

## Task 8：集成验证

- [ ] **Step 1: 全量类型 + 单测** — Run: `cd platform && npx tsc --noEmit && npx vitest run`
  Expected: tsc 无错；`topics`/`social-package` 等单测全绿（需 DB 的集成测试在无 `DATABASE_URI` 时自动跳过）。
- [ ] **Step 2: 起本地验证**（若 DB 可用）—— `cd platform && npm run dev`，登录后建/开一条 `xiaohongshu` 图文稿，验证：打 `#` 弹联想、选中变蓝、emoji 输入、字数随平台变化（小红书 20/1000/10）、图组排序、右侧预览实时跟随、保存后 `socialTags` 已从正文解析。
- [ ] **Step 3: 回归 social-package 的复用方** —— 确认审核页 / 发布页预览仍正常（它们经 `buildSocialPackage`）。
- [ ] **Step 4: Final commit / 收尾** — 确认 `git status` 干净。

---

## Self-Review 结果（spec 覆盖核对）

- 正文小红书式轻富文本 → Task 5（NoteBody）✓ | 图片顶部图组 → Task 6 ✓ | 话题正文内#联想+解析 → Task 1/5/6 ✓
- 数据流正文为准 → Task 2（social-package）+ Task 6（保存 socialTags 解析）✓ | 手机预览 → Task 4 ✓
- 话题联想本地词库+历史聚合 → Task 1（PRESET）+ Task 3（history）✓ | 平台通用 limits → Task 6 ✓
- 测试 → Task 1/2（纯逻辑 TDD）+ Task 8（集成）✓ | 视频稿不动 / 无迁移 ✓
- 已知不可一次写死项：Lexical typeahead API 需对照 `.d.ts`（Task 5 已注明）。
