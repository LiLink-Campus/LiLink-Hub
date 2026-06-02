import { describe, expect, it } from 'vitest'

import {
  PLATFORM_SPECS,
  publishUrlFor,
  isManualPlatform,
  modeForPlatform,
} from '../src/platforms/registry'
import { buildSocialPackage } from '../src/renderers/social-package'
import { ManualPublisher } from '../src/publishers/manual'

function media(url: string, mimeType = 'image/png') {
  return {
    id: url,
    url,
    filename: url.split('/').pop(),
    mimeType,
    alt: '素材',
  }
}

describe('platform registry', () => {
  it('登记视频号、小红书、抖音的发布入口和人工发布策略', () => {
    expect(PLATFORM_SPECS.weixin_channels.automation).toBe('manual_browser')
    expect(PLATFORM_SPECS.xiaohongshu.modes).toContain('image_note')
    expect(PLATFORM_SPECS.douyin.defaultMode).toBe('video')
    expect(publishUrlFor('xiaohongshu', 'video')).toContain('target=video')
  })
})

describe('buildSocialPackage', () => {
  it('把小红书图文渠道稿渲染成可人工发布的标题、正文、标签、资产和清单', () => {
    const pkg = buildSocialPackage({
      platform: 'xiaohongshu',
      contentMode: 'image_note',
      socialTitle: 'LiLink 本周相遇指南',
      socialDescription: '这周想重新练习一次自然的相遇。',
      socialTags: [{ tag: 'LiLink攻略' }, { tag: '#校园生活' }],
      socialImages: [media('https://cdn.lilink.top/a.png')],
      sourceUrl: 'https://lilink.top',
      post: { title: '选题', tags: [{ tag: '校园社交' }] },
    })

    expect(pkg.platform).toBe('xiaohongshu')
    expect(pkg.mode).toBe('image_note')
    expect(pkg.publishUrl).toContain('creator.xiaohongshu.com')
    expect(pkg.title).toBe('LiLink 本周相遇指南')
    expect(pkg.caption).toContain('这周想重新练习一次自然的相遇。')
    expect(pkg.hashtags).toContain('#LiLink攻略')
    expect(pkg.hashtags).toContain('#校园生活')
    expect(pkg.assets).toEqual([
      expect.objectContaining({ role: 'image', url: 'https://cdn.lilink.top/a.png' }),
    ])
    expect(pkg.checklist.join('\n')).toContain('人工点击发布')
    expect(pkg.warnings).toEqual([])
  })

  it('按平台标题长度截断并给出 warning', () => {
    const pkg = buildSocialPackage({
      platform: 'douyin',
      contentMode: 'video',
      socialTitle: '这是一个明显超过抖音三十字限制的超长标题需要被安全截断请继续压缩',
      socialDescription: '短视频描述',
      videoFile: media('https://cdn.lilink.top/v.mp4', 'video/mp4'),
    })

    expect(pkg.title.length).toBeLessThanOrEqual(30)
    expect(pkg.warnings.some((w) => w.message.includes('标题 超过 30 字'))).toBe(true)
  })

  it('缺少必需素材时给出 error，供人工发布器阻断', () => {
    const pkg = buildSocialPackage({
      platform: 'weixin_channels',
      contentMode: 'video',
      socialTitle: '视频号视频',
      socialDescription: '缺少视频文件',
    })

    expect(pkg.warnings).toContainEqual(
      expect.objectContaining({ level: 'error', message: expect.stringContaining('缺少视频素材') }),
    )
  })
})

describe('ManualPublisher', () => {
  it('为人工平台返回 manual_ready，并要求状态流转到 ready_to_publish', async () => {
    const result = await new ManualPublisher('xiaohongshu').publish({
      channelContent: {
        platform: 'xiaohongshu',
        contentMode: 'image_note',
        socialTitle: 'LiLink 小红书笔记',
        socialDescription: '正文',
        socialImages: [media('https://cdn.lilink.top/xhs.png')],
      },
    })

    expect(result.stage).toBe('manual_ready')
    expect(result.statusAfterPublish).toBe('ready_to_publish')
    expect(result.manualPackage?.platform).toBe('xiaohongshu')
  })

  it('缺少必需素材时抛错，不生成可发布结果', async () => {
    await expect(
      new ManualPublisher('douyin').publish({
        channelContent: {
          platform: 'douyin',
          contentMode: 'video',
          socialTitle: '缺少视频',
        },
      }),
    ).rejects.toThrow(/缺少视频素材/)
  })

  it('发布器声明平台与稿件 platform 不一致时抛错（防错配）', async () => {
    await expect(
      new ManualPublisher('xiaohongshu').publish({
        channelContent: {
          platform: 'douyin',
          contentMode: 'video',
          socialTitle: '错配',
          videoFile: media('https://cdn.lilink.top/v.mp4', 'video/mp4'),
        },
      }),
    ).rejects.toThrow(/平台不匹配/)
  })
})

describe('platform registry —— 兜底与判定', () => {
  it('isManualPlatform 只认 视频号/小红书/抖音；wechat/x/bilibili/未知/缺失都不是', () => {
    expect(isManualPlatform('weixin_channels')).toBe(true)
    expect(isManualPlatform('xiaohongshu')).toBe(true)
    expect(isManualPlatform('douyin')).toBe(true)
    expect(isManualPlatform('wechat')).toBe(false)
    expect(isManualPlatform('x')).toBe(false)
    expect(isManualPlatform('bilibili')).toBe(false)
    expect(isManualPlatform('nope')).toBe(false)
    expect(isManualPlatform(undefined)).toBe(false)
  })

  it('modeForPlatform：合法 mode 原样返回，非法/缺失回退到平台 defaultMode', () => {
    expect(modeForPlatform('xiaohongshu', 'video')).toBe('video')
    expect(modeForPlatform('xiaohongshu', 'image_note')).toBe('image_note')
    expect(modeForPlatform('xiaohongshu', 'bogus')).toBe('image_note') // 非法 → 小红书 defaultMode
    expect(modeForPlatform('xiaohongshu', undefined)).toBe('image_note')
    expect(modeForPlatform('douyin', undefined)).toBe('video') // 抖音 defaultMode=video
  })

  it('publishUrlFor：已登记模式给出入口 URL，未登记模式返回空串', () => {
    expect(publishUrlFor('weixin_channels', 'video')).toContain('channels.weixin.qq.com')
    expect(publishUrlFor('weixin_channels', 'article')).toBe('') // 视频号没有 article 入口
    expect(publishUrlFor('x', 'article')).toBe('') // x 是预留平台，publishUrls 为空
  })
})

describe('buildSocialPackage —— 话题 / 正文 / 素材 / 回退链边界', () => {
  it('话题去重 + 归一：去 # 前缀、去内部空白、跨来源去重，并补 LiLink/校园社交（已有不重复）', () => {
    const pkg = buildSocialPackage({
      platform: 'xiaohongshu',
      contentMode: 'image_note',
      socialTitle: 't',
      socialDescription: 'd',
      socialTags: [{ tag: '#校园生活' }, { tag: '校园生活' }, { tag: '校园 社交' }, { tag: 'LiLink' }],
      socialImages: [media('https://cdn.lilink.top/a.png')],
      post: { tags: [{ tag: '校园社交' }] },
    })
    // '#校园生活' 与 '校园生活' 归一后相同 → 只留一个
    expect(pkg.hashtags.filter((t) => t === '#校园生活')).toHaveLength(1)
    // '校园 社交' 去空白 == '校园社交'，与 post.tags 及默认 '校园社交' 去重 → 只一个
    expect(pkg.hashtags.filter((t) => t === '#校园社交')).toHaveLength(1)
    // 用户已带 LiLink，默认补的 LiLink 不重复
    expect(pkg.hashtags.filter((t) => t === '#LiLink')).toHaveLength(1)
    // 全部带 # 前缀
    expect(pkg.hashtags.every((t) => t.startsWith('#'))).toBe(true)
  })

  it('话题数量超过平台 tagsMax 时截断（小红书 10）', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ tag: `话题${i}` }))
    const pkg = buildSocialPackage({
      platform: 'xiaohongshu',
      contentMode: 'image_note',
      socialTitle: 't',
      socialDescription: 'd',
      socialTags: many,
      socialImages: [media('https://cdn.lilink.top/a.png')],
    })
    expect(pkg.hashtags).toHaveLength(10) // 15 + 默认 2 = 17 唯一，截断到 tagsMax=10
  })

  it('正文超过平台 bodyMax 时截断并给出 warning（小红书 1000 字）', () => {
    const long = 'あ'.repeat(1001)
    const pkg = buildSocialPackage({
      platform: 'xiaohongshu',
      contentMode: 'image_note',
      socialTitle: 't',
      socialDescription: long,
      socialImages: [media('https://cdn.lilink.top/a.png')],
    })
    expect(pkg.warnings.some((w) => w.message.includes('正文 超过 1000 字'))).toBe(true)
    expect(pkg.caption.startsWith('あ'.repeat(1000))).toBe(true)
    expect(pkg.caption.includes('あ'.repeat(1001))).toBe(false)
  })

  it('素材关系未展开为可访问 URL 时给 warning（非 error，仍允许人工补）', () => {
    const pkg = buildSocialPackage({
      platform: 'xiaohongshu',
      contentMode: 'image_note',
      socialTitle: 't',
      socialDescription: 'd',
      socialImages: [{ id: 'img-1' }], // 只有 id、未 populate 出 url
    })
    expect(pkg.assets).toEqual([expect.objectContaining({ role: 'image', id: 'img-1' })])
    expect(pkg.assets[0].url).toBeUndefined()
    expect(pkg.warnings.some((w) => w.level === 'error')).toBe(false)
    expect(pkg.warnings.some((w) => w.message.includes('尚未展开为可访问 URL'))).toBe(true)
  })

  it('多素材角色按 图片→视频→横封面→竖封面 顺序汇总，且数组按选择顺序', () => {
    const pkg = buildSocialPackage({
      platform: 'douyin',
      contentMode: 'video',
      socialTitle: 't',
      socialDescription: 'd',
      socialImages: [media('https://cdn/a.png'), media('https://cdn/b.png')],
      videoFile: media('https://cdn/v.mp4', 'video/mp4'),
      horizontalCover: media('https://cdn/h.png'),
      verticalCover: media('https://cdn/vc.png'),
    })
    expect(pkg.assets.map((a) => a.role)).toEqual([
      'image',
      'image',
      'video',
      'horizontal_cover',
      'vertical_cover',
    ])
    expect(pkg.assets.map((a) => a.url)).toEqual([
      'https://cdn/a.png',
      'https://cdn/b.png',
      'https://cdn/v.mp4',
      'https://cdn/h.png',
      'https://cdn/vc.png',
    ])
  })

  it('标题回退链：socialTitle → wxTitle → post.title → 平台名', () => {
    const base = {
      platform: 'xiaohongshu',
      contentMode: 'image_note',
      socialDescription: 'd',
      socialImages: [media('https://cdn/a.png')],
    }
    expect(buildSocialPackage({ ...base, socialTitle: 'A', wxTitle: 'B', post: { title: 'C' } }).title).toBe('A')
    expect(buildSocialPackage({ ...base, wxTitle: 'B', post: { title: 'C' } }).title).toBe('B')
    expect(buildSocialPackage({ ...base, post: { title: 'C' } }).title).toBe('C')
    expect(buildSocialPackage({ ...base }).title).toBe('小红书') // spec.label 兜底
  })

  it('正文回退链：socialDescription → wxDigest → excerpt', () => {
    const base = {
      platform: 'xiaohongshu',
      contentMode: 'image_note',
      socialTitle: 't',
      socialImages: [media('https://cdn/a.png')],
    }
    expect(buildSocialPackage({ ...base, socialDescription: 'D', wxDigest: 'G', excerpt: 'E' }).caption.startsWith('D')).toBe(true)
    expect(buildSocialPackage({ ...base, wxDigest: 'G', excerpt: 'E' }).caption.startsWith('G')).toBe(true)
    expect(buildSocialPackage({ ...base, excerpt: 'E' }).caption.startsWith('E')).toBe(true)
  })

  it('caption 拼接：正文(无#) + 缺失话题(空格分隔) + LiLink 链接行（用 sourceUrl）', () => {
    const pkg = buildSocialPackage({
      platform: 'xiaohongshu',
      contentMode: 'image_note',
      socialTitle: 't',
      socialDescription: '正文内容',
      socialTags: [{ tag: 'A' }, { tag: 'B' }],
      socialImages: [media('https://cdn/a.png')],
      sourceUrl: 'https://lilink.top/x',
    })
    expect(pkg.caption).toContain('正文内容')
    expect(pkg.caption).toContain('#A #B') // 正文无#，话题作为补充行以空格分隔
    expect(pkg.caption).toContain('LiLink: https://lilink.top/x')
  })

  it('正文为准：正文已含 #话题 时 caption 不重复拼接，仅补缺失的固定话题', () => {
    const pkg = buildSocialPackage({
      platform: 'xiaohongshu',
      contentMode: 'image_note',
      socialTitle: '标题',
      socialDescription: '正文很棒 #校园社交 #LiLink',
      socialImages: [{ id: 1, url: 'https://x/1.jpg' }],
    })
    // #校园社交 / #LiLink 已在正文里出现一次，不应再被补成额外话题行而重复
    expect(pkg.caption.match(/#校园社交/g)?.length).toBe(1)
    expect(pkg.caption.match(/#LiLink/g)?.length).toBe(1)
    // 正文里的 #话题 也镜像进 hashtags
    expect(pkg.hashtags).toContain('#校园社交')
    expect(pkg.hashtags).toContain('#LiLink')
  })

  it('向后兼容：旧稿正文无# 时仍把 socialTags 补成话题行', () => {
    const pkg = buildSocialPackage({
      platform: 'xiaohongshu',
      contentMode: 'image_note',
      socialTitle: '标题',
      socialDescription: '纯文案没有标签',
      socialTags: [{ tag: '校园社交' }],
      socialImages: [{ id: 1, url: 'https://x/1.jpg' }],
    })
    expect(pkg.caption).toContain('#校园社交')
  })

  it('非人工平台（wechat / x / 未知 / 缺失）抛错，不生成发布包', () => {
    expect(() => buildSocialPackage({ platform: 'wechat' })).toThrow(/暂不支持/)
    expect(() => buildSocialPackage({ platform: 'x' })).toThrow(/暂不支持/)
    expect(() => buildSocialPackage({ platform: 'nope' })).toThrow(/暂不支持/)
    expect(() => buildSocialPackage(null)).toThrow(/暂不支持/)
  })

  it('relationship 已展开为对象时保留 url/filename/mimeType/alt', () => {
    const pkg = buildSocialPackage({
      platform: 'xiaohongshu',
      contentMode: 'image_note',
      socialTitle: 't',
      socialDescription: 'd',
      socialImages: [
        { id: 'm1', url: 'https://cdn/a.png', filename: 'a.png', mimeType: 'image/png', alt: '配图' },
      ],
    })
    expect(pkg.assets[0]).toEqual({
      role: 'image',
      id: 'm1',
      url: 'https://cdn/a.png',
      filename: 'a.png',
      mimeType: 'image/png',
      alt: '配图',
    })
  })
})
