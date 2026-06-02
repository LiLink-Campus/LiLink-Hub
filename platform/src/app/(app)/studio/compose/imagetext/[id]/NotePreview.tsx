'use client'

// studio/compose/imagetext/[id]/NotePreview.tsx —— 小红书式手机卡片实时预览（纯展示）。
//
// 职责单一：把 { 标题, 正文, 图组 } 渲染成贴合小红书后台的竖向手机卡片，供编辑器右侧
// 「所见即所得」。无任何加载 / 保存 / 交互逻辑——数据全由父容器（NoteEditor）传入。
//
// 视觉规则（对齐 spec §4「预览」）：
//   - 首图大图（images[0]，小红书竖图 3:4），无图给占位；多图时右下角 `1/N` 张数角标。
//   - 标题粗体（深墨）。
//   - 正文按 \n 分段（空行=段间距），保留换行；行内 #话题 用正则染成小红书蓝。
//
// 样式：内联 style + studio/_lib/theme 令牌（按任务约定不新建 css module，参考 video/[id]/page 风格）。
// 话题蓝取小红书正文链接蓝（#1d72b8），与中台玫瑰主色区分，贴近小红书观感。
//
// 【硬约束】本组件在 (app) 路由组内，绝不渲染 <html>/<body>，只返回内容容器。

import { type CSSProperties, type ReactNode } from 'react'

import { colors, fonts, radii, space, shadow } from '../../../_lib/theme'

// ============================================================
// 接口契约（锁定，与 plan 一致）
// ============================================================

export interface NotePreviewProps {
  title: string
  body: string
  images: { id: string; url: string }[]
}

// 小红书正文话题蓝（与中台玫瑰主色区分，贴近小红书后台观感）。
const TOPIC_BLUE = '#1d72b8'

// 行内 #话题 边界：到空白 / 另一个 # / 常见中英文标点为止（与 lib/topics 的解析口径一致）。
// 带捕获组，配合 String.split 既切分又保留 #话题 片段。
const TOPIC_SPLIT_RE = /(#[^\s#,，。、!！?？;；:：~（）()【】"'\n\r\t]+)/

// ============================================================
// 组件
// ============================================================

export function NotePreview({ title, body, images }: NotePreviewProps) {
  const cover = images[0]
  const totalCount = images.length

  return (
    <div style={cardStyle} aria-label="小红书预览卡片">
      {/* 顶部图组：首图大图 + 多图张数角标 */}
      <div style={coverWrapStyle}>
        {cover && cover.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.url} alt="封面预览" style={coverImgStyle} />
        ) : (
          <div style={coverPlaceholderStyle}>
            <span style={{ fontSize: 30, lineHeight: 1 }}>🖼️</span>
            <span style={{ fontSize: 13, color: colors.muted }}>还没有配图</span>
          </div>
        )}

        {totalCount > 1 ? (
          <span style={countBadgeStyle} aria-label={`共 ${totalCount} 张图片`}>
            1/{totalCount}
          </span>
        ) : null}
      </div>

      {/* 文字区：标题 + 正文 */}
      <div style={textWrapStyle}>
        <div style={titleStyle}>{title.trim() ? title : <span style={mutedHintStyle}>未填写标题</span>}</div>

        <div style={bodyStyle}>
          {body.trim() ? (
            renderBody(body)
          ) : (
            <span style={mutedHintStyle}>正文会显示在这里，#话题 会自动变蓝～</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 正文渲染：按 \n 分段，行内 #话题 染蓝（保留换行）
// ============================================================

/** 把整段正文渲染成「段落数组」，空行成为段间距，#话题片段染成小红书蓝。 */
function renderBody(text: string): ReactNode {
  // 按换行切段；保留空段以体现空行（段间距）。
  const lines = text.split('\n')
  return lines.map((line, i) => (
    <p key={i} style={paragraphStyle}>
      {line === '' ? ' ' /* 空行占位，撑出段间距 */ : highlightTopics(line)}
    </p>
  ))
}

/** 单行内把 #话题 包成蓝色 span，其余按纯文本输出。 */
function highlightTopics(line: string): ReactNode {
  // split 带捕获组 → 结果交替出现「普通文本」「#话题」「普通文本」…
  const parts = line.split(TOPIC_SPLIT_RE)
  return parts.map((part, i) => {
    if (part === '') return null
    if (part.startsWith('#')) {
      return (
        <span key={i} style={topicStyle}>
          {part}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

// ============================================================
// 样式（内联 CSSProperties，复用主题令牌）
// ============================================================

// 手机卡片外框：窄列、白底、圆角、柔和投影——模拟小红书笔记卡片。
const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 340,
  margin: '0 auto',
  background: colors.surface,
  borderRadius: radii.lg,
  border: `1px solid ${colors.rule}`,
  boxShadow: shadow.card,
  overflow: 'hidden',
  fontFamily: fonts.sans,
}

// 封面区：小红书竖图 3:4。
const coverWrapStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  aspectRatio: '3 / 4',
  background: colors.fill,
}

const coverImgStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
}

const coverPlaceholderStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: space.xs,
}

// 多图张数角标（右下角）。
const countBadgeStyle: CSSProperties = {
  position: 'absolute',
  right: 10,
  bottom: 10,
  padding: '2px 10px',
  borderRadius: radii.pill,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.5,
  color: '#ffffff',
  background: 'rgba(52,45,43,0.55)',
}

const textWrapStyle: CSSProperties = {
  padding: space.md,
}

// 标题：粗体深墨。
const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 700,
  lineHeight: 1.5,
  color: colors.inkStrong,
  wordBreak: 'break-word',
}

// 正文容器：暖灰、舒适行距。
const bodyStyle: CSSProperties = {
  marginTop: space.sm,
  fontSize: 14,
  lineHeight: 1.75,
  color: colors.ink,
}

// 单段：去默认 margin，靠 \n 分段控制；保留连续空格/换行观感。
const paragraphStyle: CSSProperties = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

// #话题：小红书蓝。
const topicStyle: CSSProperties = {
  color: TOPIC_BLUE,
}

// 占位提示（标题/正文为空时）。
const mutedHintStyle: CSSProperties = {
  color: colors.muted,
  fontWeight: 400,
}
