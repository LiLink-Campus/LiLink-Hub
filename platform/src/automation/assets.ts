// 素材下载 —— 把 job.assets 的 presigned 直链下载成本地临时文件，供 setInputFiles。
//
// 健壮性（见设计文档「assets.ts」）：校验响应状态/类型、限制最大体积、保留原始扩展名、
// 流式写盘避免大视频占满内存、调用方 finally 清理临时目录。presigned URL 过期会给可操作提示。

import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform, type TransformCallback } from 'node:stream'
import { randomUUID } from 'node:crypto'

import { AssetError } from './errors'
import type { BrowserJobAsset } from './job'
import type { SocialAssetRole } from '../renderers/social-package'
import type { ResolvedAsset } from './uploaders/types'

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024 // 1GB（视频可能较大）

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
}

// 累计字节、超过上限即让 pipeline 失败的透明 Transform（content-length 缺失时也能兜底）。
class ByteCapGuard extends Transform {
  private total = 0
  constructor(private readonly maxBytes: number) {
    super()
  }
  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.total += chunk.length
    if (this.total > this.maxBytes) {
      cb(new Error(`asset exceeds max size (${this.maxBytes} bytes)`))
      return
    }
    cb(null, chunk)
  }
}

function extFor(asset: BrowserJobAsset, contentType: string | null): string {
  const fromName = asset.filename ? path.extname(asset.filename) : ''
  if (fromName) return fromName
  try {
    const fromUrl = asset.url ? path.extname(new URL(asset.url).pathname) : ''
    if (fromUrl) return fromUrl
  } catch {
    // URL 解析失败忽略
  }
  const ct = contentType?.split(';')[0].trim()
  if (ct && CONTENT_TYPE_EXT[ct]) return CONTENT_TYPE_EXT[ct]
  return ''
}

function roleMatchesType(role: SocialAssetRole, contentType: string | null): boolean {
  if (!contentType) return true // 无 content-type 不强判
  const ct = contentType.toLowerCase()
  if (ct.includes('octet-stream')) return true // OSS 常返回 octet-stream，不据此判错
  return role === 'video' ? ct.startsWith('video/') : ct.startsWith('image/')
}

export interface DownloadOptions {
  maxBytes?: number
  /** 单个素材下载超时（含响应+流式写盘）；默认 120s。 */
  timeoutMs?: number
  log?: (msg: string) => void
}

// 脱敏：presigned URL 的 query 里含签名/凭据，日志与报错只保留 origin+path。
function redactUrl(u?: string): string {
  if (!u) return '(无 url)'
  try {
    const x = new URL(u)
    return x.origin + x.pathname
  } catch {
    return u.split('?')[0]
  }
}

export interface DownloadedAssets {
  assets: ResolvedAsset[]
  warnings: string[]
  cleanup: () => Promise<void>
}

/** 下载 assets（带 url 的）到一个临时目录；返回本地路径列表 + 清理函数。出错会先清理再抛。 */
export async function downloadAssets(
  assets: BrowserJobAsset[],
  opts: DownloadOptions = {},
): Promise<DownloadedAssets> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = opts.timeoutMs ?? 120_000
  const log = opts.log ?? (() => {})
  const tempDir = path.join(os.tmpdir(), `lilink-publish-${randomUUID()}`)
  await mkdir(tempDir, { recursive: true })

  const resolved: ResolvedAsset[] = []
  const warnings: string[] = []
  const cleanup = async () => {
    await rm(tempDir, { recursive: true, force: true })
  }

  try {
    let i = 0
    for (const asset of assets) {
      i += 1
      if (!asset.url) {
        warnings.push(`第 ${i} 个素材缺少 url，已跳过（请确认媒体库直链/presigned 配置）`)
        continue
      }
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), timeoutMs)
      try {
        let res: Response
        try {
          res = await fetch(asset.url, { signal: ac.signal })
        } catch (err) {
          if (ac.signal.aborted) {
            throw new AssetError(`下载素材超时（>${timeoutMs}ms）：${redactUrl(asset.url)}`)
          }
          throw new AssetError(
            `下载素材失败（网络不可达）：${redactUrl(asset.url)}（${err instanceof Error ? err.message : String(err)}）`,
          )
        }
        if (!res.ok || !res.body) {
          throw new AssetError(
            `下载素材失败 HTTP ${res.status}：${redactUrl(asset.url)}。` +
              `presigned 直链可能已过期，请在中台重新生成发布包后再导出 job。`,
          )
        }
        const contentType = res.headers.get('content-type')
        if (!roleMatchesType(asset.role, contentType)) {
          warnings.push(`第 ${i} 个素材类型疑似不符（role=${asset.role}, content-type=${contentType}）`)
        }
        const declaredLen = Number(res.headers.get('content-length') || '0')
        if (declaredLen && declaredLen > maxBytes) {
          throw new AssetError(`素材超过大小上限（${declaredLen} > ${maxBytes} 字节）：${redactUrl(asset.url)}`)
        }

        const ext = extFor(asset, contentType)
        const localPath = path.join(tempDir, `asset-${i}${ext}`)
        log(`下载素材 ${i}/${assets.length} → ${path.basename(localPath)}`)

        const webStream = res.body as Parameters<typeof Readable.fromWeb>[0]
        try {
          await pipeline(Readable.fromWeb(webStream), new ByteCapGuard(maxBytes), createWriteStream(localPath))
        } catch (err) {
          if (ac.signal.aborted) {
            throw new AssetError(`下载素材超时（>${timeoutMs}ms）：${redactUrl(asset.url)}`)
          }
          throw new AssetError(`写入素材失败：${redactUrl(asset.url)}（${err instanceof Error ? err.message : String(err)}）`)
        }

        resolved.push({ role: asset.role, localPath, filename: asset.filename })
      } finally {
        clearTimeout(timer)
      }
    }
  } catch (err) {
    await cleanup()
    throw err
  }

  return { assets: resolved, warnings, cleanup }
}
