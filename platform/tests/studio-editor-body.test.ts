// studio-editor-body.test.ts —— 长文编辑器导出 → 公众号渲染的端到端契约测试。
//
// 验证创作页编辑器的导出适配层 toPayloadBody（src/app/(app)/studio/compose/article/[id]/
// to-payload-body.ts）：把「@lexical 原生导出形状」转成渲染器 renderToInlineHtml 能消费的
// Payload 形状后，产出的公众号 HTML 必须满足格式兼容硬规范。
//
// 构造一份覆盖 标题/段落/粗体/列表/引用/链接/图片 的「编辑器导出态」喂给 toPayloadBody，
// 再喂 renderToInlineHtml，断言：
//   黑名单不出现：<style | class= | <div | list-style | var( | calc(
//   白名单必出现：<section、<p、'• '（无序前缀）、<figure、玫瑰前缀 span、href 白名单
//                （javascript: 降级为 #）。

import { describe, expect, it } from 'vitest'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'

import { renderToInlineHtml } from '@/renderers/lexical-to-wechat'
import { ROSE } from '@/lib/wechat-theme'
import { toPayloadBody } from '../src/app/(app)/studio/compose/article/[id]/to-payload-body'

// 文本叶子工厂（format 位掩码：1=bold,2=italic,16=code）。
const text = (t: string, format = 0) => ({
  type: 'text',
  text: t,
  format,
  detail: 0,
  mode: 'normal',
  style: '',
  version: 1,
})

/**
 * 构造「编辑器导出态」（即 editor.getEditorState().toJSON() 的等价形状）：
 *  - 链接用 @lexical/link 原生形状（顶层 url + target，无 fields）——证明 toPayloadBody 会转成 Payload 形状。
 *  - 图片用自定义 ImageNode.exportJSON 的形状（upload + value + fields.alt），其中 value 用
 *    「已 populate 的 media 文档对象」模拟发布/预览读库（depth:2）后的样子——渲染器据此出 <figure><img>。
 *  - 另含一个 javascript: 链接，验证 href 白名单降级为 #。
 */
function buildEditorExport(): SerializedEditorState {
  return {
    root: {
      type: 'root',
      direction: 'ltr',
      format: '',
      indent: 0,
      version: 1,
      children: [
        // 章节标题（h2），前缀「一、」应被渲染器染玫瑰
        {
          type: 'heading',
          tag: 'h2',
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1,
          children: [text('一、如何开始')],
        },
        // 步骤标题（h3）
        {
          type: 'heading',
          tag: 'h3',
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1,
          children: [text('第一步 准备账号')],
        },
        // 段落：普通 + 加粗 + 行内码 + 原生链接（新标签）
        {
          type: 'paragraph',
          direction: 'ltr',
          format: '',
          indent: 0,
          textFormat: 0,
          version: 1,
          children: [
            text('这是正文，'),
            text('重点', 1),
            text(' 与 '),
            text('code', 16),
            // @lexical/link 原生导出形状：url 在顶层、用 target，无 fields/linkType。
            {
              type: 'link',
              direction: 'ltr',
              format: '',
              indent: 0,
              version: 1,
              url: 'https://lilink.top',
              target: '_blank',
              rel: 'noopener noreferrer',
              title: null,
              children: [text('外链')],
            },
          ],
        },
        // 无序列表
        {
          type: 'list',
          tag: 'ul',
          listType: 'bullet',
          start: 1,
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1,
          children: [
            {
              type: 'listitem',
              value: 1,
              direction: 'ltr',
              format: '',
              indent: 0,
              version: 1,
              children: [text('无序项一')],
            },
            {
              type: 'listitem',
              value: 2,
              direction: 'ltr',
              format: '',
              indent: 0,
              version: 1,
              children: [text('无序项二')],
            },
          ],
        },
        // 有序列表
        {
          type: 'list',
          tag: 'ol',
          listType: 'number',
          start: 1,
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1,
          children: [
            {
              type: 'listitem',
              value: 1,
              direction: 'ltr',
              format: '',
              indent: 0,
              version: 1,
              children: [text('有序项一')],
            },
          ],
        },
        // 引用 → 提示卡
        {
          type: 'quote',
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1,
          children: [text('建议：先看完再动手。')],
        },
        // 图片（ImageNode.exportJSON 形状；value 为 populate 后的 media 文档，真实 alt → 配题注）
        {
          type: 'upload',
          relationTo: 'media',
          version: 1,
          url: 'https://mmbiz.qpic.cn/x.png',
          fields: { alt: '一张说明配图' },
          value: {
            id: 'm1',
            url: 'https://mmbiz.qpic.cn/x.png',
            alt: '一张说明配图',
            width: 900,
            height: 600,
            mimeType: 'image/png',
            filename: 'x.png',
          },
        },
        // 含 javascript: 伪协议的链接（原生形状）——应被渲染器降级为 #
        {
          type: 'paragraph',
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1,
          children: [
            {
              type: 'link',
              direction: 'ltr',
              format: '',
              indent: 0,
              version: 1,
              url: 'javascript:alert(1)',
              target: null,
              rel: null,
              title: null,
              children: [text('点我')],
            },
          ],
        },
      ],
    },
  } as unknown as SerializedEditorState
}

describe('studio 长文编辑器：toPayloadBody → renderToInlineHtml 契约', () => {
  // 先经适配层转换，再渲染——模拟创作页保存进 body 的真实链路。
  const body = toPayloadBody(buildEditorExport())
  const html = renderToInlineHtml(body, {
    ctaUrl: 'https://lilink.top',
    ctaText: '去 LiLink 看看 →',
  })

  // ---- toPayloadBody 关键转换：原生 link → Payload fields 形状 ----
  it('原生 link 节点被转成 Payload 形状（fields.url / linkType:custom / newTab）', () => {
    // 深取转换后的第一个 link 节点。
    const root = (body as unknown as { root: { children: any[] } }).root
    const para = root.children.find(
      (n) => n.type === 'paragraph' && Array.isArray(n.children) && n.children.some((c: any) => c.type === 'link'),
    )
    const link = para.children.find((c: any) => c.type === 'link')
    expect(link.fields).toBeTruthy()
    expect(link.fields.url).toBe('https://lilink.top')
    expect(link.fields.linkType).toBe('custom')
    expect(link.fields.newTab).toBe(true)
    // 不应残留原生顶层 url 字段（已规整进 fields）。
    expect(link.url).toBeUndefined()
  })

  // ---- 黑名单：绝不出现 ----
  it('不含 <style> 标签', () => {
    expect(html).not.toContain('<style')
  })
  it('不含 class= 属性', () => {
    expect(html).not.toContain('class=')
  })
  it('不含 <div', () => {
    expect(html).not.toContain('<div')
  })
  it('不含 list-style（符号靠文本前缀）', () => {
    expect(html).not.toContain('list-style')
  })
  it('不含 var() / calc()（已求成字面值）', () => {
    expect(html).not.toContain('var(')
    expect(html).not.toContain('calc(')
  })

  // ---- 白名单：必须出现 ----
  it('含块容器 <section', () => {
    expect(html).toContain('<section')
  })
  it('含段落 <p', () => {
    expect(html).toContain('<p')
  })
  it('无序列表项含「• 」文本前缀', () => {
    expect(html).toContain('• 无序项一')
  })
  it('有序列表项含递增「1. 」文本前缀', () => {
    expect(html).toContain('1. 有序项一')
  })
  it('图片渲染成 <figure>（含 <img> 与题注）', () => {
    expect(html).toContain('<figure')
    expect(html).toContain('<img')
    expect(html).toContain('一张说明配图')
  })
  it('章节标题前缀染玫瑰（ROSE 色 span 包裹「一、」）', () => {
    expect(html).toContain(`<span style="color:${ROSE}">一、</span>`)
  })
  it('步骤标题前缀染玫瑰（「第一步」）', () => {
    expect(html).toContain(`<span style="color:${ROSE}">第一步</span>`)
  })
  it('加粗 / 行内码内联，外链转成可点 <a>', () => {
    expect(html).toContain('重点')
    expect(html).toContain('code')
    expect(html).toContain('<a href="https://lilink.top"')
  })
  it('引用渲染成提示卡（blockquote 玫瑰左线）', () => {
    expect(html).toContain('<blockquote')
    expect(html).toContain(`border-left:2px solid ${ROSE}`)
  })

  // ---- 安全：javascript: 链接经白名单降级为 # ----
  it('href 白名单：javascript: 链接降级为 #（防 XSS）', () => {
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="#"')
  })

  // ---- 空文档：安全降级 ----
  it('空 / null 编辑器状态 → 安全空 root（renderToInlineHtml 不崩）', () => {
    const emptyBody = toPayloadBody(null)
    const emptyHtml = renderToInlineHtml(emptyBody, { noCta: true })
    expect(emptyHtml).toContain('<section')
    expect(emptyHtml).not.toContain('<div')
  })
})
