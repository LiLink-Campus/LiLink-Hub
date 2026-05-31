'use client'

// ImageNode.tsx —— 编辑面内联图片节点（Typora 式：图片在正文里直接渲染，所见即所得）。
// 存 mediaId + url + alt；通过 markdown transformer 与 ![alt](media:ID) 互转、随正文 round-trip。

import { DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical'
import type { JSX } from 'react'

import styles from './editor.module.css'

export type SerializedImageNode = Spread<
  { mediaId: number | string; url: string; alt: string },
  SerializedLexicalNode
>

export class ImageNode extends DecoratorNode<JSX.Element> {
  __mediaId: number | string
  __url: string
  __alt: string

  static getType(): string {
    return 'studio-image'
  }
  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__mediaId, node.__url, node.__alt, node.__key)
  }
  constructor(mediaId: number | string, url: string, alt: string, key?: NodeKey) {
    super(key)
    this.__mediaId = mediaId
    this.__url = url
    this.__alt = alt
  }
  static importJSON(serialized: SerializedImageNode): ImageNode {
    return new ImageNode(serialized.mediaId, serialized.url, serialized.alt)
  }
  exportJSON(): SerializedImageNode {
    return { type: 'studio-image', version: 1, mediaId: this.__mediaId, url: this.__url, alt: this.__alt }
  }
  getMediaId(): number | string {
    return this.__mediaId
  }
  getAlt(): string {
    return this.__alt
  }
  setUrl(url: string): void {
    const self = this.getWritable()
    self.__url = url
  }
  // inline 节点（便于 markdown text-match transformer 处理）；视觉块级由 .imageWrap 的 display:block 实现。
  isInline(): boolean {
    return true
  }
  createDOM(): HTMLElement {
    return document.createElement('div')
  }
  updateDOM(): false {
    return false
  }
  decorate(): JSX.Element {
    return (
      <span className={styles.imageWrap}>
        {this.__url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={this.__url} alt={this.__alt} className={styles.image} />
        ) : (
          <span className={styles.imageAlt}>图片（media:{String(this.__mediaId)}）</span>
        )}
        {this.__alt ? <span className={styles.imageAlt}>{this.__alt}</span> : null}
      </span>
    )
  }
}

export function $createImageNode(args: { mediaId: number | string; url: string; alt?: string }): ImageNode {
  return new ImageNode(args.mediaId, args.url, args.alt ?? '')
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode
}
