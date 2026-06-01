// 登录态会话管理 —— 每平台一个持久化浏览器 profile（userDataDir）。
//
// 用 launchPersistentContext + userDataDir（而非纯 storageState）：这些平台登录态依赖
// cookies + localStorage + IndexedDB + 权限状态，persistent profile 保留得更完整、登录跨次
// 自动续期，无需手动 save/restore（见设计文档「session 用 persistent context」一节）。
//
// 【安全】profile 默认放 ~/.lilink/publish-sessions/<platform>/，目录权限 0700，**绝不入库/提交**。
// session 文件等同账号凭据，不得上传/共享。提供 clearSession 供运营主动登出。

import { chromium, type BrowserContext, type Page } from 'playwright-core'
import os from 'node:os'
import path from 'node:path'
import { mkdir, rm } from 'node:fs/promises'

import { PlaywrightPageDriver, type PageDriver } from './driver'
import type { ManualPlatformCode } from '../platforms/registry'

/** 登录态根目录（可用 LILINK_SESSION_DIR 覆盖）。 */
export function sessionRoot(): string {
  return process.env.LILINK_SESSION_DIR || path.join(os.homedir(), '.lilink', 'publish-sessions')
}

export function sessionDir(platform: ManualPlatformCode): string {
  return path.join(sessionRoot(), platform)
}

export interface LaunchOptions {
  /** 是否有头（扫码登录必须 true；日常发布建议 true 更稳）。默认 true。 */
  headed?: boolean
  /** 放慢每步毫秒数（更像真人、降低风控），对应 Playwright slowMo。 */
  slowMo?: number
  /** 默认操作超时（ms）。 */
  defaultTimeout?: number
}

export interface Session {
  context: BrowserContext
  page: Page
  driver: PageDriver
  close: () => Promise<void>
}

// 选浏览器：优先 PW_EXECUTABLE_PATH 指定的 Chrome；否则用 channel:'chrome' 系统 Chrome。
function browserChannelOpts(): { channel?: string; executablePath?: string } {
  const exe = process.env.PW_EXECUTABLE_PATH
  if (exe) return { executablePath: exe }
  return { channel: 'chrome' }
}

function launchArgs(): string[] {
  const args = ['--disable-blink-features=AutomationControlled', '--lang=zh-CN']
  // 容器/沙箱环境需要 --no-sandbox（运营桌面机不需要，故默认关，用环境变量开启）。
  if (process.env.LILINK_BROWSER_NO_SANDBOX === '1') {
    args.push('--no-sandbox', '--disable-dev-shm-usage')
  }
  return args
}

/** 启动指定平台的持久化登录态会话。 */
export async function launchSession(
  platform: ManualPlatformCode,
  opts: LaunchOptions = {},
): Promise<Session> {
  const dir = sessionDir(platform)
  await mkdir(dir, { recursive: true, mode: 0o700 })

  const context = await chromium.launchPersistentContext(dir, {
    headless: opts.headed === false,
    slowMo: opts.slowMo,
    locale: 'zh-CN',
    viewport: { width: 1366, height: 900 },
    ...browserChannelOpts(),
    args: launchArgs(),
  })

  const page = context.pages()[0] ?? (await context.newPage())
  const driver = new PlaywrightPageDriver(page, { defaultTimeout: opts.defaultTimeout })

  return {
    context,
    page,
    driver,
    close: async () => {
      await context.close()
    },
  }
}

/** 清除某平台登录态（登出）。 */
export async function clearSession(platform: ManualPlatformCode): Promise<void> {
  await rm(sessionDir(platform), { recursive: true, force: true })
}
