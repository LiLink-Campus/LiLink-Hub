'use client'

// studio/WelcomeGuide.tsx —— 工作台首屏「一次性新手引导卡」（P1 · 首次欢迎引导）。
//
// 背景见 docs/superpowers/specs/2026-06-03-studio-ux-onboarding-design.md：
// 新人登录后第一眼缺「这工具干嘛、一条内容从写到发要走哪几步」的总览。这里放一张
// 可关闭、记 localStorage 的「① 创作 ② 发布 ③ 审核」流程总览卡，关掉后不再出现。
//
// 为什么 client：要读写 localStorage 记住「已关闭」、并支持点 ✕ 即时收起——天然客户端行为。
// 放在 studio/page.tsx（Server Component）里照常渲染（client 组件可在 RSC 树内渲染）。
//
// 首帧不渲染（dismissed 初始为 null），useEffect 读到「未关闭」(false) 才显示——避免
// SSR 与 client 的 localStorage 取值不一致导致 hydration 闪烁/报错（与本仓「副作用放 useEffect」一致）。

import { useEffect, useState } from 'react'

import { colors, fonts, radii, space, shadow } from './_lib/theme'

const STORAGE_KEY = 'lilink_studio_welcome_dismissed'

const STEPS = [
  { n: '1', title: '创作', desc: '只管写好内容' },
  { n: '2', title: '发布', desc: '选平台、补信息' },
  { n: '3', title: '审核', desc: '通过后一键发出' },
]

export function WelcomeGuide() {
  // null = 首帧未确定（SSR & 首次 client 渲染都不显示，避免 hydration 不一致）；
  // false = 读到「未关闭」→ 显示；true = 已关闭 → 不显示。
  const [dismissed, setDismissed] = useState<boolean | null>(null)

  useEffect(() => {
    setDismissed(localStorage.getItem(STORAGE_KEY) === '1')
  }, [])

  if (dismissed !== false) return null

  function close() {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // localStorage 不可用（隐私模式等）时静默：本次仍收起，仅不持久化。
    }
    setDismissed(true)
  }

  return (
    <section
      aria-label="新手引导"
      style={{
        position: 'relative',
        background: colors.fill,
        border: `1px solid ${colors.rule}`,
        borderRadius: radii.lg,
        boxShadow: shadow.card,
        padding: space.lg,
        marginBottom: space.lg,
        fontFamily: fonts.sans,
      }}
    >
      <button
        type="button"
        onClick={close}
        aria-label="知道了，关闭引导"
        style={{
          position: 'absolute',
          top: space.sm,
          right: space.sm,
          border: 'none',
          background: 'transparent',
          color: colors.muted,
          fontSize: 13,
          cursor: 'pointer',
          padding: '4px 8px',
          borderRadius: radii.pill,
          fontFamily: fonts.sans,
        }}
      >
        知道了 ✕
      </button>

      <h2
        style={{
          margin: `0 0 ${space.md}`,
          fontFamily: fonts.serif,
          fontSize: 18,
          fontWeight: 700,
          color: colors.inkStrong,
          lineHeight: 1.4,
          paddingRight: 72,
        }}
      >
        第一次来？三步就能发出第一篇内容
      </h2>

      <div style={{ display: 'flex', gap: space.md, flexWrap: 'wrap' }}>
        {STEPS.map((s) => (
          <div
            key={s.n}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space.sm,
              flex: '1 1 180px',
              minWidth: 0,
            }}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                flexShrink: 0,
                borderRadius: radii.pill,
                background: colors.rose,
                color: colors.onRose,
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {s.n}
            </span>
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 15,
                  fontWeight: 700,
                  color: colors.inkStrong,
                  lineHeight: 1.4,
                }}
              >
                {s.title}
              </span>
              <span style={{ display: 'block', fontSize: 13, color: colors.muted, lineHeight: 1.5 }}>
                {s.desc}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
