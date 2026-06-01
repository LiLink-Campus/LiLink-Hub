// uploader 注册表：platform → Uploader。调用方（run.ts）按 platform 取，不直接 new。

import { createUploader } from './base'
import { SELECTORS } from './selectors'
import type { Uploader } from './types'
import { MANUAL_PLATFORM_CODES, type ManualPlatformCode } from '../../platforms/registry'

export const uploaders: Record<ManualPlatformCode, Uploader> = {
  douyin: createUploader('douyin', SELECTORS.douyin),
  xiaohongshu: createUploader('xiaohongshu', SELECTORS.xiaohongshu),
  weixin_channels: createUploader('weixin_channels', SELECTORS.weixin_channels),
}

export function getUploader(platform: ManualPlatformCode): Uploader {
  return uploaders[platform]
}

export function isManualUploaderPlatform(value: unknown): value is ManualPlatformCode {
  return typeof value === 'string' && (MANUAL_PLATFORM_CODES as readonly string[]).includes(value)
}

export type { Uploader, PublishOpts, PublishOutcome, ResolvedAsset } from './types'
export { createUploader } from './base'
