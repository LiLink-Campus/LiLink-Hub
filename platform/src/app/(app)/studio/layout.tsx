// studio/layout.tsx —— 运营内容工作台外壳（Server Component）。
//
// 设计依据 §3「信息架构」/ §11「视觉」：
//   - 顶栏：LiLink 文字标 + 主导航（工作台 /studio · 审核队列 /studio/review）
//     + 右侧当前用户名 + 退出登录。
//   - 微光玫瑰淡背景，正文居中容器装 children（移动优先，留白克制）。
//   - 开头 requireUser()：未登录直接 redirect('/login')，整个工作台都要登录。
//
// 【硬约束】本 layout 在 (app) 路由组内，<html>/<body> 已由 (app)/layout.tsx 提供——
// 这里【绝不】再渲染 <html>/<body>（否则嵌套 <html> 触发 hydration 错乱、样式退化）。
//
// 退出登录用「内联 Server Action + <form>」实现，无需引入额外 client 组件文件：
//   1) 同源 POST /api/users/logout（转发会话 cookie，照 actions.ts 的 host/cookie 取法）；
//   2) 再显式删除本地 payload-token cookie（server action 里 endpoint 响应的 Set-Cookie
//      不会自动落到浏览器，必须主动清，否则会话不会真正失效）；
//   3) redirect('/login')。

import type { ReactNode } from 'react'
import Link from 'next/link'
import { headers as nextHeaders, cookies as nextCookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { requireUser } from './_lib/auth'
import { colors, fonts, radii, space, shadow } from './_lib/theme'

export const dynamic = 'force-dynamic'

// Payload 默认 auth cookie 名（cookiePrefix 默认 'payload'，未在 config 覆盖）。
const AUTH_COOKIE = 'payload-token'

// 退出登录（内联 Server Action）。
async function logout() {
  'use server'

  const h = await nextHeaders()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const cookieStore = await nextCookies()

  // 1) 同源 POST 登出端点（转发 cookie）。失败不阻断——下一步会强制清本地 cookie。
  if (host) {
    const forwardedProto = h.get('x-forwarded-proto')
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
    const proto = forwardedProto ?? (isLocal ? 'http' : 'https')
    const cookieHeader = cookieStore.toString()
    try {
      await fetch(`${proto}://${host}/api/users/logout`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
        },
        body: '{}',
        cache: 'no-store',
      })
    } catch {
      // 网络/端点异常忽略：仍以本地清 cookie 为准。
    }
  }

  // 2) 主动清浏览器侧会话 cookie（关键：endpoint 响应的 Set-Cookie 不会自动应用到浏览器）。
  try {
    cookieStore.delete(AUTH_COOKIE)
  } catch {
    // 某些运行时 cookies().delete 需以对象形态调用，兜底再试一次。
    try {
      cookieStore.set(AUTH_COOKIE, '', { maxAge: 0, path: '/' })
    } catch {
      /* 忽略 */
    }
  }

  // 3) 回登录页。
  redirect('/login')
}

export default async function StudioLayout({ children }: { children: ReactNode }) {
  // 整个工作台都要求登录；未登录在此统一跳 /login（不返回）。
  const user = await requireUser()

  const displayName =
    (typeof user.name === 'string' && user.name.trim()) ||
    (typeof user.email === 'string' && user.email.trim()) ||
    '运营'

  return (
    <div
      style={{
        minHeight: '100vh',
        background: colors.page,
        color: colors.ink,
        fontFamily: fonts.sans,
      }}
    >
      {/* ===== 顶栏 ===== */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'rgba(255,250,249,0.9)',
          borderBottom: `1px solid ${colors.rule}`,
          boxShadow: shadow.card,
          backdropFilter: 'saturate(180%) blur(8px)',
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            margin: '0 auto',
            padding: `0 ${space.md}`,
            minHeight: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space.md,
            flexWrap: 'wrap',
          }}
        >
          {/* 左：文字标 + 主导航 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: space.lg, flexWrap: 'wrap' }}>
            <Link
              href="/studio"
              style={{
                fontFamily: fonts.serif,
                fontSize: 20,
                fontWeight: 700,
                color: colors.rose,
                textDecoration: 'none',
                letterSpacing: '.02em',
                whiteSpace: 'nowrap',
              }}
            >
              LiLink
            </Link>
            <nav style={{ display: 'flex', alignItems: 'center', gap: space.sm }} aria-label="主导航">
              <Link
                href="/studio"
                style={{
                  fontSize: 15,
                  fontWeight: 500,
                  color: colors.ink,
                  textDecoration: 'none',
                  padding: `6px ${space.sm}`,
                  borderRadius: radii.sm,
                  whiteSpace: 'nowrap',
                }}
              >
                工作台
              </Link>
              <Link
                href="/studio/review"
                style={{
                  fontSize: 15,
                  fontWeight: 500,
                  color: colors.ink,
                  textDecoration: 'none',
                  padding: `6px ${space.sm}`,
                  borderRadius: radii.sm,
                  whiteSpace: 'nowrap',
                }}
              >
                审核队列
              </Link>
            </nav>
          </div>

          {/* 右：当前用户名 + 退出登录（form 触发内联 server action） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
            <span
              style={{
                fontSize: 14,
                color: colors.muted,
                maxWidth: 160,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={displayName}
            >
              {displayName}
            </span>
            <form action={logout} style={{ margin: 0 }}>
              <button
                type="submit"
                style={{
                  appearance: 'none',
                  cursor: 'pointer',
                  fontFamily: fonts.sans,
                  fontSize: 14,
                  fontWeight: 500,
                  color: colors.muted,
                  background: 'transparent',
                  border: `1px solid ${colors.rule}`,
                  borderRadius: radii.pill,
                  padding: '6px 14px',
                  lineHeight: 1.4,
                  whiteSpace: 'nowrap',
                }}
              >
                退出登录
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* ===== 居中正文容器 ===== */}
      <main
        style={{
          maxWidth: 960,
          margin: '0 auto',
          padding: `${space.lg} ${space.md} ${space.xl}`,
          boxSizing: 'border-box',
        }}
      >
        {children}
      </main>
    </div>
  )
}
