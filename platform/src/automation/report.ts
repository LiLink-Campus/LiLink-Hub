// worker → 中台 结果回报（自动回报，见设计 §2）。
// 纯 fetch + 类型，不依赖 playwright/Payload，便于单测（mock fetch）。
// 回报失败只返回 false（调用方 warn），绝不影响发布本身。

import type { ManualPlatformCode, PublishMode } from '../platforms/registry'

export type BrowserPublishStage = 'staged' | 'published' | 'failed'

// 写入 channelContent.publishResult.browserPublish 的快照（UI 读它展示）。
export interface BrowserPublishResult {
  platform: ManualPlatformCode
  mode: PublishMode
  /** staged=已填好待人工点发布；published=worker 已点发布且确认成功；failed=出错。 */
  stage: BrowserPublishStage
  /** 成功页/草稿链接（尽力而为，可能没有）。 */
  draftUrl?: string
  /** 失败原因（应已脱敏，勿含 presigned 签名/凭据）。 */
  error?: string
  /** 实际填入的标题。 */
  title?: string
  /** ISO 时间。 */
  at: string
}

export const BROWSER_PUBLISH_STAGES: BrowserPublishStage[] = ['staged', 'published', 'failed']

export function isBrowserPublishStage(v: unknown): v is BrowserPublishStage {
  return typeof v === 'string' && (BROWSER_PUBLISH_STAGES as string[]).includes(v)
}

export interface ReportOptions {
  studioUrl: string
  token: string
  contentId: string
  result: BrowserPublishResult
  log?: (msg: string) => void
}

/** POST 结果到中台回报 endpoint。成功 true；任何失败（网络/非 2xx）吞掉返回 false。 */
export async function reportResult(opts: ReportOptions): Promise<boolean> {
  const { studioUrl, token, contentId, result, log = () => {} } = opts
  const base = studioUrl.replace(/\/+$/, '')
  const url = `${base}/api/channel-contents/${encodeURIComponent(contentId)}/browser-result`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(result),
    })
    if (!res.ok) {
      log(`结果回报失败 HTTP ${res.status}（不影响发布本身）`)
      return false
    }
    log('结果已回报中台')
    return true
  } catch (err) {
    log(`结果回报失败：${err instanceof Error ? err.message : String(err)}（不影响发布本身）`)
    return false
  }
}
