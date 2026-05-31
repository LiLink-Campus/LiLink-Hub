'use server'

// preview-action.ts —— 长文创作页右侧「手机实时预览」的服务端渲染动作。
//
// 为什么不在客户端直接渲染：renderToInlineHtml 依赖 @payloadcms/richtext-lexical/html
// （服务端转换层），且需要 body 里 upload 图片节点被 populate 成 media 文档（含 url）才能出图。
// 编辑器 onChange 存进 body 的 upload 节点 value 只是 mediaId（未 populate），故这里统一
// **按 id 重新读库（getContent，depth:2 已 populate）再渲染**——保证图片、封面 CTA 配置都到位，
// 与发布/预览页产出的「同一份」全内联 HTML 完全一致（预览=最终）。
//
// 鉴权：复用 getContent（其内部 payload.auth 校验登录 + 访问控制），无权/未登录会抛错。

import { renderToInlineHtml } from '@/renderers/lexical-to-wechat'
import { getContent } from '../../../_lib/actions'

// renderConfig 宽松形状（与 ChannelContents.renderConfig group 字段一致）。
interface RenderConfigShape {
  ctaUrl?: string | null
  ctaText?: string | null
  noCta?: boolean | null
}

function toRenderOpts(rc: RenderConfigShape | null | undefined) {
  return {
    ctaUrl: rc?.ctaUrl || undefined,
    ctaText: rc?.ctaText || undefined,
    noCta: rc?.noCta ?? undefined,
  }
}

/**
 * 取本条渠道稿最新 body（depth:2 已 populate 图片）并渲染成公众号全内联 HTML。
 * 供创作页在保存后调用以刷新右侧手机预览。出错时抛中文错误（前端可展示/降级）。
 *
 * @returns 与发布/预览完全相同的那份内联 HTML 字符串。
 */
export async function renderPreview(id: string): Promise<string> {
  const doc = await getContent(id)
  const body = doc.body as Parameters<typeof renderToInlineHtml>[0]
  const renderConfig = doc.renderConfig as RenderConfigShape | undefined
  return renderToInlineHtml(body, toRenderOpts(renderConfig))
}
