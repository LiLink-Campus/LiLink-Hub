'use client'

// Editor.tsx —— Typora 式内联 WYSIWYG 编辑器（@lexical/react）。
//
// 体验目标（对标 Typora）：编辑区本身就是「成品样式」，边写边渲染——
//   打 `## ` 立即变章节标题、`**x**` 变加粗、`- ` 变列表、`> ` 变提示卡……（markdown 实时快捷转换）。
//   无工具条、无右侧预览面板；图片在正文里内联显示。
// 落库：用 markdown 作往返源——加载时 markdown→编辑器；保存时编辑器→markdown(bodyMarkdown)
//   + markdownToBody 派生 body(Lexical)，发布/预览渲染仍走现有 renderToInlineHtml(body)，下游不变。

import { useEffect, useRef } from 'react'

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
import {
  $insertNodes,
  COMMAND_PRIORITY_HIGH,
  DRAGOVER_COMMAND,
  DROP_COMMAND,
  PASTE_COMMAND,
} from 'lexical'
import { $dfs } from '@lexical/utils'

import { updateContent, uploadMedia } from '../../../_lib/actions'
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
      <div style={{ position: 'relative' }}>
        <RichTextPlugin
          contentEditable={<ContentEditable className={styles.editable} aria-label="公众号正文编辑区" />}
          placeholder={
            <div className={styles.placeholder}>
              在这里开始写……打「## 」是小节标题、「**字**」加粗、「- 」列表、「&gt; 」引用；图片直接粘贴或拖进来即可。像写 Markdown 一样，边写边成型。
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin />
      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      <ImagePastePlugin onSaveStateChange={onSaveStateChange} />
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

// 自然插图：直接「粘贴」或「拖拽」图片到编辑器 → 自动上传并在光标处内联插入（无需按钮）。
function ImagePastePlugin({ onSaveStateChange }: { onSaveStateChange: (s: SaveState) => void }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    // 上传一组图片并在当前光标处依次插入内联图片节点。
    const uploadAndInsert = async (files: File[]) => {
      onSaveStateChange('saving')
      for (const file of files) {
        try {
          const fd = new FormData()
          fd.append('file', file)
          const { id, url } = await uploadMedia(fd)
          const alt = (file.name || 'image').replace(/\.[^.]+$/, '')
          editor.update(() => {
            $insertNodes([$createImageNode({ mediaId: Number(id) || id, url, alt })])
          })
        } catch {
          onSaveStateChange('error')
        }
      }
    }

    // 粘贴板取图（截图常在 items、文件常在 files，两者都查）。
    const imagesFromClipboard = (dt: DataTransfer | null): File[] => {
      if (!dt) return []
      const out: File[] = []
      if (dt.files && dt.files.length) {
        for (const f of Array.from(dt.files)) if (f.type.startsWith('image/')) out.push(f)
      }
      if (!out.length && dt.items) {
        for (const it of Array.from(dt.items)) {
          if (it.kind === 'file' && it.type.startsWith('image/')) {
            const f = it.getAsFile()
            if (f) out.push(f)
          }
        }
      }
      return out
    }
    const imagesFromDrop = (dt: DataTransfer | null): File[] =>
      dt ? Array.from(dt.files).filter((f) => f.type.startsWith('image/')) : []

    const unPaste = editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const imgs = imagesFromClipboard(event.clipboardData)
        if (!imgs.length) return false // 非图片 → 交给 Lexical 默认粘贴（文字等）
        event.preventDefault()
        void uploadAndInsert(imgs)
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )
    const unDrop = editor.registerCommand(
      DROP_COMMAND,
      (event: DragEvent) => {
        const imgs = imagesFromDrop(event.dataTransfer)
        if (!imgs.length) return false
        event.preventDefault()
        void uploadAndInsert(imgs)
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )
    const unDragover = editor.registerCommand(
      DRAGOVER_COMMAND,
      (event: DragEvent) => {
        // 拖入文件时阻止默认（否则浏览器会打开文件），让 drop 生效。
        if (event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')) {
          event.preventDefault()
          return true
        }
        return false
      },
      COMMAND_PRIORITY_HIGH,
    )
    return () => {
      unPaste()
      unDrop()
      unDragover()
    }
  }, [editor, onSaveStateChange])

  return null
}
