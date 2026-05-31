// BrowserPublishJob —— 浏览器自动化 worker 的输入契约。
//
// 由 renderers/social-package.ts 的 SocialPublishPackage 直接映射而来（纯函数、不重渲染内容），
// 让 worker 与「人工发布包」共用同一份内容真源。素材 url 仍是 OSS presigned 直链，
// worker 运行时再经 automation/assets.ts 下载为本地临时文件后 setInputFiles。

import { getPlatformSpec, type ManualPlatformCode, type PublishMode } from '../platforms/registry'
import type { SocialAssetRole, SocialPublishPackage } from '../renderers/social-package'

// worker 真正发布需要的素材（从 SocialAsset 收窄：只保留下载与上传需要的字段）。
export interface BrowserJobAsset {
  role: SocialAssetRole
  url?: string
  filename?: string
}

// 平台字数 / 标签上限（从 registry 带出，uploader 据此截断，避免平台侧静默丢弃）。
export interface BrowserJobLimits {
  titleMax: number
  bodyMax?: number
  tagsMax?: number
}

export interface BrowserPublishJob {
  platform: ManualPlatformCode
  mode: PublishMode
  publishUrl: string
  /** 正文描述（不含话题/链接），uploader 键盘输入到富文本编辑器。 */
  body: string
  /** 完整文案（正文+话题+链接），用于 fill-only/人工复制/兜底。 */
  caption: string
  title: string
  hashtags: string[]
  assets: BrowserJobAsset[]
  limits: BrowserJobLimits
  contentId?: string
}

export interface BuildBrowserJobOptions {
  contentId?: string
  /** 正文原文（export 路径从 channelContent.socialDescription 传入，最准）；缺省则从 caption 末尾兜底剥离。 */
  body?: string
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 缺 opts.body 时，从 caption 末尾剥离「话题行」与「LiLink 链接行」，兜底还原正文。
// 从末尾剥离而非按 \n\n 切片，避免误伤正文内部空行。
function deriveBody(caption: string, hashtags: string[]): string {
  let body = caption
  body = body.replace(/\n\nLiLink:[^\n]*\s*$/, '')
  const tagLine = hashtags.join(' ')
  if (tagLine) {
    body = body.replace(new RegExp('\\n\\n' + escapeRegExp(tagLine) + '\\s*$'), '')
  }
  return body.trim()
}

export function buildBrowserJob(
  pkg: SocialPublishPackage,
  opts: BuildBrowserJobOptions = {},
): BrowserPublishJob {
  const spec = getPlatformSpec(pkg.platform)
  const limits: BrowserJobLimits = {
    titleMax: spec.limits.titleMax,
    ...(spec.limits.bodyMax !== undefined ? { bodyMax: spec.limits.bodyMax } : {}),
    ...(spec.limits.tagsMax !== undefined ? { tagsMax: spec.limits.tagsMax } : {}),
  }
  return {
    platform: pkg.platform,
    mode: pkg.mode,
    publishUrl: pkg.publishUrl,
    body: opts.body ?? deriveBody(pkg.caption, pkg.hashtags),
    caption: pkg.caption,
    title: pkg.title,
    hashtags: [...pkg.hashtags],
    assets: pkg.assets.map((a) => ({ role: a.role, url: a.url, filename: a.filename })),
    limits,
    ...(opts.contentId !== undefined ? { contentId: opts.contentId } : {}),
  }
}
