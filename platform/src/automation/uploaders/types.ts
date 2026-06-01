// Uploader 接口 —— 每个手动平台实现一个，只依赖 PageDriver（不碰 playwright）。

import type { PageDriver } from '../driver'
import type { BrowserPublishJob } from '../job'
import type { SocialAssetRole } from '../../renderers/social-package'
import type { ManualPlatformCode } from '../../platforms/registry'

// run 层把 job.assets 的 presigned url 下载成本地文件后，传给 uploader 做 setInputFiles。
export interface ResolvedAsset {
  role: SocialAssetRole
  localPath: string
  filename?: string
}

// 发布模式：
// - draft（默认）：填表 + 上传素材，但**不点最终发布**，停在已填好的发布页交人工检查后点发布。
//   （这些平台对未提交的上传页不一定自动存草稿，故 headed 下由运营当场确认；最稳、最合规。）
// - publish：在 draft 全部完成后，额外点「发布/发表」并确认成功跳转。
export type PublishMode = 'draft' | 'publish'

export interface PublishOpts {
  mode: PublishMode
  /** 已下载到本地的素材（run 层解析 job.assets 的 url 得到）；fillOnly 时可不传。 */
  assets?: ResolvedAsset[]
  /** 半自动降级：跳过素材自动上传（上传选择器失效时用），只开页 + 填字段，素材由人工上传。 */
  fillOnly?: boolean
  /** 各步超时（ms）。 */
  timeouts?: { nav?: number; upload?: number; action?: number }
  /** 进度日志回调（CLI 注入，打印每一步）。 */
  log?: (msg: string) => void
}

export interface PublishOutcome {
  platform: ManualPlatformCode
  mode: PublishMode
  /** 仅当 mode=publish 且确认成功跳转才为 true。 */
  published: boolean
  /** 已填好、可由人工点发布（draft 模式成功结束即 true）。 */
  staged: boolean
  /** 结束时的当前 URL（成功页 / 发布页）。 */
  url?: string
  /** 实际填入的（截断后）标题。 */
  filledTitle: string
  /** 非致命提示（如某可选步骤跳过、标题被截断）。 */
  warnings: string[]
}

export interface Uploader {
  platform: ManualPlatformCode
  /** 校验登录态；未登录抛 NeedsLoginError。 */
  checkLogin(driver: PageDriver, opts?: { timeouts?: { nav?: number } }): Promise<void>
  /** 执行发布（按 opts.mode 决定是否点最终发布）。 */
  publish(driver: PageDriver, job: BrowserPublishJob, opts: PublishOpts): Promise<PublishOutcome>
}
