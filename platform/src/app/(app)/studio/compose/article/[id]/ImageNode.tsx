'use client'

// ImageNode.tsx —— 公众号正文「插图」自定义 Lexical 节点（DecoratorNode）。
//
// 编辑器里以 React 组件渲染一张 <img>（所见即所得）；序列化（exportJSON）时**直接产出
// 渲染器 src/renderers/lexical-to-wechat.ts 期望的 Payload `upload` 节点形状**：
//   {type:'upload', relationTo:'media', value:<mediaId>, fields:{alt}, version:1}
// 这样 toPayloadBody 对它原样透传即可，保存进 channel-content.body 后，预览/发布链路
// 以 depth:2 读库时 value 会被 Payload populate 成完整 media 文档（含 url/width），
// renderUpload 即能取到 <img src>。
//
// 节点内部同时保留 url（仅供编辑器内即时显示用，不参与最终公众号产物——产物 url 来自
// 渲染时 populate 出的 media.url）。alt 既存进节点也写进 fields.alt（渲染器读 fields.alt）。

import { DecoratorNode } from 'lexical'
import type {
  DOMConversionMap,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical'
import type { JSX } from 'react'

import { colors, radii, space } from '../../../_lib/theme'

// 序列化形状 = Payload upload 节点形状（供渲染器消费） + 编辑器自用的 url。
export type SerializedImageNode = Spread<
  {
    type: 'upload'
    relationTo: 'media'
    /** 已上传 media 的 id（渲染时被 populate 成完整文档）。 */
    value: string
    /** Payload 渲染器读 fields.alt 作题注 / alt。 */
    fields: { alt?: string }
    /** 编辑器内即时显示用的图片 URL（最终产物不依赖它）。 */
    url: string
  },
  SerializedLexicalNode
>

// 编辑器内的图片预览组件（只读展示，配 alt 题注）。
function ImageComponent({ url, alt }: { url: string; alt?: string }): JSX.Element {
  return (
    <figure style={{ margin: `${space.md} 0`, textAlign: 'center' }}>
      {/* 编辑器内预览用原生 <img> 即可；最终公众号产物由渲染器另出 <figure><img/>。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt ?? ''}
        style={{
          display: 'block',
          maxWidth: '100%',
          height: 'auto',
          margin: '0 auto',
          borderRadius: radii.sm,
          border: `1px solid ${colors.rule}`,
        }}
      />
      {alt ? (
        <figcaption
          style={{
            marginTop: space.xs,
            fontSize: 12.5,
            color: colors.muted,
            lineHeight: 1.6,
          }}
        >
          {alt}
        </figcaption>
      ) : null}
    </figure>
  )
}

export class ImageNode extends DecoratorNode<JSX.Element> {
  __mediaId: string
  __url: string
  __alt: string

  static getType(): string {
    return 'image'
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__mediaId, node.__url, node.__alt, node.__key)
  }

  constructor(mediaId: string, url: string, alt: string, key?: NodeKey) {
    super(key)
    this.__mediaId = mediaId
    this.__url = url
    this.__alt = alt
  }

  // 反序列化：兼容自身写出的形状（value=mediaId, url, fields.alt）。
  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    const mediaId = String(serializedNode.value ?? '')
    const url = typeof serializedNode.url === 'string' ? serializedNode.url : ''
    const alt =
      serializedNode.fields && typeof serializedNode.fields.alt === 'string'
        ? serializedNode.fields.alt
        : ''
    return new ImageNode(mediaId, url, alt)
  }

  // 序列化 = Payload upload 节点形状（关键：与渲染器约定一致）。
  exportJSON(): SerializedImageNode {
    return {
      type: 'upload',
      relationTo: 'media',
      value: this.__mediaId,
      fields: { alt: this.__alt },
      url: this.__url,
      version: 1,
    }
  }

  // 块级节点：独占一行。
  isInline(): false {
    return false
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span')
    span.style.display = 'block'
    return span
  }

  updateDOM(): false {
    return false
  }

  // 粘贴 HTML 时不识别外部 <img>（公众号插图一律走「插图」按钮上传到 media）。
  static importDOM(): DOMConversionMap | null {
    return null
  }

  exportDOM(): DOMExportOutput {
    const img = document.createElement('img')
    img.setAttribute('src', this.__url)
    if (this.__alt) img.setAttribute('alt', this.__alt)
    return { element: img }
  }

  decorate(): JSX.Element {
    return <ImageComponent url={this.__url} alt={this.__alt} />
  }
}

/** 工厂：新建一个 ImageNode。 */
export function $createImageNode(args: {
  mediaId: string
  url: string
  alt?: string
}): ImageNode {
  return new ImageNode(args.mediaId, args.url, args.alt ?? '')
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode
}
