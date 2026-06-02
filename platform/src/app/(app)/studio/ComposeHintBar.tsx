'use client'

// studio/ComposeHintBar.tsx —— 创作页一次性「定心」提示条（P2 · 流程自解释）。
//
// 告诉新人「这步只管写，平台/话题/封面留到发布步骤」，呼应 spec『正文与 meta 分两步』——
// 否则新人会在创作页到处找平台/封面/话题而焦虑。一次性、可关闭、记 localStorage
// （关一次后所有创作页都不再显示）。首帧不渲染，避免 SSR/client localStorage 不一致。

import { useEffect, useState } from 'react'

import { colors, fonts, radii, space } from './_lib/theme'

const KEY = 'lilink_compose_hint_dismissed'

export function ComposeHintBar() {
  const [dismissed, setDismissed] = useState<boolean | null>(null)

  useEffect(() => {
    setDismissed(localStorage.getItem(KEY) === '1')
  }, [])

  if (dismissed !== false) return null

  function close() {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* localStorage 不可用时静默 */
    }
    setDismissed(true)
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: space.sm,
        background: colors.fill,
        border: `1px solid ${colors.rule}`,
        borderRadius: radii.md,
        padding: `10px ${space.md}`,
        marginBottom: space.lg,
        fontFamily: fonts.sans,
        fontSize: 13.5,
        lineHeight: 1.6,
        color: colors.ink,
      }}
    >
      <span aria-hidden>💡</span>
      <span style={{ flex: 1 }}>
        这一步只管把内容写好；发到哪个平台、话题、封面，等写完点「下一步：发布」再设置。
      </span>
      <button
        type="button"
        onClick={close}
        aria-label="知道了，关闭提示"
        style={{
          border: 'none',
          background: 'transparent',
          color: colors.muted,
          fontSize: 12.5,
          cursor: 'pointer',
          padding: '0 4px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        知道了 ✕
      </button>
    </div>
  )
}
