// to-payload-body.ts —— Lexical 编辑器状态 → Payload(公众号渲染器) 形状适配层。
//
// 【为什么要这层】渲染命脉 src/renderers/lexical-to-wechat.ts 期望的 Lexical JSON 是
// **Payload 富文本约定的形状**，与 @lexical/* 原生节点的 exportJSON 在两处不一致：
//   1. 链接：Payload 期望 `{type:'link', fields:{url, linkType:'custom', newTab}, children}`；
//      @lexical/link 的 LinkNode.exportJSON 产出的是 `{type:'link', url, target, rel, ...}`
//      （url 在顶层、用 target 而非 newTab、无 fields/linkType）——渲染器读不到 fields.url 会丢链接。
//   2. 图片：Payload 期望 `{type:'upload', relationTo:'media', value:<mediaId>, fields:{alt}}`
//      （渲染器 renderUpload 读 value=已 populate 的 media 文档取 url）。我们的自定义 ImageNode
//      直接按这个形状 exportJSON（见 ImageNode.tsx），故这里对其原样透传即可。
//
// 因此本模块把「编辑器导出的状态树」深度遍历，命中 link 节点就重写成 Payload 形状，
// 其余节点（heading/paragraph/list/listitem/quote/text/upload/linebreak…）原样保留——
// 它们的 exportJSON 形状已与渲染器一致（tag/listType/start/format 位掩码等都对得上）。
//
// 【纯函数 · 无 React/无 @lexical 运行时依赖】刻意独立成文件：既供 Editor.tsx（'use client'）
// 在 onChange 里调用，又供 tests/studio-editor-body.test.ts 在 node 环境直接 import 验证产物
// （不必加载 @lexical/react 这类需要 DOM 的客户端代码）。

import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'

/** 宽松节点形状：序列化节点字段是动态的，按「任意键」处理，便于读写各类字段。 */
type AnyNode = Record<string, unknown>

/**
 * 把任意（可能是 @lexical 原生导出的）节点递归转换成渲染器期望的 Payload 形状。
 * 目前只需重写 link / autolink 节点；其余节点结构一致，仅递归处理其 children。
 */
function convertNode(node: AnyNode): AnyNode {
  const type = typeof node.type === 'string' ? node.type : ''

  // 先递归处理 children（无论本节点类型，子树都要转）。
  const rawChildren = Array.isArray(node.children) ? (node.children as AnyNode[]) : null
  const children = rawChildren ? rawChildren.map(convertNode) : undefined

  // 链接节点：@lexical/link 原生形状 → Payload 形状。
  // 原生：{type:'link'|'autolink', url, target, rel, title, children, ...}
  // 目标：{type:'link', fields:{url, linkType:'custom', newTab}, children, ...}
  if (type === 'link' || type === 'autolink') {
    // 优先取已是 Payload 形状的 fields.url（容错：万一上游已转过），否则取原生顶层 url。
    const existingFields =
      node.fields && typeof node.fields === 'object' ? (node.fields as AnyNode) : null
    const url =
      (existingFields && typeof existingFields.url === 'string' && existingFields.url) ||
      (typeof node.url === 'string' ? node.url : '') ||
      ''
    // newTab：原生用 target==='_blank' 表示新标签；也兼容已有 fields.newTab。
    const newTab =
      (existingFields && typeof existingFields.newTab === 'boolean'
        ? existingFields.newTab
        : node.target === '_blank') || false

    return {
      type: 'link',
      version: typeof node.version === 'number' ? node.version : 1,
      // 保留方向/缩进/format 等结构性字段（若存在），不影响渲染但保持数据完整。
      ...(typeof node.direction !== 'undefined' ? { direction: node.direction } : {}),
      ...(typeof node.format !== 'undefined' ? { format: node.format } : {}),
      ...(typeof node.indent !== 'undefined' ? { indent: node.indent } : {}),
      fields: {
        url,
        linkType: 'custom',
        newTab,
      },
      ...(children ? { children } : {}),
    }
  }

  // 其余节点：原样保留所有字段，仅替换 children 为已转换版本。
  if (children) {
    return { ...node, children }
  }
  return { ...node }
}

/**
 * toPayloadBody —— 把编辑器导出的 SerializedEditorState 转成渲染器
 * （renderToInlineHtml）可直接消费的 Payload 形状 SerializedEditorState。
 *
 * 容错：传入 null/空/缺 root 时返回一个安全的空 root（渲染器对空 root 会产出空根 section）。
 *
 * @param state editor.getEditorState().toJSON() 的产物（或等价对象）。
 */
export function toPayloadBody(
  state: SerializedEditorState | null | undefined,
): SerializedEditorState {
  const stateObj = state as unknown as AnyNode | null | undefined
  const root =
    stateObj && typeof stateObj === 'object' && stateObj.root
      ? (stateObj.root as AnyNode)
      : null

  if (!root) {
    return {
      root: {
        type: 'root',
        direction: 'ltr',
        format: '',
        indent: 0,
        version: 1,
        children: [],
      },
    } as unknown as SerializedEditorState
  }

  const converted = convertNode(root)
  return { root: converted } as unknown as SerializedEditorState
}
