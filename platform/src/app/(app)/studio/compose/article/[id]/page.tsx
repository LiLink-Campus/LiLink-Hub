// compose/article/[id]/page.tsx —— 长文创作页（Server Component, App Router）。
//
// 设计依据：运营内容工作台「创作 ▸ 发布 ▸ 审核」第一步。取草稿 → 标题输入 + 所见即所得
// 编辑器 + 右侧手机实时预览（与发布完全相同的全内联 HTML）→「下一步：发布」跳 /studio/publish/[id]。
//
// 实现要点：
//   - getContent(id) 取完整渠道稿（depth:2，body 内图片已 populate，预览才出图）。
//   - 首屏先用 renderToInlineHtml 渲染一份初始预览 HTML 传给客户端，避免首屏空白；
//     之后的实时刷新由 ComposeClient 调 renderPreview 服务端动作完成（保存=最新一份）。
//   - 鉴权由 getContent 内部 payload.auth 负责（未登录/无权抛错）；这里 try/catch 给友好错误页。
//
// 【硬约束】本页在 (app) 路由组内，<html>/<body> 已由 (app)/layout.tsx 提供，且外层
// studio/layout.tsx 还套了顶栏与居中容器——这里【绝不】再渲染 <html>/<body>，只返回内容。
//
// Next 16：params 是 Promise，必须 await（见 next docs dynamic-routes）。

import Link from 'next/link'

import { getContent } from '../../../_lib/actions'
import { colors, fonts, radii, space } from '../../../_lib/theme'
import { Button, Card, StepHeader } from '../../../_ui'
import { ComposeClient } from './ComposeClient'

export const dynamic = 'force-dynamic'

// 从已 populate 的 body(Lexical) 抽出 媒体 id → 直链 url，供编辑器加载时内联显示已插入图片。
function extractImageUrlMap(body: unknown): Record<string, string> {
  const map: Record<string, string> = {}
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const n = node as Record<string, unknown>
    if (n.type === 'upload') {
      const v = n.value as { id?: unknown; url?: unknown } | undefined
      if (v && (typeof v.id === 'string' || typeof v.id === 'number') && typeof v.url === 'string') {
        map[String(v.id)] = v.url
      }
    }
    if (Array.isArray(n.children)) n.children.forEach(walk)
    if (n.root) walk(n.root)
  }
  walk(body)
  return map
}

export default async function ArticleComposePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // 取草稿。失败（未登录/无权/不存在）→ 友好错误页（绝不渲染 <html>/<body>）。
  let doc: Record<string, unknown>
  try {
    doc = await getContent(id)
  } catch (err) {
    const message = err instanceof Error ? err.message : '读取草稿失败。'
    return (
      <div>
        <StepHeader current="create" />
        <Card>
          <h1
            style={{
              margin: `0 0 ${space.sm}`,
              fontSize: 20,
              fontFamily: fonts.serif,
              color: colors.inkStrong,
            }}
          >
            打不开这篇草稿
          </h1>
          <p style={{ margin: `0 0 ${space.lg}`, color: colors.muted, lineHeight: 1.7 }}>
            {message}
          </p>
          <Link href="/studio" style={{ textDecoration: 'none' }}>
            <Button variant="ghost">返回工作台</Button>
          </Link>
        </Card>
      </div>
    )
  }

  const initialTitle = typeof doc.wxTitle === 'string' ? doc.wxTitle : ''
  // markdown 源是编辑真源；body 由它派生、供发布/预览渲染。
  const initialMarkdown = typeof doc.bodyMarkdown === 'string' ? doc.bodyMarkdown : ''
  const imageUrlMap = extractImageUrlMap(doc.body)

  return (
    <div>
      <StepHeader current="create" />

      {/* 页头：标题 + 去发布 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: space.md,
          marginBottom: space.lg,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 24,
              fontWeight: 700,
              fontFamily: fonts.serif,
              color: colors.inkStrong,
              lineHeight: 1.3,
            }}
          >
            写公众号长文
          </h1>
          <p
            style={{
              margin: `${space.xs} 0 0`,
              fontSize: 14,
              color: colors.muted,
              fontFamily: fonts.sans,
              lineHeight: 1.6,
            }}
          >
            左边写、右边看；改动会自动保存。写好后点「下一步：发布」。
          </p>
        </div>

        <Link
          href={`/studio/publish/${encodeURIComponent(id)}`}
          style={{ textDecoration: 'none', flexShrink: 0 }}
        >
          <Button>下一步：发布 →</Button>
        </Link>
      </div>

      {/* 创作主区（客户端交互岛：标题 + 编辑器 + 实时预览） */}
      <ComposeClient
        contentId={id}
        initialTitle={initialTitle}
        initialMarkdown={initialMarkdown}
        imageUrlMap={imageUrlMap}
      />

      {/* 底部再放一个「下一步」，移动端长内容滚到底也能直接走下一步 */}
      <div style={{ marginTop: space.xl, textAlign: 'center' }}>
        <Link
          href={`/studio/publish/${encodeURIComponent(id)}`}
          style={{ textDecoration: 'none', display: 'inline-block' }}
        >
          <Button>下一步：发布 →</Button>
        </Link>
        <div style={{ marginTop: space.sm }}>
          <Link
            href="/studio"
            style={{
              fontSize: 13.5,
              color: colors.muted,
              textDecoration: 'none',
              fontFamily: fonts.sans,
              borderRadius: radii.sm,
            }}
          >
            ← 返回工作台
          </Link>
        </div>
      </div>
    </div>
  )
}
