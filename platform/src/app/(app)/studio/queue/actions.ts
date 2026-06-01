'use server'

// studio/queue/actions.ts —— 发布队列页的服务端动作。
// - triggerBrowserPublish：仅本机（LILINK_WORKER_LOCAL=1）启用，spawn 独立 worker 进程
//   （headed 在运营屏幕弹浏览器），固定命令 + 参数数组、不拼 shell、id 经鉴权校验。
// - refreshBrowserResult：取该稿最新的 publishResult.browserPublish（供 UI 轮询/刷新）。

import { spawn } from 'node:child_process'

import { isManualPlatform } from '@/platforms/registry'
import { requireUser } from '../_lib/auth'
import { getContent } from '../_lib/actions'

export interface BrowserResultView {
  stage?: string
  draftUrl?: string
  error?: string
  title?: string
  at?: string
}

function readBrowserPublish(doc: Record<string, unknown>): BrowserResultView | null {
  const pr = doc.publishResult as Record<string, unknown> | undefined
  const bp = pr?.browserPublish
  return bp && typeof bp === 'object' ? (bp as BrowserResultView) : null
}

/** 本机一键浏览器发布（draft）：spawn worker run --content-id --report。 */
export async function triggerBrowserPublish(id: string): Promise<{ started: boolean }> {
  await requireUser()
  if (process.env.LILINK_WORKER_LOCAL !== '1') {
    throw new Error(
      '本机一键发布未启用：需 studio 与登录态在同一台机器并设 LILINK_WORKER_LOCAL=1。请改用「复制命令」在本机终端运行。',
    )
  }
  // 校验：必须是受支持平台、且处于「待人工发布」。getContent 内含登录+访问鉴权。
  const doc = await getContent(id)
  if (!isManualPlatform(doc.platform)) {
    throw new Error('该平台不支持浏览器自动发布。')
  }
  if (doc.status !== 'ready_to_publish') {
    throw new Error('仅「待人工发布」状态的稿件可一键发布。')
  }
  const realId = String((doc as { id: string | number }).id)

  // 固定命令 + 参数数组（无 shell 注入面）；detached + ignore stdio + unref，立即返回。
  // 不显式传 env：子进程默认继承父进程 env（worker 照样拿到 WORKER_REPORT_TOKEN / LILINK_STUDIO_URL）。
  const child = spawn('npx', ['tsx', 'scripts/publish-worker.ts', 'run', '--content-id', realId, '--report'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return { started: true }
}

/** 取最新浏览器发布结果（轮询/刷新用）。 */
export async function refreshBrowserResult(id: string): Promise<BrowserResultView | null> {
  await requireUser()
  const doc = await getContent(id)
  return readBrowserPublish(doc)
}
