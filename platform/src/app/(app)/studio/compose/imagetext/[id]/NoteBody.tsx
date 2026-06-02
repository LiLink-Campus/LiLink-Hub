'use client'

// NoteBody.tsx —— 小红书式正文：纯文本 + #话题高亮(@lexical/hashtag) + # 联想下拉 + 计数上报。
//
// 范式说明：小红书正文是「纯文本 + #话题 + emoji + 分段」，不支持 H2/加粗/列表 那套富排版，
// 所以这里用 PlainTextPlugin（只有段落，无富节点），靠 HashtagPlugin 把「#词」自动染成蓝色，
// 靠 LexicalTypeaheadMenuPlugin 在打「#」时弹话题联想。
//
// 纯文本无损往返：用「单 ParagraphNode + 每个换行一个 LineBreakNode」表示正文。
// 依据 lexical 0.41 源码：$getRoot().getTextContent() 在相邻块级元素间会插入 '\n\n'(DOUBLE_LINE_BREAK)，
// 而 LineBreakNode 只返回单个 '\n'。所以单段落 + LineBreakNode 才能让单 \n 无损往返；
// 若改用「每行一个段落」，往返会把单 \n 变成 \n\n，破坏「段落间用 \n」的语义。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { HashtagPlugin } from '@lexical/react/LexicalHashtagPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  LexicalTypeaheadMenuPlugin,
  useBasicTypeaheadTriggerMatch,
  MenuOption,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import type { MenuRenderFn } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { HashtagNode } from '@lexical/hashtag'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type TextNode,
} from 'lexical'

import { matchTopics, parseTopics } from '@/lib/topics'
import styles from './note-body.module.css'

export interface NoteBodyProps {
  initialText: string
  /** 联想候选池（不带 #）= PRESET_TOPICS ∪ 历史。 */
  suggestions: string[]
  /** 每次内容变更上报：纯文本（保留换行）+ parseTopics(text)。 */
  onChange: (text: string, topics: string[]) => void
}

// LexicalTypeaheadMenuPlugin 要求候选是 MenuOption 子类（带唯一 key + 展示 label）。
// 候选已 dedupe，故用 label 当 key 唯一。
class TopicOption extends MenuOption {
  label: string
  constructor(label: string) {
    super(label)
    this.label = label
  }
}

export function NoteBody({ initialText, suggestions, onChange }: NoteBodyProps) {
  const initialConfig = {
    namespace: 'studio-imagetext-body',
    // theme.hashtag 决定「#词」高亮的 className；theme.paragraph 给段落基础行距。
    theme: { hashtag: styles.hashtag, paragraph: styles.paragraph },
    // HashtagPlugin 挂载时会校验 editor.hasNodes([HashtagNode])，未注册即抛错。
    nodes: [HashtagNode],
    onError: (e: Error) => console.error('[note body]', e),
    // 初始空；内容由 InitAndReport 注入（单段落 + LineBreakNode）。
    editorState: null,
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={styles.shell} style={{ position: 'relative' }}>
        <PlainTextPlugin
          contentEditable={<ContentEditable className={styles.editable} aria-label="笔记正文" />}
          placeholder={<div className={styles.placeholder}>写点什么…用 # 添加话题</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <HashtagPlugin />
      <TopicTypeahead suggestions={suggestions} />
      <InitAndReport initialText={initialText} onChange={onChange} />
    </LexicalComposer>
  )
}

// 初始注入（只一次）+ 纯文本/话题上报。
function InitAndReport({
  initialText,
  onChange,
}: {
  initialText: string
  onChange: NoteBodyProps['onChange']
}) {
  const [editor] = useLexicalComposerContext()
  const readyRef = useRef(false)
  const lastRef = useRef<string>('')

  // 初次：单段落 + 每个 \n → LineBreakNode（getTextContent 单段内 \n 保真）。
  useEffect(() => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const p = $createParagraphNode()
      const lines = (initialText || '').split('\n')
      lines.forEach((line, i) => {
        if (i > 0) p.append($createLineBreakNode())
        if (line.length > 0) p.append($createTextNode(line))
      })
      root.append(p)
    })
    lastRef.current = initialText || ''
    readyRef.current = true
    // 仅在挂载时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 变更上报：忽略初始化前的那次 update；用「文本是否变化」过滤纯选区变化。
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      if (!readyRef.current) return
      const text = editorState.read(() => $getRoot().getTextContent())
      if (text === lastRef.current) return
      lastRef.current = text
      onChange(text, parseTopics(text))
    })
  }, [editor, onChange])

  return null
}

// # 联想：LexicalTypeaheadMenuPlugin + useBasicTypeaheadTriggerMatch('#')。
function TopicTypeahead({ suggestions }: { suggestions: string[] }) {
  const [editor] = useLexicalComposerContext()
  const [query, setQuery] = useState<string | null>(null)

  // minLength:0 → 刚打出 # 就弹候选；matchingString = # 后查询词（不含 #）。
  // 触发要求 # 前是 行首/空白/左括号，所以词中间的 # 不会触发（正合话题语义）。
  const triggerFn = useBasicTypeaheadTriggerMatch('#', { minLength: 0 })

  const options = useMemo(
    () => matchTopics(query ?? '', suggestions, 8).map((t) => new TopicOption(t)),
    [query, suggestions],
  )

  // 选中 → 把「当前 #查询」那个 TextNode 替换为「#词 」（HashtagPlugin 随后转成 HashtagNode）。
  // 关键：LexicalTypeaheadMenuPlugin 内部对 LexicalMenu 硬编码 shouldSplitNodeWithQuery:true，
  // 选中时已 $splitNodeContainingQuery，故 nodeToReplace 正是「仅含当前 #查询 文本」的节点，直接 replace 最稳。
  const onSelectOption = useCallback(
    (selected: TopicOption, nodeToReplace: TextNode | null, closeMenu: () => void) => {
      editor.update(() => {
        const tag = $createTextNode(`#${selected.label} `)
        // nodeToReplace 为 null 是 $splitNodeContainingQuery 的边界（选区非折叠/非 simple text）：
        // 此时不强插游离节点（避免对未挂载节点调用 select），直接关菜单即可。
        if (nodeToReplace) {
          nodeToReplace.replace(tag)
          tag.select()
        }
      })
      closeMenu()
    },
    [editor],
  )

  const menuRenderFn: MenuRenderFn<TopicOption> = (
    anchorRef,
    { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex, options: opts },
  ) => {
    if (anchorRef.current == null || opts.length === 0) return null
    return createPortal(
      <ul className={styles.menu}>
        {opts.map((opt, i) => (
          <li
            key={opt.key}
            className={i === selectedIndex ? styles.menuItemActive : styles.menuItem}
            onMouseEnter={() => setHighlightedIndex(i)}
            onMouseDown={(e) => {
              // 用 onMouseDown + preventDefault（而非 onClick）：否则点击先让编辑器失焦、丢选区。
              e.preventDefault()
              selectOptionAndCleanUp(opt)
            }}
          >
            #{opt.label}
          </li>
        ))}
      </ul>,
      anchorRef.current,
    )
  }

  return (
    <LexicalTypeaheadMenuPlugin<TopicOption>
      options={options}
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      menuRenderFn={menuRenderFn}
    />
  )
}
