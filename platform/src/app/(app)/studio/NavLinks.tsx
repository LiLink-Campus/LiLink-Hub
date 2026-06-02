'use client'

// studio/NavLinks.tsx —— 顶栏主导航（带「当前页高亮」）。P1 · 流程自解释。
//
// 背景见 docs/superpowers/specs/2026-06-03-studio-ux-onboarding-design.md：原顶栏「工作台 /
// 审核队列」两项颜色字重一致、无选中态，新人在创作/发布页无法判断「我在哪、点哪能回去」。
// 这里用 usePathname 给当前所在栏加淡玫瑰 pill + aria-current="page"。
//
// 为什么单独 client 组件：layout.tsx 是 Server Component，拿不到当前 pathname；把这一小块
// 抽成 'use client' 用 usePathname 即可，其余 layout 仍是 RSC。

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { colors, radii, space } from './_lib/theme'

const NAV = [
  { href: '/studio', label: '工作台' },
  { href: '/studio/review', label: '审核队列' },
]

export function NavLinks() {
  const pathname = usePathname()

  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: space.sm }} aria-label="主导航">
      {NAV.map((item) => {
        // 工作台用精确匹配（否则所有 /studio/* 都会高亮「工作台」）；审核队列含其子路径。
        const active =
          item.href === '/studio'
            ? pathname === '/studio'
            : pathname === item.href || pathname.startsWith(item.href + '/')
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            style={{
              fontSize: 15,
              fontWeight: active ? 700 : 500,
              color: active ? colors.rose : colors.ink,
              background: active ? colors.fill : 'transparent',
              textDecoration: 'none',
              padding: `6px ${space.sm}`,
              borderRadius: radii.sm,
              whiteSpace: 'nowrap',
            }}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
