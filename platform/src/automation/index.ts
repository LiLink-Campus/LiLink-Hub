// 浏览器自动化发布引擎 —— 对外入口（barrel）。
// 消费 renderers/social-package 的 SocialPublishPackage 派生的 BrowserPublishJob，
// 用 playwright-core 驱动运营登录态浏览器，把视频号/小红书/抖音从「人工复制发布包」
// 升级为「自动填表/上传/默认存草稿」。详见 docs 设计文档。

export { buildBrowserJob, type BrowserPublishJob, type BrowserJobAsset } from './job'
export { runBrowserPublish, type RunOptions, type RunResult } from './run'
export { launchSession, clearSession, sessionDir, sessionRoot, type Session } from './session'
export { downloadAssets, type DownloadedAssets } from './assets'
export { getUploader, uploaders, isManualUploaderPlatform } from './uploaders'
export type { Uploader, PublishOpts, PublishOutcome, ResolvedAsset } from './uploaders/types'
export { PlaywrightPageDriver, type PageDriver } from './driver'
export { NeedsLoginError, PreflightError, SelectorNotFoundError, AssetError } from './errors'
