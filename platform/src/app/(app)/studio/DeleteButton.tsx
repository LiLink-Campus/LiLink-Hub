'use client'

// studio/DeleteButton.tsx —— 工作台内容卡上的「删除」按钮（客户端）。
//
// 为什么单独成组件：删除要 confirm 二次确认 + 调 server action + 删后刷新列表，是客户端交互；
// 且它嵌在工作台卡片（外层是跳转 Link）里，必须 stopPropagation/preventDefault，避免点删除
// 误触发卡片跳转。删后用 router.refresh()（单独 refresh、不跟 push，安全）重拉动态列表。

import { useState, useTransition, type MouseEvent } from 'react'
import { useRouter } from 'next/navigation'

import { deleteContent } from './_lib/actions'
import { colors, fonts, radii } from './_lib/theme'

export function DeleteButton({ id, title }: { id: string; title: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [hover, setHover] = useState(false)
  const [error, setError] = useState('')

  function onDelete(e: MouseEvent) {
    // 关键：阻断冒泡/默认，避免触发外层卡片的跳转 Link。
    e.preventDefault()
    e.stopPropagation()
    if (pending) return
    if (!window.confirm(`确定删除「${title || '未命名草稿'}」？删除后无法恢复。`)) return
    setError('')
    start(async () => {
      try {
        await deleteContent(id)
        router.refresh() // 工作台是动态页，单独 refresh 即可重拉列表（勿跟 push，避免导航打断）
      } catch (err) {
        setError(err instanceof Error ? err.message : '删除失败，请稍后再试。')
      }
    })
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label="删除"
        title="删除"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          appearance: 'none',
          cursor: pending ? 'default' : 'pointer',
          fontFamily: fonts.sans,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: 1.4,
          color: hover && !pending ? colors.onRose : colors.muted,
          background: hover && !pending ? colors.rose : 'transparent',
          border: `1px solid ${hover && !pending ? colors.rose : colors.rule}`,
          borderRadius: radii.pill,
          padding: '4px 12px',
          whiteSpace: 'nowrap',
          opacity: pending ? 0.6 : 1,
          transition: 'background .15s ease, color .15s ease, border-color .15s ease',
        }}
      >
        {pending ? '删除中…' : '删除'}
      </button>
      {error ? (
        <span role="alert" style={{ fontSize: 12, color: colors.rose, maxWidth: 160, textAlign: 'right' }}>
          {error}
        </span>
      ) : null}
    </span>
  )
}
