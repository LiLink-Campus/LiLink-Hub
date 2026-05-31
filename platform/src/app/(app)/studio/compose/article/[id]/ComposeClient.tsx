'use client'

// ComposeClient.tsx —— 长文创作页的客户端交互外壳。
//
// 组合三块联动 UI（page.tsx 这个 server 组件把初始数据喂进来）：
//   1. 公众号标题输入（受控，防抖 updateContent 存 wxTitle）。
//   2. <Editor>（所见即所得正文；其内部 onChange 防抖存 body）。
//   3. 右侧「手机实时预览」：保存成功后调 renderPreview(id) 服务端动作重渲染（预览=最终）。
//
// 保存反馈：标题/正文任一保存都更新顶部「保存中… / 已保存 / 保存失败」状态条，0 基础友好。
// 移动优先：窄屏单列（预览在正文下方），宽屏左右分栏（约 390px 手机框靠右）。

import { useCallback, useEffect, useRef, useState } from 'react'

import { updateContent } from '../../../_lib/actions'
import { colors, fonts, radii, space, shadow } from '../../../_lib/theme'
import { Field, TextInput } from '../../../_ui'
import { Editor, type SaveState } from './Editor'
import { renderPreview } from './preview-action'

const TITLE_DEBOUNCE_MS = 700

// 保存状态条文案 / 颜色。
const SAVE_META: Record<SaveState, { label: string; color: string }> = {
  idle: { label: '改动会自动保存', color: '#8a7f7a' },
  saving: { label: '保存中…', color: '#9a6a12' },
  saved: { label: '已保存', color: '#2f7d4f' },
  error: { label: '保存失败，请检查网络后重试', color: '#b3635f' },
}

export interface ComposeClientProps {
  contentId: string
  /** 初始公众号标题（doc.wxTitle）。 */
  initialTitle: string
  /** 初始 markdown 源（doc.bodyMarkdown）。 */
  initialMarkdown: string
  /** 初始预览 HTML（page.tsx 已用 renderToInlineHtml 渲染好，避免首屏空白）。 */
  initialPreviewHtml: string
}

export function ComposeClient({
  contentId,
  initialTitle,
  initialMarkdown,
  initialPreviewHtml,
}: ComposeClientProps) {
  const [title, setTitle] = useState(initialTitle)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [previewHtml, setPreviewHtml] = useState(initialPreviewHtml)
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 刷新右侧预览：按 id 重新读库渲染（图片已 populate）。失败保留旧预览，不打断写作。
  const refreshPreview = useCallback(async () => {
    try {
      const html = await renderPreview(contentId)
      setPreviewHtml(html)
    } catch {
      // 预览刷新失败静默降级（仍显示上一版），保存本身的成败由状态条反映。
    }
  }, [contentId])

  // 标题变更：受控 + 防抖保存 wxTitle，保存成功后刷新预览（标题不进正文 HTML，但保持节奏一致）。
  const onTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value
      setTitle(next)
      if (titleTimer.current) clearTimeout(titleTimer.current)
      titleTimer.current = setTimeout(() => {
        setSaveState('saving')
        updateContent(contentId, { wxTitle: next })
          .then(() => setSaveState('saved'))
          .catch(() => setSaveState('error'))
      }, TITLE_DEBOUNCE_MS)
    },
    [contentId],
  )

  useEffect(() => {
    return () => {
      if (titleTimer.current) clearTimeout(titleTimer.current)
    }
  }, [])

  // Editor 保存成功 → 刷新预览。
  const onSavedBody = useCallback(() => {
    void refreshPreview()
  }, [refreshPreview])

  const meta = SAVE_META[saveState]

  return (
    <div>
      {/* 保存状态条 */}
      <div
        aria-live="polite"
        style={{
          fontSize: 13.5,
          color: meta.color,
          fontFamily: fonts.sans,
          marginBottom: space.sm,
          minHeight: 20,
        }}
      >
        {meta.label}
      </div>

      {/* 主区：宽屏左右分栏，窄屏单列（grid auto-fit 实现移动优先回流） */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: space.lg,
          alignItems: 'start',
        }}
      >
        {/* 左：标题 + 编辑器 */}
        <div style={{ minWidth: 0 }}>
          <Field label="公众号标题" hint="这条会作为公众号文章标题，建议 20 字以内。">
            <TextInput
              value={title}
              onChange={onTitleChange}
              placeholder="给这篇文章起个标题…"
              maxLength={64}
            />
          </Field>

          <Field
            label="正文"
            hint="用 Markdown 写：## 小节、**加粗**、- 列表、> 引用，配图点「＋ 插图」；改动自动保存。"
          >
            <Editor
              contentId={contentId}
              initialMarkdown={initialMarkdown}
              onSavedBody={onSavedBody}
              onSaveStateChange={setSaveState}
            />
          </Field>
        </div>

        {/* 右：手机实时预览（约 390px 手机框，与发布/预览页同款外观） */}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: colors.inkStrong,
              fontFamily: fonts.sans,
              marginBottom: space.sm,
            }}
          >
            手机预览（所见即所发）
          </div>
          <PhonePreview title={title} html={previewHtml} />
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 手机预览框：约 390px 宽，模拟公众号正文区；内容是「与发布完全相同」的全内联 HTML。
// 参考 preview/channel-contents/[id]/page.tsx 的手机框做法。
// ============================================================

function PhonePreview({ title, html }: { title: string; html: string }) {
  return (
    <div
      style={{
        // 「屏外」灰底仅作肉眼模拟手机，与公众号产物无关。
        background: '#ebeced',
        borderRadius: radii.lg,
        padding: `${space.md} 0`,
        // 宽屏时随父列右对齐贴近真机宽度；超出列宽则自适应。
        position: 'sticky',
        top: 76, // 让预览在滚动时跟随（顶栏 ~60 + 余量）
      }}
    >
      <div
        style={{
          maxWidth: 390,
          margin: '0 auto',
          background: '#ffffff',
          minHeight: 420,
          boxShadow: shadow.card,
          padding: '20px 16px',
          boxSizing: 'border-box',
        }}
      >
        {/* 标题区仅预览用（公众号标题由 wxTitle 字段单独管理，不进正文 HTML）。 */}
        <h1
          style={{
            fontSize: 22,
            lineHeight: 1.4,
            fontWeight: 700,
            color: '#1a1a1a',
            margin: '4px 0 16px',
            fontFamily: fonts.serif,
          }}
        >
          {title || '（未命名草稿）'}
        </h1>
        {/* 这份就是发布/复制会用的同一串全内联 HTML —— 预览=最终。 */}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}
