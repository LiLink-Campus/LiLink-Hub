'use client'

// ComposeClient.tsx —— 长文创作页客户端外壳（Typora 式单一书写面）。
//
// 不再左写右预览：编辑区本身就是「成品样式」WYSIWYG（见 Editor.tsx / editor.module.css）。
//   - 一个居中书写栏：顶部是文章标题（inline 大字，存 wxTitle），下面是 <Editor> 正文。
//   - 顶部一行：保存状态（保存中/已保存/失败）+「预览公众号成品」链接（开新标签到 /preview 看最终 HTML）。
// 标题与正文的保存都汇到同一个保存状态。

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'

import { updateContent } from '../../../_lib/actions'
import { fonts, space } from '../../../_lib/theme'
import { Editor, type SaveState } from './Editor'
import styles from './editor.module.css'

const TITLE_DEBOUNCE_MS = 700

const SAVE_META: Record<SaveState, { label: string; color: string }> = {
  idle: { label: '改动会自动保存', color: '#8a7f7a' },
  saving: { label: '保存中…', color: '#9a6a12' },
  saved: { label: '已保存', color: '#2f7d4f' },
  error: { label: '保存失败，请检查网络后重试', color: '#b3635f' },
}

export interface ComposeClientProps {
  contentId: string
  initialTitle: string
  initialMarkdown: string
  /** 媒体 id → 直链 url（加载时内联显示图片）。 */
  imageUrlMap: Record<string, string>
}

export function ComposeClient({ contentId, initialTitle, initialMarkdown, imageUrlMap }: ComposeClientProps) {
  const [title, setTitle] = useState(initialTitle)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onTitleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
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

  useEffect(
    () => () => {
      if (titleTimer.current) clearTimeout(titleTimer.current)
    },
    [],
  )

  const meta = SAVE_META[saveState]

  return (
    <div>
      {/* 顶部一行：保存状态 + 预览公众号成品（开新标签看与发布完全相同的 HTML） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.sm,
          marginBottom: space.md,
          fontFamily: fonts.sans,
        }}
      >
        <span aria-live="polite" style={{ fontSize: 13.5, color: meta.color, minHeight: 20 }}>
          {meta.label}
        </span>
        <a
          href={`/preview/channel-contents/${encodeURIComponent(contentId)}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 13.5, color: '#8a7f7a', textDecoration: 'none' }}
        >
          预览公众号成品 ↗
        </a>
      </div>

      {/* 单一书写面：编辑区即成品样式，居中书写栏（Typora 式） */}
      <div className={styles.surface}>
        <div className={styles.column}>
          <input
            className={styles.titleInput}
            value={title}
            onChange={onTitleChange}
            placeholder="文章标题…"
            maxLength={64}
            aria-label="公众号标题"
          />
          <div className={styles.titleRule} />
          <Editor
            contentId={contentId}
            initialMarkdown={initialMarkdown}
            imageUrlMap={imageUrlMap}
            onSaveStateChange={setSaveState}
          />
        </div>
      </div>
    </div>
  )
}
