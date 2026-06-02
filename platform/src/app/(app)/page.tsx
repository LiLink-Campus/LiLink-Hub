import { redirect } from 'next/navigation'

import { getCurrentUser } from './studio/_lib/auth'

// 落地页（/）—— 只负责把人「正确分流」，不再是终点页。
//
// 背景：原落地页唯一的按钮指向 Payload 原生 /admin，把零基础运营送进了设计上明确
// 「运营永不接触」的开发者后台（见 docs/superpowers/specs/2026-06-03-studio-ux-onboarding-design.md
// 的 P0）。现改为最薄的服务端分流：已登录直达 /studio，未登录去 /login——复用 studio
// 既有鉴权闭环（studio/layout.tsx requireUser、login 成功跳 /studio）。
// /admin 不再出现在任何运营可见入口（管理员自行记 /admin 路径即可）。
//
// 【硬约束】本页在 (app) 路由组内，<html>/<body> 由 (app)/layout.tsx 提供——这里只做
// 服务端 redirect、不渲染任何外壳或内容（redirect 通过抛特殊错误中断渲染，故无返回）。
export default async function HomePage() {
  const user = await getCurrentUser()
  redirect(user ? '/studio' : '/login')
}
