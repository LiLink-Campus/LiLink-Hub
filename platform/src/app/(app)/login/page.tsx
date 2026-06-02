'use client'

// (app)/login/page.tsx —— 运营内容工作台友好登录页。
//
// 设计依据 §3 路由「/login（未登录统一跳此；复用 payload 鉴权）」+ §11 视觉（微光玫瑰）。
//   - 邮箱 + 密码 → POST /api/users/login（Payload 内置 auth 登录，slug=users）。
//   - credentials:'include' 让浏览器接收并保存 payload-token 会话 cookie。
//   - 成功 → 跳 /studio；失败 → 友好中文提示（解析 Payload 返回的 errors[].message）。
//
// 【硬约束】本页在 (app) 路由组内，<html>/<body> 已由 (app)/layout.tsx 提供——
// 这里【绝不】再渲染 <html>/<body>（否则嵌套 <html> 触发 hydration 错乱）。
// 用 router.push + router.refresh 跳转：refresh 让随后渲染的服务端组件（studio 外壳）
// 重新读到刚写入的会话 cookie。

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import { Button, Card, Field, TextInput } from '../studio/_ui'
import { colors, fonts, radii, space } from '../studio/_lib/theme'

export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setError('请填写邮箱和密码。')
      return
    }

    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include', // 关键：接收并保存会话 cookie
        body: JSON.stringify({ email: trimmedEmail, password }),
        cache: 'no-store',
      })

      if (!res.ok) {
        // Payload 失败返回 { errors: [{ message }] }；取第一条做友好提示。
        let msg = ''
        try {
          const data = (await res.json()) as { errors?: { message?: string }[] }
          msg = data?.errors?.[0]?.message ?? ''
        } catch {
          /* 非 JSON 错误体，落到默认文案 */
        }
        if (res.status === 401 || res.status === 400) {
          setError(msg || '邮箱或密码不正确，请重试。')
        } else {
          setError(msg || `登录失败（${res.status}），请稍后再试。`)
        }
        return
      }

      // 登录成功：会话 cookie 已写入。若带 ?next=（被拦截前的原页）则回跳原页，否则去工作台，
      // 再 refresh 让服务端组件读到新会话。next 仅允许站内「单斜杠」路径，防开放重定向（//evil.com）。
      const nextParam = new URLSearchParams(window.location.search).get('next')
      const safeNext =
        nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/studio'
      router.push(safeNext)
      router.refresh()
    } catch {
      setError('网络异常，登录失败，请检查网络后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: colors.page,
        color: colors.ink,
        fontFamily: fonts.sans,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: space.lg,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* 品牌区 */}
        <div style={{ textAlign: 'center', marginBottom: space.xl }}>
          <div
            style={{
              fontFamily: fonts.serif,
              fontSize: 32,
              fontWeight: 700,
              color: colors.rose,
              letterSpacing: '.02em',
              lineHeight: 1.2,
            }}
          >
            LiLink
          </div>
          <p style={{ margin: `${space.sm} 0 0`, fontSize: 14.5, color: colors.muted, lineHeight: 1.6 }}>
            运营内容工作台 · 创作 ▸ 发布 ▸ 审核，登录后只管写
          </p>
        </div>

        <Card padding="xl">
          <form onSubmit={handleSubmit} noValidate>
            <Field label="邮箱" hint="用你的运营账号邮箱登录">
              <TextInput
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                autoFocus
              />
            </Field>

            <Field label="密码">
              <TextInput
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </Field>

            {error ? (
              <div
                role="alert"
                style={{
                  marginBottom: space.md,
                  padding: `10px ${space.md}`,
                  background: colors.fill,
                  border: `1px solid ${colors.rose}`,
                  borderRadius: radii.md,
                  color: colors.rose,
                  fontSize: 14,
                  lineHeight: 1.6,
                }}
              >
                {error}
              </div>
            ) : null}

            <Button type="submit" block disabled={busy}>
              {busy ? '登录中…' : '登录'}
            </Button>
          </form>
        </Card>

        <p
          style={{
            textAlign: 'center',
            margin: `${space.lg} 0 0`,
            fontSize: 12.5,
            color: colors.muted,
            lineHeight: 1.7,
          }}
        >
          首次使用？账号由管理员统一开通——登录邮箱与初始密码请
          {process.env.NEXT_PUBLIC_ADMIN_CONTACT ? (
            <a
              href={process.env.NEXT_PUBLIC_ADMIN_CONTACT}
              style={{ color: colors.rose, textDecoration: 'none' }}
            >
              向管理员索取
            </a>
          ) : (
            '向管理员索取'
          )}
          。
        </p>
      </div>
    </div>
  )
}
