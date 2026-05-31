'use server'

// studio/_lib/actions.ts —— 运营内容工作台的服务端动作（Server Actions）。
//
// 全部 async；统一用 Payload Local API 直连数据库（getPayload({ config })），
// 鉴权取当前登录会话（payload.auth({ headers })）。状态流转一律复用 workflow/transition.ts
// 的 applyTransition（不直接写 status），发布走同源 publish endpoint（转发 cookie）。
//
// 错误处理约定：所有动作抛 Error 时 message 用清晰中文，前端可直接展示。
// 读列表类（listMyContent / listReviewQueue）出错时返回空数组并不抛，避免页面整页崩。
//
// 关于访问控制：第一期「三人全能」——channel-contents / posts 无集合级 read 限制（任意登录
// 运营可读写）。故 listReviewQueue 跨运营聚合、approve/reject 等动作不再做额外角色校验，
// 仅要求登录。写动作用 overrideAccess 默认（Local API 默认 true）即可。

import { headers as nextHeaders, cookies as nextCookies } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'

import { applyTransition } from '@/workflow/transition'
import type { ContentForm, StudioContentSummary, StudioStatus } from './types'
import { formToPlatformDefault, platformToForm } from './platforms'

const CHANNEL_CONTENTS = 'channel-contents'
const POSTS = 'posts'
const MEDIA = 'media'

// 审核队列覆盖的状态集合（跨运营）。
const REVIEW_STATUSES: StudioStatus[] = ['in_review', 'approved', 'ready_to_publish']

// 指向 media / posts 的关系字段。postgres 整型主键下，关系值必须是 number id；
// 前端（如 uploadMedia 返回的 id、媒体库选择）常是字符串 '16'，直接写会被 Payload
// 校验为「字段无效」。这里统一把这些字段的数字字符串 id（含数组）coerce 成 number。
const RELATIONSHIP_ID_FIELDS = new Set([
  'coverImage',
  'videoFile',
  'horizontalCover',
  'verticalCover',
  'socialImages',
  'post',
])
function toNumericId(v: unknown): unknown {
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v)
  if (Array.isArray(v)) return v.map(toNumericId)
  return v
}
function coerceRelationshipIds(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data }
  for (const key of Object.keys(out)) {
    if (RELATIONSHIP_ID_FIELDS.has(key)) out[key] = toNumericId(out[key])
  }
  return out
}

// ---------- 内部助手 ----------

type PayloadInstance = Awaited<ReturnType<typeof getPayload>>
type SessionUser = { id: string | number; [key: string]: unknown }

/** 取 payload 实例 + 当前登录用户；未登录抛中文错误（写动作用）。 */
async function getPayloadAndUser(): Promise<{ payload: PayloadInstance; user: SessionUser }> {
  const payload = await getPayload({ config })
  const headers = await nextHeaders()
  const { user } = await payload.auth({ headers })
  if (!user) {
    throw new Error('未登录或会话已失效，请重新登录后再试。')
  }
  return { payload, user: user as unknown as SessionUser }
}

/** 仅取 payload 实例（读列表时即便未登录也安全返回空，不在这里抛）。 */
async function getPayloadAndMaybeUser(): Promise<{
  payload: PayloadInstance
  user: SessionUser | null
}> {
  const payload = await getPayload({ config })
  const headers = await nextHeaders()
  const { user } = await payload.auth({ headers })
  return { payload, user: (user as unknown as SessionUser) ?? null }
}

/** 从渠道稿文档挑列表标题：公众号取 wxTitle，手动平台取 socialTitle，兜底取选题名。 */
function pickTitle(doc: Record<string, unknown>): string {
  const wxTitle = typeof doc.wxTitle === 'string' ? doc.wxTitle.trim() : ''
  if (wxTitle) return wxTitle
  const socialTitle = typeof doc.socialTitle === 'string' ? doc.socialTitle.trim() : ''
  if (socialTitle) return socialTitle
  // post 可能是 id（depth:0）或对象（depth>=1）。取对象时读其 title。
  const post = doc.post
  if (post && typeof post === 'object') {
    const t = (post as Record<string, unknown>).title
    if (typeof t === 'string' && t.trim()) return t.trim()
  }
  return '未命名草稿'
}

/** 渠道稿文档 → 列表摘要。 */
function toSummary(doc: Record<string, unknown>): StudioContentSummary {
  const platform = typeof doc.platform === 'string' ? doc.platform : 'wechat'
  const contentMode = typeof doc.contentMode === 'string' ? doc.contentMode : null
  const status = (typeof doc.status === 'string' ? doc.status : 'draft') as StudioStatus
  const updatedAt =
    typeof doc.updatedAt === 'string'
      ? doc.updatedAt
      : doc.updatedAt instanceof Date
        ? doc.updatedAt.toISOString()
        : new Date().toISOString()
  return {
    id: String(doc.id),
    title: pickTitle(doc),
    form: platformToForm(platform, contentMode),
    platform,
    status,
    updatedAt,
  }
}

// ---------- 列表查询 ----------

/**
 * 「我的内容」：当前登录运营作为所属选题负责人的全部渠道稿（按更新时间倒序）。
 * 未登录或出错时返回空数组（页面据空状态给登录/创作引导，不整页崩）。
 */
export async function listMyContent(): Promise<StudioContentSummary[]> {
  try {
    const { payload, user } = await getPayloadAndMaybeUser()
    if (!user) return []
    const res = await payload.find({
      collection: CHANNEL_CONTENTS,
      // 渠道稿挂在 posts 下，按选题负责人过滤（关系字段点路径查询）。
      where: { 'post.owner': { equals: user.id } },
      depth: 1, // populate post 以便取 title 兜底
      limit: 100,
      sort: '-updatedAt',
      overrideAccess: false,
      user: user as never,
    })
    return (res.docs as unknown as Record<string, unknown>[]).map(toSummary)
  } catch {
    return []
  }
}

/**
 * 「审核队列」：跨运营聚合处于 待审核 / 已批准 / 待人工发布 的渠道稿（按更新时间倒序）。
 * 未登录或出错时返回空数组。
 */
export async function listReviewQueue(): Promise<StudioContentSummary[]> {
  try {
    const { payload, user } = await getPayloadAndMaybeUser()
    if (!user) return []
    const res = await payload.find({
      collection: CHANNEL_CONTENTS,
      where: { status: { in: REVIEW_STATUSES } },
      depth: 1,
      limit: 100,
      sort: '-updatedAt',
      overrideAccess: false,
      user: user as never,
    })
    return (res.docs as unknown as Record<string, unknown>[]).map(toSummary)
  } catch {
    return []
  }
}

// ---------- 取单条 ----------

/**
 * 取完整渠道稿文档（depth:2，让 body 内 upload 图片节点 populate 出 media.url，
 * coverImage / socialImages 等关系也展开）。供编辑 / 发布 / 预览页读取。
 * 取不到时抛中文错误。
 */
export async function getContent(id: string): Promise<Record<string, unknown>> {
  const { payload, user } = await getPayloadAndUser()
  let doc: Record<string, unknown> | null = null
  try {
    doc = (await payload.findByID({
      collection: CHANNEL_CONTENTS,
      id,
      depth: 2,
      overrideAccess: false,
      user: user as never,
    })) as unknown as Record<string, unknown> | null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`读取内容失败：${message}`)
  }
  if (!doc) {
    throw new Error(`内容不存在或无权访问（id：${id}）。`)
  }
  return doc
}

// ---------- 创建草稿 ----------

/**
 * 新建一条草稿：
 *  1. 先建 posts 选题（名「未命名草稿」，owner = 当前登录运营）——post 在渠道稿里必填。
 *  2. 再按内容形态建 channel-contents 草稿，set platform / contentMode，并挂上刚建的 post。
 * 返回新建渠道稿的 id（前端据此跳到编辑页）。
 */
export async function createDraft(form: ContentForm): Promise<{ id: string }> {
  const { payload, user } = await getPayloadAndUser()

  // 1. 先建选题（post 必填，故必须先有它）。
  let postId: string | number
  try {
    const post = await payload.create({
      collection: POSTS,
      data: {
        title: '未命名草稿',
        owner: user.id,
      } as never,
    })
    postId = (post as { id: string | number }).id
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`创建选题失败：${message}`)
  }

  // 2. 按形态推默认平台 / 形态，建渠道稿草稿并挂上 post。
  const { platform, contentMode } = formToPlatformDefault(form)
  try {
    const cc = await payload.create({
      collection: CHANNEL_CONTENTS,
      data: {
        post: postId,
        platform,
        ...(contentMode ? { contentMode } : {}),
        // status 默认 draft（集合 defaultValue），不显式写，避免触发字段级 access。
        assignee: user.id,
      } as never,
    })
    return { id: String((cc as { id: string | number }).id) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`创建草稿失败：${message}`)
  }
}

// ---------- 更新 ----------

/**
 * 更新渠道稿任意可写字段（如 wxTitle / body / coverImage / social* / renderConfig）。
 * status / publishResult / transitionLog 等受字段级 access 保护，不应经此写入
 * （传了也会被 Payload 的字段 access 拒绝），状态流转请用下方专用动作。
 */
export async function updateContent(
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  const { payload, user } = await getPayloadAndUser()
  try {
    await payload.update({
      collection: CHANNEL_CONTENTS,
      id,
      data: coerceRelationshipIds(data) as never,
      overrideAccess: false,
      user: user as never,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`保存失败：${message}`)
  }
}

// ---------- 删除 ----------

/**
 * 删除一条渠道稿（草稿/内容管理用）。运营可删自己名下的内容；删除后无法恢复。
 * 仅删渠道稿本身；其自动建的「未命名草稿」选题留着无害（运营侧不展示选题）。
 */
export async function deleteContent(id: string): Promise<void> {
  const { payload, user } = await getPayloadAndUser()
  try {
    await payload.delete({
      collection: CHANNEL_CONTENTS,
      id,
      overrideAccess: false,
      user: user as never,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`删除失败：${message}`)
  }
}

// ---------- 上传媒体 ----------

/**
 * 上传一个文件到 media 集合（公众号封面 / 正文配图 / 图文图片 / 视频等）。
 * formData 里取名为 'file' 的文件字段；可选 'alt' 作图片说明。
 * 返回新建 media 的 { id, url }（url 由 media afterRead 钩子按私有桶 presign 生成）。
 */
export async function uploadMedia(formData: FormData): Promise<{ id: string; url: string }> {
  const { payload } = await getPayloadAndUser()

  const file = formData.get('file')
  if (!file || typeof file === 'string') {
    throw new Error('未找到上传文件，请重新选择文件。')
  }
  const blob = file as unknown as {
    arrayBuffer: () => Promise<ArrayBuffer>
    name?: string
    type?: string
    size?: number
  }

  const altRaw = formData.get('alt')
  const alt = typeof altRaw === 'string' && altRaw.trim() ? altRaw.trim() : undefined

  let buffer: Buffer
  try {
    buffer = Buffer.from(await blob.arrayBuffer())
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`读取上传文件失败：${message}`)
  }

  const name = blob.name && blob.name.trim() ? blob.name : 'upload'
  const mimetype = blob.type && blob.type.trim() ? blob.type : 'application/octet-stream'
  // media.type 必填：按 mime 前缀粗分图片 / 音频 / 视频，默认图片。
  const mediaType = mimetype.startsWith('video/')
    ? 'video'
    : mimetype.startsWith('audio/')
      ? 'audio'
      : 'image'

  try {
    const created = await payload.create({
      collection: MEDIA,
      data: {
        type: mediaType,
        ...(alt ? { alt } : {}),
      } as never,
      file: {
        data: buffer,
        mimetype,
        name,
        size: typeof blob.size === 'number' ? blob.size : buffer.length,
      },
    })
    const doc = created as { id: string | number; url?: string | null }
    return { id: String(doc.id), url: doc.url ?? '' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`上传失败：${message}`)
  }
}

// ---------- 状态流转（全部复用 applyTransition，写审计） ----------

/** 提交送审：draft → in_review。 */
export async function submitForReview(id: string): Promise<void> {
  const { payload, user } = await getPayloadAndUser()
  try {
    await applyTransition(payload, id, 'in_review', user.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`提交审核失败：${message}`)
  }
}

/** 审核通过：in_review → approved。 */
export async function approve(id: string): Promise<void> {
  const { payload, user } = await getPayloadAndUser()
  try {
    await applyTransition(payload, id, 'approved', user.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`审核通过失败：${message}`)
  }
}

/**
 * 打回：in_review → draft，并记录打回原因（reason 进 transitionLog 审计）。
 * reason 必填且非空，便于作者知道改什么。
 */
export async function reject(id: string, reason: string): Promise<void> {
  const trimmed = (reason ?? '').trim()
  if (!trimmed) {
    throw new Error('请填写打回原因，方便作者修改。')
  }
  const { payload, user } = await getPayloadAndUser()
  try {
    await applyTransition(payload, id, 'draft', user.id, trimmed)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`打回失败：${message}`)
  }
}

/** 人工发布确认已发：ready_to_publish → published。 */
export async function markPublished(id: string): Promise<void> {
  const { payload, user } = await getPayloadAndUser()
  try {
    await applyTransition(payload, id, 'published', user.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`标记已发布失败：${message}`)
  }
}

// ---------- 发布（走同源 publish endpoint，转发 cookie） ----------

/**
 * 发布一条渠道稿：POST 同源 /api/channel-contents/:id/publish。
 * - 鉴权：转发当前请求的 cookie（endpoint 内用 req.user 鉴权，需要会话 cookie）。
 * - 同源 host：从 next/headers 取（优先 x-forwarded-host，回落 host），协议取
 *   x-forwarded-proto（回落 https；本地无该头时按 http）。
 * - 返回 endpoint 的 JSON（含 ok / stage / draftMediaId / manualPackage 或 error）。
 *   HTTP 非 2xx 时抛出带后端 error 文案的中文错误，前端可直接展示。
 */
export async function publishContent(id: string): Promise<unknown> {
  // 必须登录（同时也用于尽早给出清晰错误）。
  await getPayloadAndUser()

  const h = await nextHeaders()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) {
    throw new Error('无法确定服务地址（缺少 host 头），发布中止。')
  }
  // 协议：有 x-forwarded-proto 用之；否则按 host 是否本地猜测（本地 http，线上 https）。
  const forwardedProto = h.get('x-forwarded-proto')
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
  const proto = forwardedProto ?? (isLocal ? 'http' : 'https')

  // 转发会话 cookie（endpoint 鉴权依赖它）。
  const cookieStore = await nextCookies()
  const cookieHeader = cookieStore.toString()

  const url = `${proto}://${host}/api/${CHANNEL_CONTENTS}/${encodeURIComponent(id)}/publish`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      // publish endpoint 不读 body，但带空对象更稳妥（部分中间件要求）。
      body: '{}',
      cache: 'no-store',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`发布请求失败：${message}`)
  }

  // 解析 JSON（失败则按文本兜底）。
  let payloadJson: unknown = null
  let text = ''
  try {
    text = await res.text()
    payloadJson = text ? JSON.parse(text) : null
  } catch {
    payloadJson = null
  }

  if (!res.ok) {
    const errMsg =
      payloadJson && typeof payloadJson === 'object' && 'error' in payloadJson
        ? String((payloadJson as { error: unknown }).error)
        : text || `发布失败（HTTP ${res.status}）`
    throw new Error(errMsg)
  }

  return payloadJson
}
