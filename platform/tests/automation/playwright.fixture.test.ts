// 真浏览器 fixture 集成测试（gated：需 RUN_BROWSER_TESTS=1）。
//
// 用系统 Chrome 驱动「本地 fixture HTML（复刻三平台发布表单，含真实 DOM 选择器）」，
// 跑真实 PlaywrightPageDriver + 真实 uploader + 真实 selectors，验证：
//   driver 的 DOM 操作能力 + uploader 流程编排 + 选择器对真实 DOM 生效。
// 唯一的「假」是 fixture HTML 本身（faithful 复刻），平台 URL/导航由 fixture pushState 模拟。
// CI 默认 skip（无浏览器）；本机：RUN_BROWSER_TESTS=1 [PW_EXECUTABLE_PATH=/path/to/chrome] 跑。

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import http from 'node:http'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright-core'

import { PlaywrightPageDriver } from '@/automation/driver'
import { createUploader } from '@/automation/uploaders/base'
import { SELECTORS, type PlatformSelectors } from '@/automation/uploaders/selectors'
import { NeedsLoginError } from '@/automation/errors'
import type { BrowserPublishJob } from '@/automation/job'
import type { ManualPlatformCode } from '@/platforms/registry'

const RUN = !!process.env.RUN_BROWSER_TESTS
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

describe.skipIf(!RUN)('真浏览器 fixture 集成', () => {
  let browser: Browser
  let server: http.Server
  let base: string
  let tmpDir: string
  let videoFile: string
  let imgA: string
  let imgB: string

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '')
      const file = path.join(fixturesDir, name)
      if (!file.startsWith(fixturesDir) || !name.endsWith('.html')) {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      createReadStream(file).pipe(res)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    base = `http://127.0.0.1:${port}`

    const launchOpts = process.env.PW_EXECUTABLE_PATH
      ? { executablePath: process.env.PW_EXECUTABLE_PATH }
      : { channel: 'chrome' as const }
    browser = await chromium.launch({
      ...launchOpts,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })

    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lilink-it-'))
    videoFile = path.join(tmpDir, 'demo.mp4')
    imgA = path.join(tmpDir, 'a.jpg')
    imgB = path.join(tmpDir, 'b.jpg')
    await writeFile(videoFile, 'fake-mp4')
    await writeFile(imgA, 'fake-jpg-a')
    await writeFile(imgB, 'fake-jpg-b')
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
  })

  // 把真实 selectors 的「平台 URL/导航判据」改指向本地 fixture，DOM 选择器保持真实。
  function fixtureSelectors(platform: ManualPlatformCode, file: string, query = ''): PlatformSelectors {
    return {
      ...SELECTORS[platform],
      publishUrl: () => `${base}/${file}${query}`,
      afterUploadUrl: SELECTORS[platform].afterUploadUrl ? '**/uploaded**' : undefined,
      successUrlGlob: '**/published/**',
    }
  }

  function videoJob(platform: ManualPlatformCode, over: Partial<BrowserPublishJob> = {}): BrowserPublishJob {
    return {
      platform,
      mode: 'video',
      publishUrl: '',
      body: '集成测试正文',
      caption: '集成测试正文\n\n#校园',
      title: '集成测试标题',
      hashtags: ['#校园'],
      assets: [{ role: 'video', url: '', filename: 'demo.mp4' }],
      limits: { titleMax: 30, bodyMax: 1000, tagsMax: 10 },
      ...over,
    }
  }

  test('抖音 视频 draft：driver 真实填表/上传/键盘输入', async () => {
    const page = await browser.newPage()
    try {
      const driver = new PlaywrightPageDriver(page)
      const uploader = createUploader('douyin', fixtureSelectors('douyin', 'douyin.html'))
      const outcome = await uploader.publish(driver, videoJob('douyin'), {
        mode: 'draft',
        assets: [{ role: 'video', localPath: videoFile }],
      })
      expect(await page.locator('#title').inputValue()).toBe('集成测试标题')
      expect(await page.locator('#body').textContent()).toContain('集成测试正文')
      expect(await page.locator('#filename').textContent()).toContain('demo.mp4')
      expect(outcome.staged).toBe(true)
      expect(outcome.published).toBe(false)
    } finally {
      await page.close()
    }
  }, 60_000)

  test('抖音 视频 publish：点发布并等成功跳转', async () => {
    const page = await browser.newPage()
    try {
      const driver = new PlaywrightPageDriver(page)
      const uploader = createUploader('douyin', fixtureSelectors('douyin', 'douyin.html'))
      const outcome = await uploader.publish(driver, videoJob('douyin'), {
        mode: 'publish',
        assets: [{ role: 'video', localPath: videoFile }],
      })
      expect(page.url()).toContain('/published/')
      expect(await page.locator('#status').textContent()).toBe('published')
      expect(outcome.published).toBe(true)
    } finally {
      await page.close()
    }
  }, 60_000)

  test('小红书 图文 draft：多图上传 + 话题联想点选', async () => {
    const page = await browser.newPage()
    try {
      const driver = new PlaywrightPageDriver(page)
      const uploader = createUploader('xiaohongshu', fixtureSelectors('xiaohongshu', 'xiaohongshu.html'))
      const job = videoJob('xiaohongshu', {
        mode: 'image_note',
        title: '图文标题',
        body: '图文正文',
        assets: [
          { role: 'image', url: '', filename: 'a.jpg' },
          { role: 'image', url: '', filename: 'b.jpg' },
        ],
        limits: { titleMax: 20, bodyMax: 1000, tagsMax: 10 },
      })
      const outcome = await uploader.publish(driver, job, {
        mode: 'draft',
        assets: [
          { role: 'image', localPath: imgA },
          { role: 'image', localPath: imgB },
        ],
      })
      expect(await page.locator('#title').inputValue()).toBe('图文标题')
      const fn = await page.locator('#filename').textContent()
      expect(fn).toContain('a.jpg')
      expect(fn).toContain('b.jpg')
      // 话题联想被点选过（fixture 记录 tagPicked）
      expect(await page.locator('#body').getAttribute('data-tag-picked')).toBeTruthy()
      expect(outcome.staged).toBe(true)
    } finally {
      await page.close()
    }
  }, 60_000)

  test('视频号 视频 publish：发表按钮 + space 话题', async () => {
    const page = await browser.newPage()
    try {
      const driver = new PlaywrightPageDriver(page)
      const uploader = createUploader('weixin_channels', fixtureSelectors('weixin_channels', 'weixin_channels.html'))
      const outcome = await uploader.publish(driver, videoJob('weixin_channels', { limits: { titleMax: 16, bodyMax: 1000 } }), {
        mode: 'publish',
        assets: [{ role: 'video', localPath: videoFile }],
      })
      expect(await page.locator('#status').textContent()).toBe('published')
      expect(outcome.published).toBe(true)
    } finally {
      await page.close()
    }
  }, 60_000)

  test('未登录 fixture → checkLogin/publish 抛 NeedsLoginError', async () => {
    const page = await browser.newPage()
    try {
      const driver = new PlaywrightPageDriver(page)
      const uploader = createUploader('douyin', fixtureSelectors('douyin', 'douyin.html', '?notLoggedIn'))
      await expect(
        uploader.publish(driver, videoJob('douyin'), { mode: 'draft', assets: [{ role: 'video', localPath: videoFile }] }),
      ).rejects.toBeInstanceOf(NeedsLoginError)
    } finally {
      await page.close()
    }
  }, 60_000)
})
