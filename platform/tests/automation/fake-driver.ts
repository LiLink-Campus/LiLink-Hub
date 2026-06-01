// FakeDriver —— 测试用的 PageDriver 实现（测试基础设施，刻意放 tests/ 而非 src/，
// 避免把测试替身混进生产代码）。
//
// 它做两件事：
// 1. 把 uploader 对 driver 的每一次调用按序记录进 actions（供断言「流程契约」）。
// 2. 按测试预置的 state 回答查询（count/isVisible/textContent/currentUrl），
//    并允许 react 钩子在某动作后改变状态（模拟「上传完成后出现重新上传按钮」「点发布后跳转」）。
//
// 等待类方法（waitForVisible/Hidden/URL/Timeout）默认立即 resolve（我们验证的是
// 调用序列与选择器，而非真实计时）；需要模拟失败时用 failWaitForURL / throwOnWaitVisible。

import type { GotoOptions, PageDriver, WaitOptions } from '@/automation/driver'

export type FakeAction =
  | { op: 'goto'; url: string }
  | { op: 'count'; selector: string }
  | { op: 'isVisible'; selector: string }
  | { op: 'textContent'; selector: string }
  | { op: 'waitForVisible'; selector: string }
  | { op: 'waitForHidden'; selector: string }
  | { op: 'waitForURL'; pattern: string }
  | { op: 'waitForTimeout'; ms: number }
  | { op: 'setInputFiles'; selector: string; files: string[] }
  | { op: 'fill'; selector: string; text: string }
  | { op: 'click'; selector: string }
  | { op: 'clickByRole'; role: string; name: string; exact?: boolean }
  | { op: 'focus'; selector: string }
  | { op: 'type'; text: string }
  | { op: 'press'; key: string }

export interface FakeDriverConfig {
  /** 初始（及 goto 后）当前 URL。 */
  url?: string
  /** selector → 命中数量（firstPresent 用 count 选第一个存在的候选）。 */
  counts?: Record<string, number>
  /** 视为「可见且至少命中 1 个」的 selector 列表。 */
  visible?: string[]
  /** selector → textContent 返回值。 */
  text?: Record<string, string>
  /** 让 waitForURL 全部 reject（模拟未跳转 / 发布未成功）。 */
  failWaitForURL?: boolean
  /** 让指定 selector 的 waitForVisible reject（模拟上传卡住 / 元素始终不出现）。 */
  throwOnWaitVisible?: string[]
  /** 每个动作记录后触发，可改 driver 状态以模拟页面变化。 */
  react?: (action: FakeAction, driver: FakeDriver) => void
}

export class FakeDriver implements PageDriver {
  readonly actions: FakeAction[] = []
  url: string
  counts: Record<string, number>
  visible: Set<string>
  text: Record<string, string>
  private readonly cfg: FakeDriverConfig

  constructor(cfg: FakeDriverConfig = {}) {
    this.cfg = cfg
    this.url = cfg.url ?? 'about:blank'
    this.counts = { ...(cfg.counts ?? {}) }
    this.visible = new Set(cfg.visible ?? [])
    this.text = { ...(cfg.text ?? {}) }
  }

  private record(action: FakeAction): void {
    this.actions.push(action)
    this.cfg.react?.(action, this)
  }

  /** 测试断言助手：返回所有动作的 op 序列。 */
  ops(): string[] {
    return this.actions.map((a) => a.op)
  }

  /** 测试断言助手：按 op 过滤动作。 */
  byOp<T extends FakeAction['op']>(op: T): Extract<FakeAction, { op: T }>[] {
    return this.actions.filter((a) => a.op === op) as Extract<FakeAction, { op: T }>[]
  }

  private countOf(selector: string): number {
    if (selector in this.counts) return this.counts[selector]
    return this.visible.has(selector) ? 1 : 0
  }

  async goto(url: string, _opts?: GotoOptions): Promise<void> {
    this.record({ op: 'goto', url })
    this.url = url
  }

  currentUrl(): string {
    return this.url
  }

  async count(selector: string): Promise<number> {
    this.record({ op: 'count', selector })
    return this.countOf(selector)
  }

  async isVisible(selector: string): Promise<boolean> {
    this.record({ op: 'isVisible', selector })
    return this.visible.has(selector) || this.countOf(selector) > 0
  }

  async textContent(selector: string): Promise<string | null> {
    this.record({ op: 'textContent', selector })
    return this.text[selector] ?? null
  }

  async waitForVisible(selector: string, _opts?: WaitOptions): Promise<void> {
    this.record({ op: 'waitForVisible', selector })
    if (this.cfg.throwOnWaitVisible?.includes(selector)) {
      throw new Error(`FakeDriver: waitForVisible 超时（模拟）：${selector}`)
    }
  }

  async waitForHidden(selector: string, _opts?: WaitOptions): Promise<void> {
    this.record({ op: 'waitForHidden', selector })
  }

  async waitForURL(pattern: string | RegExp, _opts?: WaitOptions): Promise<void> {
    this.record({ op: 'waitForURL', pattern: String(pattern) })
    if (this.cfg.failWaitForURL) {
      throw new Error(`FakeDriver: waitForURL 超时（模拟）：${String(pattern)}`)
    }
  }

  async waitForTimeout(ms: number): Promise<void> {
    this.record({ op: 'waitForTimeout', ms })
  }

  async setInputFiles(selector: string, files: string[]): Promise<void> {
    this.record({ op: 'setInputFiles', selector, files })
  }

  async fill(selector: string, text: string): Promise<void> {
    this.record({ op: 'fill', selector, text })
  }

  async click(selector: string, _opts?: WaitOptions): Promise<void> {
    this.record({ op: 'click', selector })
  }

  async clickByRole(
    role: string,
    name: string,
    opts: { exact?: boolean; timeout?: number } = {},
  ): Promise<void> {
    this.record({ op: 'clickByRole', role, name, exact: opts.exact })
  }

  async focus(selector: string): Promise<void> {
    this.record({ op: 'focus', selector })
  }

  async type(text: string, _opts?: { delay?: number }): Promise<void> {
    this.record({ op: 'type', text })
  }

  async press(key: string): Promise<void> {
    this.record({ op: 'press', key })
  }
}
