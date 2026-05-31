// studio-editor-body.test.ts —— 长文 markdown 源 → 公众号渲染的端到端契约测试。
//
// 创作页改为「写 markdown」后，保存进 body 的链路是：markdown 源 → markdownToBody → body(Lexical) →
// 发布/预览用 renderToInlineHtml 渲染成公众号全内联 HTML。本测试喂一段覆盖
// 标题/段落/粗体/行内码/链接/列表/引用/分隔线/图片 的 markdown，断言产物满足公众号格式硬规范。

import { describe, expect, it } from 'vitest'

import { renderToInlineHtml } from '@/renderers/lexical-to-wechat'
import { ROSE } from '@/lib/wechat-theme'
import { markdownToBody } from '../src/app/(app)/studio/compose/article/[id]/markdown-to-body'

// 覆盖各元素的 markdown 样本（图片用直链形式，便于断言渲染出 <figure>；media:ID 形式单独测结构）。
const SAMPLE = [
  '## 一、如何开始',
  '',
  '### 第一步 准备账号',
  '',
  '这是正文，**重点** 与 `code` 与 [外链](https://lilink.top)。',
  '',
  '- 无序项一',
  '- 无序项二',
  '',
  '1. 有序项一',
  '',
  '> 建议：先看完再动手。',
  '',
  '---',
  '',
  '![一张说明配图](https://mmbiz.qpic.cn/x.png)',
  '',
  '[点我](javascript:alert(1))',
].join('\n')

describe('studio 长文：markdownToBody → renderToInlineHtml 契约', () => {
  const body = markdownToBody(SAMPLE)
  const html = renderToInlineHtml(body, { ctaUrl: 'https://lilink.top', ctaText: '去 LiLink 看看 →' })

  // ---- 黑名单：绝不出现 ----
  it('不含 <style> 标签', () => expect(html).not.toContain('<style'))
  it('不含 class= 属性', () => expect(html).not.toContain('class='))
  it('不含 <div', () => expect(html).not.toContain('<div'))
  it('不含 list-style（符号靠文本前缀）', () => expect(html).not.toContain('list-style'))
  it('不含 var() / calc()', () => {
    expect(html).not.toContain('var(')
    expect(html).not.toContain('calc(')
  })

  // ---- 白名单：必须出现 ----
  it('含块容器 <section 与段落 <p', () => {
    expect(html).toContain('<section')
    expect(html).toContain('<p')
  })
  it('无序列表项含「• 」前缀', () => {
    expect(html).toContain('• 无序项一')
    expect(html).toContain('• 无序项二')
  })
  it('有序列表项含「1. 」前缀', () => expect(html).toContain('1. 有序项一'))
  it('章节标题 ## 前缀「一、」染玫瑰', () => {
    expect(html).toContain(`<span style="color:${ROSE}">一、</span>`)
  })
  it('步骤标题 ### 前缀「第一步」染玫瑰', () => {
    expect(html).toContain(`<span style="color:${ROSE}">第一步</span>`)
  })
  it('**加粗** → 内联 <strong>，`码` → <code>', () => {
    expect(html).toContain('<strong')
    expect(html).toContain('重点')
    expect(html).toContain('<code')
    expect(html).toContain('code')
  })
  it('[文本](链接) → 可点 <a href>', () => {
    expect(html).toContain('<a href="https://lilink.top"')
  })
  it('> 引用 → 提示卡（blockquote + 玫瑰左线）', () => {
    expect(html).toContain('<blockquote')
    expect(html).toContain(`border-left:2px solid ${ROSE}`)
  })
  it('--- → 分隔线 <hr', () => expect(html).toContain('<hr'))
  it('直链图片 → <figure> + <img> + 题注', () => {
    expect(html).toContain('<figure')
    expect(html).toContain('<img')
    expect(html).toContain('src="https://mmbiz.qpic.cn/x.png"')
    expect(html).toContain('一张说明配图')
  })

  // ---- 安全：javascript: 链接降级为 # ----
  it('href 白名单：javascript: → #（防 XSS）', () => {
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="#"')
  })
})

describe('markdownToBody 结构', () => {
  it('![alt](media:ID) → upload 节点 value=媒体 id(number) + fields.alt', () => {
    const body = markdownToBody('![封面图](media:16)') as unknown as {
      root: { children: Array<Record<string, unknown>> }
    }
    const upload = body.root.children.find((n) => n.type === 'upload') as Record<string, unknown>
    expect(upload).toBeTruthy()
    expect(upload.value).toBe(16)
    expect((upload.fields as { alt: string }).alt).toBe('封面图')
  })

  it('![alt](42) 裸数字也识别为媒体 id', () => {
    const body = markdownToBody('![x](42)') as unknown as {
      root: { children: Array<Record<string, unknown>> }
    }
    const upload = body.root.children.find((n) => n.type === 'upload') as Record<string, unknown>
    expect(upload.value).toBe(42)
  })

  it('空 / null markdown → 合法空 root，renderToInlineHtml 不崩、不含 <div', () => {
    const emptyHtml = renderToInlineHtml(markdownToBody(''), { noCta: true })
    expect(emptyHtml).toContain('<section')
    expect(emptyHtml).not.toContain('<div')
  })
})
