// studio/publish/[id]/page.tsx —— 发布配置页（Server Component）。
//
// 设计依据 §3 路由「/studio/publish/[id]：选平台 + 填 meta + 预览 →「提交审核」」、
// §7「发布步骤（平台与 meta 分离 + 长文扩展位）」、§13 里程碑 4/6。
//
// 本页职责（服务端）：
//   1) await params 取 id；getContent(id) 取完整文档（depth:2，含 media.url、post 等）。
//   2) 由 platform + contentMode 反推内容形态 form（platformToForm）。
//   3) 抽出该形态需要的初始 meta（公众号：作者/摘要/封面/原文/CTA；图文视频：标题/描述/话题/素材/形态）。
//   4) 直出首屏预览：
//        - 公众号 → renderToInlineHtml(body) 得「与发布完全相同」的全内联 HTML。
//        - 图文/视频 → buildSocialPackage(doc) 得发布包（标题/正文/话题/素材清单/告警）。
//      （交互态的「保存后刷新预览」由 ./actions.ts 的 server action 承担，避免首屏多一次往返。）
//   5) 把以上初始值 + 预览交给 'use client' 子组件 PublishEditor 接管表单与提交。
//
// 【硬约束】本页在 (app) 路由组内、studio/layout 外壳内 —— 绝不再渲染 <html>/<body> 或顶栏。
// 复用：渲染走 renderers/lexical-to-wechat.ts；发布包走 renderers/social-package.ts；
//       取数 / 鉴权走 _lib/actions.ts 的 getContent（其内部 requireUser 等价校验）。

import { renderToInlineHtml } from '@/renderers/lexical-to-wechat'
import { buildSocialPackage, type SocialPublishPackage } from '@/renderers/social-package'

import { getContent } from '../../_lib/actions'
import { platformToForm } from '../../_lib/platforms'
import type { ContentForm, StudioStatus } from '../../_lib/types'

import { PublishEditor } from './PublishEditor'
import type { MediaRef, InitialPublishData } from './PublishEditor'

// 读会话 cookie + 取文档，必须每次动态渲染。
export const dynamic = 'force-dynamic'

// ---------- 从渠道稿文档安全抽值的小助手（运行时形状，不强依赖生成类型） ----------

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** media 关系字段（depth:2 时为完整 media 文档）→ 轻量 { id, url, alt } 引用。 */
function toMediaRef(v: unknown): MediaRef | null {
  if (!v) return null
  if (typeof v === 'string' || typeof v === 'number') {
    return { id: String(v), url: '', alt: '' }
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o.id === undefined || o.id === null) return null
    return {
      id: String(o.id),
      url: str(o.url),
      alt: str(o.alt) || str(o.filename),
    }
  }
  return null
}

/** hasMany media 关系 → MediaRef[]（保序，过滤空）。 */
function toMediaRefs(v: unknown): MediaRef[] {
  if (!Array.isArray(v)) {
    const one = toMediaRef(v)
    return one ? [one] : []
  }
  return v.map(toMediaRef).filter((m): m is MediaRef => Boolean(m))
}

/** socialTags array 字段（[{ tag }] 或 [string]）→ 纯字符串数组。 */
function toTags(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object') {
        const t = (item as Record<string, unknown>).tag
        return typeof t === 'string' ? t.trim() : ''
      }
      return ''
    })
    .filter(Boolean)
}

export default async function PublishConfigPage({
  params,
}: {
  // Next 16：params 是 Promise，必须 await（见 next docs file-conventions/dynamic-routes）。
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // getContent 内部要求登录（未登录抛错；本页在已 requireUser 的 studio 外壳内，正常已登录）。
  // 取不到 / 无权时 getContent 抛中文错误——交给 Next 错误边界，避免在此吞掉。
  const doc = await getContent(id)

  const platform = str(doc.platform) || 'wechat'
  const contentMode = str(doc.contentMode) || null
  const status = (str(doc.status) || 'draft') as StudioStatus
  const form: ContentForm = platformToForm(platform, contentMode)

  // 公共：选题名（标题兜底展示用）。
  const post = doc.post
  const postTitle =
    post && typeof post === 'object' ? str((post as Record<string, unknown>).title) : ''

  // 组装初始数据（按形态取对应字段；不相关字段留空即可，客户端按 form 只渲染需要的）。
  const renderConfig = (doc.renderConfig as Record<string, unknown> | undefined) ?? {}

  const initial: InitialPublishData = {
    id,
    form,
    status,
    platform,
    contentMode: contentMode ?? (form === 'video' ? 'video' : form === 'imagetext' ? 'image_note' : null),
    postTitle: postTitle || '未命名草稿',

    // 公众号 meta
    wxTitle: str(doc.wxTitle),
    wxAuthor: str(doc.wxAuthor),
    wxDigest: str(doc.wxDigest),
    sourceUrl: str(doc.sourceUrl),
    coverImage: toMediaRef(doc.coverImage),
    ctaUrl: str(renderConfig.ctaUrl),
    ctaText: str(renderConfig.ctaText),
    noCta: Boolean(renderConfig.noCta),

    // 图文 / 视频 meta
    socialTitle: str(doc.socialTitle),
    socialDescription: str(doc.socialDescription),
    socialTags: toTags(doc.socialTags),
    socialImages: toMediaRefs(doc.socialImages),
    videoFile: toMediaRef(doc.videoFile),
    horizontalCover: toMediaRef(doc.horizontalCover),
    verticalCover: toMediaRef(doc.verticalCover),
  }

  // 首屏预览（服务端直出）。
  let initialPreviewHtml = ''
  let initialPreviewTitle = initial.wxTitle || initial.postTitle
  let initialPackage: SocialPublishPackage | null = null
  let initialPackageError = ''

  if (form === 'article') {
    try {
      const body = doc.body as Parameters<typeof renderToInlineHtml>[0]
      initialPreviewHtml = renderToInlineHtml(body, {
        ctaUrl: str(renderConfig.ctaUrl) || undefined,
        ctaText: str(renderConfig.ctaText) || undefined,
        noCta: renderConfig.noCta ? true : undefined,
      })
    } catch {
      initialPreviewHtml = ''
    }
  } else {
    try {
      initialPackage = buildSocialPackage(doc)
      initialPreviewTitle = initialPackage.title
    } catch (err) {
      initialPackageError = err instanceof Error ? err.message : String(err)
    }
  }

  return (
    <PublishEditor
      initial={initial}
      initialPreviewHtml={initialPreviewHtml}
      initialPreviewTitle={initialPreviewTitle}
      initialPackage={initialPackage}
      initialPackageError={initialPackageError}
    />
  )
}
