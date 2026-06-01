// 通用 uploader 工厂 —— 三平台发布流程结构同构（开页→登录校验→[切tab]→传素材→
// 等完成→填标题→键盘输入正文/话题→发布或停），差异全部落在 selectors.ts 的数据里。
// 故一个工厂 + 每平台一份 PlatformSelectors 即可，避免三份重复实现。

import type { ManualPlatformCode } from '../../platforms/registry'
import type { PageDriver } from '../driver'
import { NeedsLoginError, SelectorNotFoundError } from '../errors'
import type { BrowserPublishJob } from '../job'
import { firstPresent, requirePresent, truncateTitle } from './helpers'
import type { PlatformSelectors } from './selectors'
import type { PublishOpts, PublishOutcome, Uploader } from './types'

const DEFAULT_UPLOAD_TIMEOUT = 180_000
const DEFAULT_NAV_TIMEOUT = 60_000
const TOPIC_TIMEOUT = 5_000

export function createUploader(platform: ManualPlatformCode, sel: PlatformSelectors): Uploader {
  // 任一登录标记可见即判未登录。
  async function assertLoggedIn(driver: PageDriver): Promise<void> {
    for (const marker of sel.loginMarkers) {
      if (await driver.isVisible(marker)) throw new NeedsLoginError(platform)
    }
  }

  // 逐个话题：抖音/视频号 type '#词'+空格；小红书 type '#词' 后点联想下拉项（纯文本不成话题）。
  async function addHashtags(driver: PageDriver, hashtags: string[]): Promise<void> {
    for (const raw of hashtags) {
      const tag = raw.replace(/^#+/, '').trim()
      if (!tag) continue
      await driver.type(' #' + tag)
      if (sel.tagMode === 'dropdown' && sel.topicDropdownItem) {
        try {
          await driver.waitForVisible(sel.topicDropdownItem, { timeout: TOPIC_TIMEOUT })
          await driver.click(sel.topicDropdownItem)
        } catch {
          await driver.press('Space') // 联想没出来则空格兜底
        }
      } else {
        await driver.press('Space')
      }
    }
  }

  async function clickPublish(driver: PageDriver): Promise<void> {
    try {
      await driver.clickByRole(sel.publishButton.role, sel.publishButton.name, {
        exact: sel.publishButton.exact,
      })
    } catch {
      const css = await firstPresent(driver, sel.publishButton.cssFallback)
      if (!css) {
        throw new SelectorNotFoundError('点击发布', [
          `role=${sel.publishButton.role}[name="${sel.publishButton.name}"]`,
          ...sel.publishButton.cssFallback,
        ])
      }
      await driver.click(css)
    }
  }

  return {
    platform,

    async checkLogin(driver: PageDriver, opts): Promise<void> {
      const navT = opts?.timeouts?.nav ?? DEFAULT_NAV_TIMEOUT
      await driver.goto(sel.publishUrl('video'), { timeout: navT })
      await assertLoggedIn(driver)
    },

    async publish(
      driver: PageDriver,
      job: BrowserPublishJob,
      opts: PublishOpts,
    ): Promise<PublishOutcome> {
      const log = opts.log ?? (() => {})
      const warnings: string[] = []
      const navT = opts.timeouts?.nav ?? DEFAULT_NAV_TIMEOUT
      const upT = opts.timeouts?.upload ?? DEFAULT_UPLOAD_TIMEOUT

      // 1. 打开发布页（用 selectors 的 URL：含 target= 等自动化所需精确入口，且 mode 相关）
      const url = sel.publishUrl(job.mode)
      log(`打开发布页：${url}`)
      await driver.goto(url, { timeout: navT })

      // 2. 登录校验
      await assertLoggedIn(driver)

      // 3. 图文形态需先切 tab（抖音同入口不同 tab）
      if (job.mode === 'image_note' && sel.imageNoteTab) {
        if ((await driver.count(sel.imageNoteTab)) > 0) {
          log('切到图文形态')
          await driver.click(sel.imageNoteTab)
        }
      }

      // 4. 上传素材（fill-only 跳过）
      if (opts.fillOnly) {
        warnings.push('fill-only：跳过素材自动上传，请人工上传素材')
      } else {
        const isVideo = job.mode === 'video'
        const wanted = isVideo ? 'video' : 'image'
        const files = (opts.assets ?? []).filter((a) => a.role === wanted).map((a) => a.localPath)
        if (files.length === 0) {
          // 非 fill-only 却没素材：硬失败，避免发出空内容（codex EdgeCase [12]）。
          throw new Error(
            isVideo
              ? '视频模式但无可上传的视频素材（assets 为空或未下载成功）'
              : '图文模式但无可上传的图片素材（assets 为空或未下载成功）',
          )
        }
        // 封面类素材（vertical_cover/horizontal_cover）当前不自动上传：本工厂只 setInputFiles
        // 主素材，平台会自动从视频抽帧兜底封面。带了封面就提示运营在草稿里人工确认/替换，
        // 避免误以为指定封面已生效（小红书视频 requiredAssets 含 verticalCover）。
        const coverCount = (opts.assets ?? []).filter(
          (a) => a.role === 'vertical_cover' || a.role === 'horizontal_cover',
        ).length
        if (coverCount > 0) {
          warnings.push('已下载封面素材，但当前不自动上传（平台自动抽帧兜底）；请在草稿里人工确认或替换封面。')
        }
        const candidates = isVideo ? sel.fileInput : sel.imageFileInput
        const input = await requirePresent(driver, candidates, '选择素材文件')
        log(`上传 ${files.length} 个素材`)
        await driver.setInputFiles(input, files)
        // 抖音：上传后跳发布页，填字段前先等它
        if (sel.afterUploadUrl) {
          log('等待跳转到发布页')
          await driver.waitForURL(sel.afterUploadUrl, { timeout: navT })
        }
        log('等待素材上传/转码完成')
        await driver.waitForVisible(sel.uploadComplete[0], { timeout: upT })
      }

      // 5. 标题（按平台上限截断）
      const { value: title, truncated } = truncateTitle(job.title, job.limits.titleMax)
      if (truncated) warnings.push(`标题超 ${job.limits.titleMax} 字，已截断为「${title}」`)
      const titleSel = await requirePresent(driver, sel.titleInput, '填写标题')
      log('填写标题')
      await driver.fill(titleSel, title)

      // 6. 正文 + 话题（contenteditable 必须键盘输入）
      const bodySel = await requirePresent(driver, sel.bodyEditor, '填写正文')
      log('填写正文与话题')
      await driver.focus(bodySel)
      await driver.press('Control+a')
      await driver.press('Delete')
      if (job.body) await driver.type(job.body, { delay: 20 })
      if (job.hashtags.length > 0) {
        if (job.body) await driver.type(' ')
        await addHashtags(driver, job.hashtags)
      }

      // 7. 发布或停在草稿
      if (opts.mode === 'publish') {
        log('点击发布')
        await clickPublish(driver)
        log('等待发布成功跳转')
        await driver.waitForURL(sel.successUrlGlob, { timeout: navT })
        return {
          platform,
          mode: 'publish',
          published: true,
          staged: true,
          url: driver.currentUrl(),
          filledTitle: title,
          warnings,
        }
      }

      log('draft 模式：已填好，停在发布页，请人工检查后点发布')
      return {
        platform,
        mode: 'draft',
        published: false,
        staged: true,
        url: driver.currentUrl(),
        filledTitle: title,
        warnings,
      }
    },
  }
}
