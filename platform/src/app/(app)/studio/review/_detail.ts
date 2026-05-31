// studio/review/_detail.ts —— 审核队列「单条详情」的服务端提取助手（纯函数，无副作用）。
//
// listReviewQueue() 只给列表摘要（id/标题/形式/平台/状态/更新时间）；审核页要在卡片里
// 多展示一些「下一步要点」：长文的预览链接、图文/视频的发布包要点（标题/正文/话题/素材/
// 校验提示）、以及发布残留的错误。这些要从完整渠道稿文档里取。
//
// 本模块只做「完整文档 → 可序列化的 ReviewItemDetail」的纯转换：
//   - 不含任何 'use server'，由审核页（server component）在服务端 import 调用；
//   - 产出对象全部是基本类型 / 数组 / 普通对象，能安全跨 RSC 边界传给 client 子组件。
//
// 发布包形状复用 src/renderers/social-package.ts 的 SocialPublishPackage（manualPackage 即它），
// 平台 label 复用 src/platforms/registry.ts，避免在前端重造平台清单。

import { isPlatformCode, getPlatformSpec } from '@/platforms/registry'
import type { SocialPublishPackage, SocialAsset } from '@/renderers/social-package'
import type { ContentForm, StudioStatus } from '../_lib/types'
import { platformToForm } from '../_lib/platforms'

/** 发布包里素材角色 → 中文标签（展示用）。 */
const ASSET_ROLE_LABEL: Record<SocialAsset['role'], string> = {
  image: '图片',
  video: '视频',
  horizontal_cover: '横封面',
  vertical_cover: '竖封面',
}

/** 一条素材的精简展示形状（只取卡片要展示的字段）。 */
export interface ReviewAsset {
  roleLabel: string
  /** 是否已展开出可访问 URL（无 URL 时卡片提示「待确认直链」）。 */
  hasUrl: boolean
  /** 文件名 / alt，给运营一个可辨识的名字（可能为空）。 */
  name: string
}

/** 发布包要点（图文 / 视频形态展示，来自 publishResult.manualPackage）。 */
export interface ReviewManualPackage {
  platformLabel: string
  /** image_note / video 的中文形态名。 */
  modeLabel: string
  title: string
  caption: string
  hashtags: string[]
  assets: ReviewAsset[]
  checklist: string[]
  /** 提示文案（warning/error 都拍平成一行行文字，按级别给颜色用 level）。 */
  warnings: { level: 'warning' | 'error'; message: string }[]
  /** 平台发布入口 URL（可空）。 */
  publishUrl: string
}

/**
 * 审核卡片所需的「单条详情」（可序列化，能跨 RSC 边界传给 client）。
 * 在摘要基础上补：长文预览链接、图文/视频发布包要点、发布残留错误、当前处理人名。
 */
export interface ReviewItemDetail {
  id: string
  title: string
  form: ContentForm
  platform: string
  platformLabel: string
  status: StudioStatus
  updatedAt: string
  /** 当前处理人显示名（取 assignee.name/email，可空）。 */
  assigneeName: string | null
  /** 长文预览地址（仅 article 形态有；其余为 null）。 */
  previewHref: string | null
  /** 图文/视频发布包要点（仅当 publishResult.manualPackage 存在时有）。 */
  manualPackage: ReviewManualPackage | null
  /** 上次发布残留的错误（publishResult.lastError，可空）。 */
  lastError: string | null
}

// ---------- 内部小工具 ----------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 平台 code → 中文 label（复用 registry；未知平台回落显示 code 本身）。 */
function platformLabelOf(platform: string): string {
  return isPlatformCode(platform) ? getPlatformSpec(platform).label : platform
}

/** 内容形态中文名（卡片小标签用）。 */
export function formLabel(form: ContentForm): string {
  switch (form) {
    case 'article':
      return '文章'
    case 'imagetext':
      return '图文'
    case 'video':
      return '视频'
    default:
      return '内容'
  }
}

/** 渠道稿挑标题：公众号 wxTitle → 手动平台 socialTitle → 选题名 → 兜底。 */
function pickTitle(doc: Record<string, unknown>): string {
  const wxTitle = str(doc.wxTitle)
  if (wxTitle) return wxTitle
  const socialTitle = str(doc.socialTitle)
  if (socialTitle) return socialTitle
  const post = asRecord(doc.post)
  if (post) {
    const t = str(post.title)
    if (t) return t
  }
  return '未命名草稿'
}

function assigneeNameOf(doc: Record<string, unknown>): string | null {
  const a = asRecord(doc.assignee)
  if (!a) return null
  return str(a.name) || str(a.email) || null
}

function updatedAtOf(doc: Record<string, unknown>): string {
  const v = doc.updatedAt
  if (typeof v === 'string') return v
  if (v instanceof Date) return v.toISOString()
  return new Date().toISOString()
}

function modeLabelOf(mode: string): string {
  return mode === 'video' ? '视频' : '图文/笔记'
}

function toReviewAsset(asset: SocialAsset): ReviewAsset {
  return {
    roleLabel: ASSET_ROLE_LABEL[asset.role] ?? '素材',
    hasUrl: Boolean(asset.url),
    name: asset.filename || asset.alt || '',
  }
}

/**
 * 从渠道稿文档里取 publishResult.manualPackage，转成卡片要点。
 * 文档里没有发布包（还没生成）时返回 null。
 */
function manualPackageOf(doc: Record<string, unknown>): ReviewManualPackage | null {
  const publishResult = asRecord(doc.publishResult)
  const raw = publishResult?.manualPackage
  const pkg = asRecord(raw) as unknown as SocialPublishPackage | undefined
  if (!pkg || typeof pkg !== 'object') return null
  // manualPackage 是 json 字段：字段可能缺，统统兜底。
  const assets = Array.isArray(pkg.assets) ? pkg.assets.map(toReviewAsset) : []
  const hashtags = Array.isArray(pkg.hashtags) ? pkg.hashtags.filter((t) => typeof t === 'string') : []
  const checklist = Array.isArray(pkg.checklist)
    ? pkg.checklist.filter((c) => typeof c === 'string')
    : []
  const warnings = Array.isArray(pkg.warnings)
    ? pkg.warnings
        .filter((w) => w && typeof w === 'object' && typeof (w as { message?: unknown }).message === 'string')
        .map((w) => ({
          level: (w as { level?: unknown }).level === 'error' ? 'error' : 'warning',
          message: String((w as { message: unknown }).message),
        }) as { level: 'warning' | 'error'; message: string })
    : []
  return {
    platformLabel: str(pkg.platformLabel) || platformLabelOf(str(doc.platform)),
    modeLabel: modeLabelOf(str(pkg.mode)),
    title: str(pkg.title),
    caption: typeof pkg.caption === 'string' ? pkg.caption : '',
    hashtags,
    assets,
    checklist,
    warnings,
    publishUrl: str(pkg.publishUrl),
  }
}

/**
 * 完整渠道稿文档 → 审核卡片详情（可序列化）。
 * 入参为 getContent(id)（depth:2）的返回；要正确取到 assignee 名、媒体 URL，需 depth≥1。
 */
export function toReviewItemDetail(doc: Record<string, unknown>): ReviewItemDetail {
  const platform = str(doc.platform) || 'wechat'
  const contentMode = str(doc.contentMode) || null
  const status = (str(doc.status) || 'draft') as StudioStatus
  const form = platformToForm(platform, contentMode)
  const id = String(doc.id)

  return {
    id,
    title: pickTitle(doc),
    form,
    platform,
    platformLabel: platformLabelOf(platform),
    status,
    updatedAt: updatedAtOf(doc),
    assigneeName: assigneeNameOf(doc),
    // 长文（article）走预览页看「所见即所发」；图文/视频不进预览页，看发布包要点。
    previewHref: form === 'article' ? `/preview/channel-contents/${id}` : null,
    manualPackage: form === 'article' ? null : manualPackageOf(doc),
    lastError: str(asRecord(doc.publishResult)?.lastError) || null,
  }
}
