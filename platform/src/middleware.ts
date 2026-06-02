// src/middleware.ts —— 仅给 /studio/* 的请求注入 x-pathname 请求头。
//
// 缘由：Next App Router 的 Server Component（如 studio/_lib/auth.ts 的 requireUser）默认
// 拿不到「当前请求路径」（已实测 headers 无任何 path 字段）。要在未登录被拦截时
// redirect('/login?next=原路径')、登录后回到原页，需要把 pathname 通过请求头传进去。
//
// 【只做这一件事】不在此做任何鉴权 / 重定向 —— 鉴权仍由 studio/layout 的 requireUser 负责。
// 这是 App Router 下「让 server 拿到 pathname」的标准做法，不构成新的全局鉴权层。

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers)
  headers.set('x-pathname', req.nextUrl.pathname + req.nextUrl.search)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  // 只在工作台受保护区注入；其它路径无需。
  matcher: ['/studio/:path*'],
}
