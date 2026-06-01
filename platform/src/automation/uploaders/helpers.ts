// uploader 共享小工具：候选选择器解析 + 文本截断。
// 全部只依赖 PageDriver，可被 FakeDriver 直接驱动测试。

import type { PageDriver } from '../driver'
import { SelectorNotFoundError } from '../errors'

/** 返回候选里第一个在页面上存在（count>0）的选择器；都不存在返回 null。 */
export async function firstPresent(
  driver: PageDriver,
  selectors: string[],
): Promise<string | null> {
  for (const selector of selectors) {
    if ((await driver.count(selector)) > 0) return selector
  }
  return null
}

/** 同 firstPresent，但都找不到时抛 SelectorNotFoundError（标注是哪一步、试过哪些）。 */
export async function requirePresent(
  driver: PageDriver,
  selectors: string[],
  step: string,
): Promise<string> {
  const found = await firstPresent(driver, selectors)
  if (!found) throw new SelectorNotFoundError(step, selectors)
  return found
}

/** 按平台上限截断标题；返回是否被截断（供调用方加 warning）。 */
export function truncateTitle(title: string, max: number): { value: string; truncated: boolean } {
  if (title.length <= max) return { value: title, truncated: false }
  return { value: title.slice(0, max), truncated: true }
}
