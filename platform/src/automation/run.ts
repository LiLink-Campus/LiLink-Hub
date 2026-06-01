// runBrowserPublish —— 串起 素材下载 → 启动登录态会话 → uploader 发布 的编排层。
//
// 生命周期要点：
// - 素材临时文件在 setInputFiles 完成后即可清理（finally），不必等浏览器关。
// - draft + headed：发布器只填好不点发布，**保留浏览器**让运营当场检查后手动点发布；
//   故返回 session 句柄交 CLI 在运营确认后再 closeAll。
// - publish 模式 / headless / dry-run：发布器流程结束即收尾关闭。

import { isManualPlatform } from '../platforms/registry'
import { downloadAssets } from './assets'
import { launchSession, type Session } from './session'
import { getUploader } from './uploaders'
import type { PublishOutcome } from './uploaders/types'
import type { BrowserPublishJob } from './job'

export interface RunOptions {
  mode: 'draft' | 'publish'
  headed?: boolean
  fillOnly?: boolean
  slowMo?: number
  dryRun?: boolean
  maxBytes?: number
  timeouts?: { nav?: number; upload?: number; action?: number }
  log?: (msg: string) => void
}

export interface RunResult {
  outcome: PublishOutcome
  /** draft+headed 时保留的会话（交 CLI 在运营点完发布后关闭）；其余情形为 undefined。 */
  session?: Session
  /** 关闭一切（会话）。素材临时文件已在内部清理。 */
  closeAll: () => Promise<void>
}

const noop = async () => {}

export async function runBrowserPublish(
  job: BrowserPublishJob,
  opts: RunOptions,
): Promise<RunResult> {
  const log = opts.log ?? (() => {})
  if (!isManualPlatform(job.platform)) {
    throw new Error(`不支持浏览器自动发布的平台：${String(job.platform)}`)
  }
  const uploader = getUploader(job.platform)

  // dry-run：只校验素材可下载、不启动浏览器。
  if (opts.dryRun) {
    log('dry-run：校验素材可下载（不启动浏览器）')
    const dl = opts.fillOnly
      ? { assets: [], warnings: ['fill-only：跳过素材校验'], cleanup: noop }
      : await downloadAssets(job.assets, { log, maxBytes: opts.maxBytes })
    await dl.cleanup()
    return {
      outcome: {
        platform: job.platform,
        mode: opts.mode,
        published: false,
        staged: false,
        filledTitle: job.title.slice(0, job.limits.titleMax),
        warnings: [...dl.warnings, 'dry-run：仅校验，未启动浏览器、未填写、未发布'],
      },
      closeAll: noop,
    }
  }

  // 1. 下载素材
  const dl = opts.fillOnly
    ? { assets: [], warnings: ['fill-only：未下载素材'], cleanup: noop }
    : await downloadAssets(job.assets, { log, maxBytes: opts.maxBytes })

  // 2. 启动登录态会话
  let session: Session
  try {
    session = await launchSession(job.platform, {
      headed: opts.headed,
      slowMo: opts.slowMo,
    })
  } catch (err) {
    await dl.cleanup().catch(() => {})
    throw err
  }

  // 3. 发布
  let outcome: PublishOutcome
  try {
    outcome = await uploader.publish(session.driver, job, {
      mode: opts.mode,
      fillOnly: opts.fillOnly,
      assets: dl.assets,
      timeouts: opts.timeouts,
      log,
    })
  } catch (err) {
    // 清理与关浏览器彼此独立，且都不掩盖原始发布错误。
    await Promise.allSettled([dl.cleanup(), session.close()])
    throw err
  }

  // 4. 素材临时文件已不再需要（setInputFiles 已读完）；清理失败不致命，不影响成功结果。
  await dl.cleanup().catch(() => {})
  outcome.warnings = [...dl.warnings, ...outcome.warnings]

  // 5. 收尾：draft+headed 保留浏览器交人工，其余关闭
  const keepOpen = opts.mode === 'draft' && opts.headed !== false
  if (!keepOpen) {
    await session.close()
    return { outcome, closeAll: noop }
  }
  return { outcome, session, closeAll: () => session.close() }
}
