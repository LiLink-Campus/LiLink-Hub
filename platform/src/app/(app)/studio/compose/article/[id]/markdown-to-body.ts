// markdown-to-body.ts —— 把公众号长文的 markdown 源转成渲染层(renderToInlineHtml)吃的
// Lexical body(SerializedEditorState)。这样运营写 markdown、下游公众号渲染/发布链路完全不变。
//
// 支持的 markdown 子集(够公众号排版,刻意克制):
//   #/##/###/#### → 标题 h1/h2/h3/h4(正文里一般用 ## 小节、### 步骤;# 主标题不常用)
//   段落:空行分隔;段内换行 → <br>
//   行内:**加粗**  *斜体* 或 _斜体_  `行内码`  [文本](链接)
//   列表:- / * 无序;1. 有序(连续行成一个列表)
//   引用:> 开头(连续行合成一个引用卡)
//   图片:独占一行 ![alt](media:ID) / ![alt](ID) / ![alt](url)  —— 上传图用「插图」按钮插入 media:ID
//   分隔线:--- 或 ***
//
// 产物节点形状与 renderers/lexical-to-wechat.ts 的 converters 严格对齐(text 用 format 位掩码:
// 加粗1/斜体2/行内码16;link 用 fields.url;图片用 upload 节点 value=媒体 id)。

import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'

type N = Record<string, unknown>

const text = (t: string, format = 0): N => ({
  type: 'text',
  text: t,
  format,
  detail: 0,
  mode: 'normal',
  style: '',
  version: 1,
})
const el = (type: string, extra: N): N => ({ type, version: 1, direction: 'ltr', format: '', indent: 0, ...extra })

// 文本格式位掩码(与 lexical 内核 / 渲染层一致)。
const BOLD = 1
const ITALIC = 2
const CODE = 16

// ---------- 行内解析:把一段文本拆成 text / link / 带格式的 text 节点 ----------
// 处理非嵌套的 **加粗** / *斜体* / _斜体_ / `码` / [文本](链接)。每次取最靠前的标记，
// 前面的纯文本原样成 text 节点；够覆盖公众号写作，嵌套(如 **[x](y)**)按单层降级处理。
function parseInline(input: string): N[] {
  const out: N[] = []
  let s = input
  // 匹配:链接 / 加粗 / 斜体(*或_) / 行内码。用交替正则找最早出现的一个。
  const re = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(_([^_]+)_)|(`([^`]+)`)/
  while (s.length > 0) {
    const m = re.exec(s)
    if (!m) {
      out.push(text(s))
      break
    }
    if (m.index > 0) out.push(text(s.slice(0, m.index)))
    if (m[1]) {
      // [文本](链接)：m[2]=文本，m[3]=链接。
      const label = m[2]
      const url = m[3]
      out.push(
        el('link', {
          fields: { url, linkType: 'custom', newTab: false },
          children: [text(label)],
        }),
      )
    } else if (m[4]) {
      // **加粗**：m[5]=内容。
      out.push(text(m[5], BOLD))
    } else if (m[6]) {
      // *斜体*：m[7]=内容。
      out.push(text(m[7], ITALIC))
    } else if (m[8]) {
      // _斜体_：m[9]=内容。
      out.push(text(m[9], ITALIC))
    } else if (m[10]) {
      // `行内码`：m[11]=内容。
      out.push(text(m[11], CODE))
    }
    s = s.slice(m.index + m[0].length)
  }
  return out.length ? out : [text('')]
}

// 段内多行 → 行内节点 + 软换行(<br>)。
function inlineWithBreaks(lines: string[]): N[] {
  const out: N[] = []
  lines.forEach((line, i) => {
    if (i > 0) out.push({ type: 'linebreak', version: 1 })
    out.push(...parseInline(line))
  })
  return out
}

const RE_HEADING = /^(#{1,4})\s+(.*)$/
const RE_QUOTE = /^>\s?(.*)$/
const RE_UL = /^[-*]\s+(.*)$/
const RE_OL = /^(\d+)\.\s+(.*)$/
const RE_HR = /^(-{3,}|\*{3,})\s*$/
const RE_IMG = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/

// 图片 ref → 上传节点 value。media:ID / 纯数字 → 媒体 id(number,读取时按 depth populate 成
// 媒体文档);否则当作直链 url(value 存 {url},预览可直接显示)。
function imageNode(alt: string, ref: string): N {
  const trimmed = ref.trim()
  const idMatch = /^(?:media:)?(\d+)$/.exec(trimmed)
  const value: unknown = idMatch ? Number(idMatch[1]) : { url: trimmed }
  return {
    type: 'upload',
    relationTo: 'media',
    value,
    fields: { alt },
    version: 1,
  }
}

/**
 * markdown 源 → Lexical body。空/无内容时返回只含空根的合法 body。
 */
export function markdownToBody(md: string): SerializedEditorState {
  const children: N[] = []
  const lines = (md ?? '').replace(/\r\n?/g, '\n').split('\n')

  let i = 0
  // 段落 / 引用累积缓冲。
  let para: string[] = []
  const flushPara = () => {
    if (para.length) {
      children.push(el('paragraph', { children: inlineWithBreaks(para) }))
      para = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      flushPara()
      i++
      continue
    }

    // 图片(独占一行)。
    const img = RE_IMG.exec(line)
    if (img) {
      flushPara()
      // upload 节点已是完整形状(renderer 读 value/fields/relationTo),直接放入。
      children.push(imageNode(img[1], img[2]))
      i++
      continue
    }

    // 分隔线。
    if (RE_HR.test(line)) {
      flushPara()
      children.push({ type: 'horizontalrule', version: 1 })
      i++
      continue
    }

    // 标题。
    const h = RE_HEADING.exec(line)
    if (h) {
      flushPara()
      const level = h[1].length // 1..4
      children.push(el('heading', { tag: `h${level}`, children: parseInline(h[2]) }))
      i++
      continue
    }

    // 引用(连续 > 行)。
    if (RE_QUOTE.test(line)) {
      flushPara()
      const qlines: string[] = []
      while (i < lines.length) {
        const qm = RE_QUOTE.exec(lines[i])
        if (!qm) break
        qlines.push(qm[1])
        i++
      }
      children.push(el('quote', { children: inlineWithBreaks(qlines) }))
      continue
    }

    // 无序列表(连续 - / * 行)。
    if (RE_UL.test(line)) {
      flushPara()
      const items: N[] = []
      while (i < lines.length) {
        const um = RE_UL.exec(lines[i])
        if (!um) break
        items.push(el('listitem', { value: items.length + 1, children: parseInline(um[1]) }))
        i++
      }
      children.push(el('list', { tag: 'ul', listType: 'bullet', start: 1, children: items }))
      continue
    }

    // 有序列表(连续 1. 行)。
    if (RE_OL.test(line)) {
      flushPara()
      const items: N[] = []
      let start = 1
      let first = true
      while (i < lines.length) {
        const om = RE_OL.exec(lines[i])
        if (!om) break
        if (first) {
          start = Number(om[1]) || 1
          first = false
        }
        items.push(el('listitem', { value: items.length + 1, children: parseInline(om[2]) }))
        i++
      }
      children.push(el('list', { tag: 'ol', listType: 'number', start, children: items }))
      continue
    }

    // 普通文本行 → 累积进段落。
    para.push(line)
    i++
  }
  flushPara()

  return {
    root: el('root', { children }),
  } as unknown as SerializedEditorState
}
