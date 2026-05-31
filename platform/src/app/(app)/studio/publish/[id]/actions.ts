'use server'

// studio/publish/[id]/actions.ts —— 发布配置页「预览刷新」专用服务端动作（co-located）。
//
// 为什么单独放这里、而不进 _lib/actions.ts：
//   - 这两个动作只服务「发布配置页」自己的右侧预览（公众号手机预览 / 人工发布包预览），
//     不是跨页共享契约；放在功能页目录内更内聚，也避免把渲染器/发布包构建器的重依赖
//     （@payloadcms/richtext-lexical/html、platforms/registry）牵进共享 _lib。
//   - 客户端子组件保存字段后调它们重算预览（首屏预览由 page.tsx 服务端直出，无需往返）。
//
// 复用而非重造：
//   - 取数走 _lib/actions.ts 的 getContent(id)（depth:2，鉴权 + media.url 已 populate）。
//   - 公众号预览用 renderers/lexical-to-wechat.ts 的 renderToInlineHtml（与发布/预览页同一份产物）。
//   - 人工发布包用 renderers/social-package.ts 的 buildSocialPackage（与发布端点同一构建逻辑）。

import { renderToInlineHtml } from '@/renderers/lexical-to-wechat'
import { buildSocialPackage, type SocialPublishPackage } from '@/renderers/social-package'

import { getContent } from '../../_lib/actions'

// renderConfig 的宽松形状（与 ChannelContents.renderConfig group 字段一致）。
interface RenderConfigShape {
  ctaUrl?: string | null
  ctaText?: string | null
  noCta?: boolean | null
}

// 把渠道稿的 renderConfig 归一成 renderToInlineHtml 的 opts。
// 空串 / null 一律视为「未设置」，交由渲染器用默认 CTA（与预览页 toRenderOpts 一致）。
function toRenderOpts(rc: RenderConfigShape | null | undefined) {
  return {
    ctaUrl: rc?.ctaUrl || undefined,
    ctaText: rc?.ctaText || undefined,
    noCta: rc?.noCta ?? undefined,
  }
}

/** 公众号预览结果（供客户端塞进手机框 dangerouslySetInnerHTML）。 */
export interface WechatPreviewResult {
  html: string
  title: string
}

/**
 * 重新渲染公众号手机预览：取最新文档 → body(Lexical) → 「与发布完全相同」的全内联 HTML。
 * 出错时返回空 HTML + 友好标题，调用方按需提示（不抛，避免预览区整块崩）。
 */
export async function refreshWechatPreview(id: string): Promise<WechatPreviewResult> {
  try {
    const doc = await getContent(id)
    const body = doc.body as Parameters<typeof renderToInlineHtml>[0]
    const renderConfig = doc.renderConfig as RenderConfigShape | undefined
    const html = renderToInlineHtml(body, toRenderOpts(renderConfig))
    const title = (typeof doc.wxTitle === 'string' && doc.wxTitle.trim()) || '未命名草稿'
    return { html, title }
  } catch {
    return { html: '', title: '未命名草稿' }
  }
}

/** 人工发布包预览结果（成功给 package，失败给中文 error 文案）。 */
export type SocialPackageResult =
  | { ok: true; package: SocialPublishPackage }
  | { ok: false; error: string }

/**
 * 重新构建人工发布包预览（图文 / 视频）：取最新文档 → buildSocialPackage。
 * buildSocialPackage 在平台非人工平台时会抛错，这里捕获成 { ok:false } 友好返回。
 */
export async function refreshSocialPackage(id: string): Promise<SocialPackageResult> {
  try {
    const doc = await getContent(id)
    const pkg = buildSocialPackage(doc)
    return { ok: true, package: pkg }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}
