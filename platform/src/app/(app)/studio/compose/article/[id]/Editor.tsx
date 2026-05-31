'use client'

// Editor.tsx —— 公众号长文「Markdown 编辑器」(替代原富文本工具条编辑器)。
//
// 设计：一个干净的 markdown 文本框 + 一行语法提示 + 一个最小「插图」按钮(上传图需要 URL，
// 没法纯手打，故保留这一个按钮)，去掉原来的工具条「一坨」。
// 改动防抖保存：把 markdown 存 bodyMarkdown，同时用 markdownToBody 派生 body(Lexical) 一并存库——
// 发布/预览渲染仍走现有 renderToInlineHtml(body)，下游链路完全不变(所见即所发)。
// 保存成功回调刷新右侧手机预览。

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react'

import { updateContent, uploadMedia } from '../../../_lib/actions'
import { colors, fonts, radii, space } from '../../../_lib/theme'
import { markdownToBody } from './markdown-to-body'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const SAVE_DEBOUNCE_MS = 800

export interface EditorProps {
  contentId: string
  /** 初始 markdown 源(doc.bodyMarkdown)。 */
  initialMarkdown: string
  /** 保存成功后回调(让外层刷新预览)。 */
  onSavedBody: () => void
  /** 上报保存状态(saving/saved/error)。 */
  onSaveStateChange: (s: SaveState) => void
}

export function Editor({ contentId, initialMarkdown, onSavedBody, onSaveStateChange }: EditorProps) {
  const [md, setMd] = useState(initialMarkdown)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // 保存：markdown → 派生 body(Lexical) → 一并写库(bodyMarkdown 为源、body 为渲染来源)。
  const save = useCallback(
    (value: string) => {
      onSaveStateChange('saving')
      let body
      try {
        body = markdownToBody(value)
      } catch {
        onSaveStateChange('error')
        return
      }
      updateContent(contentId, { bodyMarkdown: value, body })
        .then(() => {
          onSaveStateChange('saved')
          onSavedBody()
        })
        .catch(() => onSaveStateChange('error'))
    },
    [contentId, onSaveStateChange, onSavedBody],
  )

  const scheduleSave = useCallback(
    (value: string) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => save(value), SAVE_DEBOUNCE_MS)
    },
    [save],
  )

  const onChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value
      setMd(next)
      scheduleSave(next)
    },
    [scheduleSave],
  )

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  // 「插图」：选本地图 → 上传到 media → 在光标处插入 ![文件名](media:ID) → 立即保存(避免离开丢图)。
  const onPickImage = useCallback(() => {
    if (!uploading) fileRef.current?.click()
  }, [uploading])

  const onFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = '' // 允许同一文件再次选择
      if (!file) return
      setUploading(true)
      setUploadError('')
      try {
        const fd = new FormData()
        fd.append('file', file)
        const { id } = await uploadMedia(fd)
        const alt = file.name.replace(/\.[^.]+$/, '')
        const snippet = `\n![${alt}](media:${id})\n`
        const ta = taRef.current
        const at = ta ? ta.selectionStart : md.length
        const next = md.slice(0, at) + snippet + md.slice(at)
        setMd(next)
        save(next)
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : '插图失败，请重试。')
      } finally {
        setUploading(false)
      }
    },
    [md, save, uploading],
  )

  return (
    <div>
      {/* 一行语法提示 + 单个「插图」按钮(不再有工具条一坨) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.sm,
          marginBottom: 6,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 12.5, color: colors.muted, lineHeight: 1.7 }}>
          Markdown：<b>## 小节</b> · <b>### 步骤</b> · <b>**加粗**</b> · <b>- 列表</b> · <b>&gt; 引用</b> · <b>[文字](链接)</b>
        </span>
        <button type="button" onClick={onPickImage} disabled={uploading} style={insertBtnStyle(uploading)}>
          {uploading ? '上传中…' : '＋ 插图'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" onChange={onFileChange} style={{ display: 'none' }} />
      </div>

      <textarea
        ref={taRef}
        value={md}
        onChange={onChange}
        spellCheck={false}
        placeholder={
          '在这里写正文（Markdown）。例如：\n\n## 一、开篇\n\n正文段落，**加粗**、`行内码`、[链接](https://lilink.top)。\n\n- 列表项一\n- 列表项二\n\n> 一句提示\n\n配图点上方「＋ 插图」。'
        }
        style={{
          width: '100%',
          minHeight: 460,
          resize: 'vertical',
          boxSizing: 'border-box',
          padding: `14px ${space.md}`,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", monospace',
          fontSize: 15,
          lineHeight: 1.85,
          color: colors.ink,
          background: colors.surface,
          border: `1px solid ${colors.rule}`,
          borderRadius: radii.md,
          outline: 'none',
        }}
      />
      {uploadError ? (
        <div role="alert" style={{ marginTop: 6, fontSize: 13, color: colors.rose }}>
          {uploadError}
        </div>
      ) : null}
    </div>
  )
}

function insertBtnStyle(disabled: boolean): CSSProperties {
  return {
    appearance: 'none',
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: fonts.sans,
    fontSize: 13,
    fontWeight: 600,
    color: colors.rose,
    background: colors.fill,
    border: `1px solid ${colors.rose}`,
    borderRadius: radii.pill,
    padding: '6px 14px',
    opacity: disabled ? 0.6 : 1,
    whiteSpace: 'nowrap',
  }
}
