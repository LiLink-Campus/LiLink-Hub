// PageDriver —— uploader 与浏览器之间的最小抽象接口（依赖注入的关键）。
//
// uploader 只依赖这个接口，不直接 import playwright。这样：
// - 真实发布用 PlaywrightPageDriver（薄包装 playwright-core 的 Page），易评审。
// - 测试用 tests 里的 FakeDriver（记录动作序列 + 可编排 DOM 状态），无需浏览器即可
//   确定性断言 uploader 的「流程契约」（填了什么 / 传了哪些文件 / 默认是否点发布 / 未登录是否抛错）。
//
// 设计取舍：方法保持原始（goto/fill/click/type/press/waitFor...），把「按平台流程编排」
// 留给 uploader，把「真实 DOM 操作能力」留给 PlaywrightPageDriver（由 gated fixture 集成测试验证）。

import type { Page } from 'playwright-core'

export interface GotoOptions {
  timeout?: number
  waitUntil?: 'load' | 'domcontentloaded' | 'commit'
}

export interface WaitOptions {
  timeout?: number
}

// uploader 依赖的最小页面操作集合。所有 selector 为字符串（Playwright 选择器语法）。
export interface PageDriver {
  goto(url: string, opts?: GotoOptions): Promise<void>
  currentUrl(): string

  // 查询（即时，不等待）
  count(selector: string): Promise<number>
  isVisible(selector: string): Promise<boolean>
  textContent(selector: string): Promise<string | null>

  // 等待
  waitForVisible(selector: string, opts?: WaitOptions): Promise<void>
  waitForHidden(selector: string, opts?: WaitOptions): Promise<void>
  waitForURL(pattern: string | RegExp, opts?: WaitOptions): Promise<void>
  waitForTimeout(ms: number): Promise<void>

  // 动作（均作用于匹配的第一个元素）
  setInputFiles(selector: string, files: string[]): Promise<void>
  fill(selector: string, text: string): Promise<void>
  click(selector: string, opts?: WaitOptions): Promise<void>
  clickByRole(role: string, name: string, opts?: { exact?: boolean; timeout?: number }): Promise<void>
  focus(selector: string): Promise<void>

  // 键盘（作用于当前聚焦元素；用于 contenteditable 正文与话题输入）
  type(text: string, opts?: { delay?: number }): Promise<void>
  press(key: string): Promise<void>
}

// 真实实现：薄包装 playwright-core 的 Page。每个方法一一对应，不含业务编排。
export class PlaywrightPageDriver implements PageDriver {
  readonly page: Page
  private readonly defaultTimeout: number

  constructor(page: Page, opts: { defaultTimeout?: number } = {}) {
    this.page = page
    this.defaultTimeout = opts.defaultTimeout ?? 15_000
  }

  async goto(url: string, opts: GotoOptions = {}): Promise<void> {
    await this.page.goto(url, {
      timeout: opts.timeout ?? this.defaultTimeout,
      waitUntil: opts.waitUntil ?? 'domcontentloaded',
    })
  }

  currentUrl(): string {
    return this.page.url()
  }

  async count(selector: string): Promise<number> {
    return this.page.locator(selector).count()
  }

  async isVisible(selector: string): Promise<boolean> {
    return this.page.locator(selector).first().isVisible()
  }

  async textContent(selector: string): Promise<string | null> {
    return this.page.locator(selector).first().textContent()
  }

  async waitForVisible(selector: string, opts: WaitOptions = {}): Promise<void> {
    await this.page
      .locator(selector)
      .first()
      .waitFor({ state: 'visible', timeout: opts.timeout ?? this.defaultTimeout })
  }

  async waitForHidden(selector: string, opts: WaitOptions = {}): Promise<void> {
    await this.page
      .locator(selector)
      .first()
      .waitFor({ state: 'hidden', timeout: opts.timeout ?? this.defaultTimeout })
  }

  async waitForURL(pattern: string | RegExp, opts: WaitOptions = {}): Promise<void> {
    await this.page.waitForURL(pattern, { timeout: opts.timeout ?? this.defaultTimeout })
  }

  async waitForTimeout(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms)
  }

  async setInputFiles(selector: string, files: string[]): Promise<void> {
    await this.page.locator(selector).first().setInputFiles(files)
  }

  async fill(selector: string, text: string): Promise<void> {
    await this.page.locator(selector).first().fill(text)
  }

  async click(selector: string, opts: WaitOptions = {}): Promise<void> {
    await this.page.locator(selector).first().click({ timeout: opts.timeout ?? this.defaultTimeout })
  }

  async clickByRole(
    role: string,
    name: string,
    opts: { exact?: boolean; timeout?: number } = {},
  ): Promise<void> {
    await this.page
      // playwright 的 getByRole role 形参是 AriaRole 联合类型；这里对外用 string，内部收窄。
      .getByRole(role as Parameters<Page['getByRole']>[0], { name, exact: opts.exact })
      .first()
      .click({ timeout: opts.timeout ?? this.defaultTimeout })
  }

  async focus(selector: string): Promise<void> {
    await this.page.locator(selector).first().focus()
  }

  async type(text: string, opts: { delay?: number } = {}): Promise<void> {
    await this.page.keyboard.type(text, { delay: opts.delay })
  }

  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key)
  }
}
