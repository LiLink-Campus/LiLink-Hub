// studio/_lib/platforms.ts —— 内容形态 ↔ 平台 的前端映射助手。
//
// 把「面向运营的内容形态（form）」翻译成底层 channel-contents 的 platform / contentMode，
// 并提供长文平台与手动平台的可选列表（带 active 占位，便于 UI 标灰未上线平台）。
//
// 单一真源：平台 code / label 与 registry.ts（src/platforms/registry.ts）保持一致，
// 这里不引入 registry 的运行时逻辑（避免把发布器细节带进前端），只复用其 code/label 约定。

import type { ContentForm } from './types'

/** 内容形态默认落点（platform + 可选 contentMode）。 */
export interface PlatformDefault {
  platform: string
  contentMode?: 'image_note' | 'video'
}

/**
 * 由内容形态推默认平台：
 * - article（长文）   → 公众号（wechat），无 contentMode。
 * - imagetext（图文） → 小红书（xiaohongshu）+ image_note。
 * - video（视频）     → 抖音（douyin）+ video。
 *
 * createDraft 会按此默认值初始化新渠道稿（ChannelContents.platform / contentMode）。
 */
export function formToPlatformDefault(form: ContentForm): PlatformDefault {
  switch (form) {
    case 'article':
      return { platform: 'wechat' }
    case 'imagetext':
      return { platform: 'xiaohongshu', contentMode: 'image_note' }
    case 'video':
      return { platform: 'douyin', contentMode: 'video' }
    default:
      // 兜底（不应触达）：按文章处理。
      return { platform: 'wechat' }
  }
}

/** 长文平台选项（仅公众号 active，其余为占位/未上线）。 */
export interface LongformPlatformOption {
  code: string
  label: string
  active: boolean
}

/**
 * 长文（article）可选平台。第一期仅公众号可用：
 * 其余长文平台（X / 知乎等）先以 active:false 占位，UI 标灰提示「即将支持」。
 */
export const LONGFORM_PLATFORMS: LongformPlatformOption[] = [
  { code: 'wechat', label: '微信公众号', active: true },
  { code: 'x', label: 'X', active: false },
  { code: 'zhihu', label: '知乎', active: false },
]

/** 手动发布平台选项（图文 / 视频形态可选）。 */
export interface ManualChannelOption {
  code: string
  label: string
}

/**
 * 给定内容形态，返回可手动发布的渠道列表（图文 / 视频共用同一组手动平台：
 * 小红书 / 视频号 / 抖音）。article（长文）走官方 API，不在此列，返回空数组。
 *
 * 顺序按各形态的默认平台靠前：
 * - imagetext 默认小红书 → 小红书在前。
 * - video 默认抖音 → 抖音在前。
 */
export function manualChannelsFor(form: ContentForm): ManualChannelOption[] {
  const xiaohongshu: ManualChannelOption = { code: 'xiaohongshu', label: '小红书' }
  const weixinChannels: ManualChannelOption = { code: 'weixin_channels', label: '视频号' }
  const douyin: ManualChannelOption = { code: 'douyin', label: '抖音' }

  switch (form) {
    case 'imagetext':
      return [xiaohongshu, weixinChannels, douyin]
    case 'video':
      return [douyin, weixinChannels, xiaohongshu]
    case 'article':
    default:
      return []
  }
}

/**
 * 由底层 platform + contentMode 反推内容形态（列表展示 / 摘要归一用）。
 * - wechat / x / zhihu 等长文平台 → article。
 * - contentMode === 'video' → video。
 * - 其余手动平台默认 → imagetext。
 */
export function platformToForm(
  platform: string,
  contentMode?: string | null,
): ContentForm {
  if (platform === 'wechat' || platform === 'x' || platform === 'zhihu') {
    return 'article'
  }
  if (contentMode === 'video') return 'video'
  return 'imagetext'
}
