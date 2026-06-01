import { describe, expect, test } from 'vitest'

import { buildBrowserJob } from '@/automation/job'
import type { SocialPublishPackage } from '@/renderers/social-package'

// 构造一个最小可用的 SocialPublishPackage（buildBrowserJob 的输入）。
function pkg(overrides: Partial<SocialPublishPackage> = {}): SocialPublishPackage {
  return {
    platform: 'xiaohongshu',
    platformLabel: '小红书',
    mode: 'image_note',
    publishUrl: 'https://creator.xiaohongshu.com/publish/publish?from=menu',
    title: '一个标题',
    caption: '正文\n\n#校园 #LiLink\n\nLiLink: https://lilink.top',
    hashtags: ['#校园', '#LiLink'],
    assets: [
      { role: 'image', id: 1, url: 'https://oss.example/a.jpg?sig=1', filename: 'a.jpg', mimeType: 'image/jpeg', alt: '图一' },
      { role: 'image', id: 2, url: 'https://oss.example/b.png?sig=2', filename: 'b.png' },
    ],
    checklist: ['打开发布入口'],
    warnings: [],
    ...overrides,
  }
}

describe('buildBrowserJob', () => {
  test('从发布包直接映射核心字段（不重渲染内容）', () => {
    const job = buildBrowserJob(pkg())
    expect(job.platform).toBe('xiaohongshu')
    expect(job.mode).toBe('image_note')
    expect(job.publishUrl).toBe('https://creator.xiaohongshu.com/publish/publish?from=menu')
    expect(job.title).toBe('一个标题')
    expect(job.caption).toBe('正文\n\n#校园 #LiLink\n\nLiLink: https://lilink.top')
    expect(job.hashtags).toEqual(['#校园', '#LiLink'])
  })

  test('assets 收窄为 {role,url,filename}，丢弃 id/mimeType/alt', () => {
    const job = buildBrowserJob(pkg())
    expect(job.assets).toEqual([
      { role: 'image', url: 'https://oss.example/a.jpg?sig=1', filename: 'a.jpg' },
      { role: 'image', url: 'https://oss.example/b.png?sig=2', filename: 'b.png' },
    ])
  })

  test('limits 从 registry 按平台带出（小红书 20/1000/10）', () => {
    const job = buildBrowserJob(pkg({ platform: 'xiaohongshu', platformLabel: '小红书' }))
    expect(job.limits).toEqual({ titleMax: 20, bodyMax: 1000, tagsMax: 10 })
  })

  test('抖音 limits 30/1000/10、视频号 limits 16/1000', () => {
    const douyin = buildBrowserJob(
      pkg({ platform: 'douyin', platformLabel: '抖音', mode: 'video', publishUrl: 'https://creator.douyin.com/' }),
    )
    expect(douyin.limits).toEqual({ titleMax: 30, bodyMax: 1000, tagsMax: 10 })

    const channels = buildBrowserJob(
      pkg({ platform: 'weixin_channels', platformLabel: '视频号', mode: 'video', publishUrl: 'https://channels.weixin.qq.com/' }),
    )
    expect(channels.limits.titleMax).toBe(16)
    expect(channels.limits.bodyMax).toBe(1000)
    expect(channels.limits.tagsMax).toBeUndefined()
  })

  test('contentId 由 opts 注入（发布包本身不含）', () => {
    expect(buildBrowserJob(pkg(), { contentId: '42' }).contentId).toBe('42')
    expect(buildBrowserJob(pkg()).contentId).toBeUndefined()
  })

  test('缺 url 的素材保留（filename-only），不抛错', () => {
    const job = buildBrowserJob(
      pkg({ assets: [{ role: 'video', filename: 'v.mp4' }] }),
    )
    expect(job.assets).toEqual([{ role: 'video', url: undefined, filename: 'v.mp4' }])
  })
})
