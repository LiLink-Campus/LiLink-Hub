// studio/_lib/auth.ts —— 工作台服务端鉴权助手。
//
// 复用预览页（preview/channel-contents/[id]/page.tsx）的写法：用 Payload Local API 的
// payload.auth({ headers }) 读当前会话 cookie。仅在服务端（Server Component / Server Action）使用。
//
// 两个入口：
// - getCurrentUser()：返回当前登录用户或 null（页面想做「未登录显示登录引导」时用）。
// - requireUser()：无登录直接 redirect('/login')（页面/动作要求必须登录时用）。

import { headers as nextHeaders } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'

/** 当前登录用户的宽松形状（按运行时实际字段读取，不强依赖生成类型）。 */
export type StudioUser = {
  id: string | number
  email?: string | null
  name?: string | null
  role?: string | null
  [key: string]: unknown
}

/**
 * 读取当前登录运营。未登录返回 null（不跳转）。
 * 鉴权失败（cookie 失效 / 解析异常）一律按未登录处理，不抛错。
 */
export async function getCurrentUser(): Promise<StudioUser | null> {
  try {
    const payload = await getPayload({ config })
    const headers = await nextHeaders()
    const { user } = await payload.auth({ headers })
    return (user as StudioUser | null) ?? null
  } catch {
    return null
  }
}

/**
 * 要求必须登录：无登录用户时 redirect('/login')（不返回）。
 * 有登录用户则返回该用户。
 *
 * 注：redirect() 在 Next App Router 中通过抛出特殊错误中断渲染，
 * 故本函数在未登录时不会真正 return。
 */
export async function requireUser(): Promise<StudioUser> {
  const user = await getCurrentUser()
  if (!user) {
    // middleware.ts 给 /studio/* 注入了 x-pathname（当前路径+query），用于登录后回到原页。
    // 拿不到（未匹配 middleware）则退化为不带 next，行为同以往。
    const path = (await nextHeaders()).get('x-pathname')
    const next = path && path.startsWith('/studio') ? `?next=${encodeURIComponent(path)}` : ''
    redirect(`/login${next}`)
  }
  return user
}
