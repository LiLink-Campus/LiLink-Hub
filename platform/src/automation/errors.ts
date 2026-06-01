// 浏览器自动化发布的可操作错误类型。
// 每个错误都带清晰中文 message，CLI/调用方可直接展示给运营并据类型决定下一步
// （重新扫码 / 修环境 / 人工接管）。

/** 登录态缺失或失效：需运营重新 `worker login --platform <p>` 扫码。 */
export class NeedsLoginError extends Error {
  readonly platform: string
  constructor(platform: string, detail?: string) {
    super(
      `「${platform}」未登录或登录态已失效，请先扫码登录：` +
        `npx tsx scripts/publish-worker.ts login --platform ${platform}` +
        (detail ? `（${detail}）` : ''),
    )
    this.name = 'NeedsLoginError'
    this.platform = platform
  }
}

/** 运行环境不满足（Chrome 不可用、目录不可写等）：需先修环境，跑 `worker doctor`。 */
export class PreflightError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PreflightError'
  }
}

/** 关键选择器在页面上找不到：多半是平台改版导致选择器漂移，需人工接管或更新 selectors。 */
export class SelectorNotFoundError extends Error {
  readonly step: string
  readonly selectors: string[]
  constructor(step: string, selectors: string[]) {
    super(
      `自动发布在「${step}」一步找不到目标元素（可能平台已改版）。` +
        `已尝试的定位：${selectors.join(' | ')}。` +
        `建议改用 --fill-only 半自动模式由人工完成该步，或更新 selectors。`,
    )
    this.name = 'SelectorNotFoundError'
    this.step = step
    this.selectors = selectors
  }
}

/** 素材下载/校验失败：presigned URL 过期或源不可达。 */
export class AssetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssetError'
  }
}
