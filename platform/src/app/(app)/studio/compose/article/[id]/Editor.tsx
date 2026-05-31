'use client'

// Editor.tsx —— Typora 式内联 WYSIWYG 编辑器（@lexical/react）。
//
// 体验目标（对标 Typora）：编辑区本身就是「成品样式」，边写边渲染——
//   打 `## ` 立即变章节标题、`**x**` 变加粗、`- ` 变列表、`> ` 变提示卡……（markdown 实时快捷转换）。
//   无工具条、无右侧预览面板；图片在正文里内联显示。
// 落库：用 markdown 作往返源——加载时 markdown→编辑器；保存时编辑器→markdown(bodyMarkdown)
//   + markdownToBody 派生 body(Lexical)，发布/预览渲染仍走现有 renderToInlineHtml(body)，下游不变。

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'

import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  HEADING,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  BOLD_STAR,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  INLINE_CODE,
  LINK,
  type TextMatchTransformer,
} from '@lexical/markdown'
import { $insertNodes } from 'lexical'
import { $dfs } from '@lexical/utils'

import { updateContent, uploadMedia } from '../../../_lib/actions'
import { colors, fonts, radii } from '../../../_lib/theme'
import { markdownToBody } from './markdown-to-body'
import { ImageNode, $createImageNode, $isImageNode } from './ImageNode'
import styles from './editor.module.css'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const SAVE_DEBOUNCE_MS = 800

// 图片 markdown ↔ ImageNode：![alt](media:ID)。
const IMAGE: TextMatchTransformer = {
  dependencies: [ImageNode],
  export: (node) => {
    if (!$isImageNode(node)) return null
    return `![${node.getAlt()}](media:${node.getMediaId()})`
  },
  importRegExp: /!\[([^\]]*)\]\((media:\d+|\d+)\)/,
  regExp: /!\[([^\]]*)\]\((media:\d+|\d+)\)$/,
  replace: (textNode, match) => {
    const alt = match[1] ?? ''
    const id = (match[2] ?? '').replace(/^media:/, '')
    textNode.replace($createImageNode({ mediaId: Number(id) || id, url: '', alt }))
  },
  trigger: ')',
  type: 'text-match',
}

// 受控的 markdown 转换集合（仅公众号需要的子集，与 markdownToBody 一致）。
const TRANSFORMERS = [
  IMAGE,
  HEADING,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  BOLD_STAR,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  INLINE_CODE,
  LINK,
]

// 节点 → CSS module 类（把编辑面渲成公众号成品样式）。
const editorTheme = {
  paragraph: styles.paragraph,
  heading: { h1: styles.h2, h2: styles.h2, h3: styles.h3, h4: styles.h4, h5: styles.h4, h6: styles.h4 },
  text: { bold: styles.bold, italic: styles.italic, code: styles.code },
  list: {
    ul: styles.ul,
    ol: styles.ol,
    listitem: styles.listItem,
    nested: { listitem: styles.nestedList },
  },
  quote: styles.quote,
  link: styles.link,
}

export interface EditorProps {
  contentId: string
  /** 初始 markdown 源（doc.bodyMarkdown）。 */
  initialMarkdown: string
  /** 媒体 id → 直链 url（取自已 populate 的 body，用于加载时内联显示图片）。 */
  imageUrlMap: Record<string, string>
  /** 上报保存状态。 */
  onSaveStateChange: (s: SaveState) => void
}

export function Editor({ contentId, initialMarkdown, imageUrlMap, onSaveStateChange }: EditorProps) {
  const initialConfig = {
    namespace: 'studio-article',
    theme: editorTheme,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, ImageNode],
    onError: (e: Error) => console.error('[studio editor]', e),
    // 初始空；内容由 LoadAndSave 插件按 markdown 注入（需异步取 image url 映射）。
    editorState: null,
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ImageInsertButton onSaveStateChange={onSaveStateChange} />
      <div style={{ position: 'relative' }}>
        <RichTextPlugin
          contentEditable={<ContentEditable className={styles.editable} aria-label="公众号正文编辑区" />}
          placeholder={
            <div className={styles.placeholder}>
              在这里开始写……打「## 」是小节标题、「**字**」加粗、「- 」列表、「&gt; 」引用，像写 Markdown 一样，边写边成型。
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin />
      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      <LoadAndSave
        contentId={contentId}
        initialMarkdown={initialMarkdown}
        imageUrlMap={imageUrlMap}
        onSaveStateChange={onSaveStateChange}
      />
    </LexicalComposer>
  )
}

// 加载（markdown→编辑器，回填图片 url）+ 保存（编辑器→markdown + 派生 body，防抖写库）。
function LoadAndSave({
  contentId,
  initialMarkdown,
  imageUrlMap,
  onSaveStateChange,
}: {
  contentId: string
  initialMarkdown: string
  imageUrlMap: Record<string, string>
  onSaveStateChange: (s: SaveState) => void
}) {
  const [editor] = useLexicalComposerContext()
  const readyRef = useRef(false)
  const lastMdRef = useRef<string>('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 初次加载：把 bodyMarkdown 注入编辑器，并按 imageUrlMap 回填图片直链。
  useEffect(() => {
    editor.update(() => {
      $convertFromMarkdownString(initialMarkdown || '', TRANSFORMERS)
      for (const { node } of $dfs()) {
        if ($isImageNode(node)) {
          const url = imageUrlMap[String(node.getMediaId())]
          if (url) node.setUrl(url)
        }
      }
    })
    lastMdRef.current = initialMarkdown || ''
    readyRef.current = true
    // 仅在挂载时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 保存：内容变化(忽略纯选区变化——用 md 是否变化判断)→ 防抖写 bodyMarkdown + 派生 body。
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      if (!readyRef.current) return
      const md = editorState.read(() => $convertToMarkdownString(TRANSFORMERS))
      if (md === lastMdRef.current) return
      lastMdRef.current = md
      if (timerRef.current) clearTimeout(timerRef.current)
      onSaveStateChange('saving')
      timerRef.current = setTimeout(() => {
        let body
        try {
          body = markdownToBody(md)
        } catch {
          onSaveStateChange('error')
          return
        }
        updateContent(contentId, { bodyMarkdown: md, body })
          .then(() => onSaveStateChange('saved'))
          .catch(() => onSaveStateChange('error'))
      }, SAVE_DEBOUNCE_MS)
    })
  }, [editor, contentId, onSaveStateChange])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  return null
}

// 「插图」：唯一的非文字按钮（上传图需 URL，无法纯手打）。上传后在光标处插入内联图片节点。
function ImageInsertButton({ onSaveStateChange }: { onSaveStateChange: (s: SaveState) => void }) {
  const [editor] = useLexicalComposerContext()
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const onFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      setUploading(true)
      try {
        const fd = new FormData()
        fd.append('file', file)
        const { id, url } = await uploadMedia(fd)
        const alt = file.name.replace(/\.[^.]+$/, '')
        editor.update(() => {
          $insertNodes([$createImageNode({ mediaId: Number(id) || id, url, alt })])
        })
      } catch {
        onSaveStateChange('error')
      } finally {
        setUploading(false)
      }
    },
    [editor, onSaveStateChange],
  )

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
      <button
        type="button"
        onClick={() => !uploading && fileRef.current?.click()}
        disabled={uploading}
        style={{
          appearance: 'none',
          cursor: uploading ? 'default' : 'pointer',
          fontFamily: fonts.sans,
          fontSize: 13,
          fontWeight: 600,
          color: colors.rose,
          background: 'transparent',
          border: `1px solid ${colors.rose}`,
          borderRadius: radii.pill,
          padding: '5px 14px',
          opacity: uploading ? 0.6 : 1,
        }}
      >
        {uploading ? '上传中…' : '＋ 插图'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
    </div>
  )
}
