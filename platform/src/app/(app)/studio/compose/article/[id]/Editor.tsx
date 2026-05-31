'use client'

// Editor.tsx —— 公众号长文「所见即所得」富文本编辑器（@lexical/react）。
//
// 职责：
//   - 用 LexicalComposer 搭一个富文本编辑器，节点支持 标题(H2/H3/H4)/段落/有序无序列表/
//     引用/链接/自定义插图(ImageNode)；插件：RichText/History/List/Link/OnChange。
//   - 顶部工具条（中文 tooltip）：H2/H3/H4、加粗、斜体、有序/无序列表、引用、链接、插图。
//   - onChange 防抖后：把编辑器状态经 toPayloadBody 适配成渲染器形状，调 updateContent 存进
//     channel-content.body；并通过 onSavedBody 回调把「已 populate 的预览态 body」交给父页刷新预览。
//
// 与渲染器的契约：保存进 body 的必须是 renderToInlineHtml 能消费的 Payload 形状——
// 链接/图片的转换由 to-payload-body.ts 完成（详见该文件注释）。

import { useCallback, useEffect, useRef, useState } from 'react'

import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

import {
  $getSelection,
  $isRangeSelection,
  $insertNodes,
  FORMAT_TEXT_COMMAND,
  type EditorState,
  type LexicalEditor,
} from 'lexical'
import { $setBlocksType } from '@lexical/selection'
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingNode,
  QuoteNode,
  type HeadingTagType,
} from '@lexical/rich-text'
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
  ListItemNode,
} from '@lexical/list'
import { $createParagraphNode } from 'lexical'
import { LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'

import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'

import { updateContent, uploadMedia } from '../../../_lib/actions'
import { colors, fonts, radii, space } from '../../../_lib/theme'
import { ImageNode, $createImageNode } from './ImageNode'
import { toPayloadBody } from './to-payload-body'

// ============================================================
// 编辑器主题（class 名 → 由下方注入的 <style> 上色；仅作用于编辑器外观，
// 与最终公众号产物无关，产物永远是渲染器输出的全内联 HTML）。
// ============================================================

const editorTheme = {
  paragraph: 'sw-p',
  quote: 'sw-quote',
  heading: { h2: 'sw-h2', h3: 'sw-h3', h4: 'sw-h4' },
  list: {
    ul: 'sw-ul',
    ol: 'sw-ol',
    listitem: 'sw-li',
  },
  link: 'sw-link',
  text: {
    bold: 'sw-bold',
    italic: 'sw-italic',
  },
}

// 编辑器内部外观样式（scoped 到 .sw-editor-scope；不影响公众号产物）。
const EDITOR_SCOPE_CSS = `
.sw-editor-scope { font-family: ${fonts.sans}; color: ${colors.ink}; }
.sw-editor-scope .sw-content {
  outline: none;
  min-height: 320px;
  padding: ${space.md};
  font-size: 16px;
  line-height: 1.9;
  caret-color: ${colors.rose};
}
.sw-editor-scope .sw-p { margin: 0 0 1em; }
.sw-editor-scope .sw-h2 { font-family: ${fonts.serif}; font-size: 21px; font-weight: 700; color: ${colors.inkStrong}; margin: 1.4em 0 .6em; line-height: 1.45; }
.sw-editor-scope .sw-h3 { font-size: 17px; font-weight: 600; color: ${colors.inkStrong}; margin: 1.2em 0 .5em; line-height: 1.5; }
.sw-editor-scope .sw-h4 { font-size: 14px; font-weight: 700; color: ${colors.rose}; letter-spacing: .05em; margin: 1.1em 0 .4em; }
.sw-editor-scope .sw-ul { margin: .6em 0 1em; padding-left: 1.4em; list-style: disc; }
.sw-editor-scope .sw-ol { margin: .6em 0 1em; padding-left: 1.5em; list-style: decimal; }
.sw-editor-scope .sw-li { margin: .35em 0; }
.sw-editor-scope .sw-quote { margin: 1.2em 0; padding: 10px 14px; border-left: 2px solid ${colors.rose}; background: ${colors.fill}; border-radius: 0 6px 6px 0; color: ${colors.inkStrong}; }
.sw-editor-scope .sw-link { color: ${colors.rose}; text-decoration: underline; }
.sw-editor-scope .sw-bold { font-weight: 700; color: ${colors.inkStrong}; }
.sw-editor-scope .sw-italic { font-style: italic; }
.sw-editor-scope .sw-placeholder { color: ${colors.muted}; }
`

// ============================================================
// 工具条
// ============================================================

type ToolbarProps = {
  /** 上传中禁用插图按钮，给出反馈。 */
  uploading: boolean
  onPickImage: () => void
}

// 单个工具按钮（中文 title 作 tooltip）。
function ToolButton({
  title,
  onClick,
  children,
  disabled,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault() /* 不抢走编辑器选区 */}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        minWidth: 40,
        height: 38,
        padding: '0 10px',
        borderRadius: radii.sm,
        border: `1px solid ${colors.rule}`,
        background: hover && !disabled ? colors.fill : colors.surface,
        color: disabled ? colors.muted : colors.inkStrong,
        fontSize: 14.5,
        fontWeight: 600,
        fontFamily: fonts.sans,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

function Toolbar({ uploading, onPickImage }: ToolbarProps) {
  const [editor] = useLexicalComposerContext()

  // 设为标题：选中块整体转成 heading（tag）。
  const setHeading = useCallback(
    (tag: HeadingTagType) => {
      editor.update(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createHeadingNode(tag))
        }
      })
    },
    [editor],
  )

  // 设为引用。
  const setQuote = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createQuoteNode())
      }
    })
  }, [editor])

  // 设为普通段落（用于「取消标题/引用」回正文）。
  const setParagraph = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createParagraphNode())
      }
    })
  }, [editor])

  // 插入/编辑链接：弹窗收 URL，空则取消链接。
  const insertLink = useCallback(() => {
    const url = window.prompt('请输入链接地址（http(s)://…），留空可取消链接')
    if (url === null) return
    const trimmed = url.trim()
    if (!trimmed) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
      return
    }
    // 新标签打开外链（renderToInlineHtml 会据 newTab 输出 target=_blank）。
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, { url: trimmed, target: '_blank' })
  }, [editor])

  const groupStyle: React.CSSProperties = {
    display: 'inline-flex',
    gap: space.xs,
    alignItems: 'center',
  }
  const dividerStyle: React.CSSProperties = {
    width: 1,
    height: 24,
    background: colors.rule,
    margin: `0 ${space.xs}`,
  }

  return (
    <div
      role="toolbar"
      aria-label="编辑工具条"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: space.xs,
        alignItems: 'center',
        padding: space.sm,
        borderBottom: `1px solid ${colors.rule}`,
        background: colors.page,
        position: 'sticky',
        top: 0,
        zIndex: 5,
      }}
    >
      <div style={groupStyle}>
        <ToolButton title="正文（取消标题/引用）" onClick={setParagraph}>
          正文
        </ToolButton>
        <ToolButton title="大标题（H2）" onClick={() => setHeading('h2')}>
          H2
        </ToolButton>
        <ToolButton title="小标题（H3）" onClick={() => setHeading('h3')}>
          H3
        </ToolButton>
        <ToolButton title="眉标（H4）" onClick={() => setHeading('h4')}>
          H4
        </ToolButton>
      </div>

      <span style={dividerStyle} aria-hidden />

      <div style={groupStyle}>
        <ToolButton
          title="加粗"
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
        >
          <strong>B</strong>
        </ToolButton>
        <ToolButton
          title="斜体"
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
        >
          <em>I</em>
        </ToolButton>
      </div>

      <span style={dividerStyle} aria-hidden />

      <div style={groupStyle}>
        <ToolButton
          title="无序列表（圆点）"
          onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
        >
          • 列表
        </ToolButton>
        <ToolButton
          title="有序列表（编号）"
          onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
        >
          1. 列表
        </ToolButton>
        <ToolButton title="引用 / 提示卡" onClick={setQuote}>
          引用
        </ToolButton>
      </div>

      <span style={dividerStyle} aria-hidden />

      <div style={groupStyle}>
        <ToolButton title="插入链接" onClick={insertLink}>
          链接
        </ToolButton>
        <ToolButton title="插入图片（从本地选图上传）" onClick={onPickImage} disabled={uploading}>
          {uploading ? '上传中…' : '插图'}
        </ToolButton>
      </div>
    </div>
  )
}

// ============================================================
// 插图：插入节点的内部插件（拿 editor 上下文）
// ============================================================

// 暴露一个 ref 句柄，让外层文件 input 的 onChange 能把上传结果插进编辑器。
function ImageInsertBridge({
  registerInsert,
}: {
  registerInsert: (fn: (args: { mediaId: string; url: string; alt?: string }) => void) => void
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    registerInsert((args) => {
      editor.update(() => {
        const node = $createImageNode(args)
        $insertNodes([node])
      })
    })
  }, [editor, registerInsert])
  return null
}

// ============================================================
// Editor 主组件
// ============================================================

export interface EditorProps {
  /** 渠道稿 id（保存目标）。 */
  contentId: string
  /** 初始 body（来自 getContent 的 doc.body；可能是 populated 形状或空）。 */
  initialBody: SerializedEditorState | null | undefined
  /**
   * 保存成功后回调：把刚保存（已转成 Payload 形状）的 body 交给父页用于刷新预览。
   * 父页可据此对 body 调 renderToInlineHtml（经 server action）重渲染右侧手机预览。
   */
  onSavedBody?: (body: SerializedEditorState) => void
  /** 保存状态变化回调（idle/saving/saved/error），父页据此显示「已保存 / 保存中」。 */
  onSaveStateChange?: (state: SaveState) => void
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 900

export function Editor({ contentId, initialBody, onSavedBody, onSaveStateChange }: EditorProps) {
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // 由 ImageInsertBridge 注册进来的「插入图片」函数。
  const insertImageRef = useRef<
    ((args: { mediaId: string; url: string; alt?: string }) => void) | null
  >(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 初始编辑器状态：把 populated 的 body 还原成可被 Lexical 解析的形状。
  // initialBody 里的 upload 节点 value 可能是「完整 media 文档」（depth>=1），需折叠回
  // ImageNode 能 importJSON 的形状（value=id, url, fields.alt）。其余节点 Lexical 可直接吃。
  const initialEditorState = useCallback(
    (editor: LexicalEditor) => {
      const normalized = normalizeInitialBody(initialBody)
      if (!normalized) return // 空文档：Lexical 自建空 root
      try {
        const state = editor.parseEditorState(normalized as never)
        editor.setEditorState(state)
      } catch {
        // 解析失败（脏数据）：留空文档，避免编辑器崩。
      }
    },
    [initialBody],
  )

  const initialConfig = {
    namespace: 'studio-article-editor',
    theme: editorTheme,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, ImageNode],
    editorState: initialEditorState,
    onError(error: Error) {
      // 不抛出（抛出会整页崩）；编辑器内部错误吞掉并记录。
      console.error('[studio editor] lexical error:', error)
    },
  }

  // 触发文件选择。
  const onPickImage = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // 文件选好 → 上传 → 插入。
  const onFileChosen = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      // 复位 input，便于连续选同一文件也能触发 onChange。
      e.target.value = ''
      if (!file) return
      setUploading(true)
      try {
        const fd = new FormData()
        fd.append('file', file)
        const { id, url } = await uploadMedia(fd)
        insertImageRef.current?.({ mediaId: id, url, alt: '' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : '上传失败，请重试。'
        window.alert(msg)
      } finally {
        setUploading(false)
      }
    },
    [],
  )

  // onChange：防抖保存。
  const handleChange = useCallback(
    (editorState: EditorState) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        const json = editorState.toJSON()
        const body = toPayloadBody(json as unknown as SerializedEditorState)
        onSaveStateChange?.('saving')
        updateContent(contentId, { body: body as unknown as Record<string, unknown> })
          .then(() => {
            onSaveStateChange?.('saved')
            onSavedBody?.(body)
          })
          .catch(() => {
            onSaveStateChange?.('error')
          })
      }, DEBOUNCE_MS)
    },
    [contentId, onSavedBody, onSaveStateChange],
  )

  // 卸载时清掉未触发的防抖定时器。
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])

  const registerInsert = useCallback(
    (fn: (args: { mediaId: string; url: string; alt?: string }) => void) => {
      insertImageRef.current = fn
    },
    [],
  )

  return (
    <div
      className="sw-editor-scope"
      style={{
        border: `1px solid ${colors.rule}`,
        borderRadius: radii.md,
        background: colors.surface,
        overflow: 'hidden',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: EDITOR_SCOPE_CSS }} />
      <LexicalComposer initialConfig={initialConfig}>
        <Toolbar uploading={uploading} onPickImage={onPickImage} />
        <div style={{ position: 'relative' }}>
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="sw-content"
                aria-label="公众号正文编辑区"
                style={{ minHeight: 320 }}
              />
            }
            placeholder={
              <div
                className="sw-placeholder"
                style={{
                  position: 'absolute',
                  top: space.md,
                  left: space.md,
                  pointerEvents: 'none',
                  fontSize: 16,
                  lineHeight: 1.9,
                }}
              >
                在这里开始写正文：用 H2/H3 分小节，配图、列表、引用都可以…
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          <LinkPlugin />
          <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
          <ImageInsertBridge registerInsert={registerInsert} />
        </div>
      </LexicalComposer>

      {/* 隐藏的文件选择器（插图用）。 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={onFileChosen}
        style={{ display: 'none' }}
      />
    </div>
  )
}

// ============================================================
// 初始 body 归一：把 populated 的 upload 节点折回 ImageNode 可解析的形状。
// ============================================================

type AnyNode = Record<string, unknown>

/**
 * 把来自 DB（depth>=1，upload.value 已 populate 成 media 文档）的 body 归一成
 * ImageNode.importJSON 能吃的形状：value 折回 id 字符串，并补上 url（取 media.url）。
 * 链接节点保持 Payload 形状（{fields:{url,...}}）——Lexical 原生 LinkNode.importJSON
 * 读不到顶层 url 时会安全降级，且我们的 toPayloadBody 在再次保存时会重新规整。
 * 为稳妥，这里也把 Payload 形状的 link 折回 Lexical 原生可解析的 {url,target}。
 */
function normalizeInitialBody(
  body: SerializedEditorState | null | undefined,
): SerializedEditorState | null {
  const bodyObj = body as unknown as AnyNode | null | undefined
  const root =
    bodyObj && typeof bodyObj === 'object' && bodyObj.root ? (bodyObj.root as AnyNode) : null
  if (!root) return null
  const normRoot = normNode(root)
  return { root: normRoot } as unknown as SerializedEditorState
}

function normNode(node: AnyNode): AnyNode {
  const type = typeof node.type === 'string' ? node.type : ''
  const rawChildren = Array.isArray(node.children) ? (node.children as AnyNode[]) : null
  const children = rawChildren ? rawChildren.map(normNode) : undefined

  // upload（图片）：value 可能是完整 media 文档 → 折回 id，并补 url。
  if (type === 'upload') {
    const value = node.value
    let mediaId = ''
    let url = typeof node.url === 'string' ? node.url : ''
    if (value && typeof value === 'object') {
      const v = value as AnyNode
      mediaId = String(v.id ?? '')
      if (!url && typeof v.url === 'string') url = v.url
    } else if (value != null) {
      mediaId = String(value)
    }
    const fields = node.fields && typeof node.fields === 'object' ? (node.fields as AnyNode) : {}
    return {
      type: 'upload',
      relationTo: 'media',
      value: mediaId,
      url,
      fields: { alt: typeof fields.alt === 'string' ? fields.alt : '' },
      version: 1,
    }
  }

  // link：Payload 形状 {fields:{url,newTab}} → Lexical 原生 {url, target}（便于编辑器解析）。
  if (type === 'link') {
    const fields = node.fields && typeof node.fields === 'object' ? (node.fields as AnyNode) : null
    const url =
      (fields && typeof fields.url === 'string' && fields.url) ||
      (typeof node.url === 'string' ? node.url : '') ||
      ''
    const newTab = fields && typeof fields.newTab === 'boolean' ? fields.newTab : node.target === '_blank'
    return {
      type: 'link',
      version: typeof node.version === 'number' ? node.version : 1,
      direction: node.direction ?? 'ltr',
      format: node.format ?? '',
      indent: typeof node.indent === 'number' ? node.indent : 0,
      url,
      target: newTab ? '_blank' : null,
      rel: newTab ? 'noopener noreferrer' : null,
      title: null,
      ...(children ? { children } : { children: [] }),
    }
  }

  if (children) return { ...node, children }
  return { ...node }
}
