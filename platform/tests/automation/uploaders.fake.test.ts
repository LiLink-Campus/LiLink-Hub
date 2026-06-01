import { describe, expect, test } from 'vitest'

import { getUploader } from '@/automation/uploaders'
import { SELECTORS } from '@/automation/uploaders/selectors'
import { NeedsLoginError, SelectorNotFoundError } from '@/automation/errors'
import type { BrowserPublishJob } from '@/automation/job'
import type { ResolvedAsset } from '@/automation/uploaders/types'
import { FakeDriver } from './fake-driver'

// ---- 构造 job ----
function videoJob(platform: BrowserPublishJob['platform'], over: Partial<BrowserPublishJob> = {}): BrowserPublishJob {
  return {
    platform,
    mode: 'video',
    publishUrl: '',
    body: '这是正文',
    caption: '这是正文\n\n#校园\n\nLiLink: https://lilink.top',
    title: '一个视频标题',
    hashtags: ['#校园'],
    assets: [{ role: 'video', url: 'u', filename: 'v.mp4' }],
    limits: { titleMax: 30, bodyMax: 1000, tagsMax: 10 },
    ...over,
  }
}
function imageJob(platform: BrowserPublishJob['platform'], over: Partial<BrowserPublishJob> = {}): BrowserPublishJob {
  return {
    platform,
    mode: 'image_note',
    publishUrl: '',
    body: '图文正文',
    caption: '图文正文\n\n#校园',
    title: '图文标题',
    hashtags: ['#校园'],
    assets: [{ role: 'image', url: 'u1' }, { role: 'image', url: 'u2' }],
    limits: { titleMax: 20, bodyMax: 1000, tagsMax: 10 },
    ...over,
  }
}

const VIDEO_FILES: ResolvedAsset[] = [{ role: 'video', localPath: '/tmp/v.mp4' }]
const IMAGE_FILES: ResolvedAsset[] = [
  { role: 'image', localPath: '/tmp/a.jpg' },
  { role: 'image', localPath: '/tmp/b.jpg' },
]

// 让 douyin 视频 draft 全流程能走通的「页面已就绪」FakeDriver 配置。
function douyinReady(extra: Partial<ConstructorParameters<typeof FakeDriver>[0]> = {}) {
  return new FakeDriver({
    url: 'https://creator.douyin.com/creator-micro/content/upload',
    visible: [
      'input[type=file]',
      '[class^="long-card"] div:has-text("重新上传")',
      'input[placeholder*="标题"]',
      '.zone-container[contenteditable="true"]',
    ],
    ...extra,
  })
}

describe('checkLogin', () => {
  test('出现登录标记 → 抛 NeedsLoginError', async () => {
    const d = new FakeDriver({ visible: ['text=扫码登录'] })
    await expect(getUploader('douyin').checkLogin(d)).rejects.toBeInstanceOf(NeedsLoginError)
    // 仍应先 goto 了发布页
    expect(d.byOp('goto')).toHaveLength(1)
  })

  test('无登录标记 → 通过', async () => {
    const d = new FakeDriver({})
    await expect(getUploader('xiaohongshu').checkLogin(d)).resolves.toBeUndefined()
  })
})

describe('抖音 视频 draft（默认模式）', () => {
  test('完整动作序列：开页→传文件→跳发布页→等完成→填标题→键盘正文→不点发布', async () => {
    const d = douyinReady()
    const outcome = await getUploader('douyin').publish(d, videoJob('douyin'), {
      mode: 'draft',
      assets: VIDEO_FILES,
    })

    // 打开了抖音上传页
    expect(d.byOp('goto')[0].url).toContain('creator.douyin.com/creator-micro/content/upload')
    // 用通用 file input 直接 setInputFiles 了视频本地路径
    const sif = d.byOp('setInputFiles')
    expect(sif).toHaveLength(1)
    expect(sif[0].selector).toBe('input[type=file]')
    expect(sif[0].files).toEqual(['/tmp/v.mp4'])
    // 抖音上传后等跳发布页（afterUploadUrl 正则）
    expect(d.byOp('waitForURL').some((a) => a.pattern.includes('publish'))).toBe(true)
    // 等上传完成信号
    expect(d.byOp('waitForVisible').some((a) => a.selector.includes('重新上传'))).toBe(true)
    // 填标题进 input
    const fills = d.byOp('fill')
    expect(fills.some((f) => f.selector.includes('标题') && f.text === '一个视频标题')).toBe(true)
    // 正文走键盘 type（富文本），且 focus 了 contenteditable
    expect(d.byOp('focus').some((a) => a.selector.includes('contenteditable'))).toBe(true)
    expect(d.byOp('type').some((a) => a.text === '这是正文')).toBe(true)
    // draft 模式：不点发布、不等成功跳转
    expect(d.byOp('clickByRole')).toHaveLength(0)
    expect(d.byOp('waitForURL').some((a) => a.pattern.includes('manage'))).toBe(false)
    // 结果
    expect(outcome.published).toBe(false)
    expect(outcome.staged).toBe(true)
    expect(outcome.filledTitle).toBe('一个视频标题')
  })

  test('publish 模式：点发布(role=button,发布,exact) + 等 manage 成功跳转', async () => {
    const d = douyinReady()
    const outcome = await getUploader('douyin').publish(d, videoJob('douyin'), {
      mode: 'publish',
      assets: VIDEO_FILES,
    })
    const clicks = d.byOp('clickByRole')
    expect(clicks).toHaveLength(1)
    expect(clicks[0]).toMatchObject({ role: 'button', name: '发布', exact: true })
    expect(d.byOp('waitForURL').some((a) => a.pattern.includes('manage'))).toBe(true)
    expect(outcome.published).toBe(true)
  })

  test('标题超 30 字被截断且给 warning', async () => {
    const d = douyinReady()
    const long = '标'.repeat(40)
    const outcome = await getUploader('douyin').publish(d, videoJob('douyin', { title: long }), {
      mode: 'draft',
      assets: VIDEO_FILES,
    })
    expect(outcome.filledTitle).toHaveLength(30)
    expect(outcome.warnings.some((w) => w.includes('截断'))).toBe(true)
  })

  test('fill-only：不 setInputFiles，仍填标题正文', async () => {
    const d = douyinReady()
    const outcome = await getUploader('douyin').publish(d, videoJob('douyin'), {
      mode: 'draft',
      fillOnly: true,
    })
    expect(d.byOp('setInputFiles')).toHaveLength(0)
    expect(d.byOp('fill').length).toBeGreaterThan(0)
    expect(outcome.warnings.some((w) => w.includes('fill-only'))).toBe(true)
  })

  test('未登录（发布流程内）→ 抛 NeedsLoginError，不传文件', async () => {
    const d = douyinReady({ visible: ['text=扫码登录'] })
    await expect(
      getUploader('douyin').publish(d, videoJob('douyin'), { mode: 'draft', assets: VIDEO_FILES }),
    ).rejects.toBeInstanceOf(NeedsLoginError)
    expect(d.byOp('setInputFiles')).toHaveLength(0)
  })
})

describe('小红书 图文 draft', () => {
  test('多图一次性 setInputFiles + 话题走联想下拉点选', async () => {
    const d = new FakeDriver({
      url: 'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image',
      visible: [
        'input[type="file"][accept*="image" i]',
        'text=上传成功',
        'input[placeholder*="填写标题"]',
        'p[data-placeholder*="输入正文描述"]',
        '#creator-editor-topic-container .item',
      ],
    })
    const outcome = await getUploader('xiaohongshu').publish(d, imageJob('xiaohongshu'), {
      mode: 'draft',
      assets: IMAGE_FILES,
    })
    // 一次性多图
    const sif = d.byOp('setInputFiles')
    expect(sif).toHaveLength(1)
    expect(sif[0].files).toEqual(['/tmp/a.jpg', '/tmp/b.jpg'])
    // 小红书话题是 dropdown 模式：输入#词后点联想项
    expect(d.byOp('type').some((a) => a.text.includes('#校园'))).toBe(true)
    expect(d.byOp('click').some((a) => a.selector.includes('creator-editor-topic-container'))).toBe(true)
    expect(outcome.published).toBe(false)
  })
})

describe('视频号 视频 draft', () => {
  test('发布按钮是「发表」；话题 space 模式', async () => {
    const d = new FakeDriver({
      url: 'https://channels.weixin.qq.com/platform/post/create',
      visible: [
        'input[type=file]',
        '.delete-btn',
        'input[placeholder*="概括视频主要内容"]',
        '.input-editor[contenteditable]',
      ],
    })
    const outcome = await getUploader('weixin_channels').publish(
      d,
      videoJob('weixin_channels', { limits: { titleMax: 16, bodyMax: 1000 } }),
      { mode: 'publish', assets: VIDEO_FILES },
    )
    const clicks = d.byOp('clickByRole')
    expect(clicks[0]).toMatchObject({ role: 'button', name: '发表' })
    // space 模式：话题用 press(Space) 而非点 dropdown
    expect(d.byOp('press').some((a) => a.key === 'Space')).toBe(true)
    expect(outcome.published).toBe(true)
  })
})

describe('选择器缺失', () => {
  test('找不到 file input → SelectorNotFoundError', async () => {
    // 不配置任何可见选择器：file input count=0
    const d = new FakeDriver({ url: 'https://creator.douyin.com/creator-micro/content/upload' })
    await expect(
      getUploader('douyin').publish(d, videoJob('douyin'), { mode: 'draft', assets: VIDEO_FILES }),
    ).rejects.toBeInstanceOf(SelectorNotFoundError)
  })
})

describe('失败注入（非 happy-path）', () => {
  test('上传完成信号一直不出现（waitForVisible 超时）→ 发布抛错', async () => {
    const d = douyinReady({ throwOnWaitVisible: ['[class^="long-card"] div:has-text("重新上传")'] })
    await expect(
      getUploader('douyin').publish(d, videoJob('douyin'), { mode: 'draft', assets: VIDEO_FILES }),
    ).rejects.toThrow()
    // 既然卡在上传完成，绝不应已经点了发布
    expect(d.byOp('clickByRole')).toHaveLength(0)
  })

  test('publish 模式但始终不跳成功页（waitForURL 失败）→ 抛错', async () => {
    // 用小红书：无 afterUploadUrl，唯一的 waitForURL 就是发布成功跳转，能精准命中该分支
    const d = new FakeDriver({
      url: 'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image',
      visible: [
        'input[type="file"][accept*="image" i]',
        'text=上传成功',
        'input[placeholder*="填写标题"]',
        'p[data-placeholder*="输入正文描述"]',
        '#creator-editor-topic-container .item',
      ],
      failWaitForURL: true,
    })
    await expect(
      getUploader('xiaohongshu').publish(d, imageJob('xiaohongshu'), { mode: 'publish', assets: IMAGE_FILES }),
    ).rejects.toThrow()
  })

  test('非 fill-only 但无素材 → 硬失败（不发空内容）', async () => {
    const d = douyinReady()
    await expect(
      getUploader('douyin').publish(d, videoJob('douyin'), { mode: 'draft', assets: [] }),
    ).rejects.toThrow(/无可上传|素材/)
    expect(d.byOp('setInputFiles')).toHaveLength(0)
  })
})
