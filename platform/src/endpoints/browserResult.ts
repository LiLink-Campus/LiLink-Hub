// 浏览器自动发布·结果回报 endpoint —— 供 worker（非登录会话）回写发布结果。
//
// 挂载：channel-contents 集合自定义 endpoint，path '/:id/browser-result'、method 'post'
//   → POST /api/channel-contents/:id/browser-result。
//
// 鉴权：只认 Bearer token == 服务端 env WORKER_REPORT_TOKEN（常量时间比较）；
//   token 未配置 → 501（功能未启用，不静默放行）；不匹配 → 401。**不依赖登录 cookie**。
// 只写 publishResult.browserPublish 快照，**绝不改 status**（人工确认才置已发布）。

import { timingSafeEqual } from 'node:crypto'
import { CHANNEL_CONTENTS_SLUG } from '../workflow/transition'
import { isManualPlatform } from '../platforms/registry'
import { isBrowserPublishStage } from '../automation/report'

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function readAuthHeader(req: any): string {
  const h = req?.headers
  if (h && typeof h.get === 'function') return h.get('authorization') || ''
  return (h?.authorization as string) || ''
}

// draftUrl 只接受 http(s)：它会在中台 UI 当 <a href> 渲染，拒绝 javascript:/data: 等，
// 杜绝（即便 WORKER_REPORT_TOKEN 被滥用或 worker 被攻击时的）存储型 XSS。
function safeHttpUrl(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v) return undefined
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:' ? v : undefined
  } catch {
    return undefined
  }
}

export const browserResultEndpoint = {
  path: '/:id/browser-result',
  method: 'post' as const,
  handler: async (req: any): Promise<Response> => {
    const expected = process.env.WORKER_REPORT_TOKEN
    if (!expected) {
      return Response.json(
        { error: '结果回报未启用（服务端未配置 WORKER_REPORT_TOKEN）' },
        { status: 501 },
      )
    }
    const m = /^Bearer\s+(.+)$/.exec(String(readAuthHeader(req)))
    if (!m || !tokenMatches(m[1], expected)) {
      return Response.json({ error: '回报鉴权失败' }, { status: 401 })
    }

    const id = req.routeParams?.id
    if (!id) return Response.json({ error: '缺少渠道稿 id' }, { status: 400 })

    let body: any = {}
    try {
      body = req.data ?? (typeof req.json === 'function' ? await req.json() : {})
    } catch {
      body = {}
    }

    if (!isBrowserPublishStage(body?.stage)) {
      return Response.json({ error: `stage 非法：${String(body?.stage)}` }, { status: 400 })
    }
    if (!isManualPlatform(body?.platform)) {
      return Response.json({ error: `platform 非法：${String(body?.platform)}` }, { status: 400 })
    }

    const { payload } = req
    const cc = await payload.findByID({ collection: CHANNEL_CONTENTS_SLUG, id }).catch(() => null)
    if (!cc) return Response.json({ error: `渠道稿不存在：${String(id)}` }, { status: 404 })

    const safeDraftUrl = safeHttpUrl(body.draftUrl)
    const browserPublish = {
      platform: body.platform,
      mode: body.mode === 'video' ? 'video' : 'image_note',
      stage: body.stage,
      ...(safeDraftUrl ? { draftUrl: safeDraftUrl } : {}),
      ...(typeof body.error === 'string' && body.error ? { error: body.error } : {}),
      ...(typeof body.title === 'string' && body.title ? { title: body.title } : {}),
      at: new Date().toISOString(),
    }

    // 只写 browserPublish（Payload 对 group 做部分合并，不动 stage/manualPackage 等同级字段）；
    // 不调 applyTransition、不改 status —— 人工确认后再走 markPublished。
    await payload.update({
      collection: CHANNEL_CONTENTS_SLUG,
      id,
      data: { publishResult: { browserPublish } },
    })

    return Response.json({ ok: true, stage: browserPublish.stage })
  },
}
